import { MixModel, Pigment, RecipeComponent, SpectralPoint, UnmixResult } from '../types';
import { AVAILABLE_PIGMENTS, CALIBRATION, SCATTERING_S, SPECTRAL_R_DATA, WAVELENGTHS } from '../constants';
import {
  A_10,
  D65_10,
  N_BANDS,
  deltaE2000,
  labToRgb,
  labToXYZ,
  reflectanceToLab,
  rgbToLab,
} from './colorimetry';
import { LabColor } from '../types';

// ---------------------------------------------------------------------------
// Optical model
//
// Measured reflectance (over-white drawdowns) → Saunderson-corrected internal
// reflectance → K/S via Kubelka–Munk → mix → invert → re-apply Saunderson.
//
// Ingest k1 = 0.03 sits just below the dataset's minimum measured reflectance
// (0.0372, gloss included) so every masstone survives the inverse correction.
// The OUTPUT side depends on the mixing model: the calibrated default renders
// paint at complete hiding viewed without glare (specular EXCLUDED, k1 = 0 —
// the convention of Golden's 6 mm fully-opaque CIELAB data it is calibrated
// against); the thin-film comparison models re-apply the full correction so
// they land back on the drawdown measurement.
// ---------------------------------------------------------------------------

export const SAUNDERSON_K1 = 0.03;
export const SAUNDERSON_K2 = 0.6;

const R_INT_MIN = 1e-5;
const R_INT_MAX = 0.99999;

const measuredToInternal = (rm: number): number => {
  const r = (rm - SAUNDERSON_K1) / (1 - SAUNDERSON_K1 - SAUNDERSON_K2 * (1 - rm));
  return Math.min(R_INT_MAX, Math.max(R_INT_MIN, r));
};

/** Saunderson forward, specular included — thin-film (drawdown) convention. */
const internalToMeasured = (r: number): number =>
  SAUNDERSON_K1 +
  ((1 - SAUNDERSON_K1) * (1 - SAUNDERSON_K2) * r) / (1 - SAUNDERSON_K2 * r);

/** Saunderson forward, specular EXCLUDED (k1 = 0) — fully-opaque convention. */
const internalToSpex = (r: number): number =>
  ((1 - SAUNDERSON_K2) * r) / (1 - SAUNDERSON_K2 * r);

const ksFromR = (r: number): number => ((1 - r) * (1 - r)) / (2 * r);

const rFromKS = (ks: number): number => 1 + ks - Math.sqrt(ks * ks + 2 * ks);

interface PreparedPigment {
  id: string;
  name: string;
  hex: string;
  s: number;            // opacity-class scattering weight (km2c mode)
  g: number;            // fully-opaque calibration γ (kmcal mode)
  sCal: number;         // calibrated relative scattering (kmcal mode; TiW = 1)
  ksInt: Float64Array;  // internal K/S per band
  lnR: Float64Array;    // ln(measured R) per band, for WGM mixing
}

