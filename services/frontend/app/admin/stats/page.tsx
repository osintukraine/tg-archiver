'use client';

import { useState, useEffect, useCallback } from 'react';
import { StatCard } from '@/components/admin';
import { StatsPageSkeleton } from '@/components/admin/StatsPageSkeleton';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin - Statistics Dashboard
 *
 * Core stats for tg-archiver:
 * - Messages, channels, media counts
 * - Pipeline status (if Prometheus available)
 * - Spam rate
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
  spam_rate: number;
  services_healthy: number;
  services_degraded: number;
  services_down: number;
  timestamp: string;
  prometheus_available: boolean;
}

export default function StatsPage() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await adminApi.get('/api/admin/stats/overview');
      if (result) {
        setOverview(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error fetching data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Statistics</h1>
          <p className="text-text-secondary mt-1">
            Archive performance metrics
          </p>
        </div>
        <button
          onClick={fetchStats}
          className="px-4 py-2 bg-bg-secondary rounded hover:bg-bg-tertiary transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="glass p-4 text-red-500">Error: {error}</div>
      )}

      {loading ? (
        <StatsPageSkeleton />
      ) : overview ? (
        <>
          {/* Pipeline Status Banner */}
          {overview.prometheus_available && (
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

          {/* Processing Overview */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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
              title="Spam Rate"
              value={`${overview.spam_rate}%`}
              icon={<span className="text-2xl">{overview.spam_rate < 10 ? '✅' : '⚠️'}</span>}
            />
            <StatCard
              title="Media Files"
              value={overview.total_media_files.toLocaleString()}
              icon={<span className="text-2xl">📁</span>}
            />
          </div>

          {/* Last Updated */}
          <div className="text-center text-text-tertiary text-sm">
            Last updated: {new Date(overview.timestamp).toLocaleString()}
          </div>
        </>
      ) : null}
    </div>
  );
}
