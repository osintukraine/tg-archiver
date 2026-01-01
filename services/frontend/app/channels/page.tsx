/**
 * Channels Listing Page
 *
 * Displays all monitored channels organized by country (Russia/Ukraine)
 * Two-column layout with clickable cards leading to individual channel pages
 */

import { Metadata } from 'next';
import Link from 'next/link';
import { getChannels } from '@/lib/api';
import type { Channel } from '@/lib/types';
import { SITE_NAME } from '@/lib/constants';

// Force dynamic rendering - channel list changes frequently
export const dynamic = 'force-dynamic';

const description = 'Browse all monitored Telegram channels organized by country. View archived messages from Russia and Ukraine sources.';

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

export default async function ChannelsPage() {
  const channels = await getChannels();

  // Split channels by country based on folder name
  const russiaChannels = channels.filter(ch =>
    ch.folder?.toLowerCase().includes('russia') ||
    ch.folder?.toLowerCase().includes('ru')
  );

  const ukraineChannels = channels.filter(ch =>
    ch.folder?.toLowerCase().includes('ukraine') ||
    ch.folder?.toLowerCase().includes('ua')
  );

  return (
    <div className="min-h-screen bg-bg-primary">
      {/* Header */}
      <div className="border-b border-border-primary bg-bg-secondary/50">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-text-primary mb-2">
            Monitored Channels
          </h1>
          <p className="text-text-secondary">
            {channels.length} channels • {russiaChannels.length} Russia • {ukraineChannels.length} Ukraine
          </p>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column: Russia */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-4xl">🇷🇺</span>
              <h2 className="text-2xl font-bold text-text-primary">
                Russia ({russiaChannels.length})
              </h2>
            </div>
            <div className="space-y-4">
              {russiaChannels.map((channel) => (
                <ChannelCard key={channel.id} channel={channel} />
              ))}
            </div>
          </div>

          {/* Right Column: Ukraine */}
          <div>
            <div className="flex items-center gap-3 mb-6">
              <span className="text-4xl">🇺🇦</span>
              <h2 className="text-2xl font-bold text-text-primary">
                Ukraine ({ukraineChannels.length})
              </h2>
            </div>
            <div className="space-y-4">
              {ukraineChannels.map((channel) => (
                <ChannelCard key={channel.id} channel={channel} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Individual Channel Card Component
 */
function ChannelCard({ channel }: { channel: Channel }) {
  // Generate gradient colors for avatar (same logic as channel detail page)
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
        <div className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br ${gradientColors} flex items-center justify-center text-white font-bold text-lg sm:text-xl flex-shrink-0`}>
          {(channel.name || channel.username || 'C')[0].toUpperCase()}
        </div>

        {/* Channel Info */}
        <div className="flex-1 min-w-0">
          {/* Name and verification */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-1">
            <h3 className="text-base sm:text-lg font-semibold text-text-primary line-clamp-1">
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

          {/* Metadata grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 sm:gap-2 text-xs">
            {/* Folder */}
            {channel.folder && (
              <div>
                <span className="text-text-secondary">Folder:</span>{' '}
                <span className="text-text-primary font-medium">{channel.folder}</span>
              </div>
            )}

            {/* Rule */}
            {channel.rule && (
              <div>
                <span className="text-text-secondary">Rule:</span>{' '}
                <span className={`font-medium ${
                  channel.rule === 'archive_all'
                    ? 'text-green-400'
                    : 'text-yellow-400'
                }`}>
                  {channel.rule === 'archive_all' ? 'Archive All' : 'Selective'}
                </span>
              </div>
            )}

            {/* Active status */}
            <div>
              <span className="text-text-secondary">Status:</span>{' '}
              <span className={`font-medium ${channel.active ? 'text-green-400' : 'text-red-400'}`}>
                {channel.active ? 'Active' : 'Inactive'}
              </span>
            </div>

            {/* Telegram ID */}
            <div>
              <span className="text-text-secondary">ID:</span>{' '}
              <span className="text-text-primary font-mono text-[10px]">
                {channel.telegram_id}
              </span>
            </div>
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
