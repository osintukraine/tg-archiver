'use client';

import { useState, useEffect, useCallback } from 'react';
import { getWidgets } from '@/lib/admin/widgets';
import { StatCard } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';
// Import widgets to trigger registration
import '@/lib/admin/widgets';

/**
 * Admin Dashboard Page
 *
 * Combined dashboard with widgets and detailed statistics.
 * Organized by function: Metrics → Stats → Health → Actions/Activity
 */

// Overview Stats from /api/admin/stats/overview
interface OverviewStats {
  pipeline_active: boolean;
  messages_per_second: number;
  archive_rate: number;
  queue_depth: number;
  total_messages: number;
  total_channels: number;
  total_media_files: number;
  messages_today: number;
  messages_this_week: number;
  services_healthy: number;
  services_degraded: number;
  services_down: number;
  timestamp: string;
  prometheus_available: boolean;
}

export default function AdminDashboard() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const widgets = getWidgets();

  // Get widget components by ID
  const getWidget = (id: string) => {
    const widget = widgets.find(w => w.id === id);
    return widget?.component;
  };

  // Widget components
  const MessagesToday = getWidget('messages-today');
  const ActiveChannels = getWidget('active-channels');
  const StorageUsed = getWidget('storage-used');
  const ProcessingLatency = getWidget('processing-latency');
  const SystemStatus = getWidget('system-status');
  const QuickActions = getWidget('quick-actions');
  const RecentActivity = getWidget('recent-activity');
  const TotalArchived = getWidget('total-archived');

  // Fetch overview stats
  const fetchStats = useCallback(async () => {
    try {
      const result = await adminApi.get('/api/admin/stats/overview');
      if (result) setOverview(result);
    } catch {
      // Silent fail - stats are supplementary
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-text-primary">Dashboard</h1>
          <p className="text-text-secondary mt-2">
            Platform overview, statistics, and quick actions
          </p>
        </div>
        <button
          onClick={fetchStats}
          className="px-4 py-2 bg-bg-secondary rounded hover:bg-bg-tertiary transition-colors text-sm"
        >
          Refresh Stats
        </button>
      </div>

      {/* Pipeline Status Banner (if Prometheus available) */}
      {overview?.prometheus_available && (
        <div className={`glass p-4 flex items-center justify-between ${
          overview.pipeline_active ? 'border-green-500/50' : 'border-yellow-500/50'
        } border`}>
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${overview.pipeline_active ? 'bg-green-500' : 'bg-yellow-500'}`} />
            <span className="font-medium">
              Pipeline {overview.pipeline_active ? 'Active' : 'Idle'}
            </span>
          </div>
          <div className="flex gap-6 text-sm">
            <span>{overview.messages_per_second.toFixed(1)} msg/sec</span>
            <span>{overview.archive_rate.toFixed(1)} archived/sec</span>
            <span>Queue: {overview.queue_depth}</span>
            <span className={overview.services_down > 0 ? 'text-red-400' : 'text-green-400'}>
              Services: {overview.services_healthy}✓ {overview.services_down > 0 && `${overview.services_down}✗`}
            </span>
          </div>
        </div>
      )}

      {/* Section 1: Key Metrics - Responsive grid that wraps naturally */}
      <section>
        <h2 className="text-sm font-medium text-text-tertiary uppercase tracking-wide mb-4">
          Key Metrics
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MessagesToday && <MessagesToday />}
          {ActiveChannels && <ActiveChannels />}
          {StorageUsed && <StorageUsed />}
        </div>
      </section>

      {/* Section 2: Statistics Overview */}
      {overview && !statsLoading && (
        <section>
          <h2 className="text-sm font-medium text-text-tertiary uppercase tracking-wide mb-4">
            Statistics
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard
              title="Total Messages"
              value={overview.total_messages.toLocaleString()}
              icon={<span className="text-2xl">📬</span>}
            />
            <StatCard
              title="Today"
              value={overview.messages_today.toLocaleString()}
              icon={<span className="text-2xl">📅</span>}
            />
            <StatCard
              title="This Week"
              value={overview.messages_this_week.toLocaleString()}
              icon={<span className="text-2xl">📆</span>}
            />
            <StatCard
              title="Channels"
              value={overview.total_channels.toLocaleString()}
              icon={<span className="text-2xl">📡</span>}
            />
            <StatCard
              title="Media Files"
              value={overview.total_media_files.toLocaleString()}
              icon={<span className="text-2xl">📁</span>}
            />
          </div>
        </section>
      )}

      {/* Section 3: Health & Performance */}
      <section>
        <h2 className="text-sm font-medium text-text-tertiary uppercase tracking-wide mb-4">
          Health & Performance
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ProcessingLatency && <ProcessingLatency />}
          {TotalArchived && <TotalArchived />}
        </div>
      </section>

      {/* Section 4: System & Actions - Side by side on larger screens */}
      <section>
        <h2 className="text-sm font-medium text-text-tertiary uppercase tracking-wide mb-4">
          System & Actions
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {SystemStatus && <SystemStatus />}
          {QuickActions && <QuickActions />}
        </div>
      </section>

      {/* Section 5: Recent Activity - Full width */}
      <section>
        <h2 className="text-sm font-medium text-text-tertiary uppercase tracking-wide mb-4">
          Recent Activity
        </h2>
        {RecentActivity && <RecentActivity />}
      </section>

      {/* Last Updated */}
      {overview && (
        <div className="text-center text-text-tertiary text-sm">
          Stats updated: {new Date(overview.timestamp).toLocaleString()}
        </div>
      )}
    </div>
  );
}
