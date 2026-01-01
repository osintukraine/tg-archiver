// services/frontend-nextjs/components/shared/SidebarNav.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * SidebarNav Component
 *
 * Shared sidebar navigation used by AdminNav and ProfileNav.
 * Supports grouped sections with headers, descriptions, and badges.
 */

export interface NavItem {
  href: string;
  title: string;
  icon: React.ReactNode;
  description?: string;
  badge?: string | number;
}

export interface NavSection {
  header: string;
  items: NavItem[];
}

export interface SidebarNavProps {
  sections: NavSection[];
  title: string;
  subtitle: string;
  accentColor: 'blue' | 'emerald' | 'purple';
  logoIcon: React.ReactNode;
  backLink?: { href: string; label: string };
}

const ACCENT_COLORS = {
  blue: {
    bg: 'bg-blue-600',
    activeBg: 'bg-blue-600/10',
    activeText: 'text-blue-600 dark:text-blue-400',
  },
  emerald: {
    bg: 'bg-emerald-600',
    activeBg: 'bg-emerald-600/10',
    activeText: 'text-emerald-600 dark:text-emerald-400',
  },
  purple: {
    bg: 'bg-purple-600',
    activeBg: 'bg-purple-600/10',
    activeText: 'text-purple-600 dark:text-purple-400',
  },
};

export function SidebarNav({
  sections,
  title,
  subtitle,
  accentColor,
  logoIcon,
  backLink,
}: SidebarNavProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const colors = ACCENT_COLORS[accentColor];

  const isActive = (href: string) => {
    // Exact match for root paths
    if (href === '/admin' || href === '/profile') {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile toggle button */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-bg-elevated rounded-lg border border-border-subtle shadow-lg"
        aria-label="Toggle navigation"
      >
        <svg className="w-6 h-6 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {mobileOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Sidebar */}
      <nav
        className={`
          fixed lg:sticky top-0 left-0 h-screen w-64 bg-bg-elevated border-r border-border-subtle
          transform transition-transform lg:transform-none z-40 flex flex-col
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Header */}
        <div className="p-6 border-b border-border-subtle">
          <Link href={sections[0]?.items[0]?.href || '/'} className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg ${colors.bg} flex items-center justify-center text-white`}>
              {logoIcon}
            </div>
            <div>
              <div className="font-semibold text-text-primary">{title}</div>
              <div className="text-xs text-text-tertiary">{subtitle}</div>
            </div>
          </Link>
        </div>

        {/* Navigation sections */}
        <div className="flex-1 overflow-y-auto p-4">
          {sections.map((section) => (
            <div key={section.header} className="mb-6">
              {/* Section Header */}
              <div className="px-3 py-2 text-xs font-semibold text-text-tertiary uppercase tracking-wider">
                {section.header}
              </div>

              {/* Section Items */}
              <div className="space-y-1">
                {section.items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={`
                        flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors
                        ${active
                          ? `${colors.activeBg} ${colors.activeText}`
                          : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary'
                        }
                      `}
                    >
                      <span className={active ? colors.activeText : ''}>
                        {item.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.title}</span>
                          {item.badge && (
                            <span className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded-full">
                              {item.badge}
                            </span>
                          )}
                        </div>
                        {item.description && (
                          <span className="text-xs text-text-tertiary block truncate">
                            {item.description}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        {backLink && (
          <div className="p-4 border-t border-border-subtle">
            <Link
              href={backLink.href}
              className="flex items-center gap-3 px-3 py-2 text-text-tertiary hover:text-text-secondary rounded-lg hover:bg-bg-secondary transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
              </svg>
              <span className="text-sm">{backLink.label}</span>
            </Link>
          </div>
        )}
      </nav>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
    </>
  );
}
