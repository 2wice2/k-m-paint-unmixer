import React from 'react';
import { Pigment } from '../types';
import { Check } from 'lucide-react';

interface PaletteManagerProps {
  pigments: Pigment[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  maxPigments: number;
  onMaxPigmentsChange: (n: number) => void;
}

const PaletteManager: React.FC<PaletteManagerProps> = ({
  pigments,
  selectedIds,
  onToggle,
  maxPigments,
  onMaxPigmentsChange,
}) => {
  const upperBound = Math.max(2, selectedIds.length);
  const clampedMax = Math.min(Math.max(2, maxPigments), upperBound);
  const bump = (delta: number) => {
    onMaxPigmentsChange(Math.min(upperBound, Math.max(2, clampedMax + delta)));
  };

  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Active Palette (K/S DB)</h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Max</span>
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => bump(-1)}
              disabled={clampedMax <= 2}
              className="px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed"
              aria-label="Decrease max pigments"
            >
              −
            </button>
            <span className="px-3 py-1 text-sm font-mono font-semibold text-slate-700 min-w-[2.5rem] text-center">
              {clampedMax}
            </span>
            <button
              type="button"
              onClick={() => bump(1)}
              disabled={clampedMax >= upperBound}
              className="px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed"
              aria-label="Increase max pigments"
            >
              +
            </button>
          </div>
        </div>
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
        {pigments.map(pigment => {
          const isSelected = selectedIds.includes(pigment.id);
          return (
            <div 
              key={pigment.id}
              onClick={() => onToggle(pigment.id)}
              className={`
                group flex items-center justify-between p-1.5 rounded-lg cursor-pointer transition-all border
                ${isSelected ? 'bg-indigo-50 border-indigo-200' : 'hover:bg-slate-50 border-transparent'}
              `}
            >
              <div className="flex items-center gap-3">
                <div 
                  className="w-6 h-6 rounded-full border border-slate-200 shadow-sm"
                  style={{ backgroundColor: pigment.hex }}
                ></div>
                <div>
                  <div className={`text-sm font-medium ${isSelected ? 'text-indigo-900' : 'text-slate-700'}`}>
                    {pigment.name}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    {pigment.code}
                  </div>
                </div>
              </div>
              
              <div className={`
                w-5 h-5 rounded border flex items-center justify-center transition-colors
                ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-slate-300 bg-white group-hover:border-indigo-300'}
              `}>
                {isSelected && (
                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PaletteManager;
