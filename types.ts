export interface Pigment {
  id: string;
  name: string;
  code: string; // e.g., PBk 9
  hex: string;
  isBase: boolean;
}

export interface RecipeComponent {
  pigmentId: string;
  pigmentName: string;
  percentage: number; // 0-100
  hex: string;
}

/**
 * Mixing model:
 *  - 'kmcal': γ-calibrated Kubelka–Munk (default) — per-pigment γ fitted so
 *    100% of a paint reproduces Golden's measured 6 mm FULLY-OPAQUE colour
 *    (specular excluded). γ > 1 compensates the white card showing through
 *    transparent drawdowns; s = 1 convention (zinc white s ≈ 0.42).
 *  - 'km2c': scattering-weighted pseudo two-constant with opacity-class
 *    weights; thin-film endpoint. Comparison mode.
 *  - 'km1c': classic single-constant Kubelka–Munk; thin-film endpoint.
 *  - 'wgm': Scott Burns' weighted geometric mean of reflectance.
 */
export type MixModel = 'kmcal' | 'km2c' | 'km1c' | 'wgm';

export interface UnmixResult {
  recipe: RecipeComponent[];
  deltaE: number; // CIEDE2000 vs target
  mixHex: string; // The visual color of the mixture
  mixLab: LabColor;
  targetLab: LabColor;
  partsLabel: string; // practical mixing ratio, e.g. "5 : 2 : 1"
  partsDeltaE: number; // CIEDE2000 of the quantised parts recipe
  illuminantShiftDE: number; // colour inconstancy of the mix, D65 → A
  gamutClipped: boolean; // mix swatch had to be clipped into sRGB
  modelUsed: MixModel;
  explanation: string;
  spectralData: SpectralPoint[];
}

export interface SpectralPoint {
  wavelength: number;
  targetReflectance: number;
  mixReflectance: number;
}

export interface LabColor {
  l: number;
  a: number;
  b: number;
}

export enum AppState {
  IDLE = 'IDLE',
  ANALYZING = 'ANALYZING', // Simulating Spectral Reconstruction
  SOLVING = 'SOLVING', // Simulating K-M Optimization
  COMPLETE = 'COMPLETE',
  ERROR = 'ERROR'
}