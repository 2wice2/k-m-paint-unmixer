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

export interface UnmixResult {
  recipe: RecipeComponent[];
  deltaE: number; // Perceptual error
  mixHex: string; // The visual color of the mixture
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