'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin - Extraction Patterns
 *
 * Manage configurable entity extraction patterns.
 * Operators can define regex patterns or keyword lists
 * for entity detection in archived messages.
 */

interface ExtractionPattern {
  id: number;
  name: string;
  entity_type: string;
  pattern: string;
  pattern_type: string;
  case_sensitive: boolean;
  enabled: boolean;
  description: string | null;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface PatternTestResult {
  matches: string[];
  match_count: number;
  pattern_valid: boolean;
  error: string | null;
}

const ENTITY_TYPES = [
  'hashtag',
  'mention',
  'url',
  'telegram_link',
  'coordinate',
  'custom',
];

const COLORS = [
  'gray',
  'blue',
  'green',
  'yellow',
  'orange',
  'red',
  'purple',
  'pink',
];

export default function ExtractionPage() {
  const [patterns, setPatterns] = useState<ExtractionPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editingPattern, setEditingPattern] = useState<ExtractionPattern | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    entity_type: 'custom',
    pattern: '',
    pattern_type: 'regex',
    case_sensitive: false,
    enabled: true,
    description: '',
    color: 'gray',
    sort_order: 0,
  });
  const [saving, setSaving] = useState(false);

  // Test modal state
  const [showTestModal, setShowTestModal] = useState(false);
  const [testPatternId, setTestPatternId] = useState<number | null>(null);
  const [testText, setTestText] = useState('');
  const [testResult, setTestResult] = useState<PatternTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const fetchPatterns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApi.get('/api/admin/extraction/');
      setPatterns(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch patterns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPatterns();
  }, [fetchPatterns]);

  const openCreateModal = () => {
    setEditingPattern(null);
    setFormData({
      name: '',
      entity_type: 'custom',
      pattern: '',
      pattern_type: 'regex',
      case_sensitive: false,
      enabled: true,
      description: '',
      color: 'gray',
      sort_order: 0,
    });
    setShowModal(true);
  };

  const openEditModal = (pattern: ExtractionPattern) => {
    setEditingPattern(pattern);
    setFormData({
      name: pattern.name,
      entity_type: pattern.entity_type,
      pattern: pattern.pattern,
      pattern_type: pattern.pattern_type,
      case_sensitive: pattern.case_sensitive,
      enabled: pattern.enabled,
      description: pattern.description || '',
      color: pattern.color,
      sort_order: pattern.sort_order,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingPattern(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      if (editingPattern) {
        await adminApi.put(`/api/admin/extraction/${editingPattern.id}`, formData);
        setMessage({ type: 'success', text: `Updated pattern "${formData.name}"` });
      } else {
        await adminApi.post('/api/admin/extraction/', formData);
        setMessage({ type: 'success', text: `Created pattern "${formData.name}"` });
      }
      closeModal();
      fetchPatterns();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (pattern: ExtractionPattern) => {
    if (!confirm(`Delete pattern "${pattern.name}"?`)) return;

    try {
      await adminApi.delete(`/api/admin/extraction/${pattern.id}`);
      setMessage({ type: 'success', text: `Deleted pattern "${pattern.name}"` });
      fetchPatterns();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to delete' });
    }
  };

  const handleToggleEnabled = async (pattern: ExtractionPattern) => {
    try {
      await adminApi.put(`/api/admin/extraction/${pattern.id}`, {
        enabled: !pattern.enabled,
      });
      fetchPatterns();
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to toggle' });
    }
  };

  const handleReload = async () => {
    try {
      await adminApi.post('/api/admin/extraction/reload');
      setMessage({ type: 'success', text: 'Reload signal sent to processor' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to reload' });
    }
  };

  const openTestModal = (patternId: number) => {
    setTestPatternId(patternId);
    setTestText('');
    setTestResult(null);
    setShowTestModal(true);
  };

  const handleTest = async () => {
    if (!testPatternId || !testText) return;

    setTesting(true);
    try {
      const result = await adminApi.post(`/api/admin/extraction/${testPatternId}/test`, {
        text: testText,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({
        matches: [],
        match_count: 0,
        pattern_valid: false,
        error: err instanceof Error ? err.message : 'Test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const getColorClass = (color: string) => {
    const colorMap: Record<string, string> = {
      gray: 'bg-gray-500/20 text-gray-400',
      blue: 'bg-blue-500/20 text-blue-400',
      green: 'bg-green-500/20 text-green-400',
      yellow: 'bg-yellow-500/20 text-yellow-400',
      orange: 'bg-orange-500/20 text-orange-400',
      red: 'bg-red-500/20 text-red-400',
      purple: 'bg-purple-500/20 text-purple-400',
      pink: 'bg-pink-500/20 text-pink-400',
    };
    return colorMap[color] || colorMap.gray;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Entity Extraction</h1>
          <p className="text-text-secondary mt-1">
            Configure patterns for extracting entities from messages
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleReload}
            className="px-4 py-2 bg-yellow-600/20 text-yellow-400 rounded hover:bg-yellow-600/30 transition-colors"
            title="Reload patterns in processor"
          >
            Reload Processor
          </button>
          <button
            onClick={openCreateModal}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors"
          >
            + Add Pattern
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`p-3 rounded text-sm ${
            message.type === 'success'
              ? 'bg-green-500/20 text-green-400'
              : 'bg-red-500/20 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {error && <div className="glass p-4 text-red-500">Error: {error}</div>}

      {loading ? (
        <div className="glass p-12 text-center">
          <div className="animate-pulse">Loading patterns...</div>
        </div>
      ) : (
        <div className="glass overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase">
                  Name
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase">
                  Pattern
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-text-tertiary uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {patterns.map((pattern) => (
                <tr
                  key={pattern.id}
                  className="hover:bg-bg-secondary/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleEnabled(pattern)}
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        pattern.enabled
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      {pattern.enabled ? 'enabled' : 'disabled'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${getColorClass(pattern.color)}`}>
                        {pattern.entity_type}
                      </span>
                      <span className="font-medium text-text-primary">{pattern.name}</span>
                    </div>
                    {pattern.description && (
                      <p className="text-xs text-text-tertiary mt-1">{pattern.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={pattern.pattern_type === 'regex' ? 'info' : 'warning'} size="sm">
                      {pattern.pattern_type}
                    </Badge>
                    {pattern.case_sensitive && (
                      <Badge variant="default" size="sm" className="ml-1">
                        case
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-xs text-text-secondary bg-bg-tertiary px-2 py-1 rounded max-w-xs truncate block">
                      {pattern.pattern.length > 50
                        ? pattern.pattern.slice(0, 50) + '...'
                        : pattern.pattern}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => openTestModal(pattern.id)}
                        className="px-2 py-1 text-xs bg-purple-600/20 text-purple-400 rounded hover:bg-purple-600/30"
                      >
                        Test
                      </button>
                      <button
                        onClick={() => openEditModal(pattern)}
                        className="px-2 py-1 text-xs bg-blue-600/20 text-blue-400 rounded hover:bg-blue-600/30"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(pattern)}
                        className="px-2 py-1 text-xs bg-red-600/20 text-red-400 rounded hover:bg-red-600/30"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {patterns.length === 0 && (
            <div className="p-12 text-center text-text-tertiary">
              No extraction patterns configured. Click &quot;Add Pattern&quot; to create one.
            </div>
          )}
        </div>
      )}

      {/* Info box */}
      <div className="glass p-4 bg-blue-500/5 border-blue-500/20">
        <div className="flex items-start gap-3">
          <span className="text-xl">💡</span>
          <div className="text-sm text-text-secondary">
            <p className="font-medium text-text-primary mb-1">About Extraction Patterns</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong>Regex patterns</strong> use Python regex syntax (e.g.,{' '}
                <code className="bg-bg-tertiary px-1 rounded">#[a-zA-Z0-9_]+</code>)
              </li>
              <li>
                <strong>Keyword lists</strong> are JSON arrays (e.g.,{' '}
                <code className="bg-bg-tertiary px-1 rounded">[&quot;HIMARS&quot;, &quot;Javelin&quot;]</code>)
              </li>
              <li>
                Click &quot;Reload Processor&quot; after making changes for them to take effect
              </li>
              <li>Use the &quot;Test&quot; button to verify patterns work before enabling</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bg-secondary rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-text-primary mb-4">
              {editingPattern ? 'Edit Pattern' : 'Create Pattern'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-bg-tertiary border border-border-subtle rounded px-3 py-2"
                  placeholder="e.g., Custom Pattern"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Entity Type
                  </label>
                  <select
                    value={formData.entity_type}
                    onChange={(e) => setFormData({ ...formData, entity_type: e.target.value })}
                    className="w-full bg-bg-tertiary border border-border-subtle rounded px-3 py-2"
                  >
                    {ENTITY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Pattern Type
                  </label>
                  <select
                    value={formData.pattern_type}
                    onChange={(e) => setFormData({ ...formData, pattern_type: e.target.value })}
                    className="w-full bg-bg-tertiary border border-border-subtle rounded px-3 py-2"
                  >
                    <option value="regex">Regex</option>
                    <option value="keyword_list">Keyword List</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Pattern
                </label>
                <textarea
                  value={formData.pattern}
                  onChange={(e) => setFormData({ ...formData, pattern: e.target.value })}
                  className="w-full bg-bg-tertiary border border-border-subtle rounded px-3 py-2 font-mono text-sm h-24"
                  placeholder={
                    formData.pattern_type === 'regex'
                      ? 'e.g., \\b(HIMARS|Javelin|Bradley)\\b'
                      : '["HIMARS", "Javelin", "Bradley"]'
                  }
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full bg-bg-tertiary border border-border-subtle rounded px-3 py-2"
                  placeholder="Optional description"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Color
                  </label>
                  <select
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                    className="w-full bg-bg-tertiary border border-border-subtle rounded px-3 py-2"
                  >
                    {COLORS.map((color) => (
                      <option key={color} value={color}>
                        {color}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Sort Order
                  </label>
                  <input
                    type="number"
                    value={formData.sort_order}
                    onChange={(e) =>
                      setFormData({ ...formData, sort_order: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-bg-tertiary border border-border-subtle rounded px-3 py-2"
                  />
                </div>

                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.case_sensitive}
                      onChange={(e) =>
                        setFormData({ ...formData, case_sensitive: e.target.checked })
                      }
                      className="rounded"
                    />
                    <span className="text-sm text-text-secondary">Case sensitive</span>
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.enabled}
                  onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-text-secondary">Enabled</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={closeModal}
                className="px-4 py-2 bg-bg-tertiary rounded hover:bg-bg-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !formData.name || !formData.pattern}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : editingPattern ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Test Modal */}
      {showTestModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bg-secondary rounded-lg p-6 w-full max-w-lg">
            <h2 className="text-xl font-bold text-text-primary mb-4">Test Pattern</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Sample Text
                </label>
                <textarea
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  className="w-full bg-bg-tertiary border border-border-subtle rounded px-3 py-2 h-32"
                  placeholder="Enter text to test the pattern against..."
                />
              </div>

              {testResult && (
                <div
                  className={`p-4 rounded ${
                    testResult.pattern_valid
                      ? 'bg-green-500/10 border border-green-500/20'
                      : 'bg-red-500/10 border border-red-500/20'
                  }`}
                >
                  {testResult.error ? (
                    <p className="text-red-400 text-sm">{testResult.error}</p>
                  ) : (
                    <>
                      <p className="text-text-primary font-medium mb-2">
                        Found {testResult.match_count} match{testResult.match_count !== 1 ? 'es' : ''}
                      </p>
                      {testResult.matches.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {testResult.matches.map((match, i) => (
                            <span
                              key={i}
                              className="px-2 py-1 bg-green-500/20 text-green-400 rounded text-sm"
                            >
                              {match}
                            </span>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowTestModal(false)}
                className="px-4 py-2 bg-bg-tertiary rounded hover:bg-bg-primary transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleTest}
                disabled={testing || !testText}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-500 transition-colors disabled:opacity-50"
              >
                {testing ? 'Testing...' : 'Test Pattern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
