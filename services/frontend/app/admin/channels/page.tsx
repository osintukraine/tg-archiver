'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge, StatCard, DataTable, Modal } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin - Channels Management
 *
 * List and manage Telegram channels with filters and quality metrics.
 * Includes discovered channels from message forwards.
 */

interface DiscoveredChannel {
  id: number;
  telegram_id: number;
  username: string | null;
  name: string | null;
  description: string | null;
  participant_count: number | null;
  verified: boolean;
  scam: boolean;
  fake: boolean;
  is_private: boolean;
  join_status: string;
  join_error: string | null;
  discovery_count: number;
  last_seen_at: string;
  discovered_at: string;
  joined_at: string | null;
  admin_action: string | null;
  promoted_to_channel_id: number | null;
  forward_count: number;
  social_messages_fetched: number;
}

interface DiscoveredStats {
  total: number;
  by_status: Record<string, number>;
  pending: number;
  joined: number;
  private: number;
  failed: number;
  promoted: number;
  ignored: number;
  total_forwards_tracked: number;
  avg_discovery_count: number;
}

interface Category {
  id: number;
  name: string;
  color: string;
  description: string | null;
  channel_count: number;
}

interface Channel {
  id: number;
  telegram_id: number;
  username: string | null;
  name: string | null;
  description: string | null;
  type: string;
  verified: boolean;
  scam: boolean;
  fake: boolean;
  category: {
    id: number;
    name: string;
    color: string;
  } | null;
  folder: string | null;
  rule: string | null;
  active: boolean;
  message_count: number;
  last_message_at: string | null;
  quality_metrics: Record<string, number> | null;
  discovery_status: string | null;
  created_at: string | null;
}

interface ChannelStats {
  total_channels: number;
  active_channels: number;
  verified_channels: number;
  by_category: Record<string, number>;
  by_folder: Record<string, number>;
  by_rule: Record<string, number>;
}

const RULES = ['archive_all', 'selective_archive', 'monitor_only'];

// Color mapping for category badges
const CATEGORY_BADGE_COLORS: Record<string, 'info' | 'success' | 'warning' | 'error' | 'default'> = {
  blue: 'info',
  green: 'success',
  orange: 'warning',
  red: 'error',
  purple: 'default',
  gray: 'default',
};

