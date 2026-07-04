// Smoke test for the two-constant K-M engine. Run with: npx tsx scripts/engine-smoke.ts
// Exits non-zero on failure.
import { solvePhysicsRecipe, predictMixture } from "../services/physicsEngine";
import { AVAILABLE_PIGMENTS, PHYSICAL_PIGMENT_DATA, PIGMENT_KS_FIT } from "../constants";

let failures = 0;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!ok) failures++;
};

// Old single-constant prediction (pre-change behaviour) for comparison only.
const singleConstantL = (ids: string[], amounts: number[]): number => {
  const ks = PHYSICAL_PIGMENT_DATA[ids[0]].map((_, w) =>
    ids.reduce((sum, id, i) => sum + amounts[i] * PHYSICAL_PIGMENT_DATA[id][w], 0)
  );
  const refl = ks.map(v => 1 + v - Math.sqrt(v * v + 2 * v));
  // Approximate L* from mean reflectance (good enough for a comparison print)
  const meanR = refl.reduce((a, b) => a + b, 0) / refl.length;
  return 116 * Math.cbrt(meanR) - 16;
};

// 1. Tint strength: with the Saunderson correction a 10% phthalo tint should
//    be at least as strong as the old uncorrected model predicted (gloss
//    stripping reveals higher true film contrast), and clearly a mid blue.
{
  const tint = predictMixture(["pb15", "pw6"], [0.1, 0.9]);
  const oldL = singleConstantL(["pb15", "pw6"], [0.1, 0.9]);
  check(
    "phthalo tint strength",
    tint.lab.l < 55 && tint.lab.b < -15,
    `10% PB15 in white: L*=${tint.lab.l.toFixed(1)} b*=${tint.lab.b.toFixed(1)} (${tint.hex}), old single-constant L*≈${oldL.toFixed(1)}`
  );
}

// 1b. Fitted-data path: inject synthetic two-constant data for PB15 (strong
//     red/green absorber, weak scatterer) and confirm the engine actually
//     uses it in place of the masstone fallback, then restore.
{
  const before = predictMixture(["pb15", "pw6"], [0.1, 0.9]);
  PIGMENT_KS_FIT["pb15"] = {
    k: [1.2, 1.0, 0.8, 0.7, 1.5, 4, 8, 12, 14, 15, 15, 14, 13, 12, 12, 11],
    s: new Array(16).fill(0.05),
  };
  const after = predictMixture(["pb15", "pw6"], [0.1, 0.9]);
  delete PIGMENT_KS_FIT["pb15"];
  check(
    "PIGMENT_KS_FIT takes precedence",
    Math.abs(after.lab.l - before.lab.l) > 2 && after.lab.b < -20,
    `10% PB15 tint: fallback L*=${before.lab.l.toFixed(1)}, with fitted k,s L*=${after.lab.l.toFixed(1)} b*=${after.lab.b.toFixed(1)} (${after.hex})`
  );
}

// 2. Monotonicity: more phthalo -> darker, no oscillation from the S division.
{
  let prevL = Infinity;
  let monotonic = true;
  const Ls: string[] = [];
  for (const c of [0.02, 0.05, 0.1, 0.2, 0.4, 0.7, 1.0]) {
    const { lab } = predictMixture(["pb15", "pw6"], [c, 1 - c]);
    Ls.push(`${(c * 100).toFixed(0)}%:${lab.l.toFixed(1)}`);
    if (lab.l >= prevL) monotonic = false;
    prevL = lab.l;
  }
  check("tint ladder monotonic", monotonic, `L* by PB15 fraction: ${Ls.join(" ")}`);
}

// 3. Pure-white and pure-masstone sanity: predictions stay in gamut & finite.
{
  const white = predictMixture(["pw6"], [1]);
  const black = predictMixture(["pbk7"], [1]);
  // Golden's carbon black masstone measures L* ≈ 26 (gloss included), so the
  // model must reproduce roughly that, not 0.
  check(
    "endpoints sane",
    white.lab.l > 90 && black.lab.l < 30 && white.reflectance.every(r => r > 0 && r <= 1),
    `white L*=${white.lab.l.toFixed(1)}, carbon black L*=${black.lab.l.toFixed(1)}`
  );
}

// 4. Solver round-trip: a colour that IS an achievable mixture should be
//    recovered with small deltaE.
const roundTrip = async () => {
  const targets = [
    { ids: ["pv19", "pw6"], amounts: [0.15, 0.85], label: "quin red tint" },
    { ids: ["pb15", "py3", "pw6"], amounts: [0.1, 0.3, 0.6], label: "phthalo+hansa tint" },
    { ids: ["pbr7_burnt", "pw6"], amounts: [0.5, 0.5], label: "burnt umber mid" },
  ];
  const palette = AVAILABLE_PIGMENTS;
  for (const t of targets) {
    const { hex } = predictMixture(t.ids, t.amounts);
    const result = await solvePhysicsRecipe(hex, palette, 4);
    check(
      `solver round-trip: ${t.label}`,
      result.deltaE < 3,
      `target ${hex} -> deltaE=${result.deltaE.toFixed(2)}, recipe: ${result.recipe
        .map(r => `${r.pigmentName} ${r.percentage.toFixed(0)}%`)
        .join(" + ")}`
    );
  }
};

roundTrip().then(() => {
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
});
