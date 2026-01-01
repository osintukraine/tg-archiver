import { Metadata } from 'next';
import { searchMessages } from '@/lib/api';
import { BrowseMessages } from '@/components/BrowseMessages';
import { SearchFilters } from '@/components/SearchFilters';
import { SITE_NAME, SITE_DESCRIPTION } from '@/lib/constants';

// Force dynamic rendering - don't cache this page
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: `Browse Messages - ${SITE_NAME}`,
  description: SITE_DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: `Browse Messages - ${SITE_NAME}`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary',
    title: `Browse Messages - ${SITE_NAME}`,
    description: SITE_DESCRIPTION,
  },
};

interface HomePageProps {
  searchParams: {
    q?: string;
    channel_username?: string;
    channel_folder?: string;
    has_media?: string;
    media_type?: string;
    topic?: string;
    is_spam?: string;
    osint_min?: string;
    osint_max?: string;
    page?: string;
    page_size?: string;
  };
}

export default async function HomePage({ searchParams }: HomePageProps) {
  // Parse search parameters
  const params = {
    q: searchParams.q,
    channel_username: searchParams.channel_username,
    channel_folder: searchParams.channel_folder,
    has_media: searchParams.has_media === 'true' ? true : undefined,
    media_type: searchParams.media_type,
    topic: searchParams.topic,
    is_spam: searchParams.is_spam === 'true' ? true : searchParams.is_spam === 'false' ? false : undefined,
    osint_min: searchParams.osint_min ? parseInt(searchParams.osint_min) : undefined,
    osint_max: searchParams.osint_max ? parseInt(searchParams.osint_max) : undefined,
    page: searchParams.page ? parseInt(searchParams.page) : 1,
    page_size: searchParams.page_size ? parseInt(searchParams.page_size) : 20,
  };

  // Fetch messages from API
  const result = await searchMessages(params);

  // Filter out phantom messages (no content AND no media)
  const filteredMessages = result.items.filter((message) => {
    const hasContent = message.content && message.content.trim().length > 0;
    const hasMedia = message.media_urls && message.media_urls.length > 0;
    return hasContent || hasMedia;
  });

  return (
    <div className="max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Browse Messages</h1>
        <p className="text-text-secondary">
          Search and filter archived Telegram messages
        </p>
      </div>

      {/* Search and Filters */}
      <SearchFilters initialParams={params} />

      {/* Browse Messages with Density Controls */}
      <BrowseMessages
        messages={filteredMessages}
        currentPage={result.page}
        totalPages={result.total_pages}
        hasNext={result.has_next}
        hasPrev={result.has_prev}
        total={result.total}
      />
    </div>
  );
}
