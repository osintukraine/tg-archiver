'use client';

/**
 * MediaControls Component
 *
 * Bottom control bar for immersive media mode
 * Handles play/pause, mute, navigation, and auto-advance
 */

interface MediaControlsProps {
  isPlaying: boolean;
  isMuted: boolean;
  autoAdvance: boolean;
  currentIndex: number;
  totalCount: number;
  onPlayPause: () => void;
  onMuteToggle: () => void;
  onAutoAdvanceToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function MediaControls({
  isPlaying,
  isMuted,
  autoAdvance,
  currentIndex,
  totalCount,
  onPlayPause,
  onMuteToggle,
  onAutoAdvanceToggle,
  onPrevious,
  onNext,
  onClose,
}: MediaControlsProps) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 px-6 py-4 transition-all duration-300"
      style={{
        background: 'rgba(15, 20, 25, 0.85)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        {/* Left: Navigation Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={onPrevious}
            disabled={currentIndex === 0}
            className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 ${
              currentIndex === 0
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-white/10 text-white hover:bg-white/20 hover:border-[#00d4ff]/50'
            }`}
            style={{ border: '1px solid rgba(255, 255, 255, 0.1)' }}
            title="Previous (Left Arrow)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Prev
          </button>

          <button
            onClick={onNext}
            disabled={currentIndex >= totalCount - 1}
            className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 ${
              currentIndex >= totalCount - 1
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-white/10 text-white hover:bg-white/20 hover:border-[#00d4ff]/50'
            }`}
            style={{ border: '1px solid rgba(255, 255, 255, 0.1)' }}
            title="Next (Right Arrow)"
          >
            Next
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Center: Playback Controls */}
        <div className="flex items-center gap-4">
          {/* Mute Toggle */}
          <button
            onClick={onMuteToggle}
            className="p-2 rounded-lg transition-all duration-200 hover:bg-white/20"
            style={{ color: isMuted ? '#ff4444' : '#00d4ff' }}
            title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
          >
            {isMuted ? (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>

          {/* Play/Pause Toggle */}
          <button
            onClick={onPlayPause}
            className="p-3 rounded-full transition-all duration-200"
            style={{
              background: 'linear-gradient(135deg, #00d4ff 0%, #0099cc 100%)',
              color: 'white',
            }}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? (
              <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </button>

          {/* Auto-advance Toggle */}
          <button
            onClick={onAutoAdvanceToggle}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              autoAdvance
                ? 'text-[#00d4ff] bg-[#00d4ff]/20'
                : 'text-gray-400 bg-white/10'
            }`}
            style={{ border: '1px solid rgba(255, 255, 255, 0.1)' }}
            title="Toggle auto-advance (A)"
          >
            Auto: {autoAdvance ? 'ON' : 'OFF'}
          </button>

          {/* Progress Indicator */}
          <div className="text-gray-300 text-sm font-mono">
            {currentIndex + 1} / {totalCount}
          </div>
        </div>

        {/* Right: Close Button */}
        <button
          onClick={onClose}
          className="p-2 rounded-lg transition-all duration-200 text-gray-400 hover:text-white hover:bg-white/20"
          title="Close immersive mode (Esc)"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
