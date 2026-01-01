'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { StatCard } from '@/components/admin/StatCard';
import { Badge } from '@/components/admin/Badge';
import { DataTable } from '@/components/admin/DataTable';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin Users Page
 *
 * User management powered by Ory Kratos.
 * Supports listing, filtering, creating, and managing users.
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

interface UserStats {
  total_users: number;
  active_users: number;
  admins: number;
  analysts: number;
  viewers: number;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');

  // Selection for bulk actions
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(new Set());

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRecoveryLink, setShowRecoveryLink] = useState<string | null>(null);

  // Form state for new user
  const [newUser, setNewUser] = useState<{
    email: string;
    first_name: string;
    last_name: string;
    organization: string;
    role: 'admin' | 'analyst' | 'viewer';
  }>({
    email: '',
    first_name: '',
    last_name: '',
    organization: '',
    role: 'viewer',
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('page', page.toString());
      params.set('per_page', '50');
      if (search) params.set('search', search);
      if (roleFilter) params.set('role', roleFilter);
      if (stateFilter) params.set('state', stateFilter);

      const data = await adminApi.get(`/api/admin/users?${params}`);
      setUsers(data.users);
      setTotalPages(Math.ceil(data.total / 50));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, stateFilter]);

  const fetchStats = useCallback(async () => {
    try {
      // Calculate stats from users list
      const data = await adminApi.get('/api/admin/users?per_page=1000');
      const allUsers = data.users as User[];

      setStats({
        total_users: allUsers.length,
        active_users: allUsers.filter((u) => u.state === 'active').length,
        admins: allUsers.filter((u) => u.role === 'admin').length,
        analysts: allUsers.filter((u) => u.role === 'analyst').length,
        viewers: allUsers.filter((u) => u.role === 'viewer').length,
      });
    } catch {
      // Stats are optional, don't show error
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleCreateUser = async () => {
    if (!newUser.email) {
      setCreateError('Email is required');
      return;
    }

    setCreateLoading(true);
    setCreateError(null);

    try {
      await adminApi.post('/api/admin/users', newUser);
      setShowCreateModal(false);
      setNewUser({
        email: '',
        first_name: '',
        last_name: '',
        organization: '',
        role: 'viewer',
      });
      fetchUsers();
      fetchStats();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }

    try {
      await adminApi.delete(`/api/admin/users/${userId}`);
      fetchUsers();
      fetchStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete user');
    }
  };

  const handleCreateRecoveryLink = async (userId: string) => {
    try {
      const data = await adminApi.post(`/api/admin/users/${userId}/recovery-link`);
      setShowRecoveryLink(data.recovery_link);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create recovery link');
    }
  };

  const handleRoleChange = async (userId: string, role: string) => {
    try {
      await adminApi.put(`/api/admin/users/${userId}`, { role });
      fetchUsers();
      fetchStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update role');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedKeys.size === 0) return;
    if (!confirm(`Delete ${selectedKeys.size} users? This cannot be undone.`)) return;

    try {
      for (const userId of Array.from(selectedKeys)) {
        await adminApi.delete(`/api/admin/users/${userId}`);
      }
      setSelectedKeys(new Set());
      fetchUsers();
      fetchStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete some users');
      fetchUsers();
    }
  };

  const columns = [
    {
      key: 'email',
      label: 'Email',
      sortable: true,
      render: (value: string, row: User) => (
        <div>
          <Link href={`/admin/users/${row.id}`} className="text-blue-600 hover:underline font-medium">
            {value}
          </Link>
          {row.verified && (
            <span className="ml-2 text-green-500" title="Verified">
              ✓
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'display_name',
      label: 'Name',
      render: (value: string) => value || '—',
    },
    {
      key: 'role',
      label: 'Role',
      render: (value: string) => {
        const variants: Record<string, 'success' | 'warning' | 'default'> = {
          admin: 'success',
          analyst: 'warning',
          viewer: 'default',
        };
        return <Badge variant={variants[value] || 'default'}>{value}</Badge>;
      },
    },
    {
      key: 'state',
      label: 'Status',
      render: (value: string) => (
        <Badge variant={value === 'active' ? 'success' : 'danger'}>{value}</Badge>
      ),
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (value: string) => new Date(value).toLocaleDateString(),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (_: unknown, row: User) => (
        <div className="flex gap-2">
          <select
            value={row.role}
            onChange={(e) => handleRoleChange(row.id, e.target.value)}
            className="text-xs border rounded px-2 py-1 bg-bg-base"
          >
            <option value="viewer">Viewer</option>
            <option value="analyst">Analyst</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={() => handleCreateRecoveryLink(row.id)}
            className="text-xs text-blue-600 hover:underline"
            title="Create password reset link"
          >
            Reset
          </button>
          <button
            onClick={() => handleDeleteUser(row.id)}
            className="text-xs text-red-600 hover:underline"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Users</h1>
          <p className="text-text-secondary mt-1">
            Manage platform users and their roles
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Create User
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard
          title="Total Users"
          value={stats?.total_users ?? '—'}
          loading={!stats}
          icon={
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          }
        />
        <StatCard
          title="Active"
          value={stats?.active_users ?? '—'}
          loading={!stats}
          icon={<span className="text-2xl text-green-500">●</span>}
        />
        <StatCard
          title="Admins"
          value={stats?.admins ?? '—'}
          loading={!stats}
          icon={<span className="text-xl">👑</span>}
        />
        <StatCard
          title="Analysts"
          value={stats?.analysts ?? '—'}
          loading={!stats}
          icon={<span className="text-xl">📊</span>}
        />
        <StatCard
          title="Viewers"
          value={stats?.viewers ?? '—'}
          loading={!stats}
          icon={<span className="text-xl">👁</span>}
        />
      </div>

      {/* Filters */}
      <div className="glass p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <input
            type="text"
            placeholder="Search by email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border rounded-lg bg-bg-base text-text-primary"
          />
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border rounded-lg bg-bg-base text-text-primary"
          >
            <option value="">All Roles</option>
            <option value="admin">Admin</option>
            <option value="analyst">Analyst</option>
            <option value="viewer">Viewer</option>
          </select>
          <select
            value={stateFilter}
            onChange={(e) => {
              setStateFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 border rounded-lg bg-bg-base text-text-primary"
          >
            <option value="">All States</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <button
            onClick={() => {
              setSearch('');
              setRoleFilter('');
              setStateFilter('');
              setPage(1);
            }}
            className="px-3 py-2 text-text-secondary hover:text-text-primary transition-colors"
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="glass p-4 text-red-500 border-red-500/30">
          Error: {error}
        </div>
      )}

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={users}
        keyExtractor={(user) => user.id}
        loading={loading}
        selectable
        selectedKeys={selectedKeys}
        onSelectionChange={setSelectedKeys}
        bulkActions={
          <button
            onClick={handleBulkDelete}
            className="px-3 py-1 bg-red-600 text-white rounded text-sm"
          >
            Delete Selected ({selectedKeys.size})
          </button>
        }
        emptyMessage="No users found"
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 border rounded-lg disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-text-secondary">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 border rounded-lg disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bg-elevated rounded-lg p-6 w-full max-w-md shadow-xl">
            <h2 className="text-xl font-bold text-text-primary mb-4">Create User</h2>

            {createError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded text-red-600 text-sm">
                {createError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg bg-bg-base text-text-primary"
                  placeholder="user@example.com"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={newUser.first_name}
                    onChange={(e) => setNewUser({ ...newUser, first_name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg bg-bg-base text-text-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={newUser.last_name}
                    onChange={(e) => setNewUser({ ...newUser, last_name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg bg-bg-base text-text-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Organization
                </label>
                <input
                  type="text"
                  value={newUser.organization}
                  onChange={(e) => setNewUser({ ...newUser, organization: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg bg-bg-base text-text-primary"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Role
                </label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value as 'admin' | 'analyst' | 'viewer' })}
                  className="w-full px-3 py-2 border rounded-lg bg-bg-base text-text-primary"
                >
                  <option value="viewer">Viewer</option>
                  <option value="analyst">Analyst</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-text-secondary hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateUser}
                disabled={createLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {createLoading ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recovery Link Modal */}
      {showRecoveryLink && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bg-elevated rounded-lg p-6 w-full max-w-lg shadow-xl">
            <h2 className="text-xl font-bold text-text-primary mb-4">Recovery Link Created</h2>

            <p className="text-text-secondary mb-4">
              Send this link to the user to allow them to reset their password:
            </p>

            <div className="bg-bg-base p-3 rounded border break-all font-mono text-sm">
              {showRecoveryLink}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(showRecoveryLink);
                  alert('Link copied to clipboard');
                }}
                className="px-4 py-2 border rounded-lg hover:bg-bg-secondary"
              >
                Copy Link
              </button>
              <button
                onClick={() => setShowRecoveryLink(null)}
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
