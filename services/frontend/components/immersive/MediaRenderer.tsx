'use client';

/**
 * MediaRenderer Component
 *
 * Handles full-screen display of images and videos in immersive mode.
 *
 * Features:
 * - Full viewport object-cover display
 * - Videos auto-play MUTED (required for browser auto-play policies)
 * - Video onEnded callback for auto-advance
 * - Graceful error handling with fallback UI
 * - Respects pause/mute states for playback control
 */

import { useState, useEffect, useRef } from 'react';

interface MediaRendererProps {
  mediaUrl: string;
  mediaType: 'image' | 'video' | 'document';
  onVideoEnd?: () => void;
  isPaused?: boolean;
  isMuted?: boolean;
}

export function MediaRenderer({
  mediaUrl,
  mediaType,
  onVideoEnd,
  isPaused = false,
  isMuted = true,
}: MediaRendererProps) {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Handle video play/pause state
  useEffect(() => {
    if (!videoRef.current) return;

    if (isPaused) {
      videoRef.current.pause();
    } else {
      // Auto-play (muted is required for browser auto-play policies)
      videoRef.current.play().catch((err) => {
        console.error('Video autoplay failed:', err);
        setError('Video playback failed. Click to play manually.');
      });
    }
  }, [isPaused]);

  // Handle mute state changes
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted ?? true;
    }
  }, [isMuted]);

  // Reset states when media URL changes
  useEffect(() => {
    setError(null);
    setIsLoading(true);
  }, [mediaUrl]);

  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        <div className="text-center p-8">
          <svg
            className="w-16 h-16 text-red-400 mx-auto mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-white text-lg mb-2">Failed to load media</p>
          <p className="text-gray-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (mediaType === 'image') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        {/* Loading spinner */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}

        <img
          src={mediaUrl}
          alt="Media content"
          className={`max-w-full max-h-full object-contain transition-opacity duration-300 ${
            isLoading ? 'opacity-0' : 'opacity-100'
          }`}
          onLoad={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false);
            setError('Failed to load image');
          }}
        />
      </div>
    );
  }

  if (mediaType === 'video') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black">
        {/* Loading spinner */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}

        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          autoPlay
          muted={isMuted ?? true}
          playsInline
          onEnded={onVideoEnd}
          onLoadedData={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false);
            setError('Failed to load video');
          }}
        >
          <source src={mediaUrl} />
          Your browser does not support video playback.
        </video>
      </div>
    );
  }

  // Document fallback
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black">
      <div className="text-center p-8">
        <svg
          className="w-24 h-24 text-gray-400 mx-auto mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
        <p className="text-white text-lg mb-4">Document Preview Not Available</p>
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          Download File
        </a>
      </div>
    </div>
  );
}
