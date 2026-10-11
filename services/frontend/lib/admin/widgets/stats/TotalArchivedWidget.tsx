// services/frontend-nextjs/lib/admin/widgets/stats/TotalArchivedWidget.tsx
'use client';

import { useState, useEffect } from 'react';
import { registerWidget, WidgetProps } from '../registry';
import { adminApi } from '@/lib/admin-api';

function TotalArchivedWidget({ className }: WidgetProps) {
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await adminApi.get('/api/admin/dashboard');
        setTotal(result.stats?.messages_total ?? 0);
      } catch {
        setTotal(null);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`glass p-4 ${className || ''}`}>
      <div className="flex items-center gap-3">
        <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-sm text-text-tertiary">Total Archived</div>
          <div className="text-2xl font-bold text-text-primary">
            {loading ? (
              <span className="inline-block w-16 h-7 bg-bg-secondary animate-pulse rounded" />
            ) : (
              total?.toLocaleString() ?? '—'
            )}
          </div>
          <div className="text-xs text-text-tertiary">
            Messages in database
          </div>
        </div>
      </div>
    </div>
  );
}

registerWidget({
  id: 'total-archived',
  title: 'Total Archived',
  description: 'Total count of all archived messages',
  component: TotalArchivedWidget,
  defaultSize: 'small',
  category: 'stats',
  refreshInterval: 60,
});

export default TotalArchivedWidget;
