'use client';

/**
 * ImmersiveMediaPlayer Component
 *
 * Full-viewport media player for immersive content viewing.
 *
 * Features:
 * - Full viewport (100vh, 100vw, fixed position)
 * - Dark background with glass overlay panels
 * - Manages queue of messages with media
 * - Keyboard navigation (Esc to close, arrows for navigation, space to pause)
 * - Auto-advance timer for images (videos auto-advance on end)
 * - Play/pause, mute/unmute controls
 * - Progress indicator and message counter
 */

import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { MediaRenderer } from './MediaRenderer';
import { useAutoAdvance } from '@/hooks/useAutoAdvance';
import { getMediaUrl } from '@/lib/api';
import type { Message } from '@/lib/types';

interface ImmersiveMediaPlayerProps {
  initialMessage: Message;
  messages?: Message[];
  onClose: () => void;
  autoAdvance?: boolean;
  autoAdvanceDelay?: number;
}

export function ImmersiveMediaPlayer({
  initialMessage,
  messages = [],
  onClose,
  autoAdvance = true,
  autoAdvanceDelay = 8000,
}: ImmersiveMediaPlayerProps) {
  // Build message queue (use provided messages or just the initial one)
  const messageQueue = messages.length > 0 ? messages : [initialMessage];

  // Find initial index
  const initialIndex = messageQueue.findIndex(m => m.id === initialMessage.id);
  const [currentIndex, setCurrentIndex] = useState(initialIndex >= 0 ? initialIndex : 0);
  const [isPaused, setIsPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showControls, setShowControls] = useState(true);

  const currentMessage = messageQueue[currentIndex];
  // Convert internal Docker URL (minio:9000) to browser-accessible URL (localhost:9000)
  const rawMediaUrl = currentMessage.first_media_url || currentMessage.media_urls?.[0];
  const currentMediaUrl = rawMediaUrl ? getMediaUrl(rawMediaUrl) : null;

  // Determine media type (use media_items if available, fallback to extension detection)
  const getMediaType = (): 'image' | 'video' | 'document' => {
    if (currentMessage.media_items && currentMessage.media_items.length > 0) {
      const type = currentMessage.media_items[0].media_type;
      return type === 'audio' ? 'document' : type;
    }

    // Fallback to extension-based detection
    if (!currentMediaUrl) return 'document';
    const ext = currentMediaUrl.toLowerCase().split('.').pop() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v', 'flv'].includes(ext)) return 'video';
    return 'document';
  };

  const mediaType = getMediaType();
  const isVideo = mediaType === 'video';

  // Navigation functions
  const goToNext = useCallback(() => {
    if (currentIndex < messageQueue.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setIsPaused(false);
    } else {
      // Loop back to start
      setCurrentIndex(0);
      setIsPaused(false);
    }
  }, [currentIndex, messageQueue.length]);

  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      setIsPaused(false);
    } else {
      // Loop to end
      setCurrentIndex(messageQueue.length - 1);
      setIsPaused(false);
    }
  }, [currentIndex, messageQueue.length]);

  // Auto-advance logic (only for images, videos handle their own via onEnded)
  const shouldAutoAdvance = autoAdvance && !isVideo && !isPaused;
  const { remainingTime, reset: resetTimer } = useAutoAdvance(
    shouldAutoAdvance,
    autoAdvanceDelay,
    goToNext,
    isPaused
  );

  // Reset timer when message changes
  useEffect(() => {
    resetTimer();
  }, [currentIndex, resetTimer]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowLeft':
          goToPrevious();
          break;
        case 'ArrowRight':
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
  }, [onClose, goToPrevious, goToNext]);

  // Auto-hide controls after 3 seconds of inactivity
  useEffect(() => {
    setShowControls(true);
    const timer = setTimeout(() => setShowControls(false), 3000);

    const handleMouseMove = () => {
      setShowControls(true);
      clearTimeout(timer);
      setTimeout(() => setShowControls(false), 3000);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [currentIndex]);

  // Handle video end
  const handleVideoEnd = useCallback(() => {
    if (autoAdvance && !isPaused) {
      goToNext();
    }
  }, [autoAdvance, isPaused, goToNext]);

  // Calculate progress percentage for images
  const progressPercent = shouldAutoAdvance
    ? ((autoAdvanceDelay - remainingTime) / autoAdvanceDelay) * 100
    : 0;

  return (
    <div className="fixed inset-0 z-[200] bg-black">
      {/* Media Renderer */}
      {currentMediaUrl && (
        <MediaRenderer
          mediaUrl={currentMediaUrl}
          mediaType={mediaType}
          onVideoEnd={handleVideoEnd}
          isPaused={isPaused}
          isMuted={isMuted}
        />
      )}

      {/* Controls Overlay */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Top Bar - Close and Info */}
        <div className="absolute top-0 left-0 right-0 p-4 pointer-events-auto">
          <div className="immersive-glass p-4 flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <h2 className="text-white text-lg font-medium truncate">
                {currentMessage.channel?.name || `Channel ${currentMessage.channel_id}`}
              </h2>
              <p className="text-gray-400 text-sm">
                {currentMessage.telegram_date && format(new Date(currentMessage.telegram_date), 'MMM d, yyyy • HH:mm')}
              </p>
            </div>

            <button
              onClick={onClose}
              className="ml-4 p-2 rounded-full hover:bg-white/10 transition-colors text-white"
              title="Close (Esc)"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Center Controls - Navigation Arrows */}
        {messageQueue.length > 1 && (
          <>
            <button
              onClick={goToPrevious}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-4 rounded-full immersive-glass hover:bg-white/20 transition-colors text-white pointer-events-auto"
              title="Previous (Left Arrow)"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <button
              onClick={goToNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-4 rounded-full immersive-glass hover:bg-white/20 transition-colors text-white pointer-events-auto"
              title="Next (Right Arrow)"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}

        {/* Bottom Bar - Playback Controls and Progress */}
        <div className="absolute bottom-0 left-0 right-0 p-4 pointer-events-auto">
          <div className="immersive-glass p-4">
            {/* Progress Bar (for images only) */}
            {!isVideo && autoAdvance && (
              <div className="w-full h-1 bg-white/20 rounded-full mb-3 overflow-hidden">
                <div
                  className="h-full bg-white/80 transition-all duration-100 ease-linear"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              {/* Left - Playback Controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsPaused(!isPaused)}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors text-white"
                  title={isPaused ? 'Play (Space)' : 'Pause (Space)'}
                >
                  {isPaused ? (
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>

                {isVideo && (
                  <button
                    onClick={() => setIsMuted(!isMuted)}
                    className="p-2 rounded-full hover:bg-white/10 transition-colors text-white"
                    title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
                  >
                    {isMuted ? (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                      </svg>
                    ) : (
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      </svg>
                    )}
                  </button>
                )}
              </div>

              {/* Center - Message Counter */}
              {messageQueue.length > 1 && (
                <div className="text-white text-sm font-medium">
                  {currentIndex + 1} / {messageQueue.length}
                </div>
              )}

              {/* Right - Keyboard Hints */}
              <div className="text-gray-400 text-xs hidden md:block">
                <span>Space: Pause</span>
                {isVideo && <span className="ml-3">M: Mute</span>}
                <span className="ml-3">← →: Navigate</span>
                <span className="ml-3">Esc: Close</span>
              </div>
            </div>
          </div>
        </div>

        {/* Content Caption (if exists) */}
        {currentMessage.content && (
          <div className="absolute bottom-24 left-4 right-4 pointer-events-auto">
            <div className="immersive-glass p-4 max-w-2xl">
              <p className="text-white text-sm leading-relaxed line-clamp-3">
                {currentMessage.content}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
