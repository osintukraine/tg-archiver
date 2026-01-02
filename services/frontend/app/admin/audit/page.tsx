'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { adminApi } from '@/lib/admin-api'

/**
 * Admin Audit Log
 *
 * View admin moderation actions on messages.
 * Tracks hide/unhide, spam marking, topic changes, etc.
 */

interface AdminAction {
  id: number
  action: string
  resource_type: string
  resource_id: number
  details: Record<string, unknown>
  admin_id: string | null
  admin_email: string | null
  ip_address: string | null
  created_at: string
}

interface AdminActionsStats {
  total_actions: number
  actions_last_hour: number
  actions_last_24h: number
  by_action_type: Record<string, number>
  by_admin: Record<string, number>
}

// Action type to human-readable label
const ACTION_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  'message.hidden': { label: 'Hidden', color: 'bg-gray-500/20 text-gray-400', icon: '👁️‍🗨️' },
  'message.unhidden': { label: 'Unhidden', color: 'bg-blue-500/20 text-blue-400', icon: '👁️' },
  'message.deleted': { label: 'Deleted', color: 'bg-red-500/20 text-red-400', icon: '🗑️' },
  'message.marked_spam': { label: 'Marked Spam', color: 'bg-orange-500/20 text-orange-400', icon: '🚫' },
  'message.unmarked_spam': { label: 'Unmarked Spam', color: 'bg-green-500/20 text-green-400', icon: '✅' },
  'message.quarantined': { label: 'Quarantined', color: 'bg-yellow-500/20 text-yellow-400', icon: '⚠️' },
  'message.note_added': { label: 'Note Added', color: 'bg-blue-500/20 text-blue-400', icon: '📝' },
  'message.topic_changed': { label: 'Topic Changed', color: 'bg-purple-500/20 text-purple-400', icon: '🏷️' },
  'message.importance_changed': { label: 'Importance Changed', color: 'bg-indigo-500/20 text-indigo-400', icon: '⭐' },
  'message.reprocessed': { label: 'Reprocessed', color: 'bg-cyan-500/20 text-cyan-400', icon: '🔄' },
}

