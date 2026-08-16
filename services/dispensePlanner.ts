import { RecipeComponent } from '../types';

// ---------------------------------------------------------------------------
// Insulin-pen dispensing planner.
//
// A U-100 pen delivers exactly 10 µL per unit; a 3 ml Penfill cartridge holds
// 300 units and a NovoPen doses up to 60 units per stroke. The pen is a
// VOLUMETRIC dispenser — and the solver's recipe weights are volume fractions
// of wet paint: Kubelka–Munk K and S are per-unit-path-length coefficients, so
// a blended film obeys K_mix = Σ φᵢKᵢ with φᵢ the volume share each paint
// contributes to the film. Units therefore map onto recipe weights directly;
// no density conversion enters the dose math.
//
// Densities appear for the OTHER direction: predicted grams per component so a
// dispense can be verified on a scale (dispense 100 U = 1.00 ml, weigh, enter
// the measured g/ml as an override). Wet-paint densities are estimated from
// Golden's published dry-pigment specific gravities plus a loading assumption,
// and are deliberately rough until overridden by measurement.
//
// Strength factors handle paint lines whose pigment load differs from the
// Heavy Body drawdowns behind the K/S data. Golden states Fluid carries the
// same pigment load as Heavy Body, so Fluid strengths stay 1.0. High Flow uses
// different binders and loads; per-pigment factors are unknown until
// calibrated. A strength factor only matters when it DIFFERS between the
// paints in a recipe — a uniform factor cancels in normalisation, which is why
// there is no line-level strength setting.
// ---------------------------------------------------------------------------

export const PEN_UNIT_UL = 10; // U-100: one unit = 10 µL, exact
export const CARTRIDGE_UNITS = 300; // 3 ml Penfill
export const MAX_STROKE_UNITS = 60; // NovoPen 4/6 single-stroke cap

export type PaintLine = 'fluid' | 'highflow';

// Dry-pigment specific gravity from Golden's published chart
// ("Pigment Density — GOLDEN Artist Colors", updated 2019-04-17,
// goldenartistcolors.com). Hues/mixes and pigments absent from the chart are
// estimated from their pigment family and flagged in SG_ESTIMATED. Where the
// app's CI code differs from the chart row (e.g. Pyrrole Red Light is PR255 on
// the chart), the value is matched by paint name.
export const PIGMENT_SG: Record<string, number> = {
  // whites
  pw6: 3.9, pw4: 5.6, pw6_buff: 4.1,
  // blacks & neutrals
  pbk9: 2.52, pbk7: 1.8, pbk11: 4.6, pg_mix: 2.4,
  // earths
  pbr7_raw: 4.42, pbr7_burnt: 2.5, pbr7_burnt_lt: 3.35, pbr7_sienna: 3.51,
  pr101: 3.1, py43: 3.5, py42: 4.19, py42_ox: 4.1, pr101_ox: 5.0,
  pr101_vio: 5.0, pbr7_trans: 3.8, pr101_trans: 3.9, py42_trans: 3.7,
  pbr_vd: 3.0,
  // yellows
  py3: 1.3, py73: 1.48, py35_lt: 4.6, py35: 4.6, py35_dk: 4.6,
  py35_prim: 4.6, py184: 6.11, py83: 1.27, py53: 4.5, py150: 1.77,
  py129: 1.5,
  // oranges
  po20: 5.32, po73: 1.55, po73_trans: 1.55, py_indian: 1.5,
  // reds
  pr254: 1.55, pr254_lt: 1.42, pr254_dk: 1.45, pr108_lt: 5.4, pr108: 5.17,
  pr108_dk: 5.03, pr112: 1.41, pr112_med: 1.69, pv19: 1.9, pv19_lt: 1.4,
  pr122: 1.45, pr177: 1.45, pr206: 1.55, po49: 1.52, py150_qn: 1.5,
  pr179: 1.5,
  // violets
  pv23: 1.44, pv23_dk: 1.44, pv19_vio: 1.53,
  // blues
  pb29: 2.35, pb15: 1.62, pb15_rs: 1.62, pb28: 4.3, pb36: 4.2,
  pb36_deep: 4.7, pb60: 1.51, pb27: 1.6, pb_azurite: 2.0, pb_mang: 2.0,
  pb_turq: 1.8,
  // greens
  pg7: 2.05, pg36: 1.53, pg17: 5.1, pg17_dk: 5.1, pg50: 5.1,
  pg50_teal: 3.8, pg50_titan: 4.5, pg50_turq: 4.8, pg7_lt: 1.8, pg18: 2.0,
  pg_sap: 1.8, pg_hook: 1.8, pg_jenk: 1.8, pg_terre: 2.5,
};

/** Ids whose SG is a family estimate, not a Golden chart row. */
export const SG_ESTIMATED = new Set<string>([
  'pg_mix', 'pbr7_trans', 'pbr_vd', 'py129', 'py_indian', 'pr177', 'pr179',
  'pb27', 'pb_azurite', 'pb_mang', 'pb_turq', 'pg50_titan', 'pg7_lt', 'pg18',
  'pg_sap', 'pg_hook', 'pg_jenk', 'pg_terre',
]);

const BINDER_DENSITY = 1.03; // wet acrylic emulsion, g/ml

// Assumed pigment volume fraction by pigment class (via dry SG), scaled per
// line: High Flow carries visibly less solids than Fluid.
const phiForSG = (sg: number): number => (sg >= 3.5 ? 0.22 : sg >= 2.1 ? 0.15 : 0.08);
const LINE_PHI_SCALE: Record<PaintLine, number> = { fluid: 1.0, highflow: 0.6 };

