// services/frontend-nextjs/lib/admin/widgets/stats/ActiveChannelsWidget.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { registerWidget, WidgetProps } from '../registry';
import { adminApi } from '@/lib/admin-api';

function ActiveChannelsWidget({ className }: WidgetProps) {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await adminApi.get('/api/admin/dashboard');
        setCount(result.stats?.channels_active ?? 0);
      } catch {
        setCount(null);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Link href="/admin/channels" className={`glass p-4 hover:bg-bg-secondary transition-colors block ${className || ''}`}>
      <div className="flex items-center gap-3">
        <div className="p-2 bg-purple-500/10 rounded-lg text-purple-500">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-sm text-text-tertiary">Active Channels</div>
          <div className="text-2xl font-bold text-text-primary">
            {loading ? (
              <span className="inline-block w-12 h-7 bg-bg-secondary animate-pulse rounded" />
            ) : (
              count?.toLocaleString() ?? '—'
            )}
          </div>
          <div className="text-xs text-text-tertiary">Monitored Telegram channels</div>
        </div>
      </div>
    </Link>
  );
}

registerWidget({
  id: 'active-channels',
  title: 'Active Channels',
  description: 'Count of monitored Telegram channels',
  component: ActiveChannelsWidget,
  defaultSize: 'small',
  category: 'stats',
  refreshInterval: 60,
});

export default ActiveChannelsWidget;
