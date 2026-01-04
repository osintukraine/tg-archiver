'use client';

/**
 * PostCard Component
 *
 * Displays message content with three density modes:
 * - compact: 120px height, 2-line preview (for timeline scrolling)
 * - detailed: ~400px height, full content (for analysis)
 * - immersive: Full viewport modal (for deep dive)
 *
 * Shows all available data based on user-controlled view density.
 */

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { getMediaUrl } from '@/lib/api';
import type { PostCardProps, MessageTag, MediaItem } from '@/lib/types';

// Helper type for media items with resolved URLs
interface ResolvedMediaItem {
  url: string;
  mime_type: string;
  media_type: 'image' | 'video' | 'audio' | 'document';
}
import EngagementBar from './EngagementBar';
import SocialGraphIndicator from './SocialGraphIndicator';
import { formatNumber, calculateViralityRatio, getViralityColor } from '@/lib/utils';
import { MediaLightbox } from './MediaLightbox';
import { ForwardContext } from './ForwardContext';

// YouTube URL patterns
const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:\S*)?/g;
const URL_REGEX = /(https?:\/\/[^\s<]+[^\s<.,;:!?"')\]])/g;

// Extract YouTube video ID from URL
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Component to render content with clickable links and YouTube embeds
function FormattedContent({
  content,
  className = '',
  embedYouTube = true
}: {
  content: string;
  className?: string;
  embedYouTube?: boolean;
}) {
  if (!content) return <span className={className}>No content</span>;

  // Find all YouTube URLs for embedding
  const youtubeMatches: { id: string; url: string }[] = [];
  if (embedYouTube) {
    let match;
    const ytRegex = new RegExp(YOUTUBE_REGEX.source, 'g');
    while ((match = ytRegex.exec(content)) !== null) {
      const id = extractYouTubeId(match[0]);
      if (id && !youtubeMatches.find(m => m.id === id)) {
        youtubeMatches.push({ id, url: match[0] });
      }
    }
  }

  // Split content by URLs and render with links
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let partKey = 0;

  const urlRegex = new RegExp(URL_REGEX.source, 'g');
  let urlMatch;

  while ((urlMatch = urlRegex.exec(content)) !== null) {
    // Add text before the URL
    if (urlMatch.index > lastIndex) {
      parts.push(
        <span key={partKey++}>{content.slice(lastIndex, urlMatch.index)}</span>
      );
    }

    const url = urlMatch[0];
    const isYouTube = extractYouTubeId(url) !== null;

    // Add the clickable link
    parts.push(
      <a
        key={partKey++}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`text-accent-primary hover:underline ${isYouTube ? 'inline-flex items-center gap-1' : ''}`}
        onClick={(e) => e.stopPropagation()}
        title={isYouTube ? 'Open YouTube video in new tab' : 'Open link in new tab'}
      >
        {isYouTube && (
          <svg className="w-4 h-4 text-red-500 inline" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
          </svg>
        )}
        {url}
      </a>
    );

    lastIndex = urlMatch.index + url.length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push(<span key={partKey++}>{content.slice(lastIndex)}</span>);
  }

  return (
    <div className={className}>
      <div className="whitespace-pre-wrap">{parts.length > 0 ? parts : content}</div>

      {/* YouTube Embeds */}
      {embedYouTube && youtubeMatches.length > 0 && (
        <div className="mt-3 space-y-3">
          {youtubeMatches.map(({ id }) => (
            <div
              key={id}
              className="relative w-full rounded-lg overflow-hidden bg-black"
              style={{ paddingBottom: '56.25%' }} // 16:9 aspect ratio
            >
              <iframe
                className="absolute inset-0 w-full h-full"
                src={`https://www.youtube-nocookie.com/embed/${id}`}
                title="YouTube video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Helper to get country info from channel folder
function getCountryInfo(folder: string | null | undefined): { flag: string; label: string; color: string } | null {
  if (!folder) return null;

  const folderUpper = folder.toUpperCase();

  if (folderUpper.includes('-UA')) {
    return { flag: '🇺🇦', label: 'UA', color: 'text-blue-400' };
  }

  if (folderUpper.includes('-RU')) {
    return { flag: '🇷🇺', label: 'RU', color: 'text-red-400' };
  }

  return null;
}

// Helper to get country border class for hover effect
function getCountryBorderClass(folder: string | null | undefined): string {
  if (!folder) return 'country-border-unaffiliated';

  const folderUpper = folder.toUpperCase();

  if (folderUpper.includes('-UA')) {
    return 'country-border-ua';
  }

  if (folderUpper.includes('-RU')) {
    return 'country-border-ru';
  }

  return 'country-border-unaffiliated';
}

// Helper to format entities for display
function formatEntities(entities: Record<string, any> | null | undefined): string[] {
  if (!entities) return [];

  const formatted: string[] = [];

  // Extract hashtags
  if (entities.hashtags && Array.isArray(entities.hashtags)) {
    formatted.push(...entities.hashtags.map((tag: string) => `#${tag}`));
  }

  // Extract mentions (check if @ is already included)
  if (entities.mentions && Array.isArray(entities.mentions)) {
    formatted.push(...entities.mentions.map((mention: string) =>
      mention.startsWith('@') ? mention : `@${mention}`
    ));
  }

  // Extract locations (if GPS coordinates)
  if (entities.locations && Array.isArray(entities.locations)) {
    formatted.push(...entities.locations.map((loc: any) => `📍 ${loc.name || 'Location'}`));
  }

  return formatted.slice(0, 5); // Limit to first 5
}

// Helper to get tag type styling
function getTagTypeStyle(tagType: string): { color: string; bgColor: string; icon: string } {
  switch (tagType) {
    case 'keywords':
      return { color: 'text-blue-300', bgColor: 'bg-blue-500/15', icon: '🔑' };
    case 'topics':
      return { color: 'text-green-300', bgColor: 'bg-green-500/15', icon: '📂' };
    case 'entities':
      return { color: 'text-orange-300', bgColor: 'bg-orange-500/15', icon: '🏷️' };
    case 'emotions':
      return { color: 'text-pink-300', bgColor: 'bg-pink-500/15', icon: '💭' };
    case 'urgency':
      return { color: 'text-amber-300', bgColor: 'bg-amber-500/15', icon: '⚡' };
    default:
      return { color: 'text-gray-300', bgColor: 'bg-gray-500/15', icon: '📌' };
  }
}

// Helper to format tags grouped by type
function formatTagsByType(tags: MessageTag[] | undefined): Record<string, MessageTag[]> {
  if (!tags || tags.length === 0) return {};

  const grouped: Record<string, MessageTag[]> = {};
  tags.forEach(tag => {
    if (!grouped[tag.tag_type]) {
      grouped[tag.tag_type] = [];
    }
    grouped[tag.tag_type].push(tag);
  });

  // Sort each group by confidence (highest first)
  Object.keys(grouped).forEach(type => {
    grouped[type].sort((a, b) => b.confidence - a.confidence);
  });

  return grouped;
}

export function PostCard({
  message,
  channel,
  density = 'detailed',
  onDensityChange,
  onClick,
}: PostCardProps) {
  const [showTranslation, setShowTranslation] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxInitialIndex, setLightboxInitialIndex] = useState(0);

  // Listen for global translation mode changes
  useEffect(() => {
    // Load initial preference from localStorage (client-side only)
    if (typeof window !== 'undefined') {
      const translationMode = localStorage.getItem('translationMode');
      setShowTranslation(translationMode === 'translation');

      // Listen for changes
      const handleModeChange = (event: CustomEvent<string>) => {
        setShowTranslation(event.detail === 'translation');
      };

      window.addEventListener('translationModeChange', handleModeChange as EventListener);
      return () => {
        window.removeEventListener('translationModeChange', handleModeChange as EventListener);
      };
    }
  }, []);

  // Only format entities for compact and immersive modes (not used in detailed view)
  const entities = density === 'detailed' ? [] : formatEntities(message.entities);
  // eslint-disable-next-line
  const currentDensity: any = density; // Use any to bypass TypeScript flow analysis narrowing

  // Media Architecture:
  // - message.media_items: Structured array with {url, mime_type, media_type} from API
  // - media_type is derived from mime_type server-side (image, video, audio, document)
  // - mime_type is used for HTML5 <source type="..."> for proper browser handling
  //
  // Build resolved media items with full URLs
  const mediaItems: ResolvedMediaItem[] = (message.media_items || []).map(item => ({
    url: getMediaUrl(item.url) || '',
    mime_type: item.mime_type,
    media_type: item.media_type as 'image' | 'video' | 'audio' | 'document',
  })).filter(item => item.url);

  // Legacy support: fall back to media_urls if media_items not available
  const legacyMediaUrls = message.media_urls?.map(s3Key => getMediaUrl(s3Key)).filter(Boolean) as string[] || [];
  const mediaUrls = mediaItems.length > 0 ? mediaItems.map(m => m.url) : legacyMediaUrls;

  const mediaUrl = getMediaUrl(message.first_media_url);  // For backwards compatibility
  const hasMultipleMedia = mediaItems.length > 1;

  // Use actual media availability (not just media_type presence)
  const hasMedia = mediaItems.length > 0 || legacyMediaUrls.length > 0;

  // Helper to get media type (uses media_items if available, falls back to extension detection)
  const getMediaType = (index: number): 'image' | 'video' | 'audio' | 'document' => {
    if (mediaItems[index]) {
      return mediaItems[index].media_type;
    }
    // Fallback to extension detection for legacy support
    const url = mediaUrls[index] || '';
    const ext = url.toLowerCase().split('.').pop() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v', 'flv'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) return 'audio';
    return 'document';
  };

  // Helper to get mime type for <source> element
  const getMimeType = (index: number): string => {
    return mediaItems[index]?.mime_type || 'application/octet-stream';
  };

  // URL-based helper for MediaLightbox compatibility (can't pass media_items to it yet)
  const getMediaTypeFromUrl = (url: string): 'image' | 'video' | 'document' => {
    // First try to find the URL in our mediaItems array to get accurate type
    const matchingItem = mediaItems.find(item => item.url === url);
    if (matchingItem) {
      // MediaLightbox doesn't support 'audio' type, map to document
      return matchingItem.media_type === 'audio' ? 'document' : matchingItem.media_type;
    }
    // Fallback to extension-based detection
    const ext = url.toLowerCase().split('.').pop() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v', 'flv'].includes(ext)) return 'video';
    return 'document';
  };

  // Check if this is a phantom message (no content AND no media)
  const hasContent = message.content && message.content.trim().length > 0;
  const isPhantomMessage = !hasContent && !hasMedia;

  // Toggle between original and translated content
  const displayContent = showTranslation && message.content_translated
    ? message.content_translated
    : message.content;

  // Compact mode: Enhanced browse view with thumbnails
  if (currentDensity === 'compact') {
    const firstMediaUrl = mediaUrls[0];

    const countryBorderClass = getCountryBorderClass(channel?.folder);

    return (
      <div
        className={`glass p-2 sm:p-3 rounded-lg cursor-pointer ${countryBorderClass} transition-colors duration-200 flex gap-2 sm:gap-3`}
        onClick={() => {
          if (onDensityChange) onDensityChange('detailed');
          onClick?.();
        }}
        style={{ minHeight: '100px' }}
      >
        {/* Media Thumbnail - Left side */}
        {hasMedia && firstMediaUrl && (
          <div className="flex-shrink-0 w-20 h-16 sm:w-32 sm:h-24 rounded-lg overflow-hidden bg-bg-secondary relative group">
            {(() => {
              const fileType = getMediaType(0);

              if (fileType === 'image') {
                return (
                  <img
                    src={firstMediaUrl}
                    alt="Media preview"
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                );
              }

              if (fileType === 'video') {
                return (
                  <div className="relative w-full h-full">
                    <video
                      className="w-full h-full object-cover"
                      preload="metadata"
                      muted
                      playsInline
                    >
                      <source src={firstMediaUrl} type={getMimeType(0)} />
                    </video>
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30" title="Video content">
                      <svg
                        className="w-8 h-8 text-white"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                      </svg>
                    </div>
                  </div>
                );
              }

              if (fileType === 'audio') {
                return (
                  <div className="w-full h-full flex items-center justify-center bg-bg-tertiary" title="Audio content">
                    <svg className="w-10 h-10 text-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                    </svg>
                  </div>
                );
              }

              // Document fallback - show icon
              return (
                <div className="w-full h-full flex items-center justify-center" title="Document attachment">
                  <svg
                    className="w-12 h-12 text-text-tertiary"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                </div>
              );
            })()}
            {hasMultipleMedia && (
              <span
                className="absolute bottom-1 right-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded cursor-help"
                title={`This message contains ${mediaUrls.length} media files`}
              >
                +{mediaUrls.length - 1}
              </span>
            )}
          </div>
        )}

        {/* Content - Right side */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header Row: Channel (left) + Classification Badges + Review Status (right) */}
          <div className="flex items-center justify-between mb-1 gap-2">
            {/* Left: Channel name + country flag */}
            <div className="flex items-center gap-2 min-w-0 flex-shrink">
              {channel && (
                <span className="text-text-secondary text-xs font-medium truncate">
                  {channel.verified && <span title="Verified channel">✓ </span>}
                  @{channel.username || channel.name || `channel_${message.channel_id}`}
                </span>
              )}
              {/* Country flag inline with channel name */}
              {(() => {
                const countryInfo = getCountryInfo(channel?.folder);
                return countryInfo && (
                  <span
                    className={`${countryInfo.color} text-lg font-bold flex-shrink-0 cursor-help`}
                    title={`Source folder: ${channel?.folder || 'Unknown'} - Indicates the origin classification of this channel`}
                  >
                    {countryInfo.flag}
                  </span>
                );
              })()}
            </div>

            {/* Right: Classification badges + Review status (aligned to right corner) */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Topic badge */}
              {message.topic && (
                <span
                  className={`topic-${message.topic.toLowerCase()} px-1.5 py-0.5 rounded text-xs cursor-help`}
                  title={`Topic: ${message.topic}`}
                >
                  {message.topic}
                </span>
              )}
            </div>
          </div>

          {/* Content: 2-line preview */}
          <div className="text-text-primary text-sm line-clamp-2 mb-auto">
            <FormattedContent content={displayContent || ''} embedYouTube={false} />
          </div>

          {/* Entity chips removed from compact view - too noisy.
              Entities are shown in detailed and immersive views only. */}

          {/* Line 6: Footer - Engagement + Social Graph + Timestamp */}
          <div className="flex items-center justify-between text-xs text-text-tertiary mt-2">
            <div className="flex items-center gap-2">
              {/* Engagement metrics */}
              {(message.views !== null || message.forwards !== null) && (
                <EngagementBar
                  views={message.views || 0}
                  forwards={message.forwards || 0}
                  commentsCount={message.comments_count || 0}
                  mode="compact"
                />
              )}
              {/* Social graph indicators */}
              <SocialGraphIndicator
                forwardFromChannelId={message.forward_from_channel_id || undefined}
                repliedToMessageId={message.replied_to_message_id || undefined}
                commentsCount={message.comments_count || 0}
                hasComments={message.has_comments || false}
                mode="compact"
              />
            </div>
            <span className="flex-shrink-0" title={`Posted on Telegram: ${format(new Date(message.telegram_date || message.created_at), 'MMMM d, yyyy at HH:mm')}`}>
              {format(new Date(message.telegram_date || message.created_at), 'MMM d, HH:mm')}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Detailed mode: Full content, natural height based on content
  if (density === 'detailed') {
    const countryBorderClass = getCountryBorderClass(channel?.folder);

    return (
      <div
        className={`glass p-4 rounded-lg space-y-3 ${countryBorderClass}`}
      >
        {/* Header: Channel info + metadata */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {channel && (
              <div className="flex items-center gap-2 mb-1">
                {(() => {
                  const countryInfo = getCountryInfo(channel.folder);
                  return countryInfo && (
                    <span
                      className={`${countryInfo.color} text-xl flex-shrink-0 cursor-help`}
                      title={`Source folder: ${channel.folder || 'Unknown'} - Channel classification in monitoring system`}
                    >
                      {countryInfo.flag}
                    </span>
                  );
                })()}
                <span className="text-text-primary font-medium">
                  {channel.verified && <span title="Verified channel">✓ </span>}
                  {channel.name || channel.username || `Channel ${message.channel_id}`}
                </span>
                {channel.verified && <span className="text-xs text-accent-success" title="Official verified channel">Verified</span>}
                {channel.scam && <span className="text-xs text-accent-danger" title="Flagged as scam by Telegram">Scam</span>}
                {channel.fake && <span className="text-xs text-accent-warning" title="Flagged as fake by Telegram">Fake</span>}
                {channel.restricted && <span className="text-xs text-accent-warning" title="Restricted channel with limited access">Restricted</span>}
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-text-secondary">
              <span title="When this message was archived in our system">{format(new Date(message.created_at), 'MMM d, yyyy • HH:mm')}</span>
              {message.telegram_date && (
                <span title="Original posting time on Telegram">• Telegram: {format(new Date(message.telegram_date), 'HH:mm')}</span>
              )}
              {message.is_backfilled && (
                <span
                  className="text-accent-warning cursor-help"
                  title="This message was retrieved from channel history, not captured in real-time"
                >
                  • Backfilled
                </span>
              )}
              {/* Media count indicator */}
              <span
                className={`${hasMedia ? 'text-accent-primary' : 'text-text-tertiary'} cursor-help`}
                title={hasMedia ? `${mediaUrls.length} archived media file(s) - All media is stored locally to prevent loss` : 'No media attachments'}
              >
                • {hasMedia ? `📎 ${mediaUrls.length} media file${mediaUrls.length !== 1 ? 's' : ''}` : '📎 No media'}
              </span>
              {/* Telegram source link */}
              {channel && channel.username && (
                <a
                  href={`https://t.me/${channel.username}/${message.message_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-primary hover:underline"
                  title="View original message on Telegram (may require access)"
                >
                  • View on Telegram
                </a>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            {/* Density Mode Switcher */}
            {onDensityChange && (
              <div className="flex items-center gap-1 bg-bg-secondary rounded-lg p-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDensityChange('compact');
                  }}
                  className={`p-1.5 rounded transition-colors ${
                    currentDensity === 'compact'
                      ? 'bg-accent-primary text-white'
                      : 'text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary'
                  }`}
                  title="Compact view - 120px cards for fast timeline browsing"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDensityChange('detailed');
                  }}
                  className={`p-1.5 rounded transition-colors ${
                    currentDensity === 'detailed'
                      ? 'bg-accent-primary text-white'
                      : 'text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary'
                  }`}
                  title="Detailed view - Full content with AI enrichment and metadata"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDensityChange('immersive');
                  }}
                  className={`p-1.5 rounded transition-colors ${
                    currentDensity === 'immersive'
                      ? 'bg-accent-primary text-white'
                      : 'text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary'
                  }`}
                  title="Immersive view - Full-screen modal for deep analysis"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                </button>
              </div>
            )}

            {/* Topic Badge */}
            {message.topic && (
              <span
                className={`topic-${message.topic.toLowerCase()} px-2 py-0.5 cursor-help`}
                title={`Topic: ${message.topic}`}
              >
                {message.topic}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="space-y-2">
          <FormattedContent
            content={displayContent || ''}
            className="text-text-primary leading-relaxed"
            embedYouTube={true}
          />
        </div>

        {/* Media */}
        {hasMedia && mediaUrls.length > 0 ? (
          <div className={`rounded-lg overflow-hidden bg-bg-elevated ${hasMultipleMedia ? 'grid grid-cols-1 sm:grid-cols-2 gap-2 p-2' : ''}`}>
            {mediaUrls.map((url, index) => {
              const fileType = getMediaType(index);

              return (
                <div key={index} className="relative">
                  {fileType === 'image' && (
                    <img
                      src={url}
                      alt={`Media ${index + 1} of ${mediaUrls.length}`}
                      className={`w-full h-auto object-contain cursor-pointer hover:opacity-90 transition-opacity ${hasMultipleMedia ? 'max-h-64 rounded-lg' : 'max-h-96'}`}
                      loading="lazy"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightboxInitialIndex(index);
                        setLightboxOpen(true);
                      }}
                      title="Click to view fullscreen"
                    />
                  )}
                  {fileType === 'video' && (
                    <div className="relative group">
                      <video
                        controls
                        muted
                        playsInline
                        className={`w-full h-auto ${hasMultipleMedia ? 'max-h-64 rounded-lg' : 'max-h-96'}`}
                        preload="metadata"
                        title="Archived video - locally stored to prevent data loss (click unmute for audio)"
                      >
                        <source src={url} type={getMimeType(index)} />
                      </video>
                      <button
                        className="absolute top-2 left-2 p-1.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLightboxInitialIndex(index);
                          setLightboxOpen(true);
                        }}
                        title="View fullscreen"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                      </button>
                    </div>
                  )}
                  {fileType === 'audio' && (
                    <div className="p-4 bg-bg-secondary rounded-lg">
                      <div className="flex items-center gap-3 mb-2">
                        <svg className="w-8 h-8 text-accent-primary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                        <span className="text-sm text-text-secondary">Audio file</span>
                      </div>
                      <audio
                        controls
                        className="w-full"
                        preload="metadata"
                      >
                        <source src={url} type={getMimeType(index)} />
                      </audio>
                    </div>
                  )}
                  {fileType === 'document' && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-4 text-accent-primary hover:underline bg-bg-secondary rounded-lg"
                      title="Download archived document file"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-2">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span>
                          📄 Download file {hasMultipleMedia && `(${index + 1}/${mediaUrls.length})`}
                          <br />
                          <span className="text-xs text-text-tertiary">{url.split('/').pop()}</span>
                        </span>
                      </div>
                    </a>
                  )}
                  {hasMultipleMedia && fileType !== 'document' && fileType !== 'audio' && (
                    <span
                      className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded cursor-help"
                      title={`Media ${index + 1} of ${mediaUrls.length} in this message`}
                    >
                      {index + 1}/{mediaUrls.length}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Media Lightbox */}
        <MediaLightbox
          mediaUrls={mediaUrls}
          initialIndex={lightboxInitialIndex}
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          getMediaType={getMediaTypeFromUrl}
        />

        {/* Compact Inline Engagement Summary - only show when meaningful */}
        {(((message.views || 0) > 10) || ((message.forwards || 0) > 0) || ((message.comments_count || 0) > 0) ||
          message.forward_from_channel_id !== null || message.replied_to_message_id !== null) && (
          <div className="flex items-center gap-3 text-xs text-text-secondary border-t border-border-subtle pt-2">
            {/* Engagement metrics inline */}
            {((message.views || 0) > 10 || (message.forwards || 0) > 0 || (message.comments_count || 0) > 0) && (
              <div className="flex items-center gap-2">
                {(message.views || 0) > 0 && (
                  <span className="flex items-center gap-1" title={`${message.views?.toLocaleString()} views`}>
                    <span className="text-text-tertiary">👁</span>
                    <span>{message.views?.toLocaleString()}</span>
                  </span>
                )}
                {(message.forwards || 0) > 0 && (
                  <span className="flex items-center gap-1" title={`${message.forwards?.toLocaleString()} forwards`}>
                    <span className="text-text-tertiary">↗</span>
                    <span>{message.forwards?.toLocaleString()}</span>
                  </span>
                )}
                {(message.comments_count || 0) > 0 && (
                  <span className="flex items-center gap-1" title={`${message.comments_count} comments`}>
                    <span className="text-text-tertiary">💬</span>
                    <span>{message.comments_count}</span>
                  </span>
                )}
              </div>
            )}
            {/* Social graph indicators as compact badges */}
            {message.forward_from_channel_id !== null && (
              <span className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded text-[10px]" title="Forwarded message">
                ↪ Fwd
              </span>
            )}
            {message.replied_to_message_id !== null && (
              <span className="text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded text-[10px]" title="Reply to another message">
                ↩ Reply
              </span>
            )}
            {message.has_comments && (message.comments_count || 0) === 0 && (
              <span className="text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded text-[10px]" title="Has discussion thread">
                💬 Thread
              </span>
            )}
          </div>
        )}

        {/* AI-Generated Tags - properly guarded */}
        {message.tags && message.tags.length > 0 ? (
          <div className="space-y-2">
            <div
              className="text-xs text-text-tertiary font-medium cursor-help"
              title="AI-generated tags for classification and filtering - extracted by local LLM analysis"
            >
              AI Tags
            </div>
            <div className="flex flex-wrap gap-2">
              {(() => {
                const tagsByType = formatTagsByType(message.tags);
                return Object.entries(tagsByType).map(([tagType, tags]) => {
                  const style = getTagTypeStyle(tagType);
                  return tags.slice(0, 3).map((tag, i) => (
                    <span
                      key={`${tagType}-${i}`}
                      className={`${style.bgColor} ${style.color} px-2 py-1 rounded text-xs border border-current/20 flex items-center gap-1 cursor-help`}
                      title={`Tag Type: ${tagType} • Confidence: ${(tag.confidence * 100).toFixed(0)}% • Generated by: ${tag.generated_by} • Click to filter by this tag`}
                    >
                      <span>{style.icon}</span>
                      <span>{tag.tag}</span>
                      {tag.confidence >= 0.8 && (
                        <span className="opacity-60 text-[10px]">
                          {(tag.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </span>
                  ));
                });
              })()}
            </div>
          </div>
        ) : null}

        {/* Footer with collapsible metadata */}
        <details className="pt-2 border-t border-border-subtle group">
          <summary className="flex items-center justify-between cursor-pointer list-none">
            <div className="flex items-center gap-3 text-xs text-text-tertiary">
              <span title="Telegram message identifier">ID: {message.message_id}</span>
              {message.grouped_id && (
                <span
                  className="cursor-help"
                  title="Album/media group identifier - messages with the same grouped_id are part of a media album"
                >
                  • Group: {message.grouped_id}
                </span>
              )}
            </div>
            <span className="text-xs text-accent-primary hover:underline flex items-center gap-1">
              <span className="group-open:hidden">More info</span>
              <span className="hidden group-open:inline">Less info</span>
              <span className="group-open:rotate-180 transition-transform text-[10px]">▼</span>
            </span>
          </summary>

          {/* Expanded metadata section */}
          <div className="mt-3 space-y-4 text-xs">
            {/* Engagement Details (full breakdown) */}
            {(message.views !== null || message.forwards !== null || message.comments_count > 0) && (
              <div className="space-y-2">
                <div className="text-text-tertiary font-medium">Engagement Details</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {message.views !== null && (
                    <div className="bg-bg-secondary/50 rounded p-2">
                      <div className="text-text-tertiary">Views</div>
                      <div className="text-text-primary font-mono">{message.views.toLocaleString()}</div>
                    </div>
                  )}
                  {message.forwards !== null && (
                    <div className="bg-bg-secondary/50 rounded p-2">
                      <div className="text-text-tertiary">Forwards</div>
                      <div className="text-text-primary font-mono">{message.forwards.toLocaleString()}</div>
                      <div className="text-text-tertiary text-[10px]">
                        {((message.forwards / Math.max(message.views || 1, 1)) * 100).toFixed(2)}% virality
                      </div>
                    </div>
                  )}
                  {(message.comments_count || 0) > 0 && (
                    <div className="bg-bg-secondary/50 rounded p-2">
                      <div className="text-text-tertiary">Comments</div>
                      <div className="text-text-primary font-mono">{message.comments_count}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Social Graph Details */}
            {(message.forward_from_channel_id !== null || message.replied_to_message_id !== null || message.has_comments) && (
              <div className="space-y-2">
                <div className="text-text-tertiary font-medium">Social Graph</div>

                {/* Forward Chain Info */}
                {message.forward_from_channel_id !== null && (
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded p-2">
                    <div className="flex items-center gap-1 text-blue-400 mb-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 9l3 3m0 0l-3 3m3-3H8m13 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Forwarded from another channel</span>
                    </div>
                    <div className="text-text-secondary">
                      Channel ID: {message.forward_from_channel_id}
                      {message.forward_from_message_id && ` • Msg: ${message.forward_from_message_id}`}
                      {message.forward_date && ` • ${format(new Date(message.forward_date), 'MMM d, yyyy')}`}
                    </div>
                  </div>
                )}

                {/* Reply Info */}
                {message.replied_to_message_id !== null && (
                  <div className="bg-green-500/10 border border-green-500/20 rounded p-2">
                    <div className="flex items-center gap-1 text-green-400 mb-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                      <span>Reply to message</span>
                    </div>
                    <div className="text-text-secondary">Message ID: {message.replied_to_message_id}</div>
                  </div>
                )}

                {/* Comments/Discussion Info */}
                {message.has_comments && (
                  <div className="bg-purple-500/10 border border-purple-500/20 rounded p-2">
                    <div className="flex items-center gap-1 text-purple-400">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                      </svg>
                      <span>Discussion thread ({message.comments_count} comments)</span>
                    </div>
                    {message.linked_chat_id && (
                      <div className="text-text-secondary mt-1">Chat ID: {message.linked_chat_id}</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Timestamps Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
              <div className="bg-bg-secondary/50 rounded p-2">
                <div
                  className="text-text-tertiary mb-1 cursor-help"
                  title="Original posting time on Telegram platform"
                >
                  Telegram Date
                </div>
                <div className="text-text-secondary font-mono">
                  {message.telegram_date
                    ? format(new Date(message.telegram_date), 'MMM d, yyyy HH:mm:ss')
                    : 'N/A'}
                </div>
              </div>
              <div className="bg-bg-secondary/50 rounded p-2">
                <div
                  className="text-text-tertiary mb-1 cursor-help"
                  title="When this message was saved to our archive system"
                >
                  Archived
                </div>
                <div className="text-text-secondary font-mono">
                  {format(new Date(message.created_at), 'MMM d, yyyy HH:mm:ss')}
                </div>
              </div>
            </div>

            {/* Processing Info */}
            <div className="flex flex-wrap gap-2">
              {message.language_detected && (
                <span
                  className="bg-bg-secondary px-2 py-1 rounded text-text-secondary cursor-help"
                  title={`Detected Language: The AI detected this message was written in ${message.language_detected.toUpperCase()} - Used for translation and analysis`}
                >
                  <span className="text-text-tertiary text-[10px] mr-1">Lang:</span>
                  🌐 {message.language_detected.toUpperCase()}
                </span>
              )}
              {message.translation_provider && (
                <span
                  className="bg-bg-secondary px-2 py-1 rounded text-text-secondary cursor-help"
                  title={`Translation Provider: This message was translated using ${message.translation_provider} - Translation is performed automatically for non-English content`}
                >
                  <span className="text-text-tertiary text-[10px] mr-1">Via:</span>
                  🔄 {message.translation_provider}
                </span>
              )}
              {message.is_backfilled && (
                <span
                  className="bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded cursor-help"
                  title="Backfilled: This message was retrieved from channel history during initial channel setup, not captured in real-time. May have incomplete metadata."
                >
                  📦 Backfilled
                </span>
              )}
              {message.media_type && (
                <span
                  className="bg-bg-secondary px-2 py-1 rounded text-text-secondary cursor-help"
                  title={`Media Type: The attached file is a ${message.media_type} - All media is archived locally to prevent data loss from Telegram's ephemeral URLs`}
                >
                  <span className="text-text-tertiary text-[10px] mr-1">Media:</span>
                  📎 {message.media_type}
                </span>
              )}
            </div>

            {/* Authenticity Hashes (collapsed) */}
            {(message.content_hash || message.metadata_hash) && (
              <details className="bg-bg-secondary/30 rounded p-2">
                <summary
                  className="text-text-tertiary cursor-pointer hover:text-text-secondary flex items-center gap-1"
                  title="Cryptographic hashes for verifying message authenticity and detecting tampering"
                >
                  <span>🔐 Authenticity Hashes</span>
                  <span className="text-[10px]">▶</span>
                </summary>
                <div className="mt-2 space-y-1 font-mono text-[10px] text-text-tertiary break-all">
                  {message.content_hash && (
                    <div title="SHA-256 hash of message content for integrity verification">Content: {message.content_hash}</div>
                  )}
                  {message.metadata_hash && (
                    <div title="SHA-256 hash of message metadata for integrity verification">Metadata: {message.metadata_hash}</div>
                  )}
                </div>
              </details>
            )}

            {/* Channel Details */}
            {channel && (
              <div className="bg-bg-secondary/30 rounded p-2">
                <div
                  className="text-text-tertiary mb-1 cursor-help"
                  title="Source channel information from Telegram"
                >
                  Channel
                </div>
                <div className="flex items-center gap-2 text-text-secondary">
                  <span>{channel.name || channel.username}</span>
                  {channel.verified && <span className="text-blue-400" title="Official verified channel">✓</span>}
                  {channel.folder && (
                    <span
                      className="text-text-tertiary cursor-help"
                      title="Monitoring folder - determines archival rules and source classification"
                    >
                      • {channel.folder}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </details>

      </div>
    );
  }

  // Immersive mode: Full viewport modal
  if (density === 'immersive') {
    return (
      <div
        className="fixed inset-0 bg-bg-base/95 backdrop-blur-sm z-50 overflow-y-auto p-8"
        onClick={(e) => {
          if (e.target === e.currentTarget && onDensityChange) {
            onDensityChange('detailed');
          }
        }}
      >
        <div className="max-w-4xl mx-auto glass p-8 rounded-xl space-y-6">
          {/* Density Mode Switcher & Close */}
          <div className="flex justify-between items-center">
            <div className="text-lg font-medium text-text-primary">Message Details</div>
            {onDensityChange && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 bg-bg-secondary rounded-lg p-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDensityChange('compact');
                    }}
                    className={`p-1.5 rounded transition-colors ${
                      currentDensity === 'compact'
                        ? 'bg-accent-primary text-white'
                        : 'text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary'
                    }`}
                    title="Compact view"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDensityChange('detailed');
                    }}
                    className={`p-1.5 rounded transition-colors ${
                      currentDensity === 'detailed'
                        ? 'bg-accent-primary text-white'
                        : 'text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary'
                    }`}
                    title="Detailed view"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDensityChange('immersive');
                    }}
                    className={`p-1.5 rounded transition-colors ${
                      currentDensity === 'immersive'
                        ? 'bg-accent-primary text-white'
                        : 'text-text-tertiary hover:text-text-primary hover:bg-bg-tertiary'
                    }`}
                    title="Immersive view"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                  </button>
                </div>
                <button
                  onClick={() => onDensityChange('detailed')}
                  className="text-text-tertiary hover:text-text-primary transition-colors text-2xl leading-none"
                  title="Close immersive view"
                >
                  ×
                </button>
              </div>
            )}
          </div>

          {/* Full content - reuse detailed mode but with more space */}
          <div className="space-y-6">
            {/* Phantom Message Warning */}
            {isPhantomMessage && (
              <div className="bg-accent-warning/10 border border-accent-warning/30 rounded-lg p-6">
                <div className="flex items-start gap-3">
                  <svg className="w-6 h-6 text-accent-warning flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <h3 className="font-medium text-accent-warning mb-1">Incomplete Message Data</h3>
                    <p className="text-sm text-text-secondary">
                      This message has no content or media. This may be part of a Telegram album that wasn&apos;t properly grouped during archival.
                      The message exists in the database but contains no displayable information.
                    </p>
                    <p className="text-sm text-text-tertiary mt-2">
                      <strong>Technical details:</strong> The listener captured this message but the <code className="px-1 py-0.5 bg-bg-secondary rounded">grouped_id</code> field
                      wasn&apos;t passed to the processor. This is a known limitation being addressed in future updates.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Channel header */}
            {channel && (
              <div className="flex items-center gap-4 pb-4 border-b border-border-subtle">
                {(() => {
                  const countryInfo = getCountryInfo(channel.folder);
                  return countryInfo && (
                    <span
                      className={`${countryInfo.color} text-3xl flex-shrink-0 cursor-help`}
                      title={`Source folder: ${channel.folder || 'Unknown'} - Channel classification in monitoring system`}
                    >
                      {countryInfo.flag}
                    </span>
                  );
                })()}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-medium text-text-primary">
                      {channel.verified && <span title="Verified channel">✓ </span>}
                      {channel.name || channel.username}
                    </h2>
                    {channel.scam && <span className="text-xs px-2 py-1 bg-accent-danger/20 text-accent-danger rounded cursor-help" title="Flagged as scam by Telegram">Scam</span>}
                    {channel.fake && <span className="text-xs px-2 py-1 bg-accent-warning/20 text-accent-warning rounded cursor-help" title="Flagged as fake by Telegram">Fake</span>}
                    {channel.restricted && <span className="text-xs px-2 py-1 bg-accent-warning/20 text-accent-warning rounded cursor-help" title="Restricted channel">Restricted</span>}
                  </div>
                  {channel.description && (
                    <p className="text-sm text-text-secondary mt-1">{channel.description}</p>
                  )}
                </div>
              </div>
            )}

            {/* Content */}
            <div className="prose prose-invert max-w-none">
              <FormattedContent
                content={displayContent || ''}
                className="text-lg leading-relaxed text-text-primary"
                embedYouTube={true}
              />
            </div>

            {/* Translation */}
            {message.content_translated && message.content_translated !== message.content ? (
              <div className="space-y-2">
                <button
                  onClick={() => setShowTranslation(!showTranslation)}
                  className="text-sm text-accent-primary hover:underline"
                  title={showTranslation ? 'View original message text' : 'View AI-translated version'}
                >
                  {showTranslation ? '← Back to original' : 'View translation →'}
                  {message.language_detected ? ` (${message.language_detected})` : ''}
                </button>
              </div>
            ) : null}

            {/* Media */}
            {hasMedia && mediaUrls.length > 0 ? (
              <div className={`rounded-xl overflow-hidden ${hasMultipleMedia ? 'grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-4' : ''}`}>
                {mediaUrls.map((url, index) => {
                  const fileType = getMediaType(index);

                  return (
                    <div key={index} className="relative rounded-lg overflow-hidden">
                      {fileType === 'image' && (
                        <img
                          src={url}
                          alt={`Media ${index + 1} of ${mediaUrls.length}`}
                          className="w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightboxInitialIndex(index);
                            setLightboxOpen(true);
                          }}
                          title="Click to view fullscreen"
                        />
                      )}
                      {fileType === 'video' && (
                        <div className="relative group">
                          <video
                            controls
                            muted
                            playsInline
                            className="w-full h-auto"
                          >
                            <source src={url} type={getMimeType(index)} />
                          </video>
                          <button
                            className="absolute top-2 left-2 p-2 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              setLightboxInitialIndex(index);
                              setLightboxOpen(true);
                            }}
                            title="View fullscreen"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                            </svg>
                          </button>
                        </div>
                      )}
                      {fileType === 'audio' && (
                        <div className="p-4 bg-bg-secondary rounded-lg">
                          <div className="flex items-center gap-3 mb-3">
                            <svg className="w-8 h-8 text-accent-primary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                            </svg>
                            <div>
                              <div className="font-medium text-text-primary">Audio {hasMultipleMedia && `(${index + 1}/${mediaUrls.length})`}</div>
                              <div className="text-xs text-text-tertiary">{url.split('/').pop()}</div>
                            </div>
                          </div>
                          <audio
                            controls
                            className="w-full"
                            preload="metadata"
                          >
                            <source src={url} type={getMimeType(index)} />
                            Your browser does not support the audio element.
                          </audio>
                        </div>
                      )}
                      {fileType === 'document' && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block p-6 text-accent-primary hover:underline bg-bg-secondary rounded-lg"
                          title="Download archived document file"
                        >
                          <div className="flex items-center gap-3">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span>
                              <div className="font-medium">Download file {hasMultipleMedia && `(${index + 1}/${mediaUrls.length})`}</div>
                              <div className="text-sm text-text-tertiary mt-1">{url.split('/').pop()}</div>
                            </span>
                          </div>
                        </a>
                      )}
                      {hasMultipleMedia && (fileType === 'image' || fileType === 'video') && (
                        <span
                          className="absolute top-2 right-2 bg-black/70 text-white text-sm px-3 py-1 rounded cursor-help"
                          title={`Media ${index + 1} of ${mediaUrls.length} in this message`}
                        >
                          {index + 1}/{mediaUrls.length}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* Media Lightbox for immersive view */}
            <MediaLightbox
              mediaUrls={mediaUrls}
              initialIndex={lightboxInitialIndex}
              isOpen={lightboxOpen}
              onClose={() => setLightboxOpen(false)}
              getMediaType={getMediaTypeFromUrl}
            />

            {/* Metadata grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 pt-4 border-t border-border-subtle">
              <div>
                <div
                  className="text-xs text-text-tertiary mb-1 cursor-help"
                  title="AI-classified content category for intelligence analysis"
                >
                  Topic
                </div>
                {message.topic ? (
                  <span className={`topic-${message.topic.toLowerCase()} inline-block`}>
                    {message.topic}
                  </span>
                ) : (
                  <span className="text-text-secondary text-sm">None</span>
                )}
              </div>

              <div>
                <div
                  className="text-xs text-text-tertiary mb-1 cursor-help"
                  title="Telegram's unique identifier for this message in the channel"
                >
                  Message ID
                </div>
                <div className="text-sm text-text-primary font-mono">{message.message_id}</div>
              </div>

              <div>
                <div
                  className="text-xs text-text-tertiary mb-1 cursor-help"
                  title="Telegram's unique identifier for the source channel"
                >
                  Channel ID
                </div>
                <div className="text-sm text-text-primary font-mono">{message.channel_id}</div>
              </div>

              {message.telegram_date && (
                <div>
                  <div
                    className="text-xs text-text-tertiary mb-1 cursor-help"
                    title="Original posting time on Telegram platform"
                  >
                    Telegram Date
                  </div>
                  <div className="text-sm text-text-primary">
                    {format(new Date(message.telegram_date), 'MMM d, yyyy • HH:mm:ss')}
                  </div>
                </div>
              )}

              <div>
                <div
                  className="text-xs text-text-tertiary mb-1 cursor-help"
                  title="When this message was saved to our archive system"
                >
                  Archived Date
                </div>
                <div className="text-sm text-text-primary">
                  {format(new Date(message.created_at), 'MMM d, yyyy • HH:mm:ss')}
                </div>
              </div>

              <div>
                <div
                  className="text-xs text-text-tertiary mb-1 cursor-help"
                  title="Last time this message was updated (enrichment, review, etc.)"
                >
                  Last Updated
                </div>
                <div className="text-sm text-text-primary">
                  {format(new Date(message.updated_at), 'MMM d, yyyy • HH:mm:ss')}
                </div>
              </div>

              {message.grouped_id && (
                <div>
                  <div
                    className="text-xs text-text-tertiary mb-1 cursor-help"
                    title="Album/media group identifier - messages with the same grouped_id are part of a media album"
                  >
                    Album Group ID
                  </div>
                  <div className="text-sm text-text-primary font-mono">{message.grouped_id}</div>
                </div>
              )}

              {message.media_type && (
                <div>
                  <div
                    className="text-xs text-text-tertiary mb-1 cursor-help"
                    title="Type of media attachment (photo, video, document, etc.)"
                  >
                    Media Type
                  </div>
                  <div className="text-sm text-text-primary">{message.media_type}</div>
                </div>
              )}

              {mediaUrls.length > 0 && (
                <div>
                  <div
                    className="text-xs text-text-tertiary mb-1 cursor-help"
                    title="Number of media files archived for this message - all stored locally"
                  >
                    Media Files
                  </div>
                  <div className="text-sm text-text-primary">{mediaUrls.length} file(s)</div>
                </div>
              )}

              {message.language_detected && (
                <div>
                  <div
                    className="text-xs text-text-tertiary mb-1 cursor-help"
                    title="AI-detected language of the message content"
                  >
                    Language
                  </div>
                  <div className="text-sm text-text-primary">{message.language_detected}</div>
                </div>
              )}

              {message.translation_provider && (
                <div>
                  <div
                    className="text-xs text-text-tertiary mb-1 cursor-help"
                    title="Service used to translate this message (DeepL Pro API)"
                  >
                    Translation Provider
                  </div>
                  <div className="text-sm text-text-primary">{message.translation_provider}</div>
                </div>
              )}

              {message.is_backfilled && (
                <div>
                  <div
                    className="text-xs text-text-tertiary mb-1 cursor-help"
                    title="Data source - backfilled messages retrieved from history may have incomplete metadata"
                  >
                    Source
                  </div>
                  <div className="text-sm text-accent-warning">Backfilled Data</div>
                </div>
              )}

              {message.media_url_telegram && (
                <div className="col-span-2">
                  <div
                    className="text-xs text-text-tertiary mb-1 cursor-help"
                    title="Original Telegram media URL - may be expired, use archived version instead"
                  >
                    Telegram Media URL
                  </div>
                  <a
                    href={message.media_url_telegram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-accent-primary hover:underline break-all"
                  >
                    {message.media_url_telegram}
                  </a>
                </div>
              )}
            </div>

            {/* Entities */}
            {entities.length > 0 && (
              <div>
                <div
                  className="text-xs text-text-tertiary mb-2 cursor-help"
                  title="Hashtags, mentions, and locations extracted from message content"
                >
                  Extracted Entities
                </div>
                <div className="flex flex-wrap gap-2">
                  {entities.map((entity, i) => (
                    <span
                      key={i}
                      className="px-3 py-1.5 rounded text-sm cursor-help"
                      style={{
                        backgroundColor: 'rgba(100, 116, 131, 0.2)',
                        color: '#64748b',
                        border: '1px solid rgba(100, 116, 131, 0.3)',
                      }}
                      title="Extracted entity from message text"
                    >
                      {entity}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* AI-Generated Tags (Full Display) */}
            {message.tags && message.tags.length > 0 && (
              <div className="space-y-3">
                <div
                  className="text-xs text-text-tertiary font-medium cursor-help"
                  title="AI-generated tags for classification and filtering - extracted by local LLM analysis"
                >
                  AI-Generated Tags
                </div>
                {(() => {
                  const tagsByType = formatTagsByType(message.tags);
                  return Object.entries(tagsByType).map(([tagType, tags]) => {
                    const style = getTagTypeStyle(tagType);
                    return (
                      <div key={tagType} className="space-y-2">
                        <div className={`text-xs ${style.color} font-medium flex items-center gap-1`}>
                          <span>{style.icon}</span>
                          <span className="capitalize">{tagType}</span>
                          <span className="text-text-tertiary">({tags.length})</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {tags.map((tag, i) => (
                            <span
                              key={i}
                              className={`${style.bgColor} ${style.color} px-3 py-1.5 rounded text-sm border border-current/20 flex items-center gap-2 cursor-help`}
                              title={`Tag: ${tag.tag} • Type: ${tagType} • Confidence: ${(tag.confidence * 100).toFixed(0)}% • Generated by: ${tag.generated_by}`}
                            >
                              <span>{tag.tag}</span>
                              <span className="text-xs opacity-60">
                                {(tag.confidence * 100).toFixed(0)}%
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}

          </div>
        </div>
      </div>
    );
  }

  return null;
}
