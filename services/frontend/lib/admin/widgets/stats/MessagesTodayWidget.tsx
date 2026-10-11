// services/frontend-nextjs/lib/admin/widgets/stats/MessagesTodayWidget.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { registerWidget, WidgetProps } from '../registry';
import { adminApi } from '@/lib/admin-api';

function MessagesTodayWidget({ className }: WidgetProps) {
  const [data, setData] = useState<{ today: number; lastHour: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await adminApi.get('/api/admin/dashboard');
        setData({
          today: result.stats?.messages_today ?? 0,
          lastHour: result.stats?.messages_last_hour ?? 0,
        });
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Link href="/admin/stats" className={`glass p-4 hover:bg-bg-secondary transition-colors block ${className || ''}`}>
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-sm text-text-tertiary">Messages Today</div>
          <div className="text-2xl font-bold text-text-primary">
            {loading ? (
              <span className="inline-block w-16 h-7 bg-bg-secondary animate-pulse rounded" />
            ) : (
              data?.today.toLocaleString() ?? '—'
            )}
          </div>
          {data?.lastHour !== undefined && !loading && (
            <div className="text-xs text-text-tertiary">
              {data.lastHour.toLocaleString()} last hour
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

// Self-register
registerWidget({
  id: 'messages-today',
  title: 'Messages Today',
  description: 'Real-time message count with hourly breakdown',
  component: MessagesTodayWidget,
  defaultSize: 'small',
  category: 'stats',
  refreshInterval: 30,
});

export default MessagesTodayWidget;
