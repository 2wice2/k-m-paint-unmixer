# Pen-dispenser mixing accuracy test plan

Goal: find out how far the recipes this app produces are from what you get when
you mix Golden Fluid / High Flow with an insulin pen, split that error into
**dosing error** (the pen) and **model error** (the maths), and collect the data
needed to shrink the model error.

The one rule that makes this work: **weigh every addition.** The pen dispenses
by volume in units; a 0.001 g scale records what actually went in. Nominal
units tell you how good the pen is. Weighed amounts tell you how good the model
is. Without the scale the two errors are mixed together and can't be separated.

---

## 1. Audit: what the app gets wrong today

Checked every file in the repo. All 80 pigments in `AVAILABLE_PIGMENTS` have
K/S data, no orphans, and the 16-point 400–700 nm grid lines up with the
colour-matching tables. The problems are in the model and in what the UI
claims.

### Affects mixing accuracy (what this test measures)

| # | Finding | Where | Effect |
|---|---|---|---|
| A1 | **Titanium White and Zinc White K/S are made up.** The comment says "estimated — not in Golden reflectance dataset". | `constants.ts` (`pw6`, `pw4`) | Every tint, meaning most real mixes, depends on an invented number. |
| A2 | **Strong pigments all have about the same tinting strength.** Measured K/S tops out around 10–12 because the drawdown reflectance was converted without a surface-reflection (Saunderson) correction, so the ~4 % gloss floor caps it. | `constants.ts`, `generate_constants.py` | The model says 10 % in white gives L\* 57 for Phthalo Blue, 57 for Ultramarine and 59 for Carbon Black. In real paint Phthalo is many times stronger than Ultramarine. This is the largest error in the model. |
| A3 | **Single-constant K-M with white acting as a near-zero diluent.** `(K/S)mix = Σ cᵢ(K/S)ᵢ` treats a 50 % tint as half the colourant's K/S. Real tints follow `ΣcᵢKᵢ / ΣcᵢSᵢ`, where white's scattering dominates. | `physicsEngine.ts:39` | Tint ladders come out the wrong shape, not only the wrong level. |
| A4 | **The data is Heavy Body.** Fluid and High Flow load pigment differently per colour. | `constants.ts` | Recipes are directionally right but systematically off, and by a different amount for each pigment. |
| A5 | ✅ **Fixed.** ~~The recipe you see is not the one that was scored.~~ Trace components are now removed, the recipe renormalised and re-scored, and the explanation shows the ΔE before removal. Components under 0.5 % are dropped after solving and the rest are not renormalised. The ΔE shown is for the unfiltered recipe. | `physicsEngine.ts:315` | The components dropped are exactly the tiny additions of strong pigments (Phthalo, Carbon Black) that matter most. |
| A6 | ✅ **Fixed.** ~~"ΔE₀₀" is really ΔE76.~~ The engine now optimises and reports true CIEDE2000, checked against Sharma et al.'s published test pairs. Plain Euclidean Lab distance. | `physicsEngine.ts` `calculateDeltaE`, `RecipeDisplay.tsx` | It overstates errors in saturated colours. Score this test in ΔE00 (the log sheet does that). |
| A7 | **The solver is random with no seed.** The same target can give different recipes on different runs. | `physicsEngine.ts` | Always record the recipe you actually mixed. Never re-run the solver to "look it up" again. |
| A8 | ✅ **Fixed for measured targets.** ~~Targets can only be entered as sRGB hex.~~ An imported reading can now be the target (§9). Hex targets still clip: Cadmium, phthalo and quinacridone colours fall outside sRGB and get clipped. | `ColorPicker.tsx` | For this test, choose targets inside sRGB, or accept that the target has shifted. |
| A9 | **White point bias.** A perfect white (R = 1) maps to Lab (100, 0.65, −0.42), because only Y is normalised on the truncated 20 nm grid. | `physicsEngine.ts` | About 0.8 ΔE of constant bias. Small, but it is the floor. |
| A10 | ✅ **Fixed.** A Pen Dispense Plan panel now shows units, 60 U pushes, expected mg, mg/U overrides, the minimum batch size and the rounded-recipe ΔE00. | `components/DispensePlan.tsx`, `utils/dispense.ts` | See §4. |

