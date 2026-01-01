import { notFound } from 'next/navigation';
import { Metadata } from 'next';
import Link from 'next/link';
import { getMessage, getMediaUrl } from '@/lib/api';
import { getBaseUrl, getSiteName, getBestMediaForOG, truncateForOG } from '@/lib/metadata';
import { EnhancedPostCard } from '@/components/EnhancedPostCard';
import { PostNavigation } from '@/components/PostNavigation';
import { SimilarMessages } from '@/components/SimilarMessages';
import InlineMap from '@/components/map/InlineMap';

interface PageProps {
  params: {
    id: string;
  };
}

/**
 * Generate metadata for SEO and social sharing (runs server-side)
 *
 * Creates proper OpenGraph and Twitter Card meta tags for rich embeds
 * when sharing post URLs on social media platforms.
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const id = parseInt(params.id, 10);

  if (isNaN(id)) {
    return { title: 'Invalid Message ID' };
  }

  try {
    const message = await getMessage(id);
    const baseUrl = getBaseUrl();
    const pageUrl = `${baseUrl}/messages/${id}`;
    const siteName = getSiteName();

    // Get channel info
    const channelName = message.channel?.name || message.channel?.username || 'Unknown Channel';

    // Get content (prefer translated for better readability)
    const content = message.content_translated || message.content || '';
    const truncatedDesc = truncateForOG(content);

    // Build title (channel name + content preview)
    const title = `${channelName} - ${content.slice(0, 50)}${content.length > 50 ? '...' : ''}`;

    // Get media URLs with forceExternal=true for social crawlers
    const media = getBestMediaForOG(message.media_items || []);
    const imageUrl = media.imageUrl || getMediaUrl(message.first_media_url, true);

    // Build OpenGraph images array
    const ogImages = imageUrl ? [{
      url: imageUrl,
      width: 1200,
      height: 630,
      alt: `Media from ${channelName}`,
    }] : [];

    // Build OpenGraph videos array (dimensions omitted - platforms auto-detect)
    const ogVideos = media.videoUrl ? [{
      url: media.videoUrl,
      type: media.mimeType || 'video/mp4',
    }] : undefined;

    return {
      title,
      description: truncatedDesc,

      // Canonical URL for SEO
      alternates: {
        canonical: pageUrl,
      },

      openGraph: {
        type: 'article',
        url: pageUrl,
        siteName,
        title,
        description: truncatedDesc,
        images: ogImages,
        videos: ogVideos,
        publishedTime: message.telegram_date || message.created_at,
        modifiedTime: message.updated_at,
      },

      twitter: {
        card: media.videoUrl ? 'player' : 'summary_large_image',
        title,
        description: truncatedDesc,
        images: imageUrl ? [imageUrl] : [],
      },
    };
  } catch (error) {
    return {
      title: 'Message Not Found',
      description: 'The requested message could not be found.',
    };
  }
}

/**
 * Individual message page (Server Component)
 */
export default async function MessagePage({ params }: PageProps) {
  const id = parseInt(params.id, 10);

  if (isNaN(id)) {
    notFound();
  }

  let message;
  try {
    message = await getMessage(id);
  } catch (error) {
    notFound();
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back Navigation */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-text-secondary hover:text-text-primary mb-6 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        <span className="font-medium">Back to Browse</span>
      </Link>

      {/* Navigation - Top */}
      <div className="mb-6">
        <PostNavigation currentId={id} />
      </div>

      {/* Enhanced Message Card with 6 tabs */}
      <EnhancedPostCard
        message={message}
      />

      {/* Inline Map Preview - Show if message has location */}
      {message.location && message.location.latitude && message.location.longitude && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Location</h2>
          <InlineMap
            latitude={message.location.latitude}
            longitude={message.location.longitude}
            locationName={message.location.location_name ?? undefined}
            zoom={10}
          />
        </div>
      )}

      {/* Similar Messages */}
      <div className="mt-8">
        <SimilarMessages messageId={id} />
      </div>

      {/* Navigation - Bottom */}
      <div className="mt-6">
        <PostNavigation currentId={id} />
      </div>
    </div>
  );
}
