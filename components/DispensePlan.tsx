import React, { useEffect, useMemo, useState } from 'react';
import { Syringe, AlertTriangle } from 'lucide-react';
import { UnmixResult } from '../types';
import { SpectralReading } from '../utils/spectralImport';
import MeasuredComparison from './MeasuredComparison';
import { evaluateRecipe } from '../services/physicsEngine';
import { planDispense, RecipeBasis, UNIT_UL, MAX_PUSH_UNITS } from '../utils/dispense';

interface DispensePlanProps {
  result: UnmixResult;
  targetLabel: string;
  measuredOverWhite: SpectralReading | null;
  measuredOverBlack: SpectralReading | null;
}

const STORAGE_KEY = 'km-unmixer.dispense';

interface StoredSettings {
  batchUnits: number;
  basis: RecipeBasis;
  minDoseUnits: number;
  measuredMgPerUnit: Record<string, number>;
}

const DEFAULTS: StoredSettings = { batchUnits: 100, basis: 'mass', minDoseUnits: 5, measuredMgPerUnit: {} };

const loadSettings = (): StoredSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
};

const DispensePlan: React.FC<DispensePlanProps> = ({ result, targetLabel, measuredOverWhite, measuredOverBlack }) => {
  const [settings, setSettings] = useState<StoredSettings>(loadSettings);
  const { batchUnits, basis, minDoseUnits, measuredMgPerUnit } = settings;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage unavailable — settings just won't persist.
    }
  }, [settings]);

  const update = (patch: Partial<StoredSettings>) => setSettings(s => ({ ...s, ...patch }));

  const setMeasured = (pigmentId: string, value: string) => {
    const next = { ...measuredMgPerUnit };
    const n = parseFloat(value);
    if (value.trim() === '' || !(n > 0)) delete next[pigmentId];
    else next[pigmentId] = n;
    update({ measuredMgPerUnit: next });
  };

  const plan = useMemo(
    () => planDispense(result.recipe, { batchUnits, basis, minDoseUnits, measuredMgPerUnit }),
    [result.recipe, batchUnits, basis, minDoseUnits, measuredMgPerUnit]
  );

  const rounded = useMemo(() => evaluateRecipe(result.targetLab, plan.roundedParts), [result.targetLab, plan.roundedParts]);
  const anyBelowMin = plan.rows.some(r => r.belowMinDose);
  const anyEstimated = plan.rows.some(r => !r.measured);

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
          <Syringe className="w-4 h-4" /> Pen Dispense Plan
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-mono">ΔE₀₀ rounded</span>
          <span className={`text-sm font-mono font-bold ${rounded && rounded.deltaE < 2 ? 'text-green-600' : 'text-amber-500'}`}>
            {rounded ? rounded.deltaE.toFixed(2) : '—'}
          </span>
          <span className="text-xs text-slate-400 font-mono">vs {result.deltaE.toFixed(2)} ideal</span>
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <label className="text-[10px] font-mono uppercase tracking-wider text-slate-400 space-y-1">
          <span>Batch (U)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={batchUnits}
            onChange={e => update({ batchUnits: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
            className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm font-mono text-slate-700"
          />
        </label>
        <label className="text-[10px] font-mono uppercase tracking-wider text-slate-400 space-y-1">
          <span>Min dose (U)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={minDoseUnits}
            onChange={e => update({ minDoseUnits: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
            className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm font-mono text-slate-700"
          />
        </label>
        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 space-y-1">
          <span>Recipe % is by</span>
          <div className="flex border border-slate-200 rounded-lg overflow-hidden">
            {(['mass', 'volume'] as RecipeBasis[]).map(b => (
              <button
                key={b}
                type="button"
                onClick={() => update({ basis: b })}
                className={`flex-1 py-1 text-xs font-semibold ${basis === b ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] font-mono uppercase tracking-wider text-slate-400 text-left">
              <th className="py-1 pr-2 font-medium">Paint</th>
              <th className="py-1 px-2 font-medium text-right">Units</th>
              <th className="py-1 px-2 font-medium">Pushes</th>
              <th className="py-1 px-2 font-medium text-right">Expect mg</th>
              <th className="py-1 pl-2 font-medium text-right">mg/U</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map(r => (
              <tr key={r.pigmentId} className="border-t border-slate-100">
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full border border-slate-200 shrink-0" style={{ backgroundColor: r.hex }} />
                    <span className="font-medium text-slate-700">{r.pigmentName}</span>
                  </div>
                </td>
                <td className={`py-2 px-2 text-right font-mono font-bold ${r.belowMinDose ? 'text-amber-500' : 'text-slate-800'}`}>
                  {r.units}
                  <span className="block text-[10px] font-normal text-slate-400">{r.exactUnits.toFixed(1)} exact</span>
                </td>
                <td className="py-2 px-2 font-mono text-xs text-slate-500">{r.pushes.join(' + ') || '—'}</td>
                <td className="py-2 px-2 text-right font-mono text-slate-600">{r.expectedMg.toFixed(0)}</td>
                <td className="py-2 pl-2 text-right">
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    defaultValue={r.measured ? r.mgPerUnit : ''}
                    placeholder={`${r.mgPerUnit} est.`}
                    onBlur={e => setMeasured(r.pigmentId, e.target.value)}
                    className="w-20 border border-slate-200 rounded px-1.5 py-0.5 text-xs font-mono text-right text-slate-700 placeholder:text-slate-400"
                    title="Measured mg per unit from Phase 0 weighing (leave blank to use the estimate)"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs font-mono text-slate-500">
        <span>
          Total {plan.totalUnits} U = {((plan.totalUnits * UNIT_UL) / 1000).toFixed(2)} ml
        </span>
        <span>Max {MAX_PUSH_UNITS} U per push</span>
      </div>

      {anyBelowMin && (
        <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-3 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            Some doses are under {minDoseUnits} U. A batch of at least {plan.minBatchUnits} U keeps every component at or above it.
          </div>
          <button
            type="button"
            onClick={() => update({ batchUnits: plan.minBatchUnits })}
            className="shrink-0 px-2 py-1 rounded bg-amber-600 text-white font-semibold hover:bg-amber-700"
          >
            Use {plan.minBatchUnits} U
          </button>
        </div>
      )}

      {anyEstimated && (
        <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">
          Grey mg/U values are family estimates. Enter your Phase 0 weighings (mg for 1 U) to replace them
          {basis === 'mass' ? ' — in mass mode they change the unit split, not just the expected weights.' : '.'}
        </p>
      )}

      <MeasuredComparison
        result={result}
        plan={plan}
        basis={basis}
        batchUnits={batchUnits}
        predicted={rounded}
        targetLabel={targetLabel}
        overWhite={measuredOverWhite}
        overBlack={measuredOverBlack}
      />
    </div>
  );
};

export default DispensePlan;
