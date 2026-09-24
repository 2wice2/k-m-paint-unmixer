import { WAVELENGTHS } from '../constants';

// A reflectance measurement resampled onto the app's 400–700 nm / 20 nm grid.
export interface SpectralReading {
  id: string;
  label: string;
  source: string;
  // Reflectance 0–1 at each WAVELENGTHS entry.
  reflectance: number[];
}

interface RawSpectrum {
  label: string;
  wavelengths: number[];
  values: number[];
}

let nextId = 0;
const makeId = () => `m${Date.now().toString(36)}-${(nextId++).toString(36)}`;

// Linear interpolation of a measured spectrum onto WAVELENGTHS. Returns null
// if the measurement does not cover the full 400–700 nm range.
export const resampleToGrid = (wavelengths: number[], values: number[]): number[] | null => {
  const pts = wavelengths.map((w, i) => ({ w, v: values[i] })).sort((a, b) => a.w - b.w);
  if (pts.length < 2) return null;
  const lo = WAVELENGTHS[0];
  const hi = WAVELENGTHS[WAVELENGTHS.length - 1];
  if (pts[0].w > lo + 1e-6 || pts[pts.length - 1].w < hi - 1e-6) return null;
  return WAVELENGTHS.map(wl => {
    let j = 0;
    while (j < pts.length - 2 && pts[j + 1].w < wl) j++;
    const a = pts[j];
    const b = pts[j + 1];
    const t = b.w === a.w ? 0 : (wl - a.w) / (b.w - a.w);
    return a.v + t * (b.v - a.v);
  });
};

interface RawFile {
  spectra: RawSpectrum[];
  // Declared normalization (CGATS SPECTRAL_NORM), if any.
  norm?: number;
}

// Reflectance files use either 0–1 or 0–100. Use the declared norm when there
// is one, otherwise infer percent from the largest value in the whole file (a
// single very dark swatch in percent could otherwise look like 0–1 data).
const fileScale = (file: RawFile): number => {
  if (file.norm && file.norm > 0) return file.norm;
  const max = Math.max(...file.spectra.flatMap(s => s.values.filter(Number.isFinite)));
  return max > 1.5 ? 100 : 1;
};

// --- CGATS (.ti3, .sp, chartread output, i1Profiler/ColorPort exports) ---

// Spectral fields: SPEC_400 (Argyll), SPECTRAL_400, R_400, nm400, 400nm …
const spectralFieldNm = (field: string): number | null => {
  const m = /^(?:SPEC(?:TRAL)?_?|R_?|NM_?)(\d{3})(?:NM)?$/i.exec(field) ?? /^(\d{3})\s*NM$/i.exec(field);
  return m ? Number(m[1]) : null;
};

const tokenize = (line: string): string[] =>
  (line.match(/"[^"]*"|\S+/g) ?? []).map(t => t.replace(/^"|"$/g, ''));

const parseCgats = (text: string): RawFile | null => {
  const lines = text.split(/\r?\n/);
  const fmtStart = lines.findIndex(l => l.trim() === 'BEGIN_DATA_FORMAT');
  const dataStart = lines.findIndex(l => l.trim() === 'BEGIN_DATA');
  if (fmtStart === -1 || dataStart === -1) return null;

  const normLine = lines.find(l => /^\s*SPECTRAL_NORM\s/.test(l));
  const norm = normLine ? parseFloat(tokenize(normLine)[1]) : undefined;

  const fields: string[] = [];
  for (let i = fmtStart + 1; i < lines.length && lines[i].trim() !== 'END_DATA_FORMAT'; i++) {
    fields.push(...tokenize(lines[i]));
  }
  const specCols = fields
    .map((f, i) => ({ i, nm: spectralFieldNm(f) }))
    .filter((c): c is { i: number; nm: number } => c.nm !== null);
  if (specCols.length === 0) return null;

  const labelCol = ['SAMPLE_NAME', 'SAMPLE_LOC', 'SAMPLE_ID']
    .map(n => fields.indexOf(n))
    .find(i => i !== -1);

  const out: RawSpectrum[] = [];
  let row = 0;
  for (let i = dataStart + 1; i < lines.length && lines[i].trim() !== 'END_DATA'; i++) {
    const toks = tokenize(lines[i]);
    if (toks.length < fields.length) continue;
    row++;
    out.push({
      label: labelCol !== undefined ? toks[labelCol] : `#${row}`,
      wavelengths: specCols.map(c => c.nm),
      values: specCols.map(c => parseFloat(toks[c.i])),
    });
  }
  return { spectra: out, norm };
};

// --- spotread -s console output (pasted) ---
// " Spectrum from 380.000000 to 730.000000 in 36 steps" followed by the values.
const parseSpotread = (text: string): RawFile | null => {
  const re = /Spectrum from\s+([\d.]+)\s+to\s+([\d.]+)\s+in\s+(\d+)\s+steps/gi;
  const out: RawSpectrum[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = parseFloat(m[1]);
    const end = parseFloat(m[2]);
    const n = parseInt(m[3], 10);
    const nums = text.slice(re.lastIndex).match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi) ?? [];
    if (nums.length < n || n < 2) continue;
    const values = nums.slice(0, n).map(Number);
    out.push({
      label: `spotread ${out.length + 1}`,
      wavelengths: values.map((_, i) => start + ((end - start) * i) / (n - 1)),
      values,
    });
  }
  return out.length ? { spectra: out } : null;
};

