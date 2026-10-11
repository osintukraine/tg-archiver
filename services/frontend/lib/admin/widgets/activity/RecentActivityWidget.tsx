// services/frontend-nextjs/lib/admin/widgets/activity/RecentActivityWidget.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { registerWidget, WidgetProps } from '../registry';
import { WidgetCard } from '../WidgetCard';
import { Badge } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

interface ActivityItem {
  timestamp: string;
  type: 'message' | 'channel' | 'entity' | 'system';
  description: string;
}

function RecentActivityWidget({ className }: WidgetProps) {
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result = await adminApi.get('/api/admin/dashboard');
        setActivity(result.recent_activity || []);
      } catch {
        setActivity([]);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const getVariant = (type: ActivityItem['type']): 'success' | 'info' | 'warning' | 'default' => {
    switch (type) {
      case 'message':
        return 'success';
      case 'channel':
        return 'info';
      case 'entity':
        return 'warning';
      case 'system':
        return 'default';
      default:
        return 'default';
    }
  };

  const formatTimeAgo = (timestamp: string): string => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <WidgetCard
      title="Recent Activity"
      action={
        <Link href="/admin/audit" className="text-sm text-blue-500 hover:underline">
          View all
        </Link>
      }
      className={className}
    >
      <div className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-8 bg-bg-secondary animate-pulse rounded" />
            ))}
          </div>
        ) : activity.length > 0 ? (
          activity.slice(0, 5).map((item, idx) => (
            <div key={idx} className="flex items-start gap-3 text-sm">
              <div className="text-text-tertiary whitespace-nowrap text-xs min-w-[48px]">
                {formatTimeAgo(item.timestamp)}
              </div>
              <Badge variant={getVariant(item.type)} size="sm">
                {item.type}
              </Badge>
              <div className="flex-1 text-text-secondary truncate">
                {item.description}
              </div>
            </div>
          ))
        ) : (
          <div className="text-center py-8 text-text-tertiary">
            <p>No recent activity</p>
          </div>
        )}
      </div>
    </WidgetCard>
  );
}

registerWidget({
  id: 'recent-activity',
  title: 'Recent Activity',
  description: 'Latest platform events and actions',
  component: RecentActivityWidget,
  defaultSize: 'medium',
  category: 'activity',
  refreshInterval: 30,
});

export default RecentActivityWidget;
