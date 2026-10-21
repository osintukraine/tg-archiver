import { describe, expect, it } from 'vitest'
import { telegramUrl } from '../submissions'

describe('telegramUrl', () => {
  it('builds t.me links from normalised usernames and invite codes', () => {
    expect(telegramUrl('@some_channel')).toBe('https://t.me/some_channel')
    expect(telegramUrl('+AbCdEfGhIjK')).toBe('https://t.me/+AbCdEfGhIjK')
  })
})
