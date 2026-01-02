'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Badge, StatCard } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin - Channel Import
 *
 * Import channels from CSV files with validation and folder management.
 * Supports batch channel joining with rate limiting.
 */

// TypeScript interfaces for API responses
interface ImportChannel {
  id: string;
  channel_url: string;
  channel_username: string | null;
  channel_name: string | null;
  target_folder: string | null;
  status: string;
  validation_data: {
    telegram_id?: number;
    title?: string;
    participants_count?: number;
    verified?: boolean;
    already_member?: boolean;
    already_in_db?: boolean;
  } | null;
  error_message: string | null;
  error_code: string | null;
  selected: boolean;
}

interface ImportJobCounters {
  total: number;
  validated: number;
  joined: number;
  failed: number;
  skipped: number;
}

interface ImportJob {
  id: string;
  filename: string;
  status: string;
  counters: ImportJobCounters;
  progress_percent: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  channels_by_folder: Record<string, ImportChannel[]>;
}

interface ImportJobSummary {
  id: string;
  filename: string;
  status: string;
  total_channels: number;
  joined_channels: number;
  failed_channels: number;
  progress_percent: number;
  created_at: string;
}

interface LogEntry {
  id: number;
  event_type: string;
  event_code: string | null;
  message: string;
  created_at: string;
}

interface UploadResponse {
  job_id: string;
  filename: string;
  total_channels: number;
  detected_folders: string[];
  has_folder_column: boolean;
}

