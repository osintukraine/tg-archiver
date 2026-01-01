'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from './Badge';
import { StatCard } from './StatCard';
import { adminApi } from '@/lib/admin-api';

/**
 * EnrichmentTasksPanel Component
 *
 * Displays enrichment task status, statistics, and health information.
 * Fetches data from /api/admin/system/enrichment/tasks endpoint.
 */

interface EnrichmentTask {
  name: string;
  description: string;
  requires_llm: boolean;
  requires_telegram: boolean;
  worker: string;
  queue?: string;
  status: 'running' | 'idle' | 'stalled' | 'not_deployed' | 'unknown';
  consumers: number;
  pending: number;
  last_activity?: string;
}

interface EnrichmentStats {
  task_name: string;
  total_processed: number;
  processed_today: number;
  avg_items_per_batch: number;
  last_activity?: string;
}

interface EnrichmentSummary {
  total_tasks: number;
  running_tasks: number;
  idle_tasks: number;
  stalled_tasks: number;
  not_deployed_tasks: number;
  unknown_tasks: number;
  llm_tasks: string[];
  telegram_available: boolean;
  total_consumers: number;
  total_pending: number;
}

interface EnrichmentData {
  tasks: EnrichmentTask[];
  stats: EnrichmentStats[];
  summary: EnrichmentSummary;
  timestamp: string;
}

