import React, { useState, useEffect, useRef } from 'react';
import { Pipette, Upload, X } from 'lucide-react';
import { rgbToLab, getContrastColor, hexToRgb } from '../utils/colorUtils';
import { LabColor } from '../types';

// Chromium-only API; flagged optional so the feature degrades gracefully.
declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
  }
}

interface ColorPickerProps {
  color: string;
  onChange: (color: string, lab: LabColor) => void;
  disabled: boolean;
}

const IMAGE_MAX_WIDTH = 480;

const ColorPicker: React.FC<ColorPickerProps> = ({ color, onChange, disabled }) => {
  const [lab, setLab] = useState<LabColor>({ l: 0, a: 0, b: 0 });
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [screenPickError, setScreenPickError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasEyeDropper = typeof window !== 'undefined' && !!window.EyeDropper;

  useEffect(() => {
    const rgb = hexToRgb(color);
    if (rgb) {
      setLab(rgbToLab(rgb.r, rgb.g, rgb.b));
    }
  }, [color]);

  useEffect(() => {
    if (!imageSrc) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, IMAGE_MAX_WIDTH / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  const emit = (r: number, g: number, b: number) => {
    const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    onChange(hex, rgbToLab(r, g, b));
  };

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    const rgb = hexToRgb(val);
    if (rgb) {
      onChange(val, rgbToLab(rgb.r, rgb.g, rgb.b));
    } else {
      onChange(val, lab);
    }
  };

  const pickFromScreen = async () => {
    if (!window.EyeDropper) return;
    setScreenPickError(null);
    try {
      const eye = new window.EyeDropper();
      const { sRGBHex } = await eye.open();
      const rgb = hexToRgb(sRGBHex);
      if (rgb) emit(rgb.r, rgb.g, rgb.b);
    } catch {
      // User cancelled — silently ignore.
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setImageSrc((ev.target?.result as string) ?? null);
    reader.readAsDataURL(file);
    e.target.value = ''; // allow re-uploading the same file
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
    const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    emit(r, g, b);
  };

  const clearImage = () => setImageSrc(null);

  const textColor = getContrastColor(color);

  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
      <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-3">Target Specification</h2>

      <div className="flex flex-col gap-3">
        {/* Visual Swatch & Native Picker */}
        <div className="relative group w-full aspect-[3/1] rounded-lg overflow-hidden border border-slate-200 shadow-inner">
           <input
            type="color"
            value={color}
            onChange={handleHexChange}
            disabled={disabled}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          />
          <div
            className="w-full h-full flex items-center justify-center transition-colors duration-300"
            style={{ backgroundColor: color }}
          >
            <span className="font-mono font-medium text-lg" style={{ color: textColor }}>
              {color.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Alternate pickers */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={pickFromScreen}
            disabled={disabled || !hasEyeDropper}
            title={hasEyeDropper ? 'Pick a colour from anywhere on screen' : 'Screen picker not supported in this browser'}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-sm font-medium text-slate-700 disabled:text-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            <Pipette className="w-4 h-4" />
            Pick from screen
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-sm font-medium text-slate-700 disabled:text-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            <Upload className="w-4 h-4" />
            Pick from image
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
        {screenPickError && (
          <div className="text-xs text-red-600">{screenPickError}</div>
        )}

        {/* Uploaded image — click to sample */}
        {imageSrc && (
          <div className="relative rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-white">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                Click any pixel to sample
              </span>
              <button
                type="button"
                onClick={clearImage}
                className="text-slate-400 hover:text-slate-700"
                aria-label="Clear image"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <canvas
              ref={canvasRef}
              onClick={disabled ? undefined : handleCanvasClick}
              className={`block w-full h-auto ${disabled ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
            />
          </div>
        )}

        {/* Data Readout */}
        <div className="grid grid-cols-4 gap-2">
          <div className="space-y-0.5">
            <label className="text-[10px] text-slate-400 font-mono">L*</label>
            <div className="bg-slate-50 border border-slate-200 px-2 py-1 rounded font-mono text-xs text-slate-700 text-center">
              {lab.l.toFixed(1)}
            </div>
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-slate-400 font-mono">a*</label>
            <div className="bg-slate-50 border border-slate-200 px-2 py-1 rounded font-mono text-xs text-slate-700 text-center">
              {lab.a.toFixed(1)}
            </div>
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-slate-400 font-mono">b*</label>
            <div className="bg-slate-50 border border-slate-200 px-2 py-1 rounded font-mono text-xs text-slate-700 text-center">
              {lab.b.toFixed(1)}
            </div>
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-slate-400 font-mono">HEX</label>
            <div className="bg-slate-50 border border-slate-200 px-2 py-1 rounded font-mono text-xs text-slate-700 text-center">
              {color.toUpperCase()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ColorPicker;
