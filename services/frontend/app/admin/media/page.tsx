'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge, StatCard } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';
import { getMediaUrl } from '@/lib/api';

/**
 * Admin - Media Gallery
 *
 * Visual browser for archived photos and videos.
 * Supports filtering by type, importance, channel, and topic.
 */

interface MediaItem {
  message_id: number;
  post_id: number;
  posted_at: string;
  caption: string | null;
  media_type: string;
  s3_key: string | null;
  mime_type: string | null;
  file_size: number | null;
  media_url: string | null;
  importance_level: string | null;
  topic: string | null;
  sentiment: string | null;
  channel_name: string;
  channel_username: string | null;
  source_type: string | null;
}

interface MediaStats {
  total_files: number;
  total_size_gb: number;
  photos_count: number;
  videos_count: number;
  documents_count: number;
  by_channel: Record<string, { count: number; size_mb: number }>;
  by_importance: Record<string, number>;
}

type MediaType = 'photo' | 'video' | 'document' | '';

export default function MediaPage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [stats, setStats] = useState<MediaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [typeFilter, setTypeFilter] = useState<MediaType>('');
  const [importanceFilter, setImportanceFilter] = useState<string>('');
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);

  const fetchMedia = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: '48',  // 6x8 grid
      });
      if (typeFilter) params.append('media_type', typeFilter);
      if (importanceFilter) params.append('importance', importanceFilter);

      const data = await adminApi.get(`/api/admin/media?${params}`);
      setItems(data.items);
      setTotalPages(data.total_pages);
      setTotalItems(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter, importanceFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await adminApi.get('/api/admin/media/stats');
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch media stats:', err);
    }
  }, []);

  useEffect(() => {
    fetchMedia();
    fetchStats();
  }, [fetchMedia, fetchStats]);

  const formatFileSize = (bytes: number | null): string => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getMediaIcon = (type: string) => {
    switch (type) {
      case 'photo': return '🖼️';
      case 'video': return '🎬';
      case 'document': return '📄';
      case 'audio': return '🎵';
      default: return '📁';
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Media Gallery</h1>
        <p className="text-text-secondary mt-1">
          Browse archived photos, videos, and documents
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard
            title="Total Files"
            value={stats.total_files.toLocaleString()}
            icon={<span className="text-2xl">📁</span>}
          />
          <StatCard
            title="Storage Used"
            value={`${stats.total_size_gb} GB`}
            icon={<span className="text-2xl">💾</span>}
          />
          <StatCard
            title="Photos"
            value={stats.photos_count.toLocaleString()}
            icon={<span className="text-2xl">🖼️</span>}
          />
          <StatCard
            title="Videos"
            value={stats.videos_count.toLocaleString()}
            icon={<span className="text-2xl">🎬</span>}
          />
          <StatCard
            title="Documents"
            value={stats.documents_count.toLocaleString()}
            icon={<span className="text-2xl">📄</span>}
          />
        </div>
      )}

      {/* Filters */}
      <div className="glass p-4 flex flex-wrap gap-4">
        <div>
          <label className="block text-sm text-text-secondary mb-1">Media Type</label>
          <select
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value as MediaType); setPage(1); }}
            className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
          >
            <option value="">All Types</option>
            <option value="photo">Photos</option>
            <option value="video">Videos</option>
            <option value="document">Documents</option>
          </select>
        </div>
        <div>
          <label className="block text-sm text-text-secondary mb-1">Importance</label>
          <select
            value={importanceFilter}
            onChange={(e) => { setImportanceFilter(e.target.value); setPage(1); }}
            className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
          >
            <option value="">All</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="ml-auto text-text-secondary text-sm self-end">
          {totalItems.toLocaleString()} items
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="glass p-8 text-center text-red-500">
          Error: {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="glass aspect-square animate-pulse">
              <div className="w-full h-full bg-bg-tertiary rounded-lg" />
            </div>
          ))}
        </div>
      )}

      {/* Media Grid */}
      {!loading && !error && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {items.map((item) => (
            <div
              key={item.message_id}
              className="glass overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all group"
              onClick={() => setSelectedItem(item)}
            >
              <div className="aspect-square relative bg-bg-tertiary">
                {item.media_url && item.mime_type?.startsWith('image/') ? (
                  <img
                    src={getMediaUrl(item.media_url) || ''}
                    alt={item.caption || 'Media'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : item.media_url && item.mime_type?.startsWith('video/') ? (
                  <video
                    src={getMediaUrl(item.media_url) || ''}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                    onMouseEnter={(e) => e.currentTarget.play()}
                    onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-4xl">{getMediaIcon(item.media_type)}</span>
                  </div>
                )}

                {/* Overlay */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                  <div className="text-white text-xs truncate w-full">
                    {item.channel_name}
                  </div>
                </div>

                {/* Type badge */}
                <div className="absolute top-2 right-2">
                  <Badge variant="default" size="sm">
                    {item.media_type}
                  </Badge>
                </div>

                {/* Importance indicator */}
                {item.importance_level && ['critical', 'high'].includes(item.importance_level) && (
                  <div className="absolute top-2 left-2">
                    <Badge
                      variant={item.importance_level === 'critical' ? 'error' : 'warning'}
                      size="sm"
                    >
                      {item.importance_level}
                    </Badge>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && items.length === 0 && (
        <div className="glass p-12 text-center">
          <span className="text-6xl block mb-4">📷</span>
          <p className="text-text-secondary">No media found matching your filters</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 bg-bg-secondary rounded hover:bg-bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-text-secondary">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 bg-bg-secondary rounded hover:bg-bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}

      {/* Lightbox Modal */}
      {selectedItem && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="glass max-w-4xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border-subtle flex justify-between items-center">
              <h3 className="font-semibold text-text-primary">
                {selectedItem.channel_name}
              </h3>
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
              {selectedItem.media_url && selectedItem.mime_type?.startsWith('image/') ? (
                <img
                  src={getMediaUrl(selectedItem.media_url) || ''}
                  alt={selectedItem.caption || 'Media'}
                  className="max-w-full max-h-[60vh] mx-auto"
                />
              ) : selectedItem.media_url && selectedItem.mime_type?.startsWith('video/') ? (
                <video
                  src={getMediaUrl(selectedItem.media_url) || ''}
                  controls
                  autoPlay
                  className="max-w-full max-h-[60vh] mx-auto"
                />
              ) : (
                <div className="text-center py-12">
                  <span className="text-6xl">{getMediaIcon(selectedItem.media_type)}</span>
                  <p className="mt-4 text-text-secondary">Preview not available</p>
                </div>
              )}
              {selectedItem.caption && (
                <p className="mt-4 text-text-secondary text-sm">{selectedItem.caption}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2 text-sm text-text-tertiary">
                <span>{new Date(selectedItem.posted_at).toLocaleString()}</span>
                <span>•</span>
                <span>{formatFileSize(selectedItem.file_size)}</span>
                {selectedItem.importance_level && (
                  <>
                    <span>•</span>
                    <Badge variant="default" size="sm">{selectedItem.importance_level}</Badge>
                  </>
                )}
                {selectedItem.topic && (
                  <>
                    <span>•</span>
                    <Badge variant="info" size="sm">{selectedItem.topic}</Badge>
                  </>
                )}
              </div>
              <div className="mt-4">
                <a
                  href={`/messages/${selectedItem.message_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline text-sm"
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