export function EnrichmentTasksPanel() {
  const [data, setData] = useState<EnrichmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTasks, setExpandedTasks] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const json = await adminApi.get('/api/admin/system/enrichment/tasks');
      setData(json);
      setError(null);
    } catch (err) {
      // Handle 404 gracefully (endpoint may not exist)
      if (err instanceof Error && err.message.includes('404')) {
        setData(null);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to fetch enrichment data');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [fetchData]);

  const getStatusBadge = (status: EnrichmentTask['status']) => {
    switch (status) {
      case 'running':
        return <Badge variant="success" size="sm">Running</Badge>;
      case 'idle':
        return <Badge variant="info" size="sm">Idle</Badge>;
      case 'stalled':
        return <Badge variant="warning" size="sm">Stalled</Badge>;
      case 'not_deployed':
        return <Badge variant="default" size="sm">Not Deployed</Badge>;
      case 'unknown':
        return <Badge variant="default" size="sm">Unknown</Badge>;
    }
  };

  const getTaskIcon = (task: EnrichmentTask) => {
    if (task.requires_llm) return '🤖';
    if (task.requires_telegram) return '📱';
    return '⚡';
  };

  const getStatForTask = (taskName: string): EnrichmentStats | undefined => {
    return data?.stats.find(s => s.task_name === taskName);
  };

  const formatInterval = (seconds: number) => {
    if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h`;
    if (seconds >= 60) return `${Math.floor(seconds / 60)}m`;
    return `${seconds}s`;
  };

  const formatLastActivity = (iso?: string) => {
    if (!iso) return 'Never';
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="glass p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Enrichment Tasks</h2>
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-bg-secondary rounded"></div>
          <div className="h-32 bg-bg-secondary rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Enrichment Tasks</h2>
        <div className="text-red-500 text-sm">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="glass p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Enrichment Tasks</h2>
        <div className="text-text-tertiary text-sm">Enrichment data unavailable</div>
      </div>
    );
  }

  return (
    <div className="glass p-6">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Enrichment Tasks</h2>
          <p className="text-sm text-text-tertiary">
            {data.summary.running_tasks} running • {data.summary.total_consumers} workers • {data.summary.llm_tasks.length} LLM tasks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={data.summary.telegram_available ? 'success' : 'warning'} size="sm">
            Telegram {data.summary.telegram_available ? 'OK' : 'N/A'}
          </Badge>
          {data.summary.stalled_tasks > 0 && (
            <Badge variant="error" size="sm">
              {data.summary.stalled_tasks} Stalled
            </Badge>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard
          title="Running"
          value={data.summary.running_tasks}
          icon={<span className="text-2xl">🟢</span>}
        />
        <StatCard
          title="Idle"
          value={data.summary.idle_tasks}
          icon={<span className="text-2xl">💤</span>}
        />
        <StatCard
          title="Stalled"
          value={data.summary.stalled_tasks}
          icon={<span className="text-2xl">{data.summary.stalled_tasks > 0 ? '⚠️' : '👍'}</span>}
        />
        <StatCard
          title="Consumers"
          value={data.summary.total_consumers}
          icon={<span className="text-2xl">👷</span>}
        />
        <StatCard
          title="Pending"
          value={data.summary.total_pending}
          icon={<span className="text-2xl">{data.summary.total_pending > 100 ? '📥' : '✅'}</span>}
        />
      </div>

      {/* Tasks Grid */}
      <div className="bg-bg-secondary rounded p-4">
        <div className="flex justify-between items-center mb-3">
          <div className="text-sm font-medium text-text-primary">
            Tasks ({data.tasks.length})
          </div>
          <button
            onClick={() => setExpandedTasks(!expandedTasks)}
            className="text-xs text-blue-500 hover:text-blue-400"
          >
            {expandedTasks ? 'Show less' : 'Show all'}
          </button>
        </div>

        <div className="space-y-2">
          {(expandedTasks ? data.tasks : data.tasks.filter(t => t.status === 'running' || t.status === 'idle')).map((task) => {
            const stat = getStatForTask(task.name);
            return (
              <div
                key={task.name}
                className={`bg-bg-tertiary rounded p-3 ${task.status === 'not_deployed' || task.status === 'unknown' ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{getTaskIcon(task)}</span>
                    <div>
                      <div className="font-medium text-text-primary text-sm">
                        {task.name.replace(/_/g, ' ')}
                      </div>
                      <div className="text-xs text-text-tertiary">{task.description}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Queue info */}
                    {task.queue && (
                      <div className="text-right text-xs text-text-tertiary">
                        <div>{task.consumers} consumer{task.consumers !== 1 ? 's' : ''}</div>
                        {task.pending > 0 && (
                          <div className="text-yellow-500">{task.pending} pending</div>
                        )}
                      </div>
                    )}
                    {/* Stats info */}
                    {stat && (
                      <div className="text-right text-xs text-text-tertiary">
                        <div>{stat.total_processed.toLocaleString()} total</div>
                        <div className="text-text-secondary">
                          {stat.processed_today > 0 ? `${stat.processed_today} today` : formatLastActivity(stat.last_activity)}
                        </div>
                      </div>
                    )}
                    {/* Last activity if no stats */}
                    {!stat && task.last_activity && (
                      <div className="text-right text-xs text-text-tertiary">
                        {formatLastActivity(task.last_activity)}
                      </div>
                    )}
                    {getStatusBadge(task.status)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer with task legend */}
        <div className="mt-4 pt-3 border-t border-border-subtle flex items-center gap-4 text-xs text-text-tertiary">
          <span>🤖 Requires LLM</span>
          <span>📱 Requires Telegram</span>
          <span>⚡ Database only</span>
        </div>
      </div>

      {/* Stats Table (if stats exist) */}
      {data.stats.length > 0 && (
        <div className="mt-4 bg-bg-secondary rounded p-4">
          <div className="text-sm font-medium text-text-primary mb-3">Processing Stats</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-tertiary border-b border-border-subtle">
                  <th className="pb-2">Task</th>
                  <th className="pb-2 text-right">Total</th>
                  <th className="pb-2 text-right">Today</th>
                  <th className="pb-2 text-right">Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {data.stats.map((stat) => (
                  <tr key={stat.task_name} className="border-b border-border-subtle last:border-0">
                    <td className="py-2 text-text-primary">
                      {stat.task_name.replace(/_/g, ' ')}
                    </td>
                    <td className="py-2 text-right text-text-secondary">
                      {stat.total_processed.toLocaleString()}
                    </td>
                    <td className="py-2 text-right">
                      <span className={stat.processed_today > 0 ? 'text-green-500' : 'text-text-tertiary'}>
                        {stat.processed_today.toLocaleString()}
                      </span>
                    </td>
                    <td className="py-2 text-right text-text-tertiary">
                      {formatLastActivity(stat.last_activity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Last Updated */}
      <div className="mt-4 text-xs text-text-tertiary text-center">
        Last updated: {new Date(data.timestamp).toLocaleString()}
      </div>
    </div>
  );
}
