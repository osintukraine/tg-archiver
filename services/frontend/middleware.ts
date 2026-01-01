import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that require authentication
const protectedRoutes = [
  '/admin',
  '/settings',
  '/bookmarks',
];

// Routes that should redirect authenticated users
const authRoutes = [
  '/auth/login',
  '/auth/registration',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check for Kratos session cookie
  const hasSession = request.cookies.has('ory_kratos_session');

  // Protected routes: redirect to login if no session
  const isProtectedRoute = protectedRoutes.some(route => pathname.startsWith(route));
  if (isProtectedRoute && !hasSession) {
    const loginUrl = new URL('/auth/login', request.url);
    loginUrl.searchParams.set('returnTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Auth routes: redirect to home if already logged in
  const isAuthRoute = authRoutes.some(route => pathname.startsWith(route));
  if (isAuthRoute && hasSession) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/settings/:path*',
    '/bookmarks/:path*',
    '/auth/:path*',
  ],
};
