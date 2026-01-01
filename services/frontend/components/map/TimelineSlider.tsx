'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { format, subDays, subHours } from 'date-fns';

interface TimelineSliderProps {
  onRangeChange: (startDate: Date | null, endDate: Date | null) => void;
  className?: string;
}

type PresetType = 'last24h' | 'last7d' | 'last30d' | 'all';

interface Preset {
  id: PresetType;
  label: string;
  getRange: () => { start: Date | null; end: Date | null };
}

const PRESETS: Preset[] = [
  {
    id: 'last24h',
    label: 'Last 24h',
    getRange: () => ({ start: subHours(new Date(), 24), end: new Date() }),
  },
  {
    id: 'last7d',
    label: 'Last 7d',
    getRange: () => ({ start: subDays(new Date(), 7), end: new Date() }),
  },
  {
    id: 'last30d',
    label: 'Last 30d',
    getRange: () => ({ start: subDays(new Date(), 30), end: new Date() }),
  },
  {
    id: 'all',
    label: 'All time',
    getRange: () => ({ start: null, end: null }),
  },
];

// Animation speed: 1 hour per 100ms
const HOUR_PER_MS = 1 / 100;
const ANIMATION_INTERVAL_MS = 100;

export default function TimelineSlider({ onRangeChange, className = '' }: TimelineSliderProps) {
  // Start minimized - user expands on demand
  const [isMinimized, setIsMinimized] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState<PresetType>('all');
  const [isPlaying, setIsPlaying] = useState(false);
  const [customRange, setCustomRange] = useState<{ start: Date | null; end: Date | null }>({
    start: null,
    end: null,
  });
  const [currentAnimationDate, setCurrentAnimationDate] = useState<Date>(new Date());
  const animationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced range change callback
  const debouncedOnRangeChange = useCallback(
    (start: Date | null, end: Date | null) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        onRangeChange(start, end);
      }, 300);
    },
    [onRangeChange]
  );

  // Handle preset selection
  const handlePresetClick = (preset: Preset) => {
    setIsPlaying(false);
    setSelectedPreset(preset.id);
    const range = preset.getRange();
    setCustomRange(range);
    debouncedOnRangeChange(range.start, range.end);
  };

  // Handle play/pause
  const handlePlayPause = () => {
    if (isPlaying) {
      setIsPlaying(false);
      if (animationIntervalRef.current) {
        clearInterval(animationIntervalRef.current);
        animationIntervalRef.current = null;
      }
    } else {
      // Start animation from custom range start or 30 days ago
      const startDate = customRange.start || subDays(new Date(), 30);
      setCurrentAnimationDate(startDate);
      setIsPlaying(true);
    }
  };

  // Animation effect
  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    animationIntervalRef.current = setInterval(() => {
      setCurrentAnimationDate((prevDate) => {
        const now = new Date();
        const nextDate = new Date(prevDate.getTime() + HOUR_PER_MS * ANIMATION_INTERVAL_MS * 60 * 60 * 1000);

        // Stop if we've reached the end
        if (nextDate >= now) {
          setIsPlaying(false);
          if (animationIntervalRef.current) {
            clearInterval(animationIntervalRef.current);
            animationIntervalRef.current = null;
          }
          return now;
        }

        return nextDate;
      });
    }, ANIMATION_INTERVAL_MS);

    return () => {
      if (animationIntervalRef.current) {
        clearInterval(animationIntervalRef.current);
        animationIntervalRef.current = null;
      }
    };
  }, [isPlaying]);

  // Update range when animation progresses
  useEffect(() => {
    if (isPlaying) {
      const startDate = customRange.start || subDays(new Date(), 30);
      debouncedOnRangeChange(startDate, currentAnimationDate);
    }
  }, [isPlaying, currentAnimationDate, customRange.start, debouncedOnRangeChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (animationIntervalRef.current) {
        clearInterval(animationIntervalRef.current);
      }
    };
  }, []);

  // Format current date range for display
  const getDisplayRange = () => {
    if (selectedPreset === 'all' && !isPlaying) {
      return 'All time';
    }

    if (isPlaying) {
      const startDate = customRange.start || subDays(new Date(), 30);
      return `${format(startDate, 'MMM d, yyyy HH:mm')} - ${format(currentAnimationDate, 'MMM d, yyyy HH:mm')}`;
    }

    if (customRange.start && customRange.end) {
      return `${format(customRange.start, 'MMM d, yyyy')} - ${format(customRange.end, 'MMM d, yyyy')}`;
    }

    return 'All time';
  };

  // Minimized view - just a small button
  if (isMinimized) {
    return (
      <button
        onClick={() => setIsMinimized(false)}
        className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg px-4 py-2 flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${className}`}
        title="Show timeline controls"
      >
        <span className="text-lg">⏱️</span>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Timeline</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{getDisplayRange()}</span>
      </button>
    );
  }

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 ${className}`}
      style={{ minWidth: '400px', maxWidth: '600px' }}
    >
      {/* Header with minimize button */}
      <div className="mb-3 flex items-center justify-between">
        <div className="text-center flex-1">
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">Timeline</div>
          <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{getDisplayRange()}</div>
        </div>
        <button
          onClick={() => setIsMinimized(true)}
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          title="Minimize timeline"
        >
          ✕
        </button>
      </div>

      {/* Preset Buttons */}
      <div className="flex gap-2 mb-3">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            onClick={() => handlePresetClick(preset)}
            disabled={isPlaying}
            className={`
              flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors
              ${
                selectedPreset === preset.id && !isPlaying
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }
              ${isPlaying ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Play/Pause Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={handlePlayPause}
          className="flex items-center justify-center w-10 h-10 bg-blue-500 hover:bg-blue-600 text-white rounded-full transition-colors"
          title={isPlaying ? 'Pause animation' : 'Play animation'}
        >
          {isPlaying ? (
            <svg
              className="w-5 h-5"
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg
              className="w-5 h-5 ml-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                clipRule="evenodd"
              />
            </svg>
          )}
        </button>

        <div className="flex-1 text-xs text-gray-600">
          {isPlaying ? (
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              Animating timeline...
            </span>
          ) : (
            <span>Click play to animate through time</span>
          )}
        </div>
      </div>

      {/* Animation Progress Indicator */}
      {isPlaying && (
        <div className="mt-3">
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-100"
              style={{
                width: `${
                  ((currentAnimationDate.getTime() - (customRange.start?.getTime() || subDays(new Date(), 30).getTime())) /
                    (new Date().getTime() - (customRange.start?.getTime() || subDays(new Date(), 30).getTime()))) *
                  100
                }%`,
              }}
            ></div>
          </div>
        </div>
      )}
    </div>
  );
}
