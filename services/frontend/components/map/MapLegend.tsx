'use client';

import { useState } from 'react';

interface MapLegendProps {
  className?: string;
}

export default function MapLegend({ className = '' }: MapLegendProps) {
  // Start minimized - user expands on demand
  const [collapsed, setCollapsed] = useState(true);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg p-2 ${className}`}
        title="Show legend"
      >
        <span className="text-lg">ℹ️</span>
      </button>
    );
  }

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3 text-sm ${className}`}>
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold text-gray-700 dark:text-gray-200">Legend</span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          title="Collapse legend"
        >
          ✕
        </button>
      </div>

      {/* Sources */}
      <div className="mb-3">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Sources</div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base">🇺🇦</span>
          <span className="text-gray-700 dark:text-gray-300">Ukrainian channel</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base">🇷🇺</span>
          <span className="text-gray-700 dark:text-gray-300">Russian channel</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base">🏳️</span>
          <span className="text-gray-700 dark:text-gray-300">Unknown affiliation</span>
        </div>
      </div>

      {/* Message Clusters */}
      <div className="mb-3">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">When zoomed out</div>
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-indigo-500 text-white text-xs flex items-center justify-center font-bold">5</span>
          <span className="text-gray-700 dark:text-gray-300">Grouped messages</span>
        </div>
      </div>

      {/* Confidence/Precision - shown as colored halos behind flags */}
      <div className="mb-3">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Location Precision (halo)</div>
        <div className="flex items-center gap-2 mb-1">
          <span className="w-4 h-4 rounded-full bg-green-500/30 border border-green-400 inline-block"></span>
          <span className="text-gray-700 dark:text-gray-300">High confidence</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <span className="w-5 h-5 rounded-full bg-yellow-500/30 border border-yellow-400 inline-block"></span>
          <span className="text-gray-700 dark:text-gray-300">Medium confidence</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-red-500/30 border border-red-400 inline-block"></span>
          <span className="text-gray-700 dark:text-gray-300">Low confidence</span>
        </div>
      </div>

      {/* Vessels (Shadow Fleet) */}
      <div className="mb-3">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Vessels (Shadow Fleet)</div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base">🚢</span>
          <span className="w-3 h-3 rounded-full bg-red-500 inline-block"></span>
          <span className="text-gray-700 dark:text-gray-300">Sanctioned</span>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base">🚢</span>
          <span className="w-3 h-3 rounded-full bg-amber-500 inline-block"></span>
          <span className="text-gray-700 dark:text-gray-300">RU destination</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-base">🚢</span>
          <span className="w-3 h-3 rounded-full bg-gray-500 inline-block"></span>
          <span className="text-gray-700 dark:text-gray-300">Tracked</span>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
        <span className="mr-1">📍</span>
        Locations extracted from message text. Precision varies.
      </div>
    </div>
  );
}