export default function AuditPage() {
  const [stats, setStats] = useState<AdminActionsStats | null>(null)
  const [actions, setActions] = useState<AdminAction[]>([])
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [expandedActionId, setExpandedActionId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchActions()
  }, [actionFilter])

  const fetchActions = async () => {
    setLoading(true)
    try {
      // Fetch stats
      const statsData = await adminApi.get('/api/admin/messages/audit/actions/stats')
      setStats(statsData)

      // Fetch actions with filter
      let url = '/api/admin/messages/audit/actions?page_size=50'
      if (actionFilter !== 'all') {
        url += `&action_type=${encodeURIComponent(actionFilter)}`
      }

      const actionsData = await adminApi.get(url)
      setActions(actionsData.actions || [])
      setError(null)
    } catch (err) {
      setError('Failed to fetch audit data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const getActionInfo = (action: string) => {
    return ACTION_LABELS[action] || { label: action, color: 'bg-gray-500/20 text-gray-400', icon: '❓' }
  }

  const formatDetails = (details: Record<string, unknown>) => {
    if (!details || Object.keys(details).length === 0) return null
    return Object.entries(details)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => ({
        key: key.replace(/_/g, ' '),
        value: typeof value === 'object' ? JSON.stringify(value) : String(value)
      }))
  }

  if (loading && !stats) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-text-primary">Audit Log</h1>
        <div className="text-center py-12 text-text-secondary">Loading...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary">Audit Log</h1>
        <p className="text-text-secondary mt-1">
          View admin moderation actions on messages
        </p>
      </div>

      {error && (
        <div className="bg-red-500/20 border border-red-500/30 text-red-400 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="glass p-6">
            <h3 className="text-text-tertiary text-sm">Total Actions</h3>
            <p className="text-3xl font-bold text-text-primary">{stats.total_actions}</p>
            <p className="text-sm text-text-tertiary">{stats.actions_last_24h} last 24h</p>
          </div>
          <div className="glass p-6">
            <h3 className="text-text-tertiary text-sm">Last Hour</h3>
            <p className="text-3xl font-bold text-purple-500">{stats.actions_last_hour}</p>
            <p className="text-sm text-text-tertiary">actions taken</p>
          </div>
          <div className="glass p-6">
            <h3 className="text-text-tertiary text-sm">Top Action</h3>
            <p className="text-xl font-bold text-text-primary">
              {Object.entries(stats.by_action_type || {})[0]?.[0]?.replace('message.', '') || 'None'}
            </p>
            <p className="text-sm text-text-tertiary">
              {Object.entries(stats.by_action_type || {})[0]?.[1] || 0} times
            </p>
          </div>
          <div className="glass p-6">
            <h3 className="text-text-tertiary text-sm">Active Admins</h3>
            <p className="text-3xl font-bold text-text-primary">
              {Object.keys(stats.by_admin || {}).length}
            </p>
            <p className="text-sm text-text-tertiary">with actions</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="glass p-4 flex flex-wrap gap-4 items-center">
        <span className="text-text-tertiary text-sm">Filter:</span>
        <button
          onClick={() => setActionFilter('all')}
          className={`px-4 py-2 rounded transition-colors ${actionFilter === 'all' ? 'bg-purple-600 text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'}`}
        >
          All
        </button>
        {Object.entries(stats?.by_action_type || {}).slice(0, 5).map(([action, count]) => (
          <button
            key={action}
            onClick={() => setActionFilter(action)}
            className={`px-4 py-2 rounded transition-colors ${actionFilter === action ? 'bg-purple-600 text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'}`}
          >
            {getActionInfo(action).icon} {getActionInfo(action).label} ({count})
          </button>
        ))}
        <button
          onClick={fetchActions}
          className="ml-auto px-4 py-2 bg-bg-tertiary text-text-secondary rounded hover:bg-bg-secondary transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Actions List */}
      <div className="space-y-4">
        {actions.length === 0 ? (
          <div className="glass p-12 text-center text-text-secondary">
            No admin actions recorded yet. Take actions from message detail pages to see them here.
          </div>
        ) : (
          actions.map((a) => {
            const actionInfo = getActionInfo(a.action)
            const details = formatDetails(a.details)

            return (
              <div key={a.id} className="glass overflow-hidden">
                {/* Header - Always visible */}
                <div
                  className="p-4 cursor-pointer hover:bg-bg-secondary/50 transition-colors"
                  onClick={() => setExpandedActionId(expandedActionId === a.id ? null : a.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className={`px-3 py-1 rounded text-sm font-medium ${actionInfo.color}`}>
                          {actionInfo.icon} {actionInfo.label}
                        </span>
                        <Link
                          href={`/messages/${a.resource_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-400 hover:underline"
                        >
                          Message #{a.resource_id}
                        </Link>
                        <span className="text-text-tertiary text-sm">
                          {new Date(a.created_at).toLocaleString()}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-sm text-text-secondary ml-1">
                        <span>by</span>
                        <span className="font-medium text-text-primary">
                          {a.admin_email || a.admin_id?.slice(0, 8) || 'Unknown'}
                        </span>
                        {a.ip_address && (
                          <>
                            <span>from</span>
                            <span className="font-mono text-xs bg-bg-tertiary px-1.5 py-0.5 rounded">
                              {a.ip_address}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <span className="text-text-tertiary">
                      {expandedActionId === a.id ? '▲' : '▼'}
                    </span>
                  </div>
                </div>

                {/* Expanded details */}
                {expandedActionId === a.id && details && details.length > 0 && (
                  <div className="border-t border-border-subtle p-4 bg-bg-secondary/30">
                    <h4 className="text-sm font-medium text-text-tertiary mb-3">Action Details</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {details.map(({ key, value }) => (
                        <div key={key} className="bg-bg-elevated p-2 rounded border border-border-subtle">
                          <span className="text-text-tertiary block text-xs capitalize">{key}</span>
                          <span className="font-medium text-text-primary text-sm break-all">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
