'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useImmersive } from '@/contexts/ImmersiveContext';
import { useAuth } from '@/contexts/AuthContext';
import { SITE_NAME } from '@/lib/constants';

export function HeaderNav() {
  const pathname = usePathname();
  const [translationMode, setTranslationMode] = useState<'original' | 'translation'>('original');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // Immersive mode - must be called before early return
  const { toggleImmersive, isImmersive } = useImmersive();

  // Auth context for user menu
  const { user, isAuthenticated, isAdmin, isLoading: authLoading } = useAuth();

  // Load preferences from localStorage on mount (client-side only)
  useEffect(() => {
    setMounted(true);

    // Only access localStorage on client
    if (typeof window !== 'undefined') {
      // Load translation mode
      const savedTranslation = localStorage.getItem('translationMode');
      if (savedTranslation === 'translation' || savedTranslation === 'original') {
        setTranslationMode(savedTranslation);
      }

      // Load theme mode
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'dark' || savedTheme === 'light') {
        setTheme(savedTheme);
        // Apply theme to document
        if (savedTheme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
    }
  }, []);

  // Keyboard shortcut for immersive mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if not in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'i' || e.key === 'I') {
        toggleImmersive();
      }
      // Close mobile menu on Escape
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleImmersive, mobileMenuOpen]);

  // Close mobile menu when route changes
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Close mobile menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    };

    if (mobileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      // Prevent body scroll when menu is open
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  // Save to localStorage and dispatch event when changed
  const toggleTranslationMode = () => {
    const newMode = translationMode === 'original' ? 'translation' : 'original';
    setTranslationMode(newMode);

    if (typeof window !== 'undefined') {
      localStorage.setItem('translationMode', newMode);
      // Dispatch custom event so PostCard components can react
      window.dispatchEvent(new CustomEvent('translationModeChange', { detail: newMode }));
    }
  };

  // Toggle theme between light and dark
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);

    if (typeof window !== 'undefined') {
      localStorage.setItem('theme', newTheme);
      // Apply theme to document
      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      // Dispatch custom event so MapView can react
      window.dispatchEvent(new CustomEvent('themeChange', { detail: newTheme }));
    }
  };

  // Prevent hydration mismatch by not rendering until mounted
  if (!mounted) {
    return (
      <div className="flex items-center justify-between">
        <Link href="/" className="text-2xl font-bold text-accent-primary hover:opacity-80 transition-opacity">
          {SITE_NAME}
        </Link>
        <div className="w-96 h-10" /> {/* Placeholder to prevent layout shift */}
      </div>
    );
  }

  // Navigation items for reuse
  const navItems = [
    { href: '/', label: 'Browse', match: (p: string) => p === '/' },
    { href: '/channels', label: 'Channels', match: (p: string) => p === '/channels' || p?.startsWith('/channels/') },
    { href: '/unified', label: 'News', match: (p: string) => p === '/unified' },
    { href: '/events', label: 'Events', match: (p: string) => p === '/events' || p?.startsWith('/events/') },
    { href: '/map', label: 'Map', match: (p: string) => p === '/map' },
    { href: '/search', label: 'Search', match: (p: string) => p === '/search' || p?.startsWith('/entities/') },
    { href: '/about', label: 'About', match: (p: string) => p === '/about' },
  ];

  return (
    <div className="flex items-center justify-between">
      {/* Left: Logo/Title */}
      <Link href="/" className="text-xl sm:text-2xl font-bold text-accent-primary hover:opacity-80 transition-opacity">
        {SITE_NAME}
      </Link>

      {/* Center: Desktop Navigation Links */}
      <nav className="hidden md:flex items-center gap-4 lg:gap-6">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`text-sm font-medium transition-colors ${
              item.match(pathname || '')
                ? 'text-accent-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {item.label}
          </Link>
        ))}

        {/* Divider before user menu */}
        {isAuthenticated && (
          <span className="text-border-subtle">|</span>
        )}

        {/* Admin link - only for admins */}
        {isAuthenticated && isAdmin() && (
          <Link
            href="/admin"
            className={`text-sm font-medium transition-colors ${
              pathname?.startsWith('/admin')
                ? 'text-red-500'
                : 'text-red-400 hover:text-red-500'
            }`}
          >
            Admin
          </Link>
        )}

        {/* Profile link - for any logged in user */}
        {isAuthenticated && (
          <Link
            href="/profile"
            className={`text-sm font-medium transition-colors ${
              pathname?.startsWith('/profile')
                ? 'text-accent-primary'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            Profile
          </Link>
        )}

        {/* Login link - for unauthenticated users (only show when auth check is complete) */}
        {!authLoading && !isAuthenticated && (
          <Link
            href="/auth/login"
            className="text-sm font-medium text-emerald-500 hover:text-emerald-400 transition-colors"
          >
            Sign In
          </Link>
        )}
      </nav>

      {/* Right: Toggle Buttons + Mobile Menu Button */}
      <div className="flex items-center gap-1 sm:gap-2 md:gap-3">
        {/* Immersive Mode Toggle - hidden on very small screens */}
        <button
          onClick={toggleImmersive}
          className={`hidden sm:flex px-2 sm:px-3 md:px-4 py-2 border rounded-lg text-sm font-medium transition-colors items-center gap-1 sm:gap-2 ${
            isImmersive
              ? 'bg-cyan-500 text-white border-cyan-500'
              : 'bg-bg-secondary hover:bg-bg-tertiary border-border'
          }`}
          title="Toggle Immersive Mode (I)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span className="hidden lg:inline">Immersive</span>
        </button>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 sm:px-3 sm:py-2 bg-bg-secondary hover:bg-bg-tertiary border border-border rounded-lg text-sm font-medium transition-colors flex items-center gap-1 sm:gap-2"
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
              <span className="hidden lg:inline">Dark</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <span className="hidden lg:inline">Light</span>
            </>
          )}
        </button>

        {/* Translation Toggle */}
        <button
          onClick={toggleTranslationMode}
          className="p-2 sm:px-3 sm:py-2 bg-bg-secondary hover:bg-bg-tertiary border border-border rounded-lg text-sm font-medium transition-colors flex items-center gap-1 sm:gap-2"
          title={`Switch to ${translationMode === 'original' ? 'translation' : 'original'}-first mode`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
          </svg>
          <span className="hidden lg:inline">{translationMode === 'original' ? 'Original' : 'Translated'}</span>
        </button>

        {/* Mobile Menu Button - visible only on mobile */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="md:hidden p-2 bg-bg-secondary hover:bg-bg-tertiary border border-border rounded-lg transition-colors"
          aria-label="Toggle navigation menu"
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="md:hidden"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100vh',
            zIndex: 9999
          }}
        >
          {/* Backdrop - fully opaque dark overlay */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.85)',
              zIndex: 1
            }}
            onClick={() => setMobileMenuOpen(false)}
          />

          {/* Menu Panel - fully opaque solid background */}
          <div
            ref={mobileMenuRef}
            className="overflow-y-auto"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: '288px',
              maxWidth: '85vw',
              height: '100vh',
              backgroundColor: theme === 'dark' ? '#111827' : '#ffffff',
              borderLeft: theme === 'dark' ? '1px solid #374151' : '1px solid #e5e7eb',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              zIndex: 2
            }}
          >
            {/* Menu Header */}
            <div
              className="flex items-center justify-between p-4"
              style={{
                backgroundColor: theme === 'dark' ? '#1f2937' : '#f9fafb',
                borderBottom: theme === 'dark' ? '1px solid #374151' : '1px solid #e5e7eb'
              }}
            >
              <span
                className="font-semibold"
                style={{ color: theme === 'dark' ? '#ffffff' : '#111827' }}
              >Menu</span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-2 rounded-lg transition-colors"
                style={{
                  backgroundColor: theme === 'dark' ? '#374151' : '#e5e7eb',
                  color: theme === 'dark' ? '#d1d5db' : '#4b5563'
                }}
                aria-label="Close menu"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Navigation Links */}
            <nav
              className="p-4 space-y-1"
              style={{ backgroundColor: theme === 'dark' ? '#111827' : '#ffffff' }}
            >
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-4 py-3 rounded-lg text-base font-medium transition-colors"
                  style={{
                    backgroundColor: item.match(pathname || '')
                      ? (theme === 'dark' ? '#312e81' : '#e0e7ff')
                      : (theme === 'dark' ? '#111827' : '#ffffff'),
                    color: item.match(pathname || '')
                      ? (theme === 'dark' ? '#818cf8' : '#4f46e5')
                      : (theme === 'dark' ? '#d1d5db' : '#4b5563')
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Account Section */}
            <div
              className="mx-4 border-t"
              style={{ borderColor: theme === 'dark' ? '#374151' : '#e5e7eb' }}
            />
            <div
              className="p-4 space-y-1"
              style={{ backgroundColor: theme === 'dark' ? '#111827' : '#ffffff' }}
            >
              <p
                className="text-xs uppercase tracking-wider px-2 mb-2"
                style={{ color: theme === 'dark' ? '#9ca3af' : '#6b7280' }}
              >Account</p>

              {/* Admin link - only for admins */}
              {isAuthenticated && isAdmin() && (
                <Link
                  href="/admin"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-4 py-3 rounded-lg text-base font-medium transition-colors"
                  style={{
                    backgroundColor: pathname?.startsWith('/admin')
                      ? (theme === 'dark' ? '#7f1d1d' : '#fee2e2')
                      : (theme === 'dark' ? '#111827' : '#ffffff'),
                    color: pathname?.startsWith('/admin')
                      ? (theme === 'dark' ? '#f87171' : '#dc2626')
                      : (theme === 'dark' ? '#f87171' : '#dc2626')
                  }}
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Admin Dashboard
                  </span>
                </Link>
              )}

              {/* Profile link - for any logged in user */}
              {isAuthenticated && (
                <Link
                  href="/profile"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-4 py-3 rounded-lg text-base font-medium transition-colors"
                  style={{
                    backgroundColor: pathname?.startsWith('/profile')
                      ? (theme === 'dark' ? '#312e81' : '#e0e7ff')
                      : (theme === 'dark' ? '#111827' : '#ffffff'),
                    color: pathname?.startsWith('/profile')
                      ? (theme === 'dark' ? '#818cf8' : '#4f46e5')
                      : (theme === 'dark' ? '#d1d5db' : '#4b5563')
                  }}
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    {user?.email || 'Profile'}
                  </span>
                </Link>
              )}

              {/* Login link - for unauthenticated users (only show when auth check is complete) */}
              {!authLoading && !isAuthenticated && (
                <Link
                  href="/auth/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-4 py-3 rounded-lg text-base font-medium transition-colors"
                  style={{
                    backgroundColor: theme === 'dark' ? '#064e3b' : '#d1fae5',
                    color: theme === 'dark' ? '#34d399' : '#059669'
                  }}
                >
                  <span className="flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                    </svg>
                    Sign In
                  </span>
                </Link>
              )}
            </div>

            {/* Divider */}
            <div
              className="mx-4 border-t"
              style={{ borderColor: theme === 'dark' ? '#374151' : '#e5e7eb' }}
            />

            {/* Mobile-only controls */}
            <div
              className="p-4 space-y-3"
              style={{ backgroundColor: theme === 'dark' ? '#111827' : '#ffffff' }}
            >
              <p
                className="text-xs uppercase tracking-wider px-2"
                style={{ color: theme === 'dark' ? '#9ca3af' : '#6b7280' }}
              >Settings</p>

              {/* Immersive Mode - shown in mobile menu */}
              <button
                onClick={() => {
                  toggleImmersive();
                  setMobileMenuOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors"
                style={{
                  backgroundColor: isImmersive
                    ? (theme === 'dark' ? '#164e63' : '#cffafe')
                    : (theme === 'dark' ? '#1f2937' : '#f3f4f6'),
                  color: isImmersive
                    ? (theme === 'dark' ? '#22d3ee' : '#0891b2')
                    : (theme === 'dark' ? '#d1d5db' : '#4b5563')
                }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Immersive Mode {isImmersive && '(On)'}
              </button>

              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors"
                style={{
                  backgroundColor: theme === 'dark' ? '#1f2937' : '#f3f4f6',
                  color: theme === 'dark' ? '#d1d5db' : '#4b5563'
                }}
              >
                {theme === 'light' ? (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                    Switch to Dark Mode
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    Switch to Light Mode
                  </>
                )}
              </button>

              {/* Translation Toggle */}
              <button
                onClick={toggleTranslationMode}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors"
                style={{
                  backgroundColor: theme === 'dark' ? '#1f2937' : '#f3f4f6',
                  color: theme === 'dark' ? '#d1d5db' : '#4b5563'
                }}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                </svg>
                {translationMode === 'original' ? 'Show Translations First' : 'Show Original First'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
