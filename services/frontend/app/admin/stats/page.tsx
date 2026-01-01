'use client';

import { useState, useEffect, useCallback } from 'react';
import { StatCard, Badge } from '@/components/admin';
import { StatsPageSkeleton } from '@/components/admin/StatsPageSkeleton';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin - Statistics Dashboard
 *
 * Updated to use new unified metrics endpoints:
 * - /api/admin/stats/overview - Main overview (Prometheus + PostgreSQL)
 * - /api/admin/stats/quality - Data quality metrics
 * - /api/analytics/timeline - Time series data
 * - /api/analytics/entities - Entity analytics
 * - /api/analytics/media - Media storage analytics
 */

// New Overview Stats from /api/admin/stats/overview
interface OverviewStats {
  pipeline_active: boolean;
  messages_per_second: number;
  archive_rate: number;
  queue_depth: number;
  llm_requests_per_minute: number;
  llm_avg_latency_seconds: number;
  llm_success_rate: number;
  total_messages: number;
  total_channels: number;
  total_entities: number;
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

// Data Quality Stats from /api/admin/stats/quality
interface QualityStats {
  messages_with_translation: number;
  messages_needing_translation: number;
  translation_coverage_percent: number;
  messages_with_embedding: number;
  messages_needing_embedding: number;
  embedding_coverage_percent: number;
  messages_classified: number;
  messages_unclassified: number;
  classification_coverage_percent: number;
  media_archived: number;
  media_missing: number;
  media_archive_rate: number;
  messages_with_entities: number;
  entity_coverage_percent: number;
  messages_with_geolocation: number;
  geolocation_coverage_percent: number;
  total_event_clusters: number;
  enrichment_backlog_size: number;
  timestamp: string;
}

// Timeline from /api/analytics/timeline
interface DateBucket {
  timestamp: string;
  message_count: number;
  media_count: number;
}

interface TimelineData {
  granularity: string;
  buckets: DateBucket[];
  total_buckets: number;
}

// Entity Analytics from /api/analytics/entities
interface EntityMention {
  entity_id: number;
  entity_name: string;
  entity_type: string;
  mention_count: number;
  unique_channels: number;
}

interface EntityAnalytics {
  top_entities: EntityMention[];
  total_entities: number;
  total_mentions: number;
  by_type: Record<string, number>;
}

// Media Analytics from /api/analytics/media
interface MediaTypeStats {
  media_type: string;
  count: number;
  total_size_bytes: number;
  total_size_human: string;
  percentage: number;
}

interface MediaAnalytics {
  total_files: number;
  total_size_bytes: number;
  total_size_human: string;
  by_type: MediaTypeStats[];
  deduplication_savings_bytes: number;
  deduplication_savings_human: string;
}

export default function StatsPage() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [quality, setQuality] = useState<QualityStats | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [entities, setEntities] = useState<EntityAnalytics | null>(null);
  const [media, setMedia] = useState<MediaAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState(30);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Use Promise.allSettled to handle partial failures gracefully
      const results = await Promise.allSettled([
        adminApi.get('/api/admin/stats/overview'),
        adminApi.get('/api/admin/stats/quality'),
        adminApi.get(`/api/analytics/timeline?granularity=day&days=${timeRange}`),
        adminApi.get(`/api/analytics/entities?days=${timeRange}&limit=10`),
        adminApi.get(`/api/analytics/media?days=${timeRange}`),
      ]);

      const [overviewResult, qualityResult, timelineResult, entitiesResult, mediaResult] = results;

      // Extract successful results, handling both fulfilled with value and fulfilled with null
      if (overviewResult.status === 'fulfilled' && overviewResult.value) {
        setOverview(overviewResult.value);
      } else {
        // Overview is critical - show error but don't block other data
        console.warn('Overview stats unavailable:', overviewResult.status === 'rejected' ? overviewResult.reason : 'null response');
      }

      if (qualityResult.status === 'fulfilled' && qualityResult.value) {
        setQuality(qualityResult.value);
      }

      if (timelineResult.status === 'fulfilled' && timelineResult.value) {
        setTimeline(timelineResult.value);
      }

      if (entitiesResult.status === 'fulfilled' && entitiesResult.value) {
        setEntities(entitiesResult.value);
      }

      if (mediaResult.status === 'fulfilled' && mediaResult.value) {
        setMedia(mediaResult.value);
      }

