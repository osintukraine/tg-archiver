import { AdminNav } from '@/components/admin/AdminNav';
import { AdminAuthGuard } from '@/components/admin/AdminAuthGuard';
import { SITE_NAME } from '@/lib/constants';

/**
 * Admin Layout
 *
 * Shared layout for all admin pages with sidebar navigation.
 * Uses platform theme variables for consistent styling.
 *
 * IMPORTANT: Protected by AdminAuthGuard - only admin users can access.
 */

export const metadata = {
  title: `Admin - ${SITE_NAME}`,
  description: `Administration console for ${SITE_NAME}`,
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg-base">
      <div className="flex">
        <AdminNav />
        <main className="flex-1 min-h-screen lg:ml-0">
          {/* Top padding for mobile menu button */}
          <div className="lg:hidden h-16" />

          {/* Main content - wrapped with auth guard */}
          <div className="p-6 lg:p-8 max-w-7xl mx-auto">
            <AdminAuthGuard>
              {children}
            </AdminAuthGuard>
          </div>
        </main>
      </div>
    </div>
  );
}
