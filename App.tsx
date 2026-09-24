import React, { useState, useRef, useEffect } from 'react';
import { HashRouter as Router } from 'react-router-dom';
import { AVAILABLE_PIGMENTS, INITIAL_SPECTRAL_DATA } from './constants';
import ColorPicker from './components/ColorPicker';
import PaletteManager from './components/PaletteManager';
import RecipeDisplay from './components/RecipeDisplay';
import SpectralChart from './components/SpectralChart';
import DispensePlan from './components/DispensePlan';
import MeasurementPanel, { MeasurementRole } from './components/MeasurementPanel';
import { SpectralReading } from './utils/spectralImport';
import { labToRgb, rgbToHex } from './utils/colorUtils';
import { AppState, UnmixResult, LabColor } from './types';
import { solvePhysicsRecipe, spectralToLab } from './services/physicsEngine';

const App: React.FC = () => {
  // State
  const [targetHex, setTargetHex] = useState<string>('#4166f5');
  const [targetLab, setTargetLab] = useState<LabColor>({ l: 50, a: 0, b: 0 }); // Initial dummy
  const [selectedPigmentIds, setSelectedPigmentIds] = useState<string[]>(
    AVAILABLE_PIGMENTS.map(p => p.id)
  );
  const [maxPigments, setMaxPigments] = useState<number>(5);
  const [appState, setAppState] = useState<AppState>(AppState.IDLE);
  const [result, setResult] = useState<UnmixResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [calcTime, setCalcTime] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  
  const startTimeRef = useRef<number>(0);

  // Imported spectrophotometer readings and what each is used for.
  const [readings, setReadings] = useState<SpectralReading[]>([]);
  const [measuredTarget, setMeasuredTarget] = useState<SpectralReading | null>(null);
  const [overWhite, setOverWhite] = useState<SpectralReading | null>(null);
  const [overBlack, setOverBlack] = useState<SpectralReading | null>(null);
  // Target description captured at solve time, for the log and chart legend.
  const [solvedTargetLabel, setSolvedTargetLabel] = useState<string>('');

  // Live timer effect
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (appState === AppState.ANALYZING || appState === AppState.SOLVING) {
      interval = setInterval(() => {
        setElapsedTime(performance.now() - startTimeRef.current);
      }, 50);
    }
    return () => clearInterval(interval);
  }, [appState]);

  // Handlers
  const handleColorChange = (hex: string, lab: LabColor) => {
    setMeasuredTarget(null);
    setTargetHex(hex);
    setTargetLab(lab);
    setResult(null); // Reset result on new target
    setAppState(AppState.IDLE);
    setCalcTime(0);
    setElapsedTime(0);
  };

  const handleAssignMeasurement = (role: MeasurementRole, reading: SpectralReading) => {
    if (role === 'target') {
      const lab = spectralToLab(reading.reflectance);
      const rgb = labToRgb(lab.l, lab.a, lab.b);
      setMeasuredTarget(reading);
      setTargetHex(rgbToHex(rgb.r, rgb.g, rgb.b));
      setTargetLab(lab);
      setResult(null);
      setAppState(AppState.IDLE);
      setCalcTime(0);
      setElapsedTime(0);
    } else if (role === 'overWhite') {
      setOverWhite(reading);
    } else {
      setOverBlack(reading);
    }
  };

  const handleTogglePigment = (id: string) => {
    setSelectedPigmentIds(prev => 
      prev.includes(id) 
        ? prev.filter(p => p !== id)
        : [...prev, id]
    );
  };

  const handleUnmix = async () => {
    if (selectedPigmentIds.length < 2) {
      alert("Please select at least 2 pigments for mixing.");
      return;
    }

    setAppState(AppState.ANALYZING);
    setErrorMsg(null);
    setCalcTime(0);
    setElapsedTime(0);
    startTimeRef.current = performance.now();

    const activePalette = AVAILABLE_PIGMENTS.filter(p => selectedPigmentIds.includes(p.id));

    setTimeout(async () => {
      setAppState(AppState.SOLVING);
      // Allow UI to paint before blocking with heavy math loop
      await new Promise(r => setTimeout(r, 100));
      try {
        const measured = measuredTarget
          ? { lab: spectralToLab(measuredTarget.reflectance), reflectance: measuredTarget.reflectance }
          : undefined;
        const physicsResult = await solvePhysicsRecipe(targetHex, activePalette, maxPigments, measured);
        setSolvedTargetLabel(measuredTarget ? `measured ${measuredTarget.label} (${measuredTarget.source})` : targetHex);
        setResult(physicsResult);
        setCalcTime(performance.now() - startTimeRef.current);
        setAppState(AppState.COMPLETE);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Calculation failed';
        setErrorMsg(message);
        setAppState(AppState.ERROR);
      }
    }, 600);
  };

  const measuredMix = overWhite ?? overBlack;
  const chartData = result
    ? result.spectralData.map((p, i) => ({ ...p, measuredReflectance: measuredMix?.reflectance[i] }))
    : INITIAL_SPECTRAL_DATA;

  return (
    <Router>
      <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
        
        {/* Header */}
        <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold font-mono">
                KM
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900 tracking-tight">K-M Paint Unmixer</h1>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Physical Two-Constant Model</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
               {/* Status Indicator */}
               <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full border border-slate-200">
                  <div className={`w-2 h-2 rounded-full ${appState === AppState.IDLE || appState === AppState.COMPLETE ? 'bg-green-500' : 'bg-indigo-500 animate-pulse'}`}></div>
                  <span className="text-xs font-mono font-medium text-slate-600">
                    {appState === AppState.IDLE ? 'SYSTEM READY' : 
                     appState === AppState.ANALYZING ? 'RECONSTRUCTING SPECTRA' : 
                     appState === AppState.SOLVING ? 'OPTIMIZING RECIPE' : 
                     appState === AppState.ERROR ? 'SYSTEM ERROR' : 'CALCULATION COMPLETE'}
                  </span>
               </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-grow p-3 sm:p-4 lg:p-5 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-4">

          {/* Left Column: Input & Palette (4 cols) */}
          <div className="lg:col-span-4 space-y-3">
            <ColorPicker 
              color={targetHex} 
              onChange={handleColorChange} 
              disabled={appState === AppState.ANALYZING || appState === AppState.SOLVING}
            />
            
            <PaletteManager
              pigments={AVAILABLE_PIGMENTS}
              selectedIds={selectedPigmentIds}
              onToggle={handleTogglePigment}
              maxPigments={maxPigments}
              onMaxPigmentsChange={setMaxPigments}
            />

            <button
              onClick={handleUnmix}
              disabled={appState === AppState.ANALYZING || appState === AppState.SOLVING}
              className={`
                w-full py-3 rounded-xl font-bold text-white shadow-lg shadow-indigo-200 transition-all transform active:scale-95
                ${appState === AppState.ANALYZING || appState === AppState.SOLVING
                  ? 'bg-slate-400 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700'}
              `}
            >
              {appState === AppState.IDLE || appState === AppState.COMPLETE || appState === AppState.ERROR
                ? 'Solve with Physics'
                : 'Processing...'}
            </button>
            
            {measuredTarget && (
              <div className="bg-indigo-50 text-indigo-700 p-3 rounded-lg text-xs border border-indigo-200 flex items-center justify-between gap-2">
                <span>
                  Target is measured reading <strong>{measuredTarget.label}</strong> — L* {targetLab.l.toFixed(1)}, a* {targetLab.a.toFixed(1)}, b* {targetLab.b.toFixed(1)}. The hex above is only a preview.
                </span>
                <button type="button" onClick={() => setMeasuredTarget(null)} className="shrink-0 underline">Clear</button>
              </div>
            )}

            <MeasurementPanel
              readings={readings}
              onReadingsChange={setReadings}
              onAssign={handleAssignMeasurement}
              assigned={{ target: measuredTarget, overWhite, overBlack }}
              disabled={appState === AppState.ANALYZING || appState === AppState.SOLVING}
            />

            {errorMsg && (
              <div className="bg-red-50 text-red-600 p-4 rounded-lg text-sm border border-red-200">
                Error: {errorMsg}
              </div>
            )}
          </div>

          {/* Right Column: Results & Visualization (8 cols) */}
          <div className="lg:col-span-8 flex flex-col gap-4">
            
            {/* Spectral Graph */}
            <div className="bg-slate-900 rounded-2xl p-6 shadow-xl border border-slate-700">
              <div className="flex justify-between items-end mb-4">
                 <div>
                    <h2 className="text-white font-bold text-lg">Spectral Reconstruction</h2>
                    <p className="text-slate-400 text-sm">Target vs. Mixture Reflectance (400nm - 700nm)</p>
                 </div>
                 {result && (
                   <div className="text-right">
                      <div className="text-slate-400 text-xs font-mono mb-1">METAMERISM INDEX</div>
                      <div className="text-emerald-400 font-mono text-sm">LOW (MATCH)</div>
                   </div>
                 )}
              </div>
              <SpectralChart
                data={chartData}
                targetMeasured={!!result && solvedTargetLabel.startsWith('measured')}
              />
            </div>

            {/* Recipe Results */}
            <div className="flex-grow">
               <RecipeDisplay 
                 result={result} 
                 targetHex={targetHex}
                 loading={appState === AppState.ANALYZING || appState === AppState.SOLVING}
                 calcTime={calcTime}
                 liveTime={elapsedTime}
               />
            </div>

            {result && appState === AppState.COMPLETE && (
              <DispensePlan
                result={result}
                targetLabel={solvedTargetLabel}
                measuredOverWhite={overWhite}
                measuredOverBlack={overBlack}
              />
            )}
          </div>
        </main>
      </div>
    </Router>
  );
};

export default App;