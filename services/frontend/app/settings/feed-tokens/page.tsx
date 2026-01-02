'use client';

import { useState, useEffect, useCallback } from 'react';
import { API_URL } from '@/lib/api';
import { getAuthHeaders } from '@/lib/auth-utils';

interface FeedToken {
  id: string;
  prefix: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  use_count: number;
  is_active: boolean;
}

interface NewToken {
  id: string;
  token: string;
  prefix: string;
  label: string | null;
}

export default function FeedTokensPage() {
  const [tokens, setTokens] = useState<FeedToken[]>([]);
  const [newToken, setNewToken] = useState<NewToken | null>(null);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/feed-tokens`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setTokens(data.tokens);
      } else if (res.status === 401) {
        setError('Please log in to manage feed tokens.');
      }
    } catch (err) {
      setError('Failed to load tokens.');
    } finally {
      setLoading(false);
    }
  }, [API_URL]);

  const fetchAuthStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/feed-tokens/auth-status`);
      if (res.ok) {
        const data = await res.json();
        setAuthRequired(data.auth_required);
      }
    } catch (err) {
      // Ignore
    }
  }, [API_URL]);

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
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
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
    } catch (err) {
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
        headers: getAuthHeaders(),
      });

      if (res.ok) {
        fetchTokens();
      } else {
        const errData = await res.json();
        setError(errData.detail || 'Failed to revoke token.');
      }
    } catch (err) {
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

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Feed Tokens</h1>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Feed Tokens</h1>
      <p className="text-gray-600 mb-6">
        Manage authentication tokens for RSS/Atom/JSON feed subscriptions.
        {authRequired ? (
          <span className="ml-2 text-amber-600 font-medium">
            🔒 Feed authentication is required.
          </span>
        ) : (
          <span className="ml-2 text-green-600">
            🔓 Feed authentication is optional (feeds are public).
          </span>
        )}
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* New Token Alert */}
      {newToken && (
        <div className="bg-green-50 border border-green-300 rounded-lg p-4 mb-6">
          <h3 className="font-bold text-green-800 mb-2">
            ✅ Token Created Successfully
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
              {copiedToken ? '✓ Copied!' : 'Copy'}
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
      <div className="bg-gray-50 border rounded-lg p-4 mb-6">
        <h2 className="font-semibold mb-3">Create New Token</h2>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Label (optional) e.g., 'My Feedly'"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="flex-1 px-3 py-2 border rounded"
            maxLength={100}
          />
          <button
            onClick={createToken}
            disabled={creating}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Token'}
          </button>
        </div>
      </div>

      {/* Token List */}
      <div>
        <h2 className="font-semibold mb-3">Your Tokens ({tokens.length})</h2>
        {tokens.length === 0 ? (
          <p className="text-gray-500">No tokens yet. Create one above.</p>
        ) : (
          <div className="space-y-3">
            {tokens.map((token) => (
              <div
                key={token.id}
                className={`border rounded-lg p-4 ${
                  token.is_active ? 'bg-white' : 'bg-gray-100 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                        {token.prefix}...
                      </code>
                      {token.label && (
                        <span className="text-gray-700">{token.label}</span>
                      )}
                      {!token.is_active && (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">
                          Revoked
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      Created: {formatDate(token.created_at)}
                      {token.last_used_at && (
                        <> · Last used: {formatDate(token.last_used_at)}</>
                      )}
                      {' · '}{token.use_count.toLocaleString()} requests
                    </div>
                  </div>
                  {token.is_active && (
                    <button
                      onClick={() => revokeToken(token.id)}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      Revoke
                    </button>
                  )}
                </div>
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
    </div>
  );
}
