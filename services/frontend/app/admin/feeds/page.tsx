'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, StatCard, DataTable, Modal } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';
import { RSS_ENABLED } from '@/lib/constants';

/**
 * Admin - RSS Feeds Management
 *
 * Manage external RSS feeds the platform ingests for the News page.
 * Only available when NEXT_PUBLIC_RSS_ENABLED=true.
 */

// ============================================================================
// TYPES
// ============================================================================

interface RSSFeed {
  id: number;
  name: string;
  url: string;
  category: string | null;
  language: string | null;
  is_active: boolean;
  last_fetched_at: string | null;
  fetch_interval_minutes: number | null;
  error_count: number;
  last_error: string | null;
  created_at: string | null;
}

interface FeedStats {
  total_feeds: number;
  active_feeds: number;
  inactive_feeds: number;
  failing_feeds: number;
  by_category: Record<string, number>;
  total_articles: number;
}

interface FeedTestResult {
  success: boolean;
  url: string;
  title: string | null;
  description: string | null;
  item_count: number;
  sample_items: Array<{
    title: string;
    link: string;
    published: string;
    summary: string;
  }>;
  error: string | null;
}

const CATEGORIES = ['news', 'official', 'aggregator', 'community', 'other'];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function FeedsPage() {
  const router = useRouter();

  // Redirect to admin dashboard if RSS feature is disabled
  useEffect(() => {
    if (!RSS_ENABLED) {
      router.replace('/admin');
    }
  }, [router]);

  // Don't render anything while redirecting
  if (!RSS_ENABLED) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">RSS Feeds</h1>
          <p className="text-text-secondary mt-1">
            Manage external RSS feeds ingested for the News page
          </p>
        </div>
      </div>

      <FeedManagement />
    </div>
  );
}

// ============================================================================
// FEED MANAGEMENT
// ============================================================================