export default function ImportPage() {
  // State
  const [jobs, setJobs] = useState<ImportJobSummary[]>([]);
  const [activeJob, setActiveJob] = useState<ImportJob | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [showLogs, setShowLogs] = useState(false);

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // File input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch jobs list
  const fetchJobs = useCallback(async () => {
    try {
      const data = await adminApi.get('/api/admin/import/jobs?page=1&page_size=20');
      setJobs(data.jobs || []);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    }
  }, []);

  // Fetch active job details
  const fetchJobDetails = useCallback(async (jobId: string) => {
    try {
      const data = await adminApi.get(`/api/admin/import/${jobId}`);
      setActiveJob(data);

      // Initialize selection from job data
      const selected = new Set<string>();
      const folderData = data.channels_by_folder || {};
      (Object.values(folderData) as ImportChannel[][]).forEach((channels) => {
        channels.forEach((ch) => {
          if (ch.selected) selected.add(ch.id);
        });
      });
      setSelectedChannels(selected);

      // Expand all folders by default
      setExpandedFolders(new Set(Object.keys(data.channels_by_folder || {})));
    } catch (err) {
      console.error('Failed to fetch job:', err);
    }
  }, []);

  // Fetch job logs
  const fetchLogs = useCallback(async (jobId: string) => {
    try {
      const data = await adminApi.get(`/api/admin/import/${jobId}/log?limit=100`);
      setLogs(data.logs || []);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  }, []);

  // Initial load and polling
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await fetchJobs();
      setLoading(false);
    };
    load();

    // Poll for updates
    const interval = setInterval(() => {
      fetchJobs();
      if (activeJob) {
        fetchJobDetails(activeJob.id);
        if (showLogs) fetchLogs(activeJob.id);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchJobs, fetchJobDetails, fetchLogs, activeJob, showLogs]);

  // Upload file to server
  const uploadFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Only CSV files are supported');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append('file', file);

      // Upload requires multipart form, need custom fetch
      const token = localStorage.getItem('tg_archiver_token');
      const response = await fetch('/api/admin/import/upload', {
        method: 'POST',
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Upload failed' }));
        throw new Error(errorData.detail || 'Upload failed');
      }

      const data: UploadResponse = await response.json();

      // Fetch the created job
      await fetchJobs();
      await fetchJobDetails(data.job_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      console.error('Upload error:', err);
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Handle file input change
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await uploadFile(file);
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await uploadFile(files[0]);
    }
  };

  // Trigger validation
  const triggerValidation = async () => {
    if (!activeJob) return;

    try {
      await adminApi.post(`/api/admin/import/${activeJob.id}/validate`);
      await fetchJobDetails(activeJob.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation failed';
      setError(message);
    }
  };

  // Start import
  const startImport = async () => {
    if (!activeJob) return;

    // Update selection first
    const channelIds = Array.from(selectedChannels);
    if (channelIds.length === 0) {
      setError('No channels selected');
      return;
    }

    try {
      // Update selection
      await adminApi.patch(`/api/admin/import/${activeJob.id}/channels`, {
        channel_ids: channelIds,
        selected: true,
      });

      // Start import
      await adminApi.post(`/api/admin/import/${activeJob.id}/start`);
      await fetchJobDetails(activeJob.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Start failed';
      setError(message);
    }
  };

  // Cancel/delete job
  const deleteJob = async (jobId: string) => {
    if (!confirm('Are you sure you want to cancel/delete this job?')) return;

    try {
      await adminApi.delete(`/api/admin/import/${jobId}`);
      if (activeJob?.id === jobId) {
        setActiveJob(null);
      }
      await fetchJobs();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // Toggle folder expansion
  const toggleFolder = (folder: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folder)) {
      newExpanded.delete(folder);
    } else {
      newExpanded.add(folder);
    }
    setExpandedFolders(newExpanded);
  };

  // Toggle channel selection
  const toggleChannel = (channelId: string) => {
    const newSelected = new Set(selectedChannels);
    if (newSelected.has(channelId)) {
      newSelected.delete(channelId);
    } else {
      newSelected.add(channelId);
    }
    setSelectedChannels(newSelected);
  };

  // Select all in folder
  const selectAllInFolder = (folder: string, channels: ImportChannel[]) => {
    const newSelected = new Set(selectedChannels);
    const validChannels = channels.filter(
      (ch) => ch.status === 'validated' || ch.status === 'pending'
    );
    const allSelected = validChannels.every((ch) => newSelected.has(ch.id));

    validChannels.forEach((ch) => {
      if (allSelected) {
        newSelected.delete(ch.id);
      } else {
        newSelected.add(ch.id);
      }
    });
    setSelectedChannels(newSelected);
  };

  // Status badge helper
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="success" size="sm">Completed</Badge>;
      case 'processing':
        return <Badge variant="info" size="sm">Processing</Badge>;
      case 'validating':
        return <Badge variant="info" size="sm">Validating</Badge>;
      case 'ready':
        return <Badge variant="success" size="sm">Ready</Badge>;
      case 'uploading':
        return <Badge variant="warning" size="sm">Uploading</Badge>;
      case 'failed':
        return <Badge variant="error" size="sm">Failed</Badge>;
      case 'cancelled':
        return <Badge variant="default" size="sm">Cancelled</Badge>;
      case 'validated':
        return <Badge variant="success" size="sm">Valid</Badge>;
      case 'validation_failed':
        return <Badge variant="error" size="sm">Invalid</Badge>;
      case 'joined':
        return <Badge variant="success" size="sm">Joined</Badge>;
      case 'already_member':
        return <Badge variant="info" size="sm">Already Member</Badge>;
      case 'join_failed':
        return <Badge variant="error" size="sm">Join Failed</Badge>;
      case 'pending':
        return <Badge variant="default" size="sm">Pending</Badge>;
      default:
        return <Badge variant="default" size="sm">{status}</Badge>;
    }
  };

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString();
  };

  // Check if job is in a state that allows validation
  const canValidate = activeJob && ['uploading', 'ready'].includes(activeJob.status);

  // Check if job is in a state that allows starting
  const canStart = activeJob && activeJob.status === 'ready' && selectedChannels.size > 0;

  return (
    <div
      className="space-y-6 relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-bg-primary/90 backdrop-blur-sm flex items-center justify-center">
          <div className="border-4 border-dashed border-blue-500 rounded-2xl p-16 bg-blue-500/10">
            <div className="text-center">
              <div className="text-6xl mb-4">📁</div>
              <h2 className="text-2xl font-bold text-text-primary mb-2">Drop your CSV file here</h2>
              <p className="text-text-secondary">Release to upload and start importing channels</p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Channel Import</h1>
          <p className="text-text-secondary mt-1">
            Import channels from CSV files with validation and rate-limited joining
          </p>
        </div>
        <button
          onClick={() => fetchJobs()}
          className="px-4 py-2 bg-bg-secondary rounded hover:bg-bg-tertiary transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Drop Zone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className={`
          border-2 border-dashed rounded-xl p-8 cursor-pointer transition-all
          ${uploading
            ? 'border-blue-500/50 bg-blue-500/5'
            : 'border-border-subtle hover:border-blue-500 hover:bg-blue-500/5'
          }
        `}
      >
        <div className="flex flex-col items-center justify-center text-center">
          {uploading ? (
            <>
              <div className="animate-spin text-4xl mb-3">⏳</div>
              <h3 className="text-lg font-medium text-text-primary">Uploading...</h3>
              <p className="text-text-tertiary mt-1">Processing your CSV file</p>
            </>
          ) : (
            <>
              <div className="text-4xl mb-3">📤</div>
              <h3 className="text-lg font-medium text-text-primary">
                Drop a CSV file here or click to upload
              </h3>
              <p className="text-text-tertiary mt-1">
                Supports files with Channel, Name, and Folder columns
              </p>
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded p-4 flex justify-between items-center">
          <span className="text-red-400">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
            Dismiss
          </button>
        </div>
      )}

      {/* Stats */}
      {activeJob && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard
            title="Total Channels"
            value={activeJob.counters.total}
            icon={<span className="text-2xl">📺</span>}
          />
          <StatCard
            title="Validated"
            value={activeJob.counters.validated}
            icon={<span className="text-2xl">✅</span>}
          />
          <StatCard
            title="Joined"
            value={activeJob.counters.joined}
            icon={<span className="text-2xl">🔗</span>}
          />
          <StatCard
            title="Failed"
            value={activeJob.counters.failed}
            icon={<span className="text-2xl">❌</span>}
          />
          <StatCard
            title="Selected"
            value={selectedChannels.size}
            icon={<span className="text-2xl">☑️</span>}
          />
        </div>
      )}

      {/* Main Content: Job List or Active Job */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Jobs List */}
        <div className="glass p-6">
          <h2 className="text-lg font-semibold text-text-primary mb-4">Import Jobs</h2>

          {loading ? (
            <div className="animate-pulse space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 bg-bg-secondary rounded"></div>
              ))}
            </div>
          ) : jobs.length > 0 ? (
            <div className="space-y-3">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  onClick={() => fetchJobDetails(job.id)}
                  className={`p-4 rounded cursor-pointer transition-colors ${
                    activeJob?.id === job.id
                      ? 'bg-blue-500/20 border border-blue-500/30'
                      : 'bg-bg-secondary hover:bg-bg-tertiary'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-medium text-text-primary truncate">
                      {job.filename}
                    </span>
                    {getStatusBadge(job.status)}
                  </div>
                  <div className="text-sm text-text-tertiary">
                    {job.total_channels} channels • {formatDate(job.created_at)}
                  </div>
                  {job.status === 'processing' && (
                    <div className="mt-2">
                      <div className="w-full bg-bg-tertiary rounded-full h-1.5">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full transition-all"
                          style={{ width: `${job.progress_percent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-text-tertiary py-8">
              No import jobs yet. Upload a CSV to get started!
            </div>
          )}
        </div>

        {/* Active Job Details */}
        <div className="lg:col-span-2 glass p-6">
          {activeJob ? (
            <div>
              {/* Job Header */}
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-text-primary">
                    {activeJob.filename}
                  </h2>
                  <div className="flex gap-2 mt-2">
                    {getStatusBadge(activeJob.status)}
                    <span className="text-sm text-text-tertiary">
                      {formatDate(activeJob.created_at)}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {canValidate && (
                    <button
                      onClick={triggerValidation}
                      className="px-3 py-1.5 bg-yellow-500 text-white text-sm rounded hover:bg-yellow-600"
                    >
                      Validate
                    </button>
                  )}
                  {canStart && (
                    <button
                      onClick={startImport}
                      className="px-3 py-1.5 bg-green-500 text-white text-sm rounded hover:bg-green-600"
                    >
                      Start Import
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setShowLogs(!showLogs);
                      if (!showLogs) fetchLogs(activeJob.id);
                    }}
                    className={`px-3 py-1.5 text-sm rounded ${
                      showLogs
                        ? 'bg-blue-500 text-white'
                        : 'bg-bg-secondary text-text-primary hover:bg-bg-tertiary'
                    }`}
                  >
                    {showLogs ? 'Hide Logs' : 'Show Logs'}
                  </button>
                  <button
                    onClick={() => deleteJob(activeJob.id)}
                    className="px-3 py-1.5 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                  >
                    {activeJob.status === 'processing' ? 'Cancel' : 'Delete'}
                  </button>
                </div>
              </div>

              {/* Progress Bar */}
              {['validating', 'processing'].includes(activeJob.status) && (
                <div className="mb-6">
                  <div className="w-full bg-bg-secondary rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${activeJob.progress_percent}%` }}
                    />
                  </div>
                  <div className="text-xs text-text-tertiary mt-1 text-right">
                    {activeJob.progress_percent.toFixed(1)}% complete
                  </div>
                </div>
              )}

              {/* Logs Panel */}
              {showLogs && (
                <div className="mb-6 bg-bg-secondary rounded p-4 max-h-48 overflow-y-auto">
                  <h3 className="font-medium text-text-primary mb-2">Event Log</h3>
                  {logs.length > 0 ? (
                    <div className="space-y-1 text-sm font-mono">
                      {logs.map((log) => (
                        <div
                          key={log.id}
                          className={`flex gap-2 ${
                            log.event_type === 'error'
                              ? 'text-red-400'
                              : log.event_type === 'warning'
                                ? 'text-yellow-400'
                                : log.event_type === 'success'
                                  ? 'text-green-400'
                                  : 'text-text-tertiary'
                          }`}
                        >
                          <span className="text-text-tertiary whitespace-nowrap">
                            {new Date(log.created_at).toLocaleTimeString()}
                          </span>
                          <span className="uppercase w-16">[{log.event_type}]</span>
                          <span>{log.message}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-text-tertiary">No logs yet</div>
                  )}
                </div>
              )}

              {/* Channels by Folder */}
              <div className="space-y-4">
                {Object.entries(activeJob.channels_by_folder || {}).map(([folder, channels]) => (
                  <div key={folder} className="bg-bg-secondary rounded overflow-hidden">
                    {/* Folder Header */}
                    <div
                      onClick={() => toggleFolder(folder)}
                      className="flex justify-between items-center p-3 cursor-pointer hover:bg-bg-tertiary"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">
                          {expandedFolders.has(folder) ? '📂' : '📁'}
                        </span>
                        <span className="font-medium text-text-primary">{folder}</span>
                        <span className="text-sm text-text-tertiary">
                          ({channels.length} channels)
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          selectAllInFolder(folder, channels);
                        }}
                        className="text-xs px-2 py-1 bg-bg-tertiary rounded hover:bg-bg-secondary"
                      >
                        Toggle All
                      </button>
                    </div>

                    {/* Channels */}
                    {expandedFolders.has(folder) && (
                      <div className="border-t border-border-subtle">
                        {channels.map((channel) => (
                          <div
                            key={channel.id}
                            className="flex items-center gap-3 p-3 border-b border-border-subtle last:border-b-0"
                          >
                            {/* Selection Checkbox */}
                            <input
                              type="checkbox"
                              checked={selectedChannels.has(channel.id)}
                              onChange={() => toggleChannel(channel.id)}
                              disabled={
                                channel.status === 'validation_failed' ||
                                channel.status === 'joined' ||
                                channel.status === 'join_failed'
                              }
                              className="rounded"
                            />

                            {/* Channel Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-text-primary truncate">
                                  {channel.channel_name || channel.channel_username || 'Unknown'}
                                </span>
                                {channel.validation_data?.verified && (
                                  <span title="Verified">✓</span>
                                )}
                              </div>
                              <div className="text-sm text-text-tertiary truncate">
                                @{channel.channel_username || 'unknown'} •{' '}
                                {channel.validation_data?.participants_count
                                  ? `${channel.validation_data.participants_count.toLocaleString()} members`
                                  : channel.channel_url}
                              </div>
                            </div>

                            {/* Status */}
                            <div className="flex items-center gap-2">
                              {channel.validation_data?.already_member && (
                                <Badge variant="info" size="sm">Member</Badge>
                              )}
                              {channel.validation_data?.already_in_db && (
                                <Badge variant="default" size="sm">In DB</Badge>
                              )}
                              {getStatusBadge(channel.status)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {Object.keys(activeJob.channels_by_folder || {}).length === 0 && (
                  <div className="text-center text-text-tertiary py-8">
                    No channels loaded yet
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-center text-text-tertiary py-16">
              <div className="text-4xl mb-4">📁</div>
              <p>Select a job from the list or upload a new CSV file</p>
              <p className="text-sm mt-2">
                CSV format: Channel URL, Name (optional), Folder (optional)
              </p>
            </div>
          )}
        </div>
      </div>

      {/* CSV Format Help */}
      <div className="glass p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">CSV Format Guide</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="font-medium text-text-primary mb-2">Required Column</h3>
            <ul className="list-disc list-inside text-text-secondary space-y-1">
              <li><code className="bg-bg-secondary px-1 rounded">Channel</code> or <code className="bg-bg-secondary px-1 rounded">URL</code> - Telegram channel URL or username</li>
            </ul>

            <h3 className="font-medium text-text-primary mt-4 mb-2">Optional Columns</h3>
            <ul className="list-disc list-inside text-text-secondary space-y-1">
              <li><code className="bg-bg-secondary px-1 rounded">Name</code> - Display name for the channel</li>
              <li><code className="bg-bg-secondary px-1 rounded">Folder</code> - Target Telegram folder (will be created if needed)</li>
            </ul>
          </div>

          <div>
            <h3 className="font-medium text-text-primary mb-2">Example CSV</h3>
            <pre className="bg-bg-secondary p-4 rounded text-sm font-mono overflow-x-auto">
{`Channel,Name,Folder
https://t.me/example_channel,Example Channel,News
@another_channel,Another Channel,Updates
t.me/third_channel,,Archive`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
