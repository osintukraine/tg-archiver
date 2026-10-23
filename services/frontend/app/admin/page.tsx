'use client';

import { useState, useEffect } from 'react';
import { getWidgets } from '@/lib/admin/widgets';
import { LiveMetricsBanner, StatCard, type LiveMetrics } from '@/components/admin';
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
  total_messages: number;
  total_channels: number;
  total_media_files: number;
  messages_today: number;
  messages_this_week: number;
  timestamp: string;
}

// Widgets self-register on import (see '@/lib/admin/widgets'), so the registry is
// complete at module load and the components are stable references.
const widgetsById = new Map(getWidgets().map(w => [w.id, w.component]));
const MessagesToday = widgetsById.get('messages-today');
const ActiveChannels = widgetsById.get('active-channels');
const StorageUsed = widgetsById.get('storage-used');
const ProcessingLatency = widgetsById.get('processing-latency');
const SystemStatus = widgetsById.get('system-status');
const QuickActions = widgetsById.get('quick-actions');
const RecentActivity = widgetsById.get('recent-activity');
const TotalArchived = widgetsById.get('total-archived');

export default function AdminDashboard() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [live, setLive] = useState<LiveMetrics | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // Fetch overview stats (on mount and whenever "Refresh Stats" bumps reloadKey)
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const result = await adminApi.get('/api/admin/stats/overview');
        if (result) setOverview(result);
      } catch {
        // Silent fail - stats are supplementary
      } finally {
        setStatsLoading(false);
      }
    };
    const fetchLive = async () => {
      try {
        const result = await adminApi.get('/api/metrics/overview');
        if (result) setLive(result as unknown as LiveMetrics);
      } catch {
        // Banner is supplementary; leave it hidden if the request itself fails
      }
    };
    fetchStats();
    fetchLive();
  }, [reloadKey]);

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
          onClick={() => setReloadKey(k => k + 1)}
          className="px-4 py-2 bg-bg-secondary rounded-sm hover:bg-bg-tertiary transition-colors text-sm"
        >
          Refresh Stats
        </button>
      </div>

      {/* Live pipeline numbers (Prometheus via /api/metrics/overview) */}
      <LiveMetricsBanner metrics={live} />

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
