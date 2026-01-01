'use client';

import React, { useState, useCallback, useRef } from 'react';

interface TimeRangeSliderProps {
  value: number; // hours
  onChange: (hours: number) => void;
  min?: number;
  max?: number;
}

// Preset values in hours for quick access buttons
const PRESETS = [1, 6, 12, 24, 48, 72, 168]; // 1h, 6h, 12h, 24h, 2d, 3d, 7d

function formatHours(hours: number): string {
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (remainingHours === 0) {
    return `${days}d`;
  }
  return `${days}d ${remainingHours}h`;
}

export function TimeRangeSlider({
  value,
  onChange,
  min = 1,
  max = 168
}: TimeRangeSliderProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  // Handle slider change with debounce
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(e.target.value, 10);
    setDisplayValue(newValue);

    // Clear any pending debounce
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    // Debounce the actual API call
    debounceTimer.current = setTimeout(() => {
      onChange(newValue);
    }, 400);
  }, [onChange]);

  // Handle preset button click - immediate, no debounce
  const handlePresetClick = useCallback((preset: number) => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    setDisplayValue(preset);
    onChange(preset);
  }, [onChange]);

  // Calculate percentage for gradient
  const percentage = ((displayValue - min) / (max - min)) * 100;

  return (
    <div className="w-full max-w-md">
      <div className="flex items-center gap-4">
        {/* Min label */}
        <span className="text-xs text-gray-400 w-8">
          {formatHours(min)}
        </span>

        {/* Slider container */}
        <div className="flex-1 relative">
          <input
            type="range"
            min={min}
            max={max}
            value={displayValue}
            onChange={handleChange}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer
                       [&::-webkit-slider-thumb]:appearance-none
                       [&::-webkit-slider-thumb]:w-4
                       [&::-webkit-slider-thumb]:h-4
                       [&::-webkit-slider-thumb]:rounded-full
                       [&::-webkit-slider-thumb]:bg-blue-500
                       [&::-webkit-slider-thumb]:cursor-pointer
                       [&::-webkit-slider-thumb]:shadow-md
                       [&::-webkit-slider-thumb]:hover:bg-blue-400
                       [&::-moz-range-thumb]:w-4
                       [&::-moz-range-thumb]:h-4
                       [&::-moz-range-thumb]:rounded-full
                       [&::-moz-range-thumb]:bg-blue-500
                       [&::-moz-range-thumb]:border-0
                       [&::-moz-range-thumb]:cursor-pointer"
            style={{
              background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${percentage}%, #374151 ${percentage}%, #374151 100%)`,
            }}
          />

          {/* Current value label */}
          <div
            className="absolute -top-6 transform -translate-x-1/2 text-sm font-medium text-blue-400"
            style={{ left: `${percentage}%` }}
          >
            {formatHours(displayValue)}
          </div>
        </div>

        {/* Max label */}
        <span className="text-xs text-gray-400 w-8 text-right">
          {formatHours(max)}
        </span>
      </div>

      {/* Preset quick buttons */}
      <div className="flex justify-between mt-3 px-8">
        {PRESETS.filter(p => p >= min && p <= max).map((preset) => (
          <button
            key={preset}
            onClick={() => handlePresetClick(preset)}
            className={`text-xs px-2 py-1 rounded transition-colors
              ${displayValue === preset
                ? 'bg-blue-900 text-blue-300'
                : 'text-gray-400 hover:bg-gray-800'
              }`}
          >
            {formatHours(preset)}
          </button>
        ))}
      </div>
    </div>
  );
}
