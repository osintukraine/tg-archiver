// services/frontend/components/admin/AdminNav.tsx
'use client';

import { SidebarNav, NavSection } from '@/components/shared/SidebarNav';
import { ADMIN_MENU_SECTIONS } from '@/lib/admin/menuItems';
import { getAdminIcon } from '@/lib/admin/icons';

/**
 * AdminNav Component
 *
 * Admin sidebar navigation using shared SidebarNav.
 * Converts menu items to nav sections with icons.
 */

export function AdminNav() {
  // Convert menu sections to nav sections with resolved icons
  const sections: NavSection[] = ADMIN_MENU_SECTIONS.map(section => ({
    header: section.header,
    items: section.items.map(item => ({
      href: item.href,
      title: item.title,
      icon: getAdminIcon(item.icon),
      description: item.description,
      badge: item.badge,
    })),
  }));

  return (
    <SidebarNav
      sections={sections}
      title="Admin"
      subtitle="Archive Management"
      accentColor="blue"
      logoIcon={
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
      }
      backLink={{ href: '/', label: 'Back to Archive' }}
    />
  );
}
