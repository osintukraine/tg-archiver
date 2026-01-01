'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Badge, StatCard } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin - Fact-Check Review Queue
 *
 * Review and manage discrepancies between original classifications and fact-check results.
 * Features:
 * - Three tabs: Pending Review, Reviewed, All
 * - Stats cards showing total checked, pending, accuracy, hidden
 * - Expandable rows with full details and translations
 * - Bulk actions: approve, delete
 * - Keyboard shortcuts for efficient review
 */

interface FactCheckItem {
  id: number;
  message_id: number;
  content_preview: string;
  content_translated: string | null;
  channel_name: string;
  channel_username: string | null;
  telegram_url: string | null;

  // Original classification
  original_topic: string | null;
  original_is_spam: boolean | null;

  // Fact-check classification
  factcheck_topic: string | null;
  factcheck_is_spam: boolean | null;
  factcheck_spam_type: string | null;
  factcheck_confidence: number | null;
  factcheck_reasoning: string | null;

  // Discrepancy info
  discrepancy_type: string | null;
  human_reviewed: boolean;
  created_at: string;
}

interface FactCheckStats {
  total_checked: number;
  pending_review: number;
  accuracy_rate: number;
  discrepancies_total: number;
  topic_mismatches: number;
  spam_mismatches: number;
  discrepancies_by_type: Record<string, number>;
}

type TabType = 'pending' | 'reviewed' | 'all';

