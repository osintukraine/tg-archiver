// services/frontend-nextjs/app/about/page.tsx

import { Metadata } from 'next';
import AboutPageContent from './AboutPageContent';
import './about.css';
import { SITE_NAME } from '@/lib/constants';

const description = 'A production-grade platform for monitoring, archiving, and analyzing Telegram channels with AI-powered enrichment. Real-time collection, semantic search, and full data sovereignty.';

export const metadata: Metadata = {
  title: `About - ${SITE_NAME}`,
  description,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: `About - ${SITE_NAME}`,
    description,
  },
  twitter: {
    card: 'summary',
    title: `About - ${SITE_NAME}`,
    description,
  },
};

export default function AboutPage() {
  return <AboutPageContent />;
}
