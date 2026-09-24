import { Pigment, UnmixResult, RecipeComponent, SpectralPoint, LabColor } from "../types";
import { PHYSICAL_PIGMENT_DATA, WAVELENGTHS } from "../constants";
import { labToRgb, rgbToHex, rgbToLab } from "../utils/colorUtils";

// --- Math Helpers & Optimization Tables ---

// CIE 1931 2-degree Observer colour-matching functions, pre-weighted by the
// D65 illuminant SPD at 400–700 nm / 20 nm. Weighting the CMFs by the
// illuminant is required so that a perfectly reflective sample (R=1) maps to
// the D65 reference white used in the XYZ→Lab step.
const CIE_CMF_RAW = [
  { x: 0.014, y: 0.000, z: 0.067 }, { x: 0.134, y: 0.004, z: 0.645 }, { x: 0.348, y: 0.023, z: 1.747 },
  { x: 0.290, y: 0.060, z: 1.669 }, { x: 0.095, y: 0.139, z: 0.812 }, { x: 0.004, y: 0.323, z: 0.272 },
  { x: 0.063, y: 0.710, z: 0.078 }, { x: 0.290, y: 0.954, z: 0.020 }, { x: 0.594, y: 0.995, z: 0.003 },
  { x: 0.916, y: 0.870, z: 0.001 }, { x: 1.062, y: 0.631, z: 0.000 }, { x: 0.854, y: 0.381, z: 0.000 },
  { x: 0.447, y: 0.175, z: 0.000 }, { x: 0.164, y: 0.061, z: 0.000 }, { x: 0.046, y: 0.017, z: 0.000 },
  { x: 0.011, y: 0.004, z: 0.000 },
];

const D65_SPD = [
  82.75, 93.43, 104.86, 117.81, 115.92, 109.35, 104.79, 104.41,
  100.00, 95.79, 90.01, 87.70, 83.70, 80.21, 78.28, 71.61,
];

const CIE_CMF_DATA = CIE_CMF_RAW.map((cmf, i) => ({
  x: cmf.x * D65_SPD[i],
  y: cmf.y * D65_SPD[i],
  z: cmf.z * D65_SPD[i],
}));

const SUM_Y_WEIGHTS = CIE_CMF_DATA.reduce((sum, cmf) => sum + cmf.y, 0);
const NORMALIZATION_K = 100 / (SUM_Y_WEIGHTS || 1);

const ksToReflectance = (KS: number): number => {
  if (KS > 500) return 0; // Avoid NaN
  return 1 + KS - Math.sqrt(Math.pow(KS, 2) + (2 * KS));
};

// Single-constant Kubelka–Munk mixing: (K/S)_mix = Σ c_i · (K/S)_i.
// Valid because all pigments were measured as 10-mil drawdowns over the same
// white substrate, so each K/S already embeds that pigment's own scattering.
const calculateMixKS = (amounts: number[], pigmentKS: number[][]): number[] => {
  const mixKS: number[] = new Array(pigmentKS[0].length).fill(0);
  for (let w = 0; w < mixKS.length; w++) {
    let sum = 0;
    for (let i = 0; i < amounts.length; i++) {
      sum += amounts[i] * pigmentKS[i][w];
    }
    mixKS[w] = sum;
  }
  return mixKS;
};

const CAP_THRESHOLD = 1e-4;

// Project a composition onto the feasible set "at most `cap` non-zero
// pigments": repeatedly drop the smallest non-zero entry, then renormalize
// so amounts still sum to 1.
const enforceCap = (amounts: number[], cap: number): number[] => {
  const result = [...amounts];
  let nonZero = result.reduce((n, a) => n + (a > CAP_THRESHOLD ? 1 : 0), 0);
  while (nonZero > cap) {
    let minIdx = -1;
    let minVal = Infinity;
    for (let i = 0; i < result.length; i++) {
      if (result[i] > CAP_THRESHOLD && result[i] < minVal) {
        minVal = result[i];
        minIdx = i;
      }
    }
    if (minIdx === -1) break;
    result[minIdx] = 0;
    nonZero--;
  }
  const sum = result.reduce((a, b) => a + b, 0);
  if (sum > 0) for (let i = 0; i < result.length; i++) result[i] /= sum;
  return result;
};

