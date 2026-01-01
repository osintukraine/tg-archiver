/**
 * Media Queue Hook for Immersive Media Mode
 *
 * Manages a queue of messages with media, providing:
 * - Pagination with automatic loading near the end
 * - Deduplication by message_id
 * - Navigation controls (next/prev)
 * - Real-time message insertion at the front
 */

import { useState, useCallback, useRef } from 'react';
import { fetchMessagesWithMedia } from '@/lib/api';
import type { Message } from '@/lib/types';

export interface UseMediaQueueOptions {
  initialMessages: Message[];
  filters?: {
    channelId?: number;
    hasMedia?: boolean;
    startDate?: Date;
  };
  pageSize?: number;
}

export interface UseMediaQueueReturn {
  messages: Message[];
  currentIndex: number;
  setCurrentIndex: (index: number) => void;
  hasMore: boolean;
  isLoading: boolean;
  loadMore: () => Promise<void>;
  prependMessage: (message: Message) => void;
  goToNext: () => void;
  goToPrevious: () => void;
}

/**
 * Hook for managing a queue of messages with media
 *
 * Features:
 * - Auto-load more when nearing end (within 5 items)
 * - Deduplication by message_id
 * - Prepend new messages from WebSocket
 * - Navigation helpers
 */
export function useMediaQueue({
  initialMessages,
  filters = {},
  pageSize = 20,
}: UseMediaQueueOptions): UseMediaQueueReturn {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Track loaded message IDs for deduplication
  const loadedMessageIds = useRef(new Set(initialMessages.map(m => m.id)));

  /**
   * Load more messages from the API
   */
  const loadMore = useCallback(async () => {
    if (isLoading || !hasMore) {
      console.log('[MediaQueue] Skipping loadMore:', { isLoading, hasMore });
      return;
    }

    setIsLoading(true);

    try {
      const params = {
        limit: pageSize,
        offset: messages.length,
        channelId: filters.channelId,
        startDate: filters.startDate?.toISOString(),
      };

      console.log('[MediaQueue] Loading more messages:', params);
      const result = await fetchMessagesWithMedia(params);

      // Filter out duplicates
      const newMessages = result.messages.filter(msg => {
        if (loadedMessageIds.current.has(msg.id)) {
          console.log('[MediaQueue] Skipping duplicate message:', msg.id);
          return false;
        }
        loadedMessageIds.current.add(msg.id);
        return true;
      });

      console.log('[MediaQueue] Loaded messages:', {
        total: result.total,
        new: newMessages.length,
        hasMore: result.hasMore,
      });

      setMessages(prev => [...prev, ...newMessages]);
      setHasMore(result.hasMore);
    } catch (error) {
      console.error('[MediaQueue] Failed to load more messages:', error);
      // Don't set hasMore to false on error - allow retry
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, hasMore, messages.length, pageSize, filters]);

  /**
   * Prepend a new message to the front of the queue
   * Used for real-time WebSocket updates
   */
  const prependMessage = useCallback((message: Message) => {
    // Check if message already exists
    if (loadedMessageIds.current.has(message.id)) {
      console.log('[MediaQueue] Message already in queue:', message.id);
      return;
    }

    console.log('[MediaQueue] Prepending new message:', message.id);
    loadedMessageIds.current.add(message.id);

    setMessages(prev => [message, ...prev]);

    // If we're at the start, we should still be on the same message
    // (index 0 is now the new message, so increment to stay on current)
    setCurrentIndex(prev => prev + 1);
  }, []);

  /**
   * Navigate to next message
   */
  const goToNext = useCallback(() => {
    setCurrentIndex(prev => {
      const nextIndex = Math.min(prev + 1, messages.length - 1);

      // If we're getting close to the end, trigger auto-load
      if (messages.length - nextIndex <= 5 && hasMore && !isLoading) {
        console.log('[MediaQueue] Near end, auto-loading more...');
        loadMore();
      }

      return nextIndex;
    });
  }, [messages.length, hasMore, isLoading, loadMore]);

  /**
   * Navigate to previous message
   */
  const goToPrevious = useCallback(() => {
    setCurrentIndex(prev => Math.max(prev - 1, 0));
  }, []);

  /**
   * Set current index with validation
   */
  const setValidatedIndex = useCallback((index: number) => {
    const validatedIndex = Math.max(0, Math.min(index, messages.length - 1));

    // If we're getting close to the end, trigger auto-load
    if (messages.length - validatedIndex <= 5 && hasMore && !isLoading) {
      console.log('[MediaQueue] Near end, auto-loading more...');
      loadMore();
    }

    setCurrentIndex(validatedIndex);
  }, [messages.length, hasMore, isLoading, loadMore]);

  return {
    messages,
    currentIndex,
    setCurrentIndex: setValidatedIndex,
    hasMore,
    isLoading,
    loadMore,
    prependMessage,
    goToNext,
    goToPrevious,
  };
}
