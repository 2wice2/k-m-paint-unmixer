import React, { useEffect, useMemo, useState } from 'react';
import { UnmixResult, RecipeComponent } from '../types';
import { Timer, Syringe, AlertTriangle } from 'lucide-react';
import {
  CARTRIDGE_UNITS,
  DispenseCalibration,
  MAX_STROKE_UNITS,
  PaintLine,
  planDispense,
} from '../services/dispensePlanner';
import { evaluateMixture } from '../services/physicsEngine';

interface RecipeDisplayProps {
  result: UnmixResult | null;
  targetHex: string;
  loading: boolean;
  calcTime: number;
  liveTime: number;
}

interface DispenseSettings {
  line: PaintLine;
  batchUnits: number;
  density: Record<string, number>;
  strength: Record<string, number>;
}

const SETTINGS_KEY = 'kmDispense.v1';

const loadSettings = (): DispenseSettings => {
  const fallback: DispenseSettings = { line: 'fluid', batchUnits: 30, density: {}, strength: {} };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      line: parsed.line === 'highflow' ? 'highflow' : 'fluid',
      batchUnits: Math.max(1, Math.min(CARTRIDGE_UNITS, Number(parsed.batchUnits) || 30)),
      density: parsed.density && typeof parsed.density === 'object' ? parsed.density : {},
      strength: parsed.strength && typeof parsed.strength === 'object' ? parsed.strength : {},
    };
  } catch {
    return fallback;
  }
};

