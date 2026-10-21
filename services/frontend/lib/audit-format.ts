/** Display helpers for admin_actions rows (audit log page). */

export interface AdminAction {
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

const asText = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

// "service:listener" → "listener (service)"; admins show email or id
export function actorName(a: AdminAction): string {
  if (a.admin_id?.startsWith('service:')) return `${a.admin_id.slice('service:'.length)} (service)`
  return a.admin_email || a.admin_id || 'Unknown'
}

// What the action applied to: a link when there is a page for it, plain text otherwise
export function resourceTarget(a: AdminAction): { text: string; href?: string } | null {
  const d = a.details || {}
  switch (a.resource_type) {
    case 'message':
      return a.resource_id ? { text: `Message #${a.resource_id}`, href: `/messages/${a.resource_id}` } : null
    case 'channel': {
      const username = asText(d.username)
      const name = asText(d.name) || (username ? `@${username}` : `Channel ${a.resource_id}`)
      return username ? { text: name, href: `/channels/${username}` } : { text: name }
    }
    case 'discovered_channel': {
      const username = asText(d.username)
      return { text: username ? `@${username}` : `Discovered channel #${a.resource_id}` }
    }
    case 'submission': {
      const username = asText(d.username)
      const label = username ? (username.startsWith('@') ? username : `@${username}`) : `Suggestion #${a.resource_id}`
      return { text: label, href: '/admin/submissions' }
    }
    case 'config':
      return { text: asText(d.key) || 'Settings' }
    case 'dlq':
      return { text: `DLQ entry ${asText(d.dlq_id) || ''}`.trim() }
    default:
      return null // system events have no target
  }
}
