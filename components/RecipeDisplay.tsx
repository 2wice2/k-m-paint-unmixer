import React from 'react';
import { UnmixResult, RecipeComponent } from '../types';
import { Timer } from 'lucide-react';

interface RecipeDisplayProps {
  result: UnmixResult | null;
  targetHex: string;
  loading: boolean;
  calcTime: number;
  liveTime: number;
}

const RecipeDisplay: React.FC<RecipeDisplayProps> = ({ result, targetHex, loading, calcTime, liveTime }) => {
  if (loading) {
    return (
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 h-full flex flex-col items-center justify-center animate-pulse">
        <div className="w-12 h-12 border-4 border-indigo-100 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
        <p className="text-sm font-mono text-slate-500">Optimizing K/S Coefficients...</p>
        <p className="text-xs text-slate-400 mt-2">Solving Transport Equations</p>
        
        {/* Live Timer */}
        <div className="mt-6 flex items-center gap-2 px-3 py-1 bg-indigo-50 rounded-full text-indigo-600 border border-indigo-100">
          <Timer className="w-3 h-3 animate-pulse" />
          <span className="text-xs font-mono font-bold">
            {(liveTime / 1000).toFixed(1)}s
          </span>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="bg-slate-50 p-6 rounded-2xl border border-dashed border-slate-300 h-full flex items-center justify-center">
        <p className="text-slate-400 text-sm font-medium">Ready to calculate</p>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Calculated Recipe</h2>
        
        <div className="flex items-center gap-6">
          {calcTime > 0 && (
            <div className="flex items-center gap-1.5" title="Calculation Duration">
              <Timer className="w-4 h-4 text-slate-400" />
              <span className="text-sm font-mono font-bold text-slate-600">
                {(calcTime / 1000).toFixed(2)}s
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-mono">ΔE₀₀</span>
            <span className={`text-sm font-mono font-bold ${result.deltaE < 2 ? 'text-green-600' : 'text-amber-500'}`}>
              {result.deltaE.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Visual Result Comparison */}
      <div className="flex w-full h-16 rounded-xl overflow-hidden shadow-sm mb-6 border border-slate-200">
        <div className="flex-1 flex flex-col items-center justify-center relative" style={{ backgroundColor: targetHex }}>
           <span className="text-[10px] font-bold text-white/80 bg-black/20 px-2 py-0.5 rounded backdrop-blur-sm">TARGET</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center relative" style={{ backgroundColor: result.mixHex }}>
           <span className="text-[10px] font-bold text-white/80 bg-black/20 px-2 py-0.5 rounded backdrop-blur-sm">MIX</span>
        </div>
      </div>

      <div className="space-y-4 mb-6">
        {result.recipe.map((item: RecipeComponent, idx: number) => (
          <div key={idx} className="relative">
             <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-slate-700">{item.pigmentName}</span>
                <span className="font-mono text-slate-600">{item.percentage.toFixed(1)}%</span>
             </div>
             <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                <div 
                  className="h-2.5 rounded-full" 
                  style={{ width: `${item.percentage}%`, backgroundColor: item.hex }}
                ></div>
             </div>
          </div>
        ))}
      </div>
      
      <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
        <h3 className="text-xs font-bold text-slate-400 uppercase mb-2">Physics Engine Note</h3>
        <p className="text-sm text-slate-600 leading-relaxed font-serif italic">
          "{result.explanation}"
        </p>
      </div>
    </div>
  );
};

export default RecipeDisplay;