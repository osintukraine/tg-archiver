/**
 * Metadata utilities for OpenGraph and social sharing
 *
 * These helpers generate proper OpenGraph meta tags that work with
 * social media platforms (Facebook, Twitter, Discord, LinkedIn).
 *
 * Key considerations:
 * - URLs must be absolute (social crawlers can't resolve relative paths)
 * - Media URLs must be publicly accessible (not Docker-internal)
 * - Images work best at 1200x630 for og:image
 */

import type { MediaItem } from './types';
import { getMediaUrl } from './api';
import { SITE_NAME, DEFAULT_BASE_URL } from './constants';

/**
 * Get the site's base URL for canonical links and og:url
 *
 * Uses NEXT_PUBLIC_BASE_URL environment variable, falling back to localhost.
 * In production, this should be set to your public domain
 */
export function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL || DEFAULT_BASE_URL;
}

/**
 * Get site name for OpenGraph og:site_name
 */
export function getSiteName(): string {
  return SITE_NAME;
}

/**
 * Determine the best media item for OpenGraph tags
 *
 * Strategy:
 * - Prefers images for og:image (better compatibility)
 * - Also returns video URL for og:video if available
 * - Uses forceExternal=true to ensure URLs are publicly accessible
 *
 * @param mediaItems - Array of media items from the API
 * @returns Object with imageUrl, videoUrl, and mimeType
 */
export function getBestMediaForOG(mediaItems: MediaItem[]): {
  imageUrl: string | null;
  videoUrl: string | null;
  mimeType: string | null;
} {
  const images = mediaItems.filter(m => m.media_type === 'image');
  const videos = mediaItems.filter(m => m.media_type === 'video');

  return {
    // Use forceExternal=true so social crawlers can access the images
    imageUrl: images.length > 0 ? getMediaUrl(images[0].url, true) : null,
    videoUrl: videos.length > 0 ? getMediaUrl(videos[0].url, true) : null,
    mimeType: videos.length > 0 ? videos[0].mime_type : null,
  };
}

/**
 * Truncate text to a maximum length, adding ellipsis if needed
 * OpenGraph descriptions should be ~160 characters max
 */
export function truncateForOG(text: string, maxLength = 160): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
