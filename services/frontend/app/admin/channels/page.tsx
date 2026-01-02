'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge, StatCard, DataTable, Modal } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin - Channels Management
 *
 * List and manage Telegram channels with filters and quality metrics.
 */

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
  const [activeTab, setActiveTab] = useState<'channels' | 'categories'>('channels');

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

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

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
                  <div>Spam Rate: {(selectedChannel.quality_metrics.spam_rate || 0).toFixed(1)}%</div>
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
