// services/frontend/lib/admin/menuItems.ts

/**
 * Admin Navigation Menu Items
 *
 * Centralized definition of admin sidebar navigation.
 * Grouped by sections with support for descriptions and badges.
 */

export interface AdminMenuItem {
  href: string;
  title: string;
  icon: string;
  description?: string;
  badge?: string | number;
}

export interface AdminMenuSection {
  header: string;
  order: number;
  items: AdminMenuItem[];
}

export const ADMIN_MENU_SECTIONS: AdminMenuSection[] = [
  {
    header: 'Overview',
    order: 0,
    items: [
      {
        href: '/admin',
        title: 'Dashboard',
        icon: 'dashboard',
        description: 'Platform health & metrics'
      },
    ],
  },
  {
    header: 'Content',
    order: 1,
    items: [
      { href: '/admin/channels', title: 'Channels', icon: 'channels', description: 'Telegram channel management' },
      { href: '/admin/import', title: 'Import Channels', icon: 'import', description: 'Bulk channel import from CSV' },
      { href: '/admin/media', title: 'Media Gallery', icon: 'media' },
      { href: '/admin/kanban', title: 'Message Board', icon: 'kanban', description: 'Engagement lanes' },
      { href: '/admin/messages', title: 'Message Browser', icon: 'messages', description: 'Table view with editing' },
      { href: '/admin/topics', title: 'Topics', icon: 'topics', description: 'Message classification' },
    ],
  },
  {
    header: 'Data',
    order: 2,
    items: [
      { href: '/admin/feeds', title: 'RSS Feeds', icon: 'rss' },
      { href: '/admin/export', title: 'Data Export', icon: 'export' },
    ],
  },
  {
    header: 'Processing',
    order: 3,
    items: [
      { href: '/admin/extraction', title: 'Entity Extraction', icon: 'extraction', description: 'Configurable patterns' },
    ],
  },
  {
    header: 'System',
    order: 4,
    items: [
      { href: '/admin/config', title: 'Platform Settings', icon: 'config', description: 'Runtime configuration' },
      { href: '/admin/stats', title: 'Statistics', icon: 'stats' },
      { href: '/admin/audit', title: 'Audit Log', icon: 'audit' },
    ],
  },
];

/**
 * Get flat list of all menu items (for search, etc.)
 */
export function getAllMenuItems(): AdminMenuItem[] {
  return ADMIN_MENU_SECTIONS.flatMap(section => section.items);
}

/**
 * Find menu item by href
 */
export function getMenuItemByHref(href: string): AdminMenuItem | undefined {
  return getAllMenuItems().find(item => item.href === href);
}
