import { LabColor } from '../types';
import {
  labToRgb as labToRgbFull,
  rgbToLab as rgbToLab10,
} from '../services/colorimetry';

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

// Canonical conversions live in services/colorimetry.ts (CIE 1964 10°
// observer + D65, matching the Golden dataset). These wrappers keep the old
// call signatures for the UI.
export const labToRgb = (l: number, a: number, b: number): { r: number, g: number, b: number } => {
  const { r, g, b: bl } = labToRgbFull(l, a, b);
  return { r, g, b: bl };
}

export const rgbToLab = (r: number, g: number, b: number): LabColor =>
  rgbToLab10(r, g, b);

export const getContrastColor = (hex: string) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return '#000';
    // YIQ equation
    const yiq = ((rgb.r * 299) + (rgb.g * 587) + (rgb.b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#FFFFFF';
}
