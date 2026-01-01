'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge, StatCard, DataTable, Modal } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin - Channels Management
 *
 * List and manage Telegram channels with filters and quality metrics.
 */

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
  source_type: string | null;
  affiliation: string | null;
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
  by_affiliation: Record<string, number>;
  by_folder: Record<string, number>;
  by_rule: Record<string, number>;
  by_source_type: Record<string, number>;
}

interface Submission {
  id: number;
  channel_link: string;
  channel_name: string;
  reason: string;
  value_description: string | null;
  source_origin: 'ua' | 'ru' | 'unknown';
  status: 'pending' | 'accepted' | 'rejected';
  assigned_folder: string | null;
  rejection_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
}

const AFFILIATIONS = ['ukraine', 'russia', 'western', 'unknown'];
const RULES = ['archive_all', 'selective_archive', 'monitor_only'];
const FOLDER_OPTIONS = [
  'Discover-UA',
  'Discover-RU',
  'Discover-?',
  'Monitor-UA',
  'Monitor-RU',
  'Archive-UA',
  'Archive-RU',
];

export default function ChannelsPage() {
  // Tab state
  const [activeTab, setActiveTab] = useState<'channels' | 'submissions'>('channels');

  // Channels state
  const [channels, setChannels] = useState<Channel[]>([]);
  const [stats, setStats] = useState<ChannelStats | null>(null);
  const [folders, setFolders] = useState<{folder: string; count: number}[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  const [search, setSearch] = useState('');
  const [affiliation, setAffiliation] = useState<string>('');
  const [folder, setFolder] = useState<string>('');
  const [rule, setRule] = useState<string>('');
  const [activeOnly, setActiveOnly] = useState<boolean | undefined>(undefined);

  // Modal
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);

  // Submissions state
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [submissionActionLoading, setSubmissionActionLoading] = useState(false);

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: '25',
      });
      if (search) params.append('search', search);
      if (affiliation) params.append('affiliation', affiliation);
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
  }, [page, search, affiliation, folder, rule, activeOnly]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await adminApi.get('/api/admin/channels/stats');
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch channel stats:', err);
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

  const fetchSubmissions = useCallback(async () => {
    setSubmissionsLoading(true);
    try {
      const data = await adminApi.get('/api/channel-submissions?status_filter=pending');
      setSubmissions(data.submissions || []);
      setPendingCount(data.pending_count || 0);
    } catch (err) {
      console.error('Failed to fetch submissions:', err);
    } finally {
      setSubmissionsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  useEffect(() => {
    fetchStats();
    fetchFolders();
    fetchSubmissions();
  }, [fetchStats, fetchFolders, fetchSubmissions]);

  const handleUpdateChannel = async (channelId: number, updates: Record<string, unknown>) => {
    try {
      await adminApi.put(`/api/admin/channels/${channelId}`, updates);
      fetchChannels();
      setSelectedChannel(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const handleAcceptSubmission = async () => {
    if (!selectedSubmission || !selectedFolder) {
      alert('Please select a folder');
      return;
    }

    setSubmissionActionLoading(true);
    try {
      await adminApi.post(`/api/channel-submissions/${selectedSubmission.id}/accept`, {
        folder: selectedFolder,
      });
      fetchSubmissions();
      setSelectedSubmission(null);
      setSelectedFolder('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to accept submission');
    } finally {
      setSubmissionActionLoading(false);
    }
  };

  const handleRejectSubmission = async () => {
    if (!selectedSubmission) return;

    // Validate rejection reason (min 5 chars required by API)
    if (rejectionReason && rejectionReason.length < 5) {
      alert('Rejection reason must be at least 5 characters');
      return;
    }

    setSubmissionActionLoading(true);
    try {
      await adminApi.post(`/api/channel-submissions/${selectedSubmission.id}/reject`, {
        reason: rejectionReason || 'No reason provided',
      });
      fetchSubmissions();
      setSelectedSubmission(null);
      setRejectionReason('');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reject submission');
    } finally {
      setSubmissionActionLoading(false);
    }
  };

  const openReviewModal = (submission: Submission) => {
    setSelectedSubmission(submission);
    // Set default folder based on source_origin
    const defaultFolder =
      submission.source_origin === 'ua' ? 'Discover-UA' :
      submission.source_origin === 'ru' ? 'Discover-RU' :
      'Discover-?';
    setSelectedFolder(defaultFolder);
    setRejectionReason('');
  };

  const getOriginEmoji = (origin: string) => {
    switch (origin) {
      case 'ua': return '🇺🇦';
      case 'ru': return '🇷🇺';
      default: return '❓';
    }
  };

  const truncate = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
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
      key: 'affiliation',
      label: 'Affiliation',
      render: (_: unknown, channel: Channel) => (
        <Badge
          variant={
            channel.affiliation === 'ukrainian' ? 'info' :
            channel.affiliation === 'russian' ? 'error' :
            channel.affiliation === 'western' ? 'success' : 'default'
          }
          size="sm"
        >
          {channel.affiliation || 'unknown'}
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
            Manage Telegram channels and monitoring rules
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-border-subtle">
        <button
          onClick={() => setActiveTab('channels')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'channels'
              ? 'text-blue-500 border-b-2 border-blue-500'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Active Channels
        </button>
        <button
          onClick={() => setActiveTab('submissions')}
          className={`px-4 py-2 font-medium transition-colors flex items-center gap-2 ${
            activeTab === 'submissions'
              ? 'text-blue-500 border-b-2 border-blue-500'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Pending Submissions
          {pendingCount > 0 && (
            <Badge variant="warning" size="sm">{pendingCount}</Badge>
          )}
        </button>
      </div>

      {/* Channels Tab */}
      {activeTab === 'channels' && (
        <>
          {/* Stats Cards */}
          {stats && (
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
            value={affiliation}
            onChange={(e) => { setAffiliation(e.target.value); setPage(1); }}
            className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
          >
            <option value="">All Affiliations</option>
            {AFFILIATIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
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

      {/* Submissions Tab */}
      {activeTab === 'submissions' && (
        <>
          {/* Submissions List */}
          {submissionsLoading ? (
            <div className="glass p-8 text-center text-text-secondary">Loading submissions...</div>
          ) : submissions.length === 0 ? (
            <div className="glass p-8 text-center text-text-secondary">No pending submissions</div>
          ) : (
            <div className="glass">
              <div className="divide-y divide-border-subtle">
                {submissions.map((submission) => (
                  <div
                    key={submission.id}
                    className="p-4 hover:bg-bg-secondary cursor-pointer transition-colors"
                    onClick={() => openReviewModal(submission)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xl">{getOriginEmoji(submission.source_origin)}</span>
                          <h3 className="font-medium text-text-primary">
                            {submission.channel_name}
                          </h3>
                        </div>
                        <p className="text-sm text-text-secondary mb-2">
                          {truncate(submission.reason, 120)}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-text-tertiary">
                          <span>{new Date(submission.created_at).toLocaleDateString()}</span>
                          <span className="text-blue-500">{submission.channel_link}</span>
                        </div>
                      </div>
                      <Badge variant="warning" size="sm">Pending</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
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
              <label className="block text-sm text-text-secondary mb-1">Affiliation</label>
              <select
                value={selectedChannel.affiliation || ''}
                onChange={(e) => handleUpdateChannel(selectedChannel.id, { affiliation: e.target.value || null })}
                className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
              >
                <option value="">Unknown</option>
                {AFFILIATIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
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
          </div>
        </Modal>
      )}

      {/* Review Submission Modal */}
      {selectedSubmission && (
        <Modal
          open={true}
          title="Review Channel Submission"
          onClose={() => {
            setSelectedSubmission(null);
            setSelectedFolder('');
            setRejectionReason('');
          }}
          size="lg"
        >
          <div className="space-y-4">
            {/* Channel Info */}
            <div className="glass p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{getOriginEmoji(selectedSubmission.source_origin)}</span>
                <h3 className="font-medium text-text-primary text-lg">
                  {selectedSubmission.channel_name}
                </h3>
              </div>
              <div className="text-sm text-text-secondary">
                <strong>Link:</strong>{' '}
                <a
                  href={selectedSubmission.channel_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  {selectedSubmission.channel_link}
                </a>
              </div>
              <div className="text-sm text-text-secondary">
                <strong>Submitted:</strong> {new Date(selectedSubmission.created_at).toLocaleString()}
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Reason for Submission
              </label>
              <div className="glass p-3 text-sm text-text-primary whitespace-pre-wrap">
                {selectedSubmission.reason}
              </div>
            </div>

            {/* Value Description */}
            {selectedSubmission.value_description && (
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Value Description
                </label>
                <div className="glass p-3 text-sm text-text-primary whitespace-pre-wrap">
                  {selectedSubmission.value_description}
                </div>
              </div>
            )}

            {/* Folder Selection */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Assign to Folder
              </label>
              <select
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
                className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
              >
                {FOLDER_OPTIONS.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
              </select>
              <p className="text-xs text-text-tertiary mt-1">
                Default selected based on source origin
              </p>
            </div>

            {/* Rejection Reason (optional) */}
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Rejection Reason (optional, min 5 characters if provided)
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Provide a reason for rejection..."
                className={`w-full bg-bg-secondary border rounded px-3 py-2 text-sm h-20 ${
                  rejectionReason && rejectionReason.length < 5 ? 'border-yellow-500' : 'border-border-subtle'
                }`}
                disabled={submissionActionLoading}
              />
              {rejectionReason && rejectionReason.length > 0 && rejectionReason.length < 5 && (
                <p className="mt-1 text-xs text-yellow-400">{5 - rejectionReason.length} more characters needed</p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border-subtle">
              <button
                onClick={handleRejectSubmission}
                disabled={submissionActionLoading}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submissionActionLoading ? 'Processing...' : 'Reject'}
              </button>
              <button
                onClick={handleAcceptSubmission}
                disabled={submissionActionLoading || !selectedFolder}
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submissionActionLoading ? 'Processing...' : 'Accept & Join'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
