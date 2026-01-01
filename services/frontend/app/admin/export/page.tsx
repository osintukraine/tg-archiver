'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge, StatCard } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin - Data Export
 *
 * Create and manage data exports with flexible filtering.
 * Supports JSON, CSV, and JSONL formats with column profile selection.
 */

interface ExportProfile {
  name: string;
  description: string;
  columns: string[];
  estimated_size_per_row_bytes: number;
}

interface ExportJob {
  id: string;
  status: string;
  export_type: string;
  format: string;
  profile: string;
  label: string | null;
  filters: Record<string, unknown>;
  total_rows: number | null;
  processed_rows: number;
  progress_percent: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  download_url: string | null;
  file_size_bytes: number | null;
  file_size_human: string | null;
}

interface ExportEstimate {
  estimated_rows: number;
  estimated_size_bytes: number;
  estimated_size_human: string;
  processing_tier: string;
  estimated_duration_seconds: number | null;
}

interface ExportStats {
  status_counts: Record<string, number>;
  exports_last_24h: number;
  total_data_exported_bytes: number;
  total_data_exported_human: string;
  queue_depth: number;
  active_jobs: number;
}

interface Channel {
  id: number;
  name: string;
  username: string;
}

export default function ExportPage() {
  // State
  const [profiles, setProfiles] = useState<Record<string, ExportProfile>>({});
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [stats, setStats] = useState<ExportStats | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [estimate, setEstimate] = useState<ExportEstimate | null>(null);

  // Form state
  const [exportType, setExportType] = useState('messages');
  const [format, setFormat] = useState('json');
  const [profile, setProfile] = useState('standard');
  const [label, setLabel] = useState('');
  const [selectedChannels, setSelectedChannels] = useState<number[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [importance, setImportance] = useState('');
  const [isSpam, setIsSpam] = useState<string>('false');
  const [hasMedia, setHasMedia] = useState<string>('');

  // Fetch initial data
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [profilesData, jobsData, statsData, channelsData] = await Promise.all([
        adminApi.get('/api/admin/export/profiles'),
        adminApi.get('/api/admin/export/jobs?page=1&page_size=20'),
        adminApi.get('/api/admin/export/stats/summary'),
        adminApi.get('/api/admin/channels?page=1&page_size=100'),
      ]);

      setProfiles(profilesData.profiles || {});
      setJobs(jobsData.jobs || []);
      setStats(statsData);
      setChannels(channelsData.channels || []);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000); // Refresh every 15s
    return () => clearInterval(interval);
  }, [fetchData]);

  // Estimate export size
  const estimateExport = async () => {
    const filters: Record<string, unknown> = {};
    if (selectedChannels.length > 0) filters.channel_ids = selectedChannels;
    if (dateFrom) filters.date_from = dateFrom;
    if (dateTo) filters.date_to = dateTo;
    if (importance) filters.importance_level = importance;
    if (isSpam !== '') filters.is_spam = isSpam === 'true';
    if (hasMedia !== '') filters.has_media = hasMedia === 'true';

    try {
      const data = await adminApi.post('/api/admin/export/estimate', {
        export_type: exportType,
        format,
        profile,
        filters,
      });
      setEstimate(data);
    } catch (err) {
      console.error('Failed to estimate:', err);
    }
  };

  // Create export job
  const createExport = async () => {
    setCreating(true);
    const filters: Record<string, unknown> = {};
    if (selectedChannels.length > 0) filters.channel_ids = selectedChannels;
    if (dateFrom) filters.date_from = dateFrom;
    if (dateTo) filters.date_to = dateTo;
    if (importance) filters.importance_level = importance;
    if (isSpam !== '') filters.is_spam = isSpam === 'true';
    if (hasMedia !== '') filters.has_media = hasMedia === 'true';

    try {
      await adminApi.post('/api/admin/export/start', {
        export_type: exportType,
        format,
        profile,
        label: label || undefined,
        filters,
      });

      // Refresh jobs list
      await fetchData();
      // Reset form
      setLabel('');
      setEstimate(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to create export';
      alert(errorMsg);
    } finally {
      setCreating(false);
    }
  };

  // Cancel/delete job
  const deleteJob = async (jobId: string) => {
    if (!confirm('Are you sure you want to cancel/delete this export?')) return;

    try {
      await adminApi.delete(`/api/admin/export/${jobId}`);
      await fetchData();
    } catch (err) {
      console.error('Failed to delete job:', err);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="success" size="sm">Completed</Badge>;
      case 'processing':
        return <Badge variant="info" size="sm">Processing</Badge>;
      case 'pending':
        return <Badge variant="warning" size="sm">Pending</Badge>;
      case 'failed':
        return <Badge variant="error" size="sm">Failed</Badge>;
      case 'cancelled':
        return <Badge variant="default" size="sm">Cancelled</Badge>;
      default:
        return <Badge variant="default" size="sm">{status}</Badge>;
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Data Export</h1>
          <p className="text-text-secondary mt-1">
            Export messages and data with flexible filtering
          </p>
        </div>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-bg-secondary rounded hover:bg-bg-tertiary transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Stats Summary */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard
            title="Queue Depth"
            value={stats.queue_depth}
            icon={<span className="text-2xl">📋</span>}
          />
          <StatCard
            title="Active Jobs"
            value={stats.active_jobs}
            icon={<span className="text-2xl">⚙️</span>}
          />
          <StatCard
            title="Completed"
            value={stats.status_counts?.completed || 0}
            icon={<span className="text-2xl">✅</span>}
          />
          <StatCard
            title="Exports (24h)"
            value={stats.exports_last_24h}
            icon={<span className="text-2xl">📊</span>}
          />
          <StatCard
            title="Total Exported"
            value={stats.total_data_exported_human || '0 B'}
            icon={<span className="text-2xl">💾</span>}
          />
        </div>
      )}

      {/* Create Export Form */}
      <div className="glass p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Create New Export</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {/* Export Type */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">Export Type</label>
            <select
              value={exportType}
              onChange={(e) => setExportType(e.target.value)}
              className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
            >
              <option value="messages">Messages</option>
              <option value="channels" disabled>Channels (coming soon)</option>
              <option value="entities" disabled>Entities (coming soon)</option>
            </select>
          </div>

          {/* Format */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
            >
              <option value="json">JSON</option>
              <option value="jsonl">JSONL (streaming)</option>
              <option value="csv">CSV</option>
            </select>
          </div>

          {/* Profile */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">Column Profile</label>
            <select
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
            >
              {Object.entries(profiles).map(([key, prof]) => (
                <option key={key} value={key}>
                  {prof.name} - {prof.description}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {/* Date From */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">Date From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">Date To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
            />
          </div>

          {/* Importance */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">Importance</label>
            <select
              value={importance}
              onChange={(e) => setImportance(e.target.value)}
              className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
            >
              <option value="">All</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {/* Spam Filter */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">Include Spam</label>
            <select
              value={isSpam}
              onChange={(e) => setIsSpam(e.target.value)}
              className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
            >
              <option value="false">Exclude spam</option>
              <option value="true">Include spam</option>
              <option value="">All messages</option>
            </select>
          </div>

          {/* Media Filter */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">Media</label>
            <select
              value={hasMedia}
              onChange={(e) => setHasMedia(e.target.value)}
              className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
            >
              <option value="">All</option>
              <option value="true">With media only</option>
              <option value="false">Without media</option>
            </select>
          </div>

          {/* Label */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">Label (optional)</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g., Q4 Combat Reports"
              className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2"
            />
          </div>
        </div>

        {/* Channel Selection */}
        <div className="mb-4">
          <label className="block text-sm text-text-secondary mb-1">
            Channels (select to filter, leave empty for all)
          </label>
          <div className="max-h-32 overflow-y-auto bg-bg-secondary border border-border-subtle rounded p-2">
            <div className="flex flex-wrap gap-2">
              {channels.map((ch) => (
                <label key={ch.id} className="flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedChannels.includes(ch.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedChannels([...selectedChannels, ch.id]);
                      } else {
                        setSelectedChannels(selectedChannels.filter((id) => id !== ch.id));
                      }
                    }}
                    className="rounded"
                  />
                  <span className="text-text-primary">{ch.name || ch.username}</span>
                </label>
              ))}
            </div>
          </div>
          {selectedChannels.length > 0 && (
            <div className="text-xs text-text-tertiary mt-1">
              {selectedChannels.length} channel(s) selected
            </div>
          )}
        </div>

        {/* Estimate */}
        {estimate && (
          <div className="bg-bg-secondary p-4 rounded mb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-text-tertiary">Estimated Rows</div>
                <div className="text-text-primary font-medium">{estimate.estimated_rows.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-text-tertiary">Estimated Size</div>
                <div className="text-text-primary font-medium">{estimate.estimated_size_human}</div>
              </div>
              <div>
                <div className="text-text-tertiary">Processing</div>
                <div className="text-text-primary font-medium">
                  {estimate.processing_tier === 'direct_streaming' ? 'Direct (fast)' : 'Background Job'}
                </div>
              </div>
              {estimate.estimated_duration_seconds && (
                <div>
                  <div className="text-text-tertiary">Est. Duration</div>
                  <div className="text-text-primary font-medium">
                    ~{Math.ceil(estimate.estimated_duration_seconds / 60)} min
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-4">
          <button
            onClick={estimateExport}
            className="px-4 py-2 bg-bg-secondary rounded hover:bg-bg-tertiary transition-colors"
          >
            Estimate Size
          </button>
          <button
            onClick={createExport}
            disabled={creating}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 transition-colors"
          >
            {creating ? 'Creating...' : 'Start Export'}
          </button>
        </div>
      </div>

      {/* Export Jobs List */}
      <div className="glass p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Export Jobs</h2>

        {loading ? (
          <div className="animate-pulse space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-bg-secondary rounded"></div>
            ))}
          </div>
        ) : jobs.length > 0 ? (
          <div className="space-y-4">
            {jobs.map((job) => (
              <div
                key={job.id}
                className="bg-bg-secondary p-4 rounded flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    {getStatusBadge(job.status)}
                    <span className="font-medium text-text-primary">
                      {job.label || `${job.export_type} export`}
                    </span>
                    <span className="text-text-tertiary text-sm">
                      {job.format.toUpperCase()} • {job.profile}
                    </span>
                  </div>
                  <div className="text-sm text-text-tertiary">
                    Created: {formatDate(job.created_at)}
                    {job.completed_at && ` • Completed: ${formatDate(job.completed_at)}`}
                  </div>
                  {job.status === 'processing' && (
                    <div className="mt-2">
                      <div className="w-full bg-bg-tertiary rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all"
                          style={{ width: `${job.progress_percent}%` }}
                        ></div>
                      </div>
                      <div className="text-xs text-text-tertiary mt-1">
                        {job.processed_rows.toLocaleString()} / {job.total_rows?.toLocaleString() || '?'} rows ({job.progress_percent.toFixed(1)}%)
                      </div>
                    </div>
                  )}
                  {job.error_message && (
                    <div className="text-sm text-red-500 mt-1">{job.error_message}</div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {job.file_size_human && (
                    <span className="text-sm text-text-tertiary">{job.file_size_human}</span>
                  )}
                  {job.download_url && (
                    <a
                      href={job.download_url}
                      className="px-3 py-1 bg-green-500 text-white text-sm rounded hover:bg-green-600"
                    >
                      Download
                    </a>
                  )}
                  <button
                    onClick={() => deleteJob(job.id)}
                    className="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                  >
                    {job.status === 'processing' || job.status === 'pending' ? 'Cancel' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-text-tertiary py-8">
            No export jobs yet. Create one above!
          </div>
        )}
      </div>

      {/* Profile Info */}
      <div className="glass p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Column Profiles Reference</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(profiles).map(([key, prof]) => (
            <div key={key} className="bg-bg-secondary p-4 rounded">
              <h3 className="font-medium text-text-primary">{prof.name}</h3>
              <p className="text-sm text-text-tertiary mb-2">{prof.description}</p>
              <div className="text-xs text-text-tertiary">
                ~{prof.estimated_size_per_row_bytes} bytes/row
              </div>
              {'columns' in prof && (
                <div className="text-xs text-text-tertiary mt-2">
                  {(prof as ExportProfile).columns.length} columns
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
