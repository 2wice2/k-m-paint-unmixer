# K-M Paint Unmixer

A Kubelka–Munk spectral recipe solver for Golden Heavy Body acrylic paints.
Enter any target sRGB colour (hex, eyedropper, uploaded image) and the solver
returns a pigment mixture that reproduces it, honouring a user-chosen cap on
how many paints may appear in the recipe.

<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

## How it works

- **Data source**: measured K/S values from Golden HB 10-mil drawdowns over
  white for ~80 pigments, at 20 nm intervals from 400–700 nm
  (see [`constants.ts`](constants.ts)).
- **Mixing law**: single-constant Kubelka–Munk — for a mixture with fractional
  amounts `c_i`, `(K/S)_mix(λ) = Σ c_i · (K/S)_i(λ)` — then
  `R(λ) = 1 + K/S − √((K/S)² + 2·K/S)`.
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
npm run tauri:build     # produces a signed installer under src-tauri/target/release/bundle/
```

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
