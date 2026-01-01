import { Metadata } from 'next';
import { SITE_NAME } from '@/lib/constants';

/**
 * Metadata for Search page
 */
export const metadata: Metadata = {
  title: `Search - ${SITE_NAME}`,
  description: 'Unified search across messages, events, RSS articles, and entities. Semantic search powered by AI embeddings for intelligent content discovery.',
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: `Search - ${SITE_NAME}`,
    description: 'Unified search across messages, events, RSS articles, and entities.',
  },
  twitter: {
    card: 'summary',
    title: `Search - ${SITE_NAME}`,
    description: 'Unified search across messages, events, RSS articles, and entities.',
  },
};

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