function FeedManagement() {
  const [feeds, setFeeds] = useState<RSSFeed[]>([]);
  const [stats, setStats] = useState<FeedStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('');
  const [activeOnly, setActiveOnly] = useState<boolean | undefined>(undefined);

  // Modals
  const [selectedFeed, setSelectedFeed] = useState<RSSFeed | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTestModal, setShowTestModal] = useState(false);
  const [testResult, setTestResult] = useState<FeedTestResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    url: '',
    category: 'news',
    language: 'en',
    is_active: true,
  });

  const fetchFeeds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: '25',
      });
      if (search) params.append('search', search);
      if (category) params.append('category', category);
      if (activeOnly !== undefined) params.append('is_active', activeOnly.toString());

      const data = await adminApi.get(`/api/admin/feeds/rss?${params}`);
      setFeeds(data.items || []);
      setTotalPages(data.total_pages || 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [page, search, category, activeOnly]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await adminApi.get('/api/admin/feeds/rss/stats');
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch feed stats:', err);
    }
  }, []);

  const handleCreate = async () => {
    try {
      const data = await adminApi.post('/api/admin/feeds/rss', formData);
      if (data.error) {
        alert(data.error);
        return;
      }
      setShowCreateModal(false);
      resetForm();
      fetchFeeds();
      fetchStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Create failed');
    }
  };

  const handleUpdate = async (feedId: number, updates: Partial<RSSFeed>) => {
    try {
      const data = await adminApi.put(`/api/admin/feeds/rss/${feedId}`, updates);
      if (data.error) {
        alert(data.error);
        return;
      }
      fetchFeeds();
      setSelectedFeed(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleDelete = async (feedId: number) => {
    if (!confirm('Are you sure you want to delete this feed? All articles will also be deleted.')) {
      return;
    }
    try {
      const data = await adminApi.delete(`/api/admin/feeds/rss/${feedId}`);
      if (data.error) {
        alert(data.error);
        return;
      }
      fetchFeeds();
      fetchStats();
      setSelectedFeed(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleTest = async (url: string) => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const data = await adminApi.post(`/api/admin/feeds/rss/test?url=${encodeURIComponent(url)}`);
      setTestResult(data);
    } catch (err) {
      setTestResult({
        success: false,
        url,
        title: null,
        description: null,
        item_count: 0,
        sample_items: [],
        error: err instanceof Error ? err.message : 'Test failed',
      });
    } finally {
      setTestLoading(false);
    }
  };

  const handleTriggerPoll = async (feedId: number) => {
    try {
      const data = await adminApi.post(`/api/admin/feeds/rss/${feedId}/poll`);
      if (data.error) {
        alert(data.error);
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Poll trigger failed');
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      url: '',
      category: 'news',
      language: 'en',
      is_active: true,
    });
  };

  useEffect(() => {
    fetchFeeds();
  }, [fetchFeeds]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const columns = [
    {
      key: 'name',
      label: 'Feed',
      render: (_: unknown, feed: RSSFeed) => (
        <div>
          <div className="font-medium text-text-primary">{feed.name}</div>
          <div className="text-xs text-text-tertiary truncate max-w-xs">{feed.url}</div>
        </div>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      render: (_: unknown, feed: RSSFeed) => (
        <Badge
          variant={
            feed.category === 'news' ? 'info' :
            feed.category === 'official' ? 'success' :
            feed.category === 'aggregator' ? 'warning' :
            feed.category === 'community' ? 'default' : 'default'
          }
          size="sm"
        >
          {feed.category || 'uncategorized'}
        </Badge>
      ),
    },
    {
      key: 'language',
      label: 'Lang',
      render: (_: unknown, feed: RSSFeed) => (
        <span className="text-sm text-text-secondary">{feed.language || '-'}</span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (_: unknown, feed: RSSFeed) => (
        <div className="flex items-center gap-2">
          <Badge variant={feed.is_active ? 'success' : 'default'} size="sm">
            {feed.is_active ? 'Active' : 'Inactive'}
          </Badge>
          {feed.error_count > 3 && (
            <Badge variant="error" size="sm">Failing</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'last_fetched',
      label: 'Last Fetch',
      render: (_: unknown, feed: RSSFeed) => (
        <span className="text-xs text-text-tertiary">
          {feed.last_fetched_at ? new Date(feed.last_fetched_at).toLocaleString() : 'Never'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, feed: RSSFeed) => (
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedFeed(feed)}
            className="text-blue-500 hover:text-blue-400 text-sm"
          >
            Edit
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 mt-6">
      {/* Add Feed Button */}
      <div className="flex justify-end">
        <button
          onClick={() => {
            resetForm();
            setShowCreateModal(true);
          }}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Add Feed
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="Total Feeds"
            value={stats.total_feeds}
            icon={<span className="text-2xl">📰</span>}
          />
          <StatCard
            title="Active"
            value={stats.active_feeds}
            icon={<span className="text-2xl text-green-500">●</span>}
          />
          <StatCard
            title="Failing"
            value={stats.failing_feeds}
            icon={<span className="text-2xl text-red-500">⚠️</span>}
          />
          <StatCard
            title="Total Articles"
            value={stats.total_articles}
            icon={<span className="text-2xl">📄</span>}
          />
        </div>
      )}

      {/* Category Filter Buttons */}
      {stats && (
        <div className="glass p-4">
          <h3 className="text-sm font-medium text-text-secondary mb-3">By Category</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.by_category).map(([cat, count]) => (
              <button
                key={cat}
                onClick={() => {
                  setCategory(category === cat ? '' : cat);
                  setPage(1);
                }}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  category === cat
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'bg-bg-secondary text-text-secondary border-border-subtle hover:bg-bg-tertiary'
                }`}
              >
                {cat} ({count})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="glass p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="col-span-2">
            <input
              type="text"
              placeholder="Search feeds..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
            />
          </div>
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
            className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
          >
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={activeOnly === true}
              onChange={(e) => setActiveOnly(e.target.checked ? true : undefined)}
              className="rounded"
            />
            Active only
          </label>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="glass p-8 text-center text-red-500">Error: {error}</div>
      )}

      {/* Table */}
      {!error && (
        <DataTable
          columns={columns}
          data={feeds}
          keyExtractor={(feed) => feed.id}
          loading={loading}
          emptyMessage="No feeds found"
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 bg-bg-secondary rounded disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-text-secondary">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 bg-bg-secondary rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Create/Edit Modal */}
      {(showCreateModal || selectedFeed) && (
        <Modal
          open={true}
          title={selectedFeed ? `Edit: ${selectedFeed.name}` : 'Add New Feed'}
          onClose={() => {
            setShowCreateModal(false);
            setSelectedFeed(null);
          }}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Name *</label>
              <input
                type="text"
                value={selectedFeed ? selectedFeed.name : formData.name}
                onChange={(e) => selectedFeed
                  ? setSelectedFeed({ ...selectedFeed, name: e.target.value })
                  : setFormData({ ...formData, name: e.target.value })
                }
                className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">URL *</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={selectedFeed ? selectedFeed.url : formData.url}
                  onChange={(e) => selectedFeed
                    ? setSelectedFeed({ ...selectedFeed, url: e.target.value })
                    : setFormData({ ...formData, url: e.target.value })
                  }
                  className="flex-1 bg-bg-secondary border border-border-subtle rounded px-3 py-2"
                />
                <button
                  onClick={() => {
                    const url = selectedFeed ? selectedFeed.url : formData.url;
                    if (url) {
                      handleTest(url);
                      setShowTestModal(true);
                    }
                  }}
                  className="px-3 py-2 bg-bg-tertiary rounded hover:bg-bg-secondary transition-colors text-sm"
                >
                  Test
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">Category</label>
                <select
                  value={selectedFeed?.category || formData.category}
                  onChange={(e) => selectedFeed
                    ? setSelectedFeed({ ...selectedFeed, category: e.target.value })
                    : setFormData({ ...formData, category: e.target.value })
                  }
                  className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Language</label>
                <input
                  type="text"
                  value={(selectedFeed?.language || formData.language) || ''}
                  onChange={(e) => selectedFeed
                    ? setSelectedFeed({ ...selectedFeed, language: e.target.value })
                    : setFormData({ ...formData, language: e.target.value })
                  }
                  className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
                  placeholder="en"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={selectedFeed ? selectedFeed.is_active : formData.is_active}
                onChange={(e) => selectedFeed
                  ? setSelectedFeed({ ...selectedFeed, is_active: e.target.checked })
                  : setFormData({ ...formData, is_active: e.target.checked })
                }
                className="rounded"
              />
              <label htmlFor="is_active" className="text-sm">Active</label>
            </div>

            {selectedFeed && (
              <div className="glass p-3 space-y-2 text-sm">
                <div>Error count: {selectedFeed.error_count}</div>
                {selectedFeed.last_error && (
                  <div className="text-red-400 text-xs">Last error: {selectedFeed.last_error}</div>
                )}
                <div>Last fetched: {selectedFeed.last_fetched_at ? new Date(selectedFeed.last_fetched_at).toLocaleString() : 'Never'}</div>
              </div>
            )}

            <div className="flex justify-between pt-4 border-t border-border-subtle">
              {selectedFeed ? (
                <>
                  <button
                    onClick={() => handleDelete(selectedFeed.id)}
                    className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => handleUpdate(selectedFeed.id, selectedFeed)}
                    className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                  >
                    Save Changes
                  </button>
                </>
              ) : (
                <button
                  onClick={handleCreate}
                  className="ml-auto px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                >
                  Create Feed
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Test Result Modal */}
      {showTestModal && (
        <Modal
          open={true}
          title="Feed Test Result"
          onClose={() => setShowTestModal(false)}
        >
          {testLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin text-4xl mb-2">⏳</div>
              <div className="text-text-secondary">Testing feed...</div>
            </div>
          ) : testResult ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant={testResult.success ? 'success' : 'error'} size="sm">
                  {testResult.success ? 'Success' : 'Failed'}
                </Badge>
                {testResult.success && (
                  <span className="text-sm text-text-secondary">
                    {testResult.item_count} items found
                  </span>
                )}
              </div>

              {testResult.error && (
                <div className="p-3 bg-red-500/10 rounded text-red-400 text-sm">
                  {testResult.error}
                </div>
              )}

              {testResult.success && (
                <>
                  <div>
                    <div className="text-sm text-text-secondary">Title</div>
                    <div className="font-medium">{testResult.title || 'No title'}</div>
                  </div>
                  {testResult.description && (
                    <div>
                      <div className="text-sm text-text-secondary">Description</div>
                      <div className="text-sm">{testResult.description}</div>
                    </div>
                  )}
                  {testResult.sample_items.length > 0 && (
                    <div>
                      <div className="text-sm text-text-secondary mb-2">Sample Items</div>
                      <div className="space-y-2">
                        {testResult.sample_items.map((item, i) => (
                          <div key={i} className="p-2 bg-bg-secondary rounded text-sm">
                            <div className="font-medium">{item.title}</div>
                            <div className="text-text-tertiary text-xs mt-1">{item.published}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : null}
        </Modal>
      )}
    </div>
  );
}

