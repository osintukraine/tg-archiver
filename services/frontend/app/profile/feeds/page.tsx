'use client';

import { useState, useEffect, useCallback } from 'react';
import { API_URL } from '@/lib/api';

// ============================================================================
// Types
// ============================================================================

interface FeedToken {
  id: string;
  prefix: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  use_count: number;
  is_active: boolean;
}

interface FeedSubscription {
  id: string;
  feed_type: string;
  summary: string;
  label: string | null;
  params: Record<string, unknown>;
  status: 'active' | 'stale' | 'archived';
  last_accessed_at: string;
  access_count: number;
  created_at: string;
}

interface SubscriptionCounts {
  active: number;
  stale: number;
  archived: number;
}

interface NewToken {
  id: string;
  token: string;
  prefix: string;
  label: string | null;
}

// ============================================================================
// Main Component
// ============================================================================

export default function FeedTokensPage() {
  // Token state
  const [tokens, setTokens] = useState<FeedToken[]>([]);
  const [newToken, setNewToken] = useState<NewToken | null>(null);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  // Subscription state
  const [expandedTokens, setExpandedTokens] = useState<Set<string>>(new Set());
  const [tokenSubscriptions, setTokenSubscriptions] = useState<Record<string, FeedSubscription[]>>({});
  const [tokenCounts, setTokenCounts] = useState<Record<string, SubscriptionCounts>>({});
  const [loadingSubscriptions, setLoadingSubscriptions] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState<Set<string>>(new Set());

  // Modal state
  const [editingLabel, setEditingLabel] = useState<{ tokenId: string; subId: string; current: string } | null>(null);
  const [cloneModal, setCloneModal] = useState<{ tokenId: string; sub: FeedSubscription } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // ============================================================================
  // Token API Functions
  // ============================================================================

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/feed-tokens`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setTokens(data.tokens);
      } else if (res.status === 401) {
        setError('Please log in to manage feed tokens.');
      }
    } catch {
      setError('Failed to load tokens.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAuthStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/feed-tokens/auth-status`);
      if (res.ok) {
        const data = await res.json();
        setAuthRequired(data.auth_required);
      }
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    fetchTokens();
    fetchAuthStatus();
  }, [fetchTokens, fetchAuthStatus]);

  const createToken = async () => {
    setCreating(true);
    setError(null);
    setNewToken(null);

    try {
      const res = await fetch(`${API_URL}/api/feed-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ label: label || null }),
      });

      if (res.ok) {
        const data = await res.json();
        setNewToken(data);
        setLabel('');
        fetchTokens();
      } else {
        const errData = await res.json();
        setError(errData.detail || 'Failed to create token.');
      }
    } catch {
      setError('Failed to create token.');
    } finally {
      setCreating(false);
    }
  };

  const revokeToken = async (tokenId: string) => {
    if (!confirm('Revoke this token? All feed URLs using it will stop working.')) {
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/feed-tokens/${tokenId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        fetchTokens();
      } else {
        const errData = await res.json();
        setError(errData.detail || 'Failed to revoke token.');
      }
    } catch {
      setError('Failed to revoke token.');
    }
  };

  const copyToken = () => {
    if (newToken) {
      navigator.clipboard.writeText(newToken.token);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  // ============================================================================
  // Subscription API Functions
  // ============================================================================

  const fetchSubscriptions = async (tokenId: string, includeArchived: boolean = false) => {
    setLoadingSubscriptions((prev) => new Set(prev).add(tokenId));

    try {
      const res = await fetch(
        `${API_URL}/api/feed-tokens/${tokenId}/subscriptions?include_archived=${includeArchived}`,
        { credentials: 'include' }
      );

      if (res.ok) {
        const data = await res.json();
        setTokenSubscriptions((prev) => ({ ...prev, [tokenId]: data.subscriptions }));
        setTokenCounts((prev) => ({ ...prev, [tokenId]: data.counts }));
      }
    } catch {
      console.error('Failed to fetch subscriptions');
    } finally {
      setLoadingSubscriptions((prev) => {
        const next = new Set(prev);
        next.delete(tokenId);
        return next;
      });
    }
  };

  const toggleToken = async (tokenId: string) => {
    const newExpanded = new Set(expandedTokens);
    if (newExpanded.has(tokenId)) {
      newExpanded.delete(tokenId);
    } else {
      newExpanded.add(tokenId);
      // Fetch subscriptions if not already loaded
      if (!tokenSubscriptions[tokenId]) {
        await fetchSubscriptions(tokenId, showArchived.has(tokenId));
      }
    }
    setExpandedTokens(newExpanded);
  };

  const toggleShowArchived = async (tokenId: string) => {
    const newShowArchived = new Set(showArchived);
    const willShow = !newShowArchived.has(tokenId);

    if (willShow) {
      newShowArchived.add(tokenId);
    } else {
      newShowArchived.delete(tokenId);
    }
    setShowArchived(newShowArchived);

    // Refetch with new filter
    await fetchSubscriptions(tokenId, willShow);
  };

  const updateSubscriptionLabel = async (tokenId: string, subId: string, newLabel: string) => {
    try {
      const res = await fetch(
        `${API_URL}/api/feed-tokens/${tokenId}/subscriptions/${subId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ label: newLabel || null }),
        }
      );

      if (res.ok) {
        await fetchSubscriptions(tokenId, showArchived.has(tokenId));
        setEditingLabel(null);
        showToast('Label updated');
      }
    } catch {
      console.error('Failed to update label');
    }
  };

  const deleteSubscription = async (tokenId: string, subId: string) => {
    if (!confirm('Delete this subscription? It will reappear if the feed is accessed again.')) {
      return;
    }

    try {
      const res = await fetch(
        `${API_URL}/api/feed-tokens/${tokenId}/subscriptions/${subId}`,
        { method: 'DELETE', credentials: 'include' }
      );

      if (res.ok) {
        await fetchSubscriptions(tokenId, showArchived.has(tokenId));
        showToast('Subscription deleted');
      }
    } catch {
      console.error('Failed to delete subscription');
    }
  };

  const regenerateUrl = async (tokenId: string, subId: string, format: string = 'rss') => {
    try {
      const res = await fetch(
        `${API_URL}/api/feed-tokens/${tokenId}/subscriptions/${subId}/regenerate-url`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ format }),
        }
      );

      if (res.ok) {
        const data = await res.json();
        await navigator.clipboard.writeText(data.url);
        showToast('URL copied to clipboard!');
      }
    } catch {
      console.error('Failed to regenerate URL');
    }
  };

  const cloneSubscription = async (
    tokenId: string,
    subId: string,
    params: Record<string, unknown>,
    format: string
  ) => {
    try {
      const res = await fetch(
        `${API_URL}/api/feed-tokens/${tokenId}/subscriptions/${subId}/clone`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ params, format }),
        }
      );

      if (res.ok) {
        const data = await res.json();
        await navigator.clipboard.writeText(data.url);
        await fetchSubscriptions(tokenId, showArchived.has(tokenId));
        setCloneModal(null);
        showToast('New feed URL copied! Paste in your feed reader.');
      }
    } catch {
      console.error('Failed to clone subscription');
    }
  };

  // ============================================================================
  // Helpers
  // ============================================================================

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(dateStr);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'text-green-600';
      case 'stale':
        return 'text-yellow-600';
      case 'archived':
        return 'text-gray-400';
      default:
        return 'text-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return '●';
      case 'stale':
        return '○';
      case 'archived':
        return '◌';
      default:
        return '○';
    }
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">Feed Tokens</h1>
        <p className="text-text-secondary">Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Feed Tokens</h1>
      <p className="text-text-secondary mb-6">
        Manage authentication tokens for RSS/Atom/JSON feed subscriptions.
        {authRequired ? (
          <span className="ml-2 text-amber-600 font-medium">
            Feed authentication is required.
          </span>
        ) : (
          <span className="ml-2 text-green-600">
            Feed authentication is optional (feeds are public).
          </span>
        )}
      </p>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-in">
          {toast}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* New Token Alert */}
      {newToken && (
        <div className="bg-green-50 border border-green-300 rounded-lg p-4 mb-6">
          <h3 className="font-bold text-green-800 mb-2">
            Token Created Successfully
          </h3>
          <p className="text-sm text-green-700 mb-3">
            <strong>Save this token now!</strong> It will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="bg-white px-3 py-2 rounded border flex-1 font-mono text-sm break-all">
              {newToken.token}
            </code>
            <button
              onClick={copyToken}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              {copiedToken ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => setNewToken(null)}
            className="mt-3 text-sm text-green-700 underline"
          >
            I&apos;ve saved the token, dismiss this
          </button>
        </div>
      )}

      {/* Create Token Form */}
      <div className="bg-bg-secondary border border-border-default rounded-lg p-4 mb-6">
        <h2 className="font-semibold mb-3">Create New Token</h2>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Label (optional) e.g., 'My Feedly'"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="flex-1 px-3 py-2 border border-border-default rounded bg-bg-base"
            maxLength={100}
          />
          <button
            onClick={createToken}
            disabled={creating}
            className="px-4 py-2 bg-accent-primary text-white rounded hover:bg-accent-primary-hover disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Token'}
          </button>
        </div>
      </div>

      {/* Token List */}
      <div>
        <h2 className="font-semibold mb-3">Your Tokens ({tokens.length})</h2>
        {tokens.length === 0 ? (
          <p className="text-text-secondary">No tokens yet. Create one above.</p>
        ) : (
          <div className="space-y-3">
            {tokens.map((token) => (
              <div
                key={token.id}
                className={`border border-border-default rounded-lg ${
                  token.is_active ? 'bg-bg-base' : 'bg-bg-secondary opacity-60'
                }`}
              >
                {/* Token Header */}
                <div
                  className="flex items-start justify-between p-4 cursor-pointer"
                  onClick={() => token.is_active && toggleToken(token.id)}
                >
                  <div className="flex items-start gap-2">
                    {token.is_active && (
                      <span className="text-text-secondary mt-1">
                        {expandedTokens.has(token.id) ? '▼' : '▶'}
                      </span>
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <code className="font-mono text-sm bg-bg-secondary px-2 py-1 rounded">
                          {token.prefix}...
                        </code>
                        {token.label && (
                          <span className="text-text-primary font-medium">{token.label}</span>
                        )}
                        {!token.is_active && (
                          <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">
                            Revoked
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-text-secondary mt-1">
                        Created: {formatDate(token.created_at)}
                        {token.last_used_at && (
                          <> · Last used: {formatRelativeTime(token.last_used_at)}</>
                        )}
                        {' · '}{token.use_count.toLocaleString()} requests
                      </div>
                    </div>
                  </div>
                  {token.is_active && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        revokeToken(token.id);
                      }}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      Revoke
                    </button>
                  )}
                </div>

                {/* Expanded Subscriptions */}
                {token.is_active && expandedTokens.has(token.id) && (
                  <div className="border-t border-border-default px-4 py-3 bg-bg-secondary/50">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm text-text-secondary">
                        {tokenCounts[token.id] ? (
                          <>
                            Subscriptions: {tokenCounts[token.id].active} active
                            {tokenCounts[token.id].stale > 0 && (
                              <>, {tokenCounts[token.id].stale} stale</>
                            )}
                            {showArchived.has(token.id) && tokenCounts[token.id].archived > 0 && (
                              <>, {tokenCounts[token.id].archived} archived</>
                            )}
                          </>
                        ) : (
                          'Subscriptions'
                        )}
                      </div>
                      <button
                        onClick={() => toggleShowArchived(token.id)}
                        className="text-xs text-accent-primary hover:underline"
                      >
                        {showArchived.has(token.id) ? 'Hide archived' : 'Show archived'}
                      </button>
                    </div>

                    {loadingSubscriptions.has(token.id) ? (
                      <p className="text-sm text-text-secondary">Loading subscriptions...</p>
                    ) : tokenSubscriptions[token.id]?.length === 0 ? (
                      <p className="text-sm text-text-secondary">
                        No subscriptions yet. Access a feed URL to create one.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {tokenSubscriptions[token.id]?.map((sub) => (
                          <div
                            key={sub.id}
                            className={`flex items-center justify-between p-2 rounded border ${
                              sub.status === 'archived'
                                ? 'bg-gray-50 border-gray-200 opacity-60'
                                : sub.status === 'stale'
                                ? 'bg-yellow-50/50 border-yellow-200'
                                : 'bg-white border-border-default'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`${getStatusColor(sub.status)}`} title={sub.status}>
                                {getStatusIcon(sub.status)}
                              </span>
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">
                                  {sub.label || sub.summary}
                                </div>
                                <div className="text-xs text-text-secondary">
                                  {formatRelativeTime(sub.last_accessed_at)} · {sub.access_count} hits
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 ml-2">
                              {/* Edit Label */}
                              <button
                                onClick={() => setEditingLabel({
                                  tokenId: token.id,
                                  subId: sub.id,
                                  current: sub.label || '',
                                })}
                                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                                title="Edit label"
                              >
                                ✏️
                              </button>
                              {/* Copy URL */}
                              <button
                                onClick={() => regenerateUrl(token.id, sub.id)}
                                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                                title="Copy URL (RSS)"
                              >
                                🔗
                              </button>
                              {/* Clone */}
                              <button
                                onClick={() => setCloneModal({ tokenId: token.id, sub })}
                                className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                                title="Clone & modify"
                              >
                                📋
                              </button>
                              {/* Delete */}
                              <button
                                onClick={() => deleteSubscription(token.id, sub.id)}
                                className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                                title="Delete"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Help Section */}
      <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="font-semibold text-blue-800 mb-2">How to use feed tokens</h3>
        <ol className="list-decimal list-inside text-sm text-blue-700 space-y-1">
          <li>Create a token above and save it securely</li>
          <li>Go to any search page and click &quot;Subscribe&quot;</li>
          <li>Choose your format (RSS, Atom, or JSON Feed)</li>
          <li>The generated URL includes your token and a signature</li>
          <li>Add the URL to your feed reader</li>
        </ol>
        <p className="text-sm text-blue-600 mt-3">
          <strong>Note:</strong> If you revoke a token, all feed URLs using it will stop working.
          You&apos;ll need to regenerate the feed URLs with a new token.
        </p>
      </div>

      {/* Edit Label Modal */}
      {editingLabel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h3 className="font-semibold mb-4">Edit Subscription Label</h3>
            <input
              type="text"
              value={editingLabel.current}
              onChange={(e) => setEditingLabel({ ...editingLabel, current: e.target.value })}
              placeholder="Enter a custom label..."
              className="w-full px-3 py-2 border border-gray-300 rounded mb-4"
              maxLength={100}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditingLabel(null)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => updateSubscriptionLabel(
                  editingLabel.tokenId,
                  editingLabel.subId,
                  editingLabel.current
                )}
                className="px-4 py-2 bg-accent-primary text-white rounded hover:bg-accent-primary-hover"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clone Modal */}
      {cloneModal && (
        <CloneModal
          tokenId={cloneModal.tokenId}
          subscription={cloneModal.sub}
          onClose={() => setCloneModal(null)}
          onClone={cloneSubscription}
        />
      )}
    </div>
  );
}

// ============================================================================
// Clone Modal Component
// ============================================================================

interface CloneModalProps {
  tokenId: string;
  subscription: FeedSubscription;
  onClose: () => void;
  onClone: (tokenId: string, subId: string, params: Record<string, unknown>, format: string) => void;
}

function CloneModal({ tokenId, subscription, onClose, onClone }: CloneModalProps) {
  const [params, setParams] = useState<Record<string, unknown>>({ ...subscription.params });
  const [format, setFormat] = useState('rss');
  const [saving, setSaving] = useState(false);

  const handleClone = async () => {
    setSaving(true);
    await onClone(tokenId, subscription.id, params, format);
    setSaving(false);
  };

  const updateParam = (key: string, value: string | number | boolean | null) => {
    if (value === '' || value === null) {
      const newParams = { ...params };
      delete newParams[key];
      setParams(newParams);
    } else {
      setParams({ ...params, [key]: value });
    }
  };

  // Get editable params based on feed type
  const editableParams = getEditableParams(subscription.feed_type);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto">
        <h3 className="font-semibold mb-2">Clone & Modify Feed</h3>
        <p className="text-sm text-gray-500 mb-4">
          Modify the filters below. A new feed URL will be created and copied to your clipboard.
        </p>

        <div className="space-y-4">
          {/* Format Selector */}
          <div>
            <label className="block text-sm font-medium mb-1">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded"
            >
              <option value="rss">RSS 2.0</option>
              <option value="atom">Atom</option>
              <option value="json">JSON Feed</option>
            </select>
          </div>

          {/* Dynamic Params Based on Feed Type */}
          {editableParams.map((param) => (
            <div key={param.key}>
              <label className="block text-sm font-medium mb-1">{param.label}</label>
              {param.type === 'select' ? (
                <select
                  value={(params[param.key] as string) || ''}
                  onChange={(e) => updateParam(param.key, e.target.value || null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                >
                  <option value="">-- Any --</option>
                  {param.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : param.type === 'number' ? (
                <input
                  type="number"
                  value={(params[param.key] as number) || ''}
                  onChange={(e) => updateParam(param.key, e.target.value ? parseInt(e.target.value) : null)}
                  placeholder={param.placeholder}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              ) : (
                <input
                  type="text"
                  value={(params[param.key] as string) || ''}
                  onChange={(e) => updateParam(param.key, e.target.value || null)}
                  placeholder={param.placeholder}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleClone}
            disabled={saving}
            className="px-4 py-2 bg-accent-primary text-white rounded hover:bg-accent-primary-hover disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save & Copy URL'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Param Definitions for Clone Modal
// ============================================================================

interface ParamDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  placeholder?: string;
  options?: { value: string; label: string }[];
}

function getEditableParams(feedType: string): ParamDef[] {
  const commonParams: ParamDef[] = [
    {
      key: 'importance_level',
      label: 'Importance Level',
      type: 'select',
      options: [
        { value: 'high', label: 'High' },
        { value: 'normal', label: 'Normal' },
        { value: 'low', label: 'Low' },
      ],
    },
    {
      key: 'days',
      label: 'Days',
      type: 'number',
      placeholder: 'e.g., 7',
    },
    {
      key: 'limit',
      label: 'Max Items',
      type: 'number',
      placeholder: 'e.g., 50',
    },
  ];

  if (feedType === 'search') {
    return [
      { key: 'q', label: 'Search Query', type: 'text', placeholder: 'Keywords...' },
      {
        key: 'topic',
        label: 'Topic',
        type: 'select',
        options: [
          { value: 'combat', label: 'Combat' },
          { value: 'weapons', label: 'Weapons' },
          { value: 'equipment', label: 'Equipment' },
          { value: 'infrastructure', label: 'Infrastructure' },
          { value: 'politics', label: 'Politics' },
          { value: 'humanitarian', label: 'Humanitarian' },
        ],
      },
      { key: 'channel_username', label: 'Channel Username', type: 'text', placeholder: '@channel' },
      { key: 'channel_folder', label: 'Channel Folder', type: 'text', placeholder: 'Archive-%' },
      ...commonParams,
    ];
  }

  if (feedType === 'channel') {
    return [
      { key: 'username', label: 'Channel Username', type: 'text', placeholder: '@channel' },
      ...commonParams,
    ];
  }

  if (feedType === 'topic') {
    return [
      {
        key: 'topic',
        label: 'Topic',
        type: 'select',
        options: [
          { value: 'combat', label: 'Combat' },
          { value: 'weapons', label: 'Weapons' },
          { value: 'equipment', label: 'Equipment' },
          { value: 'infrastructure', label: 'Infrastructure' },
          { value: 'politics', label: 'Politics' },
          { value: 'humanitarian', label: 'Humanitarian' },
        ],
      },
      ...commonParams,
    ];
  }

  return commonParams;
}
