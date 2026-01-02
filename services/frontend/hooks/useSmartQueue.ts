'use client';

import { useState, useEffect, useCallback } from 'react';
import { searchMessages, getMessage } from '@/lib/api';
import type { Message } from '@/lib/types';
import type { SortMode } from '@/contexts/ImmersiveContext';

interface UseSmartQueueOptions {
  enabled: boolean;
  pageSize?: number;
  focusVideo?: boolean;
  startMessageId?: number | null;
  // Queue control options
  sortMode?: SortMode;
}

interface UseSmartQueueResult {
  messages: Message[];
  isLoading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useSmartQueue({
  enabled,
  pageSize = 20,
  focusVideo = true,
  startMessageId = null,
  sortMode = 'newest',
}: UseSmartQueueOptions): UseSmartQueueResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);

  const fetchMessages = useCallback(async (pageNum: number, append: boolean = false) => {
    if (!enabled) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await searchMessages({
        has_media: true,
        page_size: pageSize,
        page: pageNum,
        sort_by: 'telegram_date',
        sort_order: 'desc',
      });

      // Filter to messages with video/image media
      let filtered = result.items.filter(m => {
        // Check for video or image media
        const hasVideo = m.media_items?.some(item => item.media_type === 'video');
        const hasImage = m.media_items?.some(item => item.media_type === 'image');

        if (focusVideo) {
          return hasVideo || hasImage;
        }
        return true;
      });

      // Note: skipWatched is handled at navigation level, not filtering
      // This keeps all videos in queue but auto-skips watched when navigating

      // Apply smart score sorting (only if user selected it)
      if (sortMode === 'smart') {
        filtered.sort((a, b) => {
          const scoreA = getSmartScore(a);
          const scoreB = getSmartScore(b);
          return scoreB - scoreA;
        });
      }
      // sortMode === 'newest' keeps API order (already sorted by telegram_date DESC)

      // If startMessageId is provided, ensure it's at the front
      if (startMessageId && pageNum === 1) {
        const startIndex = filtered.findIndex(m => m.id === startMessageId);
        if (startIndex > 0) {
          // Found in queue - move to front
          const [startMessage] = filtered.splice(startIndex, 1);
          filtered.unshift(startMessage);
        } else if (startIndex === -1) {
          // Not in queue - fetch it separately and prepend
          try {
            const targetMessage = await getMessage(startMessageId);
            if (targetMessage) {
              filtered.unshift(targetMessage);
            }
          } catch {
            // Message doesn't exist or failed to fetch - continue without it
            console.warn(`Could not fetch startMessageId ${startMessageId}`);
          }
        }
        // startIndex === 0 means already at front, no action needed
      }

      if (append) {
        setMessages(prev => [...prev, ...filtered]);
      } else {
        setMessages(filtered);
      }

      setHasMore(result.has_next);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch messages'));
    } finally {
      setIsLoading(false);
    }
  }, [enabled, pageSize, focusVideo, startMessageId, sortMode]);

  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    await fetchMessages(nextPage, true);
  }, [isLoading, hasMore, page, fetchMessages]);

  const refresh = useCallback(async () => {
    setPage(1);
    await fetchMessages(1, false);
  }, [fetchMessages]);

  // Initial fetch when enabled, and refetch when sort options change
  useEffect(() => {
    if (enabled) {
      setPage(1);
      fetchMessages(1, false);
    }
  }, [enabled, sortMode]);

  return {
    messages,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
  };
}

/**
 * Calculate smart score for prioritization
 * Higher score = shown first
 */
function getSmartScore(message: Message): number {
  let score = 0;

  // Recency weight (decay over 48 hours, max +100 for brand new)
  if (message.telegram_date) {
    const ageHours = (Date.now() - new Date(message.telegram_date).getTime()) / (1000 * 60 * 60);
    const recencyScore = Math.max(0, 100 - (ageHours / 48) * 100);
    score += recencyScore;
  }

  // Video bonus (+25 for videos)
  const hasVideo = message.media_items?.some(item => item.media_type === 'video');
  if (hasVideo) score += 25;

  // Engagement bonus (views)
  if (message.views && message.views > 1000) {
    score += Math.min(25, message.views / 10000);
  }

  return score;
}
