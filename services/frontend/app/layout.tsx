import type { Metadata } from 'next'
import './globals.css'
import { HeaderNav } from '@/components/HeaderNav'
import { AuthProvider } from '@/contexts/AuthContext'
import { QueryProvider } from '@/lib/query-provider'
import { ImmersiveProvider } from '@/contexts/ImmersiveContext'
import { ContentWarningProvider } from '@/contexts/ContentWarningContext'
import { ImmersiveView } from '@/components/immersive'
import { ContentWarningModal } from '@/components/ContentWarningModal'
import { Footer } from '@/components/Footer'
import { AdminActionSidebar } from '@/components/admin/AdminActionSidebar'
import { SITE_NAME, SITE_DESCRIPTION } from '@/lib/constants'

// Base URL for canonical links and OpenGraph
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: ['OSINT', 'Telegram', 'Intelligence', 'Archive', 'Analysis'],
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    // Add /public/og-image.png (1200x630) for social sharing preview
    // images: [{ url: '/og-image.png', width: 1200, height: 630, alt: SITE_NAME }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    // images: ['/og-image.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg-base text-text-primary">
        <QueryProvider>
          <ContentWarningProvider>
            <AuthProvider>
              <ImmersiveProvider>
                <header className="glass sticky top-0 z-50 border-b border-border-subtle">
                  <div className="container mx-auto px-4 py-4">
                    <HeaderNav />
                  </div>
                </header>

                <main className="container mx-auto px-4 py-8">
                  {children}
                </main>

                <Footer />

                {/* Immersive mode overlay - renders when enabled */}
                <ImmersiveView />

                {/* Content warning modal - renders when consent needed */}
                <ContentWarningModal />

                {/* Admin action sidebar - renders on message pages for admins */}
                <AdminActionSidebar />
              </ImmersiveProvider>
            </AuthProvider>
          </ContentWarningProvider>
        </QueryProvider>
      </body>
    </html>
  )
}