### Cosmetic, but misleading

- The header says "Physical Two-Constant Model". It is single-constant (`App.tsx`).
- "METAMERISM INDEX: LOW (MATCH)" is hard-coded text (`App.tsx`).
- The chart's "target" spectrum is a synthetic Gaussian built from RGB
  (`rgbToSpectralApprox`), not a measurement. Ignore its shape.
- The data header says D65/10° observer, but the engine uses the 2° CMFs. This
  only affects the stored swatch hex, not the K/S.

**Expected outcome:** the pen will probably be the smaller error source. A1–A4
will dominate, especially in tints of strong pigments. The data from this plan
is what fixes A1–A4: fit per-pigment K and S against a measured white, then
switch the engine to two-constant K-M.

---

## 2. Equipment

| Item | Why | Notes |
|---|---|---|
| Resin-printed female pen-thread adapter + outlet | Dispensing | Print **three outlet variants** and pick the best in Phase 0: short 1.5 mm nozzle, 18G blunt luer, 22G blunt luer. Post-cure fully and IPA-wash, because uncured resin will contaminate paint. Resin prints a 6 % luer taper well. |
| Resin-printed drawdown bar, 10 mil (254 µm) gap | Repeatable film thickness | Print a two-sided 5 / 10 mil bar if you can. Check the gap with feeler gauges. |
| Resin filling jig | Back-fills cartridges without air | Holds the cartridge vertical, septum-down, while you fill from the plunger end with a 5–10 ml syringe. |
| **0.001 g scale** | The core instrument | 1 U of paint is roughly 11–17 mg. A 0.01 g scale can't resolve a single unit. |
| Leneta 2A opacity charts (black/white) | Substrate | Measure every swatch over **both** black and white. That gives hiding, and it's the standard route to separating K from S. |
| Spectrophotometer: used X-Rite ColorMunki Photo/Design or i1Pro 2 + ArgyllCMS | Measurement | Spectral 400–700 nm readings are needed for **fitting** in Phase 2; Lab for Phases 3–4 is computed from the same spectra. See §9 for getting readings into the app. A phone camera is not good enough. |
| Spare Penfill cartridges | One per colour, plus 3–4 for white | You'll use around 25–30 ml of white in total. |
| Small mixing cups/palette, silicone spatula, timer, water pot | | Park the outlet in water between doses. |

---

## 3. Paints

Calibrate **one line first: Fluid.** It has more pigment, sits closer to the
HB data, and flows easily through 18G. Repeat for High Flow once the method
works. Don't mix lines in one test.

### Core set (8 cartridges)

Chosen so the pigments that are most wrong in the model (A2) come first, and
to span the hue circle with pigments that exist in the dataset.

| Priority | Paint | App id | Why it's in the set |
|---|---|---|---|
| 1 | Titanium White | `pw6` | **The reference.** Currently invented (A1). |
| 1 | Phthalo Blue (Green Shade) | `pb15` | The strongest tinter, so the worst hit by the strength ceiling (A2). |
| 1 | Carbon Black | `pbk7` | A strong tinter. Also used for neutral and greying tests. |
| 2 | Ultramarine Blue | `pb29` | A weak tinter. Compared with Phthalo, this directly measures A2. |
| 2 | Quinacridone Magenta | `pr122` | A transparent cool red. |
| 2 | Pyrrole Red | `pr254` | An opaque warm red. |
| 2 | Hansa Yellow Light / Medium | `py3` / `py73` | Yellows are weak tinters and very sensitive to contamination. |
| 3 | Burnt Sienna or Yellow Oxide | `pr101` / `py42_ox` | An earth for neutral mixes. |

If you own a different product with the **same pigment code**, use it and note
the substitution.

---

