/**
 * Auth Utilities - Shared authentication helpers
 *
 * Used by API clients and components that need to make authenticated requests.
 */

const TOKEN_KEY = 'tg_archiver_token';

/**
 * Get stored JWT token
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Set stored JWT token
 */
export function setToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

/**
 * Remove stored JWT token
 */
export function removeToken(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/**
 * Read the double-submit CSRF token from the `csrf_token` cookie (client only)
 */
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(^| )csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Get auth headers for API requests: Bearer token plus X-CSRF-Token.
 * The CSRF header is always sent (the API only checks it on POST/PUT/PATCH/DELETE).
 */
export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const csrf = getCsrfToken();
  if (csrf) headers['X-CSRF-Token'] = csrf;
  return headers;
}

/**
 * Build fetch options with auth headers
 */
export function withAuth(options: RequestInit = {}): RequestInit {
  return {
    ...options,
    headers: { ...(options.headers as Record<string, string> || {}), ...getAuthHeaders() },
  };
}
