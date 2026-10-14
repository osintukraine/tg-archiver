/**
 * Post-login redirect target: only same-site paths.
 * "//evil.com", "/\evil.com" and "https://..." would be open redirects.
 */
export function safeReturnTo(requested: string | null): string {
  if (!requested || !requested.startsWith('/') || /^\/[\\/]/.test(requested)) return '/';
  return requested;
}
