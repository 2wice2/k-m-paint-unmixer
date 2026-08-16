/**
 * Validation for the insulin-pen dispensing planner. Run with:
 *   npx tsx scripts/validateDispense.ts
 *
 * Checks, in order:
 *  1. Largest-remainder apportionment: exactness, known cases, degenerate input
 *  2. Density table coverage and plausibility of wet-paint estimates
 *  3. planDispense invariants: unit sums, uniform-strength cancellation,
 *     strength-driven reallocation, min-batch property, achieved weights
 *  4. evaluateMixture agreement with the harness's reference kmcal chain
 *  5. Rounded-recipe ΔE00 convergence with batch size
 */
import { AVAILABLE_PIGMENTS, CALIBRATION, SPECTRAL_R_DATA } from '../constants';
import { D65_10, deltaE76, reflectanceToLab } from '../services/colorimetry';
import {
  evaluateMixture,
  SAUNDERSON_K1,
  SAUNDERSON_K2,
} from '../services/physicsEngine';
import {
  CARTRIDGE_UNITS,
  largestRemainder,
  paintDensity,
  PIGMENT_SG,
  planDispense,
} from '../services/dispensePlanner';
import { RecipeComponent } from '../types';

let failures = 0;
const check = (name: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failures++;
};

const mkRecipe = (parts: Array<[string, number]>): RecipeComponent[] =>
  parts.map(([id, pct]) => {
    const p = AVAILABLE_PIGMENTS.find(x => x.id === id)!;
    return { pigmentId: id, pigmentName: p.name, percentage: pct, hex: p.hex };
  });

// --- 1. Largest remainder --------------------------------------------------
{
  const a = largestRemainder([0.5, 0.3, 0.2], 10);
  check('LR known case', a.join(',') === '5,3,2', `[0.5,0.3,0.2]×10 → ${a.join(',')}`);

  const b = largestRemainder([1, 1, 1], 10);
  check(
    'LR thirds sum + spread',
    b.reduce((x, y) => x + y, 0) === 10 && Math.max(...b) - Math.min(...b) === 1,
    `[1,1,1]×10 → ${b.join(',')}`,
  );

  let sumsOk = true;
  const shares = [0.617, 0.383, 0.041, 0.13, 3.2, 0.006];
  for (let n = 1; n <= 300; n++) {
    const u = largestRemainder(shares, n);
    if (u.reduce((x, y) => x + y, 0) !== n) { sumsOk = false; break; }
  }
  check('LR exact sums 1..300', sumsOk, 'six-component share vector');

  const c = largestRemainder([0, -1, 2], 7);
  check('LR degenerate shares', c.join(',') === '0,0,7', `zero/negative shares → ${c.join(',')}`);
}

// --- 2. Density table ------------------------------------------------------
{
  const missing = AVAILABLE_PIGMENTS.filter(p => !(p.id in PIGMENT_SG)).map(p => p.id);
  check('SG coverage', missing.length === 0, missing.length ? `missing: ${missing.join(',')}` : 'all 80 pigments have SG');

  const tw = paintDensity('pw6', 'fluid').density;
  const ph = paintDensity('pb15', 'fluid').density;
  check('TiW fluid density plausible', tw > 1.4 && tw < 2.0, `${tw.toFixed(2)} g/ml`);
  check('Phthalo fluid density plausible', ph > 1.0 && ph < 1.3, `${ph.toFixed(2)} g/ml`);

  const twHf = paintDensity('pw6', 'highflow').density;
  check('High Flow lighter than Fluid', twHf < tw, `TiW ${twHf.toFixed(2)} < ${tw.toFixed(2)}`);

  const ov = paintDensity('pw6', 'fluid', { density: { pw6: 1.55 } });
  check('Density override wins', ov.density === 1.55 && !ov.estimated, `override → ${ov.density}`);
}

