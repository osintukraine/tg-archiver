'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Badge, StatCard, EnrichmentTasksPanel } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin - System Overview
 *
 * Dashboard for system health, workers, cache management, and external tool links.
 * Phase 6: System Admin features
 */

// External tool URLs - same host, different ports
const DOZZLE_URL = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:9999`
  : 'http://localhost:9999';
const GRAFANA_URL = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : 'http://localhost:3001';
const PROMETHEUS_URL = typeof window !== 'undefined'
  ? `${window.location.protocol}//${window.location.hostname}:9090`
  : 'http://localhost:9090';

interface WorkerInfo {
  name: string;
  pending: number;
  idle_time_ms?: number;
}

interface ConsumerGroup {
  name: string;
  stream: string;
  consumers: number;
  pending: number;
  lag: number;
  workers: WorkerInfo[];
}

interface WorkersData {
  groups: ConsumerGroup[];
  total_consumers: number;
  total_pending: number;
  total_lag: number;
  timestamp: string;
}

interface CacheStats {
  used_memory: string;
  used_memory_peak: string;
  connected_clients: number;
  keyspace_hits: number;
  keyspace_misses: number;
  hit_rate: number;
  uptime_seconds: number;
  redis_version: string;
}

interface AuditStats {
  total_decisions: number;
  decisions_last_hour: number;
  decisions_last_24h: number;
  verification: {
    unverified: number;
    verified_correct: number;
    verified_incorrect: number;
    flagged: number;
    pending_reprocess: number;
  };
  performance: {
    avg_ms: number;
    p95_ms: number;
  };
}

// Cache patterns that can be cleared
const CACHE_PATTERNS = [
  { pattern: 'feed:*', label: 'RSS Feed Cache', description: 'Cached RSS feed items' },
  { pattern: 'embedding:*', label: 'Embeddings Cache', description: 'Cached text embeddings' },
  { pattern: 'translation:*', label: 'Translation Cache', description: 'Cached translations' },
  { pattern: 'entity:*', label: 'Entity Cache', description: 'Cached entity lookups' },
];

