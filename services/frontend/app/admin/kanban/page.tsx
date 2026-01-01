'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge, StatCard } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';
import { getMediaUrl } from '@/lib/api';

/**
 * Admin - Kanban Board
 *
 * Visual kanban board for reviewing messages by OSINT topic classification.
 * Lanes: Critical (combat/casualties/movements) > High (equipment/units/propaganda) > Medium (diplomatic/humanitarian) > Low (general/uncertain)
 */

interface KanbanItem {
  message_id: number;
  date: string;
  title: string;
  urgency_lane: string;
  osint_topic: string | null;
  importance_level: string | null;
  sentiment: string | null;
  views: number | null;
  forwards: number | null;
  channel: string;
  thumbnail_url: string | null;
  has_media: boolean;
}

interface KanbanLane {
  name: string;
  count: number;
  items: KanbanItem[];
}

interface KanbanStats {
  by_lane: Record<string, number>;
  by_sentiment: Record<string, number>;
  by_importance: Record<string, number>;
  avg_urgency: number;
}

// Lane config based on OSINT topic classification
// Critical: combat, casualties, movements (active military operations)
// High: equipment, units, propaganda (military intelligence)
// Medium: diplomatic, humanitarian (strategic context)
// Low: general, uncertain, unclassified (background)
const LANE_CONFIG: Record<string, { color: string; bg: string; emoji: string; topics: string[] }> = {
  Critical: { color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/30', emoji: '🔴', topics: ['combat', 'casualties', 'movements'] },
  High: { color: 'text-orange-500', bg: 'bg-orange-500/10 border-orange-500/30', emoji: '🟠', topics: ['equipment', 'units', 'propaganda'] },
  Medium: { color: 'text-yellow-500', bg: 'bg-yellow-500/10 border-yellow-500/30', emoji: '🟡', topics: ['diplomatic', 'humanitarian'] },
  Low: { color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/30', emoji: '🔵', topics: ['general', 'uncertain'] },
};

export default function KanbanPage() {
  const [lanes, setLanes] = useState<Record<string, KanbanLane>>({});
  const [stats, setStats] = useState<KanbanStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [selectedItem, setSelectedItem] = useState<KanbanItem | null>(null);
  const [visibleLaneFilter, setVisibleLaneFilter] = useState<Set<string>>(new Set(['Critical', 'High', 'Medium', 'Low']));

  const fetchKanban = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi.get(`/api/admin/kanban?days=${days}&limit_per_lane=20`);
      setLanes(data.lanes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [days]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await adminApi.get(`/api/admin/kanban/stats?days=${days}`);
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch kanban stats:', err);
    }
  }, [days]);

  useEffect(() => {
    fetchKanban();
    fetchStats();
  }, [fetchKanban, fetchStats]);

  // Lanes based on OSINT topic classification (no more "Normal")
  const laneOrder = ['Critical', 'High', 'Medium', 'Low'];

  // Toggle lane visibility
  const toggleLane = (laneName: string) => {
    setVisibleLaneFilter(prev => {
      const next = new Set(prev);
      if (next.has(laneName)) {
        // Don't allow deselecting all lanes
        if (next.size > 1) next.delete(laneName);
      } else {
        next.add(laneName);
      }
      return next;
    });
  };

  // Filter lanes based on user selection
  const visibleLanes = laneOrder.filter(laneName => visibleLaneFilter.has(laneName));

  return (
    <div className="space-y-6 overflow-hidden">
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Kanban</h1>
            <p className="text-text-secondary mt-1">
              Messages grouped by OSINT topic
            </p>
          </div>
          <div>
            <label className="text-sm text-text-secondary mr-2">Time Range:</label>
            <select
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
              className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
            >
              <option value={1}>Last 24 hours</option>
              <option value={3}>Last 3 days</option>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </div>
        </div>

        {/* Lane Filter Toggles */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-text-secondary">Show lanes:</span>
          {laneOrder.map((laneName) => {
            const config = LANE_CONFIG[laneName];
            const isActive = visibleLaneFilter.has(laneName);
            const count = stats?.by_lane[laneName] || 0;
            return (
              <button
                key={laneName}
                onClick={() => toggleLane(laneName)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  isActive
                    ? `${config.bg} ${config.color} border`
                    : 'bg-bg-tertiary text-text-tertiary border border-transparent hover:border-border-subtle'
                }`}
              >
                {config.emoji} {laneName} ({count})
              </button>
            );
          })}
          {visibleLanes.length < 4 && (
            <button
              onClick={() => setVisibleLaneFilter(new Set(laneOrder))}
              className="px-3 py-1.5 rounded-full text-sm text-text-tertiary hover:text-text-secondary transition-colors"
            >
              Show all
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards - only show for visible lanes */}
      {stats && visibleLanes.length < 4 && (
        <div className={`grid gap-4 ${
          visibleLanes.length === 1 ? 'grid-cols-1' :
          visibleLanes.length === 2 ? 'grid-cols-2' :
          'grid-cols-3'
        }`}>
          {visibleLanes.map((lane) => (
            <StatCard
              key={lane}
              title={lane}
              value={stats.by_lane[lane] || 0}
              icon={<span className="text-2xl">{LANE_CONFIG[lane]?.emoji || '⚪'}</span>}
            />
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="glass p-8 text-center text-red-500">
          Error: {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {['Critical', 'High', 'Medium', 'Low'].map((lane) => (
            <div key={lane} className="glass p-4 animate-pulse">
              <div className="h-6 bg-bg-tertiary rounded w-24 mb-4" />
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 bg-bg-tertiary rounded mb-2" />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Kanban Board - responsive grid that adapts to visible lane count */}
      {!loading && !error && (
        <div className={`grid gap-4 min-h-[600px] ${
          visibleLanes.length === 1 ? 'grid-cols-1' :
          visibleLanes.length === 2 ? 'grid-cols-1 md:grid-cols-2' :
          visibleLanes.length === 3 ? 'grid-cols-1 md:grid-cols-3' :
          'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
        }`}>
          {visibleLanes.map((laneName) => {
            const lane = lanes[laneName];
            const config = LANE_CONFIG[laneName];
            return (
              <div
                key={laneName}
                className={`glass border-t-4 ${config?.bg || 'bg-bg-secondary'} flex flex-col`}
              >
                {/* Lane Header */}
                <div className="p-4 border-b border-border-subtle">
                  <div className="flex items-center justify-between">
                    <h3 className={`font-semibold ${config?.color || 'text-text-primary'}`}>
                      {config?.emoji} {laneName}
                    </h3>
                    <Badge variant="default" size="sm">
                      {lane?.count || 0}
                    </Badge>
                  </div>
                </div>

                {/* Lane Items */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {lane?.items.map((item) => (
                    <div
                      key={item.message_id}
                      className="glass p-3 cursor-pointer hover:bg-bg-secondary/50 transition-colors"
                      onClick={() => setSelectedItem(item)}
                    >
                      {/* Thumbnail - handle video vs image */}
                      {item.has_media && item.thumbnail_url && (
                        <div className="aspect-video bg-bg-tertiary rounded mb-2 overflow-hidden relative">
                          {/\.(mp4|mov|webm|avi|mkv)$/i.test(item.thumbnail_url) ? (
                            // Video - show with hover-to-play
                            <video
                              src={getMediaUrl(item.thumbnail_url) || ''}
                              className="w-full h-full object-cover"
                              muted
                              playsInline
                              onMouseEnter={(e) => e.currentTarget.play()}
                              onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                            />
                          ) : (
                            // Image - show normally
                            <img
                              src={getMediaUrl(item.thumbnail_url) || ''}
                              alt=""
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          )}
                        </div>
                      )}

                      {/* Title */}
                      <p className="text-sm text-text-primary line-clamp-2">
                        {item.title || '(No content)'}
                      </p>

                      {/* Meta */}
                      <div className="mt-2 flex items-center justify-between text-xs text-text-tertiary">
                        <span className="truncate max-w-[60%]">{item.channel}</span>
                        <span>{new Date(item.date).toLocaleDateString()}</span>
                      </div>

                      {/* Badges */}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.osint_topic && (
                          <Badge variant="info" size="sm">
                            {item.osint_topic}
                          </Badge>
                        )}
                        {item.sentiment && (
                          <Badge
                            variant={
                              item.sentiment === 'positive' ? 'success' :
                              item.sentiment === 'negative' ? 'error' : 'default'
                            }
                            size="sm"
                          >
                            {item.sentiment}
                          </Badge>
                        )}
                        {(item.views || 0) > 1000 && (
                          <Badge variant="default" size="sm">
                            👁 {((item.views || 0) / 1000).toFixed(1)}k
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Empty Lane */}
                  {(!lane?.items || lane.items.length === 0) && (
                    <div className="text-center py-8 text-text-tertiary text-sm">
                      No items
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Item Detail Modal */}
      {selectedItem && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="glass max-w-2xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border-subtle flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    selectedItem.urgency_lane === 'Critical' ? 'error' :
                    selectedItem.urgency_lane === 'High' ? 'warning' :
                    selectedItem.urgency_lane === 'Medium' ? 'warning' : 'default'
                  }
                >
                  {selectedItem.urgency_lane}
                </Badge>
                <span className="text-text-secondary">{selectedItem.channel}</span>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="p-2 hover:bg-bg-secondary rounded-full transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              {selectedItem.has_media && selectedItem.thumbnail_url && (
                <div className="mb-4">
                  {/\.(mp4|mov|webm|avi|mkv)$/i.test(selectedItem.thumbnail_url) ? (
                    // Video - show video player
                    <video
                      src={getMediaUrl(selectedItem.thumbnail_url) || ''}
                      controls
                      autoPlay
                      className="max-w-full rounded"
                      preload="metadata"
                    />
                  ) : (
                    // Image - show normally
                    <img
                      src={getMediaUrl(selectedItem.thumbnail_url) || ''}
                      alt=""
                      className="max-w-full rounded"
                    />
                  )}
                </div>
              )}
              <p className="text-text-primary whitespace-pre-wrap">
                {selectedItem.title || '(No content)'}
              </p>
              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                {selectedItem.osint_topic && (
                  <span className="text-text-secondary">
                    🎯 Topic: <strong className="text-blue-400">{selectedItem.osint_topic}</strong>
                  </span>
                )}
                {selectedItem.sentiment && (
                  <span className={`${
                    selectedItem.sentiment === 'negative' ? 'text-red-400' :
                    selectedItem.sentiment === 'positive' ? 'text-green-400' : 'text-text-secondary'
                  }`}>
                    Sentiment: <strong>{selectedItem.sentiment}</strong>
                  </span>
                )}
                {(selectedItem.views || selectedItem.forwards) && (
                  <span className="text-text-tertiary">
                    👁 {(selectedItem.views || 0).toLocaleString()} views
                    {selectedItem.forwards ? ` · ${selectedItem.forwards} forwards` : ''}
                  </span>
                )}
              </div>
              <div className="mt-4 text-text-tertiary text-sm">
                {new Date(selectedItem.date).toLocaleString()}
              </div>
              <div className="mt-4 pt-4 border-t border-border-subtle">
                <a
                  href={`/messages/${selectedItem.message_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  View full message →
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
