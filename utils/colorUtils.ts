import { LabColor } from '../types';

export const hexToRgb = (hex: string): { r: number, g: number, b: number } | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

export const componentToHex = (c: number) => {
  const hex = Math.max(0, Math.min(255, Math.round(c))).toString(16);
  return hex.length === 1 ? "0" + hex : hex;
}

export const rgbToHex = (r: number, g: number, b: number) => {
  return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

// Standard CIELAB to sRGB conversion (D65)
export const labToRgb = (l: number, a: number, b: number): { r: number, g: number, b: number } => {
  let y = (l + 16) / 116;
  let x = a / 500 + y;
  let z = y - b / 200;

  const x3 = x * x * x;
  const y3 = y * y * y;
  const z3 = z * z * z;

  x = (x3 > 0.008856) ? x3 : (x - 16 / 116) / 7.787;
  y = (y3 > 0.008856) ? y3 : (y - 16 / 116) / 7.787;
  z = (z3 > 0.008856) ? z3 : (z - 16 / 116) / 7.787;

  // D65 Reference White
  x = x * 95.047;
  y = y * 100.000;
  z = z * 108.883;

  // XYZ to linear sRGB
  x = x / 100;
  y = y / 100;
  z = z / 100;

  let r = x * 3.2406 + y * -1.5372 + z * -0.4986;
  let g = x * -0.9689 + y * 1.8758 + z * 0.0415;
  let bl = x * 0.0557 + y * -0.2040 + z * 1.0570;

  // Gamma Correction
  r = (r > 0.0031308) ? (1.055 * Math.pow(r, 1 / 2.4) - 0.055) : (12.92 * r);
  g = (g > 0.0031308) ? (1.055 * Math.pow(g, 1 / 2.4) - 0.055) : (12.92 * g);
  bl = (bl > 0.0031308) ? (1.055 * Math.pow(bl, 1 / 2.4) - 0.055) : (12.92 * bl);

  return {
    r: Math.round(Math.max(0, Math.min(1, r)) * 255),
    g: Math.round(Math.max(0, Math.min(1, g)) * 255),
    b: Math.round(Math.max(0, Math.min(1, bl)) * 255)
  };
}

// Simple approximation for UI display purposes. 
// In a real K-M engine, we would use the full D65 transformation chain.
export const rgbToLab = (r: number, g: number, b: number): LabColor => {
  let r_ = r / 255, g_ = g / 255, b_ = b / 255;

  if (r_ > 0.04045) r_ = Math.pow(((r_ + 0.055) / 1.055), 2.4);
  else r_ = r_ / 12.92;
  if (g_ > 0.04045) g_ = Math.pow(((g_ + 0.055) / 1.055), 2.4);
  else g_ = g_ / 12.92;
  if (b_ > 0.04045) b_ = Math.pow(((b_ + 0.055) / 1.055), 2.4);
  else b_ = b_ / 12.92;

  let x = (r_ * 0.4124 + g_ * 0.3576 + b_ * 0.1805) * 100;
  let y = (r_ * 0.2126 + g_ * 0.7152 + b_ * 0.0722) * 100;
  let z = (r_ * 0.0193 + g_ * 0.1192 + b_ * 0.9505) * 100;

  x = x / 95.047;
  y = y / 100.000;
  z = z / 108.883;

  if (x > 0.008856) x = Math.pow(x, 1/3); else x = (7.787 * x) + 16/116;
  if (y > 0.008856) y = Math.pow(y, 1/3); else y = (7.787 * y) + 16/116;
  if (z > 0.008856) z = Math.pow(z, 1/3); else z = (7.787 * z) + 16/116;

  return {
    l: (116 * y) - 16,
    a: 500 * (x - y),
    b: 200 * (y - z)
  };
}

export const getContrastColor = (hex: string) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return '#000';
    // YIQ equation
    const yiq = ((rgb.r * 299) + (rgb.g * 587) + (rgb.b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#FFFFFF';
}