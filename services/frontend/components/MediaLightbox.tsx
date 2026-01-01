'use client';

/**
 * MediaLightbox Component
 *
 * Full-screen media viewer with keyboard navigation for albums.
 *
 * Features:
 * - Click any image/video to open in fullscreen modal
 * - Left/Right arrow keys or buttons to navigate albums
 * - Escape key or click outside to close
 * - Touch swipe support for mobile
 * - Preloads adjacent images for smooth navigation
 */

import { useState, useEffect, useCallback } from 'react';

interface MediaLightboxProps {
  mediaUrls: string[];
  initialIndex?: number;
  isOpen: boolean;
  onClose: () => void;
  getMediaType: (url: string) => 'image' | 'video' | 'document';
}

export function MediaLightbox({
  mediaUrls,
  initialIndex = 0,
  isOpen,
  onClose,
  getMediaType,
}: MediaLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Reset to initial index when opening
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex);
      setIsLoading(true);
    }
  }, [isOpen, initialIndex]);

  // Navigation functions
  const goToPrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : mediaUrls.length - 1));
    setIsLoading(true);
  }, [mediaUrls.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev < mediaUrls.length - 1 ? prev + 1 : 0));
    setIsLoading(true);
  }, [mediaUrls.length]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, goToPrevious, goToNext]);

  // Touch swipe support
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart === null) return;

    const touchEnd = e.changedTouches[0].clientX;
    const diff = touchStart - touchEnd;

    // Minimum swipe distance of 50px
    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        goToNext();
      } else {
        goToPrevious();
      }
    }

    setTouchStart(null);
  };

  // Preload adjacent images
  useEffect(() => {
    if (!isOpen) return;

    const preloadIndices = [
      (currentIndex - 1 + mediaUrls.length) % mediaUrls.length,
      (currentIndex + 1) % mediaUrls.length,
    ];

    preloadIndices.forEach((index) => {
      const url = mediaUrls[index];
      if (getMediaType(url) === 'image') {
        const img = new Image();
        img.src = url;
      }
    });
  }, [isOpen, currentIndex, mediaUrls, getMediaType]);

  if (!isOpen || mediaUrls.length === 0) return null;

  const currentUrl = mediaUrls[currentIndex];
  const currentMediaType = getMediaType(currentUrl);
  const hasMultiple = mediaUrls.length > 1;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Close button */}
      <button
        className="absolute top-4 right-4 z-10 p-3 sm:p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white"
        onClick={onClose}
        title="Close (Esc)"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Counter */}
      {hasMultiple && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full bg-white/10 text-white text-sm font-medium">
          {currentIndex + 1} / {mediaUrls.length}
        </div>
      )}

      {/* Previous button */}
      {hasMultiple && (
        <button
          className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-10 p-4 sm:p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white"
          onClick={(e) => {
            e.stopPropagation();
            goToPrevious();
          }}
          title="Previous (Left Arrow)"
        >
          <svg className="w-6 h-6 sm:w-8 sm:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* Next button */}
      {hasMultiple && (
        <button
          className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-10 p-4 sm:p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white"
          onClick={(e) => {
            e.stopPropagation();
            goToNext();
          }}
          title="Next (Right Arrow)"
        >
          <svg className="w-6 h-6 sm:w-8 sm:h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Media content */}
      <div
        className="max-w-[90vw] max-h-[90vh] relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Loading spinner */}
        {isLoading && currentMediaType === 'image' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {currentMediaType === 'image' && (
          <img
            src={currentUrl}
            alt={`Media ${currentIndex + 1} of ${mediaUrls.length}`}
            className={`max-w-[90vw] max-h-[90vh] object-contain transition-opacity duration-200 ${
              isLoading ? 'opacity-0' : 'opacity-100'
            }`}
            onLoad={() => setIsLoading(false)}
            draggable={false}
          />
        )}

        {currentMediaType === 'video' && (
          <video
            controls
            autoPlay
            muted
            playsInline
            className="max-w-[90vw] max-h-[90vh]"
            onLoadedData={() => setIsLoading(false)}
          >
            <source src={currentUrl} />
          </video>
        )}

        {currentMediaType === 'document' && (
          <div className="bg-bg-secondary p-8 rounded-lg text-center">
            <svg className="w-16 h-16 mx-auto mb-4 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <a
              href={currentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-primary hover:underline text-lg"
            >
              Download Document
            </a>
            <p className="text-text-tertiary text-sm mt-2">
              {currentUrl.split('/').pop()}
            </p>
          </div>
        )}
      </div>

      {/* Thumbnail strip for albums */}
      {hasMultiple && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex gap-2 p-2 bg-black/50 rounded-lg max-w-[90vw] overflow-x-auto">
          {mediaUrls.map((url, index) => {
            const thumbType = getMediaType(url);
            const isActive = index === currentIndex;

            return (
              <button
                key={index}
                className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                  isActive
                    ? 'border-accent-primary scale-105'
                    : 'border-transparent opacity-60 hover:opacity-100'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentIndex(index);
                  setIsLoading(true);
                }}
                title={`View media ${index + 1}`}
              >
                {thumbType === 'image' && (
                  <img
                    src={url}
                    alt={`Thumbnail ${index + 1}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                )}
                {thumbType === 'video' && (
                  <div className="w-full h-full bg-bg-tertiary flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                    </svg>
                  </div>
                )}
                {thumbType === 'document' && (
                  <div className="w-full h-full bg-bg-tertiary flex items-center justify-center">
                    <svg className="w-6 h-6 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Keyboard hints */}
      <div className="absolute bottom-4 right-4 text-white/50 text-xs hidden md:block">
        {hasMultiple && <span>← → Navigate</span>}
        <span className="ml-4">Esc Close</span>
      </div>
    </div>
  );
}
