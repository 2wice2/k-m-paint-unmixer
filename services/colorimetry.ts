import { LabColor } from '../types';

// ---------------------------------------------------------------------------
// Colorimetry for the Golden HB dataset: CIE 1964 10° observer, D65 (matching
// how Golden measured the drawdowns), rectangular summation 400–700 nm / 10 nm
// with a self-consistent white point so that R≡1 lands exactly on Lab(100,0,0).
// Verified against the spreadsheet's own L*a*b* columns: mean ΔE76 0.038.
//
// sRGB bridge: the sRGB matrix is formally defined for the 2° observer; using
// it with 10° tristimulus values is the standard pragmatic practice for
// spectral paint data (both directions use the same white point, so ΔE
// comparisons stay coherent).
// ---------------------------------------------------------------------------

// CIE 1964 10° standard observer CMFs, 400–700 nm / 10 nm.
const CMF_10DEG: ReadonlyArray<readonly [number, number, number]> = [
  [0.019110, 0.002004, 0.086011], [0.084736, 0.008756, 0.389366],
  [0.204492, 0.021391, 0.972542], [0.314679, 0.038676, 1.553480],
  [0.383734, 0.062077, 1.967280], [0.370702, 0.089456, 1.994800],
  [0.302273, 0.128201, 1.745370], [0.195618, 0.185190, 1.317560],
  [0.080507, 0.253589, 0.772125], [0.016172, 0.339133, 0.415254],
  [0.003816, 0.460777, 0.218502], [0.037465, 0.606741, 0.112044],
  [0.117749, 0.761757, 0.060709], [0.236491, 0.875211, 0.030451],
  [0.376772, 0.961988, 0.013676], [0.529826, 0.991761, 0.003988],
  [0.705224, 0.997340, 0.000000], [0.878655, 0.955552, 0.000000],
  [1.014160, 0.868934, 0.000000], [1.118520, 0.777405, 0.000000],
  [1.123990, 0.658341, 0.000000], [1.030480, 0.527963, 0.000000],
  [0.856297, 0.398057, 0.000000], [0.647467, 0.283493, 0.000000],
  [0.431567, 0.179828, 0.000000], [0.268329, 0.107633, 0.000000],
  [0.152568, 0.060281, 0.000000], [0.081261, 0.031800, 0.000000],
  [0.040851, 0.015905, 0.000000], [0.019941, 0.007749, 0.000000],
  [0.009577, 0.003718, 0.000000],
];

const D65_SPD: readonly number[] = [
  82.7549, 91.4860, 93.4318, 86.6823, 104.8650, 117.0080, 117.8120, 114.8610,
  115.9230, 108.8110, 109.3540, 107.8020, 104.7900, 107.6890, 104.4050, 104.0460,
  100.0000, 96.3342, 95.7880, 88.6856, 90.0062, 89.5991, 87.6987, 83.2886,
  83.6992, 80.0268, 80.2146, 82.2778, 78.2842, 69.7213, 71.6091,
];

// CIE standard illuminant A (incandescent, 2856 K) — used only for the
// colour-inconstancy metric, never for matching.
const A_SPD: readonly number[] = [
  14.7080, 17.6753, 20.9950, 24.6709, 28.7027, 33.0859, 37.8121, 42.8693,
  48.2423, 53.9132, 59.8611, 66.0635, 72.4959, 79.1326, 85.9470, 92.9120,
  100.0000, 107.1840, 114.4360, 121.7310, 129.0430, 136.3460, 143.6180,
  150.8360, 157.9790, 165.0280, 171.9630, 178.7690, 185.4290, 191.9310,
  198.2610,
];

export const N_BANDS = 31;

export interface IlluminantTables {
  /** CMF·SPD product per band, scaled so Σ weightsY = 100 (ASTM-style). */
  wx: Float64Array;
  wy: Float64Array;
  wz: Float64Array;
  white: readonly [number, number, number];
}

const buildTables = (spd: readonly number[]): IlluminantTables => {
  const wx = new Float64Array(N_BANDS);
  const wy = new Float64Array(N_BANDS);
  const wz = new Float64Array(N_BANDS);
  let sumY = 0;
  for (let i = 0; i < N_BANDS; i++) sumY += CMF_10DEG[i][1] * spd[i];
  const k = 100 / sumY;
  let X = 0, Y = 0, Z = 0;
  for (let i = 0; i < N_BANDS; i++) {
    wx[i] = k * CMF_10DEG[i][0] * spd[i];
    wy[i] = k * CMF_10DEG[i][1] * spd[i];
    wz[i] = k * CMF_10DEG[i][2] * spd[i];
    X += wx[i]; Y += wy[i]; Z += wz[i];
  }
  return { wx, wy, wz, white: [X, Y, Z] };
};

export const D65_10 = buildTables(D65_SPD);   // white ≈ [94.781, 100, 107.352]
export const A_10 = buildTables(A_SPD);       // white ≈ [111.061, 100, 35.205]

// --- Spectral → XYZ → Lab ---------------------------------------------------