// Optimized RGB to Spectral approximation
// Uses a "Long Pass" simulation for Red to better match real pigment physics
const rgbToSpectralApprox = (r: number, g: number, b: number): number[] => {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;

  return WAVELENGTHS.map(wl => {
    // Blue: Gaussian centered ~455nm
    const bContrib = B * Math.exp(-Math.pow(wl - 455, 2) / 2000); 
    
    // Green: Gaussian centered ~540nm
    const gContrib = G * Math.exp(-Math.pow(wl - 540, 2) / 2000); 
    
    // Red: Sigmoidal / Long-pass behavior
    // Real red pigments don't drop off at 700nm. They stay high.
    // We simulate this with a logistic function centered at 600nm.
    // However, we also need to support "Purple" (Red + Blue).
    // So we combine a Gaussian (for mixed reds) with a floor for pure red?
    // Let's stick to a wider Gaussian that is shifted right, but ensure it doesn't drop too fast.
    
    // Improved Red: Centered at 620, but wide.
    // Using a "Flat Top" gaussian for Red if wl > 600
    let rContrib = 0;
    if (wl < 600) {
       rContrib = R * Math.exp(-Math.pow(wl - 600, 2) / 1500);
    } else {
       // Plateau from 600 to 700 for red
       rContrib = R * Math.exp(-Math.pow(wl - 600, 2) / 10000); // Very slow decay
    }
    
    let ref = 0.01 + (bContrib + gContrib + rContrib) * 0.98;
    return Math.min(0.99, Math.max(0.01, ref));
  });
};

// Reflectance on the WAVELENGTHS grid → CIELAB (D65, 2°), same pipeline the
// solver uses, so measured and predicted colours are directly comparable.
export const spectralToLab = (reflectance: number[]): LabColor => {
  let X = 0, Y = 0, Z = 0;
  
  for (let i = 0; i < reflectance.length; i++) {
    const r = reflectance[i];
    const cmf = CIE_CMF_DATA[i];
    X += r * cmf.x;
    Y += r * cmf.y;
    Z += r * cmf.z;
  }

  X = X * NORMALIZATION_K;
  Y = Y * NORMALIZATION_K;
  Z = Z * NORMALIZATION_K;

  const Xn = 95.047, Yn = 100.0, Zn = 108.883;
  const f = (t: number) => t > 0.008856 ? Math.pow(t, 1/3) : (7.787 * t) + 16/116;
  
  const L = 116 * f(Y / Yn) - 16;
  const a = 500 * (f(X / Xn) - f(Y / Yn));
  const b = 200 * (f(Y / Yn) - f(Z / Zn));
  
  return { l: L, a, b };
};

// CIEDE2000 colour difference (Sharma, Wu & Dalal 2005), kL = kC = kH = 1.
export const deltaE2000 = (lab1: LabColor, lab2: LabColor): number => {
  const deg = Math.PI / 180;
  const { l: L1, a: a1, b: b1 } = lab1;
  const { l: L2, a: a2, b: b2 } = lab2;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar7 = Math.pow((C1 + C2) / 2, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hueAngle = (b: number, ap: number) => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) / deg;
    return h >= 0 ? h : h + 360;
  };
  const h1p = hueAngle(b1, a1p);
  const h2p = hueAngle(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * deg);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }

  const T = 1
    - 0.17 * Math.cos((hbarp - 30) * deg)
    + 0.24 * Math.cos(2 * hbarp * deg)
    + 0.32 * Math.cos((3 * hbarp + 6) * deg)
    - 0.20 * Math.cos((4 * hbarp - 63) * deg);
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(2 * dTheta * deg) * RC;

  const tL = dLp / SL;
  const tC = dCp / SC;
  const tH = dHp / SH;
  return Math.sqrt(tL * tL + tC * tC + tH * tH + RT * tC * tH);
};

const mixReflectance = (amounts: number[], pigmentKS: number[][]): number[] =>
  calculateMixKS(amounts, pigmentKS).map(ks => ksToReflectance(ks));

const hexToRgbTriple = (hex: string) => ({
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
});

// Components below this fraction are removed from the final recipe (they are
// not practically dispensable); the survivors are renormalized and the recipe
// is re-scored so the reported ΔE matches what is shown.
const MIN_RECIPE_FRACTION = 0.005;

export interface RecipeEvaluation {
  deltaE: number;
  mixHex: string;
  lab: LabColor;
}

