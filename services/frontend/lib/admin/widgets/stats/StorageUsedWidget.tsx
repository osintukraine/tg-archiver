// services/frontend-nextjs/lib/admin/widgets/stats/StorageUsedWidget.tsx
'use client';

import { useState, useEffect } from 'react';
import { registerWidget, WidgetProps } from '../registry';
import { adminApi } from '@/lib/admin-api';

function StorageUsedWidget({ className }: WidgetProps) {
  const [gb, setGb] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await adminApi.get('/api/admin/dashboard');
        setGb(result.stats?.storage_used_gb ?? 0);
      } catch {
        setGb(null);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 120000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`glass p-4 ${className || ''}`}>
      <div className="flex items-center gap-3">
        <div className="p-2 bg-yellow-500/10 rounded-lg text-yellow-500">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-sm text-text-tertiary">Storage Used</div>
          <div className="text-2xl font-bold text-text-primary">
            {loading ? <span className="inline-block w-16 h-7 bg-bg-secondary animate-pulse rounded" /> : gb !== null ? `${gb.toFixed(1)} GB` : '—'}
          </div>
          <div className="text-xs text-text-tertiary">SeaweedFS object storage</div>
        </div>
      </div>
    </div>
  );
}

registerWidget({
  id: 'storage-used',
  title: 'Storage Used',
  description: 'SeaweedFS storage consumption in GB',
  component: StorageUsedWidget,
  defaultSize: 'small',
  category: 'stats',
  refreshInterval: 120,
});

export default StorageUsedWidget;