export const reflectanceToXYZ = (
  refl: ArrayLike<number>,
  ill: IlluminantTables = D65_10,
): [number, number, number] => {
  let X = 0, Y = 0, Z = 0;
  for (let i = 0; i < N_BANDS; i++) {
    const r = refl[i];
    X += r * ill.wx[i];
    Y += r * ill.wy[i];
    Z += r * ill.wz[i];
  }
  return [X, Y, Z];
};

const EPS = 216 / 24389;      // (6/29)^3
const KAPPA = 24389 / 27;

const fLab = (t: number): number =>
  t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;

export const xyzToLab = (
  xyz: readonly [number, number, number],
  white: readonly [number, number, number] = D65_10.white,
): LabColor => {
  const fx = fLab(xyz[0] / white[0]);
  const fy = fLab(xyz[1] / white[1]);
  const fz = fLab(xyz[2] / white[2]);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
};

export const labToXYZ = (
  lab: LabColor,
  white: readonly [number, number, number] = D65_10.white,
): [number, number, number] => {
  const fy = (lab.l + 16) / 116;
  const fx = lab.a / 500 + fy;
  const fz = fy - lab.b / 200;
  const finv = (t: number): number => {
    const t3 = t * t * t;
    return t3 > EPS ? t3 : (116 * t - 16) / KAPPA;
  };
  return [finv(fx) * white[0], finv(fy) * white[1], finv(fz) * white[2]];
};

export const reflectanceToLab = (
  refl: ArrayLike<number>,
  ill: IlluminantTables = D65_10,
): LabColor => xyzToLab(reflectanceToXYZ(refl, ill), ill.white);

// --- sRGB bridge ------------------------------------------------------------

const SRGB_FROM_XYZ = [
  [3.2406, -1.5372, -0.4986],
  [-0.9689, 1.8758, 0.0415],
  [0.0557, -0.2040, 1.0570],
] as const;

const XYZ_FROM_SRGB = [
  [0.4124, 0.3576, 0.1805],
  [0.2126, 0.7152, 0.0722],
  [0.0193, 0.1192, 0.9505],
] as const;

const srgbGamma = (c: number): number =>
  c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c;

const srgbInvGamma = (c: number): number =>
  c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;

export interface RgbResult {
  r: number;
  g: number;
  b: number;
  /** true if the colour fell outside sRGB and the swatch had to be clipped */
  clipped: boolean;
}

export const labToRgb = (l: number, a: number, b: number): RgbResult => {
  const xyz = labToXYZ({ l, a, b });
  const x = xyz[0] / 100, y = xyz[1] / 100, z = xyz[2] / 100;
  let clipped = false;
  const out = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const m = SRGB_FROM_XYZ[ch];
    let v = m[0] * x + m[1] * y + m[2] * z;
    if (v < -1e-4 || v > 1 + 1e-4) clipped = true;
    v = Math.min(1, Math.max(0, v));
    out[ch] = Math.round(srgbGamma(v) * 255);
  }
  return { r: out[0], g: out[1], b: out[2], clipped };
};

/** sRGB 0–255 → Lab under the same D65/10° white the engine uses. */
export const rgbToLab = (r: number, g: number, b: number): LabColor => {
  const rl = srgbInvGamma(r / 255);
  const gl = srgbInvGamma(g / 255);
  const bl = srgbInvGamma(b / 255);
  const xyz: [number, number, number] = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const m = XYZ_FROM_SRGB[ch];
    xyz[ch] = (m[0] * rl + m[1] * gl + m[2] * bl) * 100;
  }
  return xyzToLab(xyz);
};

// --- Colour difference ------------------------------------------------------

export const deltaE76 = (l1: LabColor, l2: LabColor): number =>
  Math.sqrt((l1.l - l2.l) ** 2 + (l1.a - l2.a) ** 2 + (l1.b - l2.b) ** 2);

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;
const POW7_25 = Math.pow(25, 7);

/** CIEDE2000 (kL = kC = kH = 1), Sharma et al. 2005 formulation. */
export const deltaE2000 = (lab1: LabColor, lab2: LabColor): number => {
  const C1 = Math.hypot(lab1.a, lab1.b);
  const C2 = Math.hypot(lab2.a, lab2.b);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW7_25)));

  const a1p = (1 + G) * lab1.a;
  const a2p = (1 + G) * lab2.a;
  const C1p = Math.hypot(a1p, lab1.b);
  const C2p = Math.hypot(a2p, lab2.b);

  const h1p = C1p === 0 ? 0 : (deg(Math.atan2(lab1.b, a1p)) + 360) % 360;
  const h2p = C2p === 0 ? 0 : (deg(Math.atan2(lab2.b, a2p)) + 360) % 360;

  const dLp = lab2.l - lab1.l;
  const dCp = C2p - C1p;

  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp) / 2);

  const Lbarp = (lab1.l + lab2.l) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
    else hbarp = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.20 * Math.cos(rad(4 * hbarp - 63));

  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + POW7_25));
  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -Math.sin(rad(2 * dTheta)) * RC;

  const dL = dLp / SL;
  const dC = dCp / SC;
  const dH = dHp / SH;
  return Math.sqrt(dL * dL + dC * dC + dH * dH + RT * dC * dH);
};
