import React, { useState } from 'react';
import { ClipboardCopy, Download } from 'lucide-react';
import { LabColor, UnmixResult } from '../types';
import { deltaE2000, RecipeEvaluation, spectralToLab } from '../services/physicsEngine';
import { DispensePlan, RecipeBasis } from '../utils/dispense';
import { SpectralReading } from '../utils/spectralImport';

interface MeasuredComparisonProps {
  result: UnmixResult;
  plan: DispensePlan;
  basis: RecipeBasis;
  batchUnits: number;
  predicted: RecipeEvaluation | null;
  targetLabel: string;
  overWhite: SpectralReading | null;
  overBlack: SpectralReading | null;
}

// Column order of docs/accuracy-test-log.csv.
const LOG_COLUMNS = [
  'phase', 'swatch_id', 'date', 'paint_line', 'outlet', 'recipe_basis', 'batch_units', 'component', 'app_id',
  'nominal_units', 'weighed_mg', 'cartridge_fill_date', 'app_predicted_L', 'app_predicted_a', 'app_predicted_b',
  'app_recipe_pct', 'target_L', 'target_a', 'target_b', 'measured_white_L', 'measured_white_a', 'measured_white_b',
  'measured_black_L', 'measured_black_a', 'measured_black_b', 'spectral_file', 'dry_hours', 'notes',
];

const f2 = (n: number | undefined) => (n === undefined ? '' : n.toFixed(2));
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const LabCells: React.FC<{ lab: LabColor }> = ({ lab }) => (
  <span className="font-mono text-slate-600">
    {lab.l.toFixed(1)}, {lab.a.toFixed(1)}, {lab.b.toFixed(1)}
  </span>
);

const DeltaE: React.FC<{ value: number; label: string; hint: string }> = ({ value, label, hint }) => (
  <div className="bg-slate-50 border border-slate-100 rounded-lg p-2" title={hint}>
    <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">{label}</div>
    <div className={`font-mono font-bold ${value < 1 ? 'text-green-600' : value < 2 ? 'text-slate-700' : 'text-amber-500'}`}>
      {value.toFixed(2)}
    </div>
  </div>
);

const MeasuredComparison: React.FC<MeasuredComparisonProps> = ({
  result, plan, basis, batchUnits, predicted, targetLabel, overWhite, overBlack,
}) => {
  const [phase, setPhase] = useState('4');
  const [swatchId, setSwatchId] = useState('');
  const [paintLine, setPaintLine] = useState('Fluid');
  const [outlet, setOutlet] = useState('');
  const [status, setStatus] = useState('');

  if (!overWhite && !overBlack) {
    return (
      <p className="mt-4 text-[11px] text-slate-400">
        Import a reading of the dried swatch and mark it "mix / white" to compare against this prediction.
      </p>
    );
  }

  const whiteLab = overWhite ? spectralToLab(overWhite.reflectance) : undefined;
  const blackLab = overBlack ? spectralToLab(overBlack.reflectance) : undefined;
  const measured = whiteLab ?? blackLab!;

  const buildRows = (): string => {
    const date = new Date().toISOString().slice(0, 10);
    const files = [overWhite?.source, overBlack?.source].filter(Boolean).join(' | ');
    const lines = plan.rows.map(r => {
      const pct = result.recipe.find(c => c.pigmentId === r.pigmentId)?.percentage;
      const row: Record<string, string> = {
        phase, swatch_id: swatchId, date, paint_line: paintLine, outlet,
        recipe_basis: basis, batch_units: String(batchUnits),
        component: r.pigmentName, app_id: r.pigmentId, nominal_units: String(r.units),
        app_predicted_L: f2(predicted?.lab.l), app_predicted_a: f2(predicted?.lab.a), app_predicted_b: f2(predicted?.lab.b),
        app_recipe_pct: f2(pct),
        target_L: f2(result.targetLab.l), target_a: f2(result.targetLab.a), target_b: f2(result.targetLab.b),
        measured_white_L: f2(whiteLab?.l), measured_white_a: f2(whiteLab?.a), measured_white_b: f2(whiteLab?.b),
        measured_black_L: f2(blackLab?.l), measured_black_a: f2(blackLab?.a), measured_black_b: f2(blackLab?.b),
        spectral_file: files, notes: `target: ${targetLabel}`,
      };
      return LOG_COLUMNS.map(c => csvCell(row[c] ?? '')).join(',');
    });
    return lines.join('\n') + '\n';
  };

  const copyRows = async () => {
    try {
      await navigator.clipboard.writeText(buildRows());
      setStatus('Copied — paste under the header in accuracy-test-log.csv');
    } catch {
      setStatus('Clipboard unavailable — use Download');
    }
  };

  const downloadRows = () => {
    const blob = new Blob([LOG_COLUMNS.join(',') + '\n' + buildRows()], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `log-${swatchId || 'swatch'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const input = 'w-full border border-slate-200 rounded px-1.5 py-0.5 text-xs font-mono text-slate-700';

  return (
    <div className="mt-5 pt-4 border-t border-slate-100">
      <h3 className="text-xs font-bold text-slate-400 uppercase mb-3">Measured Swatch</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs mb-3">
        <div>Predicted (rounded): {predicted ? <LabCells lab={predicted.lab} /> : '—'}</div>
        <div>Target: <LabCells lab={result.targetLab} /></div>
        {whiteLab && <div>Measured over white: <LabCells lab={whiteLab} /></div>}
        {blackLab && <div>Measured over black: <LabCells lab={blackLab} /></div>}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {predicted && (
          <DeltaE value={deltaE2000(predicted.lab, measured)} label="Model ΔE₀₀"
            hint="Measured vs the app's prediction for the rounded recipe: model error plus dosing error" />
        )}
        <DeltaE value={deltaE2000(result.targetLab, measured)} label="Target ΔE₀₀"
          hint="Measured vs the target: the number that matters at the easel" />
        {whiteLab && blackLab && (
          <DeltaE value={deltaE2000(whiteLab, blackLab)} label="Hiding ΔE₀₀"
            hint="Over white vs over black; above 0.5 the film is not opaque" />
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <label className="text-[10px] font-mono uppercase text-slate-400">Phase
          <input className={input} value={phase} onChange={e => setPhase(e.target.value)} />
        </label>
        <label className="text-[10px] font-mono uppercase text-slate-400">Swatch ID
          <input className={input} value={swatchId} onChange={e => setSwatchId(e.target.value)} placeholder="P4-sky-01" />
        </label>
        <label className="text-[10px] font-mono uppercase text-slate-400">Line
          <input className={input} value={paintLine} onChange={e => setPaintLine(e.target.value)} />
        </label>
        <label className="text-[10px] font-mono uppercase text-slate-400">Outlet
          <input className={input} value={outlet} onChange={e => setOutlet(e.target.value)} placeholder="18G" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={copyRows}
          className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700">
          <ClipboardCopy className="w-3 h-3" /> Copy log rows
        </button>
        <button type="button" onClick={downloadRows}
          className="flex items-center gap-1 px-2 py-1 rounded border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-100">
          <Download className="w-3 h-3" /> Download .csv
        </button>
        {status && <span className="text-[11px] text-slate-500">{status}</span>}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        Rows use nominal units; fill in weighed_mg, cartridge_fill_date and dry_hours by hand.
      </p>
    </div>
  );
};

export default MeasuredComparison;
