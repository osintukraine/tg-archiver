'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge, StatCard, DataTable, Modal } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin - Feeds Management
 *
 * Unified feed management with two tabs:
 * - Ingestion: External RSS feeds the platform consumes
 * - Subscriptions: RSS/Atom/JSON feeds users subscribe to from the platform
 */

// ============================================================================
// TYPES
// ============================================================================

interface RSSFeed {
  id: number;
  name: string;
  url: string;
  website_url: string | null;
  category: string;
  trust_level: number;
  language: string | null;
  country: string | null;
  description: string | null;
  active: boolean;
  last_polled_at: string | null;
  last_successful_poll_at: string | null;
  poll_failures_count: number;
  articles_fetched_total: number;
  created_at: string | null;
  updated_at: string | null;
}

interface FeedStats {
  total_feeds: number;
  active_feeds: number;
  inactive_feeds: number;
  failing_feeds: number;
  by_category: Record<string, number>;
  by_trust_level: Record<string, number>;
  total_articles: number;
  articles_last_24h: number;
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

interface UserSubscription {
  id: number;
  user_id: string;
  user_email: string;
  feed_type: 'rss' | 'atom' | 'json';
  feed_url: string;
  query_filters: Record<string, unknown>;
  created_at: string;
  last_accessed_at: string | null;
  access_count: number;
  is_active: boolean;
}

const CATEGORIES = ['ukraine', 'russia', 'neutral', 'international'];
const TRUST_LEVELS = [1, 2, 3, 4, 5];

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function FeedsPage() {
  const [activeTab, setActiveTab] = useState<'ingestion' | 'subscriptions'>('ingestion');

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Feeds</h1>
          <p className="text-text-secondary mt-1">
            Manage RSS ingestion and user subscriptions
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border-subtle">
        <button
          onClick={() => setActiveTab('ingestion')}
          className={`px-6 py-3 font-medium text-sm transition-colors ${
            activeTab === 'ingestion'
              ? 'text-blue-500 border-b-2 border-blue-500'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          📥 Ingestion
          <span className="ml-2 text-xs text-text-tertiary">(RSS sources)</span>
        </button>
        <button
          onClick={() => setActiveTab('subscriptions')}
          className={`px-6 py-3 font-medium text-sm transition-colors ${
            activeTab === 'subscriptions'
              ? 'text-blue-500 border-b-2 border-blue-500'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          📤 Subscriptions
          <span className="ml-2 text-xs text-text-tertiary">(user feeds)</span>
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'ingestion' ? <IngestionTab /> : <SubscriptionsTab />}
    </div>
  );
}

// ============================================================================
// INGESTION TAB (existing RSS feed management)
// ============================================================================

function IngestionTab() {
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
    website_url: '',
    category: 'neutral',
    trust_level: 3,
    language: 'en',
    country: '',
    description: '',
    active: true,
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
      if (activeOnly !== undefined) params.append('active', activeOnly.toString());

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
      website_url: '',
      category: 'neutral',
      trust_level: 3,
      language: 'en',
      country: '',
      description: '',
      active: true,
    });
  };

  useEffect(() => {
    fetchFeeds();
  }, [fetchFeeds]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const getTrustBadge = (level: number) => {
    const variants: Record<number, 'error' | 'warning' | 'default' | 'info' | 'success'> = {
      1: 'error',
      2: 'warning',
      3: 'default',
      4: 'info',
      5: 'success',
    };
    return <Badge variant={variants[level] || 'default'} size="sm">Trust: {level}</Badge>;
  };

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
            feed.category === 'ukraine' ? 'info' :
            feed.category === 'russia' ? 'error' :
            feed.category === 'international' ? 'success' : 'default'
          }
          size="sm"
        >
          {feed.category}
        </Badge>
      ),
    },
    {
      key: 'trust_level',
      label: 'Trust',
      render: (_: unknown, feed: RSSFeed) => getTrustBadge(feed.trust_level),
    },
    {
      key: 'articles_fetched_total',
      label: 'Articles',
      render: (_: unknown, feed: RSSFeed) => (
        <span className="text-sm text-text-primary font-medium">
          {feed.articles_fetched_total.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (_: unknown, feed: RSSFeed) => (
        <div className="flex items-center gap-2">
          <Badge variant={feed.active ? 'success' : 'default'} size="sm">
            {feed.active ? 'Active' : 'Inactive'}
          </Badge>
          {feed.poll_failures_count > 3 && (
            <Badge variant="error" size="sm">Failing</Badge>
          )}
        </div>
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
          <button
            onClick={() => handleTriggerPoll(feed.id)}
            className="text-green-500 hover:text-green-400 text-sm"
          >
            Poll
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
          <StatCard
            title="Last 24h"
            value={stats.articles_last_24h}
            icon={<span className="text-2xl">📈</span>}
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
                  value={selectedFeed ? selectedFeed.category : formData.category}
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
                <label className="block text-sm text-text-secondary mb-1">Trust Level</label>
                <select
                  value={selectedFeed ? selectedFeed.trust_level : formData.trust_level}
                  onChange={(e) => selectedFeed
                    ? setSelectedFeed({ ...selectedFeed, trust_level: Number(e.target.value) })
                    : setFormData({ ...formData, trust_level: Number(e.target.value) })
                  }
                  className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
                >
                  {TRUST_LEVELS.map((l) => (
                    <option key={l} value={l}>{l} - {l === 1 ? 'Low' : l === 5 ? 'High' : 'Medium'}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-text-secondary mb-1">Language</label>
                <input
                  type="text"
                  value={(selectedFeed ? selectedFeed.language : formData.language) || ''}
                  onChange={(e) => selectedFeed
                    ? setSelectedFeed({ ...selectedFeed, language: e.target.value })
                    : setFormData({ ...formData, language: e.target.value })
                  }
                  className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
                  placeholder="en"
                />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">Country</label>
                <input
                  type="text"
                  value={(selectedFeed ? selectedFeed.country : formData.country) || ''}
                  onChange={(e) => selectedFeed
                    ? setSelectedFeed({ ...selectedFeed, country: e.target.value })
                    : setFormData({ ...formData, country: e.target.value })
                  }
                  className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
                  placeholder="US"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Description</label>
              <textarea
                value={(selectedFeed ? selectedFeed.description : formData.description) || ''}
                onChange={(e) => selectedFeed
                  ? setSelectedFeed({ ...selectedFeed, description: e.target.value })
                  : setFormData({ ...formData, description: e.target.value })
                }
                className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
                rows={2}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="active"
                checked={selectedFeed ? selectedFeed.active : formData.active}
                onChange={(e) => selectedFeed
                  ? setSelectedFeed({ ...selectedFeed, active: e.target.checked })
                  : setFormData({ ...formData, active: e.target.checked })
                }
                className="rounded"
              />
              <label htmlFor="active" className="text-sm">Active</label>
            </div>

            {selectedFeed && (
              <div className="glass p-3 space-y-2 text-sm">
                <div>Articles fetched: {selectedFeed.articles_fetched_total}</div>
                <div>Poll failures: {selectedFeed.poll_failures_count}</div>
                <div>Last polled: {selectedFeed.last_polled_at ? new Date(selectedFeed.last_polled_at).toLocaleString() : 'Never'}</div>
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

// ============================================================================
// SUBSCRIPTIONS TAB (placeholder for user feed subscriptions)
// ============================================================================

function SubscriptionsTab() {
  return (
    <div className="mt-6">
      <div className="glass p-12 text-center">
        <div className="w-16 h-16 rounded-full bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-text-primary mb-2">User Subscriptions</h2>
        <p className="text-text-secondary max-w-md mx-auto mb-6">
          When authentication is enabled, users will be able to subscribe to RSS/Atom/JSON feeds
          from the platform. This page will let you manage and monitor those subscriptions.
        </p>

        <div className="bg-bg-secondary p-6 rounded-lg max-w-lg mx-auto text-left">
          <h3 className="font-medium text-text-primary mb-3">Planned Features</h3>
          <ul className="space-y-2 text-sm text-text-secondary">
            <li className="flex items-center gap-2">
              <span className="text-yellow-500">⏳</span>
              View all user feed subscriptions
            </li>
            <li className="flex items-center gap-2">
              <span className="text-yellow-500">⏳</span>
              Revoke/invalidate specific feeds
            </li>
            <li className="flex items-center gap-2">
              <span className="text-yellow-500">⏳</span>
              Monitor access patterns and abuse
            </li>
            <li className="flex items-center gap-2">
              <span className="text-yellow-500">⏳</span>
              Rate limiting per user/feed
            </li>
            <li className="flex items-center gap-2">
              <span className="text-yellow-500">⏳</span>
              Usage analytics (requests, bandwidth)
            </li>
          </ul>
        </div>

        <div className="mt-6 flex flex-wrap gap-2 justify-center">
          <span className="px-3 py-1 rounded-full text-xs bg-purple-500/10 text-purple-400 border border-purple-500/30">
            Requires Auth
          </span>
          <span className="px-3 py-1 rounded-full text-xs bg-bg-tertiary text-text-secondary">
            RSS / Atom / JSON
          </span>
          <span className="px-3 py-1 rounded-full text-xs bg-bg-tertiary text-text-secondary">
            Access Control
          </span>
        </div>
      </div>
    </div>
  );
}
