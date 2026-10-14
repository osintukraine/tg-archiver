import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const USER = { id: 1, username: 'admin', email: 'a@x.io', is_active: true, is_admin: true };

function Probe() {
  const { logout, isAuthenticated, isLoading } = useAuth();
  return (
    <div>
      <span data-testid="state">{isLoading ? 'loading' : isAuthenticated ? 'in' : 'out'}</span>
      <button onClick={logout}>logout</button>
    </div>
  );
}

function mockFetch(logoutImpl: () => Promise<Response>) {
  const fn = vi.fn((url: string) =>
    url.endsWith('/api/auth/users/me')
      ? Promise.resolve(new Response(JSON.stringify(USER), { status: 200 }))
      : logoutImpl()
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('AuthContext logout', () => {
  beforeEach(() => {
    localStorage.setItem('tg_archiver_token', 'tok123');
    document.cookie = 'csrf_token=csrf456';
    push.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  async function loggedIn() {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('in'));
  }

  it('calls POST /api/auth/logout with bearer + CSRF headers, then clears state', async () => {
    const fn = mockFetch(() => Promise.resolve(new Response('{}', { status: 200 })));
    await loggedIn();
    act(() => screen.getByText('logout').click());

    const call = fn.mock.calls.find(([u]) => String(u).endsWith('/api/auth/logout'))!;
    const init = (call as unknown as [string, RequestInit])[1];
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok123', 'X-CSRF-Token': 'csrf456' });
    expect(localStorage.getItem('tg_archiver_token')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('out'));
    expect(push).toHaveBeenCalledWith('/');
  });

  it('still clears state when the request fails', async () => {
    mockFetch(() => Promise.reject(new TypeError('network down')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await loggedIn();
    act(() => screen.getByText('logout').click());
    expect(localStorage.getItem('tg_archiver_token')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('out'));
  });

  it('still clears state when the API answers 401', async () => {
    mockFetch(() => Promise.resolve(new Response('{}', { status: 401 })));
    await loggedIn();
    act(() => screen.getByText('logout').click());
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('out'));
  });
});
