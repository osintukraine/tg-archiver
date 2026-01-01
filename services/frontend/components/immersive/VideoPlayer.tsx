'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getMediaUrl } from '@/lib/api';
import { MediaDots } from './MediaDots';
import type { Message } from '@/lib/types';

interface VideoPlayerProps {
  message: Message;
  isPaused: boolean;
  isMuted: boolean;
  onVideoEnd?: () => void;
  onPauseChange?: (paused: boolean) => void;
}

export function VideoPlayer({
  message,
  isPaused,
  isMuted,
  onVideoEnd,
  onPauseChange,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get all media items (videos first, then images)
  const mediaItems = (message.media_items || [])
    .filter(item => item.media_type === 'video' || item.media_type === 'image')
    .sort((a, b) => {
      if (a.media_type === 'video' && b.media_type !== 'video') return -1;
      if (a.media_type !== 'video' && b.media_type === 'video') return 1;
      return 0;
    });

  const currentMedia = mediaItems[currentMediaIndex];
  const mediaUrl = currentMedia ? getMediaUrl(currentMedia.url) : null;
  const isVideo = currentMedia?.media_type === 'video';

  // Handle video play/pause
  useEffect(() => {
    if (!videoRef.current || !isVideo) return;

    if (isPaused) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(err => {
        console.error('Video autoplay failed:', err);
      });
    }
  }, [isPaused, isVideo]);

  // Handle mute
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
    }
  }, [isMuted]);

  // Reset when message changes
  useEffect(() => {
    setCurrentMediaIndex(0);
    setError(null);
    setIsLoading(true);
  }, [message.id]);

  // Swipe handling for multi-media
  const handleSwipe = useCallback((direction: 'left' | 'right') => {
    if (direction === 'left' && currentMediaIndex < mediaItems.length - 1) {
      setCurrentMediaIndex(prev => prev + 1);
    } else if (direction === 'right' && currentMediaIndex > 0) {
      setCurrentMediaIndex(prev => prev - 1);
    }
  }, [currentMediaIndex, mediaItems.length]);

  // Touch handling
  const touchStartX = useRef(0);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      handleSwipe(diff > 0 ? 'left' : 'right');
    }
  };

  // Click to toggle pause
  const handleClick = () => {
    onPauseChange?.(!isPaused);
  };

  if (!mediaUrl) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <p className="text-white/60">No media available</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-2">Failed to load media</p>
          <p className="text-white/40 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={handleClick}
    >
      {/* Loading spinner */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Media */}
      {isVideo ? (
        <video
          ref={videoRef}
          src={mediaUrl}
          className="max-w-full max-h-full object-contain"
          autoPlay
          muted={isMuted}
          playsInline
          onLoadedData={() => setIsLoading(false)}
          onEnded={onVideoEnd}
          onError={() => {
            setIsLoading(false);
            setError('Failed to load video');
          }}
        />
      ) : (
        <img
          src={mediaUrl}
          alt=""
          className="max-w-full max-h-full object-contain"
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false);
            setError('Failed to load image');
          }}
        />
      )}

      {/* Multi-media dots */}
      <div className="absolute bottom-32 left-0 right-0">
        <MediaDots
          total={mediaItems.length}
          current={currentMediaIndex}
          onSelect={setCurrentMediaIndex}
        />
      </div>

      {/* Pause indicator */}
      {isPaused && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-20 h-20 rounded-full bg-black/60 flex items-center justify-center">
            <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
