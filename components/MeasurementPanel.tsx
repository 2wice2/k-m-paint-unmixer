import React, { useRef, useState } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import { spectralToLab } from '../services/physicsEngine';
import { labToRgb, rgbToHex } from '../utils/colorUtils';
import { averageReadings, parseSpectralText, SpectralReading } from '../utils/spectralImport';

export type MeasurementRole = 'target' | 'overWhite' | 'overBlack';

interface MeasurementPanelProps {
  readings: SpectralReading[];
  onReadingsChange: (readings: SpectralReading[]) => void;
  onAssign: (role: MeasurementRole, reading: SpectralReading) => void;
  assigned: Partial<Record<MeasurementRole, SpectralReading | null>>;
  disabled?: boolean;
}

const readingHex = (r: SpectralReading) => {
  const lab = spectralToLab(r.reflectance);
  const rgb = labToRgb(lab.l, lab.a, lab.b);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
};

const ROLE_BUTTONS: { role: MeasurementRole; label: string; hint: string }[] = [
  { role: 'target', label: 'Target', hint: 'Solve for this measured colour (bypasses sRGB clipping)' },
  { role: 'overWhite', label: 'Mix / white', hint: 'Measured mixed swatch over the white half of the chart' },
  { role: 'overBlack', label: 'Mix / black', hint: 'Measured mixed swatch over the black half of the chart' },
];

const MeasurementPanel: React.FC<MeasurementPanelProps> = ({ readings, onReadingsChange, onAssign, assigned, disabled }) => {
  const [selected, setSelected] = useState<string[]>([]);
  const [pasted, setPasted] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const addText = (text: string, source: string) => {
    const { readings: added, skipped } = parseSpectralText(text, source);
    onReadingsChange([...readings, ...added]);
    return { added: added.length, skipped };
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const msgs: string[] = [];
    let all = [...readings];
    for (const file of Array.from(files)) {
      const { readings: added, skipped } = parseSpectralText(await file.text(), file.name);
      all = [...all, ...added];
      msgs.push(`${file.name}: ${added.length} reading${added.length === 1 ? '' : 's'}`, ...skipped);
    }
    onReadingsChange(all);
    setMessages(msgs);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handlePaste = () => {
    if (!pasted.trim()) return;
    const { added, skipped } = addText(pasted, 'pasted');
    setMessages([`pasted: ${added} reading${added === 1 ? '' : 's'}`, ...skipped]);
    if (added > 0) setPasted('');
  };

  const toggle = (id: string) =>
    setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  const assign = (role: MeasurementRole) => {
    const picked = readings.filter(r => selected.includes(r.id));
    const reading = averageReadings(picked);
    if (reading) onAssign(role, reading);
  };

  const remove = () => {
    onReadingsChange(readings.filter(r => !selected.includes(r.id)));
    setSelected([]);
  };

  const roleOf = (r: SpectralReading) =>
    ROLE_BUTTONS.filter(b => assigned[b.role]?.id === r.id).map(b => b.label).join(', ');

  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">Measurements</h2>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        >
          <Upload className="w-3 h-3" /> Import files
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".ti3,.ti2,.sp,.cgats,.cgt,.txt,.csv,.tsv"
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
      </div>

      <textarea
        value={pasted}
        onChange={e => setPasted(e.target.value)}
        placeholder="…or paste spotread -s output / CGATS / CSV here"
        rows={2}
        className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono text-slate-700 mb-2"
      />
      <button
        type="button"
        onClick={handlePaste}
        disabled={disabled || !pasted.trim()}
        className="w-full py-1 mb-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
      >
        Add pasted readings
      </button>

      {messages.length > 0 && (
        <ul className="mb-3 text-[11px] text-slate-500 space-y-0.5">
          {messages.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}

      {readings.length > 0 && (
        <>
          <ul className="max-h-48 overflow-y-auto space-y-1 mb-3">
            {readings.map(r => {
              const lab = spectralToLab(r.reflectance);
              const role = roleOf(r);
              return (
                <li key={r.id}>
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
                    <span className="w-4 h-4 rounded border border-slate-200 shrink-0" style={{ backgroundColor: readingHex(r) }} />
                    <span className="flex-1 truncate text-slate-700" title={`${r.label} — ${r.source}`}>{r.label}</span>
                    {role && <span className="text-[10px] text-indigo-600 font-semibold">{role}</span>}
                    <span className="font-mono text-slate-400">
                      {lab.l.toFixed(1)} {lab.a.toFixed(1)} {lab.b.toFixed(1)}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">
            Use {selected.length > 1 ? `average of ${selected.length} selected` : 'selected'} as
          </div>
          <div className="grid grid-cols-4 gap-1">
            {ROLE_BUTTONS.map(b => (
              <button
                key={b.role}
                type="button"
                title={b.hint}
                onClick={() => assign(b.role)}
                disabled={disabled || selected.length === 0}
                className="py-1 rounded bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 disabled:bg-slate-300"
              >
                {b.label}
              </button>
            ))}
            <button
              type="button"
              onClick={remove}
              disabled={selected.length === 0}
              title="Remove selected readings"
              className="py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-100 disabled:opacity-50 flex items-center justify-center"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </>
      )}
      <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">
        Lab is recomputed from the spectrum under D65 / 2° to match the solver (spotread prints D50 by default).
      </p>
    </div>
  );
};

export default MeasurementPanel;
