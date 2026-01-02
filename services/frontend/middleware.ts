import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware for Next.js routing
 *
 * Note: JWT tokens are stored in localStorage (client-side only).
 * Server-side middleware cannot access localStorage, so auth checks
 * happen on the client side via AuthContext and route guards.
 *
 * This middleware only handles non-auth concerns like headers.
 */
export function middleware(request: NextRequest) {
  // For now, just pass through all requests
  // Auth is handled client-side by AuthContext and route guards
  return NextResponse.next();
}

export const config = {
  // Limit middleware to specific paths if needed
  matcher: [],
};
