'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import type { Message } from '@/lib/types';

export type ViewMode = 'stream' | 'grid';
export type SortMode = 'newest' | 'smart';

export interface ImmersiveLayers {
  rss: boolean;
}

export interface ImmersiveState {
  // Core state
  isImmersive: boolean;
  viewMode: ViewMode;
  layers: ImmersiveLayers;

  // Queue control state
  sortMode: SortMode;
  skipWatched: boolean;
  viewedIds: Set<number>;

  // Queue state
  queue: Message[];
  currentIndex: number;
  isLoading: boolean;

  // Actions
  toggleImmersive: () => void;
  setViewMode: (mode: ViewMode) => void;
  toggleLayer: (layer: keyof ImmersiveLayers) => void;
  setSortMode: (mode: SortMode) => void;
  setSkipWatched: (skip: boolean) => void;
  markAsViewed: (id: number) => void;
  resetQueue: () => void;
  setQueue: (messages: Message[]) => void;
  setCurrentIndex: (index: number) => void;
  goToNext: () => void;
  goToPrevious: () => void;
}

const ImmersiveContext = createContext<ImmersiveState | null>(null);

export function useImmersive(): ImmersiveState {
  const context = useContext(ImmersiveContext);
  if (!context) {
    throw new Error('useImmersive must be used within ImmersiveProvider');
  }
  return context;
}

interface ImmersiveProviderProps {
  children: ReactNode;
}

// Storage key for viewed IDs
const VIEWED_IDS_KEY = 'immersive_viewed_ids';

export function ImmersiveProvider({ children }: ImmersiveProviderProps) {
  const [isImmersive, setIsImmersive] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('stream');
  const [layers, setLayers] = useState<ImmersiveLayers>({ rss: false });
  const [queue, setQueue] = useState<Message[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  // Queue control state - defaults to newest, skip watched off
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [skipWatched, setSkipWatched] = useState(false);
  const [viewedIds, setViewedIds] = useState<Set<number>>(() => new Set());

  // Load viewed IDs from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(VIEWED_IDS_KEY);
      if (stored) {
        try {
          const ids = JSON.parse(stored);
          setViewedIds(new Set(ids));
        } catch {
          // Invalid stored data, ignore
        }
      }
    }
  }, []);

  // Save viewed IDs to localStorage when they change
  useEffect(() => {
    if (typeof window !== 'undefined' && viewedIds.size > 0) {
      localStorage.setItem(VIEWED_IDS_KEY, JSON.stringify(Array.from(viewedIds)));
    }
  }, [viewedIds]);

  const toggleImmersive = useCallback(() => {
    setIsImmersive(prev => !prev);
  }, []);

  const toggleLayer = useCallback((layer: keyof ImmersiveLayers) => {
    setLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  // Mark a message as viewed
  const markAsViewed = useCallback((id: number) => {
    setViewedIds(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Reset queue: clear viewed IDs, return to newest sort, go to index 0
  const resetQueue = useCallback(() => {
    setViewedIds(new Set());
    setSortMode('newest');
    setCurrentIndex(0);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(VIEWED_IDS_KEY);
    }
  }, []);

  // Navigate to next video, optionally skipping watched ones
  const goToNext = useCallback(() => {
    setCurrentIndex(prev => {
      if (prev >= queue.length - 1) return prev;

      if (skipWatched && viewedIds.size > 0) {
        // Find next unwatched video
        for (let i = prev + 1; i < queue.length; i++) {
          if (!viewedIds.has(queue[i]?.id)) {
            return i;
          }
        }
        // All remaining are watched, just go to next
        return prev + 1;
      }

      return prev + 1;
    });
  }, [queue, skipWatched, viewedIds]);

  // Navigate to previous video, optionally skipping watched ones
  const goToPrevious = useCallback(() => {
    setCurrentIndex(prev => {
      if (prev <= 0) return prev;

      if (skipWatched && viewedIds.size > 0) {
        // Find previous unwatched video
        for (let i = prev - 1; i >= 0; i--) {
          if (!viewedIds.has(queue[i]?.id)) {
            return i;
          }
        }
        // All previous are watched, just go to previous
        return prev - 1;
      }

      return prev - 1;
    });
  }, [queue, skipWatched, viewedIds]);

  const value: ImmersiveState = {
    isImmersive,
    viewMode,
    layers,
    sortMode,
    skipWatched,
    viewedIds,
    queue,
    currentIndex,
    isLoading,
    toggleImmersive,
    setViewMode,
    toggleLayer,
    setSortMode,
    setSkipWatched,
    markAsViewed,
    resetQueue,
    setQueue,
    setCurrentIndex,
    goToNext,
    goToPrevious,
  };

  return (
    <ImmersiveContext.Provider value={value}>
      {children}
    </ImmersiveContext.Provider>
  );
}
