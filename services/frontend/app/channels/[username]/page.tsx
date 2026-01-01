import { Metadata } from 'next';
import { searchMessages, getChannelByUsername } from '@/lib/api';
import { MessageList } from '@/components/MessageList';
import { Pagination } from '@/components/Pagination';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getBaseUrl, getSiteName, truncateForOG } from '@/lib/metadata';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ChannelPageProps {
  params: {
    username: string;
  };
  searchParams: {
    page?: string;
    page_size?: string;
  };
}

/**
 * Generate metadata for channel pages (OpenGraph + Twitter Cards)
 */
export async function generateMetadata({ params }: ChannelPageProps): Promise<Metadata> {
  const { username } = params;

  try {
    const channel = await getChannelByUsername(username);
    const baseUrl = getBaseUrl();
    const pageUrl = `${baseUrl}/channels/${username}`;
    const siteName = getSiteName();

    const channelName = channel.name || channel.username || username;
    const title = `${channelName} - Telegram Channel`;
    const description = channel.description
      ? truncateForOG(channel.description)
      : `View archived messages from ${channelName} on ${siteName}`;

    return {
      title,
      description,
      alternates: {
        canonical: pageUrl,
      },
      openGraph: {
        type: 'profile',
        url: pageUrl,
        siteName,
        title,
        description,
        // Channels don't have images, so we rely on site default
      },
      twitter: {
        card: 'summary',
        title,
        description,
      },
    };
  } catch {
    return {
      title: 'Channel Not Found',
      description: 'The requested channel could not be found.',
    };
  }
}

export default async function ChannelPage({ params, searchParams }: ChannelPageProps) {
  const { username } = params;

  // Fetch channel info
  let channel;
  try {
    channel = await getChannelByUsername(username);
  } catch (error) {
    notFound();
  }

  // Parse pagination params
  const page = searchParams.page ? parseInt(searchParams.page) : 1;
  const pageSize = searchParams.page_size ? parseInt(searchParams.page_size) : 20;

  // Fetch messages for this channel
  const result = await searchMessages({
    channel_username: username,
    page,
    page_size: pageSize,
  });

  return (
    <div className="max-w-7xl mx-auto">
      {/* Back Navigation */}
      <Link
        href="/channels"
        className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary mb-6 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        <span className="font-medium">Back to Channels</span>
      </Link>

      {/* Channel Header */}
      <div className="glass p-8 rounded-xl mb-8">
        <div className="flex items-start gap-4">
          {/* Channel Icon/Avatar Placeholder */}
          <div className="w-16 h-16 bg-gradient-to-br from-primary to-accent-secondary rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-2xl font-bold text-white">
              {channel.name?.[0]?.toUpperCase() || channel.username?.[0]?.toUpperCase() || '?'}
            </span>
          </div>

          {/* Channel Info */}
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold">{channel.name || channel.username}</h1>
              {channel.verified && (
                <svg className="w-6 h-6 text-primary" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
              {channel.scam && (
                <span className="px-2 py-1 bg-red-500/10 text-red-500 text-xs font-medium rounded">
                  SCAM
                </span>
              )}
            </div>

            {channel.username && (
              <p className="text-text-secondary mb-3">
                @{channel.username}
              </p>
            )}

            {channel.description && (
              <p className="text-text-secondary leading-relaxed">
                {channel.description}
              </p>
            )}

            {/* Channel Metadata */}
            <div className="flex flex-wrap gap-4 mt-4 text-sm">
              {channel.folder && (
                <div className="flex items-center gap-2 text-text-tertiary">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span>Folder: {channel.folder}</span>
                </div>
              )}
              {channel.rule && (
                <div className="flex items-center gap-2 text-text-tertiary">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                  </svg>
                  <span>Rule: {channel.rule.replace('_', ' ')}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-text-tertiary">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                <span>{result.total.toLocaleString()} messages archived</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-4">Recent Messages</h2>

        {result.items.length === 0 ? (
          <div className="glass p-12 rounded-xl text-center">
            <p className="text-text-secondary text-lg">
              No messages archived yet from this channel.
            </p>
            <p className="text-text-tertiary text-sm mt-2">
              Messages will appear here once the listener starts archiving from this channel.
            </p>
          </div>
        ) : (
          <MessageList
            messages={result.items.filter((message) => {
              // Filter out phantom messages
              const hasContent = message.content && message.content.trim().length > 0;
              const hasMedia = message.media_urls && message.media_urls.length > 0;
              return hasContent || hasMedia;
            })}
          />
        )}
      </div>

      {/* Pagination */}
      {result.total_pages > 1 && (
        <div className="mt-8">
          <Pagination
            currentPage={result.page}
            totalPages={result.total_pages}
            hasNext={result.has_next}
            hasPrev={result.has_prev}
          />
        </div>
      )}
    </div>
  );
}
