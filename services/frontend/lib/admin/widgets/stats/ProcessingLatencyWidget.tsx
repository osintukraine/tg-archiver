// services/frontend-nextjs/lib/admin/widgets/stats/ProcessingLatencyWidget.tsx
'use client';

import { useState, useEffect } from 'react';
import { registerWidget, WidgetProps } from '../registry';
import { adminApi } from '@/lib/admin-api';

function ProcessingLatencyWidget({ className }: WidgetProps) {
  const [ms, setMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await adminApi.get('/api/admin/dashboard');
        setMs(result.stats?.avg_processing_ms ?? 0);
      } catch {
        setMs(null);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const isHealthy = ms !== null && ms < 1000;

  return (
    <div className={`glass p-4 ${className || ''}`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${isHealthy ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-sm text-text-tertiary">Avg Processing</div>
          <div className="text-2xl font-bold text-text-primary">
            {loading ? <span className="inline-block w-16 h-7 bg-bg-secondary animate-pulse rounded" /> : ms !== null ? `${ms}ms` : '—'}
          </div>
          <div className="text-xs text-text-tertiary">Per message latency</div>
        </div>
      </div>
    </div>
  );
}

registerWidget({
  id: 'processing-latency',
  title: 'Processing Latency',
  description: 'Average message processing time in milliseconds',
  component: ProcessingLatencyWidget,
  defaultSize: 'small',
  category: 'stats',
  refreshInterval: 30,
});

export default ProcessingLatencyWidget;
