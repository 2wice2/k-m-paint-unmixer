# K-M Paint Unmixer

A Kubelka–Munk spectral recipe solver for Golden Heavy Body acrylic paints.
Enter any target sRGB colour (hex, eyedropper, uploaded image) and the solver
returns a pigment mixture that reproduces it, honouring a user-chosen cap on
how many paints may appear in the recipe.

## How it works

- **Data source**: measured K/S values from Golden HB 10-mil drawdowns over
  white for ~80 pigments, at 20 nm intervals from 400–700 nm
  (see [`constants.ts`](constants.ts)).
- **Surface correction**: the measurements include the film's gloss
  reflection (measured R never drops below ~3.7 %), so a Saunderson
  correction (k₁ = 0.03, k₂ = 0.6) strips it before deriving K/S.
  Predictions are converted back with the specular component *excluded*
  (k₁ = 0): the solver models paint at complete hiding, viewed without glare.
- **Opaque calibration**: Golden also publishes each paint's CIELAB measured
  as a 6 mm fully-opaque sample. Masstone drawdowns of transparent pigments
  over white card are corrupted by the substrate showing through, so a
  per-pigment correction factor γ is fitted such that the predicted
  complete-hiding colour matches the 6 mm measurement (γ ≈ 1 for opaque
  paints; up to ~3 for transparent ones — e.g. Dioxazine Purple reads
  L\* 24.8 as a drawdown but is really L\* 5.6 at full hiding). The result is
  stored in `PIGMENT_KS_FIT` in `constants.ts`.
- **Mixing law**: two-constant Kubelka–Munk — per-pigment absorption `K(λ)`
  and scattering `S(λ)` combine as `K_mix = Σ c_i · K_i`,
  `S_mix = Σ c_i · S_i`, then
  `R(λ) = 1 + K/S − √((K/S)² + 2·K/S)` with `K/S = K_mix/S_mix`.
  Pigments with fitted data (`PIGMENT_KS_FIT`) use it; the rest fall back to
  their masstone K/S curve with `S = 1`, which reduces to the classic
  single-constant model. (True per-pigment scattering values need tint
  measurements — see below.)
- **Colour pipeline**: reflectance → XYZ via D65-weighted CIE 1931 2° CMFs →
  CIELAB (D65 reference white).
- **Target**: converted directly from sRGB hex to CIELAB (no round-trip
  through a reconstructed spectrum).
- **Solver**: smart initialisation (every pure pigment and every
  white-plus-pigment tint) followed by 3 000 iterations of stochastic hill
  climbing with adaptive step size and a 15 % swap mutation so the search can
  still explore under a tight paint-count cap. A projection step enforces
  "at most *N* non-zero pigments" after every candidate.

See [`services/physicsEngine.ts`](services/physicsEngine.ts) for the maths.

### Regenerating the optical data

`constants.ts` is generated from two Golden spreadsheets (not redistributed
here): the 10-mil-over-white reflectance drawdowns and the CIELAB values
workbook (thin film + 6 mm fully-opaque sections).

```sh
# Validate the fitting math (no data files needed)
python3 generate_constants.py --selftest

# Opaque calibration (current PIGMENT_KS_FIT data)
python3 generate_constants.py \
  --masstone "Reflectance Data for Golden HB 10 mil Drawdowns over White.xlsx" \
  --cielab "Golden CIELAB Values.xlsx" --write constants.ts
```

Paints where the two datasets disagree by ΔE > 8 (formulation changes
between measurement eras — e.g. Permanent Maroon, Quin Magenta, Ultramarine
Blue, the transparent iron oxides) keep the uncalibrated masstone fallback;
the generator prints the list.

**If tint measurements ever become available** (paint mixed with Titanium
White at a known weight fraction — e.g. the spectral database from the
[Berns artist-acrylic dataset paper](https://grayskyimaging.com/wp-content/uploads/2022/06/Berns_Archiving_2022.pdf),
no longer downloadable, or your own drawdowns), the full two-constant fit
recovers real per-pigment scattering — strictly better than the opaque
calibration:

```sh
python3 generate_constants.py --masstone <masstone.xlsx> --tints tints.csv --write constants.ts
```

CSV format: `name,concentration,ks400..ks700` (or `r400..r700`) — see the
docstring in `generate_constants.py`. Run the engine checks afterwards with
`npx tsx scripts/engine-smoke.ts`.

## Run

**Prerequisites**

- [Node.js](https://nodejs.org/) 18+
- [Rust toolchain](https://rustup.rs/) (only if you want the Tauri desktop
  shell or installers — the web version works without Rust)

**Web (browser, hot reload)**

```sh
npm install
npm run dev
```

Open http://localhost:3050/.

**Desktop (Tauri)**

```sh
npm run tauri:dev       # native window, hot reload
npm run tauri:build     # produces an installer under src-tauri/target/release/bundle/
```

## Cutting a release

Cross-platform installers are built on GitHub Actions
([`.github/workflows/release.yml`](.github/workflows/release.yml)).

```sh
# bump version in package.json and src-tauri/tauri.conf.json, then:
git tag v0.1.0
git push origin v0.1.0
```

Pushing the tag kicks off a matrix build on Windows, macOS
(universal — Intel + Apple Silicon), and Ubuntu 22.04, and publishes a draft
Release with the `.msi` / `.exe` / `.dmg` / `.deb` / `.AppImage` attached.
Review the draft under the repo's **Releases** tab and click **Publish** to
make it public.

## Project layout

```
App.tsx                 # top-level layout & state
components/             # React UI
  ColorPicker.tsx       # hex, native colour input, screen picker (EyeDropper API), image sampler
  PaletteManager.tsx    # pigment toggles + max-pigments stepper
  RecipeDisplay.tsx     # results panel
  SpectralChart.tsx     # target vs. mixture reflectance
services/
  physicsEngine.ts      # K-M solver
utils/colorUtils.ts     # sRGB ↔ Lab helpers
constants.ts            # pigment list + K/S data
src-tauri/              # Rust shell for desktop builds
generate_constants.py   # regenerates constants.ts from the Golden spreadsheet
```

## License

Currently unspecified — treat as all-rights-reserved. The Golden Heavy Body
reflectance data is © Golden Artist Colors, Inc.; derived K/S values are
included here for research purposes. The raw source spreadsheets are not
redistributed in this repo.