export interface DispenseCalibration {
  /** Measured wet-paint density, g/ml (dispense 100 U = 1.00 ml and weigh). */
  density?: Record<string, number>;
  /** Tinting strength relative to the Heavy Body data, per pigment. */
  strength?: Record<string, number>;
}

/** Estimated wet-paint density (g/ml) unless a measured override exists. */
export const paintDensity = (
  pigmentId: string,
  line: PaintLine,
  cal?: DispenseCalibration,
): { density: number; estimated: boolean } => {
  const override = cal?.density?.[pigmentId];
  if (override && override > 0) return { density: override, estimated: false };
  const sg = PIGMENT_SG[pigmentId] ?? 2.0;
  const phi = phiForSG(sg) * LINE_PHI_SCALE[line];
  return { density: BINDER_DENSITY * (1 - phi) + sg * phi, estimated: true };
};

/**
 * Largest-remainder apportionment of `total` integer units over `shares`
 * (non-negative, any scale). Deterministic: remainder ties break toward the
 * larger share, then the lower index. Result sums to `total` exactly.
 */
export const largestRemainder = (shares: number[], total: number): number[] => {
  const sum = shares.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (sum <= 0 || total <= 0) return shares.map(() => 0);
  const exact = shares.map(s => (s > 0 ? (s / sum) * total : 0));
  const units = exact.map(Math.floor);
  let left = total - units.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e), share: shares[i] }))
    .sort((a, b) => b.frac - a.frac || b.share - a.share || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) units[order[k].i]++;
  return units;
};

export interface DispenseComponent {
  pigmentId: string;
  pigmentName: string;
  hex: string;
  units: number;
  ml: number;
  volumePct: number; // strength-adjusted volume share, 0–100
  grams: number; // predicted mass of the dispensed units
  densityUsed: number; // g/ml behind `grams`
  densityEstimated: boolean;
  belowOneUnit: boolean; // wanted but rounds to zero at this batch size
}

export interface DispensePlan {
  components: DispenseComponent[];
  batchUnits: number;
  totalMl: number;
  totalGrams: number;
  strokes: number; // pen strokes at MAX_STROKE_UNITS per stroke
  /**
   * Rounded recipe converted back to solver-space weights (strength applied,
   * normalised) — feed to the forward model for the achievable ΔE00.
   */
  achievedWeights: { pigmentId: string; weight: number }[];
  /** Smallest batch giving every component ≥ 1 unit; null if > CARTRIDGE_UNITS. */
  minBatchUnits: number | null;
  anyBelowOne: boolean;
  anyDensityEstimated: boolean;
  anyStrengthOverride: boolean;
}

const strengthOf = (id: string, cal?: DispenseCalibration): number => {
  const f = cal?.strength?.[id];
  return f && f > 0 ? f : 1;
};

export const planDispense = (
  recipe: RecipeComponent[],
  batchUnits: number,
  line: PaintLine,
  cal?: DispenseCalibration,
): DispensePlan => {
  const batch = Math.max(1, Math.min(CARTRIDGE_UNITS, Math.round(batchUnits)));

  // Solver weights are volume fractions of Heavy-Body-strength paint. A paint
  // delivering f× the strength per volume needs 1/f the volume share.
  const volShares = recipe.map(c => (c.percentage / 100) / strengthOf(c.pigmentId, cal));
  const volSum = volShares.reduce((a, b) => a + b, 0) || 1;

  const units = largestRemainder(volShares, batch);

  const components: DispenseComponent[] = recipe.map((c, i) => {
    const { density, estimated } = paintDensity(c.pigmentId, line, cal);
    const ml = (units[i] * PEN_UNIT_UL) / 1000;
    return {
      pigmentId: c.pigmentId,
      pigmentName: c.pigmentName,
      hex: c.hex,
      units: units[i],
      ml,
      volumePct: (volShares[i] / volSum) * 100,
      grams: ml * density,
      densityUsed: density,
      densityEstimated: estimated,
      belowOneUnit: volShares[i] > 0 && units[i] === 0,
    };
  });

  // Back-conversion: dispensed volume × strength → Heavy-Body-equivalent
  // optical weight, for re-evaluating the rounded recipe's true colour.
  const eqRaw = recipe.map((c, i) => units[i] * strengthOf(c.pigmentId, cal));
  const eqSum = eqRaw.reduce((a, b) => a + b, 0) || 1;
  const achievedWeights = recipe
    .map((c, i) => ({ pigmentId: c.pigmentId, weight: eqRaw[i] / eqSum }))
    .filter(w => w.weight > 0);

  let minBatchUnits: number | null = null;
  const wanted = volShares.filter(v => v > 0).length;
  for (let n = wanted; n <= CARTRIDGE_UNITS; n++) {
    const u = largestRemainder(volShares, n);
    if (volShares.every((v, i) => v <= 0 || u[i] >= 1)) {
      minBatchUnits = n;
      break;
    }
  }

  return {
    components,
    batchUnits: batch,
    totalMl: (batch * PEN_UNIT_UL) / 1000,
    totalGrams: components.reduce((a, c) => a + c.grams, 0),
    strokes: Math.ceil(batch / MAX_STROKE_UNITS),
    achievedWeights,
    minBatchUnits,
    anyBelowOne: components.some(c => c.belowOneUnit),
    anyDensityEstimated: components.some(c => c.units > 0 && c.densityEstimated),
    anyStrengthOverride: recipe.some(c => strengthOf(c.pigmentId, cal) !== 1),
  };
};
