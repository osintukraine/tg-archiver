'use client';

import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useImmersive } from '@/contexts/ImmersiveContext';
import { useSmartQueue } from '@/hooks/useSmartQueue';
import { StreamView } from './StreamView';
import { GridView } from './GridView';

// Inner component that uses useSearchParams (requires Suspense boundary)
function ImmersiveViewInner() {
  const {
    isImmersive,
    viewMode,
    setQueue,
    currentIndex,
    toggleImmersive,
    sortMode,
    markAsViewed,
    queue,
  } = useImmersive();
  const searchParams = useSearchParams();
  const hasAutoEntered = useRef(false);

  // Get startMessageId from URL params (e.g., ?startMessageId=8311)
  const startMessageIdParam = searchParams.get('startMessageId');
  const startMessageId = useMemo(
    () => startMessageIdParam ? parseInt(startMessageIdParam, 10) : null,
    [startMessageIdParam]
  );

  // Auto-enter immersive mode if startMessageId is in URL (once per page load)
  useEffect(() => {
    if (startMessageId && !isImmersive && !hasAutoEntered.current) {
      hasAutoEntered.current = true;
      toggleImmersive();
    }
  }, [startMessageId, isImmersive, toggleImmersive]);

  // Fetch smart queue when immersive mode is enabled
  // skipWatched is handled at navigation level in context, not at data level
  const { messages, isLoading, error, hasMore, loadMore } = useSmartQueue({
    enabled: isImmersive,
    pageSize: 20,
    focusVideo: true,
    startMessageId,
    sortMode,
  });

  // Mark current message as viewed when it changes
  useEffect(() => {
    if (queue.length > 0 && currentIndex >= 0 && currentIndex < queue.length) {
      const currentMessage = queue[currentIndex];
      if (currentMessage?.id) {
        markAsViewed(currentMessage.id);
      }
    }
  }, [currentIndex, queue, markAsViewed]);

  // Update queue when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setQueue(messages);
    }
  }, [messages, setQueue]);

  // Auto-load more when approaching the end of the queue
  useEffect(() => {
    const LOAD_MORE_THRESHOLD = 5; // Load more when within 5 items of the end
    if (
      hasMore &&
      !isLoading &&
      messages.length > 0 &&
      currentIndex >= messages.length - LOAD_MORE_THRESHOLD
    ) {
      loadMore();
    }
  }, [currentIndex, messages.length, hasMore, isLoading, loadMore]);

  // Handle Escape key to exit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isImmersive) {
        toggleImmersive();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isImmersive, toggleImmersive]);

  // Don't render if not in immersive mode
  if (!isImmersive) return null;

  // Loading state
  if (isLoading && messages.length === 0) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white/60">Loading media queue...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-2">Failed to load queue</p>
          <p className="text-white/40 text-sm">{error.message}</p>
          <button
            onClick={toggleImmersive}
            className="mt-4 px-4 py-2 bg-white/10 rounded-lg text-white hover:bg-white/20"
          >
            Exit Immersive Mode
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100]">
      {viewMode === 'stream' ? <StreamView /> : <GridView />}
    </div>
  );
}

// Wrapper component with Suspense boundary (required for useSearchParams in Next.js 14)
export function ImmersiveView() {
  return (
    <Suspense fallback={null}>
      <ImmersiveViewInner />
    </Suspense>
  );
}
