/**
 * Admin API Client - Authenticated API calls for admin pages
 *
 * This module provides a centralized client for all admin API calls with:
 * - Automatic JWT token inclusion
 * - Consistent error handling
 * - Type-safe request/response handling
 * - Request/response logging
 *
 * IMPORTANT: All admin pages MUST use this client instead of raw fetch()
 * to ensure JWT tokens are properly sent with requests.
 */

const TOKEN_KEY = 'tg_archiver_token';

/**
 * Get stored JWT token
 */
function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Get API base URL for client-side requests
 * Uses NEXT_PUBLIC_API_URL if set, otherwise empty string for same-origin
 */
function getApiUrl(): string {
  // When behind Caddy proxy, use relative URLs (same origin)
  // For direct access without proxy, set NEXT_PUBLIC_API_URL=http://localhost:8000
  const clientUrl = process.env.NEXT_PUBLIC_API_URL;

  if (!clientUrl) {
    return ''; // Relative URLs (proxied through Caddy)
  }

  // Remove trailing slash for consistency
  return clientUrl.replace(/\/+$/, '');
}

const API_URL = getApiUrl();

/**
 * Admin API fetch wrapper with automatic JWT token inclusion
 *
 * @param path - API path (e.g., '/api/admin/channels')
 * @param options - Standard fetch options
 * @returns Parsed JSON response
 * @throws Error with API error message
 */
export async function adminFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${path}`;
  const token = getToken();

  // Build headers with JWT token if available
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: `HTTP ${response.status}: ${response.statusText}`
      }));
      // Handle FastAPI validation errors (422 returns detail as array)
      let message = `API error: ${response.status}`;
      if (error.detail) {
        if (typeof error.detail === 'string') {
          message = error.detail;
        } else if (Array.isArray(error.detail)) {
          // FastAPI validation error format
          message = error.detail.map((e: any) => e.msg || e.message || JSON.stringify(e)).join(', ');
        } else {
          message = JSON.stringify(error.detail);
        }
      }
      throw new Error(message);
    }

    return response.json();
  } catch (error) {
    console.error('[Admin API] Request failed:', { url, error });
    throw error;
  }
}

/**
 * Admin API GET request
 */
export async function adminGet<T = any>(path: string): Promise<T> {
  return adminFetch<T>(path, { method: 'GET' });
}

/**
 * Admin API POST request
 */
export async function adminPost<T = any>(
  path: string,
  data?: any
): Promise<T> {
  return adminFetch<T>(path, {
    method: 'POST',
    body: data ? JSON.stringify(data) : undefined,
  });
}

/**
 * Admin API PUT request
 */
export async function adminPut<T = any>(
  path: string,
  data?: any
): Promise<T> {
  return adminFetch<T>(path, {
    method: 'PUT',
    body: data ? JSON.stringify(data) : undefined,
  });
}

/**
 * Admin API PATCH request
 */
export async function adminPatch<T = any>(
  path: string,
  data?: any
): Promise<T> {
  return adminFetch<T>(path, {
    method: 'PATCH',
    body: data ? JSON.stringify(data) : undefined,
  });
}

/**
 * Admin API DELETE request
 */
export async function adminDelete<T = any>(path: string): Promise<T> {
  return adminFetch<T>(path, { method: 'DELETE' });
}

/**
 * Export as namespace for convenience
 */
export const adminApi = {
  fetch: adminFetch,
  get: adminGet,
  post: adminPost,
  put: adminPut,
  patch: adminPatch,
  delete: adminDelete,
};
