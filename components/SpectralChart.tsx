import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';
import { SpectralPoint } from '../types';

interface SpectralChartProps {
  data: SpectralPoint[];
}

const SpectralChart: React.FC<SpectralChartProps> = ({ data }) => {
  return (
    <div className="w-full h-64 bg-slate-900 rounded-lg p-4 border border-slate-700 flex flex-col">
      <h3 className="text-xs font-mono text-slate-400 mb-2 shrink-0">SPECTRAL REFLECTANCE CURVE (R∞)</h3>
      <div className="flex-1 min-h-0 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{
              top: 5,
              right: 10,
              left: -20,
              bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis 
              dataKey="wavelength" 
              stroke="#94a3b8" 
              tick={{fontSize: 10, fontFamily: 'monospace'}}
              tickLine={false}
            />
            <YAxis 
              domain={[0, 1]} 
              stroke="#94a3b8" 
              tick={{fontSize: 10, fontFamily: 'monospace'}}
              tickLine={false}
            />
            <Tooltip 
              contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }}
              itemStyle={{ fontFamily: 'monospace', fontSize: '12px' }}
              labelStyle={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: '10px' }}
            />
            <Legend wrapperStyle={{ fontSize: '12px', fontFamily: 'Inter' }} />
            <Line 
              type="monotone" 
              dataKey="targetReflectance" 
              name="Target (Reconstructed)" 
              stroke="#38bdf8" 
              strokeWidth={2} 
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Line 
              type="monotone" 
              dataKey="mixReflectance" 
              name="Mixture (K-M Model)" 
              stroke="#f472b6" 
              strokeWidth={2} 
              strokeDasharray="5 5"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default SpectralChart;