// services/frontend-nextjs/lib/admin/widgets/stats/SpamRateWidget.tsx
'use client';

import { useState, useEffect } from 'react';
import { registerWidget, WidgetProps } from '../registry';
import { adminApi } from '@/lib/admin-api';

function SpamRateWidget({ className }: WidgetProps) {
  const [rate, setRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await adminApi.get('/api/admin/dashboard');
        setRate(result.stats?.spam_rate_24h ?? 0);
      } catch {
        setRate(null);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  const isHealthy = rate !== null && rate < 30;

  return (
    <div className={`glass p-4 ${className || ''}`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${isHealthy ? 'bg-green-500/10 text-green-500' : 'bg-orange-500/10 text-orange-500'}`}>
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-sm text-text-tertiary">Spam Rate (24h)</div>
          <div className="text-2xl font-bold text-text-primary">
            {loading ? <span className="inline-block w-14 h-7 bg-bg-secondary animate-pulse rounded" /> : rate !== null ? `${rate.toFixed(1)}%` : '—'}
          </div>
          <div className="text-xs text-text-tertiary">Filtered messages</div>
        </div>
      </div>
    </div>
  );
}

registerWidget({
  id: 'spam-rate',
  title: 'Spam Rate',
  description: 'Percentage of messages filtered as spam in last 24h',
  component: SpamRateWidget,
  defaultSize: 'small',
  category: 'stats',
  refreshInterval: 60,
});

export default SpamRateWidget;
