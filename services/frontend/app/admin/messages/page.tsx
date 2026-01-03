'use client';

import { useState, useEffect, useCallback } from 'react';
import { adminApi } from '@/lib/admin-api';
import { getMediaUrl } from '@/lib/api';
import { useTopics } from '@/lib/hooks/useTopics';

/**
 * Admin - Message Browser
 *
 * Airtable-style data browser with inline editing for messages.
 */

interface MessageRow {
  id: number;
  message_id: number;
  channel_id: number;
  channel_name: string;
  channel_username: string;
  content: string;
  telegram_date: string;
  views: number | null;
  forwards: number | null;
  has_media: boolean;
  media_type: string | null;
  language_detected: string | null;
  topic: string | null;
}

interface SortConfig {
  key: keyof MessageRow;
  direction: 'asc' | 'desc';
}

export default function MessageBrowserPage() {
  const { topicOptions } = useTopics();
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ id: number; field: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [saving, setSaving] = useState<number | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'telegram_date', direction: 'desc' });
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 50;

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
        sort_by: sortConfig.key,
        sort_dir: sortConfig.direction,
      });
      if (filter) {
        params.set('q', filter);
      }

      const data = await adminApi.get(`/api/messages/?${params}`);

      // Transform API response to our row format
      const rows: MessageRow[] = (data.items || []).map((msg: any) => ({
        id: msg.id,
        message_id: msg.message_id,
        channel_id: msg.channel_id,
        channel_name: msg.channel?.name || 'Unknown',
        channel_username: msg.channel?.username || '',
        content: msg.content || '',
        telegram_date: msg.telegram_date,
        views: msg.views,
        forwards: msg.forwards,
        has_media: msg.media_items?.length > 0 || msg.media_type !== null,
        media_type: msg.media_type,
        language_detected: msg.language_detected,
        topic: msg.topic || null,
      }));

      setMessages(rows);
      setTotal(data.total || rows.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch messages');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, sortConfig, filter]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const handleSort = (key: keyof MessageRow) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const startEditing = (id: number, field: string, currentValue: string) => {
    setEditingCell({ id, field });
    setEditValue(currentValue);
  };

  const cancelEditing = () => {
    setEditingCell(null);
    setEditValue('');
  };

  const saveEdit = async (id: number, field: string, value: string) => {
    setSaving(id);
    try {
      await adminApi.patch(`/api/admin/messages/${id}`, { [field]: value });
      setMessages(prev => prev.map(msg =>
        msg.id === id ? { ...msg, [field]: value } : msg
      ));
      setEditingCell(null);
      setEditValue('');
    } catch (err) {
      console.error('Failed to save:', err);
    } finally {
      setSaving(null);
    }
  };

  const updateTopic = async (id: number, topic: string) => {
    setSaving(id);
    try {
      await adminApi.post(`/api/admin/messages/${id}/topic`, { topic: topic || null });
      setMessages(prev => prev.map(msg =>
        msg.id === id ? { ...msg, topic: topic || null } : msg
      ));
    } catch (err) {
      console.error('Failed to update topic:', err);
    } finally {
      setSaving(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const truncate = (text: string, maxLen: number) => {
    if (!text) return '';
    return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
  };

  const SortIcon = ({ column }: { column: keyof MessageRow }) => {
    if (sortConfig.key !== column) return <span className="text-gray-600 ml-1">&#8597;</span>;
    return <span className="ml-1">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>;
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="p-6 bg-gray-900 min-h-screen">
      <div className="max-w-full mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Message Browser</h1>
            <p className="text-gray-400 text-sm mt-1">
              {total.toLocaleString()} messages - Click cells to edit
            </p>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-4">
            <a
              href="/admin/kanban"
              className="text-blue-400 hover:text-blue-300 text-sm"
            >
              ← View as Board
            </a>
            <input
              type="text"
              placeholder="Search messages..."
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setPage(1); }}
              className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
            />
            <button
              onClick={() => fetchMessages()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
            >
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}

        {/* Table */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-750 border-b border-gray-700">
                <tr>
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white"
                    onClick={() => handleSort('telegram_date')}
                  >
                    Date <SortIcon column="telegram_date" />
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white"
                    onClick={() => handleSort('channel_name')}
                  >
                    Channel <SortIcon column="channel_name" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider min-w-[300px]">
                    Content
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white"
                    onClick={() => handleSort('views')}
                  >
                    Views <SortIcon column="views" />
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white"
                    onClick={() => handleSort('forwards')}
                  >
                    Fwds <SortIcon column="forwards" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Media
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Topic
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                      Loading...
                    </td>
                  </tr>
                ) : messages.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                      No messages found
                    </td>
                  </tr>
                ) : (
                  messages.map((msg) => (
                    <tr
                      key={msg.id}
                      className={`hover:bg-gray-750 ${saving === msg.id ? 'opacity-50' : ''}`}
                    >
                      <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">
                        {formatDate(msg.telegram_date)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="text-white font-medium">{msg.channel_name}</div>
                        {msg.channel_username && (
                          <div className="text-gray-500 text-xs">@{msg.channel_username}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">
                        {editingCell?.id === msg.id && editingCell?.field === 'content' ? (
                          <div className="flex items-center gap-2">
                            <textarea
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                              rows={2}
                              autoFocus
                            />
                            <button
                              onClick={() => saveEdit(msg.id, 'content', editValue)}
                              className="px-2 py-1 bg-green-600 text-white rounded text-xs"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEditing}
                              className="px-2 py-1 bg-gray-600 text-white rounded text-xs"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div
                            className="cursor-pointer hover:bg-gray-700 px-2 py-1 rounded"
                            onClick={() => startEditing(msg.id, 'content', msg.content)}
                            title="Click to edit"
                          >
                            {truncate(msg.content, 100) || <span className="text-gray-500 italic">No text</span>}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300 text-right">
                        {msg.views?.toLocaleString() || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300 text-right">
                        {msg.forwards?.toLocaleString() || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {msg.has_media ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-900 text-blue-200">
                            {msg.media_type || 'media'}
                          </span>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <select
                          value={msg.topic || ''}
                          onChange={(e) => updateTopic(msg.id, e.target.value)}
                          disabled={saving === msg.id}
                          className={`px-2 py-1 text-xs rounded border ${
                            msg.topic
                              ? 'bg-purple-900/50 border-purple-500/50 text-purple-200'
                              : 'bg-gray-700 border-gray-600 text-gray-400'
                          } focus:outline-none focus:ring-1 focus:ring-purple-500`}
                        >
                          {topicOptions.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <a
                          href={`/messages/${msg.id}`}
                          target="_blank"
                          className="text-blue-400 hover:text-blue-300"
                        >
                          View
                        </a>
                        {msg.channel_username && (
                          <a
                            href={`https://t.me/${msg.channel_username}/${msg.message_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-400 hover:text-gray-300 ml-3"
                            title="Open in Telegram"
                          >
                            TG ↗
                          </a>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 bg-gray-750 border-t border-gray-700 flex items-center justify-between">
              <div className="text-sm text-gray-400">
                Page {page} of {totalPages}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1 bg-gray-700 text-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 bg-gray-700 text-gray-300 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-600"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