export default function SystemPage() {
  const [workers, setWorkers] = useState<WorkersData | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [auditStats, setAuditStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cacheClearing, setCacheClearing] = useState<string | null>(null);
  const [cacheMessage, setCacheMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [workersData, cacheData, auditData] = await Promise.all([
        adminApi.get('/api/admin/system/workers').catch(() => null),
        adminApi.get('/api/admin/system/cache/stats').catch(() => null),
        adminApi.get('/api/admin/system/audit/stats').catch(() => null),
      ]);

      if (workersData) setWorkers(workersData);
      if (cacheData) setCacheStats(cacheData);
      if (auditData) setAuditStats(auditData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleClearCache = async (pattern: string, label: string) => {
    if (!confirm(`Clear all ${label}? This may temporarily slow down the system.`)) return;

    setCacheClearing(pattern);
    setCacheMessage(null);
    try {
      const data = await adminApi.post(`/api/admin/system/cache/clear?pattern=${encodeURIComponent(pattern)}`);

      if (data.error) {
        setCacheMessage({ type: 'error', text: data.error });
      } else {
        setCacheMessage({ type: 'success', text: `Cleared ${data.deleted_keys} keys` });
        // Refresh cache stats
        const cacheData = await adminApi.get('/api/admin/system/cache/stats');
        setCacheStats(cacheData);
      }
    } catch (err) {
      setCacheMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to clear cache' });
    } finally {
      setCacheClearing(null);
    }
  };

  const getStatusBadge = (lag: number) => {
    if (lag < 10) return <Badge variant="success" size="sm">Healthy</Badge>;
    if (lag < 100) return <Badge variant="warning" size="sm">Degraded</Badge>;
    return <Badge variant="error" size="sm">Overloaded</Badge>;
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    if (days > 0) return `${days}d ${hours}h`;
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">System</h1>
          <p className="text-text-secondary mt-1">
            Monitor workers, cache, and system health
          </p>
        </div>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-bg-secondary rounded hover:bg-bg-tertiary transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="glass p-4 text-red-500">Error: {error}</div>
      )}

      {/* Quick Links - External Tools */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <a
          href={DOZZLE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="glass p-4 hover:bg-bg-secondary transition-colors group"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">📋</span>
            <div className="flex-1">
              <div className="font-medium text-text-primary flex items-center gap-2">
                Container Logs
                <span className="text-xs text-text-tertiary group-hover:text-blue-400">↗</span>
              </div>
              <div className="text-sm text-text-secondary">Dozzle - Real-time logs</div>
            </div>
          </div>
        </a>
        <a
          href={GRAFANA_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="glass p-4 hover:bg-bg-secondary transition-colors group"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">📊</span>
            <div className="flex-1">
              <div className="font-medium text-text-primary flex items-center gap-2">
                Metrics
                <span className="text-xs text-text-tertiary group-hover:text-blue-400">↗</span>
              </div>
              <div className="text-sm text-text-secondary">Grafana dashboards</div>
            </div>
          </div>
        </a>
        <Link href="/admin/audit" className="glass p-4 hover:bg-bg-secondary transition-colors">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🔍</span>
            <div>
              <div className="font-medium text-text-primary">Decision Audit</div>
              <div className="text-sm text-text-secondary">Review AI decisions</div>
            </div>
          </div>
        </Link>
        <Link href="/admin/export" className="glass p-4 hover:bg-bg-secondary transition-colors">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📥</span>
            <div>
              <div className="font-medium text-text-primary">Data Export</div>
              <div className="text-sm text-text-secondary">Export messages & data</div>
            </div>
          </div>
        </Link>
      </div>

      {/* Workers Section */}
      <div className="glass p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Message Processing Workers</h2>

        {loading ? (
          <div className="animate-pulse space-y-4">
            <div className="h-20 bg-bg-secondary rounded"></div>
            <div className="h-32 bg-bg-secondary rounded"></div>
          </div>
        ) : workers ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatCard
                title="Total Consumers"
                value={workers.total_consumers}
                icon={<span className="text-2xl">👷</span>}
              />
              <StatCard
                title="Total Pending"
                value={workers.total_pending}
                icon={<span className="text-2xl">⏳</span>}
              />
              <StatCard
                title="Queue Lag"
                value={workers.total_lag}
                icon={<span className="text-2xl">{workers.total_lag < 100 ? '✅' : '⚠️'}</span>}
              />
              <div className="glass p-4 flex flex-col justify-center items-center">
                <div className="text-sm text-text-secondary mb-2">Status</div>
                {getStatusBadge(workers.total_lag)}
              </div>
            </div>

            {workers.groups.length > 0 ? (
              <div className="space-y-4">
                {workers.groups.map((group, i) => (
                  <div key={i} className="bg-bg-secondary p-4 rounded">
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <span className="font-medium text-text-primary">{group.name}</span>
                        <span className="text-text-tertiary ml-2 text-sm">({group.stream})</span>
                      </div>
                      <Badge variant={group.lag < 100 ? 'success' : 'warning'} size="sm">
                        Lag: {group.lag}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <div className="text-text-tertiary">Consumers</div>
                        <div className="text-text-primary font-medium">{group.consumers}</div>
                      </div>
                      <div>
                        <div className="text-text-tertiary">Pending</div>
                        <div className="text-text-primary font-medium">{group.pending}</div>
                      </div>
                      <div>
                        <div className="text-text-tertiary">Workers</div>
                        <div className="text-text-primary font-medium">{group.workers.length}</div>
                      </div>
                    </div>
                    {group.workers.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border-subtle">
                        <div className="text-xs text-text-tertiary mb-2">Active Workers</div>
                        <div className="flex flex-wrap gap-2">
                          {group.workers.map((worker, j) => (
                            <div
                              key={j}
                              className="bg-bg-tertiary px-2 py-1 rounded text-xs"
                            >
                              {worker.name}
                              {worker.pending > 0 && (
                                <span className="ml-1 text-yellow-500">({worker.pending})</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-text-tertiary py-8">
                No consumer groups found
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* Cache Section */}
      <div className="glass p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Redis Cache</h2>
          {cacheStats?.redis_version && (
            <span className="text-xs text-text-tertiary">
              Redis {cacheStats.redis_version} • Uptime: {formatUptime(cacheStats.uptime_seconds)}
            </span>
          )}
        </div>

        {cacheStats ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <StatCard
                title="Memory Used"
                value={cacheStats.used_memory || 'N/A'}
                icon={<span className="text-2xl">💾</span>}
              />
              <StatCard
                title="Peak Memory"
                value={cacheStats.used_memory_peak || 'N/A'}
                icon={<span className="text-2xl">📈</span>}
              />
              <StatCard
                title="Hit Rate"
                value={`${cacheStats.hit_rate || 0}%`}
                icon={<span className="text-2xl">🎯</span>}
              />
              <StatCard
                title="Connected Clients"
                value={cacheStats.connected_clients || 0}
                icon={<span className="text-2xl">🔗</span>}
              />
            </div>

            {/* Cache Management */}
            <div className="bg-bg-secondary p-4 rounded">
              <div className="text-sm font-medium text-text-primary mb-3">Cache Management</div>

              {cacheMessage && (
                <div className={`mb-3 p-2 rounded text-sm ${
                  cacheMessage.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}>
                  {cacheMessage.text}
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {CACHE_PATTERNS.map((item) => (
                  <button
                    key={item.pattern}
                    onClick={() => handleClearCache(item.pattern, item.label)}
                    disabled={cacheClearing === item.pattern}
                    className="bg-bg-tertiary hover:bg-bg-base px-3 py-2 rounded text-left transition-colors disabled:opacity-50"
                  >
                    <div className="text-sm font-medium text-text-primary">
                      {cacheClearing === item.pattern ? 'Clearing...' : item.label}
                    </div>
                    <div className="text-xs text-text-tertiary">{item.description}</div>
                  </button>
                ))}
              </div>

              <p className="mt-3 text-xs text-text-tertiary">
                💡 Clearing cache will temporarily slow down requests until data is re-cached
              </p>
            </div>
          </>
        ) : (
          <div className="text-center text-text-tertiary py-4">
            Cache stats unavailable
          </div>
        )}
      </div>

      {/* Audit Summary */}
      <div className="glass p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Decision Audit Summary</h2>
          <Link
            href="/admin/audit"
            className="text-sm text-blue-500 hover:text-blue-400"
          >
            View all →
          </Link>
        </div>

        {auditStats ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard
              title="Total Decisions"
              value={auditStats.total_decisions}
              icon={<span className="text-2xl">📝</span>}
            />
            <StatCard
              title="Last Hour"
              value={auditStats.decisions_last_hour}
              icon={<span className="text-2xl">⏰</span>}
            />
            <StatCard
              title="Avg Latency"
              value={`${auditStats.performance?.avg_ms || 0}ms`}
              icon={<span className="text-2xl">⚡</span>}
            />
            <StatCard
              title="Unverified"
              value={auditStats.verification?.unverified || 0}
              icon={<span className="text-2xl">❓</span>}
            />
            <StatCard
              title="Flagged"
              value={auditStats.verification?.flagged || 0}
              icon={<span className="text-2xl text-yellow-500">⚠️</span>}
            />
          </div>
        ) : (
          <div className="text-center text-text-tertiary py-4">
            Audit stats unavailable
          </div>
        )}
      </div>

      {/* Enrichment Tasks Section */}
      <EnrichmentTasksPanel />

      {/* Last Updated */}
      {workers?.timestamp && (
        <div className="text-center text-text-tertiary text-sm">
          Last updated: {new Date(workers.timestamp).toLocaleString()}
        </div>
      )}
    </div>
  );
}
