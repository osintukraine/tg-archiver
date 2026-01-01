import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * useAutoAdvance Hook
 *
 * Manages auto-advance timer for immersive media player.
 * Counts down from delay and calls onAdvance when timer expires.
 * Can be paused and reset programmatically.
 *
 * @param enabled - Whether auto-advance is enabled
 * @param delay - Delay in milliseconds before auto-advancing
 * @param onAdvance - Callback to execute when timer expires
 * @param pause - Whether to pause the timer (e.g., during video playback)
 * @returns Object with remainingTime (ms) and reset function
 */
export function useAutoAdvance(
  enabled: boolean,
  delay: number,
  onAdvance: () => void,
  pause?: boolean
): { remainingTime: number; reset: () => void } {
  const [remainingTime, setRemainingTime] = useState(delay);
  const startTimeRef = useRef<number>(Date.now());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Reset function to restart the timer
  const reset = useCallback(() => {
    setRemainingTime(delay);
    startTimeRef.current = Date.now();
  }, [delay]);

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Don't start timer if not enabled or paused
    if (!enabled || pause) {
      return;
    }

    // Reset start time
    startTimeRef.current = Date.now();
    setRemainingTime(delay);

    // Update every 100ms for smooth countdown
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, delay - elapsed);

      setRemainingTime(remaining);

      if (remaining === 0) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        onAdvance();
      }
    }, 100);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, delay, onAdvance, pause]);

  return { remainingTime, reset };
}