// Score an arbitrary recipe (fractions need not sum to 1) against a target.
// Used to re-check a recipe after it has been rounded to dispensable units.
export const evaluateRecipe = (
  targetLab: LabColor,
  parts: { pigmentId: string; fraction: number }[]
): RecipeEvaluation | null => {
  const valid = parts.filter(p => p.fraction > 0 && PHYSICAL_PIGMENT_DATA[p.pigmentId]);
  const total = valid.reduce((s, p) => s + p.fraction, 0);
  if (total <= 0) return null;
  const amounts = valid.map(p => p.fraction / total);
  const ks = valid.map(p => PHYSICAL_PIGMENT_DATA[p.pigmentId]);
  const lab = spectralToLab(mixReflectance(amounts, ks));
  const mixRgb = labToRgb(lab.l, lab.a, lab.b);
  return { deltaE: deltaE2000(targetLab, lab), lab, mixHex: rgbToHex(mixRgb.r, mixRgb.g, mixRgb.b) };
};

// --- Main Solver ---

export const solvePhysicsRecipe = async (
  targetHex: string,
  palette: Pigment[],
  maxPigments?: number,
  // A measured target (e.g. an imported spectrophotometer reading). When
  // given, its Lab is the optimization target and its spectrum is charted,
  // bypassing the sRGB hex (which clips many paint colours).
  measuredTarget?: { lab: LabColor; reflectance: number[] }
): Promise<UnmixResult> => {
  // 1. Reconstruct Target Spectrum
  const rgb = hexToRgbTriple(targetHex);
  // Target spectrum is kept only for the reference line on the chart; the
  // solver optimizes against the target's true sRGB→Lab value directly.
  const targetSpectral = measuredTarget?.reflectance ?? rgbToSpectralApprox(rgb.r, rgb.g, rgb.b);
  const targetLab = measuredTarget?.lab ?? rgbToLab(rgb.r, rgb.g, rgb.b);

  // 2. Prepare Palette Data
  const activeKS: number[][] = [];
  const activeIds: string[] = [];
  const activePigments: Pigment[] = [];
  
  palette.forEach(p => {
    if (PHYSICAL_PIGMENT_DATA[p.id]) {
      activeKS.push(PHYSICAL_PIGMENT_DATA[p.id]);
      activeIds.push(p.id);
      activePigments.push(p);
    }
  });

  if (activeKS.length === 0) throw new Error("No physical data for selected pigments.");

  const cap = Math.max(1, Math.min(maxPigments ?? activeIds.length, activeIds.length));

  // 3. SMART INITIALIZATION (The Fix)
  // Instead of guessing 50% white, let's find the best starting point.
  // We check 100% of each pigment, and (if White exists) 50/50 tints.
  
  let bestAmounts = new Array(activeIds.length).fill(0);
  let bestError = 99999;
  
  const whiteIdx = activeIds.findIndex(id => id === 'pw6' || id === 'pw4');

  // Helper to test a composition
  const evaluate = (amounts: number[]) => {
    return deltaE2000(targetLab, spectralToLab(mixReflectance(amounts, activeKS)));
  };

  // Test 1: Pure Pigments
  for (let i = 0; i < activeIds.length; i++) {
    const amounts = new Array(activeIds.length).fill(0);
    amounts[i] = 1;
    const err = evaluate(amounts);
    if (err < bestError) {
      bestError = err;
      bestAmounts = [...amounts];
    }
  }

  // Test 2: 50/50 with White (if exists) — needs cap >= 2
  if (whiteIdx !== -1 && cap >= 2) {
    for (let i = 0; i < activeIds.length; i++) {
      if (i === whiteIdx) continue;
      const amounts = new Array(activeIds.length).fill(0);
      amounts[whiteIdx] = 0.5;
      amounts[i] = 0.5;
      const err = evaluate(amounts);
      if (err < bestError) {
        bestError = err;
        bestAmounts = [...amounts];
      }
    }
  }

  // Test 3: Equal Mix (Fallback) — capped to the max pigment count
  const equalRaw = new Array(activeIds.length).fill(1 / activeIds.length);
  const equalAmounts = enforceCap(equalRaw, cap);
  const equalErr = evaluate(equalAmounts);
  if (equalErr < bestError) {
    bestError = equalErr;
    bestAmounts = equalAmounts;
  }

  // 4. Optimization (Hill Climbing with Momentum-ish behavior)
  const ITERATIONS = 3000;
  const YIELD_INTERVAL = 300;
  
  // We run the loop starting from our "Smart Best"
  let currentAmounts = [...bestAmounts];
  
  for (let i = 0; i < ITERATIONS; i++) {
    if (i % YIELD_INTERVAL === 0) await new Promise(resolve => setTimeout(resolve, 0));

    // Adaptive Mutation
    const progress = i / ITERATIONS;
    // Decay mutation size over time
    const stepSize = Math.max(0.002, 0.15 * (1 - progress));

    const candidateAmounts = [...currentAmounts];

    // When the cap is tight, occasional swap mutations let the search replace
    // an in-use pigment with an unused one (plain perturbation can't, because
    // enforceCap would drop the new pigment back to zero).
    const useSwap = cap < activeIds.length && Math.random() < 0.15;
    if (useSwap) {
      const active: number[] = [];
      const inactive: number[] = [];
      for (let k = 0; k < candidateAmounts.length; k++) {
        if (candidateAmounts[k] > CAP_THRESHOLD) active.push(k);
        else inactive.push(k);
      }
      if (active.length > 0 && inactive.length > 0) {
        const outIdx = active[Math.floor(Math.random() * active.length)];
        const inIdx = inactive[Math.floor(Math.random() * inactive.length)];
        candidateAmounts[inIdx] = candidateAmounts[outIdx];
        candidateAmounts[outIdx] = 0;
      }
    } else {
      const mutationIdx = Math.floor(Math.random() * activeIds.length);
      const mutationAmount = (Math.random() - 0.5) * stepSize;
      candidateAmounts[mutationIdx] = Math.max(0, candidateAmounts[mutationIdx] + mutationAmount);
    }

    // Normalize
    const sum = candidateAmounts.reduce((a, b) => a + b, 0);
    if (sum === 0) continue;
    for(let k=0; k<candidateAmounts.length; k++) candidateAmounts[k] /= sum;

    // Enforce paint count cap
    const capped = cap < activeIds.length ? enforceCap(candidateAmounts, cap) : candidateAmounts;
    for (let k = 0; k < candidateAmounts.length; k++) candidateAmounts[k] = capped[k];

    // Evaluate
    const error = evaluate(candidateAmounts);

    // Greedy Step (Accept if better)
    // Optional: Add simulated annealing probability here if needed, but for simple unmixing greedy is usually fine if initialization is good.
    if (error < bestError) {
      bestError = error;
      bestAmounts = candidateAmounts;
      currentAmounts = candidateAmounts; // Move to new state
    } else {
        // Occasional random jump to escape local minima if stuck for too long? 
        // Not implemented to keep it fast, relying on Smart Init.
    }
  }

  // 5. Finalize Results
  // Drop trace components, renormalize, and re-score so the reported ΔE,
  // mix swatch and spectrum all describe the recipe exactly as displayed.
  const prunedCount = bestAmounts.filter(a => a > 0 && a < MIN_RECIPE_FRACTION).length;
  const finalAmounts = bestAmounts.map(a => (a >= MIN_RECIPE_FRACTION ? a : 0));
  const finalSum = finalAmounts.reduce((a, b) => a + b, 0);
  for (let k = 0; k < finalAmounts.length; k++) finalAmounts[k] /= finalSum;

  const recipe: RecipeComponent[] = finalAmounts
    .map((amt, idx) => {
      const p = activePigments[idx];
      return {
        pigmentId: activeIds[idx],
        pigmentName: p?.name || 'Unknown',
        percentage: amt * 100,
        hex: p?.hex || '#000'
      };
    })
    .filter(r => r.percentage > 0)
    .sort((a, b) => b.percentage - a.percentage);

  const finalR = mixReflectance(finalAmounts, activeKS);
  const finalLab = spectralToLab(finalR);
  const finalError = deltaE2000(targetLab, finalLab);

  const spectralData: SpectralPoint[] = WAVELENGTHS.map((wl, idx) => ({
    wavelength: wl,
    targetReflectance: targetSpectral[idx],
    mixReflectance: finalR[idx]
  }));

  const bestRgb = labToRgb(finalLab.l, finalLab.a, finalLab.b);
  const mixHex = rgbToHex(bestRgb.r, bestRgb.g, bestRgb.b);

  const pruneNote = prunedCount > 0
    ? ` ${prunedCount} trace component${prunedCount > 1 ? 's' : ''} under ${MIN_RECIPE_FRACTION * 100}% removed; ΔE is for the recipe as shown (${bestError.toFixed(2)} before removal).`
    : '';

  return {
    recipe,
    deltaE: finalError,
    mixHex,
    targetLab,
    explanation: `Solved via Stochastic Hill Climbing with Smart Initialization, minimizing CIEDE2000.${pruneNote}`,
    spectralData
  };
};
