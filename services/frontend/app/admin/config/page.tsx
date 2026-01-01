'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin - Configuration Management
 *
 * Phase 7: Runtime platform configuration with:
 * - Feature toggles
 * - System thresholds
 * - Model configuration
 * - Secrets masked by default
 */

interface ConfigItem {
  id: number;
  category: string;
  key: string;
  value: string | null;
  description: string | null;
  data_type: string;
  is_secret: boolean;
  restart_required: boolean;
  last_modified_at: string | null;
}

interface ModelConfig {
  id: number;
  task: string;
  model_id: string;
  enabled: boolean;
  priority: number;
  override_config: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

interface EnvVarItem {
  key: string;
  value: string;
  description: string;
  mutable: boolean;
  source: string;
  is_secret: boolean;
}

interface ConfigData {
  categories: Record<string, ConfigItem[]>;
  total: number;
}

export default function ConfigPage() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [envVars, setEnvVars] = useState<EnvVarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'platform' | 'models' | 'environment'>('platform');

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configData, modelsData, envData] = await Promise.all([
        adminApi.get('/api/admin/config/'),
        adminApi.get('/api/admin/config/models/'),
        adminApi.get('/api/admin/config/env').catch(() => ({ env_vars: [] })),
      ]);

      setConfig(configData);
      setModels(modelsData);
      setEnvVars(envData.env_vars || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const startEditing = (item: ConfigItem) => {
    if (item.is_secret) {
      setEditValue('');
    } else {
      setEditValue(item.value || '');
    }
    setEditingKey(item.key);
  };

  const cancelEditing = () => {
    setEditingKey(null);
    setEditValue('');
  };

  const saveConfig = async (key: string) => {
    setSaving(true);
    setMessage(null);
    try {
      const data = await adminApi.put(`/api/admin/config/${encodeURIComponent(key)}`, {
        value: editValue
      });

      setMessage({
        type: 'success',
        text: data.restart_required
          ? `Updated "${key}" - restart required`
          : `Updated "${key}"`,
      });
      setEditingKey(null);
      fetchConfig();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  const toggleModelEnabled = async (model: ModelConfig) => {
    try {
      await adminApi.put(`/api/admin/config/models/${model.id}`, {
        enabled: !model.enabled
      });

      fetchConfig();
      setMessage({ type: 'success', text: `${model.enabled ? 'Disabled' : 'Enabled'} ${model.task}:${model.model_id}` });
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to update model config' });
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'system': return '⚙️';
      case 'features': return '🔧';
      case 'thresholds': return '📊';
      default: return '📁';
    }
  };

  const renderConfigValue = (item: ConfigItem) => {
    if (editingKey === item.key) {
      return (
        <div className="flex items-center gap-2">
          {item.data_type === 'boolean' ? (
            <select
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="bg-bg-tertiary border border-border-subtle rounded px-2 py-1 text-sm"
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : (
            <input
              type={item.data_type === 'integer' || item.data_type === 'float' ? 'number' : 'text'}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder={item.is_secret ? 'Enter new value' : undefined}
              className="bg-bg-tertiary border border-border-subtle rounded px-2 py-1 text-sm w-48"
              autoFocus
            />
          )}
          <button
            onClick={() => saveConfig(item.key)}
            disabled={saving}
            className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-500 disabled:opacity-50"
          >
            {saving ? '...' : 'Save'}
          </button>
          <button
            onClick={cancelEditing}
            className="px-2 py-1 text-xs bg-bg-tertiary rounded hover:bg-bg-secondary"
          >
            Cancel
          </button>
        </div>
      );
    }

    // Display value
    const displayValue = item.value || '(not set)';

    if (item.data_type === 'boolean') {
      const isTrue = item.value?.toLowerCase() === 'true';
      return (
        <button
          onClick={() => startEditing({ ...item, value: isTrue ? 'false' : 'true' })}
          className={`px-2 py-0.5 rounded text-xs font-medium ${
            isTrue ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}
        >
          {isTrue ? 'enabled' : 'disabled'}
        </button>
      );
    }

    return (
      <span
        onClick={() => startEditing(item)}
        className="cursor-pointer hover:text-blue-400 transition-colors"
        title="Click to edit"
      >
        {displayValue}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Configuration</h1>
          <p className="text-text-secondary mt-1">
            View and manage platform settings
          </p>
        </div>
        <button
          onClick={fetchConfig}
          className="px-4 py-2 bg-bg-secondary rounded hover:bg-bg-tertiary transition-colors"
        >
          Refresh
        </button>
      </div>

      {message && (
        <div className={`p-3 rounded text-sm ${
          message.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      {error && (
        <div className="glass p-4 text-red-500">Error: {error}</div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border-subtle">
        <button
          onClick={() => setActiveTab('platform')}
          className={`px-6 py-3 font-medium border-b-2 transition-colors ${
            activeTab === 'platform'
              ? 'border-blue-500 text-blue-500'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          ⚙️ Platform Settings
        </button>
        <button
          onClick={() => setActiveTab('models')}
          className={`px-6 py-3 font-medium border-b-2 transition-colors ${
            activeTab === 'models'
              ? 'border-blue-500 text-blue-500'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          🤖 Model Configuration
        </button>
        <button
          onClick={() => setActiveTab('environment')}
          className={`px-6 py-3 font-medium border-b-2 transition-colors ${
            activeTab === 'environment'
              ? 'border-blue-500 text-blue-500'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          🌍 Environment
        </button>
      </div>

      {loading ? (
        <div className="glass p-12 text-center">
          <div className="animate-pulse">Loading configuration...</div>
        </div>
      ) : activeTab === 'environment' ? (
        /* Environment Tab */
        <div className="glass p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary">Environment Variables</h2>
            <Badge variant="info" size="sm">Read-only</Badge>
          </div>

          <p className="text-sm text-text-secondary mb-4">
            These values are set at deployment time and cannot be changed from the UI.
            To modify them, update your <code className="bg-bg-tertiary px-1 rounded">.env</code> file and restart services.
          </p>

          {envVars.length > 0 ? (
            <div className="space-y-2">
              {envVars.map((env) => (
                <div
                  key={env.key}
                  className="flex items-start justify-between p-3 bg-bg-secondary rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-text-primary">{env.key}</span>
                      {env.is_secret && (
                        <Badge variant="warning" size="sm">secret</Badge>
                      )}
                      <svg className="w-4 h-4 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                    <p className="text-xs text-text-tertiary mt-1">{env.description}</p>
                  </div>
                  <div className="ml-4 flex items-center gap-2">
                    <code className="bg-bg-tertiary px-2 py-1 rounded text-sm font-mono text-text-secondary">
                      {env.value}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(env.value)}
                      className="p-1 hover:bg-bg-tertiary rounded transition-colors"
                      title="Copy value"
                    >
                      <svg className="w-4 h-4 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-text-tertiary py-8">
              No environment variables found in allowlist
            </div>
          )}
        </div>
      ) : activeTab === 'platform' ? (
        /* Platform Settings Tab */
        <div className="space-y-6">
          {config && Object.entries(config.categories).map(([category, items]) => (
            <div key={category} className="glass p-6">
              <h2 className="text-lg font-semibold text-text-primary mb-4 flex items-center gap-2">
                <span>{getCategoryIcon(category)}</span>
                <span className="capitalize">{category}</span>
                <Badge variant="info" size="sm">{items.length}</Badge>
              </h2>

              <div className="space-y-3">
                {items.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-start justify-between p-3 bg-bg-secondary rounded-lg hover:bg-bg-tertiary transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-text-primary">{item.key}</span>
                        {item.is_secret && (
                          <Badge variant="warning" size="sm">secret</Badge>
                        )}
                        {item.restart_required && (
                          <Badge variant="error" size="sm">restart</Badge>
                        )}
                      </div>
                      {item.description && (
                        <p className="text-xs text-text-tertiary mt-1">{item.description}</p>
                      )}
                      <div className="text-xs text-text-tertiary mt-1">
                        Type: {item.data_type}
                        {item.last_modified_at && (
                          <> · Modified: {new Date(item.last_modified_at).toLocaleDateString()}</>
                        )}
                      </div>
                    </div>
                    <div className="ml-4 flex-shrink-0">
                      {renderConfigValue(item)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {config && config.total === 0 && (
            <div className="glass p-12 text-center text-text-tertiary">
              No configuration items found
            </div>
          )}
        </div>
      ) : (
        /* Model Configuration Tab */
        <div className="glass p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary">LLM Model Assignments</h2>
            <p className="text-sm text-text-tertiary">
              Configure which models handle each task
            </p>
          </div>

          {models.length > 0 ? (
            <div className="space-y-3">
              {/* Group by task */}
              {Object.entries(
                models.reduce((acc, model) => {
                  if (!acc[model.task]) acc[model.task] = [];
                  acc[model.task].push(model);
                  return acc;
                }, {} as Record<string, ModelConfig[]>)
              ).map(([task, taskModels]) => (
                <div key={task} className="p-4 bg-bg-secondary rounded-lg">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="font-medium text-text-primary capitalize">
                      {task.replace(/_/g, ' ')}
                    </span>
                    <Badge variant="info" size="sm">
                      {taskModels.filter(m => m.enabled).length}/{taskModels.length} active
                    </Badge>
                  </div>

                  <div className="space-y-2">
                    {taskModels.sort((a, b) => a.priority - b.priority).map((model) => (
                      <div
                        key={model.id}
                        className="flex items-center justify-between p-2 bg-bg-tertiary rounded"
                      >
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => toggleModelEnabled(model)}
                            className={`w-10 h-6 rounded-full transition-colors ${
                              model.enabled ? 'bg-green-500' : 'bg-gray-600'
                            }`}
                          >
                            <div className={`w-4 h-4 bg-white rounded-full transition-transform mx-1 ${
                              model.enabled ? 'translate-x-4' : 'translate-x-0'
                            }`} />
                          </button>
                          <span className="font-mono text-sm">{model.model_id}</span>
                          <Badge variant="default" size="sm">
                            Priority {model.priority}
                          </Badge>
                        </div>
                        {model.updated_at && (
                          <span className="text-xs text-text-tertiary">
                            Updated: {new Date(model.updated_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-text-tertiary py-8">
              No model configurations found.
              <p className="text-sm mt-2">
                Model configurations define which LLM models are used for different tasks.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Info box */}
      <div className="glass p-4 bg-blue-500/5 border-blue-500/20">
        <div className="flex items-start gap-3">
          <span className="text-xl">💡</span>
          <div className="text-sm text-text-secondary">
            <p className="font-medium text-text-primary mb-1">About Configuration</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Settings marked with <Badge variant="error" size="sm">restart</Badge> require a service restart to take effect</li>
              <li>Secret values are masked and need to be re-entered when editing</li>
              <li>Boolean toggles can be clicked directly to toggle</li>
              <li>Click any value to edit it inline</li>
              <li>Environment variables are read-only and set at deployment time</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