## 4. Converting app % to pen units

The **Pen Dispense Plan** panel under the recipe does this (1 U = 10 µL).

- **Batch (U):** 100 U (1 ml) is enough for one 10 mil drawdown on a 2A chart with some spare. Units are rounded so they add up to exactly the batch size (largest-remainder rounding).
- **Min dose (U):** default 5; set it from your Phase 0 result. Doses below it turn amber, and the panel offers the smallest batch that brings every component above it.
- **Pushes:** doses over 60 U are split into pushes, e.g. `60 + 25`.
- **mg/U:** grey values are family estimates. Type in your Phase 0 weighing (mg for 1 U) to replace them. Values are saved in the browser.
- **Recipe % is by mass / volume:** whether the solver's percentages mean mass or volume isn't known yet (A4). In mass mode, density changes the unit split. Log which mode you used for each swatch.
- **ΔE₀₀ rounded:** the recipe re-scored *after* rounding to whole units, next to the ideal. If the two differ by more than about 0.5, raise the batch size.

The solver is still random (A7), so record the recipe shown for each swatch you mix.

## 5. Phases

### Phase 0: dispenser validation (no colour yet)

Do this for each outlet variant, using white and Phthalo Blue (the thickest
and the most staining paint).

1. Back-fill a cartridge with the jig. Tap out bubbles and let it stand 10 min
   tip-up. Prime until paint flows steadily.
2. Dispense **10 × 1 U, 10 × 5 U, 10 × 10 U, 5 × 50 U** onto a tared cup, and
   weigh after each dose.
3. Wait 30 s after the last dose and weigh again. That is the drool.
4. Log each dose in `accuracy-test-log.csv` (`phase = 0`).

**What you get:**

- mg/U for each paint, which is its density. Enter it in the app when A10
  lands.
- Coefficient of variation (CV) at each dose size.
- First-dose lag after priming.
- Drool per dose.

**Pass:** CV ≤ 3 % at 5 U. Here is why 3 %: at a 10 % Phthalo tint, a 5 %
relative dose error on the Phthalo moves L\* by about 0.75, roughly ΔE00 1.
To reach ΔE00 < 1, the minority dose has to hold to about ±3 %. If 5 U
fails, raise the minimum dose to 10 U and double the batch sizes.

Pick the outlet with the lowest CV and acceptable drool. Use it for
everything that follows.

### Phase 1: masstones (8 swatches)

Draw each paint down neat at 10 mil. Let it **dry 48 h**, because acrylics
darken as they dry and wet readings are worthless. Measure 3 spots over white
and 3 over black.

- If over-black and over-white differ by more than 0.5 ΔE00, the film isn't
  opaque. That's expected for Phthalo, Quin Magenta, and most High Flow
  colours. Keep both readings; the fit needs them.
- The Titanium White masstone replaces the invented `pw6` data (A1).

### Phase 2: tint ladders with white (calibration data, ~35 swatches)

Mix each colourant with Titanium White at these fractions (nominal, by units,
100 U batches):

| Level | Colourant : White (U) | Strong tinters (`pb15`, `pbk7`) |
|---|---|---|
| 50 % | 50 : 50 | 20 : 80 |
| 25 % | 25 : 75 | 10 : 90 |
| 10 % | 10 : 90 | 5 : 95 |
| 5 % | 5 : 95 | 5 : 195 (200 U batch) |

For strong tinters, the ladder moves down because their visible change happens
below 10 %. Weigh every addition. Mix for 60 s, scraping the cup walls. Draw
down, dry 48 h, measure over white and over black.

This phase fits, per pigment and wavelength, the pigment's absorption K and
scattering S relative to white (S_white = 1). The masstone plus 4 tint levels
gives an over-determined fit, so you also get a residual that shows how well
two-constant K-M describes each paint. **This fixes A1–A4 for the line you
calibrated.**

Before mixing, run the app on each nominal tint (restrict the palette to those
two paints, max 2) and log its predicted Lab. The gap between prediction and
measurement at this stage is the baseline model error.

