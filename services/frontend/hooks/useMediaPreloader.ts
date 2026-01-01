/**
 * Media Preloader Hook for Immersive Media Mode
 *
 * Preloads upcoming media to ensure smooth transitions:
 * - Images: Full preload using Image()
 * - Videos: Metadata preload using <video preload="metadata">
 * - Automatic cleanup of old preloads to manage memory
 */

import { useEffect, useRef } from 'react';
import { getMediaUrl } from '@/lib/api';
import type { Message, MediaItem } from '@/lib/types';

export interface UseMediaPreloaderOptions {
  messages: Message[];
  currentIndex: number;
  preloadCount?: number; // default 3
}

/**
 * Hook for preloading media in the background
 *
 * Features:
 * - Preloads next N images (full download)
 * - Preloads next N videos (metadata only to reduce bandwidth)
 * - Cleans up old preloads automatically
 * - Handles media type detection
 */
export function useMediaPreloader({
  messages,
  currentIndex,
  preloadCount = 3,
}: UseMediaPreloaderOptions): void {
  // Track preloaded images for cleanup
  const preloadedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  // Track preloaded videos for cleanup
  const preloadedVideosRef = useRef<Map<string, HTMLVideoElement>>(new Map());

  useEffect(() => {
    // Calculate which messages to preload (next N)
    const startIndex = currentIndex + 1;
    const endIndex = Math.min(startIndex + preloadCount, messages.length);
    const messagesToPreload = messages.slice(startIndex, endIndex);

    console.log('[MediaPreloader] Preloading messages:', {
      currentIndex,
      startIndex,
      endIndex,
      count: messagesToPreload.length,
    });

    // Collect URLs to preload
    const urlsToPreload = new Set<string>();

    messagesToPreload.forEach(message => {
      if (message.media_items && message.media_items.length > 0) {
        // Use first media item for each message
        const mediaItem = message.media_items[0];
        const url = getMediaUrl(mediaItem.url);

        if (url) {
          urlsToPreload.add(url);
        }
      }
    });

    // Cleanup old preloads that are no longer needed
    const currentUrls = new Set(urlsToPreload);

    // Cleanup images
    preloadedImagesRef.current.forEach((img, url) => {
      if (!currentUrls.has(url)) {
        console.log('[MediaPreloader] Cleaning up image:', url);
        img.src = ''; // Release memory
        preloadedImagesRef.current.delete(url);
      }
    });

    // Cleanup videos
    preloadedVideosRef.current.forEach((video, url) => {
      if (!currentUrls.has(url)) {
        console.log('[MediaPreloader] Cleaning up video:', url);
        video.src = ''; // Release memory
        video.load(); // Force cleanup
        preloadedVideosRef.current.delete(url);
      }
    });

    // Preload new media
    messagesToPreload.forEach(message => {
      if (!message.media_items || message.media_items.length === 0) {
        return;
      }

      const mediaItem = message.media_items[0];
      const url = getMediaUrl(mediaItem.url);

      if (!url) {
        return;
      }

      // Skip if already preloaded
      if (preloadedImagesRef.current.has(url) || preloadedVideosRef.current.has(url)) {
        return;
      }

      // Determine media type and preload accordingly
      if (mediaItem.media_type === 'image') {
        preloadImage(url);
      } else if (mediaItem.media_type === 'video') {
        preloadVideo(url);
      }
    });

    // Cleanup function
    return () => {
      // Don't cleanup on every effect run - only when component unmounts
      // This prevents flickering and re-downloads
    };
  }, [messages, currentIndex, preloadCount]);

  /**
   * Preload an image using Image()
   */
  const preloadImage = (url: string) => {
    if (preloadedImagesRef.current.has(url)) {
      return;
    }

    console.log('[MediaPreloader] Preloading image:', url);

    const img = new Image();

    img.onload = () => {
      console.log('[MediaPreloader] Image loaded:', url);
    };

    img.onerror = (error) => {
      console.error('[MediaPreloader] Failed to load image:', url, error);
      // Remove from cache so we can retry later
      preloadedImagesRef.current.delete(url);
    };

    // Start loading
    img.src = url;

    // Store reference for cleanup
    preloadedImagesRef.current.set(url, img);
  };

  /**
   * Preload video metadata using <video> element
   * This loads just enough to get duration, dimensions, etc. without downloading full video
   */
  const preloadVideo = (url: string) => {
    if (preloadedVideosRef.current.has(url)) {
      return;
    }

    console.log('[MediaPreloader] Preloading video metadata:', url);

    const video = document.createElement('video');
    video.preload = 'metadata'; // Only load metadata, not full video
    video.muted = true; // Muted to allow autoplay policies

    video.onloadedmetadata = () => {
      console.log('[MediaPreloader] Video metadata loaded:', url);
    };

    video.onerror = (error) => {
      console.error('[MediaPreloader] Failed to load video:', url, error);
      // Remove from cache so we can retry later
      preloadedVideosRef.current.delete(url);
    };

    // Start loading
    video.src = url;

    // Store reference for cleanup
    preloadedVideosRef.current.set(url, video);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('[MediaPreloader] Cleaning up all preloads on unmount');

      // Cleanup all images
      preloadedImagesRef.current.forEach((img) => {
        img.src = '';
      });
      preloadedImagesRef.current.clear();

      // Cleanup all videos
      preloadedVideosRef.current.forEach((video) => {
        video.src = '';
        video.load();
      });
      preloadedVideosRef.current.clear();
    };
  }, []);
}
