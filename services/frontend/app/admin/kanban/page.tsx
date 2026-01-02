'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge, StatCard } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';
import { getMediaUrl } from '@/lib/api';

/**
 * Admin - Kanban Board
 *
 * Visual kanban board for reviewing messages by engagement level.
 * Lanes: Trending > Popular > Recent > Quiet
 */

interface BoardItem {
  message_id: number;
  date: string;
  title: string;
  lane: string;
  views: number | null;
  forwards: number | null;
  channel: string;
  thumbnail_url: string | null;
  has_media: boolean;
}

interface BoardLane {
  name: string;
  count: number;
  items: BoardItem[];
}

interface BoardStats {
  by_lane: Record<string, number>;
  total_messages: number;
  with_media: number;
}

// Engagement-based lane config
const LANE_CONFIG: Record<string, { color: string; bg: string; emoji: string; description: string }> = {
  Trending: { color: 'text-red-500', bg: 'bg-red-500/10 border-red-500/30', emoji: '🔥', description: 'High views/forwards' },
  Popular: { color: 'text-orange-500', bg: 'bg-orange-500/10 border-orange-500/30', emoji: '📈', description: 'Above average engagement' },
  Recent: { color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/30', emoji: '🆕', description: 'Posted in last 2 days' },
  Quiet: { color: 'text-gray-500', bg: 'bg-gray-500/10 border-gray-500/30', emoji: '📭', description: 'Lower engagement' },
};

export default function KanbanPage() {
  const [lanes, setLanes] = useState<Record<string, BoardLane>>({});
  const [stats, setStats] = useState<BoardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [selectedItem, setSelectedItem] = useState<BoardItem | null>(null);
  const [visibleLaneFilter, setVisibleLaneFilter] = useState<Set<string>>(new Set(['Trending', 'Popular', 'Recent', 'Quiet']));

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi.get(`/api/admin/kanban?days=${days}&limit_per_lane=20`);
      setLanes(data.lanes || {});
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
      console.error('Failed to fetch board stats:', err);
    }
  }, [days]);

  useEffect(() => {
    fetchBoard();
    fetchStats();
  }, [fetchBoard, fetchStats]);

  const laneOrder = ['Trending', 'Popular', 'Recent', 'Quiet'];

  const toggleLane = (laneName: string) => {
    setVisibleLaneFilter(prev => {
      const next = new Set(prev);
      if (next.has(laneName)) {
        if (next.size > 1) next.delete(laneName);
      } else {
        next.add(laneName);
      }
      return next;
    });
  };

  const visibleLanes = laneOrder.filter(laneName => visibleLaneFilter.has(laneName));

  return (
    <div className="space-y-6 overflow-hidden">
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Message Board</h1>
            <p className="text-text-secondary mt-1">
              Messages organized by engagement level
            </p>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/admin/messages"
              className="text-blue-500 hover:text-blue-400 text-sm"
            >
              View as Table →
            </a>
            <div>
              <label className="text-sm text-text-secondary mr-2">Time Range:</label>
              <select
                value={days}
                onChange={(e) => setDays(parseInt(e.target.value))}
                className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
              >
                <option value={0}>All Time</option>
                <option value={1}>Last 24 hours</option>
                <option value={3}>Last 3 days</option>
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
              </select>
            </div>
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
                title={config.description}
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

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {laneOrder.map((lane) => (
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
          {laneOrder.map((lane) => (
            <div key={lane} className="glass p-4 animate-pulse">
              <div className="h-6 bg-bg-tertiary rounded w-24 mb-4" />
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 bg-bg-tertiary rounded mb-2" />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Kanban Board */}
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
                  <p className="text-xs text-text-tertiary mt-1">{config?.description}</p>
                </div>

                {/* Lane Items */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {lane?.items?.map((item) => (
                    <div
                      key={item.message_id}
                      className="glass p-3 cursor-pointer hover:bg-bg-secondary/50 transition-colors"
                      onClick={() => setSelectedItem(item)}
                    >
                      {/* Thumbnail */}
                      {item.has_media && item.thumbnail_url && (
                        <div className="aspect-video bg-bg-tertiary rounded mb-2 overflow-hidden relative">
                          {/\.(mp4|mov|webm|avi|mkv)$/i.test(item.thumbnail_url) ? (
                            <video
                              src={getMediaUrl(item.thumbnail_url) || ''}
                              className="w-full h-full object-cover"
                              muted
                              playsInline
                              onMouseEnter={(e) => e.currentTarget.play()}
                              onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                            />
                          ) : (
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

                      {/* Stats */}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(item.views || 0) > 0 && (
                          <Badge variant="default" size="sm">
                            👁 {item.views! >= 1000 ? `${(item.views! / 1000).toFixed(1)}k` : item.views}
                          </Badge>
                        )}
                        {(item.forwards || 0) > 0 && (
                          <Badge variant="info" size="sm">
                            ↗️ {item.forwards}
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
                    selectedItem.lane === 'Trending' ? 'error' :
                    selectedItem.lane === 'Popular' ? 'warning' :
                    selectedItem.lane === 'Recent' ? 'info' : 'default'
                  }
                >
                  {LANE_CONFIG[selectedItem.lane]?.emoji} {selectedItem.lane}
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
                    <video
                      src={getMediaUrl(selectedItem.thumbnail_url) || ''}
                      controls
                      autoPlay
                      className="max-w-full rounded"
                      preload="metadata"
                    />
                  ) : (
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
                {(selectedItem.views || selectedItem.forwards) && (
                  <span className="text-text-tertiary">
                    👁 {(selectedItem.views || 0).toLocaleString()} views
                    {selectedItem.forwards ? ` · ↗️ ${selectedItem.forwards} forwards` : ''}
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