      // Only show error if critical overview endpoint failed completely
      if (overviewResult.status === 'rejected') {
        setError('Failed to fetch overview stats - some sections may be unavailable');
      }
    } catch (err) {
      // Catch unexpected errors (shouldn't happen with allSettled)
      setError(err instanceof Error ? err.message : 'Unexpected error fetching data');
    } finally {
      setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const renderTimelineChart = (buckets: DateBucket[], field: 'message_count' | 'media_count', color: string, label: string) => {
    if (!buckets || buckets.length === 0) return null;
    const values = buckets.map(b => b[field]);
    const maxCount = Math.max(...values, 1);
    const total = values.reduce((sum, v) => sum + v, 0);

    return (
      <div className="glass p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${color}`} />
            <span className="font-medium text-text-primary">{label}</span>
          </div>
          <span className="text-sm text-text-secondary">
            Total: {total.toLocaleString()}
          </span>
        </div>
        <div className="flex items-end gap-0.5 h-24">
          {buckets.map((bucket, i) => {
            const height = (bucket[field] / maxCount) * 100;
            const date = new Date(bucket.timestamp).toLocaleDateString();
            return (
              <div
                key={i}
                className="flex-1 group relative"
                title={`${date}: ${bucket[field]}`}
              >
                <div
                  className={`${color} opacity-70 hover:opacity-100 transition-opacity rounded-t`}
                  style={{ height: `${Math.max(height, 2)}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between mt-2 text-xs text-text-tertiary">
          <span>{buckets[0] ? new Date(buckets[0].timestamp).toLocaleDateString() : ''}</span>
          <span>{buckets[buckets.length - 1] ? new Date(buckets[buckets.length - 1].timestamp).toLocaleDateString() : ''}</span>
        </div>
      </div>
    );
  };

  const renderQualityBar = (label: string, percent: number) => (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-text-secondary">{label}</span>
        <span className={`font-medium ${
          percent >= 95 ? 'text-green-400' : percent >= 80 ? 'text-yellow-400' : 'text-red-400'
        }`}>{percent}%</span>
      </div>
      <div className="h-2 bg-bg-secondary rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${
            percent >= 95 ? 'bg-green-500' : percent >= 80 ? 'bg-yellow-500' : 'bg-red-500'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );

  const renderDistributionBar = (data: Record<string, number>, colorMap: Record<string, string>) => {
    const total = Object.values(data).reduce((sum, v) => sum + v, 0);
    if (total === 0) return null;

    return (
      <div className="space-y-2">
        <div className="h-4 flex rounded-full overflow-hidden">
          {Object.entries(data).map(([key, value]) => {
            const width = (value / total) * 100;
            return (
              <div
                key={key}
                className={`${colorMap[key] || 'bg-gray-500'}`}
                style={{ width: `${width}%` }}
                title={`${key}: ${value} (${Math.round(width)}%)`}
              />
            );
          })}
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${colorMap[key] || 'bg-gray-500'}`} />
              <span className="text-text-secondary">{key}:</span>
              <span className="text-text-primary font-medium">{value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const importanceColors: Record<string, string> = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-yellow-500',
    low: 'bg-green-500',
    unknown: 'bg-gray-500',
  };

  const ruleColors: Record<string, string> = {
    archive_all: 'bg-blue-500',
    selective_archive: 'bg-purple-500',
    monitoring: 'bg-cyan-500',
    unknown: 'bg-gray-500',
  };

  const entityTypeColors: Record<string, string> = {
    person: 'bg-blue-500',
    organization: 'bg-purple-500',
    location: 'bg-green-500',
    military_unit: 'bg-red-500',
    weapon_system: 'bg-orange-500',
    unknown: 'bg-gray-500',
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Statistics</h1>
          <p className="text-text-secondary mt-1">
            Deep-dive into platform performance metrics
          </p>
        </div>
        <div className="flex items-center gap-4">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(Number(e.target.value))}
            className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            onClick={fetchStats}
            className="px-4 py-2 bg-bg-secondary rounded hover:bg-bg-tertiary transition-colors"
          >
            Refresh
          </button>
        </div>
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
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
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

          {/* Time Series Charts */}
          {timeline && timeline.buckets.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {renderTimelineChart(timeline.buckets, 'message_count', 'bg-blue-500', 'Messages')}
              {renderTimelineChart(timeline.buckets, 'media_count', 'bg-purple-500', 'Media')}
            </div>
          )}

          {/* Data Quality Panel */}
          {quality && (
            <div className="glass p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <span>📊</span> Data Quality Coverage
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {renderQualityBar('Translation', quality.translation_coverage_percent)}
                {renderQualityBar('Embeddings', quality.embedding_coverage_percent)}
                {renderQualityBar('Classification', quality.classification_coverage_percent)}
                {renderQualityBar('Media Archive', quality.media_archive_rate)}
                {renderQualityBar('Entities', quality.entity_coverage_percent)}
                {renderQualityBar('Geolocation', quality.geolocation_coverage_percent)}
              </div>
              <div className="mt-4 flex flex-wrap gap-4 text-sm text-text-secondary">
                {quality.total_event_clusters > 0 && (
                  <span>Event clusters: {quality.total_event_clusters}</span>
                )}
                {quality.enrichment_backlog_size > 0 && (
                  <span>Enrichment backlog: {quality.enrichment_backlog_size} messages</span>
                )}
              </div>
            </div>
          )}

          {/* LLM & Entities Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* LLM Performance */}
            <div className="glass p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <span>🤖</span> LLM Performance
              </h2>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-bg-secondary p-3 rounded">
                  <div className="text-2xl font-bold text-text-primary">
                    {overview.llm_requests_per_minute.toFixed(0)}
                  </div>
                  <div className="text-xs text-text-tertiary">Requests/min</div>
                </div>
                <div className="bg-bg-secondary p-3 rounded">
                  <div className="text-2xl font-bold text-text-primary">
                    {overview.llm_avg_latency_seconds.toFixed(1)}s
                  </div>
                  <div className="text-xs text-text-tertiary">Avg Latency</div>
                </div>
                <div className="bg-bg-secondary p-3 rounded">
                  <div className={`text-2xl font-bold ${overview.llm_success_rate >= 99 ? 'text-green-400' : 'text-yellow-400'}`}>
                    {overview.llm_success_rate}%
                  </div>
                  <div className="text-xs text-text-tertiary">Success Rate</div>
                </div>
                <div className="bg-bg-secondary p-3 rounded">
                  <div className="text-2xl font-bold text-text-primary">
                    {overview.total_entities.toLocaleString()}
                  </div>
                  <div className="text-xs text-text-tertiary">Total Entities</div>
                </div>
              </div>
            </div>

            {/* Entities */}
            {entities && (
              <div className="glass p-6">
                <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <span>👤</span> Entity Analytics
                </h2>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-bg-secondary p-3 rounded">
                    <div className="text-2xl font-bold text-text-primary">
                      {entities.total_entities.toLocaleString()}
                    </div>
                    <div className="text-xs text-text-tertiary">Curated Entities</div>
                  </div>
                  <div className="bg-bg-secondary p-3 rounded">
                    <div className="text-2xl font-bold text-text-primary">
                      {entities.total_mentions.toLocaleString()}
                    </div>
                    <div className="text-xs text-text-tertiary">Mentions ({timeRange}d)</div>
                  </div>
                </div>
                {entities.top_entities.length > 0 && (
                  <div className="mt-4">
                    <div className="text-sm text-text-secondary mb-2">Top Mentioned</div>
                    <div className="space-y-2">
                      {entities.top_entities.slice(0, 5).map((e, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="text-text-primary truncate">{e.entity_name}</span>
                          <Badge variant="info" size="sm">{e.mention_count}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-4">
                  <div className="text-sm text-text-secondary mb-2">By Type</div>
                  {renderDistributionBar(entities.by_type, entityTypeColors)}
                </div>
              </div>
            )}
          </div>

          {/* Media Storage */}
          {media && (
            <div className="glass p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <span>💾</span> Media Storage
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div className="bg-bg-secondary p-3 rounded">
                  <div className="text-2xl font-bold text-text-primary">
                    {media.total_files.toLocaleString()}
                  </div>
                  <div className="text-xs text-text-tertiary">Total Files</div>
                </div>
                <div className="bg-bg-secondary p-3 rounded">
                  <div className="text-2xl font-bold text-text-primary">
                    {media.total_size_human}
                  </div>
                  <div className="text-xs text-text-tertiary">Total Size</div>
                </div>
                <div className="bg-bg-secondary p-3 rounded">
                  <div className="text-2xl font-bold text-green-400">
                    {media.deduplication_savings_human}
                  </div>
                  <div className="text-xs text-text-tertiary">Dedup Savings</div>
                </div>
                <div className="bg-bg-secondary p-3 rounded">
                  <div className="text-2xl font-bold text-text-primary">
                    {media.by_type.length}
                  </div>
                  <div className="text-xs text-text-tertiary">Media Types</div>
                </div>
              </div>
              {media.by_type.length > 0 && (
                <div className="mt-4">
                  <div className="text-sm text-text-secondary mb-2">By Type</div>
                  <div className="space-y-2">
                    {media.by_type.map((t, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="text-text-primary capitalize">{t.media_type}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-text-secondary">{t.count.toLocaleString()} files</span>
                          <span className="text-text-primary">{t.total_size_human}</span>
                          <span className="text-text-tertiary">({t.percentage}%)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Last Updated */}
          <div className="text-center text-text-tertiary text-sm">
            Last updated: {new Date(overview.timestamp).toLocaleString()}
          </div>
        </>
      ) : null}
    </div>
  );
}
