/**
 * Validation harness for the K-M engine. Run with:  npx tsx scripts/validate.ts
 *
 * Checks, in order:
 *  1. CIEDE2000 implementation against Sharma et al. reference pairs
 *  2. Masstone reproduction: engine-predicted Lab for each pure paint vs
 *     Golden's published CIELAB values (the acceptance test for the whole
 *     spectral chain: Saunderson roundtrip + K-M inversion + colorimetry)
 *  3. Tint physics: Titanium White + Phthalo Blue series behaviour per model
 *  4. Solver round-trips: targets generated from known mixtures must be
 *     matched to near-zero ΔE00
 *  5. Determinism: identical inputs → identical recipe
 *  6. Smoothest-metamer spectrum colour accuracy
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { AVAILABLE_PIGMENTS, CALIBRATION, SCATTERING_S, SPECTRAL_R_DATA } from '../constants';
import {
  deltaE2000,
  deltaE76,
  reflectanceToLab,
  rgbToLab,
  labToRgb,
} from '../services/colorimetry';
import {
  solvePhysicsRecipe,
  smoothestMetamer,
  SAUNDERSON_K1,
  SAUNDERSON_K2,
} from '../services/physicsEngine';
import { LabColor, MixModel } from '../types';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture: Record<string, {
  name: string;
  lab: [number, number, number];
  gamma: number;
  calibrated: boolean;
  opaqueLab?: [number, number, number];
}> = JSON.parse(fs.readFileSync(path.join(here, 'golden_lab_fixture.json'), 'utf-8'));

// Replicates the engine's kmcal path: internal K/S, γ·s weighting,
// specular-excluded output. Used for masstone and round-trip targets.
const kmcalRefl = (ids: string[], w: number[]): number[] => {
  const prep = ids.map(id => {
    const cal = CALIBRATION[id] ?? { g: 1, s: 1 };
    const ks = SPECTRAL_R_DATA[id].map(rm => {
      const r = Math.min(0.99999, Math.max(1e-5,
        (rm - SAUNDERSON_K1) / (1 - SAUNDERSON_K1 - SAUNDERSON_K2 * (1 - rm))));
      return ((1 - r) * (1 - r)) / (2 * r);
    });
    return { ks, g: cal.g, s: cal.s };
  });
  return SPECTRAL_R_DATA[ids[0]].map((_, i) => {
    let num = 0, den = 0;
    prep.forEach((p, j) => { num += w[j] * p.g * p.s * p.ks[i]; den += w[j] * p.s; });
    const q = num / den;
    const rInt = 1 + q - Math.sqrt(q * q + 2 * q);
    return ((1 - SAUNDERSON_K2) * rInt) / (1 - SAUNDERSON_K2 * rInt);
  });
};

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failures++;
};

// --- 1. CIEDE2000 reference pairs (Sharma, Wu & Dalal 2005) ---------------
const sharma: Array<[LabColor, LabColor, number]> = [
  [{ l: 50, a: 2.6772, b: -79.7751 }, { l: 50, a: 0, b: -82.7485 }, 2.0425],
  [{ l: 50, a: 3.1571, b: -77.2803 }, { l: 50, a: 0, b: -82.7485 }, 2.8615],
  [{ l: 50, a: 2.8361, b: -74.0200 }, { l: 50, a: 0, b: -82.7485 }, 3.4412],
  [{ l: 50, a: -1.3802, b: -84.2814 }, { l: 50, a: 0, b: -82.7485 }, 1.0000],
  [{ l: 50, a: 2.5, b: 0 }, { l: 50, a: 0, b: -2.5 }, 4.3065],
  [{ l: 60.2574, a: -34.0099, b: 36.2677 }, { l: 60.4626, a: -34.1751, b: 39.4387 }, 1.2644],
  [{ l: 35.0831, a: -44.1164, b: 3.7933 }, { l: 35.0232, a: -40.0716, b: 1.5901 }, 1.8645],
];
{
  let maxErr = 0;
  for (const [l1, l2, expected] of sharma)
    maxErr = Math.max(maxErr, Math.abs(deltaE2000(l1, l2) - expected));
  check('dE2000 vs Sharma reference', maxErr < 1e-4, `max |err| = ${maxErr.toExponential(2)}`);
}

// --- 2. Masstone reproduction --------------------------------------------
// Simulate the engine's full path for a pure paint: measured R -> Saunderson
// inverse -> K/S -> invert -> Saunderson forward -> Lab. The roundtrip must
// reproduce Golden's published Lab (k1 < min measured R guarantees this).
{
  const msToInternal = (rm: number) =>
    Math.min(0.99999, Math.max(1e-5, (rm - SAUNDERSON_K1) / (1 - SAUNDERSON_K1 - SAUNDERSON_K2 * (1 - rm))));
  const internalToMs = (r: number) =>
    SAUNDERSON_K1 + ((1 - SAUNDERSON_K1) * (1 - SAUNDERSON_K2) * r) / (1 - SAUNDERSON_K2 * r);
  const ksFromR = (r: number) => ((1 - r) * (1 - r)) / (2 * r);
  const rFromKS = (ks: number) => 1 + ks - Math.sqrt(ks * ks + 2 * ks);

  const errs: Array<{ id: string; de: number }> = [];
  for (const p of AVAILABLE_PIGMENTS) {
    const rMeas = SPECTRAL_R_DATA[p.id];
    const roundtrip = rMeas.map(rm => internalToMs(rFromKS(ksFromR(msToInternal(rm)))));
    const lab = reflectanceToLab(roundtrip);
    const ref = fixture[p.id].lab;
    errs.push({ id: p.id, de: deltaE76(lab, { l: ref[0], a: ref[1], b: ref[2] }) });
  }
  const des = errs.map(e => e.de);
  const mean = des.reduce((a, b) => a + b, 0) / des.length;
  const worst = errs.reduce((a, b) => (b.de > a.de ? b : a));
  check(
    'masstone Lab vs Golden published (80 paints)',
    mean < 0.1 && worst.de < 0.5,
    `mean dE76 ${mean.toFixed(4)}, worst ${worst.de.toFixed(4)} (${worst.id})  [old engine: mean 3.34, max 13.75]`,
  );
}

// --- 2b. Fully-opaque calibration (kmcal default model) -------------------
// Every calibrated pigment at 100% must reproduce Golden's 6mm fully-opaque
// CIELAB within the γ-fit residual bound (uncalibrated fallbacks excluded).
{
  const des: number[] = [];
  let nCal = 0, nFallback = 0;
  for (const p of AVAILABLE_PIGMENTS) {
    const fx = fixture[p.id];
    if (!fx.calibrated || !fx.opaqueLab) { nFallback++; continue; }
    nCal++;
    const lab = reflectanceToLab(kmcalRefl([p.id], [1]));
    des.push(deltaE76(lab, { l: fx.opaqueLab[0], a: fx.opaqueLab[1], b: fx.opaqueLab[2] }));
  }
  const mean = des.reduce((a, b) => a + b, 0) / des.length;
  const max = Math.max(...des);
  check('kmcal masstones vs Golden 6mm fully-opaque Lab',
    mean < 4 && max < 8.01 && nCal >= 65,
    `${nCal} calibrated (mean dE76 ${mean.toFixed(2)}, max ${max.toFixed(2)}; 1-param γ fit), ${nFallback} fallback`);

  const tiw = reflectanceToLab(kmcalRefl(['pw6'], [1]));
  const znw = reflectanceToLab(kmcalRefl(['pw4'], [1]));
  check('kmcal whites hit fully-opaque L*',
    Math.abs(tiw.l - fixture.pw6.opaqueLab![0]) < 1 && Math.abs(znw.l - fixture.pw4.opaqueLab![0]) < 1,
    `TiW L* ${tiw.l.toFixed(2)} vs ${fixture.pw6.opaqueLab![0]}, ZnW L* ${znw.l.toFixed(2)} vs ${fixture.pw4.opaqueLab![0]}; zinc s_rel ${CALIBRATION.pw4.s}`);
}

// --- 3. Tint physics ------------------------------------------------------
const tintLab = async (whiteFrac: number, model: MixModel): Promise<LabColor> => {
  // Use the solver's own mixing physics via a 2-pigment "palette" trick is
  // indirect; instead replicate the model maths here exactly as the engine does.
  const prep = (id: string) => {
    const rMeas = SPECTRAL_R_DATA[id];
    const ks = rMeas.map(rm => {
      const r = Math.min(0.99999, Math.max(1e-5, (rm - SAUNDERSON_K1) / (1 - SAUNDERSON_K1 - SAUNDERSON_K2 * (1 - rm))));
      return ((1 - r) * (1 - r)) / (2 * r);
    });
    return { rMeas, ks };
  };
  const w = prep('pw6'), c = prep('pb15');
  const cw = whiteFrac, cc = 1 - whiteFrac;
  const refl = w.rMeas.map((_, i) => {
    if (model === 'wgm') {
      return Math.exp(cw * Math.log(Math.max(1e-4, w.rMeas[i])) + cc * Math.log(Math.max(1e-4, c.rMeas[i])));
    }
    const sw = model === 'km2c' ? SCATTERING_S.pw6 : 1;
    const sc = model === 'km2c' ? SCATTERING_S.pb15 : 1;
    const ksMix = (cw * sw * w.ks[i] + cc * sc * c.ks[i]) / (cw * sw + cc * sc);
    const rInt = 1 + ksMix - Math.sqrt(ksMix * ksMix + 2 * ksMix);
    return SAUNDERSON_K1 + ((1 - SAUNDERSON_K1) * (1 - SAUNDERSON_K2) * rInt) / (1 - SAUNDERSON_K2 * rInt);
  });
  return reflectanceToLab(refl);
};

const tintL: Record<string, number[]> = {};
for (const model of ['km2c', 'km1c', 'wgm'] as MixModel[]) {
  const Ls: number[] = [];
  for (const f of [0, 0.25, 0.5, 0.75, 0.9, 1]) Ls.push((await tintLab(f, model)).l);
  tintL[model] = Ls;
  const monotonic = Ls.every((v, i) => i === 0 || v >= Ls[i - 1] - 1e-9);
  console.log(`      ${model}: L* over TiW fraction [0,.25,.5,.75,.9,1] = ${Ls.map(v => v.toFixed(1)).join(', ')}`);
  check(`tint series monotonic (${model})`, monotonic, `1:1 TiW:PhthaloGS L* = ${Ls[2].toFixed(1)}`);
}
// Phthalo GS is an extreme tinter: 1:1 with TiW stays a deep blue, 9:1
// TiW-heavy stays a solid mid-value blue (not pastel). The scattering-weighted
// model must sit strictly lighter than single-constant (which overweights
// strong tinters in white) at every interior point.
check('km2c tints lighter than km1c, ordering sane',
  tintL.km2c[2] > tintL.km1c[2] && tintL.wgm[2] > tintL.km2c[2],
  `1:1 L*: km1c ${tintL.km1c[2].toFixed(1)} < km2c ${tintL.km2c[2].toFixed(1)} < wgm ${tintL.wgm[2].toFixed(1)}`);
check('km2c 1:1 tint plausible for an extreme tinter',
  tintL.km2c[2] > 33 && tintL.km2c[2] < 62, `L* ${tintL.km2c[2].toFixed(1)} (defensible band 33–62)`);
check('km2c 9:1 white-heavy tint stays mid-value',
  tintL.km2c[4] > 48 && tintL.km2c[4] < 72, `L* ${tintL.km2c[4].toFixed(1)} (defensible band 48–72)`);
{
  const Ls = [0, 0.25, 0.5, 0.75, 0.9, 1].map(f =>
    reflectanceToLab(kmcalRefl(['pb15', 'pw6'], [1 - f, f])).l);
  console.log(`      kmcal: L* over TiW fraction [0,.25,.5,.75,.9,1] = ${Ls.map(v => v.toFixed(1)).join(', ')}`);
  check('tint series monotonic (kmcal)', Ls.every((v, i) => i === 0 || v >= Ls[i - 1] - 1e-9),
    `masstone L* ${Ls[0].toFixed(1)} (opaque, darker than thin-film) → TiW L* ${Ls[5].toFixed(1)}`);
}

// --- 4. Solver round-trips ------------------------------------------------
// Build targets from known mixtures; the solver must reach ~0 dE00 (it may
// find a metameric alternative recipe — colour match is the criterion).
const roundTrips: Array<{ ids: string[]; w: number[] }> = [
  { ids: ['pw6', 'pb15'], w: [0.7, 0.3] },
  { ids: ['py73', 'pb15'], w: [0.65, 0.35] },
  { ids: ['pw6', 'pr254', 'py43'], w: [0.6, 0.25, 0.15] },
  { ids: ['pw6', 'pbk7'], w: [0.85, 0.15] },
  { ids: ['pb29', 'pr122', 'pw6'], w: [0.3, 0.25, 0.45] },
];
{
  // Predict each mixture's colour with the engine maths (kmcal default),
  // then ask the solver to match that hex with the full 80-paint palette.
  for (const rt of roundTrips) {
    const lab = reflectanceToLab(kmcalRefl(rt.ids, rt.w));
    const { r, g, b } = labToRgb(lab.l, lab.a, lab.b);
    const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    const res = await solvePhysicsRecipe(hex, AVAILABLE_PIGMENTS, 5, 'kmcal');
    const names = res.recipe.map(rc => `${rc.pigmentName} ${rc.percentage.toFixed(0)}%`).join(' + ');
    check(
      `solver round-trip [${rt.ids.join('+')}] (kmcal)`,
      res.deltaE < 1.0,
      `dE00 ${res.deltaE.toFixed(3)}  parts ${res.partsLabel}  → ${names}`,
    );
  }
}

// --- 5. Determinism -------------------------------------------------------
{
  const a = await solvePhysicsRecipe('#4166f5', AVAILABLE_PIGMENTS, 5, 'kmcal');
  const b = await solvePhysicsRecipe('#4166f5', AVAILABLE_PIGMENTS, 5, 'kmcal');
  const same =
    JSON.stringify(a.recipe) === JSON.stringify(b.recipe) &&
    a.deltaE === b.deltaE &&
    a.partsLabel === b.partsLabel;
  check('determinism (same input → same recipe)', same,
    `dE00 ${a.deltaE.toFixed(3)}, parts ${a.partsLabel}, recipe ${a.recipe.map(r => r.pigmentId).join('+')}`);
}

// --- 6. Smoothest metamer colour accuracy ---------------------------------
{
  let worst = 0;
  for (const hex of ['#4166f5', '#c0392b', '#27ae60', '#f1c40f', '#808080', '#e8e2d0']) {
    const rgb = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
    const target = rgbToLab(rgb.r, rgb.g, rgb.b);
    const spec = smoothestMetamer(target);
    const got = reflectanceToLab(spec);
    worst = Math.max(worst, deltaE2000(got, target));
  }
  check('smoothest-metamer spectra match their targets', worst < 1.0, `worst dE00 ${worst.toFixed(3)} across 6 targets`);
}

// --- Timing sanity --------------------------------------------------------
{
  const t0 = performance.now();
  await solvePhysicsRecipe('#8e6a3a', AVAILABLE_PIGMENTS, 5, 'km2c');
  const ms = performance.now() - t0;
  check('solve time reasonable', ms < 8000, `${ms.toFixed(0)} ms for 80-paint palette, cap 5`);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
