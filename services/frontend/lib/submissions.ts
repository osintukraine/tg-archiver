/** Helpers for the admin channel-suggestion review page. */

export interface Submission {
  id: number
  channel_link: string
  channel_name: string
  telegram_username: string | null
  source_origin: string
  reason: string
  value_description: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  reviewed_at: string | null
  reviewed_by: string | null
  assigned_folder: string | null
  rejection_reason: string | null
}

// Stored links are normalised by the API to "@username" or "+invite"
export function telegramUrl(link: string): string {
  return `https://t.me/${link.replace(/^@/, '')}`
}
