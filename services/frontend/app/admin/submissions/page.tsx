'use client'
import { useCallback, useEffect, useState } from 'react'
import { adminApi } from '@/lib/admin-api'
import { type Submission, telegramUrl } from '@/lib/submissions'

/**
 * Admin review of user-suggested channels.
 * Approve adds the channel to the archive folder via the listener; reject records a reason.
 */

type Tab = Submission['status']
const TABS: { key: Tab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]
const PAGE_SIZE = 50

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'Request failed')

export default function SubmissionsPage() {
  const [tab, setTab] = useState<Tab>('pending')
  const [items, setItems] = useState<Submission[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [folders, setFolders] = useState<Record<number, string>>({})
  const [reasons, setReasons] = useState<Record<number, string>>({})
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    adminApi
      .get(`/api/admin/channel-submissions?status=${tab}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`)
      .then((data) => {
        if (cancelled) return
        setItems(data.items || [])
        setTotal(data.total || 0)
        setError(null)
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [tab, page, reloadKey])

  const switchTab = (next: Tab) => {
    setTab(next)
    setPage(0)
    setLoading(true)
    setError(null)
  }

  const review = useCallback(async (id: number, action: 'approve' | 'reject', body: object) => {
    setBusyId(id)
    setError(null)
    try {
      await adminApi.post(`/api/admin/channel-submissions/${id}/${action}`, body)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(`${action === 'approve' ? 'Approve' : 'Reject'} failed: ${errorMessage(err)}`)
    } finally {
      setBusyId(null)
    }
  }, [])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-text-primary">Suggested Channels</h1>
        <p className="text-text-secondary mt-1">
          Channels suggested through the public form. Approving adds the channel to the archive folder.
        </p>
      </div>

      {error && (
        <div role="alert" className="bg-red-500/20 border border-red-500/30 text-red-400 px-4 py-3 rounded-sm">
          {error}
        </div>
      )}

      <div className="glass p-4 flex flex-wrap gap-4 items-center">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            className={`px-4 py-2 rounded-sm transition-colors ${tab === t.key ? 'bg-purple-600 text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'}`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          className="ml-auto px-4 py-2 bg-bg-tertiary text-text-secondary rounded-sm hover:bg-bg-secondary transition-colors"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary">Loading...</div>
      ) : items.length === 0 ? (
        <div className="glass p-12 text-center text-text-secondary">No {tab} suggestions.</div>
      ) : (
        <div className="space-y-4">
          {items.map((s) => {
            const busy = busyId === s.id
            return (
              <div key={s.id} className="glass p-4 space-y-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-lg font-semibold text-text-primary">{s.channel_name}</h2>
                  <a
                    href={telegramUrl(s.channel_link)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    {s.channel_link}
                  </a>
                  {s.telegram_username && (
                    <span className="text-text-tertiary text-sm">@{s.telegram_username}</span>
                  )}
                  <span className="text-text-tertiary text-sm uppercase">{s.source_origin}</span>
                  <span className="text-text-tertiary text-sm ml-auto">
                    {new Date(s.created_at).toLocaleString()}
                  </span>
                </div>

                <p className="text-text-secondary whitespace-pre-wrap">
                  <span className="text-text-tertiary">Reason: </span>
                  {s.reason}
                </p>
                {s.value_description && (
                  <p className="text-text-secondary whitespace-pre-wrap">
                    <span className="text-text-tertiary">Value: </span>
                    {s.value_description}
                  </p>
                )}

                {s.status === 'pending' ? (
                  <div className="flex flex-wrap gap-3 items-end border-t border-border-subtle pt-3">
                    <label className="text-sm text-text-tertiary">
                      Folder
                      <input
                        value={folders[s.id] ?? ''}
                        onChange={(e) => setFolders({ ...folders, [s.id]: e.target.value })}
                        placeholder="default archive folder"
                        maxLength={100}
                        disabled={busy}
                        className="block mt-1 px-3 py-2 bg-bg-tertiary text-text-primary rounded-sm"
                      />
                    </label>
                    <button
                      disabled={busy || busyId !== null}
                      onClick={() => review(s.id, 'approve', { folder: folders[s.id]?.trim() || null })}
                      className="px-4 py-2 bg-green-600 text-white rounded-sm disabled:opacity-50"
                    >
                      {busy ? 'Working...' : 'Approve'}
                    </button>
                    <label className="text-sm text-text-tertiary ml-auto">
                      Rejection reason
                      <input
                        value={reasons[s.id] ?? ''}
                        onChange={(e) => setReasons({ ...reasons, [s.id]: e.target.value })}
                        placeholder="optional"
                        maxLength={2000}
                        disabled={busy}
                        className="block mt-1 px-3 py-2 bg-bg-tertiary text-text-primary rounded-sm"
                      />
                    </label>
                    <button
                      disabled={busy || busyId !== null}
                      onClick={() => review(s.id, 'reject', { reason: reasons[s.id]?.trim() || null })}
                      className="px-4 py-2 bg-red-600 text-white rounded-sm disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <div className="border-t border-border-subtle pt-3 text-sm text-text-secondary">
                    {s.status === 'approved' ? 'Approved' : 'Rejected'}
                    {s.reviewed_by && <> by <span className="text-text-primary">{s.reviewed_by}</span></>}
                    {s.reviewed_at && <> on {new Date(s.reviewed_at).toLocaleString()}</>}
                    {s.status === 'approved' && s.assigned_folder && <> &middot; folder {s.assigned_folder}</>}
                    {s.status === 'rejected' && (
                      <> &middot; {s.rejection_reason || 'no reason given'}</>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center gap-4 justify-center">
          <button
            disabled={page === 0}
            onClick={() => { setPage(page - 1); setLoading(true) }}
            className="px-4 py-2 bg-bg-tertiary text-text-secondary rounded-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-text-secondary text-sm">Page {page + 1} of {pages}</span>
          <button
            disabled={page + 1 >= pages}
            onClick={() => { setPage(page + 1); setLoading(true) }}
            className="px-4 py-2 bg-bg-tertiary text-text-secondary rounded-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
