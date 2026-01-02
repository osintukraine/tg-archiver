/**
 * Channels Listing Page
 *
 * Displays all monitored channels organized by category.
 * Responsive grid layout with clickable cards leading to individual channel pages.
 */

import { Metadata } from 'next';
import Link from 'next/link';
import { getChannels } from '@/lib/api';
import type { Channel } from '@/lib/types';
import { SITE_NAME } from '@/lib/constants';

// Force dynamic rendering - channel list changes frequently
export const dynamic = 'force-dynamic';

const description = 'Browse all monitored Telegram channels. View archived messages organized by category.';

export const metadata: Metadata = {
  title: `Channels - ${SITE_NAME}`,
  description,
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: `Channels - ${SITE_NAME}`,
    description,
  },
  twitter: {
    card: 'summary',
    title: `Channels - ${SITE_NAME}`,
    description,
  },
};

// Category color mapping
const CATEGORY_COLORS: Record<string, string> = {
  blue: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  green: 'bg-green-500/10 text-green-400 border-green-500/30',
  purple: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  orange: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  red: 'bg-red-500/10 text-red-400 border-red-500/30',
  gray: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
};

export default async function ChannelsPage() {
  const channels = await getChannels();

  // Group channels by category
  const channelsByCategory = channels.reduce((acc, channel) => {
    const categoryName = channel.category?.name || 'uncategorized';
    if (!acc[categoryName]) {
      acc[categoryName] = {
        channels: [],
        color: channel.category?.color || 'gray',
      };
    }
    acc[categoryName].channels.push(channel);
    return acc;
  }, {} as Record<string, { channels: Channel[]; color: string }>);

  // Sort categories by channel count
  const sortedCategories = Object.entries(channelsByCategory)
    .sort((a, b) => b[1].channels.length - a[1].channels.length);

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <div className="border-b border-border-primary bg-bg-secondary/50">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-text-primary mb-2">
            Monitored Channels
          </h1>
          <p className="text-text-secondary">
            {channels.length} channels across {sortedCategories.length} categories
          </p>
        </div>
      </div>

      {/* Channel grid by category */}
      <div className="container mx-auto px-4 py-8">
        {sortedCategories.length === 0 ? (
          <div className="text-center py-12 text-text-secondary">
            No channels configured yet.
          </div>
        ) : (
          <div className="space-y-10">
            {sortedCategories.map(([categoryName, { channels: categoryChannels, color }]) => (
              <div key={categoryName}>
                {/* Category header */}
                <div className="flex items-center gap-3 mb-6">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium border ${CATEGORY_COLORS[color] || CATEGORY_COLORS.gray}`}>
                    {categoryName}
                  </span>
                  <span className="text-text-secondary">
                    {categoryChannels.length} channel{categoryChannels.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Channel cards grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {categoryChannels.map((channel) => (
                    <ChannelCard key={channel.id} channel={channel} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Individual Channel Card Component
 */
function ChannelCard({ channel }: { channel: Channel }) {
  // Generate gradient colors for avatar
  const getGradientColors = (name: string) => {
    const hue = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360;
    return `from-[hsl(${hue},70%,60%)] to-[hsl(${(hue + 60) % 360},70%,50%)]`;
  };

  const gradientColors = getGradientColors(channel.name || channel.username || 'channel');

  return (
    <Link
      href={`/channels/${channel.username}`}
      className="block bg-bg-secondary border border-border-primary rounded-lg p-3 sm:p-4 hover:border-accent-primary/50 transition-colors"
    >
      <div className="flex items-start gap-3 sm:gap-4">
        {/* Avatar */}
        <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${gradientColors} flex items-center justify-center text-white font-bold text-lg flex-shrink-0`}>
          {(channel.name || channel.username || 'C')[0].toUpperCase()}
        </div>

        {/* Channel Info */}
        <div className="flex-1 min-w-0">
          {/* Name and verification */}
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <h3 className="text-base font-semibold text-text-primary line-clamp-1">
              {channel.name || channel.username || `Channel ${channel.id}`}
            </h3>
            {channel.verified && (
              <span className="text-accent-primary flex-shrink-0" title="Verified">✓</span>
            )}
            {channel.scam && (
              <span className="text-red-500 text-xs px-2 py-0.5 bg-red-500/10 rounded flex-shrink-0">SCAM</span>
            )}
            {channel.fake && (
              <span className="text-orange-500 text-xs px-2 py-0.5 bg-orange-500/10 rounded flex-shrink-0">FAKE</span>
            )}
          </div>

          {/* Username */}
          {channel.username && (
            <p className="text-sm text-text-secondary mb-2">
              @{channel.username}
            </p>
          )}

          {/* Status */}
          <div className="flex items-center gap-3 text-xs">
            <span className={`font-medium ${channel.active ? 'text-green-400' : 'text-red-400'}`}>
              {channel.active ? 'Active' : 'Inactive'}
            </span>
            {channel.folder && (
              <span className="text-text-secondary">
                {channel.folder}
              </span>
            )}
          </div>

          {/* Description preview if available */}
          {channel.description && (
            <p className="text-xs text-text-secondary mt-2 line-clamp-2">
              {channel.description}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
