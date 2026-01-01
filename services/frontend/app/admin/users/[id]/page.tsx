'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/admin/Badge';
import { adminApi } from '@/lib/admin-api';

/**
 * User Detail Page
 *
 * View and edit a specific user's profile and sessions.
 */

interface User {
  id: string;
  email: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  organization: string | null;
  role: 'admin' | 'analyst' | 'viewer';
  state: 'active' | 'inactive';
  verified: boolean;
  created_at: string;
  updated_at: string;
}

interface Session {
  id: string;
  active: boolean;
  authenticated_at: string | null;
  expires_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
}

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id as string;

  const [user, setUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit form state
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<{
    email: string;
    first_name: string;
    last_name: string;
    organization: string;
    role: 'admin' | 'analyst' | 'viewer';
    state: 'active' | 'inactive';
  }>({
    email: '',
    first_name: '',
    last_name: '',
    organization: '',
    role: 'viewer',
    state: 'active',
  });
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Recovery link
  const [recoveryLink, setRecoveryLink] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await adminApi.get(`/api/admin/users/${userId}`);
      setUser(data);
      setEditForm({
        email: data.email,
        first_name: data.first_name || '',
        last_name: data.last_name || '',
        organization: data.organization || '',
        role: data.role,
        state: data.state,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const fetchSessions = useCallback(async () => {
    try {
      const data = await adminApi.get(`/api/admin/users/${userId}/sessions`);
      setSessions(data.sessions);
    } catch {
      // Sessions are optional
    }
  }, [userId]);

  useEffect(() => {
    fetchUser();
    fetchSessions();
  }, [fetchUser, fetchSessions]);

  const handleSave = async () => {
    setSaveLoading(true);
    setSaveError(null);

    try {
      await adminApi.put(`/api/admin/users/${userId}`, editForm);
      setIsEditing(false);
      fetchUser();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this user? This cannot be undone.')) {
      return;
    }

    try {
      await adminApi.delete(`/api/admin/users/${userId}`);
      router.push('/admin/users');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (!confirm('Revoke this session? The user will be logged out.')) {
      return;
    }

    try {
      await adminApi.delete(`/api/admin/users/${userId}/sessions/${sessionId}`);
      fetchSessions();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke session');
    }
  };

  const handleRevokeAllSessions = async () => {
    if (!confirm('Revoke all sessions? The user will be logged out of all devices.')) {
      return;
    }

    try {
      await adminApi.delete(`/api/admin/users/${userId}/sessions`);
      fetchSessions();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke sessions');
    }
  };

  const handleCreateRecoveryLink = async () => {
    try {
      const data = await adminApi.post(`/api/admin/users/${userId}/recovery-link`);
      setRecoveryLink(data.recovery_link);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create recovery link');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="space-y-4">
        <div className="glass p-4 text-red-500">
          Error: {error || 'User not found'}
        </div>
        <Link href="/admin/users" className="text-blue-600 hover:underline">
          ← Back to Users
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-3">
            <Link href="/admin/users" className="text-text-secondary hover:text-text-primary">
              ← Users
            </Link>
            <span className="text-text-tertiary">/</span>
          </div>
          <h1 className="text-2xl font-bold text-text-primary mt-2">
            {user.display_name || user.email}
          </h1>
          <p className="text-text-secondary mt-1">{user.email}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleCreateRecoveryLink}
            className="px-4 py-2 border rounded-lg hover:bg-bg-secondary"
          >
            Reset Password
          </button>
          <button
            onClick={handleDelete}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Delete User
          </button>
        </div>
      </div>

      {/* User Details Card */}
      <div className="glass p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-text-primary">User Details</h2>
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="text-blue-600 hover:underline text-sm"
            >
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => setIsEditing(false)}
                className="text-text-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saveLoading}
                className="text-blue-600 hover:underline text-sm"
              >
                {saveLoading ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {saveError && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-600 text-sm">
            {saveError}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Email */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Email</label>
            {isEditing ? (
              <input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg bg-bg-base text-text-primary"
              />
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-text-primary">{user.email}</span>
                {user.verified && <Badge variant="success">Verified</Badge>}
              </div>
            )}
          </div>

          {/* First Name */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">First Name</label>
            {isEditing ? (
              <input
                type="text"
                value={editForm.first_name}
                onChange={(e) => setEditForm({ ...editForm, first_name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg bg-bg-base text-text-primary"
              />
            ) : (
              <span className="text-text-primary">{user.first_name || '—'}</span>
            )}
          </div>

          {/* Last Name */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Last Name</label>
            {isEditing ? (
              <input
                type="text"
                value={editForm.last_name}
                onChange={(e) => setEditForm({ ...editForm, last_name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg bg-bg-base text-text-primary"
              />
            ) : (
              <span className="text-text-primary">{user.last_name || '—'}</span>
            )}
          </div>

          {/* Organization */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Organization</label>
            {isEditing ? (
              <input
                type="text"
                value={editForm.organization}
                onChange={(e) => setEditForm({ ...editForm, organization: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg bg-bg-base text-text-primary"
              />
            ) : (
              <span className="text-text-primary">{user.organization || '—'}</span>
            )}
          </div>

          {/* Role */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Role</label>
            {isEditing ? (
              <select
                value={editForm.role}
                onChange={(e) => setEditForm({ ...editForm, role: e.target.value as 'admin' | 'analyst' | 'viewer' })}
                className="w-full px-3 py-2 border rounded-lg bg-bg-base text-text-primary"
              >
                <option value="viewer">Viewer</option>
                <option value="analyst">Analyst</option>
                <option value="admin">Admin</option>
              </select>
            ) : (
              <Badge
                variant={
                  user.role === 'admin' ? 'success' : user.role === 'analyst' ? 'warning' : 'default'
                }
              >
                {user.role}
              </Badge>
            )}
          </div>

          {/* State */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Status</label>
            {isEditing ? (
              <select
                value={editForm.state}
                onChange={(e) => setEditForm({ ...editForm, state: e.target.value as 'active' | 'inactive' })}
                className="w-full px-3 py-2 border rounded-lg bg-bg-base text-text-primary"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            ) : (
              <Badge variant={user.state === 'active' ? 'success' : 'danger'}>{user.state}</Badge>
            )}
          </div>

          {/* Created */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Created</label>
            <span className="text-text-primary">
              {new Date(user.created_at).toLocaleString()}
            </span>
          </div>

          {/* Updated */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Last Updated</label>
            <span className="text-text-primary">
              {new Date(user.updated_at).toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Sessions Card */}
      <div className="glass p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-text-primary">
            Active Sessions ({sessions.length})
          </h2>
          {sessions.length > 0 && (
            <button
              onClick={handleRevokeAllSessions}
              className="text-red-600 hover:underline text-sm"
            >
              Revoke All
            </button>
          )}
        </div>

        {sessions.length === 0 ? (
          <p className="text-text-secondary">No active sessions</p>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between p-3 bg-bg-base rounded-lg"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${session.active ? 'bg-green-500' : 'bg-gray-400'}`} />
                    <span className="text-text-primary font-medium">
                      {session.ip_address || 'Unknown IP'}
                    </span>
                  </div>
                  <div className="text-sm text-text-secondary mt-1">
                    {session.user_agent ? (
                      <span className="truncate block max-w-md" title={session.user_agent}>
                        {session.user_agent.slice(0, 60)}...
                      </span>
                    ) : (
                      'Unknown device'
                    )}
                  </div>
                  <div className="text-xs text-text-tertiary mt-1">
                    Authenticated: {session.authenticated_at ? new Date(session.authenticated_at).toLocaleString() : '—'}
                    {session.expires_at && (
                      <span className="ml-3">
                        Expires: {new Date(session.expires_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleRevokeSession(session.id)}
                  className="text-red-600 hover:underline text-sm"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recovery Link Modal */}
      {recoveryLink && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bg-elevated rounded-lg p-6 w-full max-w-lg shadow-xl">
            <h2 className="text-xl font-bold text-text-primary mb-4">Recovery Link Created</h2>

            <p className="text-text-secondary mb-4">
              Send this link to the user to allow them to reset their password. The link expires in 1 hour.
            </p>

            <div className="bg-bg-base p-3 rounded border break-all font-mono text-sm">
              {recoveryLink}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(recoveryLink);
                  alert('Link copied to clipboard');
                }}
                className="px-4 py-2 border rounded-lg hover:bg-bg-secondary"
              >
                Copy Link
              </button>
              <button
                onClick={() => setRecoveryLink(null)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
