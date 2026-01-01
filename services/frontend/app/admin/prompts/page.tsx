'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge, StatCard, DataTable } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin - LLM Prompts Configuration
 *
 * Manage LLM classification prompts with version history.
 */

interface Prompt {
  id: number;
  task: string;
  task_category: string | null;
  name: string;
  prompt_type: string;
  version: number;
  is_active: boolean;
  model_name: string | null;
  model_parameters: Record<string, unknown> | null;
  description: string | null;
  variables: string[] | null;
  expected_output_format: string | null;
  usage_count: number;
  avg_latency_ms: number | null;
  error_count: number;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  content?: string;
}

// Available models for selection
const AVAILABLE_MODELS = [
  { value: '', label: '(Use default from .env)' },
  { value: 'qwen2.5:3b', label: 'qwen2.5:3b (fast, 3B params)' },
  { value: 'qwen2.5:7b', label: 'qwen2.5:7b (balanced, 7B params)' },
  { value: 'qwen2.5:14b', label: 'qwen2.5:14b (quality, 14B params)' },
  { value: 'llama3.2:3b', label: 'llama3.2:3b (fast, 3B params)' },
  { value: 'llama3.1:8b', label: 'llama3.1:8b (balanced, 8B params)' },
  { value: 'mistral:7b', label: 'mistral:7b (balanced, 7B params)' },
];

