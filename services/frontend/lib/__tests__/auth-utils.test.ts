import { describe, it, expect, beforeEach } from 'vitest';
import { getAuthHeaders, withAuth } from '../auth-utils';

function clearCookie() {
  document.cookie = 'csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
}

describe('auth-utils CSRF', () => {
  beforeEach(() => {
    localStorage.clear();
    clearCookie();
  });

  it('returns no headers when logged out without a csrf cookie', () => {
    expect(getAuthHeaders()).toEqual({});
  });

  it('includes X-CSRF-Token from the csrf_token cookie', () => {
    document.cookie = 'csrf_token=abc_123-x; path=/';
    expect(getAuthHeaders()).toEqual({ 'X-CSRF-Token': 'abc_123-x' });
  });

  it('includes both Authorization and X-CSRF-Token when logged in', () => {
    localStorage.setItem('tg_archiver_token', 'jwt');
    document.cookie = 'csrf_token=tok; path=/';
    expect(getAuthHeaders()).toEqual({ Authorization: 'Bearer jwt', 'X-CSRF-Token': 'tok' });
  });

  it('withAuth merges caller headers with auth + csrf headers', () => {
    document.cookie = 'csrf_token=tok; path=/';
    const opts = withAuth({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(opts.method).toBe('POST');
    expect(opts.headers).toEqual({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'tok' });
  });
});