// --- CSV / TSV with wavelength column headers (e.g. name,400,410,…,700) ---
const parseDelimited = (text: string): RawFile | null => {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) return null;
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const header = lines[0].split(delim).map(h => h.trim().replace(/^"|"$/g, ''));
  const specCols = header
    .map((h, i) => ({ i, nm: /^\d{3}(\.\d+)?$/.test(h) ? Number(h) : spectralFieldNm(h) }))
    .filter((c): c is { i: number; nm: number } => c.nm !== null);
  if (specCols.length < 2) return null;
  const labelIdx = header.findIndex((_, i) => !specCols.some(c => c.i === i));
  const spectra = lines.slice(1).map((line, r) => {
    const cells = line.split(delim).map(c => c.trim().replace(/^"|"$/g, ''));
    return {
      label: labelIdx !== -1 && cells[labelIdx] ? cells[labelIdx] : `#${r + 1}`,
      wavelengths: specCols.map(c => c.nm),
      values: specCols.map(c => parseFloat(cells[c.i])),
    };
  });
  return { spectra };
};

export interface ImportResult {
  readings: SpectralReading[];
  skipped: string[];
}

// Parse any supported text format. `source` is the file name (or "pasted").
export const parseSpectralText = (text: string, source: string): ImportResult => {
  const file = parseCgats(text) ?? parseSpotread(text) ?? parseDelimited(text);
  if (!file || file.spectra.length === 0) {
    return { readings: [], skipped: [`${source}: no spectral data found (expected CGATS SPEC_ fields, spotread -s output, or CSV with wavelength headers)`] };
  }
  const readings: SpectralReading[] = [];
  const skipped: string[] = [];
  const scale = fileScale(file);
  for (const r of file.spectra) {
    const values = r.values.map(v => v / scale);
    const grid = values.some(v => !Number.isFinite(v)) ? null : resampleToGrid(r.wavelengths, values);
    if (!grid) {
      skipped.push(`${source} ${r.label}: must cover 400–700 nm with numeric values`);
      continue;
    }
    if (grid.some(v => v < -0.02 || v > 1.1)) {
      skipped.push(`${source} ${r.label}: reflectance outside 0–1 after scaling (÷${scale}); check the file's units`);
      continue;
    }
    readings.push({ id: makeId(), label: r.label, source, reflectance: grid });
  }
  return { readings, skipped };
};

// Average several readings (e.g. 3 spots on one drawdown) into one.
export const averageReadings = (readings: SpectralReading[], label?: string): SpectralReading | null => {
  if (readings.length === 0) return null;
  if (readings.length === 1) return readings[0];
  const reflectance = WAVELENGTHS.map((_, i) => readings.reduce((s, r) => s + r.reflectance[i], 0) / readings.length);
  return {
    id: makeId(),
    label: label ?? `avg(${readings.map(r => r.label).join(', ')})`,
    source: [...new Set(readings.map(r => r.source))].join(', '),
    reflectance,
  };
};