interface PromptStats {
  total_prompts: number;
  active_prompts: number;
  total_usage: number;
  avg_latency_ms: number;
  total_errors: number;
  by_task: Record<string, {
    versions: number;
    latest_version: number;
    total_usage: number;
    total_errors: number;
    has_active: boolean;
  }>;
}

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [stats, setStats] = useState<PromptStats | null>(null);
  const [tasks, setTasks] = useState<{task: string; latest_version: number; has_active: boolean}[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [taskFilter, setTaskFilter] = useState<string>('');
  const [activeOnly, setActiveOnly] = useState<boolean | undefined>(undefined);

  // Selected prompt detail
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null);
  const [promptContent, setPromptContent] = useState<string>('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [editingModel, setEditingModel] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState(false);

  const fetchPrompts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: '25',
      });
      if (taskFilter) params.append('task', taskFilter);
      if (activeOnly !== undefined) params.append('is_active', activeOnly.toString());

      const data = await adminApi.get(`/api/admin/prompts?${params}`);
      setPrompts(data.items);
      setTotalPages(data.total_pages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [page, taskFilter, activeOnly]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await adminApi.get('/api/admin/prompts/stats');
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch prompt stats:', err);
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const data = await adminApi.get('/api/admin/prompts/tasks');
      setTasks(data);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    }
  }, []);

  const fetchPromptContent = async (promptId: number) => {
    setLoadingContent(true);
    try {
      const data = await adminApi.get(`/api/admin/prompts/${promptId}`);
      setPromptContent(data.content);
    } catch (err) {
      console.error('Failed to fetch prompt content:', err);
      setPromptContent('Failed to load content');
    } finally {
      setLoadingContent(false);
    }
  };

  const handleActivatePrompt = async (promptId: number) => {
    try {
      await adminApi.put(`/api/admin/prompts/${promptId}`, { is_active: true });
      fetchPrompts();
      fetchStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Activation failed');
    }
  };

  const handleUpdateModel = async (promptId: number, modelName: string | null) => {
    setSavingModel(true);
    try {
      await adminApi.put(`/api/admin/prompts/${promptId}`, { model_name: modelName || null });
      if (selectedPrompt) {
        setSelectedPrompt({ ...selectedPrompt, model_name: modelName || null });
      }
      setEditingModel(null);
      fetchPrompts();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSavingModel(false);
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  useEffect(() => {
    fetchStats();
    fetchTasks();
  }, [fetchStats, fetchTasks]);

  useEffect(() => {
    if (selectedPrompt) {
      fetchPromptContent(selectedPrompt.id);
    } else {
      setPromptContent('');
    }
  }, [selectedPrompt]);

  const columns = [
    {
      key: 'task',
      label: 'Task',
      render: (_: unknown, prompt: Prompt) => (
        <div>
          <div className="font-medium text-text-primary">{prompt.task}</div>
          <div className="text-xs text-text-tertiary">{prompt.name}</div>
          {prompt.task_category && (
            <Badge variant="info" size="sm" className="mt-1">
              {prompt.task_category}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'version',
      label: 'Version',
      render: (_: unknown, prompt: Prompt) => (
        <span className="text-sm font-mono">v{prompt.version}</span>
      ),
    },
    {
      key: 'model',
      label: 'Model',
      render: (_: unknown, prompt: Prompt) => (
        <span className={`text-sm font-mono ${prompt.model_name ? 'text-blue-400' : 'text-text-tertiary'}`}>
          {prompt.model_name || '(default)'}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (_: unknown, prompt: Prompt) => (
        <Badge variant={prompt.is_active ? 'success' : 'default'} size="sm">
          {prompt.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'usage',
      label: 'Usage',
      render: (_: unknown, prompt: Prompt) => (
        <span className="text-sm text-text-primary">
          {prompt.usage_count.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'latency',
      label: 'Avg Latency',
      render: (_: unknown, prompt: Prompt) => (
        <span className="text-sm text-text-secondary">
          {prompt.avg_latency_ms ? `${prompt.avg_latency_ms}ms` : '-'}
        </span>
      ),
    },
    {
      key: 'errors',
      label: 'Errors',
      render: (_: unknown, prompt: Prompt) => (
        <span className={`text-sm ${prompt.error_count > 0 ? 'text-red-500' : 'text-text-secondary'}`}>
          {prompt.error_count}
        </span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, prompt: Prompt) => (
        <div className="flex gap-2">
          <button
            onClick={() => setSelectedPrompt(prompt)}
            className="text-blue-500 hover:text-blue-400 text-sm"
          >
            View
          </button>
          {!prompt.is_active && (
            <button
              onClick={() => handleActivatePrompt(prompt.id)}
              className="text-green-500 hover:text-green-400 text-sm"
            >
              Activate
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">LLM Prompts</h1>
          <p className="text-text-secondary mt-1">
            Manage AI classification prompts and version history
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard
            title="Total Prompts"
            value={stats.total_prompts}
            icon={<span className="text-2xl">📝</span>}
          />
          <StatCard
            title="Active"
            value={stats.active_prompts}
            icon={<span className="text-2xl text-green-500">●</span>}
          />
          <StatCard
            title="Total Usage"
            value={stats.total_usage}
            icon={<span className="text-2xl">🔄</span>}
          />
          <StatCard
            title="Avg Latency"
            value={`${stats.avg_latency_ms}ms`}
            icon={<span className="text-2xl">⏱️</span>}
          />
          <StatCard
            title="Total Errors"
            value={stats.total_errors}
            icon={<span className="text-2xl text-red-500">⚠️</span>}
          />
        </div>
      )}

      {/* Task Overview */}
      {stats && (
        <div className="glass p-4">
          <h3 className="text-sm font-medium text-text-secondary mb-3">Tasks Overview</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Object.entries(stats.by_task).map(([task, data]) => (
              <div
                key={task}
                className={`p-3 rounded border cursor-pointer transition-colors ${
                  taskFilter === task
                    ? 'bg-blue-500/10 border-blue-500/30'
                    : 'bg-bg-secondary border-border-subtle hover:bg-bg-tertiary'
                }`}
                onClick={() => setTaskFilter(taskFilter === task ? '' : task)}
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="font-medium text-text-primary">{task}</span>
                  <Badge variant={data.has_active ? 'success' : 'warning'} size="sm">
                    {data.has_active ? 'Active' : 'No Active'}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-text-secondary">
                  <div>Versions: {data.versions}</div>
                  <div>Latest: v{data.latest_version}</div>
                  <div>Usage: {data.total_usage.toLocaleString()}</div>
                  <div className={data.total_errors > 0 ? 'text-red-500' : ''}>
                    Errors: {data.total_errors}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="glass p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <select
            value={taskFilter}
            onChange={(e) => { setTaskFilter(e.target.value); setPage(1); }}
            className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
          >
            <option value="">All Tasks</option>
            {tasks.map((t) => (
              <option key={t.task} value={t.task}>{t.task} (v{t.latest_version})</option>
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
          data={prompts}
          keyExtractor={(prompt) => prompt.id}
          loading={loading}
          emptyMessage="No prompts found"
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

      {/* Prompt Detail Modal */}
      {selectedPrompt && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedPrompt(null)}
        >
          <div
            className="glass max-w-4xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border-subtle flex justify-between items-center">
              <div>
                <h3 className="font-semibold text-text-primary">
                  {selectedPrompt.task} - v{selectedPrompt.version}
                </h3>
                <div className="flex gap-2 mt-1">
                  <Badge variant={selectedPrompt.is_active ? 'success' : 'default'} size="sm">
                    {selectedPrompt.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  <span className="text-sm text-text-tertiary">{selectedPrompt.name}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedPrompt(null)}
                className="p-2 hover:bg-bg-secondary rounded-full"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-4">
              {selectedPrompt.description && (
                <div>
                  <div className="text-sm text-text-secondary mb-1">Description</div>
                  <p className="text-text-primary">{selectedPrompt.description}</p>
                </div>
              )}

              {/* Model Selection */}
              <div className="p-3 rounded border border-border-subtle bg-bg-secondary">
                <div className="text-sm text-text-secondary mb-2 flex items-center gap-2">
                  <span>🤖</span> Model Override
                </div>
                {editingModel !== null ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={editingModel}
                      onChange={(e) => setEditingModel(e.target.value)}
                      className="flex-1 bg-bg-tertiary border border-border-subtle rounded px-3 py-2 text-sm"
                      disabled={savingModel}
                    >
                      {AVAILABLE_MODELS.map((m) => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleUpdateModel(selectedPrompt.id, editingModel)}
                      disabled={savingModel}
                      className="px-3 py-2 bg-green-500 text-white rounded text-sm hover:bg-green-600 disabled:opacity-50"
                    >
                      {savingModel ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditingModel(null)}
                      disabled={savingModel}
                      className="px-3 py-2 bg-bg-tertiary rounded text-sm hover:bg-bg-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="text-text-primary font-mono">
                      {selectedPrompt.model_name || '(Use default from .env)'}
                    </div>
                    <button
                      onClick={() => setEditingModel(selectedPrompt.model_name || '')}
                      className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                    >
                      Change Model
                    </button>
                  </div>
                )}
                <div className="text-xs text-text-tertiary mt-2">
                  Precedence: Prompt model → .env default → fallback (qwen2.5:3b)
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-text-secondary">Category</div>
                  <div className="font-medium">{selectedPrompt.task_category || '-'}</div>
                </div>
                <div>
                  <div className="text-text-secondary">Usage Count</div>
                  <div className="font-medium">{selectedPrompt.usage_count.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-text-secondary">Avg Latency</div>
                  <div className="font-medium">
                    {selectedPrompt.avg_latency_ms ? `${selectedPrompt.avg_latency_ms}ms` : '-'}
                  </div>
                </div>
                <div>
                  <div className="text-text-secondary">Error Count</div>
                  <div className={`font-medium ${selectedPrompt.error_count > 0 ? 'text-red-500' : ''}`}>
                    {selectedPrompt.error_count}
                  </div>
                </div>
              </div>
              {selectedPrompt.variables && selectedPrompt.variables.length > 0 && (
                <div>
                  <div className="text-sm text-text-secondary mb-1">Variables</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedPrompt.variables.map((v, i) => (
                      <Badge key={i} variant="info" size="sm">{`{${v}}`}</Badge>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="text-sm text-text-secondary mb-1">Prompt Content</div>
                {loadingContent ? (
                  <div className="p-4 bg-bg-secondary rounded animate-pulse">Loading...</div>
                ) : (
                  <pre className="p-4 bg-bg-secondary rounded text-sm overflow-auto max-h-96 whitespace-pre-wrap font-mono text-text-primary">
                    {promptContent}
                  </pre>
                )}
              </div>
              {selectedPrompt.last_error && (
                <div>
                  <div className="text-sm text-red-500 mb-1">Last Error</div>
                  <pre className="p-3 bg-red-500/10 rounded text-sm text-red-400 overflow-auto">
                    {selectedPrompt.last_error}
                  </pre>
                </div>
              )}
              {!selectedPrompt.is_active && (
                <div className="pt-4 border-t border-border-subtle">
                  <button
                    onClick={() => {
                      handleActivatePrompt(selectedPrompt.id);
                      setSelectedPrompt(null);
                    }}
                    className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
                  >
                    Activate This Version
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
