'use client';

/**
 * OverviewTab Component
 *
 * Default tab showing core message information:
 * - Channel header with country flag, verification badges
 * - Full content with translation toggle
 * - Media gallery
 * - Basic metadata grid (message ID, channel ID, dates)
 * - RSS Validation Panel
 */

import { useState } from 'react';
import { format } from 'date-fns';
import type { Message, Channel } from '@/lib/types';
import { getMediaUrl } from '@/lib/api';
import { ValidationPanel } from '../ValidationPanel';

interface OverviewTabProps {
  message: Message;
  channel?: Channel;
}

// Helper type for media items with resolved URLs
interface ResolvedMediaItem {
  url: string;
  mime_type: string;
  media_type: 'image' | 'video' | 'audio' | 'document';
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

export default function OverviewTab({ message, channel }: OverviewTabProps) {
  const [showTranslation, setShowTranslation] = useState(false);

  // Build resolved media items with full URLs from media_items (preferred) or media_urls (legacy)
  const mediaItems: ResolvedMediaItem[] = (message.media_items || []).map(item => ({
    url: getMediaUrl(item.url) || '',
    mime_type: item.mime_type,
    media_type: item.media_type as 'image' | 'video' | 'audio' | 'document',
  })).filter(item => item.url);

  // Legacy support: fall back to media_urls if media_items not available
  const legacyMediaUrls = message.media_urls?.map(s3Key => getMediaUrl(s3Key)).filter(Boolean) as string[] || [];
  const mediaUrls = mediaItems.length > 0 ? mediaItems.map(m => m.url) : legacyMediaUrls;

  const hasMedia = mediaUrls.length > 0;
  const hasMultipleMedia = mediaUrls.length > 1;

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

  // Content display (original or translated)
  const displayContent = showTranslation && message.content_translated
    ? message.content_translated
    : message.content;

  const hasTranslation = message.content_translated && message.content_translated !== message.content;
  const countryInfo = getCountryInfo(channel?.folder);

  return (
    <div className="space-y-6">
      {/* Channel Header */}
      {channel && (
        <div className="flex items-center gap-4 pb-4 border-b border-border-subtle">
          {countryInfo && (
            <span className={`${countryInfo.color} text-3xl flex-shrink-0`} title={channel.folder || undefined}>
              {countryInfo.flag}
            </span>
          )}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-medium text-text-primary">
                {channel.verified && '✓ '}
                {channel.name || channel.username}
              </h2>
              {channel.verified && <span className="text-xs px-2 py-1 bg-accent-success/20 text-accent-success rounded">Verified</span>}
              {channel.scam && <span className="text-xs px-2 py-1 bg-accent-danger/20 text-accent-danger rounded">Scam</span>}
              {channel.fake && <span className="text-xs px-2 py-1 bg-accent-warning/20 text-accent-warning rounded">Fake</span>}
              {channel.restricted && <span className="text-xs px-2 py-1 bg-accent-warning/20 text-accent-warning rounded">Restricted</span>}
            </div>
            {channel.username && (
              <p className="text-sm text-text-secondary mt-1">@{channel.username}</p>
            )}
            {channel.description && (
              <p className="text-sm text-text-secondary mt-1">{channel.description}</p>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="space-y-3">
        <div className="prose prose-invert max-w-none">
          <div className="text-lg leading-relaxed text-text-primary whitespace-pre-wrap">
            {displayContent || 'No content'}
          </div>
        </div>

        {/* Translation Toggle */}
        {hasTranslation && (
          <button
            onClick={() => setShowTranslation(!showTranslation)}
            className="text-sm text-accent-primary hover:underline flex items-center gap-2"
          >
            {showTranslation ? (
              <>
                <span>← Back to original</span>
                {message.language_detected && <span className="text-text-tertiary">({message.language_detected})</span>}
              </>
            ) : (
              <>
                <span>View translation →</span>
                {message.language_detected && <span className="text-text-tertiary">({message.language_detected})</span>}
              </>
            )}
          </button>
        )}
      </div>

      {/* Media Gallery */}
      {hasMedia && (
        <div className={`rounded-xl overflow-hidden bg-bg-elevated ${hasMultipleMedia ? 'grid grid-cols-2 gap-4 p-4' : ''}`}>
          {mediaUrls.map((url, index) => {
            const fileType = getMediaType(index);

            return (
              <div key={index} className="relative rounded-lg overflow-hidden">
                {fileType === 'image' && (
                  <img
                    src={url}
                    alt={`Media ${index + 1} of ${mediaUrls.length}`}
                    className="w-full h-auto"
                    loading="lazy"
                  />
                )}
                {fileType === 'video' && (
                  <video
                    controls
                    muted
                    playsInline
                    className="w-full h-auto"
                    preload="metadata"
                  >
                    <source src={url} type={getMimeType(index)} />
                  </video>
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
                  <span className="absolute top-2 right-2 bg-black/70 text-white text-sm px-3 py-1 rounded">
                    {index + 1}/{mediaUrls.length}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Basic Metadata Grid */}
      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border-subtle">
        <div>
          <div className="text-xs text-text-tertiary mb-1">Message ID</div>
          <div className="text-sm text-text-primary font-mono">{message.message_id}</div>
        </div>

        <div>
          <div className="text-xs text-text-tertiary mb-1">Channel ID</div>
          <div className="text-sm text-text-primary font-mono">{message.channel_id}</div>
        </div>

        {message.telegram_date && (
          <div>
            <div className="text-xs text-text-tertiary mb-1">Telegram Date</div>
            <div className="text-sm text-text-primary">
              {format(new Date(message.telegram_date), 'MMM d, yyyy • HH:mm:ss')}
            </div>
          </div>
        )}

        <div>
          <div className="text-xs text-text-tertiary mb-1">Archived Date</div>
          <div className="text-sm text-text-primary">
            {format(new Date(message.created_at), 'MMM d, yyyy • HH:mm:ss')}
          </div>
        </div>

        <div>
          <div className="text-xs text-text-tertiary mb-1">Last Updated</div>
          <div className="text-sm text-text-primary">
            {format(new Date(message.updated_at), 'MMM d, yyyy • HH:mm:ss')}
          </div>
        </div>

        {channel && channel.username && (
          <div>
            <div className="text-xs text-text-tertiary mb-1">Telegram Link</div>
            <a
              href={`https://t.me/${channel.username}/${message.message_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-accent-primary hover:underline"
            >
              View on Telegram →
            </a>
          </div>
        )}
      </div>

      {/* RSS Validation Panel */}
      <div className="pt-4 border-t border-border-subtle">
        <ValidationPanel messageId={message.id} />
      </div>
    </div>
  );
}