export default function FactCheckPage() {
  const [items, setItems] = useState<FactCheckItem[]>([]);
  const [stats, setStats] = useState<FactCheckStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(new Set());
  const [activeTab, setActiveTab] = useState<TabType>('pending');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [translationMode, setTranslationMode] = useState<'original' | 'translation'>('original');

  const tableRef = useRef<HTMLDivElement>(null);

  // Load translation preference and listen for changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('translationMode');
      if (saved === 'translation' || saved === 'original') {
        setTranslationMode(saved);
      }
    }

    const handleTranslationChange = (e: CustomEvent<'original' | 'translation'>) => {
      setTranslationMode(e.detail);
    };

    window.addEventListener('translationModeChange', handleTranslationChange as EventListener);
    return () => {
      window.removeEventListener('translationModeChange', handleTranslationChange as EventListener);
    };
  }, []);

  // Helper to get display content based on translation mode
  const getDisplayContent = (item: FactCheckItem): string => {
    if (translationMode === 'translation' && item.content_translated) {
      return item.content_translated;
    }
    return item.content_preview || '(No content)';
  };

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: '50',
      });

      let data;
      switch (activeTab) {
        case 'pending':
          data = await adminApi.factCheck.getPending(params.toString());
          break;
        case 'reviewed':
          data = await adminApi.factCheck.getReviewed(params.toString());
          break;
        case 'all':
          data = await adminApi.factCheck.getAll(params.toString());
          break;
      }

      setItems(data.items);
      setTotalPages(data.total_pages);
      setTotalItems(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [page, activeTab]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await adminApi.factCheck.getStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch fact-check stats:', err);
    }
  }, []);

  useEffect(() => {
    fetchItems();
    fetchStats();
  }, [fetchItems, fetchStats]);

  // Reset page when changing tabs
  useEffect(() => {
    setPage(1);
    setSelectedKeys(new Set());
  }, [activeTab]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 'j':
          e.preventDefault();
          setFocusedIndex(prev => Math.min(prev + 1, items.length - 1));
          break;
        case 'k':
          e.preventDefault();
          setFocusedIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'a':
          e.preventDefault();
          if (focusedIndex >= 0 && items[focusedIndex]) {
            handleApprove(items[focusedIndex].id);
          }
          break;
        case 'r':
          e.preventDefault();
          if (focusedIndex >= 0 && items[focusedIndex]) {
            handleReject(items[focusedIndex].id);
          }
          break;
        case 'x':
          e.preventDefault();
          if (focusedIndex >= 0 && items[focusedIndex]) {
            toggleSelection(items[focusedIndex].id);
          }
          break;
        case 'e':
          e.preventDefault();
          if (focusedIndex >= 0 && items[focusedIndex]) {
            toggleExpanded(items[focusedIndex].id);
          }
          break;
        case 'o':
          e.preventDefault();
          if (focusedIndex >= 0 && items[focusedIndex]) {
            window.open(`/messages/${items[focusedIndex].message_id}`, '_blank');
          }
          break;
        case '?':
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

  const handleApprove = async (id: number) => {
    try {
      await adminApi.factCheck.approve(id);
      fetchItems();
      fetchStats();
    } catch (err) {
      alert('Failed to approve: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleReject = async (id: number) => {
    try {
      await adminApi.factCheck.reject(id);
      fetchItems();
      fetchStats();
    } catch (err) {
      alert('Failed to reject: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleUnhide = async (messageId: number) => {
    try {
      await adminApi.factCheck.unhide(messageId);
      fetchItems();
      fetchStats();
    } catch (err) {
      alert('Failed to unhide: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleDelete = async (messageId: number) => {
    if (!confirm('Permanently delete this message? This cannot be undone.')) return;
    try {
      await adminApi.factCheck.delete(messageId);
      fetchItems();
      fetchStats();
    } catch (err) {
      alert('Failed to delete: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleBulkApprove = async () => {
    if (selectedKeys.size === 0) return;
    try {
      await adminApi.factCheck.bulkApprove(Array.from(selectedKeys) as number[]);
      setSelectedKeys(new Set());
      fetchItems();
      fetchStats();
    } catch (err) {
      alert('Failed to bulk approve: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedKeys.size === 0) return;
    if (!confirm(`Permanently delete ${selectedKeys.size} message(s)? This cannot be undone.`)) return;
    try {
      const data = await adminApi.factCheck.bulkDelete(Array.from(selectedKeys) as number[]);
      setSelectedKeys(new Set());
      fetchItems();
      fetchStats();
      alert(`Deleted ${data.deleted_count} message(s)`);
    } catch (err) {
      alert('Failed to bulk delete: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const selectAllPending = () => {
    const pendingIds = items
      .filter(item => !item.human_reviewed)
      .map(item => item.id);
    setSelectedKeys(new Set(pendingIds));
  };

  const getDiscrepancyBadge = (type: string | null) => {
    if (!type) return null;
    const colors: Record<string, 'error' | 'warning' | 'info'> = {
      spam_mismatch: 'error',
      topic_mismatch: 'warning',
      both_mismatch: 'error',
    };
    return (
      <Badge variant={colors[type] || 'default'} size="sm">
        {type.replace('_', ' ')}
      </Badge>
    );
  };

  const getConfidenceColor = (confidence: number | null): string => {
    if (!confidence) return 'text-text-tertiary';
    if (confidence >= 0.9) return 'text-green-500';
    if (confidence >= 0.7) return 'text-yellow-500';
    return 'text-orange-500';
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Fact-Check Review</h1>
          <p className="text-text-secondary mt-1">
            Review discrepancies between original and fact-check classifications
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
            <div><kbd className="px-2 py-1 bg-bg-tertiary rounded mr-2">a</kbd> Approve</div>
            <div><kbd className="px-2 py-1 bg-bg-tertiary rounded mr-2">r</kbd> Reject</div>
            <div><kbd className="px-2 py-1 bg-bg-tertiary rounded mr-2">x</kbd> Toggle selection</div>
            <div><kbd className="px-2 py-1 bg-bg-tertiary rounded mr-2">e</kbd> Expand/collapse</div>
            <div><kbd className="px-2 py-1 bg-bg-tertiary rounded mr-2">o</kbd> Open message</div>
            <div><kbd className="px-2 py-1 bg-bg-tertiary rounded mr-2">?</kbd> Toggle this help</div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="Total Checked"
            value={stats.total_checked}
            icon={<span className="text-2xl">📋</span>}
          />
          <StatCard
            title="Pending Review"
            value={stats.pending_review}
            icon={<span className="text-2xl">⏳</span>}
          />
          <StatCard
            title="Accuracy Rate"
            value={`${stats.accuracy_rate}%`}
            icon={<span className="text-2xl">✓</span>}
          />
          <StatCard
            title="Discrepancies"
            value={stats.discrepancies_total}
            icon={<span className="text-2xl">⚠️</span>}
          />
        </div>
      )}

      {/* Tabs */}
      <div className="glass p-1 flex gap-1">
        <button
          onClick={() => setActiveTab('pending')}
          className={`flex-1 px-4 py-2 rounded text-sm font-medium transition-colors ${
            activeTab === 'pending'
              ? 'bg-blue-500 text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'
          }`}
        >
          Pending Review
          {stats && stats.pending_review > 0 && (
            <span className="ml-2 px-2 py-0.5 bg-white/20 rounded-full text-xs">
              {stats.pending_review}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('reviewed')}
          className={`flex-1 px-4 py-2 rounded text-sm font-medium transition-colors ${
            activeTab === 'reviewed'
              ? 'bg-blue-500 text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'
          }`}
        >
          Reviewed
        </button>
        <button
          onClick={() => setActiveTab('all')}
          className={`flex-1 px-4 py-2 rounded text-sm font-medium transition-colors ${
            activeTab === 'all'
              ? 'bg-blue-500 text-white'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'
          }`}
        >
          All
        </button>
      </div>

      {/* Quick Actions */}
      {activeTab === 'pending' && (
        <div className="glass p-4">
          <div className="flex justify-end gap-2">
            <button
              onClick={selectAllPending}
              className="px-3 py-2 text-sm bg-bg-secondary hover:bg-bg-tertiary rounded transition-colors"
            >
              Select All Pending
            </button>
          </div>
        </div>
      )}

      {/* Bulk Actions */}
      {selectedKeys.size > 0 && (
        <div className="glass p-3 flex items-center gap-4 sticky top-0 z-10">
          <span className="text-sm text-text-secondary">
            {selectedKeys.size} selected
          </span>
          <button
            onClick={handleBulkApprove}
            className="px-3 py-1.5 bg-green-500/10 text-green-500 rounded text-sm hover:bg-green-500/20 transition-colors"
          >
            ✓ Approve Selected
          </button>
          <button
            onClick={handleBulkDelete}
            className="px-3 py-1.5 bg-red-500/10 text-red-500 rounded text-sm hover:bg-red-500/20 transition-colors"
          >
            🗑 Delete Selected
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
          <p className="mt-2 text-text-secondary">Loading fact-check queue...</p>
        </div>
      )}

      {/* Items List */}
      {!loading && !error && (
        <div ref={tableRef} className="space-y-2">
          {items.map((item, index) => {
            const isExpanded = expandedRows.has(item.id);
            const isSelected = selectedKeys.has(item.id);
            const isFocused = index === focusedIndex;

            return (
              <div
                key={item.id}
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
                    onChange={() => toggleSelection(item.id)}
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
                      {/* Discrepancy Badge */}
                      {getDiscrepancyBadge(item.discrepancy_type)}
                      {/* Date */}
                      <span className="text-text-tertiary text-sm">
                        {new Date(item.created_at).toLocaleString()}
                      </span>
                    </div>

                    {/* Content Preview */}
                    <p
                      className={`text-text-secondary text-sm ${!isExpanded ? 'line-clamp-2' : ''}`}
                      onClick={() => toggleExpanded(item.id)}
                    >
                      {getDisplayContent(item)}
                      {translationMode === 'translation' && item.content_translated && (
                        <span className="ml-2 text-xs text-blue-400">[EN]</span>
                      )}
                    </p>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-border-subtle space-y-3">
                        {/* Translation Toggle */}
                        {item.content_translated && translationMode === 'translation' && (
                          <div className="bg-bg-tertiary rounded p-3">
                            <div className="text-xs text-text-tertiary font-medium mb-1">
                              Original
                            </div>
                            <p className="text-sm text-text-secondary">
                              {item.content_preview}
                            </p>
                          </div>
                        )}

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

                        {/* Classification Comparison */}
                        <div className="grid grid-cols-2 gap-4">
                          {/* Original Classification */}
                          <div className="bg-bg-tertiary rounded p-3">
                            <div className="text-xs text-text-tertiary font-medium mb-2">
                              Original Classification
                            </div>
                            <div className="space-y-1 text-sm">
                              <div>
                                <span className="text-text-tertiary">Topic: </span>
                                <span className="text-text-primary font-medium">
                                  {item.original_topic || 'none'}
                                </span>
                              </div>
                              <div>
                                <span className="text-text-tertiary">Spam: </span>
                                <span className={item.original_is_spam ? 'text-red-400' : 'text-green-400'}>
                                  {item.original_is_spam ? 'Yes' : 'No'}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Fact-Check Classification */}
                          <div className="bg-blue-500/10 border border-blue-500/20 rounded p-3">
                            <div className="text-xs text-blue-400 font-medium mb-2">
                              Fact-Check Classification
                            </div>
                            <div className="space-y-1 text-sm">
                              <div>
                                <span className="text-text-tertiary">Topic: </span>
                                <span className="text-blue-200 font-medium">
                                  {item.factcheck_topic || 'none'}
                                </span>
                              </div>
                              <div>
                                <span className="text-text-tertiary">Spam: </span>
                                <span className={item.factcheck_is_spam ? 'text-red-400' : 'text-green-400'}>
                                  {item.factcheck_is_spam ? 'Yes' : 'No'}
                                </span>
                                {item.factcheck_confidence != null && (
                                  <span className={`ml-2 ${getConfidenceColor(item.factcheck_confidence)}`}>
                                    ({Math.round(item.factcheck_confidence * 100)}%)
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Fact-Check Reasoning */}
                        {item.factcheck_reasoning && (
                          <div className="bg-blue-500/10 border border-blue-500/20 rounded p-3">
                            <div className="text-xs text-blue-400 font-medium mb-1">
                              Fact-Check Reasoning
                            </div>
                            <p className="text-sm text-blue-200 whitespace-pre-wrap">
                              {item.factcheck_reasoning}
                            </p>
                          </div>
                        )}

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

                  {/* Right Side - Status & Actions */}
                  <div className="flex flex-col items-end gap-2">
                    {/* Review Status */}
                    <Badge
                      variant={item.human_reviewed ? 'success' : 'warning'}
                      size="sm"
                    >
                      {item.human_reviewed ? 'reviewed' : 'pending'}
                    </Badge>

                    {/* Actions */}
                    <div className="flex gap-1 mt-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleExpanded(item.id); }}
                        className="p-1.5 text-text-tertiary hover:text-text-primary hover:bg-bg-secondary rounded transition-colors"
                        title="Expand/Collapse (e)"
                      >
                        <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {!item.human_reviewed && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleApprove(item.id); }}
                            className="p-1.5 text-green-500 hover:bg-green-500/10 rounded transition-colors"
                            title="Approve Fact-Check (a)"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleReject(item.id); }}
                            className="p-1.5 text-orange-500 hover:bg-orange-500/10 rounded transition-colors"
                            title="Reject Fact-Check (r)"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </>
                      )}
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
              <p className="text-text-secondary">
                {activeTab === 'pending' && 'No pending fact-checks'}
                {activeTab === 'reviewed' && 'No reviewed fact-checks'}
                {activeTab === 'all' && 'No fact-checks found'}
              </p>
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
