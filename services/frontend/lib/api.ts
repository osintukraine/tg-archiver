/**
 * API Client for Telegram Archiver
 *
 * Server-side calls use internal Docker network (http://api:8000)
 * Client-side calls use relative URLs (proxied by reverse proxy)
 */

import type {
  Message,
  SearchResult,
  SearchParams,
  Channel,
  AdjacentMessages,
  SocialGraphResponse,
  EngagementTimelineResponse,
  CommentThreadResponse,
} from './types';

/**
 * Validate and sanitize API URL
 * @param url - The URL to validate
 * @param context - Context for error messages ('client' or 'server')
 * @returns Validated URL without trailing slash
 */
function validateApiUrl(url: string, context: 'client' | 'server'): string {
  if (!url) {
    throw new Error(`[API Config] API URL is not set for ${context}-side rendering`);
  }

  try {
    const parsed = new URL(url);

    // Validate protocol
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Invalid protocol: ${parsed.protocol}. Expected http: or https:`);
    }

    // Remove trailing slash for consistency
    return url.replace(/\/+$/, '');
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error(`[API Config] Invalid URL format: "${url}"`);
    }
    throw e;
  }
}

/**
 * Get API base URL based on execution context
 *
 * IMPORTANT: This function validates the API URL at runtime and throws errors
 * for misconfigured environments. This is intentional to catch configuration
 * issues early rather than failing silently.
 *
 * Server-side: Uses API_URL (internal Docker network: http://api:8000)
 * Client-side: Uses NEXT_PUBLIC_API_URL (browser-accessible: http://localhost:8000)
 */
function getApiUrl(): string {
  // Server-side (Next.js server components)
  if (typeof window === 'undefined') {
    const serverUrl = process.env.API_URL || 'http://api:8000';
    return validateApiUrl(serverUrl, 'server');
  }

  // Client-side (browser)
  const clientUrl = process.env.NEXT_PUBLIC_API_URL;

  if (!clientUrl) {
    // When behind Caddy proxy, use relative URLs (same origin)
    // This allows /api/* requests to go through Caddy → Oathkeeper → API
    // For direct access without proxy, set NEXT_PUBLIC_API_URL=http://localhost:8000
    return '';
  }

  return validateApiUrl(clientUrl, 'client');
}

/**
 * Export validated API URL for direct use in components
 * This is lazy-evaluated to allow for runtime configuration
 */
export const API_URL = getApiUrl();

/**
 * Authenticated fetch wrapper that includes JWT token and CSRF token.
 * Use this for any API calls that require authentication.
 *
 * @param url - The URL to fetch (can be relative or absolute)
 * @param options - Standard fetch options
 * @returns Fetch response
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  // Get JWT token from localStorage
  const token = typeof window !== 'undefined' ? localStorage.getItem('tg_archiver_token') : null;
  const method = options.method?.toUpperCase() || 'GET';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Add CSRF token for state-changing requests
  const stateChangingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (stateChangingMethods.includes(method)) {
    const csrfToken = typeof document !== 'undefined'
      ? document.cookie.match(/(^| )csrf_token=([^;]+)/)?.[2]
      : null;
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Ensure cookies are sent for CSRF
  });
}

/**
 * Get media base URL based on environment
 *
 * Architecture (with Caddy):
 * - Client-side: Use relative /media/* URLs → Caddy routes to:
 *   1. Local SSD buffer (hot files) - fast path
 *   2. API redirect to Hetzner storage (cold files) - fallback
 * - Server-side (SSR): Use direct MinIO via Docker network
 *
 * See: infrastructure/caddy/Caddyfile.ory for routing details
 */
function getMediaBaseUrl(): string {
  // IMPORTANT: Always return browser-accessible URLs
  // Even during SSR, media URLs get embedded in HTML that browsers will render.
  // Docker-internal URLs (seaweedfs:8333) are NOT accessible from browsers.
  //
  // Behind Caddy leave both empty: media is then the relative /media/... path.
  // NEXT_PUBLIC_MEDIA_URL (CDN) or NEXT_PUBLIC_MINIO_URL override the prefix.
  //
  // Priority: NEXT_PUBLIC_MEDIA_URL > NEXT_PUBLIC_MINIO_URL > empty (relative)
  return process.env.NEXT_PUBLIC_MEDIA_URL || process.env.NEXT_PUBLIC_MINIO_URL || '';
}

/**
 * Convert S3 key to browser-accessible media URL
 *
 * S3 keys are stored as "media/ab/cd/hash.jpg" and Caddy serves them at /media/ab/cd/hash.jpg
 * (anonymous read, no redirect).
 *
 * - Normal: relative /media/ab/cd/hash.jpg
 * - forceExternal (OpenGraph/social crawlers): absolute ${NEXT_PUBLIC_BASE_URL}/media/...
 *
 * NOTE: Always returns browser-accessible URLs, even during SSR.
 * Docker-internal URLs would break when rendered to HTML.
 *
 * @param s3Key - The S3 key (e.g., "media/2f/a1/abc123.jpg")
 * @param forceExternal - If true, return an absolute URL on the public origin.
 */
export function getMediaUrl(s3Key: string | null, forceExternal = false): string | null {
  if (!s3Key) return null;

  const cleanKey = s3Key.startsWith('/') ? s3Key.slice(1) : s3Key;

  if (forceExternal) {
    const origin = (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost').replace(/\/+$/, '');
    return `${origin}/${cleanKey}`;
  }

  const baseUrl = getMediaBaseUrl();
  return baseUrl ? `${baseUrl}/${cleanKey}` : `/${cleanKey}`;
}

/**
 * Build query string from params
 */
function buildQueryString(params: object): string {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.append(key, String(value));
    }
  });

  return query.toString();
}

/**
 * Get auth token (client-side only)
 */
function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;

  // Access auth token from window (set by auth provider)
  const token = (window as unknown as { __AUTH_TOKEN__?: string }).__AUTH_TOKEN__;
  return token || null;
}

/**
 * Get CSRF token from cookie (client-side only)
 * Required for state-changing requests (POST, PUT, PATCH, DELETE)
 */
function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(^| )csrf_token=([^;]+)/);
  return match ? match[2] : null;
}

/**
 * Fetch helper with error handling and authentication
 */
async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getApiUrl()}${path}`;
  const method = options?.method?.toUpperCase() || 'GET';

  // Get auth token for client-side requests
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  // Add Authorization header if token is available
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Add CSRF token for state-changing requests (client-side only)
  const stateChangingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (stateChangingMethods.includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include', // Ensure cookies are sent for CSRF
      // Disable Next.js server-side caching - data is dynamic and changes frequently
      cache: 'no-store',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || `API error: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    console.error('API request failed:', { url, error });
    throw error;
  }
}

/**
 * Search messages with filters
 */
export async function searchMessages(params: SearchParams = {}): Promise<SearchResult> {
  const queryString = buildQueryString(params);
  return fetchApi<SearchResult>(`/api/messages?${queryString}`);
}

/**
 * Fetch messages with media for Immersive Media Mode
 *
 * @param params - Query parameters
 * @returns Messages with media, total count, and hasMore flag
 */
export async function fetchMessagesWithMedia(
  params: {
    limit?: number;
    offset?: number;
    channelId?: number;
    startDate?: string;
  }
): Promise<{ messages: Message[]; total: number; hasMore: boolean }> {
  const queryParams: SearchParams = {
    has_media: true,
    page_size: params.limit || 20,
    page: params.offset ? Math.floor(params.offset / (params.limit || 20)) + 1 : 1,
    sort_by: 'telegram_date',
    sort_order: 'desc',
  };

  if (params.channelId) {
    queryParams.channel_id = params.channelId;
  }

  if (params.startDate) {
    queryParams.date_from = params.startDate;
  }

  const result = await searchMessages(queryParams);

  return {
    messages: result.items,
    total: result.total,
    hasMore: result.has_next,
  };
}

/**
 * Get single message by ID
 */
export async function getMessage(id: number): Promise<Message> {
  return fetchApi<Message>(`/api/messages/${id}`);
}

/**
 * Get adjacent message IDs for navigation (prev/next)
 */
export async function getAdjacentMessages(id: number): Promise<AdjacentMessages> {
  return fetchApi<AdjacentMessages>(`/api/messages/${id}/adjacent`);
}

/**
 * Get all channels
 */
export async function getChannels(): Promise<Channel[]> {
  // Request up to 500 channels (API default is 100)
  return fetchApi<Channel[]>('/api/channels?limit=500');
}

/**
 * Get all message topics for filtering
 */
export async function getTopics(): Promise<import('./types').MessageTopic[]> {
  return fetchApi<import('./types').MessageTopic[]>('/api/system/topics');
}

/**
 * Get all channel categories for filtering
 */
export async function getCategories(): Promise<import('./types').ChannelCategory[]> {
  return fetchApi<import('./types').ChannelCategory[]>('/api/system/categories');
}

/**
 * Get all Telegram folders for filtering
 */
export async function getFolders(): Promise<import('./types').TelegramFolder[]> {
  return fetchApi<import('./types').TelegramFolder[]>('/api/system/folders');
}

/**
 * Get single channel by ID
 */
export async function getChannel(id: number): Promise<Channel> {
  return fetchApi<Channel>(`/api/channels/${id}`);
}

/**
 * Get channel by username
 */
export async function getChannelByUsername(username: string): Promise<Channel> {
  const channels = await getChannels();
  const channel = channels.find(c => c.username === username);
  if (!channel) {
    throw new Error(`Channel not found: ${username}`);
  }
  return channel;
}

// Export all functions as an api object for convenience
export const api = {
  getMediaUrl,
  searchMessages,
  fetchMessagesWithMedia,
  getMessage,
  getAdjacentMessages,
  getChannels,
  getChannel,
  getChannelByUsername,
  getMessageSocialGraph,
  getEngagementTimeline,
  getMessageComments,
  translateComment,
};

/**
 * Get social graph for a message (forwards, replies, author, comments)
 */
export async function getMessageSocialGraph(
  messageId: number,
  params: {
    include_forwards?: boolean;
    include_replies?: boolean;
    max_depth?: number;
    max_comments?: number;
  } = {}
): Promise<SocialGraphResponse> {
  const queryString = buildQueryString(params);
  return fetchApi<SocialGraphResponse>(`/api/social-graph/messages/${messageId}?${queryString}`);
}

/**
 * Get engagement timeline (views, forwards, reactions over time)
 */
export async function getEngagementTimeline(
  messageId: number,
  params: {
    granularity?: 'hour' | 'day' | 'week';
    time_range_hours?: number;
  } = {}
): Promise<EngagementTimelineResponse> {
  const queryString = buildQueryString(params);
  return fetchApi<EngagementTimelineResponse>(`/api/social-graph/messages/${messageId}/engagement-timeline?${queryString}`);
}

/**
 * Get comment thread for a message
 */
export async function getMessageComments(
  messageId: number,
  params: {
    limit?: number;
    offset?: number;
    sort?: 'asc' | 'desc';
    include_replies?: boolean;
  } = {}
): Promise<CommentThreadResponse> {
  const queryString = buildQueryString(params);
  return fetchApi<CommentThreadResponse>(`/api/social-graph/messages/${messageId}/comments?${queryString}`);
}

/**
 * Translate a comment on-demand
 * Returns cached translation if already translated, otherwise translates and caches
 */
export interface TranslateCommentResponse {
  comment_id: number;
  original_content: string;
  translated_content: string | null;
  original_language: string;
  translation_method: string;
  cached: boolean;
}

export async function translateComment(commentId: number): Promise<TranslateCommentResponse> {
  return fetchApi<TranslateCommentResponse>(`/api/comments/${commentId}/translate`, {
    method: 'POST',
  });
}
