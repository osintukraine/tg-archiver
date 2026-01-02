import { ProfileNav } from '@/components/profile/ProfileNav';
import { SITE_NAME } from '@/lib/constants';

/**
 * Profile Layout
 *
 * Shared layout for all profile pages with sidebar navigation.
 * Uses platform theme variables for consistent styling.
 */

export const metadata = {
  title: `Profile - ${SITE_NAME}`,
  description: 'Manage your account settings and API keys',
};

export default function ProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg-base">
      <div className="flex">
        <ProfileNav />
        <main className="flex-1 min-h-screen lg:ml-0">
          {/* Top padding for mobile menu button */}
          <div className="lg:hidden h-16" />

          {/* Main content */}
          <div className="p-6 lg:p-8 max-w-4xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
