'use client';

import { useState, useEffect } from 'react';
import type { Channel } from '@/lib/types';

type CountrySelection = 'all' | 'ukraine' | 'russia';

interface CountryFilterProps {
  channels: Channel[];
  currentSelection: CountrySelection;
  onSelectionChange: (selection: CountrySelection, channelUsernames: string[]) => void;
}

/**
 * CountryFilter Component
 *
 * Prominent visual toggle for filtering between Ukrainian and Russian sources.
 * Uses a segmented control design with flag emojis and country-specific colors.
 *
 * Works by:
 * 1. Grouping channels by folder suffix (-UA or -RU)
 * 2. On selection change, passes all matching channel usernames to parent
 * 3. Parent applies these as channel_username filter (multi-value)
 */
export function CountryFilter({ channels, currentSelection, onSelectionChange }: CountryFilterProps) {
  // Separate channels by country (based on folder naming convention)
  const ukraineChannels = channels.filter(ch =>
    ch.folder?.toUpperCase().includes('-UA')
  );

  const russiaChannels = channels.filter(ch =>
    ch.folder?.toUpperCase().includes('-RU')
  );

  const handleSelection = (selection: CountrySelection) => {
    let channelUsernames: string[] = [];

    if (selection === 'ukraine') {
      channelUsernames = ukraineChannels
        .map(ch => ch.username)
        .filter((u): u is string => !!u);
    } else if (selection === 'russia') {
      channelUsernames = russiaChannels
        .map(ch => ch.username)
        .filter((u): u is string => !!u);
    }
    // For 'all', pass empty array (no filter)

    onSelectionChange(selection, channelUsernames);
  };

  return (
    <div className="glass rounded-xl p-4 sm:p-6 mb-6">
      {/* Header - stacks on mobile */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div>
          <h3 className="text-base sm:text-lg font-semibold text-text-primary">Filter by Source Country</h3>
          <p className="text-xs sm:text-sm text-text-tertiary mt-1">
            Quick filter to show only Ukrainian or Russian sources
          </p>
        </div>
        <div className="text-xs sm:text-sm text-text-tertiary">
          <span className="text-blue-400 font-medium">{ukraineChannels.length}</span> Ukrainian • {' '}
          <span className="text-red-400 font-medium">{russiaChannels.length}</span> Russian
        </div>
      </div>

      {/* Segmented Control - stacks on mobile */}
      <div className="flex flex-col sm:flex-row gap-2 p-1 bg-bg-secondary rounded-lg">
        {/* All Sources */}
        <button
          onClick={() => handleSelection('all')}
          className={`
            flex-1 px-4 py-2.5 sm:px-6 sm:py-3 rounded-md font-medium transition-all duration-200
            ${currentSelection === 'all'
              ? 'bg-primary text-white shadow-lg'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
            }
          `}
        >
          <div className="flex items-center justify-center gap-2">
            <span className="text-base sm:text-lg">🌐</span>
            <span className="text-sm sm:text-base">All Sources</span>
            <span className="text-xs opacity-70">({channels.length})</span>
          </div>
        </button>

        {/* Ukraine */}
        <button
          onClick={() => handleSelection('ukraine')}
          className={`
            flex-1 px-4 py-2.5 sm:px-6 sm:py-3 rounded-md font-medium transition-all duration-200
            ${currentSelection === 'ukraine'
              ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
              : 'text-text-secondary hover:text-blue-400 hover:bg-bg-tertiary'
            }
          `}
        >
          <div className="flex items-center justify-center gap-2">
            <span className="text-base sm:text-lg">🇺🇦</span>
            <span className="text-sm sm:text-base">Ukraine</span>
            <span className="text-xs opacity-70">({ukraineChannels.length})</span>
          </div>
        </button>

        {/* Russia */}
        <button
          onClick={() => handleSelection('russia')}
          className={`
            flex-1 px-4 py-2.5 sm:px-6 sm:py-3 rounded-md font-medium transition-all duration-200
            ${currentSelection === 'russia'
              ? 'bg-red-500 text-white shadow-lg shadow-red-500/30'
              : 'text-text-secondary hover:text-red-400 hover:bg-bg-tertiary'
            }
          `}
        >
          <div className="flex items-center justify-center gap-2">
            <span className="text-base sm:text-lg">🇷🇺</span>
            <span className="text-sm sm:text-base">Russia</span>
            <span className="text-xs opacity-70">({russiaChannels.length})</span>
          </div>
        </button>
      </div>

      {/* Active Filter Indicator */}
      {currentSelection !== 'all' && (
        <div className="mt-4 p-3 bg-bg-secondary/50 rounded-lg border border-border-subtle">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-secondary">
              Showing only {' '}
              <span className={currentSelection === 'ukraine' ? 'text-blue-400 font-semibold' : 'text-red-400 font-semibold'}>
                {currentSelection === 'ukraine' ? 'Ukrainian' : 'Russian'}
              </span>
              {' '} sources from {' '}
              <span className="font-semibold">
                {currentSelection === 'ukraine' ? ukraineChannels.length : russiaChannels.length}
              </span>
              {' '} channels
            </p>
            <button
              onClick={() => handleSelection('all')}
              className="text-xs text-accent-primary hover:underline font-medium"
            >
              Clear Filter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
