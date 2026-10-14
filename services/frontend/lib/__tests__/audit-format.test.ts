import { describe, expect, it } from 'vitest'
import { type AdminAction, actorName, resourceTarget } from '../audit-format'
import { safeReturnTo } from '../safe-return-to'

const row = (over: Partial<AdminAction>): AdminAction => ({
  id: 1, action: 'x', resource_type: 'system', resource_id: 0, details: {},
  admin_id: null, admin_email: null, ip_address: null, created_at: '2026-10-14T00:00:00Z', ...over,
})

describe('audit-format', () => {
  it('shows full service names instead of a truncated id', () => {
    expect(actorName(row({ admin_id: 'service:listener' }))).toBe('listener (service)')
    expect(actorName(row({ admin_id: '1', admin_email: 'admin@x.test' }))).toBe('admin@x.test')
  })

  it('gives system events no target (no "Message #0")', () => {
    expect(resourceTarget(row({ action: 'system.service_started' }))).toBeNull()
  })

  it('links channels by username, messages by id', () => {
    expect(resourceTarget(row({
      resource_type: 'channel', resource_id: -1001289685069,
      details: { name: 'BelVestnik', username: 'belvestnik' },
    }))).toEqual({ text: 'BelVestnik', href: '/channels/belvestnik' })
    expect(resourceTarget(row({ resource_type: 'message', resource_id: 42 })))
      .toEqual({ text: 'Message #42', href: '/messages/42' })
    expect(resourceTarget(row({ resource_type: 'message', resource_id: 0 }))).toBeNull()
  })

  it('names config keys without a link', () => {
    expect(resourceTarget(row({ resource_type: 'config', details: { key: 'feed.max_limit' } })))
      .toEqual({ text: 'feed.max_limit' })
  })
})

describe('safeReturnTo', () => {
  it('keeps same-site paths and rejects open redirects', () => {
    expect(safeReturnTo('/admin/audit')).toBe('/admin/audit')
    for (const bad of [null, '', 'https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)']) {
      expect(safeReturnTo(bad)).toBe('/')
    }
  })
})
