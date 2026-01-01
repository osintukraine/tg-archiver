'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { adminApi } from '@/lib/admin-api'

// =============================================================================
// AI DECISIONS TAB TYPES
// =============================================================================

interface Decision {
  id: number
  message_id: number
  telegram_message_id: number
  channel_id: number
  channel_name: string
  message_preview: string
  decision_type: string
  decision_value: {
    is_spam: boolean
    topic: string
    importance: string
    should_archive: boolean
    confidence: number
    is_ukraine_relevant: boolean
  }
  decision_source: string
  llm_analysis: string
  llm_reasoning: string
  processing_time_ms: number
  model_used: string
  prompt_version: string
  verification_status: string
  created_at: string
}

interface AuditStats {
  total_decisions: number
  decisions_last_hour: number
  decisions_last_24h: number
  verification: {
    unverified: number
    verified_correct: number
    verified_incorrect: number
    flagged: number
    pending_reprocess: number
  }
  outcomes: {
    spam: number
    archived: number
    off_topic: number
  }
  performance: {
    avg_ms: number
    p95_ms: number
  }
  sources: {
    llm: number
    fallback: number
  }
}

// =============================================================================
// ADMIN ACTIONS TAB TYPES
// =============================================================================

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
  'message.geolocation_added': { label: 'Location Added', color: 'bg-green-500/20 text-green-400', icon: '📍' },
  'message.geolocation_changed': { label: 'Location Changed', color: 'bg-teal-500/20 text-teal-400', icon: '📍' },
  'message.geolocation_removed': { label: 'Location Removed', color: 'bg-red-500/20 text-red-400', icon: '📍' },
  'message.event_linked': { label: 'Event Linked', color: 'bg-blue-500/20 text-blue-400', icon: '🔗' },
  'message.event_unlinked': { label: 'Event Unlinked', color: 'bg-gray-500/20 text-gray-400', icon: '🔓' },
}

type TabType = 'decisions' | 'actions'

