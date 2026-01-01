'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Badge, StatCard } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin - Spam Review Queue
 *
 * Review and manage messages flagged as spam.
 * Supports bulk actions, expandable content preview, quick filters,
 * and keyboard shortcuts for efficient review workflow.
 */

interface SpamItem {
  message_id: number;
  posted_at: string;
  content_preview: string;
  content_translated: string | null;
  language_detected: string | null;
  spam_type: string | null;
  spam_reason: string | null;
  spam_confidence: number | null;
  spam_review_status: string | null;
  channel_name: string;
  channel_username: string | null;
  source_type: string | null;
  affiliation: string | null;
  telegram_url: string | null;
}

interface SpamStats {
  total_spam: number;
  pending_review: number;
  false_positives: number;
  true_positives: number;
  spam_rate_24h: number;
  spam_by_type: Record<string, number>;
}

type ReviewStatus = 'pending' | 'reviewed' | 'false_positive' | 'true_positive';

export default function SpamPage() {
  const [items, setItems] = useState<SpamItem[]>([]);
  const [stats, setStats] = useState<SpamStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [channelFilter, setChannelFilter] = useState<string>('');
  const [minConfidence, setMinConfidence] = useState<number>(0);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [translationMode, setTranslationMode] = useState<'original' | 'translation'>('original');

  const tableRef = useRef<HTMLDivElement>(null);

  // Load translation preference and listen for changes
  useEffect(() => {
    // Load initial preference from localStorage
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('translationMode');
      if (saved === 'translation' || saved === 'original') {
        setTranslationMode(saved);
      }
    }

    // Listen for changes from HeaderNav toggle
    const handleTranslationChange = (e: CustomEvent<'original' | 'translation'>) => {
      setTranslationMode(e.detail);
    };

    window.addEventListener('translationModeChange', handleTranslationChange as EventListener);
    return () => {
      window.removeEventListener('translationModeChange', handleTranslationChange as EventListener);
    };
  }, []);

  // Helper to get display content based on translation mode
  const getDisplayContent = (item: SpamItem): string => {
    if (translationMode === 'translation' && item.content_translated) {
      return item.content_translated;
    }
    return item.content_preview || '(No content)';
  };

  const fetchSpam = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: '50',
      });
      if (statusFilter) params.append('status', statusFilter);
      if (typeFilter) params.append('spam_type', typeFilter);
      if (channelFilter) params.append('channel', channelFilter);

      const data = await adminApi.get(`/api/admin/spam/?${params}`);

      // Filter by confidence client-side for smoother UX
      let filtered = data.items;
      if (minConfidence > 0) {
        filtered = filtered.filter((item: SpamItem) =>
          (item.spam_confidence ?? 0) >= minConfidence / 100
        );
      }

      setItems(filtered);
      setTotalPages(data.total_pages);
      setTotalItems(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, typeFilter, channelFilter, minConfidence]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await adminApi.get('/api/admin/spam/stats');
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch spam stats:', err);
    }
  }, []);

  useEffect(() => {
    fetchSpam();
    fetchStats();
  }, [fetchSpam, fetchStats]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'j': // Move down
          e.preventDefault();
          setFocusedIndex(prev => Math.min(prev + 1, items.length - 1));
          break;
        case 'k': // Move up
          e.preventDefault();
          setFocusedIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'f': // Mark as false positive
          e.preventDefault();
          if (focusedIndex >= 0 && items[focusedIndex]) {
            handleReview(items[focusedIndex].message_id, 'false_positive');
          }
          break;
        case 't': // Mark as true positive (confirm spam)
          e.preventDefault();
          if (focusedIndex >= 0 && items[focusedIndex]) {
            handleReview(items[focusedIndex].message_id, 'true_positive');
          }
          break;
        case 'x': // Toggle selection
          e.preventDefault();
          if (focusedIndex >= 0 && items[focusedIndex]) {
            toggleSelection(items[focusedIndex].message_id);
          }
          break;
        case 'e': // Expand/collapse row
          e.preventDefault();
          if (focusedIndex >= 0 && items[focusedIndex]) {
            toggleExpanded(items[focusedIndex].message_id);
          }
          break;
        case 'o': // Open in new tab
          e.preventDefault();
          if (focusedIndex >= 0 && items[focusedIndex]) {
            window.open(`/messages/${items[focusedIndex].message_id}`, '_blank');
          }
          break;
        case '?': // Toggle shortcut help
          e.preventDefault();
          setShowShortcuts(prev => !prev);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedIndex, items]);

  // Scroll focused row into view
  useEffect(() => {
    if (focusedIndex >= 0 && tableRef.current) {
      const row = tableRef.current.querySelector(`[data-row-index="${focusedIndex}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [focusedIndex]);

  const toggleSelection = (id: number) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleExpanded = (id: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleReview = async (messageId: number, status: ReviewStatus) => {
    try {
      await adminApi.put(`/api/admin/spam/${messageId}/review?status=${status}`);
      fetchSpam();
      fetchStats();
    } catch (err) {
      alert('Failed to update: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleBulkReview = async (status: ReviewStatus) => {
    if (selectedKeys.size === 0) return;
    try {
      await adminApi.post('/api/admin/spam/bulk-review', {
        message_ids: Array.from(selectedKeys),
        status,
      });
      setSelectedKeys(new Set());
      fetchSpam();
      fetchStats();
    } catch (err) {
      alert('Failed to bulk update: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleDelete = async (messageId: number) => {
    if (!confirm('Permanently delete this message? This cannot be undone.')) return;
    try {
      await adminApi.delete(`/api/admin/spam/${messageId}`);
      fetchSpam();
      fetchStats();
    } catch (err) {
      alert('Failed to delete: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedKeys.size === 0) return;
    if (!confirm(`Permanently delete ${selectedKeys.size} message(s)? This cannot be undone.`)) return;
    try {
      const data = await adminApi.post('/api/admin/spam/bulk-delete', {
        message_ids: Array.from(selectedKeys),
      });
      setSelectedKeys(new Set());
      fetchSpam();
      fetchStats();
      alert(`Deleted ${data.deleted_count} message(s)`);
    } catch (err) {
      alert('Failed to bulk delete: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handlePurgeConfirmed = async () => {
    if (!confirm('Permanently delete ALL confirmed spam? This cannot be undone!')) return;
    try {
      const data = await adminApi.delete('/api/admin/spam/purge/confirmed');
      fetchSpam();
      fetchStats();
      alert(data.message);
    } catch (err) {
      alert('Failed to purge: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const selectAllPending = () => {
    const pendingIds = items
      .filter(item => item.spam_review_status === 'pending')
      .map(item => item.message_id);
    setSelectedKeys(new Set(pendingIds));
  };

  const getConfidenceColor = (confidence: number | null): string => {
    if (!confidence) return 'text-text-tertiary';
    if (confidence >= 0.9) return 'text-red-500';
    if (confidence >= 0.7) return 'text-orange-500';
    return 'text-yellow-500';
  };

  const getAffiliationBadge = (affiliation: string | null) => {
    if (!affiliation) return null;
    const colors: Record<string, 'info' | 'warning' | 'error'> = {
      ukrainian: 'info',
      russian: 'error',
      neutral: 'warning',
    };
    return (
      <Badge variant={colors[affiliation] || 'default'} size="sm">
        {affiliation}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Spam Review</h1>
          <p className="text-text-secondary mt-1">
            Review messages flagged as spam and mark false positives
          </p>
        </div>
        <button
          onClick={() => setShowShortcuts(prev => !prev)}
          className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-secondary rounded transition-colors"
          title="Keyboard Shortcuts (?)"
        >
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-bg-tertiary rounded text-xs">?</kbd>
            Shortcuts
          </span>
        </button>
      </div>

      {/* Keyboard Shortcuts Panel */}
      {showShortcuts && (
        <div className="glass p-4 border border-border-subtle">
          <h3 className="font-semibold text-text-primary mb-3">Keyboard Shortcuts</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><kbd className="px-2 py-1 bg-bg-tertiary rounded mr-2">j</kbd> Move down</div>
            <div><kbd className="px-2 py-1 bg-bg-tertiary rounded mr-2">k</kbd> Move up</div>
            <div><kbd className="px-2 py-1 bg-bg-tertiary rounded mr-2">f</kbd> Mark false positive</div>
            <div><kbd className="px-2 py-1 bg-bg-tertiary rounded mr-2">t</kbd> Confirm spam</div>
            <div><kbd className="px-2 py-1 bg-bg-tertiary rounded mr-2">x</kbd> Toggle selection</div>
            <div><kbd className="px-2 py-1 bg-bg-tertiary rounded mr-2">e</kbd> Expand/collapse</div>
            <div><kbd className="px-2 py-1 bg-bg-tertiary rounded mr-2">o</kbd> Open message</div>
            <div><kbd className="px-2 py-1 bg-bg-tertiary rounded mr-2">?</kbd> Toggle this help</div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard
            title="Pending Review"
            value={stats.pending_review}
            icon={<span className="text-2xl">⏳</span>}
          />
          <StatCard
            title="Total Spam"
            value={stats.total_spam}
            icon={<span className="text-2xl">🚫</span>}
          />
          <StatCard
            title="Confirmed Spam"
            value={stats.true_positives}
            icon={<span className="text-2xl">✓</span>}
          />
          <StatCard
            title="False Positives"
            value={stats.false_positives}
            icon={<span className="text-2xl">❌</span>}
          />
          <StatCard
            title="Spam Rate (24h)"
            value={`${stats.spam_rate_24h}%`}
            icon={<span className="text-2xl">📊</span>}
          />
        </div>
      )}

      {/* Purge Action */}
      {stats && stats.true_positives > 0 && (
        <div className="glass p-4 border border-red-500/30 bg-red-500/5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-text-primary">Purge Confirmed Spam</h3>
              <p className="text-sm text-text-secondary">
                Permanently delete {stats.true_positives} confirmed spam message{stats.true_positives !== 1 ? 's' : ''} from the database
              </p>
            </div>
            <button
              onClick={handlePurgeConfirmed}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium transition-colors"
            >
              🗑️ Purge All Confirmed
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="glass p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm text-text-secondary mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="reviewed">Reviewed</option>
              <option value="false_positive">False Positive</option>
              <option value="true_positive">True Positive</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Spam Type</label>
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
              className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
            >
              <option value="">All Types</option>
              <option value="promotion">Promotion</option>
              <option value="repetitive">Repetitive</option>
              <option value="off_topic">Off Topic</option>
              <option value="bot">Bot</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Channel</label>
            <input
              type="text"
              value={channelFilter}
              onChange={(e) => { setChannelFilter(e.target.value); setPage(1); }}
              placeholder="Search channel..."
              className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm w-40"
            />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">
              Min Confidence: {minConfidence}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={minConfidence}
              onChange={(e) => { setMinConfidence(parseInt(e.target.value)); setPage(1); }}
              className="w-32 h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer"
            />
          </div>
          <div className="ml-auto flex gap-2">
            <button
              onClick={selectAllPending}
              className="px-3 py-2 text-sm bg-bg-secondary hover:bg-bg-tertiary rounded transition-colors"
            >
              Select All Pending
            </button>
          </div>
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedKeys.size > 0 && (
        <div className="glass p-3 flex items-center gap-4 sticky top-0 z-10">
          <span className="text-sm text-text-secondary">
            {selectedKeys.size} selected
          </span>
          <button
            onClick={() => handleBulkReview('false_positive')}
            className="px-3 py-1.5 bg-orange-500/10 text-orange-500 rounded text-sm hover:bg-orange-500/20 transition-colors"
          >
            Mark False Positive
          </button>
          <button
            onClick={() => handleBulkReview('true_positive')}
            className="px-3 py-1.5 bg-green-500/10 text-green-500 rounded text-sm hover:bg-green-500/20 transition-colors"
          >
            Confirm Spam
          </button>
          <button
            onClick={handleBulkDelete}
            className="px-3 py-1.5 bg-red-500/10 text-red-500 rounded text-sm hover:bg-red-500/20 transition-colors"
          >
            🗑️ Delete Selected
          </button>
          <button
            onClick={() => setSelectedKeys(new Set())}
            className="px-3 py-1.5 text-text-tertiary hover:text-text-secondary text-sm transition-colors"
          >
            Clear Selection
          </button>
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
        <div className="glass p-8 text-center">
          <div className="animate-spin inline-block w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
          <p className="mt-2 text-text-secondary">Loading spam queue...</p>
        </div>
      )}

      {/* Spam List */}
      {!loading && !error && (
        <div ref={tableRef} className="space-y-2">
          {items.map((item, index) => {
            const isExpanded = expandedRows.has(item.message_id);
            const isSelected = selectedKeys.has(item.message_id);
            const isFocused = index === focusedIndex;

            return (
              <div
                key={item.message_id}
                data-row-index={index}
                className={`glass p-4 transition-all ${
                  isFocused ? 'ring-2 ring-blue-500' : ''
                } ${isSelected ? 'bg-blue-500/10' : ''}`}
                onClick={() => setFocusedIndex(index)}
              >
                {/* Main Row */}
                <div className="flex items-start gap-4">
                  {/* Selection Checkbox */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelection(item.message_id)}
                    className="mt-1 w-4 h-4 rounded border-border-subtle"
                  />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      {/* Channel */}
                      <span className="font-medium text-text-primary">
                        {item.channel_name}
                      </span>
                      {item.channel_username && (
                        <span className="text-text-tertiary text-sm">
                          @{item.channel_username}
                        </span>
                      )}
                      {/* Affiliation Badge */}
                      {getAffiliationBadge(item.affiliation)}
                      {/* Date */}
                      <span className="text-text-tertiary text-sm">
                        {new Date(item.posted_at).toLocaleString()}
                      </span>
                    </div>

                    {/* Content Preview */}
                    <p
                      className={`text-text-secondary text-sm ${!isExpanded ? 'line-clamp-2' : ''}`}
                      onClick={() => toggleExpanded(item.message_id)}
                    >
                      {getDisplayContent(item)}
                      {/* Show translation indicator */}
                      {translationMode === 'translation' && item.content_translated && (
                        <span className="ml-2 text-xs text-blue-400">[EN]</span>
                      )}
                    </p>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-border-subtle space-y-3">
                        {/* Show both original and translated when in translation mode */}
                        {item.content_translated && translationMode === 'translation' && (
                          <div className="bg-bg-tertiary rounded p-3">
                            <div className="text-xs text-text-tertiary font-medium mb-1">
                              Original ({item.language_detected || 'unknown'})
                            </div>
                            <p className="text-sm text-text-secondary">
                              {item.content_preview}
                            </p>
                          </div>
                        )}

                        {/* Show translation when in original mode and translation exists */}
                        {item.content_translated && translationMode === 'original' && (
                          <div className="bg-blue-500/10 border border-blue-500/20 rounded p-3">
                            <div className="text-xs text-blue-400 font-medium mb-1">
                              Translation (English)
                            </div>
                            <p className="text-sm text-blue-200">
                              {item.content_translated}
                            </p>
                          </div>
                        )}

                        {/* Spam Reason */}
                        {item.spam_reason && (
                          <div className="bg-red-500/10 border border-red-500/20 rounded p-3">
                            <div className="text-xs text-red-400 font-medium mb-1">
                              Spam Reason
                            </div>
                            <p className="text-sm text-red-300">
                              {item.spam_reason}
                            </p>
                          </div>
                        )}

                        {/* Meta Info */}
                        <div className="flex flex-wrap gap-3 text-sm">
                          {item.language_detected && (
                            <span className="text-text-tertiary">
                              Language: <strong>{item.language_detected}</strong>
                            </span>
                          )}
                          {item.source_type && (
                            <span className="text-text-tertiary">
                              Source: <strong>{item.source_type}</strong>
                            </span>
                          )}
                        </div>

                        {/* Links */}
                        <div className="flex gap-4">
                          <a
                            href={`/messages/${item.message_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline text-sm"
                          >
                            View in Archive →
                          </a>
                          {item.telegram_url && (
                            <a
                              href={item.telegram_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-500 hover:underline text-sm"
                            >
                              Open in Telegram →
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right Side - Badges & Actions */}
                  <div className="flex flex-col items-end gap-2">
                    {/* Confidence */}
                    <span className={`text-lg font-bold ${getConfidenceColor(item.spam_confidence)}`}>
                      {item.spam_confidence ? `${Math.round(item.spam_confidence * 100)}%` : '-'}
                    </span>

                    {/* Badges */}
                    <div className="flex gap-1">
                      {item.spam_type && (
                        <Badge variant={item.spam_type === 'promotion' ? 'warning' : 'default'} size="sm">
                          {item.spam_type}
                        </Badge>
                      )}
                      <Badge
                        variant={
                          item.spam_review_status === 'pending' ? 'warning' :
                          item.spam_review_status === 'false_positive' ? 'error' :
                          item.spam_review_status === 'true_positive' ? 'success' : 'default'
                        }
                        size="sm"
                      >
                        {item.spam_review_status || 'pending'}
                      </Badge>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1 mt-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleExpanded(item.message_id); }}
                        className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-secondary rounded transition-colors"
                        title="Expand/Collapse (e)"
                      >
                        <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleReview(item.message_id, 'false_positive'); }}
                        className="p-1.5 text-red-500 hover:bg-red-500/10 rounded transition-colors"
                        title="Mark as False Positive (f)"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleReview(item.message_id, 'true_positive'); }}
                        className="p-1.5 text-green-500 hover:bg-green-500/10 rounded transition-colors"
                        title="Confirm Spam (t)"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(item.message_id); }}
                        className="p-1.5 text-red-600 hover:bg-red-600/10 rounded transition-colors"
                        title="Delete Permanently"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                      <a
                        href={`/messages/${item.message_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 text-blue-500 hover:bg-blue-500/10 rounded transition-colors"
                        title="View Message (o)"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Empty State */}
          {items.length === 0 && (
            <div className="glass p-12 text-center">
              <span className="text-6xl block mb-4">✅</span>
              <p className="text-text-secondary">No spam messages found</p>
              {(statusFilter || typeFilter || channelFilter || minConfidence > 0) && (
                <button
                  onClick={() => {
                    setStatusFilter('');
                    setTypeFilter('');
                    setChannelFilter('');
                    setMinConfidence(0);
                  }}
                  className="mt-4 text-blue-500 hover:underline"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 bg-bg-secondary rounded hover:bg-bg-tertiary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-text-secondary">
            Page {page} of {totalPages} ({totalItems} total)
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
    </div>
  );
}