export default function ChannelsPage() {
  // Channels state
  const [channels, setChannels] = useState<Channel[]>([]);
  const [stats, setStats] = useState<ChannelStats | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [folders, setFolders] = useState<{folder: string; count: number}[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Tabs
  const [activeTab, setActiveTab] = useState<'channels' | 'categories' | 'discovered'>('channels');

  // Discovered channels state
  const [discoveredChannels, setDiscoveredChannels] = useState<DiscoveredChannel[]>([]);
  const [discoveredStats, setDiscoveredStats] = useState<DiscoveredStats | null>(null);
  const [discoveredPage, setDiscoveredPage] = useState(1);
  const [discoveredTotalPages, setDiscoveredTotalPages] = useState(1);
  const [discoveredTotal, setDiscoveredTotal] = useState(0);
  const [discoveredLoading, setDiscoveredLoading] = useState(false);
  const [discoveredStatusFilter, setDiscoveredStatusFilter] = useState<string>('');
  const [discoveredSearch, setDiscoveredSearch] = useState('');

  // Promote modal
  const [promoteChannel, setPromoteChannel] = useState<DiscoveredChannel | null>(null);
  const [promoteForm, setPromoteForm] = useState({ category_id: 0, folder: '', rule: 'archive_all' });

  // Filters
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [folder, setFolder] = useState<string>('');
  const [rule, setRule] = useState<string>('');
  const [activeOnly, setActiveOnly] = useState<boolean | undefined>(undefined);

  // Modal
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [editCategoryId, setEditCategoryId] = useState<number | 0>(0);

  // Category management
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryForm, setCategoryForm] = useState({ name: '', color: 'gray', description: '' });

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: '25',
      });
      if (search) params.append('search', search);
      if (categoryId !== '') params.append('category_id', categoryId.toString());
      if (folder) params.append('folder', folder);
      if (rule) params.append('rule', rule);
      if (activeOnly !== undefined) params.append('active', activeOnly.toString());

      const data = await adminApi.get(`/api/admin/channels?${params}`);
      setChannels(data.items);
      setTotalPages(data.total_pages);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [page, search, categoryId, folder, rule, activeOnly]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await adminApi.get('/api/admin/channels/stats');
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch channel stats:', err);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const data = await adminApi.get('/api/admin/categories');
      setCategories(data);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  }, []);

  const fetchFolders = useCallback(async () => {
    try {
      const data = await adminApi.get('/api/admin/channels/folders');
      setFolders(data);
    } catch (err) {
      console.error('Failed to fetch folders:', err);
    }
  }, []);

  const fetchDiscoveredChannels = useCallback(async () => {
    setDiscoveredLoading(true);
    try {
      const params = new URLSearchParams({
        page: discoveredPage.toString(),
        page_size: '25',
        sort_by: 'discovery_count',
        sort_order: 'desc',
      });
      if (discoveredSearch) params.append('search', discoveredSearch);
      if (discoveredStatusFilter) params.append('status', discoveredStatusFilter);

      const data = await adminApi.get(`/api/admin/discovered?${params}`);
      setDiscoveredChannels(data.items);
      setDiscoveredTotalPages(data.total_pages);
      setDiscoveredTotal(data.total);
    } catch (err) {
      console.error('Failed to fetch discovered channels:', err);
    } finally {
      setDiscoveredLoading(false);
    }
  }, [discoveredPage, discoveredSearch, discoveredStatusFilter]);

  const fetchDiscoveredStats = useCallback(async () => {
    try {
      const data = await adminApi.get('/api/admin/discovered/stats');
      setDiscoveredStats(data);
    } catch (err) {
      console.error('Failed to fetch discovered stats:', err);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  useEffect(() => {
    if (activeTab === 'discovered') {
      fetchDiscoveredChannels();
      fetchDiscoveredStats();
    }
  }, [activeTab, fetchDiscoveredChannels, fetchDiscoveredStats]);

  useEffect(() => {
    fetchStats();
    fetchCategories();
    fetchFolders();
  }, [fetchStats, fetchCategories, fetchFolders]);

  // Set edit category when modal opens
  useEffect(() => {
    if (selectedChannel) {
      setEditCategoryId(selectedChannel.category?.id || 0);
    }
  }, [selectedChannel]);

  const handleUpdateChannel = async (channelId: number, updates: Record<string, unknown>) => {
    try {
      await adminApi.put(`/api/admin/channels/${channelId}`, updates);
      fetchChannels();
      setSelectedChannel(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleSaveCategory = async () => {
    try {
      if (editingCategory) {
        await adminApi.put(`/api/admin/categories/${editingCategory.id}`, categoryForm);
      } else {
        await adminApi.post('/api/admin/categories', categoryForm);
      }
      fetchCategories();
      setShowCategoryModal(false);
      setEditingCategory(null);
      setCategoryForm({ name: '', color: 'gray', description: '' });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to save category');
    }
  };

  const handleDeleteCategory = async (categoryId: number) => {
    if (!confirm('Delete this category? Channels will be uncategorized.')) return;
    try {
      await adminApi.delete(`/api/admin/categories/${categoryId}`);
      fetchCategories();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete category');
    }
  };

  const openCategoryModal = (category?: Category) => {
    if (category) {
      setEditingCategory(category);
      setCategoryForm({ name: category.name, color: category.color, description: category.description || '' });
    } else {
      setEditingCategory(null);
      setCategoryForm({ name: '', color: 'gray', description: '' });
    }
    setShowCategoryModal(true);
  };

  // Discovered channel actions
  const handlePromoteChannel = async () => {
    if (!promoteChannel) return;
    try {
      await adminApi.post(`/api/admin/discovered/${promoteChannel.id}/promote`, promoteForm);
      setPromoteChannel(null);
      setPromoteForm({ category_id: 0, folder: '', rule: 'archive_all' });
      fetchDiscoveredChannels();
      fetchDiscoveredStats();
      fetchChannels(); // Refresh main channels list
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to promote channel');
    }
  };

  const handleIgnoreChannel = async (channelId: number) => {
    if (!confirm('Mark this channel as ignored? It will not appear in suggestions.')) return;
    try {
      await adminApi.post(`/api/admin/discovered/${channelId}/ignore`, {});
      fetchDiscoveredChannels();
      fetchDiscoveredStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to ignore channel');
    }
  };

  const handleRetryJoin = async (channelId: number) => {
    try {
      await adminApi.post(`/api/admin/discovered/${channelId}/retry`, {});
      fetchDiscoveredChannels();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to retry join');
    }
  };

  const getStatusBadgeVariant = (status: string): 'info' | 'success' | 'warning' | 'error' | 'default' => {
    switch (status) {
      case 'joined': return 'success';
      case 'pending':
      case 'joining': return 'info';
      case 'private':
      case 'failed': return 'warning';
      case 'ignored': return 'default';
      default: return 'default';
    }
  };

  const getCategoryBadgeVariant = (color: string | undefined): 'info' | 'success' | 'warning' | 'error' | 'default' => {
    if (!color) return 'default';
    return CATEGORY_BADGE_COLORS[color] || 'default';
  };

  const columns = [
    {
      key: 'name',
      label: 'Channel',
      render: (_: unknown, channel: Channel) => (
        <div className="flex items-center gap-2">
          <div>
            <div className="font-medium text-text-primary flex items-center gap-1">
              {channel.name || channel.username || `ID: ${channel.telegram_id}`}
              {channel.verified && <span className="text-blue-500">✓</span>}
              {channel.scam && <Badge variant="error" size="sm">SCAM</Badge>}
              {channel.fake && <Badge variant="warning" size="sm">FAKE</Badge>}
            </div>
            {channel.username && (
              <div className="text-xs text-text-tertiary">@{channel.username}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      render: (_: unknown, channel: Channel) => (
        <Badge
          variant={getCategoryBadgeVariant(channel.category?.color)}
          size="sm"
        >
          {channel.category?.name || 'uncategorized'}
        </Badge>
      ),
    },
    {
      key: 'folder',
      label: 'Folder',
      render: (_: unknown, channel: Channel) => (
        <span className="text-sm text-text-secondary">{channel.folder || '-'}</span>
      ),
    },
    {
      key: 'rule',
      label: 'Rule',
      render: (_: unknown, channel: Channel) => (
        <Badge variant={channel.rule === 'archive_all' ? 'success' : 'default'} size="sm">
          {channel.rule || 'none'}
        </Badge>
      ),
    },
    {
      key: 'message_count',
      label: 'Messages',
      render: (_: unknown, channel: Channel) => (
        <span className="text-sm text-text-primary font-medium">
          {channel.message_count.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'active',
      label: 'Status',
      render: (_: unknown, channel: Channel) => (
        <Badge variant={channel.active ? 'success' : 'default'} size="sm">
          {channel.active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, channel: Channel) => (
        <button
          onClick={() => setSelectedChannel(channel)}
          className="text-blue-500 hover:text-blue-400 text-sm"
        >
          Edit
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Channels</h1>
          <p className="text-text-secondary mt-1">
            Manage Telegram channels and categories
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border-subtle">
        <button
          onClick={() => setActiveTab('channels')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'channels'
              ? 'border-blue-500 text-blue-500'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          Channels ({stats?.total_channels || 0})
        </button>
        <button
          onClick={() => setActiveTab('categories')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'categories'
              ? 'border-blue-500 text-blue-500'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          Categories ({categories.length})
        </button>
        <button
          onClick={() => setActiveTab('discovered')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'discovered'
              ? 'border-blue-500 text-blue-500'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          Discovered ({discoveredStats?.total || 0})
        </button>
      </div>

      {/* Stats Cards - only show for channels tab */}
      {activeTab === 'channels' && stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="Total Channels"
            value={stats.total_channels}
            icon={<span className="text-2xl">#</span>}
          />
          <StatCard
            title="Active"
            value={stats.active_channels}
            icon={<span className="text-2xl text-green-500">●</span>}
          />
          <StatCard
            title="Verified"
            value={stats.verified_channels}
            icon={<span className="text-2xl text-blue-500">✓</span>}
          />
          <StatCard
            title="Filtered Results"
            value={total}
            icon={<span className="text-2xl">📨</span>}
          />
        </div>
      )}

      {/* Channels Tab Content */}
      {activeTab === 'channels' && (
        <>
          {/* Filters */}
          <div className="glass p-4">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <div className="col-span-2">
                <input
                  type="text"
                  placeholder="Search channels..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
                />
              </div>
              <select
                value={categoryId}
                onChange={(e) => { setCategoryId(e.target.value ? parseInt(e.target.value) : ''); setPage(1); }}
                className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
              >
                <option value="">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name} ({cat.channel_count})</option>
                ))}
              </select>
              <select
                value={folder}
                onChange={(e) => { setFolder(e.target.value); setPage(1); }}
                className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
              >
                <option value="">All Folders</option>
                {folders.map((f) => (
                  <option key={f.folder} value={f.folder}>{f.folder} ({f.count})</option>
                ))}
              </select>
              <select
                value={rule}
                onChange={(e) => { setRule(e.target.value); setPage(1); }}
                className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
              >
                <option value="">All Rules</option>
                {RULES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <div className="flex items-center gap-4">
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
          </div>

          {/* Error State */}
          {error && (
            <div className="glass p-8 text-center text-red-500">Error: {error}</div>
          )}

          {/* Table */}
          {!error && (
            <DataTable
              columns={columns}
              data={channels}
              keyExtractor={(channel) => channel.id}
              loading={loading}
              emptyMessage="No channels found"
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
        </>
      )}

      {/* Categories Tab Content */}
      {activeTab === 'categories' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-text-secondary">
              Categories help organize channels for filtering and reporting.
            </p>
            <button
              onClick={() => openCategoryModal()}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded"
            >
              + New Category
            </button>
          </div>

          {/* Categories List */}
          <div className="glass divide-y divide-border-subtle">
            {categories.length === 0 ? (
              <div className="p-8 text-center text-text-secondary">
                No categories yet. Create one to get started.
              </div>
            ) : (
              categories.map((cat) => (
                <div key={cat.id} className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: cat.color === 'gray' ? '#6b7280' : cat.color }}
                    />
                    <div>
                      <div className="font-medium text-text-primary">{cat.name}</div>
                      {cat.description && (
                        <div className="text-sm text-text-tertiary">{cat.description}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-text-secondary">
                      {cat.channel_count} channel{cat.channel_count !== 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={() => openCategoryModal(cat)}
                      className="text-blue-500 hover:text-blue-400 text-sm"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteCategory(cat.id)}
                      className="text-red-500 hover:text-red-400 text-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Discovered Tab Content */}
      {activeTab === 'discovered' && (
        <>
          {/* Stats */}
          {discoveredStats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <StatCard
                title="Total Discovered"
                value={discoveredStats.total}
                icon={<span className="text-2xl">🔍</span>}
              />
              <StatCard
                title="Joined"
                value={discoveredStats.joined}
                icon={<span className="text-2xl text-green-500">✓</span>}
              />
              <StatCard
                title="Pending"
                value={discoveredStats.pending}
                icon={<span className="text-2xl text-blue-500">⏳</span>}
              />
              <StatCard
                title="Private/Failed"
                value={discoveredStats.private + discoveredStats.failed}
                icon={<span className="text-2xl text-orange-500">⚠</span>}
              />
              <StatCard
                title="Forwards Tracked"
                value={discoveredStats.total_forwards_tracked}
                icon={<span className="text-2xl">↗️</span>}
              />
            </div>
          )}

          {/* Filters */}
          <div className="glass p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="col-span-2">
                <input
                  type="text"
                  placeholder="Search discovered channels..."
                  value={discoveredSearch}
                  onChange={(e) => { setDiscoveredSearch(e.target.value); setDiscoveredPage(1); }}
                  className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
                />
              </div>
              <select
                value={discoveredStatusFilter}
                onChange={(e) => { setDiscoveredStatusFilter(e.target.value); setDiscoveredPage(1); }}
                className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
              >
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="joining">Joining</option>
                <option value="joined">Joined</option>
                <option value="private">Private</option>
                <option value="failed">Failed</option>
                <option value="ignored">Ignored</option>
              </select>
              <div className="flex items-center text-sm text-text-secondary">
                {discoveredTotal} channel{discoveredTotal !== 1 ? 's' : ''} found
              </div>
            </div>
          </div>

          {/* Discovered Channels Table */}
          <DataTable
            columns={[
              {
                key: 'name',
                label: 'Channel',
                render: (_: unknown, ch: DiscoveredChannel) => (
                  <div>
                    <div className="font-medium text-text-primary flex items-center gap-1">
                      {ch.name || ch.username || `ID: ${ch.telegram_id}`}
                      {ch.verified && <span className="text-blue-500">✓</span>}
                      {ch.scam && <Badge variant="error" size="sm">SCAM</Badge>}
                      {ch.fake && <Badge variant="warning" size="sm">FAKE</Badge>}
                    </div>
                    {ch.username && <div className="text-xs text-text-tertiary">@{ch.username}</div>}
                    {ch.participant_count && (
                      <div className="text-xs text-text-tertiary">
                        {ch.participant_count.toLocaleString()} members
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'status',
                label: 'Status',
                render: (_: unknown, ch: DiscoveredChannel) => (
                  <div className="space-y-1">
                    <Badge variant={getStatusBadgeVariant(ch.join_status)} size="sm">
                      {ch.join_status}
                    </Badge>
                    {ch.admin_action && (
                      <Badge variant={ch.admin_action === 'promoted' ? 'success' : 'default'} size="sm">
                        {ch.admin_action}
                      </Badge>
                    )}
                  </div>
                ),
              },
              {
                key: 'discovery_count',
                label: 'Forwards',
                render: (_: unknown, ch: DiscoveredChannel) => (
                  <span className="font-medium text-text-primary">
                    {ch.discovery_count}
                  </span>
                ),
              },
              {
                key: 'last_seen',
                label: 'Last Seen',
                render: (_: unknown, ch: DiscoveredChannel) => (
                  <span className="text-sm text-text-secondary">
                    {new Date(ch.last_seen_at).toLocaleDateString()}
                  </span>
                ),
              },
              {
                key: 'actions',
                label: 'Actions',
                render: (_: unknown, ch: DiscoveredChannel) => (
                  <div className="flex gap-2">
                    {ch.join_status === 'joined' && !ch.admin_action && (
                      <button
                        onClick={() => {
                          setPromoteChannel(ch);
                          setPromoteForm({ category_id: 0, folder: '', rule: 'archive_all' });
                        }}
                        className="text-green-500 hover:text-green-400 text-sm"
                      >
                        Promote
                      </button>
                    )}
                    {(ch.join_status === 'failed' || ch.join_status === 'ignored') && (
                      <button
                        onClick={() => handleRetryJoin(ch.id)}
                        className="text-blue-500 hover:text-blue-400 text-sm"
                      >
                        Retry
                      </button>
                    )}
                    {!ch.admin_action && ch.join_status !== 'ignored' && (
                      <button
                        onClick={() => handleIgnoreChannel(ch.id)}
                        className="text-gray-500 hover:text-gray-400 text-sm"
                      >
                        Ignore
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
            data={discoveredChannels}
            keyExtractor={(ch) => ch.id}
            loading={discoveredLoading}
            emptyMessage="No discovered channels yet. Channels will appear here when forwards are detected."
          />

          {/* Pagination */}
          {discoveredTotalPages > 1 && (
            <div className="flex justify-center gap-2">
              <button
                onClick={() => setDiscoveredPage((p) => Math.max(1, p - 1))}
                disabled={discoveredPage === 1}
                className="px-4 py-2 bg-bg-secondary rounded disabled:opacity-50"
              >
                Previous
              </button>
              <span className="px-4 py-2 text-text-secondary">
                Page {discoveredPage} of {discoveredTotalPages}
              </span>
              <button
                onClick={() => setDiscoveredPage((p) => Math.min(discoveredTotalPages, p + 1))}
                disabled={discoveredPage === discoveredTotalPages}
                className="px-4 py-2 bg-bg-secondary rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Promote Channel Modal */}
      {promoteChannel && (
        <Modal
          open={true}
          title={`Promote: ${promoteChannel.name || promoteChannel.username}`}
          onClose={() => setPromoteChannel(null)}
        >
          <div className="space-y-4">
            <p className="text-text-secondary text-sm">
              Promote this channel to full archiving. It will be added to the monitored channels list.
            </p>
            {promoteChannel.description && (
              <div className="glass p-3 text-sm text-text-secondary">
                {promoteChannel.description}
              </div>
            )}
            <div>
              <label className="block text-sm text-text-secondary mb-1">Category</label>
              <select
                value={promoteForm.category_id}
                onChange={(e) => setPromoteForm({ ...promoteForm, category_id: parseInt(e.target.value) || 0 })}
                className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
              >
                <option value={0}>Uncategorized</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Folder</label>
              <select
                value={promoteForm.folder}
                onChange={(e) => setPromoteForm({ ...promoteForm, folder: e.target.value })}
                className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
              >
                <option value="">No Folder</option>
                {folders.map((f) => (
                  <option key={f.folder} value={f.folder}>{f.folder}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Archival Rule</label>
              <select
                value={promoteForm.rule}
                onChange={(e) => setPromoteForm({ ...promoteForm, rule: e.target.value })}
                className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
              >
                {RULES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-border-subtle">
              <button
                onClick={() => setPromoteChannel(null)}
                className="px-4 py-2 text-text-secondary hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                onClick={handlePromoteChannel}
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded"
              >
                Promote to Full Archiving
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Channel Modal */}
      {selectedChannel && (
        <Modal
          open={true}
          title={`Edit: ${selectedChannel.name || selectedChannel.username}`}
          onClose={() => setSelectedChannel(null)}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Category</label>
              <select
                value={editCategoryId}
                onChange={(e) => setEditCategoryId(parseInt(e.target.value) || 0)}
                className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
              >
                <option value={0}>Uncategorized</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Rule</label>
              <select
                value={selectedChannel.rule || ''}
                onChange={(e) => handleUpdateChannel(selectedChannel.id, { rule: e.target.value || null })}
                className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
              >
                <option value="">None</option>
                {RULES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="active"
                checked={selectedChannel.active}
                onChange={(e) => handleUpdateChannel(selectedChannel.id, { active: e.target.checked })}
                className="rounded"
              />
              <label htmlFor="active" className="text-sm">Active</label>
            </div>
            {selectedChannel.quality_metrics && (
              <div className="glass p-3 space-y-2">
                <div className="text-sm font-medium text-text-secondary">Quality Metrics</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>Off-topic Rate: {(selectedChannel.quality_metrics.off_topic_rate || 0).toFixed(1)}%</div>
                  <div>Total Messages: {selectedChannel.quality_metrics.total_messages_received || 0}</div>
                  <div>High Quality: {selectedChannel.quality_metrics.high_quality_messages || 0}</div>
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-4 border-t border-border-subtle">
              <button
                onClick={() => setSelectedChannel(null)}
                className="px-4 py-2 text-text-secondary hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                onClick={() => handleUpdateChannel(selectedChannel.id, { category_id: editCategoryId })}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded"
              >
                Save Category
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Category Modal */}
      {showCategoryModal && (
        <Modal
          open={true}
          title={editingCategory ? 'Edit Category' : 'New Category'}
          onClose={() => {
            setShowCategoryModal(false);
            setEditingCategory(null);
            setCategoryForm({ name: '', color: 'gray', description: '' });
          }}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Name *</label>
              <input
                type="text"
                value={categoryForm.name}
                onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                placeholder="e.g., News, Tech, Sports"
                className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Color</label>
              <select
                value={categoryForm.color}
                onChange={(e) => setCategoryForm({ ...categoryForm, color: e.target.value })}
                className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
              >
                <option value="gray">Gray</option>
                <option value="blue">Blue</option>
                <option value="green">Green</option>
                <option value="orange">Orange</option>
                <option value="red">Red</option>
                <option value="purple">Purple</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Description</label>
              <textarea
                value={categoryForm.description}
                onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                placeholder="Optional description..."
                rows={2}
                className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
              />
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-border-subtle">
              <button
                onClick={() => {
                  setShowCategoryModal(false);
                  setEditingCategory(null);
                  setCategoryForm({ name: '', color: 'gray', description: '' });
                }}
                className="px-4 py-2 text-text-secondary hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCategory}
                disabled={!categoryForm.name.trim()}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50"
              >
                {editingCategory ? 'Save Changes' : 'Create Category'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