export default function AuditPage() {
  const [activeTab, setActiveTab] = useState<TabType>('decisions')

  // AI Decisions state
  const [stats, setStats] = useState<AuditStats | null>(null)
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [decisionFilter, setDecisionFilter] = useState<string>('all')
  const [expandedDecisionId, setExpandedDecisionId] = useState<number | null>(null)

  // Admin Actions state
  const [adminStats, setAdminStats] = useState<AdminActionsStats | null>(null)
  const [adminActions, setAdminActions] = useState<AdminAction[]>([])
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [expandedActionId, setExpandedActionId] = useState<number | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    if (activeTab === 'decisions') {
      fetchDecisions()
    } else {
      fetchAdminActions()
    }
  }, [activeTab, decisionFilter, actionFilter])

  const fetchDecisions = async () => {
    setLoading(true)
    try {
      // Fetch stats
      const statsData = await adminApi.get('/api/system/audit/stats')
      setStats(statsData)

      // Fetch decisions with filter
      let url = '/api/system/audit?limit=50'
      if (decisionFilter === 'flagged') url += '&verification_status=flagged'
      else if (decisionFilter === 'unverified') url += '&verification_status=unverified'
      else if (decisionFilter === 'spam') url += '&decision_type=classification'

      const decisionsData = await adminApi.get(url)
      setDecisions(decisionsData.decisions || [])
      setError(null)
    } catch (err) {
      setError('Failed to fetch audit data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const fetchAdminActions = async () => {
    setLoading(true)
    try {
      // Fetch stats
      const statsData = await adminApi.get('/api/admin/messages/audit/actions/stats')
      setAdminStats(statsData)

      // Fetch actions with filter
      let url = '/api/admin/messages/audit/actions?page_size=50'
      if (actionFilter !== 'all') {
        url += `&action_type=${encodeURIComponent(actionFilter)}`
      }

      const actionsData = await adminApi.get(url)
      setAdminActions(actionsData.actions || [])
      setError(null)
    } catch (err) {
      setError('Failed to fetch admin actions')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async (id: number, status: string) => {
    try {
      await adminApi.post(`/api/system/audit/${id}/verify?status=${status}`)
      fetchDecisions()
    } catch (err) {
      console.error('Failed to verify decision:', err)
    }
  }

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  // Helper to get outcome description
  const getOutcomeDescription = (d: Decision) => {
    if (d.decision_value.is_spam) return 'Filtered as spam'
    if (!d.decision_value.is_ukraine_relevant) return 'Quarantined (off-topic)'
    if (d.decision_value.should_archive) return 'Archived to database'
    return 'Skipped'
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

  if (loading && !stats && !adminStats) {
    return (
      <div className="min-h-screen bg-bg-base p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-text-primary mb-8">Audit Log</h1>
          <div className="text-center py-12 text-text-secondary">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-base p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header with Help */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-text-primary">Audit Log</h1>
            <p className="text-text-secondary mt-1">
              {activeTab === 'decisions'
                ? 'Review how the AI classified each message and provide feedback'
                : 'View admin moderation actions on messages'}
            </p>
          </div>
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors"
          >
            {showHelp ? 'Hide Help' : '? How to Use'}
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('decisions')}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              activeTab === 'decisions'
                ? 'bg-blue-600 text-white'
                : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            🤖 AI Decisions
            {stats && (
              <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-white/20">
                {stats.verification.unverified}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('actions')}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              activeTab === 'actions'
                ? 'bg-purple-600 text-white'
                : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            👤 Admin Actions
            {adminStats && (
              <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-white/20">
                {adminStats.total_actions}
              </span>
            )}
          </button>
        </div>

        {/* Help Panel */}
        {showHelp && activeTab === 'decisions' && (
          <div className="glass p-6 mb-6 border-blue-500/30">
            <h3 className="font-bold text-text-primary mb-4">Understanding the Audit System</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold text-blue-400 mb-2">What is this page?</h4>
                <p className="text-sm text-text-secondary">
                  Every message processed by the platform goes through AI classification.
                  This page shows you <strong className="text-text-primary">what the AI decided</strong> for each message and <strong className="text-text-primary">why</strong>.
                  You can review these decisions to catch mistakes and improve the system.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-blue-400 mb-2">The AI Decision</h4>
                <p className="text-sm text-text-secondary">
                  For each message, the AI determines:
                </p>
                <ul className="text-sm text-text-secondary list-disc list-inside mt-1">
                  <li><strong className="text-text-primary">Topic</strong>: combat, equipment, diplomatic, etc.</li>
                  <li><strong className="text-text-primary">Importance</strong>: critical, high, medium, low</li>
                  <li><strong className="text-text-primary">Is it spam?</strong></li>
                  <li><strong className="text-text-primary">Is it Ukraine-relevant?</strong></li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-blue-400 mb-2">Verification Status</h4>
                <ul className="text-sm text-text-secondary space-y-1">
                  <li><span className="bg-bg-tertiary px-2 py-0.5 rounded text-xs text-text-primary">unverified</span> - No human has reviewed this yet</li>
                  <li><span className="bg-green-500/20 text-green-400 px-2 py-0.5 rounded text-xs">verified_correct</span> - Human confirmed AI was right</li>
                  <li><span className="bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded text-xs">verified_incorrect</span> - Human found AI made a mistake</li>
                  <li><span className="bg-red-500/20 text-red-400 px-2 py-0.5 rounded text-xs">flagged</span> - Needs re-processing with updated rules</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold text-blue-400 mb-2">Your Actions</h4>
                <ul className="text-sm text-text-secondary space-y-1">
                  <li><span className="bg-green-600 text-white px-2 py-0.5 rounded text-xs">Correct</span> - The AI classified this correctly</li>
                  <li><span className="bg-orange-600 text-white px-2 py-0.5 rounded text-xs">Incorrect</span> - The AI made a mistake (logged for analysis)</li>
                  <li><span className="bg-red-600 text-white px-2 py-0.5 rounded text-xs">Flag</span> - Queue for re-processing (AI will re-classify with current rules)</li>
                </ul>
              </div>
            </div>

            <div className="mt-4 p-3 bg-blue-500/10 rounded border border-blue-500/20">
              <p className="text-sm text-text-secondary">
                <strong className="text-blue-400">Tip:</strong> Focus on reviewing <strong className="text-text-primary">flagged</strong> decisions first -
                these were automatically detected as potentially wrong by our verification rules.
              </p>
            </div>
          </div>
        )}

        {showHelp && activeTab === 'actions' && (
          <div className="glass p-6 mb-6 border-purple-500/30">
            <h3 className="font-bold text-text-primary mb-4">Understanding Admin Actions</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold text-purple-400 mb-2">What is this tab?</h4>
                <p className="text-sm text-text-secondary">
                  This tab shows all moderation actions taken by admins on messages.
                  Every action is logged with who performed it, when, and why.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-purple-400 mb-2">Action Types</h4>
                <div className="text-sm text-text-secondary space-y-1">
                  <div>🗑️ <strong>Delete/Hide</strong> - Content moderation</div>
                  <div>🚫 <strong>Spam</strong> - False positive corrections</div>
                  <div>🏷️ <strong>Topic/Importance</strong> - Classification fixes</div>
                  <div>📍 <strong>Geolocation</strong> - Location corrections</div>
                  <div>🔗 <strong>Event Link</strong> - Event associations</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-500/20 border border-red-500/30 text-red-400 px-4 py-3 rounded mb-6">
            {error}
          </div>
        )}

        {/* AI DECISIONS TAB */}
        {activeTab === 'decisions' && (
          <>
            {/* Stats Cards */}
            {stats && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div className="glass p-6">
                  <h3 className="text-text-tertiary text-sm">Total Decisions</h3>
                  <p className="text-3xl font-bold text-text-primary">{stats.total_decisions}</p>
                  <p className="text-sm text-text-tertiary">{stats.decisions_last_hour} last hour</p>
                </div>
                <div className="glass p-6">
                  <h3 className="text-text-tertiary text-sm">Awaiting Review</h3>
                  <p className="text-3xl font-bold text-yellow-500">{stats.verification.unverified}</p>
                  <p className="text-sm text-text-tertiary">unverified decisions</p>
                </div>
                <div className="glass p-6">
                  <h3 className="text-text-tertiary text-sm">Needs Attention</h3>
                  <p className="text-3xl font-bold text-red-500">{stats.verification.flagged}</p>
                  <p className="text-sm text-text-tertiary">{stats.verification.pending_reprocess} queued for reprocess</p>
                </div>
                <div className="glass p-6">
                  <h3 className="text-text-tertiary text-sm">Avg Processing</h3>
                  <p className="text-3xl font-bold text-text-primary">{formatTime(stats.performance.avg_ms)}</p>
                  <p className="text-sm text-text-tertiary">p95: {formatTime(stats.performance.p95_ms)}</p>
                </div>
              </div>
            )}

            {/* Filters */}
            <div className="glass p-4 mb-6 flex flex-wrap gap-4 items-center">
              <span className="text-text-tertiary text-sm">Filter:</span>
              <button
                onClick={() => setDecisionFilter('all')}
                className={`px-4 py-2 rounded transition-colors ${decisionFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'}`}
              >
                All
              </button>
              <button
                onClick={() => setDecisionFilter('unverified')}
                className={`px-4 py-2 rounded transition-colors ${decisionFilter === 'unverified' ? 'bg-yellow-600 text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'}`}
              >
                Unverified ({stats?.verification.unverified || 0})
              </button>
              <button
                onClick={() => setDecisionFilter('flagged')}
                className={`px-4 py-2 rounded transition-colors ${decisionFilter === 'flagged' ? 'bg-red-600 text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'}`}
              >
                Flagged ({stats?.verification.flagged || 0})
              </button>
              <button
                onClick={fetchDecisions}
                className="ml-auto px-4 py-2 bg-bg-tertiary text-text-secondary rounded hover:bg-bg-secondary transition-colors"
              >
                Refresh
              </button>
            </div>

            {/* Decisions List */}
            <div className="space-y-4">
              {decisions.length === 0 ? (
                <div className="glass p-12 text-center text-text-secondary">
                  No decisions found. Process some messages to see the audit trail.
                </div>
              ) : (
                decisions.map((d) => (
                  <div key={d.id} className="glass overflow-hidden">
                    {/* Header - Always visible */}
                    <div
                      className="p-4 cursor-pointer hover:bg-bg-secondary/50 transition-colors"
                      onClick={() => setExpandedDecisionId(expandedDecisionId === d.id ? null : d.id)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          {/* Channel & outcome */}
                          <div className="flex items-center gap-3 mb-2">
                            <span className={`w-3 h-3 rounded-full flex-shrink-0 ${
                              d.decision_value.is_spam ? 'bg-red-500' :
                              !d.decision_value.is_ukraine_relevant ? 'bg-yellow-500' :
                              d.decision_value.should_archive ? 'bg-green-500' :
                              'bg-gray-400'
                            }`} />
                            <span className="font-medium text-text-primary">{d.channel_name || `Channel ${d.channel_id}`}</span>
                            <span className="text-text-tertiary text-sm">
                              {new Date(d.created_at).toLocaleString()}
                            </span>
                          </div>

                          {/* Message preview */}
                          <p className="text-sm text-text-secondary line-clamp-2 ml-6">
                            {d.message_preview || 'No content preview'}
                          </p>

                          {/* Decision badges */}
                          <div className="flex flex-wrap gap-2 mt-2 ml-6">
                            {/* Outcome badge */}
                            <span className={`text-xs px-2 py-1 rounded font-medium ${
                              d.decision_value.is_spam ? 'bg-red-500/20 text-red-400' :
                              !d.decision_value.is_ukraine_relevant ? 'bg-yellow-500/20 text-yellow-400' :
                              d.decision_value.should_archive ? 'bg-green-500/20 text-green-400' :
                              'bg-bg-tertiary text-text-secondary'
                            }`}>
                              {getOutcomeDescription(d)}
                            </span>

                            {/* Topic */}
                            <span className="bg-blue-500/20 text-blue-400 text-xs px-2 py-1 rounded">
                              {d.decision_value.topic}
                            </span>

                            {/* Importance */}
                            <span className={`text-xs px-2 py-1 rounded ${
                              d.decision_value.importance === 'critical' ? 'bg-purple-500/20 text-purple-400' :
                              d.decision_value.importance === 'high' ? 'bg-orange-500/20 text-orange-400' :
                              'bg-bg-tertiary text-text-tertiary'
                            }`}>
                              {d.decision_value.importance}
                            </span>
                          </div>
                        </div>

                        {/* Right side: verification status + view message link */}
                        <div className="flex items-center gap-2 ml-4">
                          {/* View Message link - only for archived (non-spam) messages */}
                          {d.decision_value.should_archive && !d.decision_value.is_spam && d.message_id && (
                            <Link
                              href={`/messages/${d.message_id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
                              title="View archived message"
                            >
                              View Message →
                            </Link>
                          )}
                          <span className={`text-xs px-2 py-1 rounded ${
                            d.verification_status === 'verified_correct' ? 'bg-green-500/20 text-green-400' :
                            d.verification_status === 'verified_incorrect' ? 'bg-orange-500/20 text-orange-400' :
                            d.verification_status === 'flagged' ? 'bg-red-500/20 text-red-400' :
                            'bg-bg-tertiary text-text-tertiary'
                          }`}>
                            {d.verification_status.replace('_', ' ')}
                          </span>
                          <span className="text-text-tertiary">{expandedDecisionId === d.id ? '▲' : '▼'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Expanded details */}
                    {expandedDecisionId === d.id && (
                      <div className="border-t border-border-subtle p-4 bg-bg-secondary/30">
                        {/* Full message */}
                        <div className="mb-4">
                          <h4 className="text-sm font-medium text-text-tertiary mb-1">Full Message</h4>
                          <div className="text-sm bg-bg-elevated p-3 rounded border border-border-subtle text-text-primary whitespace-pre-wrap">
                            {d.message_preview || 'No content'}
                          </div>
                        </div>

                        {/* AI Reasoning - Most important! */}
                        <div className="mb-4">
                          <h4 className="text-sm font-medium text-text-tertiary mb-1">
                            Why did the AI decide this?
                          </h4>
                          <div className="text-sm bg-bg-elevated p-3 rounded border border-border-subtle text-text-secondary">
                            {d.llm_reasoning || 'No reasoning provided'}
                          </div>
                        </div>

                        {/* LLM Analysis (chain-of-thought) - collapsible */}
                        {d.llm_analysis && (
                          <details className="mb-4">
                            <summary className="text-sm font-medium text-text-tertiary cursor-pointer hover:text-text-secondary">
                              ► Full LLM Analysis (Chain-of-Thought)
                            </summary>
                            <pre className="text-xs bg-bg-elevated p-3 rounded border border-border-subtle overflow-x-auto whitespace-pre-wrap mt-2 text-text-secondary">
                              {d.llm_analysis}
                            </pre>
                          </details>
                        )}

                        {/* Decision details */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
                          <div className="bg-bg-elevated p-2 rounded border border-border-subtle">
                            <span className="text-text-tertiary block text-xs">Confidence</span>
                            <span className="font-medium text-text-primary">{(d.decision_value.confidence * 100).toFixed(0)}%</span>
                          </div>
                          <div className="bg-bg-elevated p-2 rounded border border-border-subtle">
                            <span className="text-text-tertiary block text-xs">Model</span>
                            <span className="font-medium text-text-primary">{d.model_used || 'Unknown'}</span>
                          </div>
                          <div className="bg-bg-elevated p-2 rounded border border-border-subtle">
                            <span className="text-text-tertiary block text-xs">Prompt</span>
                            <span className="font-medium text-text-primary">{d.prompt_version || 'v6'}</span>
                          </div>
                          <div className="bg-bg-elevated p-2 rounded border border-border-subtle">
                            <span className="text-text-tertiary block text-xs">Processing Time</span>
                            <span className="font-medium text-text-primary">{formatTime(d.processing_time_ms)}</span>
                          </div>
                        </div>

                        {/* Verification actions with clear labels */}
                        <div className="border-t border-border-subtle pt-4">
                          <h4 className="text-sm font-medium text-text-primary mb-3">
                            Was this decision correct?
                          </h4>
                          <div className="flex flex-wrap gap-3">
                            <button
                              onClick={() => handleVerify(d.id, 'verified_correct')}
                              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors flex items-center gap-2"
                            >
                              <span>✓</span>
                              <span>Yes, Correct</span>
                            </button>
                            <button
                              onClick={() => handleVerify(d.id, 'verified_incorrect')}
                              className="px-4 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors flex items-center gap-2"
                            >
                              <span>✗</span>
                              <span>No, Wrong</span>
                            </button>
                            <button
                              onClick={() => handleVerify(d.id, 'flagged')}
                              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors flex items-center gap-2"
                              title="Queue this message for re-processing with the latest classification rules"
                            >
                              <span>🔄</span>
                              <span>Re-process</span>
                            </button>
                          </div>
                          <p className="text-xs text-text-tertiary mt-2">
                            &ldquo;Re-process&rdquo; will queue this message to be classified again with the current AI model and rules.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* ADMIN ACTIONS TAB */}
        {activeTab === 'actions' && (
          <>
            {/* Stats Cards */}
            {adminStats && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div className="glass p-6">
                  <h3 className="text-text-tertiary text-sm">Total Actions</h3>
                  <p className="text-3xl font-bold text-text-primary">{adminStats.total_actions}</p>
                  <p className="text-sm text-text-tertiary">{adminStats.actions_last_24h} last 24h</p>
                </div>
                <div className="glass p-6">
                  <h3 className="text-text-tertiary text-sm">Last Hour</h3>
                  <p className="text-3xl font-bold text-purple-500">{adminStats.actions_last_hour}</p>
                  <p className="text-sm text-text-tertiary">actions taken</p>
                </div>
                <div className="glass p-6">
                  <h3 className="text-text-tertiary text-sm">Top Action</h3>
                  <p className="text-xl font-bold text-text-primary">
                    {Object.entries(adminStats.by_action_type || {})[0]?.[0]?.replace('message.', '') || 'None'}
                  </p>
                  <p className="text-sm text-text-tertiary">
                    {Object.entries(adminStats.by_action_type || {})[0]?.[1] || 0} times
                  </p>
                </div>
                <div className="glass p-6">
                  <h3 className="text-text-tertiary text-sm">Active Admins</h3>
                  <p className="text-3xl font-bold text-text-primary">
                    {Object.keys(adminStats.by_admin || {}).length}
                  </p>
                  <p className="text-sm text-text-tertiary">with actions</p>
                </div>
              </div>
            )}

            {/* Filters */}
            <div className="glass p-4 mb-6 flex flex-wrap gap-4 items-center">
              <span className="text-text-tertiary text-sm">Filter:</span>
              <button
                onClick={() => setActionFilter('all')}
                className={`px-4 py-2 rounded transition-colors ${actionFilter === 'all' ? 'bg-purple-600 text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'}`}
              >
                All
              </button>
              {Object.entries(adminStats?.by_action_type || {}).slice(0, 5).map(([action, count]) => (
                <button
                  key={action}
                  onClick={() => setActionFilter(action)}
                  className={`px-4 py-2 rounded transition-colors ${actionFilter === action ? 'bg-purple-600 text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'}`}
                >
                  {getActionInfo(action).icon} {getActionInfo(action).label} ({count})
                </button>
              ))}
              <button
                onClick={fetchAdminActions}
                className="ml-auto px-4 py-2 bg-bg-tertiary text-text-secondary rounded hover:bg-bg-secondary transition-colors"
              >
                Refresh
              </button>
            </div>

            {/* Actions List */}
            <div className="space-y-4">
              {adminActions.length === 0 ? (
                <div className="glass p-12 text-center text-text-secondary">
                  No admin actions recorded yet. Take actions from message detail pages to see them here.
                </div>
              ) : (
                adminActions.map((a) => {
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
          </>
        )}
      </div>
    </div>
  )
}