// --- 3. planDispense invariants ---------------------------------------------
{
  const recipe = mkRecipe([['pw6', 70], ['pb15', 25], ['pv19', 5]]);

  const p30 = planDispense(recipe, 30, 'fluid');
  const unitSum = p30.components.reduce((a, c) => a + c.units, 0);
  check('Units sum to batch', unitSum === 30, `${p30.components.map(c => c.units).join('+')} = ${unitSum}`);

  const wSum = p30.achievedWeights.reduce((a, w) => a + w.weight, 0);
  check('Achieved weights normalised', Math.abs(wSum - 1) < 1e-12, `Σ = ${wSum}`);

  const pUniform = planDispense(recipe, 30, 'fluid', { strength: { pw6: 2, pb15: 2, pv19: 2 } });
  check(
    'Uniform strength cancels',
    pUniform.components.every((c, i) => c.units === p30.components[i].units),
    `${pUniform.components.map(c => c.units).join(',')} vs ${p30.components.map(c => c.units).join(',')}`,
  );

  const pHalf = planDispense(mkRecipe([['pw6', 50], ['pb15', 50]]), 30, 'fluid', { strength: { pb15: 2 } });
  check(
    'Strength reallocates volume',
    pHalf.components[0].units === 20 && pHalf.components[1].units === 10,
    `2× phthalo strength → ${pHalf.components.map(c => `${c.units}U`).join(' / ')}`,
  );

  const min = p30.minBatchUnits;
  check('Min batch exists', min !== null && min >= 3 && min <= CARTRIDGE_UNITS, `min = ${min}`);
  if (min !== null) {
    const shares = recipe.map(c => c.percentage / 100);
    const atMin = largestRemainder(shares, min);
    const below = largestRemainder(shares, min - 1);
    check('Min batch: all ≥1 U', atMin.every(u => u >= 1), `@${min} → ${atMin.join(',')}`);
    check('Min batch is tight', below.some(u => u === 0), `@${min - 1} → ${below.join(',')}`);
  }

  const pTrace = planDispense(mkRecipe([['pw6', 98], ['pb15', 2]]), 10, 'fluid');
  check(
    'Sub-unit component flagged',
    pTrace.anyBelowOne && pTrace.achievedWeights.length === 1,
    `2% paint at 10 U → belowOne=${pTrace.anyBelowOne}, achieved has ${pTrace.achievedWeights.length} entry`,
  );

  const grams = p30.components[0];
  const expected = grams.units * 0.01 * grams.densityUsed;
  check('Gram prediction = ml × ρ', Math.abs(grams.grams - expected) < 1e-12, `${grams.grams.toFixed(4)} g`);
}

// --- 4. evaluateMixture vs reference kmcal chain -----------------------------
{
  // Reference chain replicated from scripts/validate.ts (kmcalRefl).
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

  const refLab = reflectanceToLab(kmcalRefl(['pw6', 'pb15'], [0.7, 0.3]), D65_10);
  const got = evaluateMixture(
    [{ pigmentId: 'pw6', weight: 0.7 }, { pigmentId: 'pb15', weight: 0.3 }],
    refLab,
  );
  check('evaluateMixture matches reference', got.deltaE < 0.05 && deltaE76(got.lab, refLab) < 0.05,
    `ΔE00 vs reference chain = ${got.deltaE.toFixed(4)}`);

  const unnormalised = evaluateMixture(
    [{ pigmentId: 'pw6', weight: 7 }, { pigmentId: 'pb15', weight: 3 }],
    refLab,
  );
  check('evaluateMixture normalises weights', Math.abs(unnormalised.deltaE - got.deltaE) < 1e-9,
    `7:3 ≡ 0.7:0.3 (ΔE ${unnormalised.deltaE.toFixed(4)})`);
}

// --- 5. Rounded-recipe ΔE convergence ----------------------------------------
{
  const recipe = mkRecipe([['pw6', 61.7], ['pb15', 38.3]]);
  const target = evaluateMixture(
    recipe.map(c => ({ pigmentId: c.pigmentId, weight: c.percentage })),
    { l: 50, a: 0, b: 0 },
  ).lab;

  const deAt = (batch: number): number => {
    const plan = planDispense(recipe, batch, 'fluid');
    return evaluateMixture(plan.achievedWeights, target).deltaE;
  };

  const de10 = deAt(10);
  const de30 = deAt(30);
  const de300 = deAt(300);
  check('Rounding ΔE small at 30 U', de30 < 1.0, `ΔE00 = ${de30.toFixed(3)}`);
  check('Rounding ΔE tiny at 300 U', de300 < 0.15, `ΔE00 = ${de300.toFixed(3)}`);
  check('ΔE improves with batch size', de300 <= de10 + 1e-9, `10 U ${de10.toFixed(3)} → 300 U ${de300.toFixed(3)}`);
}

console.log(failures === 0 ? '\nAll dispense checks passed.' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
