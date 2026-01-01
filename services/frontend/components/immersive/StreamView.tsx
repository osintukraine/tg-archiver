'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useImmersive } from '@/contexts/ImmersiveContext';
import { VideoPlayer } from './VideoPlayer';
import { GlassPanel } from './GlassPanel';
import { ImmersiveControls } from './ImmersiveControls';
import { GeoBackground } from './GeoBackground';
import { RssTicker } from './RssTicker';

const AUTO_ADVANCE_DELAY = 8000; // 8s for images

export function StreamView() {
  const { queue, currentIndex, goToNext, goToPrevious, setCurrentIndex, layers } = useImmersive();
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showControls, setShowControls] = useState(true);
  const autoAdvanceTimer = useRef<NodeJS.Timeout | null>(null);

  const currentMessage = queue[currentIndex];

  // Auto-hide controls
  useEffect(() => {
    setShowControls(true);
    const timer = setTimeout(() => setShowControls(false), 3000);

    const handleMouseMove = () => {
      setShowControls(true);
      clearTimeout(timer);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [currentIndex]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowLeft':
          e.preventDefault();
          goToPrevious();
          break;
        case 'ArrowDown':
        case 'ArrowRight':
          e.preventDefault();
          goToNext();
          break;
        case ' ':
          e.preventDefault();
          setIsPaused(prev => !prev);
          break;
        case 'm':
        case 'M':
          setIsMuted(prev => !prev);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToNext, goToPrevious]);

  // Auto-advance for images
  const currentHasVideo = currentMessage?.media_items?.some(
    item => item.media_type === 'video'
  );

  useEffect(() => {
    if (autoAdvanceTimer.current) {
      clearTimeout(autoAdvanceTimer.current);
    }

    if (!isPaused && !currentHasVideo && currentMessage) {
      autoAdvanceTimer.current = setTimeout(() => {
        goToNext();
      }, AUTO_ADVANCE_DELAY);
    }

    return () => {
      if (autoAdvanceTimer.current) {
        clearTimeout(autoAdvanceTimer.current);
      }
    };
  }, [currentIndex, isPaused, currentHasVideo, currentMessage, goToNext]);

  // Handle video end
  const handleVideoEnd = useCallback(() => {
    if (!isPaused) {
      // Small delay before advancing
      setTimeout(() => goToNext(), 2000);
    }
  }, [isPaused, goToNext]);

  // Touch handling for vertical swipe
  const touchStartY = useRef(0);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartY.current - e.changedTouches[0].clientY;
    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        goToNext();
      } else {
        goToPrevious();
      }
    }
  };

  if (!currentMessage) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <p className="text-white/60">No messages in queue</p>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Geo Background Layer (behind everything) */}
      <GeoBackground
        latitude={currentMessage.location?.latitude ?? null}
        longitude={currentMessage.location?.longitude ?? null}
        enabled={layers.geo}
      />

      {/* Video/Image Player */}
      <VideoPlayer
        message={currentMessage}
        isPaused={isPaused}
        isMuted={isMuted}
        onVideoEnd={handleVideoEnd}
        onPauseChange={setIsPaused}
      />

      {/* RSS Ticker Layer */}
      <RssTicker
        messageId={currentMessage.id}
        enabled={layers.rss}
      />

      {/* Controls overlay */}
      <div
        className={`transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <ImmersiveControls />
      </div>

      {/* Glass panel */}
      <GlassPanel message={currentMessage} />

      {/* Navigation hints */}
      <div
        className={`absolute left-4 top-1/2 -translate-y-1/2 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {currentIndex > 0 && (
          <button
            onClick={goToPrevious}
            className="p-3 rounded-full bg-black/60 backdrop-blur-sm text-white hover:bg-black/80"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
      </div>

      <div
        className={`absolute right-4 top-1/2 -translate-y-1/2 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {currentIndex < queue.length - 1 && (
          <button
            onClick={goToNext}
            className="p-3 rounded-full bg-black/60 backdrop-blur-sm text-white hover:bg-black/80"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* Video controls - mute/unmute and pause/play */}
      <div
        className={`absolute bottom-40 right-4 flex flex-col gap-2 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Mute/Unmute button */}
        <button
          onClick={() => setIsMuted(!isMuted)}
          className="p-3 rounded-full bg-black/60 backdrop-blur-sm text-white hover:bg-black/80"
          title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
        >
          {isMuted ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          )}
        </button>

        {/* Pause/Play button */}
        <button
          onClick={() => setIsPaused(!isPaused)}
          className="p-3 rounded-full bg-black/60 backdrop-blur-sm text-white hover:bg-black/80"
          title={isPaused ? 'Play (Space)' : 'Pause (Space)'}
        >
          {isPaused ? (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