const preparePalette = (palette: Pigment[]): PreparedPigment[] => {
  const out: PreparedPigment[] = [];
  for (const p of palette) {
    const rMeas = SPECTRAL_R_DATA[p.id];
    if (!rMeas) continue;
    const ksInt = new Float64Array(N_BANDS);
    const lnR = new Float64Array(N_BANDS);
    for (let w = 0; w < N_BANDS; w++) {
      ksInt[w] = ksFromR(measuredToInternal(rMeas[w]));
      lnR[w] = Math.log(Math.max(1e-4, rMeas[w]));
    }
    const cal = CALIBRATION[p.id];
    out.push({
      id: p.id,
      name: p.name,
      hex: p.hex,
      s: SCATTERING_S[p.id] ?? 0.45,
      g: cal?.g ?? 1,
      sCal: cal?.s ?? 1,
      ksInt,
      lnR,
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Mixture evaluation (allocation-free hot path)
// ---------------------------------------------------------------------------

class Evaluator {
  readonly pigs: PreparedPigment[];
  readonly model: MixModel;
  readonly targetLab: LabColor;
  readonly refl = new Float64Array(N_BANDS); // last predicted measured R
  private readonly lab: LabColor = { l: 0, a: 0, b: 0 };
  evalCount = 0;

  constructor(pigs: PreparedPigment[], model: MixModel, targetLab: LabColor) {
    this.pigs = pigs;
    this.model = model;
    this.targetLab = targetLab;
  }

  /** Predict display-domain reflectance into this.refl. */
  mix(indices: readonly number[], weights: ArrayLike<number>): Float64Array {
    const m = indices.length;
    const refl = this.refl;
    if (this.model === 'wgm') {
      for (let w = 0; w < N_BANDS; w++) {
        let lnR = 0;
        for (let j = 0; j < m; j++) lnR += weights[j] * this.pigs[indices[j]].lnR[w];
        refl[w] = Math.exp(lnR);
      }
      return refl;
    }
    // Kubelka–Munk two-constant form: (K/S)mix = Σ cᵢkᵢ / Σ cᵢsᵢ.
    //   'kmcal': kᵢ = γᵢ·sᵢ·(K/S)ᵢ with calibrated γ and s (s=1 convention,
    //            zinc ≈ 0.42); fully-opaque output, specular excluded.
    //   'km2c':  kᵢ = sᵢ·(K/S)ᵢ with opacity-class s; thin-film output.
    //   'km1c':  single-constant (all s = 1); thin-film output.
    const model = this.model;
    let sumS = 0;
    for (let j = 0; j < m; j++) {
      const p = this.pigs[indices[j]];
      const s = model === 'kmcal' ? p.sCal : model === 'km2c' ? p.s : 1;
      sumS += weights[j] * s;
    }
    if (sumS <= 0) sumS = 1;
    for (let w = 0; w < N_BANDS; w++) {
      let k = 0;
      for (let j = 0; j < m; j++) {
        const p = this.pigs[indices[j]];
        const ks =
          model === 'kmcal' ? p.g * p.sCal * p.ksInt[w]
          : model === 'km2c' ? p.s * p.ksInt[w]
          : p.ksInt[w];
        k += weights[j] * ks;
      }
      const rInt = rFromKS(k / sumS);
      refl[w] = model === 'kmcal' ? internalToSpex(rInt) : internalToMeasured(rInt);
    }
    return refl;
  }

  labOfLastMix(): LabColor {
    let X = 0, Y = 0, Z = 0;
    const { wx, wy, wz, white } = D65_10;
    for (let w = 0; w < N_BANDS; w++) {
      const r = this.refl[w];
      X += r * wx[w];
      Y += r * wy[w];
      Z += r * wz[w];
    }
    const fx = fLabFast(X / white[0]);
    const fy = fLabFast(Y / white[1]);
    const fz = fLabFast(Z / white[2]);
    this.lab.l = 116 * fy - 16;
    this.lab.a = 500 * (fx - fy);
    this.lab.b = 200 * (fy - fz);
    return this.lab;
  }

  deltaE(indices: readonly number[], weights: ArrayLike<number>): number {
    this.evalCount++;
    this.mix(indices, weights);
    return deltaE2000(this.labOfLastMix(), this.targetLab);
  }
}

const LAB_EPS = 216 / 24389;
const LAB_KAPPA = 24389 / 27;
const fLabFast = (t: number): number =>
  t > LAB_EPS ? Math.cbrt(t) : (LAB_KAPPA * t + 16) / 116;

/**
 * Forward-evaluate an arbitrary mixture (e.g. a recipe quantised to pen
 * units) without running the solver: predicted Lab, sRGB hex, and CIEDE2000
 * vs `targetLab`, under the given mixing model. Weights are normalised
 * internally; components without spectral data are ignored.
 */
export const evaluateMixture = (
  components: { pigmentId: string; weight: number }[],
  targetLab: LabColor,
  model: MixModel = 'kmcal',
): { deltaE: number; lab: LabColor; hex: string; clipped: boolean } => {
  const palette = components
    .map(c => AVAILABLE_PIGMENTS.find(p => p.id === c.pigmentId))
    .filter((p): p is Pigment => !!p);
  const pigs = preparePalette(palette);
  if (pigs.length === 0) throw new Error('No spectral data for mixture components.');

  const indices: number[] = [];
  const raw: number[] = [];
  for (const c of components) {
    const i = pigs.findIndex(p => p.id === c.pigmentId);
    if (i !== -1 && c.weight > 0) {
      indices.push(i);
      raw.push(c.weight);
    }
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error('Mixture has no positive weights.');
  const weights = Float64Array.from(raw, w => w / sum);

  const ev = new Evaluator(pigs, model, targetLab);
  const deltaE = ev.deltaE(indices, weights);
  const lab = { ...ev.labOfLastMix() };
  const { r, g, b, clipped } = labToRgb(lab.l, lab.a, lab.b);
  const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  return { deltaE, lab, hex, clipped };
};

// ---------------------------------------------------------------------------
// Deterministic Nelder–Mead over the simplex (softmax parameterisation).
// weights = softmax([theta_0..theta_{m-2}, 0]) keeps amounts positive and
// summing to 1 with an unconstrained search space; no randomness anywhere,
// so the same target always yields the same recipe.
// ---------------------------------------------------------------------------

const softmax = (theta: ArrayLike<number>, out: Float64Array): void => {
  const n = theta.length; // out has length n+1
  let max = 0;
  for (let i = 0; i < n; i++) if (theta[i] > max) max = theta[i];
  let sum = Math.exp(-max); // implicit last logit = 0
  for (let i = 0; i < n; i++) {
    out[i] = Math.exp(theta[i] - max);
    sum += out[i];
  }
  for (let i = 0; i < n; i++) out[i] /= sum;
  out[n] = Math.exp(-max) / sum;
};

interface SubsetResult {
  indices: number[];
  theta: number[];
  weights: number[];
  de: number;
}

const optimizeSubset = (
  ev: Evaluator,
  indices: number[],
  theta0: number[],
  step: number,
  maxEval: number,
): SubsetResult => {
  const m = indices.length;
  const wBuf = new Float64Array(m);

  if (m === 1) {
    wBuf[0] = 1;
    const de = ev.deltaE(indices, wBuf);
    return { indices, theta: [], weights: [1], de };
  }

  const n = m - 1;
  const f = (theta: ArrayLike<number>): number => {
    softmax(theta, wBuf);
    return ev.deltaE(indices, wBuf);
  };

  // Initial simplex around theta0
  const pts: number[][] = [theta0.slice()];
  for (let j = 0; j < n; j++) {
    const p = theta0.slice();
    p[j] += step;
    pts.push(p);
  }
  const fv = pts.map(f);
  let evals = n + 1;

  const ALPHA = 1, GAMMA = 2, RHO = 0.5, SIGMA = 0.5;

  while (evals < maxEval) {
    // Order vertices (insertion sort — tiny n)
    for (let i = 1; i <= n; i++) {
      const pv = pts[i], pf = fv[i];
      let j = i - 1;
      while (j >= 0 && fv[j] > pf) {
        pts[j + 1] = pts[j];
        fv[j + 1] = fv[j];
        j--;
      }
      pts[j + 1] = pv;
      fv[j + 1] = pf;
    }
    if (fv[n] - fv[0] < 1e-4) break;

    // Centroid of all but worst
    const cen = new Array(n).fill(0);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) cen[j] += pts[i][j] / n;

    const worst = pts[n];
    const refl = cen.map((c, j) => c + ALPHA * (c - worst[j]));
    const fr = f(refl); evals++;

    if (fr < fv[0]) {
      const exp = cen.map((c, j) => c + GAMMA * (c - worst[j]));
      const fe = f(exp); evals++;
      if (fe < fr) { pts[n] = exp; fv[n] = fe; }
      else { pts[n] = refl; fv[n] = fr; }
    } else if (fr < fv[n - 1]) {
      pts[n] = refl; fv[n] = fr;
    } else {
      const useOutside = fr < fv[n];
      const base = useOutside ? refl : worst;
      const con = cen.map((c, j) => c + RHO * (base[j] - c));
      const fc = f(con); evals++;
      if (fc < Math.min(fr, fv[n])) {
        pts[n] = con; fv[n] = fc;
      } else {
        for (let i = 1; i <= n; i++) {
          pts[i] = pts[i].map((v, j) => pts[0][j] + SIGMA * (v - pts[0][j]));
          fv[i] = f(pts[i]); evals++;
        }
      }
    }
  }

  let bi = 0;
  for (let i = 1; i <= n; i++) if (fv[i] < fv[bi]) bi = i;
  softmax(pts[bi], wBuf);
  return { indices, theta: pts[bi].slice(), weights: Array.from(wBuf), de: fv[bi] };
};

/** Equal-weights start, plus a white-heavy start when a white is present. */
const initialThetas = (
  pigs: PreparedPigment[],
  indices: number[],
): number[][] => {
  const m = indices.length;
  const inits: number[][] = [new Array(Math.max(0, m - 1)).fill(0)];
  const whitePos = indices.findIndex(
    i => pigs[i].id === 'pw6' || pigs[i].id === 'pw4',
  );
  if (whitePos !== -1 && m >= 2) {
    const t = new Array(m - 1).fill(0);
    if (whitePos < m - 1) t[whitePos] = 2.2;
    else for (let j = 0; j < m - 1; j++) t[j] = -2.2;
    inits.push(t);
  }
  return inits;
};

// ---------------------------------------------------------------------------
// "Smoothest metamer" target spectrum for the chart: the smoothest physical
// reflectance (min Σ‖second differences‖²) whose D65/10° colour equals the
// target. Solved as a 31×31 linear system, then clipped to plausible paint
// reflectance [0.01, 0.99] with an XYZ-residual correction pass.
// ---------------------------------------------------------------------------

const solveLinear = (A: Float64Array[], b: Float64Array): Float64Array => {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (piv !== col) {
      const tA = A[col]; A[col] = A[piv]; A[piv] = tA;
      const tb = b[col]; b[col] = b[piv]; b[piv] = tb;
    }
    const d = A[col][col] || 1e-12;
    for (let r = col + 1; r < n; r++) {
      const factor = A[r][col] / d;
      if (factor === 0) continue;
      for (let c = col; c < n; c++) A[r][c] -= factor * A[col][c];
      b[r] -= factor * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let acc = b[r];
    for (let c = r + 1; c < n; c++) acc -= A[r][c] * x[c];
    x[r] = acc / (A[r][r] || 1e-12);
  }
  return x;
};

export const smoothestMetamer = (targetLab: LabColor): number[] => {
  const xyz = labToXYZ(targetLab);
  const T = [D65_10.wx, D65_10.wy, D65_10.wz].map(w =>
    Float64Array.from(w, v => v / 100),
  );
  const W = 3e4;

  // Base matrix M = D2ᵀD2 + W·TᵀT (D2 = second-difference operator)
  const M0: Float64Array[] = Array.from(
    { length: N_BANDS },
    () => new Float64Array(N_BANDS),
  );
  for (let k = 0; k < N_BANDS - 2; k++) {
    const idx = [k, k + 1, k + 2];
    const coef = [1, -2, 1];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) M0[idx[i]][idx[j]] += coef[i] * coef[j];
  }
  for (let i = 0; i < N_BANDS; i++)
    for (let j = 0; j < N_BANDS; j++)
      for (let ch = 0; ch < 3; ch++) M0[i][j] += W * T[ch][i] * T[ch][j];

  const target = [xyz[0] / 100, xyz[1] / 100, xyz[2] / 100];
  let b = target.slice();
  let best: Float64Array | null = null;

  for (let pass = 0; pass < 3; pass++) {
    const A = M0.map(row => Float64Array.from(row));
    const rhs = new Float64Array(N_BANDS);
    for (let i = 0; i < N_BANDS; i++)
      for (let ch = 0; ch < 3; ch++) rhs[i] += W * T[ch][i] * b[ch];
    const R = solveLinear(A, rhs);
    for (let i = 0; i < N_BANDS; i++) R[i] = Math.min(0.99, Math.max(0.01, R[i]));
    best = R;
    // Compensate clipping: nudge the linear target by the achieved residual
    const achieved = [0, 0, 0];
    for (let ch = 0; ch < 3; ch++)
      for (let i = 0; i < N_BANDS; i++) achieved[ch] += T[ch][i] * R[i];
    const err = Math.hypot(
      achieved[0] - target[0], achieved[1] - target[1], achieved[2] - target[2],
    );
    if (err < 1e-4) break;
    b = b.map((v, ch) => v + (target[ch] - achieved[ch]));
  }
  return Array.from(best!);
};

// ---------------------------------------------------------------------------
// Main solver
// ---------------------------------------------------------------------------

const MAX_RECIPE_PIGMENTS = 6;   // enumeration-cost bound
const POOL_SIZE = 15;            // candidate pigments considered per solve
const MIN_COMPONENT = 0.0075;    // recipe components below 0.75% are removed
const COMPLEXITY_PENALTY = 0.05; // ΔE00 handicap per extra paint

const MODEL_LABELS: Record<MixModel, string> = {
  kmcal: 'γ-calibrated Kubelka–Munk (fully-opaque endpoints vs Golden 6mm CIELAB, specular excluded)',
  km2c: 'Kubelka–Munk, scattering-weighted (pseudo two-constant, thin-film)',
  km1c: 'Kubelka–Munk, single-constant (thin-film)',
  wgm: 'weighted geometric mean (Burns, thin-film)',
};

export const solvePhysicsRecipe = async (
  targetHex: string,
  palette: Pigment[],
  maxPigments?: number,
  model: MixModel = 'kmcal',
): Promise<UnmixResult> => {
  const rgb = {
    r: parseInt(targetHex.slice(1, 3), 16),
    g: parseInt(targetHex.slice(3, 5), 16),
    b: parseInt(targetHex.slice(5, 7), 16),
  };
  const targetLab = rgbToLab(rgb.r, rgb.g, rgb.b);

  const pigs = preparePalette(palette);
  if (pigs.length === 0) throw new Error('No spectral data for selected pigments.');

  const cap = Math.max(
    1,
    Math.min(maxPigments ?? MAX_RECIPE_PIGMENTS, MAX_RECIPE_PIGMENTS, pigs.length),
  );

  const ev = new Evaluator(pigs, model, targetLab);
  const wBuf = new Float64Array(2);

  // --- Candidate pool: solo + tint relevance --------------------------------
  const whiteIdx = (() => {
    let idx = pigs.findIndex(p => p.id === 'pw6');
    if (idx === -1) idx = pigs.findIndex(p => p.id === 'pw4');
    return idx;
  })();

  const score = new Float64Array(pigs.length);
  for (let i = 0; i < pigs.length; i++) {
    wBuf[0] = 1;
    let s = ev.deltaE([i], wBuf);
    if (whiteIdx !== -1 && i !== whiteIdx) {
      for (const t of [0.15, 0.35, 0.55, 0.75, 0.9]) {
        wBuf[0] = 1 - t;
        wBuf[1] = t;
        const de = ev.deltaE([i, whiteIdx], wBuf);
        if (de < s) s = de;
      }
    }
    score[i] = s;
  }

  const byScore = pigs
    .map((p, i) => i)
    .sort((a, b) => score[a] - score[b] || (pigs[a].id < pigs[b].id ? -1 : 1));

  const pool: number[] = [];
  const pushUnique = (i: number) => {
    if (i >= 0 && !pool.includes(i) && pool.length < POOL_SIZE) pool.push(i);
  };
  for (const id of ['pw6', 'pw4']) pushUnique(pigs.findIndex(p => p.id === id));
  const blacks = ['pbk7', 'pbk9', 'pbk11']
    .map(id => pigs.findIndex(p => p.id === id))
    .filter(i => i !== -1)
    .sort((a, b) => score[a] - score[b]);
  if (blacks.length > 0) pushUnique(blacks[0]);
  for (const i of byScore) pushUnique(i);

  // --- Coarse pass over every subset of the pool (sizes 1..cap) -------------
  const coarse: SubsetResult[] = [];
  const combo: number[] = [];
  let sinceYield = 0;

  const runCoarse = async (size: number, start: number): Promise<void> => {
    if (combo.length === size) {
      const indices = combo.map(c => pool[c]);
      let best: SubsetResult | null = null;
      for (const t0 of initialThetas(pigs, indices)) {
        const r = optimizeSubset(ev, indices, t0, 1.2, 40 + 18 * size);
        if (!best || r.de < best.de) best = r;
      }
      coarse.push(best!);
      if (++sinceYield >= 500) {
        sinceYield = 0;
        await new Promise(res => setTimeout(res, 0));
      }
      return;
    }
    for (let c = start; c <= pool.length - (size - combo.length); c++) {
      combo.push(c);
      await runCoarse(size, c + 1);
      combo.pop();
    }
  };
  for (let size = 1; size <= Math.min(cap, pool.length); size++) {
    await runCoarse(size, 0);
  }

  // --- Refine the most promising subsets ------------------------------------
  const penalized = (r: SubsetResult): number =>
    r.de + COMPLEXITY_PENALTY * (r.indices.length - 1);
  coarse.sort((a, b) => penalized(a) - penalized(b));

  // Refine the global top plus the best subset of every size — simple recipes
  // must always get a full-precision shot, or a coarse near-tie can bury a
  // 2-paint solution under metameric many-paint alternatives.
  const refineSet = coarse.slice(0, 32);
  for (let size = 1; size <= cap; size++) {
    const bestOfSize = coarse.find(r => r.indices.length === size);
    if (bestOfSize && !refineSet.includes(bestOfSize)) refineSet.push(bestOfSize);
  }

  let best: SubsetResult | null = null;
  for (const cand of refineSet) {
    const r = optimizeSubset(ev, cand.indices, cand.theta, 0.35, 450);
    if (!best || penalized(r) < penalized(best)) best = r;
  }
  await new Promise(res => setTimeout(res, 0));

  // --- Cleanup: drop trace components, re-optimise, so that the displayed
  // recipe is *exactly* the mixture being evaluated --------------------------
  let indices = best!.indices.slice();
  let weights = best!.weights.slice();
  let de = best!.de;
  for (let guard = 0; guard < MAX_RECIPE_PIGMENTS; guard++) {
    if (indices.length <= 1) break;
    const keep = weights.map(w => w >= MIN_COMPONENT);
    if (keep.every(Boolean)) break;
    let maxJ = 0;
    weights.forEach((w, j) => { if (w > weights[maxJ]) maxJ = j; });
    keep[maxJ] = true; // never drop the dominant paint
    const nextIdx = indices.filter((_, j) => keep[j]);
    const sum = weights.reduce((acc, w, j) => acc + (keep[j] ? w : 0), 0);
    const nextW = weights.filter((_, j) => keep[j]).map(w => w / sum);
    const theta0 = nextW.slice(0, -1).map(w =>
      Math.log(Math.max(1e-9, w) / Math.max(1e-9, nextW[nextW.length - 1])),
    );
    const r = optimizeSubset(ev, nextIdx, theta0, 0.25, 250);
    indices = r.indices;
    weights = r.weights;
    de = r.de;
  }

  // --- Quantise to practical mixing parts (Golden MXR-style ratios) ---------
  const partsW = new Float64Array(indices.length);
  let partsBest: { parts: number[]; de: number } | null = null;
  const seen = new Set<string>();
  for (let total = 1; total <= 24; total++) {
    const parts = weights.map(w => Math.max(1, Math.round(w * total)));
    const key = parts.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const sum = parts.reduce((a, b) => a + b, 0);
    parts.forEach((p, j) => { partsW[j] = p / sum; });
    const pde = ev.deltaE(indices, partsW);
    const better =
      !partsBest ||
      pde < partsBest.de - 1e-6 ||
      (Math.abs(pde - partsBest.de) <= 1e-6 &&
        sum < partsBest.parts.reduce((a, b) => a + b, 0));
    if (better) partsBest = { parts: parts.slice(), de: pde };
    if (pde <= de + 0.15) break; // good enough and smallest total wins
  }
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const partsG = partsBest!.parts.reduce((a, b) => gcd(a, b));
  const parts = partsBest!.parts.map(p => p / partsG);

  // --- Final evaluation & outputs -------------------------------------------
  ev.mix(indices, Float64Array.from(weights));
  const mixR = Array.from(ev.refl);
  const mixLab = { ...ev.labOfLastMix() };
  const labD65 = reflectanceToLab(mixR, D65_10);
  const labA = reflectanceToLab(mixR, A_10);
  const illuminantShiftDE = deltaE2000(labD65, labA);

  const { r: mr, g: mg, b: mb, clipped } = labToRgb(mixLab.l, mixLab.a, mixLab.b);
  const mixHex =
    '#' + [mr, mg, mb].map(v => v.toString(16).padStart(2, '0')).join('');

  const order = indices
    .map((pi, j) => ({ pi, j }))
    .sort((a, b) => weights[b.j] - weights[a.j]);

  const recipe: RecipeComponent[] = order.map(({ pi, j }) => ({
    pigmentId: pigs[pi].id,
    pigmentName: pigs[pi].name,
    percentage: weights[j] * 100,
    hex: pigs[pi].hex,
  }));
  const partsLabel = order.map(({ j }) => parts[j]).join(' : ');

  const targetSpectral = smoothestMetamer(targetLab);
  const spectralData: SpectralPoint[] = WAVELENGTHS.map((wl, idx) => ({
    wavelength: wl,
    targetReflectance: targetSpectral[idx],
    mixReflectance: mixR[idx],
  }));

  return {
    recipe,
    deltaE: de,
    mixHex,
    mixLab,
    targetLab,
    partsLabel,
    partsDeltaE: partsBest!.de,
    illuminantShiftDE,
    gamutClipped: clipped,
    modelUsed: model,
    explanation:
      `Deterministic search: every ${indices.length <= cap ? `1–${cap}` : ''}-paint ` +
      `subset of the ${pool.length} most relevant pigments was optimised with ` +
      `Nelder–Mead (CIEDE2000 objective, ${ev.evalCount.toLocaleString()} spectral ` +
      `evaluations). Mixing model: ${MODEL_LABELS[model]}; Saunderson ingest ` +
      `k1=${SAUNDERSON_K1}, k2=${SAUNDERSON_K2} on Golden's measured 10 nm ` +
      `reflectance, D65/10° observer.`,
    spectralData,
  };
};
