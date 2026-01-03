'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

interface Topic {
  id: number;
  name: string;
  label: string;
  color: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  message_count: number;
}

interface TopicFormData {
  name: string;
  label: string;
  color: string;
  description: string;
  sort_order: number;
  is_active: boolean;
}

const DEFAULT_FORM: TopicFormData = {
  name: '',
  label: '',
  color: 'gray',
  description: '',
  sort_order: 0,
  is_active: true,
};

const COLOR_OPTIONS = [
  { value: 'gray', label: 'Gray', class: 'bg-gray-500' },
  { value: 'red', label: 'Red', class: 'bg-red-500' },
  { value: 'orange', label: 'Orange', class: 'bg-orange-500' },
  { value: 'yellow', label: 'Yellow', class: 'bg-yellow-500' },
  { value: 'green', label: 'Green', class: 'bg-green-500' },
  { value: 'blue', label: 'Blue', class: 'bg-blue-500' },
  { value: 'purple', label: 'Purple', class: 'bg-purple-500' },
  { value: 'pink', label: 'Pink', class: 'bg-pink-500' },
  { value: 'slate', label: 'Slate', class: 'bg-slate-500' },
  { value: 'zinc', label: 'Zinc', class: 'bg-zinc-500' },
];

export default function TopicsPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [formData, setFormData] = useState<TopicFormData>(DEFAULT_FORM);

  const fetchTopics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi.get(`/api/admin/topics/?include_inactive=${showInactive}`);
      setTopics(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load topics');
    } finally {
      setLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    fetchTopics();
  }, [fetchTopics]);

  const openCreateModal = () => {
    setEditingTopic(null);
    setFormData(DEFAULT_FORM);
    setModalOpen(true);
  };

  const openEditModal = (topic: Topic) => {
    setEditingTopic(topic);
    setFormData({
      name: topic.name,
      label: topic.label,
      color: topic.color,
      description: topic.description || '',
      sort_order: topic.sort_order,
      is_active: topic.is_active,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingTopic(null);
    setFormData(DEFAULT_FORM);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      if (editingTopic) {
        await adminApi.put(`/api/admin/topics/${editingTopic.id}`, formData);
      } else {
        await adminApi.post('/api/admin/topics/', formData);
      }
      closeModal();
      await fetchTopics();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save topic');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (topic: Topic) => {
    if (!confirm(`Delete topic "${topic.label}"? ${topic.message_count} messages will have their topic cleared.`)) {
      return;
    }

    try {
      await adminApi.delete(`/api/admin/topics/${topic.id}`);
      await fetchTopics();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete topic');
    }
  };

  const toggleActive = async (topic: Topic) => {
    try {
      await adminApi.put(`/api/admin/topics/${topic.id}`, { is_active: !topic.is_active });
      await fetchTopics();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update topic');
    }
  };

  const seedDefaults = async () => {
    if (!confirm('Seed default topics? This will only work if no topics exist.')) return;

    try {
      const result = await adminApi.post('/api/admin/topics/seed');
      if (result.success) {
        await fetchTopics();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to seed topics');
    }
  };

  const getColorClass = (color: string) => {
    const option = COLOR_OPTIONS.find(c => c.value === color);
    return option?.class || 'bg-gray-500';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Message Topics</h1>
          <p className="text-text-secondary mt-1">
            Configure topics for message classification
          </p>
        </div>
        <div className="flex gap-3">
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded"
            />
            Show inactive
          </label>
          <button
            onClick={seedDefaults}
            className="px-4 py-2 bg-bg-secondary rounded hover:bg-bg-tertiary transition-colors"
          >
            Seed Defaults
          </button>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          >
            + Add Topic
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Topics List */}
      <div className="glass">
        {loading ? (
          <div className="p-8 text-center text-text-secondary">Loading topics...</div>
        ) : topics.length === 0 ? (
          <div className="p-8 text-center text-text-secondary">
            No topics configured. Click "Seed Defaults" or "Add Topic" to get started.
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-bg-secondary border-b border-border">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase">Color</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase">Label</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase">Description</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase">Order</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase">Messages</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {topics.map((topic) => (
                <tr
                  key={topic.id}
                  className={`hover:bg-bg-secondary ${!topic.is_active ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className={`w-6 h-6 rounded ${getColorClass(topic.color)}`} />
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-text-primary">{topic.name}</td>
                  <td className="px-4 py-3 text-text-primary font-medium">{topic.label}</td>
                  <td className="px-4 py-3 text-text-secondary text-sm">
                    {topic.description || '—'}
                  </td>
                  <td className="px-4 py-3 text-text-tertiary">{topic.sort_order}</td>
                  <td className="px-4 py-3 text-text-tertiary">{topic.message_count.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    {topic.is_active ? (
                      <Badge variant="success" size="sm">Active</Badge>
                    ) : (
                      <Badge variant="default" size="sm">Inactive</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openEditModal(topic)}
                        className="text-blue-400 hover:text-blue-300 text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => toggleActive(topic)}
                        className="text-yellow-400 hover:text-yellow-300 text-sm"
                      >
                        {topic.is_active ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => handleDelete(topic)}
                        className="text-red-400 hover:text-red-300 text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={closeModal} />
          <div className="relative bg-bg-base border border-border rounded-xl shadow-2xl w-full max-w-lg">
            <form onSubmit={handleSubmit}>
              <div className="p-4 border-b border-border">
                <h3 className="text-lg font-semibold text-text-primary">
                  {editingTopic ? 'Edit Topic' : 'Create Topic'}
                </h3>
              </div>

              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">Name (slug)</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                      placeholder="e.g., important"
                      className="w-full bg-bg-secondary border border-border rounded px-3 py-2 text-text-primary"
                      required
                      disabled={!!editingTopic}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">Label</label>
                    <input
                      type="text"
                      value={formData.label}
                      onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                      placeholder="e.g., Important"
                      className="w-full bg-bg-secondary border border-border rounded px-3 py-2 text-text-primary"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-text-secondary mb-1">Description</label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Brief description of this topic"
                    className="w-full bg-bg-secondary border border-border rounded px-3 py-2 text-text-primary"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">Color</label>
                    <select
                      value={formData.color}
                      onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                      className="w-full bg-bg-secondary border border-border rounded px-3 py-2 text-text-primary"
                    >
                      {COLOR_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-text-secondary mb-1">Sort Order</label>
                    <input
                      type="number"
                      value={formData.sort_order}
                      onChange={(e) => setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })}
                      className="w-full bg-bg-secondary border border-border rounded px-3 py-2 text-text-primary"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-text-primary">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="rounded"
                  />
                  Active
                </label>
              </div>

              <div className="p-4 border-t border-border flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 bg-bg-secondary hover:bg-bg-tertiary text-text-secondary rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingTopic ? 'Save Changes' : 'Create Topic'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