const RecipeDisplay: React.FC<RecipeDisplayProps> = ({ result, targetHex, loading, calcTime, liveTime }) => {
  const [settings, setSettings] = useState<DispenseSettings>(loadSettings);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable — settings stay session-local */
    }
  }, [settings]);

  const cal: DispenseCalibration = useMemo(
    () => ({ density: settings.density, strength: settings.strength }),
    [settings.density, settings.strength],
  );

  const plan = useMemo(
    () => (result ? planDispense(result.recipe, settings.batchUnits, settings.line, cal) : null),
    [result, settings.batchUnits, settings.line, cal],
  );

  const rounded = useMemo(() => {
    if (!result || !plan || plan.achievedWeights.length === 0) return null;
    try {
      return evaluateMixture(plan.achievedWeights, result.targetLab, result.modelUsed);
    } catch {
      return null;
    }
  }, [result, plan]);

  const setBatch = (n: number) =>
    setSettings(s => ({ ...s, batchUnits: Math.max(1, Math.min(CARTRIDGE_UNITS, Math.round(n) || 1)) }));

  const setOverride = (kind: 'density' | 'strength', pigmentId: string, raw: string) =>
    setSettings(s => {
      const next = { ...s[kind] };
      const v = parseFloat(raw);
      if (!raw.trim() || !isFinite(v) || v <= 0) delete next[pigmentId];
      else next[pigmentId] = v;
      return { ...s, [kind]: next };
    });

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 h-full flex flex-col items-center justify-center animate-pulse">
        <div className="w-12 h-12 border-4 border-indigo-100 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
        <p className="text-sm font-mono text-slate-500">Searching pigment subsets…</p>
        <p className="text-xs text-slate-400 mt-2">Kubelka–Munk mixing · Nelder–Mead · CIEDE2000</p>

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
      <div className="flex w-full h-16 rounded-xl overflow-hidden shadow-sm mb-2 border border-slate-200">
        <div className="flex-1 flex flex-col items-center justify-center relative" style={{ backgroundColor: targetHex }}>
           <span className="text-[10px] font-bold text-white/80 bg-black/20 px-2 py-0.5 rounded backdrop-blur-sm">TARGET</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center relative" style={{ backgroundColor: result.mixHex }}>
           <span className="text-[10px] font-bold text-white/80 bg-black/20 px-2 py-0.5 rounded backdrop-blur-sm">MIX</span>
        </div>
      </div>
      {result.gamutClipped && (
        <p className="text-[11px] text-amber-600 mb-2">
          Predicted colour lies outside sRGB — the MIX swatch is a clipped approximation.
        </p>
      )}

      {/* Practical mixing ratio */}
      <div className="flex items-center justify-between bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-2.5 mb-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Mix by parts</div>
          <div className="text-lg font-mono font-bold text-indigo-800">{result.partsLabel}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono text-indigo-400">ΔE₀₀ of ratio</div>
          <div className="text-sm font-mono font-semibold text-indigo-700">{result.partsDeltaE.toFixed(2)}</div>
        </div>
      </div>

      {/* Insulin-pen dispensing plan */}
      {plan && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-3 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Syringe className="w-4 h-4 text-emerald-500" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">
                Pen dispensing · 1 U = 10 µL
              </span>
            </div>

            <div className="flex items-center gap-2">
              {/* Paint line toggle */}
              <div className="flex bg-white rounded-md border border-emerald-200 p-0.5">
                {(['fluid', 'highflow'] as PaintLine[]).map(l => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setSettings(s => ({ ...s, line: l }))}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                      settings.line === l ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {l === 'fluid' ? 'Fluid' : 'High Flow'}
                  </button>
                ))}
              </div>

              {/* Batch size */}
              <label className="flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                Batch
                <input
                  type="number"
                  min={1}
                  max={CARTRIDGE_UNITS}
                  value={plan.batchUnits}
                  onChange={e => setBatch(Number(e.target.value))}
                  className="w-14 px-1.5 py-0.5 rounded border border-emerald-200 bg-white text-right font-mono text-xs text-slate-700"
                />
                U
              </label>
              {[20, 30, 60].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setBatch(n)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                    plan.batchUnits === n
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white text-slate-500 border-emerald-200 hover:text-slate-700'
                  }`}
                >
                  {n}
                </button>
              ))}
              {plan.minBatchUnits !== null && (
                <button
                  type="button"
                  title="Smallest batch where every paint gets at least 1 unit"
                  onClick={() => setBatch(plan.minBatchUnits!)}
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white text-emerald-700 border border-emerald-300 hover:bg-emerald-100"
                >
                  min {plan.minBatchUnits}
                </button>
              )}
            </div>
          </div>

          {/* Per-component units */}
          <div className="space-y-1.5 mb-3">
            {plan.components.map(c => (
              <div key={c.pigmentId} className="flex items-center gap-2 text-sm">
                <span className="w-3 h-3 rounded-full border border-black/10 shrink-0" style={{ backgroundColor: c.hex }} />
                <span className="flex-grow text-slate-700 truncate">{c.pigmentName}</span>
                {c.belowOneUnit ? (
                  <span className="flex items-center gap-1 text-amber-600 text-xs font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5" /> &lt;1 U at this batch
                  </span>
                ) : (
                  <>
                    <span className="font-mono font-bold text-emerald-800 w-14 text-right">{c.units} U</span>
                    <span className="font-mono text-[11px] text-slate-400 w-32 text-right">
                      {c.ml.toFixed(2)} ml · {c.densityEstimated ? '~' : ''}{c.grams.toFixed(2)} g
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Plan summary */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-emerald-100 pt-2">
            <div className="text-[11px] font-mono text-slate-500">
              total {plan.totalMl.toFixed(2)} ml · {plan.anyDensityEstimated ? '~' : ''}{plan.totalGrams.toFixed(2)} g
              {plan.strokes > 1 && <> · {plan.strokes} strokes (max {MAX_STROKE_UNITS} U each)</>}
            </div>
            <div className="flex items-center gap-2" title="Colour of the recipe after rounding to whole units, re-evaluated with the same mixing model">
              <span className="text-[10px] font-mono text-emerald-500">ΔE₀₀ at {plan.batchUnits} U</span>
              {rounded && (
                <span className="w-3.5 h-3.5 rounded border border-black/10" style={{ backgroundColor: rounded.hex }} />
              )}
              <span className={`text-sm font-mono font-semibold ${
                rounded && rounded.deltaE < 2 ? 'text-emerald-700' : 'text-amber-600'
              }`}>
                {rounded ? rounded.deltaE.toFixed(2) : '—'}
              </span>
            </div>
          </div>

          {plan.anyBelowOne && plan.minBatchUnits !== null && (
            <p className="text-[11px] text-amber-600 mt-1.5">
              Some paints round to zero units — the dispensed colour will drift. Use a batch of{' '}
              {plan.minBatchUnits} U or more to include every component.
            </p>
          )}
          {settings.line === 'highflow' && !plan.anyStrengthOverride && (
            <p className="text-[11px] text-slate-500 mt-1.5">
              High Flow carries different pigment loads than the Heavy Body data behind these recipes —
              treat results as directional until you enter per-paint strengths below.
            </p>
          )}

          {/* Calibration */}
          <details className="mt-2">
            <summary className="text-[11px] font-semibold text-emerald-700 cursor-pointer select-none">
              Calibration (density &amp; strength per paint)
            </summary>
            <div className="mt-2 space-y-1.5">
              <p className="text-[11px] text-slate-500 leading-snug">
                Density: dispense 100 U (1.00 ml), weigh, enter g/ml — replaces the ~estimate.
                Strength: tinting strength of this line vs Heavy Body (1.00 = identical; Fluid is 1.00 per
                Golden). Only differences between paints matter — a shared factor cancels.
              </p>
              {plan.components.map(c => (
                <div key={c.pigmentId} className="flex items-center gap-2 text-[11px]">
                  <span className="w-2.5 h-2.5 rounded-full border border-black/10 shrink-0" style={{ backgroundColor: c.hex }} />
                  <span className="flex-grow text-slate-600 truncate">{c.pigmentName}</span>
                  <label className="flex items-center gap-1 text-slate-400">
                    ρ
                    <input
                      type="number"
                      step="0.01"
                      min="0.5"
                      placeholder={`~${c.densityUsed.toFixed(2)}`}
                      value={settings.density[c.pigmentId] ?? ''}
                      onChange={e => setOverride('density', c.pigmentId, e.target.value)}
                      className="w-16 px-1 py-0.5 rounded border border-emerald-200 bg-white text-right font-mono text-slate-700"
                    />
                    g/ml
                  </label>
                  <label className="flex items-center gap-1 text-slate-400">
                    ×
                    <input
                      type="number"
                      step="0.05"
                      min="0.05"
                      placeholder="1.00"
                      value={settings.strength[c.pigmentId] ?? ''}
                      onChange={e => setOverride('strength', c.pigmentId, e.target.value)}
                      className="w-14 px-1 py-0.5 rounded border border-emerald-200 bg-white text-right font-mono text-slate-700"
                    />
                  </label>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

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
