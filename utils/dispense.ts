import { RecipeComponent } from '../types';

// U-100 insulin pen: 1 unit = 10 µL. Manual NovoPens top out at 60 U per push.
export const UNIT_UL = 10;
export const MAX_PUSH_UNITS = 60;

// How the solver's recipe fractions are interpreted. The Golden K/S data comes
// from drawdowns of paint as sold, and whether its concentrations behave as mass
// or volume fractions is an open question (see docs/accuracy-test-plan.md), so
// it is a user setting.
export type RecipeBasis = 'mass' | 'volume';

// Rough densities (mg per 10 µL unit = g/mL × 10) by pigment family, used until
// a paint has been weighed in Phase 0 of the test plan. Estimates only.
const FAMILY_MG_PER_UNIT: [RegExp, number][] = [
  [/^pw6_buff$/, 14],
  [/^pw/, 14.5],                                   // titanium / zinc white
  [/^(py35|pr108|po20)/, 15.5],                   // cadmiums
  [/^(pbk11|py42|pr101|py43|pbr7|pbr_vd)/, 14],   // iron oxides & earths
  [/^(pb28|pb36|pg50|pg17|py53|py184|pb_mang)/, 14], // cobalt, chromium, titanate, bismuth
  [/^pb29/, 12],                                  // ultramarine
  [/^pbk9/, 12],                                  // bone black
];
const DEFAULT_MG_PER_UNIT = 11;                    // organics, carbon black

export const estimatedMgPerUnit = (pigmentId: string): number => {
  for (const [re, mg] of FAMILY_MG_PER_UNIT) if (re.test(pigmentId)) return mg;
  return DEFAULT_MG_PER_UNIT;
};

export interface DispenseRow {
  pigmentId: string;
  pigmentName: string;
  hex: string;
  mgPerUnit: number;
  measured: boolean;
  exactUnits: number;
  units: number;
  expectedMg: number;
  pushes: number[];
  belowMinDose: boolean;
}

export interface DispensePlan {
  rows: DispenseRow[];
  totalUnits: number;
  // Smallest batch that keeps every component at or above the minimum dose.
  minBatchUnits: number;
  // The rounded recipe expressed back in the solver's basis, for re-scoring.
  roundedParts: { pigmentId: string; fraction: number }[];
}

export const splitPushes = (units: number): number[] => {
  const pushes: number[] = [];
  let left = units;
  while (left > 0) {
    const p = Math.min(MAX_PUSH_UNITS, left);
    pushes.push(p);
    left -= p;
  }
  return pushes;
};

// Round to whole units that sum exactly to `total` (largest-remainder method).
export const roundToTotal = (exact: number[], total: number): number[] => {
  const floors = exact.map(Math.floor);
  let remaining = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, rem: v - Math.floor(v) }))
    .sort((a, b) => b.rem - a.rem);
  for (let k = 0; remaining > 0 && k < order.length; k++, remaining--) floors[order[k].i]++;
  return floors;
};

export const planDispense = (
  recipe: RecipeComponent[],
  opts: {
    batchUnits: number;
    basis: RecipeBasis;
    minDoseUnits: number;
    measuredMgPerUnit: Record<string, number>;
  }
): DispensePlan => {
  const mg = recipe.map(c => opts.measuredMgPerUnit[c.pigmentId] ?? estimatedMgPerUnit(c.pigmentId));

  // Recipe fraction → volume fraction (mass basis divides by density).
  const volRaw = recipe.map((c, i) => (opts.basis === 'mass' ? c.percentage / mg[i] : c.percentage));
  const volSum = volRaw.reduce((a, b) => a + b, 0) || 1;
  const volFrac = volRaw.map(v => v / volSum);

  const exactUnits = volFrac.map(f => f * opts.batchUnits);
  const units = roundToTotal(exactUnits, opts.batchUnits);

  const smallest = Math.min(...volFrac.filter(f => f > 0));
  const minBatchUnits = Number.isFinite(smallest) ? Math.ceil(opts.minDoseUnits / smallest) : opts.batchUnits;

  const rows: DispenseRow[] = recipe.map((c, i) => ({
    pigmentId: c.pigmentId,
    pigmentName: c.pigmentName,
    hex: c.hex,
    mgPerUnit: mg[i],
    measured: opts.measuredMgPerUnit[c.pigmentId] !== undefined,
    exactUnits: exactUnits[i],
    units: units[i],
    expectedMg: units[i] * mg[i],
    pushes: splitPushes(units[i]),
    belowMinDose: units[i] < opts.minDoseUnits,
  }));

  // Back to the solver's basis: volume units, or mass (units × density).
  const roundedParts = rows.map(r => ({
    pigmentId: r.pigmentId,
    fraction: opts.basis === 'mass' ? r.units * r.mgPerUnit : r.units,
  }));

  return { rows, totalUnits: units.reduce((a, b) => a + b, 0), minBatchUnits, roundedParts };
};