### Phase 3: binary colour mixes (validation, not used in the fit, ~16 swatches)

These are held out: they test whether per-pigment parameters **combine**
correctly. Pairs are chosen to stress different failure modes.

| Mix | Ratios (U of 100) | What it tests |
|---|---|---|
| Phthalo Blue + Hansa Yellow | 10:90, 25:75 | Strong + weak. Most sensitive to the strength error (A2). |
| Ultramarine + Burnt Sienna | 50:50, 30:70 | Near-complementary neutral. Tiny errors show as hue casts. |
| Quin Magenta + Hansa Yellow | 30:70, 60:40 | Transparent + opaque. Tests scattering. |
| Pyrrole Red + Ultramarine | 50:50, 25:75 | Opaque + weak. Violets are hard for single-constant models. |
| Phthalo Blue + Carbon Black | 50:50 | Two strong tinters. |
| Each of the 5 above **+ white** | the 50:50-ish ratio, then 1 part mix : 3 parts white | Three-component. The white interaction is what the real recipes will use. |

Predict each mix with the current app, and later with the fitted model.

### Phase 4: blind recipe test (the real-world check, 10 targets)

Choose 10 targets that sit **inside sRGB** (A8). Measure a physical sample of
each where possible (a paint chip, a fabric swatch), and use that measured Lab
as the truth. Otherwise use the hex.

| Target | Why |
|---|---|
| Light skin tone | Warm tint, very visible errors |
| Sky blue | Phthalo or Ultramarine tint, the core A2 test |
| Sap / olive green | Complementary greying |
| Dusty rose | Magenta + white + neutraliser |
| Slate / blue grey | Neutral, hue-cast sensitive |
| Warm grey | Neutral |
| Pale ochre / cream | Weak-tinter tint |
| Mid violet | Hard for single-constant models |
| Deep teal | Dark, strong-tinter dominated |
| Brick / terracotta | Earth + red |

For each target:

1. Solve with the app, palette = your core set, max pigments = 3.
2. **Record the recipe** (A7). Once the swatch is measured, **Copy log rows** in the Measured Swatch section captures the recipe, units, prediction and measurement together.
3. Dispense a 100 U batch (200 U if any component is under 5 U). Weigh every
   addition.
4. Dry for 48 h, then measure.
5. Log the result.

Run Phase 4 **before** recalibrating (baseline), then again **after** updating
the K/S data (improvement). Use the same targets and palette.

---

## 6. Controls

- **Repeats:** mix 3 of the Phase 2 swatches twice, from separate
  dispenses. The spread between repeats is your noise floor. Don't chase
  model errors smaller than that.
- **Swatch repeatability:** measure one dry swatch 5 times, lifting the
  instrument between readings. That's the instrument floor.
- **Same conditions:** same drawdown bar, same chart batch, same drying time,
  same measuring position. Keep drawdowns off the edge of the card.
- **Cartridge age:** log the fill date. Re-weigh a 10 U dose weekly. Heavy
  pigments (the whites and cadmiums) can settle in a cartridge. Roll the pen
  before use.

---

## 7. Analysis (what happens with the data)

1. **Dosing error:** nominal units vs weighed mass → per paint, per dose size.
2. **Density:** mg/U per paint → the app's volume ↔ mass conversion.
3. **Model error, current:** Phases 2–4 predicted Lab vs measured, in ΔE00.
   Computed from the **weighed** fractions, so pen error is excluded.
4. **Fit:** per pigment K(λ), S(λ) relative to measured Titanium White, from
   Phases 1–2. Try both mass and volume fractions and keep the one with the
   lower residual.
5. **Validation:** the fitted two-constant model predicts Phases 3 and 4. If
   Phase 3 ΔE00 falls well below the current model's, switch the engine over.
6. **Repeat for High Flow** using the same method. You'll need its own white
   and its own strength factors.

Success looks like this: Phase 4 median ΔE00 below 2, and the pen accounting
for less than a third of the total error.

