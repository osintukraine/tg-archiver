import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ApiKeysPage from '../api-keys/page';
import FeedsPage from '../feeds/page';
import UsagePage from '../usage/page';
import ProfilePage from '../page';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
    user: {
      id: 1,
      username: 'admin',
      name: 'admin',
      email: 'a@x.io',
      is_active: true,
      is_admin: true,
      roles: ['admin'],
      verified: true,
    },
  }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const TS = '2026-01-02T03:04:05+00:00';

// Payloads mirror the FastAPI response models (routers/api_keys.py, routers/feed_tokens.py)
function routes(map: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const hit = Object.keys(map).find((k) => url.includes(k));
      return hit ? json(map[hit]) : Promise.resolve(new Response('{}', { status: 404 }));
    })
  );
}

const KEY = {
  id: 7,
  name: 'ci-key',
  scopes: ['read', 'media'],
  created_at: TS,
  expires_at: null,
  last_used_at: null,
  is_active: true,
  is_expired: false,
};

describe('profile pages against real API shapes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('api-keys: empty list', async () => {
    routes({ '/api/api-keys': { keys: [], total: 0, active_count: 0 } });
    render(<ApiKeysPage />);
    expect(await screen.findByText(/No API keys yet/)).toBeTruthy();
  });

  it('api-keys: populated list', async () => {
    routes({
      '/api/api-keys': {
        keys: [KEY, { ...KEY, id: 8, name: 'old', is_active: false }],
        total: 2,
        active_count: 1,
      },
    });
    render(<ApiKeysPage />);
    expect(await screen.findByText('ci-key')).toBeTruthy();
    expect(screen.getByText('Key #8')).toBeTruthy();
    expect(screen.getByText(/1 active/)).toBeTruthy();
    expect(screen.getByText('Revoked')).toBeTruthy();
  });

  it('feeds: empty and populated token lists', async () => {
    routes({ '/api/feed-tokens': { tokens: [], total: 0 } });
    const first = render(<FeedsPage />);
    expect(await screen.findByText(/No tokens yet/)).toBeTruthy();
    first.unmount();

    routes({
      '/api/feed-tokens': {
        tokens: [{ id: 3, name: 'Feedly', created_at: TS, last_used_at: null, is_active: true }],
        total: 1,
      },
    });
    render(<FeedsPage />);
    expect(await screen.findByText('Feedly')).toBeTruthy();
    expect(screen.getByText('Token #3')).toBeTruthy();
  });

  it('usage: empty and populated', async () => {
    const base = {
      total_keys: 0,
      active_keys: 0,
      total_requests: 0,
      requests_today: 0,
      requests_this_week: 0,
      requests_this_month: 0,
      rate_limit_tier: 'admin',
      tier_limits: { default: 1000, media: 500, export: 500, map: 1000 },
      keys: [],
    };
    routes({ '/usage/summary': base });
    const first = render(<UsagePage />);
    expect(await screen.findByText(/No API keys yet/)).toBeTruthy();
    first.unmount();

    routes({
      '/usage/summary': { ...base, total_keys: 1, active_keys: 1, keys: [{ id: 7, name: 'ci-key', last_used_at: TS }] },
    });
    render(<UsagePage />);
    await waitFor(() => expect(screen.getByText('ci-key')).toBeTruthy());
    expect(screen.getByText(/1 of 1 active/)).toBeTruthy();
  });

  it('account page renders the /users/me shape', () => {
    render(<ProfilePage />);
    expect(screen.getAllByText('a@x.io').length).toBeGreaterThan(0);
  });
});
