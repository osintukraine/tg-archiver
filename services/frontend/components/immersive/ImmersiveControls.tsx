'use client';

import { useState } from 'react';
import { useImmersive } from '@/contexts/ImmersiveContext';

export function ImmersiveControls() {
  const {
    viewMode,
    setViewMode,
    layers,
    toggleLayer,
    toggleImmersive,
    currentIndex,
    queue,
    // Queue control
    sortMode,
    setSortMode,
    skipWatched,
    setSkipWatched,
    viewedIds,
    resetQueue,
  } = useImmersive();

  const [showHelp, setShowHelp] = useState(false);

  return (
    <>
      <div className="absolute top-0 left-0 right-0 z-50 p-4">
        <div className="flex items-center justify-between">
          {/* Left: Exit button */}
          <button
            onClick={toggleImmersive}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/60 backdrop-blur-sm text-white hover:bg-black/80 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span className="text-sm font-medium">Exit</span>
          </button>

          {/* Center: Position indicator */}
          <div className="px-3 py-2 rounded-lg bg-black/60 backdrop-blur-sm text-white text-sm">
            {currentIndex + 1} / {queue.length}
          </div>

          {/* Right: Controls */}
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <button
              onClick={() => setViewMode(viewMode === 'stream' ? 'grid' : 'stream')}
              className={`p-2 rounded-lg backdrop-blur-sm transition-colors ${
                viewMode === 'grid'
                  ? 'bg-white/20 text-white'
                  : 'bg-black/60 text-white hover:bg-black/80'
              }`}
              title={viewMode === 'stream' ? 'Switch to Grid' : 'Switch to Stream'}
            >
              {viewMode === 'stream' ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>

            {/* RSS layer toggle */}
            <button
              onClick={() => toggleLayer('rss')}
              className={`p-2 rounded-lg backdrop-blur-sm transition-colors ${
                layers.rss
                  ? 'bg-blue-500/80 text-white'
                  : 'bg-black/60 text-white hover:bg-black/80'
              }`}
              title="Toggle RSS News Ticker"
            >
              <span className="text-sm font-medium">RSS</span>
            </button>

            {/* Divider */}
            <div className="w-px h-6 bg-white/20" />

            {/* Sort mode toggle */}
            <button
              onClick={() => setSortMode(sortMode === 'newest' ? 'smart' : 'newest')}
              className={`p-2 rounded-lg backdrop-blur-sm transition-colors ${
                sortMode === 'smart'
                  ? 'bg-purple-500/80 text-white'
                  : 'bg-black/60 text-white hover:bg-black/80'
              }`}
              title={sortMode === 'newest' ? 'Sort: Newest First (click for Smart)' : 'Sort: Smart Score (click for Newest)'}
            >
              <span className="text-sm font-medium">{sortMode === 'newest' ? '🕐' : '⭐'}</span>
            </button>

            {/* Skip watched toggle */}
            <button
              onClick={() => setSkipWatched(!skipWatched)}
              className={`p-2 rounded-lg backdrop-blur-sm transition-colors ${
                skipWatched
                  ? 'bg-amber-500/80 text-white'
                  : 'bg-black/60 text-white hover:bg-black/80'
              }`}
              title={skipWatched ? `Skip Watched ON (${viewedIds.size} viewed)` : 'Skip Watched OFF'}
            >
              <span className="text-sm font-medium">{skipWatched ? '👁️' : '👁️‍🗨️'}</span>
            </button>

            {/* Reset button */}
            <button
              onClick={resetQueue}
              className="p-2 rounded-lg backdrop-blur-sm bg-black/60 text-white hover:bg-red-500/80 transition-colors"
              title="Reset to Latest"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>

            {/* Help button */}
            <button
              onClick={() => setShowHelp(!showHelp)}
              className={`p-2 rounded-lg backdrop-blur-sm transition-colors ${
                showHelp
                  ? 'bg-white/20 text-white'
                  : 'bg-black/60 text-white hover:bg-black/80'
              }`}
              title="Show Help"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Help overlay */}
      {showHelp && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-gray-900/95 rounded-xl p-6 max-w-md mx-4 shadow-2xl border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white">Immersive Mode Controls</h2>
              <button
                onClick={() => setShowHelp(false)}
                className="text-white/60 hover:text-white"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Keyboard shortcuts */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wide mb-3">Keyboard Shortcuts</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/70">Next video</span>
                  <span className="text-white font-mono bg-white/10 px-2 py-0.5 rounded">↓ or →</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/70">Previous video</span>
                  <span className="text-white font-mono bg-white/10 px-2 py-0.5 rounded">↑ or ←</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/70">Pause / Play</span>
                  <span className="text-white font-mono bg-white/10 px-2 py-0.5 rounded">Space</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/70">Mute / Unmute</span>
                  <span className="text-white font-mono bg-white/10 px-2 py-0.5 rounded">M</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/70">Exit immersive mode</span>
                  <span className="text-white font-mono bg-white/10 px-2 py-0.5 rounded">Esc</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/70">Toggle immersive mode</span>
                  <span className="text-white font-mono bg-white/10 px-2 py-0.5 rounded">I</span>
                </div>
              </div>
            </div>

            {/* Layer toggles explanation */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wide mb-3">Overlay Layers</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="bg-blue-500/80 text-white text-xs font-medium px-2 py-0.5 rounded">RSS</span>
                    <span className="text-white">News Ticker</span>
                  </div>
                  <p className="text-white/60 text-xs">Shows latest RSS news headlines scrolling at the top. Click headlines to open articles.</p>
                </div>
              </div>
            </div>

            {/* Queue controls explanation */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wide mb-3">Queue Controls</h3>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">🕐</span>
                    <span className="text-white">Newest First</span>
                    <span className="text-white/40 mx-1">/</span>
                    <span className="text-lg">⭐</span>
                    <span className="text-white">Smart Score</span>
                  </div>
                  <p className="text-white/60 text-xs">Toggle between chronological order and importance-weighted scoring.</p>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">👁️</span>
                    <span className="text-white">Skip Watched</span>
                  </div>
                  <p className="text-white/60 text-xs">When enabled, skips videos you&apos;ve already viewed. Currently {viewedIds.size} videos marked as watched.</p>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="bg-white/10 text-white text-xs font-medium px-2 py-0.5 rounded">↻</span>
                    <span className="text-white">Reset</span>
                  </div>
                  <p className="text-white/60 text-xs">Clears watch history, returns to newest-first sort, and jumps to the latest video.</p>
                </div>
              </div>
            </div>

            {/* Navigation tips */}
            <div>
              <h3 className="text-sm font-semibold text-cyan-400 uppercase tracking-wide mb-3">Navigation</h3>
              <div className="space-y-2 text-sm text-white/70">
                <p>• Swipe up/down on mobile to navigate between videos</p>
                <p>• Swipe left/right to see multiple media in a message</p>
                <p>• Tap the info panel at bottom to see full message details</p>
                <p>• Use Grid view for quick thumbnail navigation</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