---

## 8. Paint and time budget (Fluid, core set)

| Phase | Swatches | Approx. paint | Days |
|---|---|---|---|
| 0 | none (weighed doses) | ~3 ml per outlet variant | 1 |
| 1 | 8 | 8 ml | 1 + 2 drying |
| 2 | ~30 | ~30 ml, about 25 ml of it white | 2 + 2 drying |
| 3 | ~15 | ~15 ml | 1 + 2 drying |
| 4 | 10 (×2 runs) | ~20 ml | 1 + 2 drying, then again after the update |

About 2 weeks of wall-clock time, mostly spent drying. Phases 1 and 2 can
share a drying window.

---

## 9. Getting measurements into the app (ArgyllCMS)

The **Measurements** panel (left column) imports reflectance spectra and
resamples them to the solver's 400–700 nm / 20 nm grid. Lab is always
recomputed from the spectrum under **D65 / 2°**, the same maths the solver
uses. ArgyllCMS prints **D50** Lab by default. Run spotread with `-i D65` so its
printed Lab uses the same illuminant as the app (the default observer, 1931 2°,
already matches). Small differences can remain, because the app integrates on a
coarser 20 nm grid. The spectrum is what the app uses.

**Accepted input** (files or pasted text):

| Source | How |
|---|---|
| **`spotread -s -i D65 swatches.txt` log file (recommended)** | spotread appends every reading to `swatches.txt` as a tab-separated row: `Reading X Y Z L* a* b* 380.000 … 730.000`. Import the file. Rows are labelled `reading 1`, `reading 2`, and so on, in the order taken, so keep a paper list of which reading was which spot. |
| `spotread -s` console output | Copy one or more readings from the terminal and paste them into the box. The importer reads each `Spectrum from 380.000 to 730.000 nm in 36 steps` line and the comma-separated values that follow it. |
| CGATS files: `.ti3` from `chartread`, `.sp`, i1Profiler / ColorPort exports | Import the file. Spectral columns named `SPEC_380`…`SPEC_730` (or `SPECTRAL_`, `R_`, `nm`) are read, scaled by `SPECTRAL_NORM` when present. Rows are labelled by `SAMPLE_NAME`, `SAMPLE_LOC` or `SAMPLE_ID`. |
| CSV / TSV | A header row of wavelengths (`name,400,410,…,700`), one reading per row. |

Readings must cover 400–700 nm. spotread data is always in percent: the ColorMunki and i1Pro drivers report reflectance on a 0–100 scale, so it is divided by 100 unconditionally. For other files, percent or 0–1 is taken from `SPECTRAL_NORM` if present, and otherwise detected per file.

**Workflow per swatch:**

1. Start `spotread -s -i D65 swatches.txt` with the ColorMunki dial on calibrate. Let it calibrate, then turn the dial to measure. Use one log file per session.
2. Take 3 readings over the white half and 3 over the black half, through a
   positioning template.
3. Paste or import them. Tick the three over-white readings, then **Mix / white**
   (they are averaged). Do the same for the over-black readings with **Mix / black**.
4. The **Measured Swatch** section under the dispense plan now shows:
   - **Model ΔE₀₀**: measured vs the app's prediction for the rounded recipe.
   - **Target ΔE₀₀**: measured vs the target.
   - **Hiding ΔE₀₀**: over-white vs over-black. Above 0.5, the film is not opaque.
5. Fill in phase and swatch ID, then **Copy log rows** (or **Download .csv**) and
   paste the rows into `accuracy-test-log.csv`. Add `weighed_mg`,
   `cartridge_fill_date` and `dry_hours` by hand.

**Measured targets (Phase 4):** measure the physical target the same way, tick
its readings and press **Target**. The solver then aims at the measured Lab
instead of an sRGB hex, which avoids sRGB clipping (A8). The chart shows the
real target spectrum instead of the synthetic one.

Keep the raw ArgyllCMS files. The Phase 2 K/S fit will use the full spectra, not
the Lab values.

