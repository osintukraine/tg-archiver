'use client';

import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, MessageCircle } from 'lucide-react';
import type { Message } from '@/lib/types';
import { getMediaUrl } from '@/lib/api';
import EngagementBar from '@/components/EngagementBar';
import SocialGraphIndicator from '@/components/SocialGraphIndicator';
import { MediaLightbox } from '@/components/MediaLightbox';

// YouTube URL patterns
const YOUTUBE_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:\S*)?/g;
const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,;:!?"')\]])/g;

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
function FormattedContent({ content, embedYouTube = true }: { content: string; embedYouTube?: boolean }) {
  if (!content) return <span>No content</span>;

  // Find all YouTube URLs for embedding
  const youtubeMatches: { id: string; url: string }[] = [];
  if (embedYouTube) {
    const ytRegex = new RegExp(YOUTUBE_PATTERN.source, 'g');
    let ytMatch;
    while ((ytMatch = ytRegex.exec(content)) !== null) {
      const id = extractYouTubeId(ytMatch[0]);
      if (id && !youtubeMatches.find(m => m.id === id)) {
        youtubeMatches.push({ id, url: ytMatch[0] });
      }
    }
  }

  // Split content by URLs and render with links
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let partKey = 0;
  const urlRegex = new RegExp(URL_PATTERN.source, 'g');
  let urlMatch;

  while ((urlMatch = urlRegex.exec(content)) !== null) {
    if (urlMatch.index > lastIndex) {
      parts.push(<span key={partKey++}>{content.slice(lastIndex, urlMatch.index)}</span>);
    }
    const url = urlMatch[0];
    const isYouTube = extractYouTubeId(url) !== null;
    parts.push(
      <a
        key={partKey++}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`text-blue-500 hover:text-blue-600 hover:underline ${isYouTube ? 'inline-flex items-center gap-1' : ''}`}
        onClick={(e) => e.stopPropagation()}
        title={isYouTube ? 'Open YouTube video in new tab' : 'Open link in new tab'}
      >
        {isYouTube && (
          <svg className="w-4 h-4 text-red-500 inline-block" viewBox="0 0 24 24" fill="currentColor">
            <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
          </svg>
        )}
        {url}
      </a>
    );
    lastIndex = urlMatch.index + url.length;
  }

  if (lastIndex < content.length) {
    parts.push(<span key={partKey++}>{content.slice(lastIndex)}</span>);
  }

  return (
    <>
      <div className="whitespace-pre-wrap">{parts.length > 0 ? parts : content}</div>
      {embedYouTube && youtubeMatches.length > 0 && (
        <div className="mt-4 space-y-3">
          {youtubeMatches.map(({ id }) => (
            <div
              key={id}
              className="relative w-full rounded-lg overflow-hidden bg-black"
              style={{ paddingBottom: '56.25%' }}
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
    </>
  );
}

interface ContentViewProps {
  message: Message;
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

export function ContentView({ message }: ContentViewProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxInitialIndex, setLightboxInitialIndex] = useState(0);

  const displayContent = message.content_translated || message.content;
  const hasTranslation = message.content_translated && message.content_translated !== message.content;
  const countryInfo = getCountryInfo(message.channel?.folder);

  // Build resolved media items with full URLs from media_items (preferred) or media_urls (legacy)
  const mediaItems: ResolvedMediaItem[] = (message.media_items || []).map(item => ({
    url: getMediaUrl(item.url) || '',
    mime_type: item.mime_type,
    media_type: item.media_type as 'image' | 'video' | 'audio' | 'document',
  })).filter(item => item.url);

  // Legacy support: fall back to media_urls if media_items not available
  const legacyMediaUrls = message.media_urls?.map(s3Key => getMediaUrl(s3Key)).filter(Boolean) as string[] || [];
  const mediaUrls = mediaItems.length > 0 ? mediaItems.map(m => m.url) : legacyMediaUrls;

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

  // URL-based helper for MediaLightbox compatibility
  const getMediaTypeFromUrl = (url: string): 'image' | 'video' | 'document' => {
    const matchingItem = mediaItems.find(item => item.url === url);
    if (matchingItem) {
      return matchingItem.media_type === 'audio' ? 'document' : matchingItem.media_type;
    }
    const ext = url.toLowerCase().split('.').pop() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v', 'flv'].includes(ext)) return 'video';
    return 'document';
  };

  return (
    <div className="space-y-4">
      {/* Channel Info with Country Flag - REMOVED duplicate topic badge */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {/* Country Flag - Prominent Display */}
          {countryInfo && (
            <span
              className={`${countryInfo.color} text-xl font-bold flex-shrink-0`}
              title={`Source: ${message.channel?.folder || 'Unknown'}`}
            >
              {countryInfo.flag}
            </span>
          )}

          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{message.channel?.name || 'Unknown Channel'}</span>

          {message.channel?.username && (
            <a
              href={`https://t.me/${message.channel.username}/${message.message_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:text-blue-600 flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" />
              View on Telegram
            </a>
          )}
        </div>

        {/* Engagement Metrics - Replaced with EngagementBar */}
        <EngagementBar
          views={message.views}
          forwards={message.forwards}
          commentsCount={message.comments_count}
          mode="compact"
        />
      </div>

      {/* Social Graph Indicators */}
      <SocialGraphIndicator
        forwardFromChannelId={message.forward_from_channel_id ?? undefined}
        repliedToMessageId={message.replied_to_message_id ?? undefined}
        commentsCount={message.comments_count}
        hasComments={message.has_comments}
        mode="compact"
      />

      {/* Message Content with clickable links and YouTube embeds */}
      <div className="prose prose-sm max-w-none text-sm leading-relaxed">
        <FormattedContent content={displayContent || ''} embedYouTube={true} />
      </div>

      {/* Translation Notice */}
      {hasTranslation && (
        <div className="text-xs text-muted-foreground bg-slate-50 dark:bg-slate-800 p-2 rounded">
          <p className="font-medium mb-1">Original language detected, showing translation</p>
          <details className="cursor-pointer">
            <summary className="hover:text-foreground dark:hover:text-gray-200">Show original text</summary>
            <div className="mt-2 whitespace-pre-wrap">
              {message.content}
            </div>
          </details>
        </div>
      )}

      {/* Media - Multiple Files Support with Per-File Type Detection */}
      {mediaUrls.length > 0 && (
        <div className="space-y-2">
          {/* Album count indicator */}
          {message.grouped_id && mediaUrls.length > 1 && (
            <div className="text-xs text-muted-foreground">
              Album with {mediaUrls.length} items
            </div>
          )}

          <div className={`grid gap-2 ${mediaUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {mediaUrls.map((mediaUrl, idx) => {
              // Detect media type using structured data with extension fallback
              const fileType = getMediaType(idx);

              return (
                <div key={idx} className="border rounded-lg overflow-hidden dark:border-gray-700 relative">
                  {/* Item count for albums */}
                  {message.grouped_id && mediaUrls.length > 1 && (fileType === 'image' || fileType === 'video') && (
                    <div className="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded z-10">
                      {idx + 1} of {mediaUrls.length}
                    </div>
                  )}

                  {fileType === 'image' && (
                    <img
                      src={mediaUrl}
                      alt={`Message attachment ${idx + 1}`}
                      className="w-full h-auto cursor-pointer hover:opacity-90 transition-opacity"
                      loading="lazy"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightboxInitialIndex(idx);
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
                        preload="auto"
                      >
                        {/* No type attribute - browser auto-detects from Content-Type header */}
                        {/* This fixes .MOV files where video/quicktime isn't recognized by some browsers */}
                        <source src={mediaUrl} />
                      </video>
                      <button
                        className="absolute top-2 left-2 p-1.5 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLightboxInitialIndex(idx);
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
                    <div className="p-4 bg-slate-50 dark:bg-slate-800">
                      <div className="flex items-center gap-3 mb-2">
                        <svg className="w-6 h-6 text-blue-500 dark:text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                        </svg>
                        <span className="text-sm text-muted-foreground">Audio {mediaUrls.length > 1 ? `(${idx + 1}/${mediaUrls.length})` : ''}</span>
                      </div>
                      <audio
                        controls
                        className="w-full"
                        preload="metadata"
                      >
                        <source src={mediaUrl} type={getMimeType(idx)} />
                        Your browser does not support the audio element.
                      </audio>
                    </div>
                  )}
                  {fileType === 'document' && (
                    <div className="p-4 bg-slate-50 dark:bg-slate-800">
                      <a
                        href={mediaUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-2"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Download attachment {mediaUrls.length > 1 ? `${idx + 1}` : ''}
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Tags (Hashtags) */}
      {message.entities && message.entities.hashtags && message.entities.hashtags.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Hashtags</p>
          <div className="flex flex-wrap gap-2">
            {message.entities.hashtags?.map((tag: string, idx: number) => (
              <Badge key={idx} variant="secondary" className="text-xs">
                #{tag}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Media Lightbox */}
      <MediaLightbox
        mediaUrls={mediaUrls}
        initialIndex={lightboxInitialIndex}
        isOpen={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        getMediaType={getMediaTypeFromUrl}
      />
    </div>
  );
}
