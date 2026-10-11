'use client';

import { createContext, useContext, useState, useCallback, useMemo, useSyncExternalStore, ReactNode } from 'react';
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

const viewedIdsListeners = new Set<() => void>();

function subscribeViewedIds(listener: () => void) {
  viewedIdsListeners.add(listener);
  return () => {
    viewedIdsListeners.delete(listener);
  };
}

function readViewedIds(): string | null {
  try {
    return localStorage.getItem(VIEWED_IDS_KEY);
  } catch {
    return null;
  }
}

function writeViewedIds(raw: string | null) {
  try {
    if (raw === null) localStorage.removeItem(VIEWED_IDS_KEY);
    else localStorage.setItem(VIEWED_IDS_KEY, raw);
  } catch {
    // storage unavailable; ignore
  }
  viewedIdsListeners.forEach((listener) => listener());
}

function parseViewedIds(raw: string | null): Set<number> {
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw));
  } catch {
    // Invalid stored data, ignore
    return new Set();
  }
}

export function ImmersiveProvider({ children }: ImmersiveProviderProps) {
  const [isImmersive, setIsImmersive] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('stream');
  const [layers, setLayers] = useState<ImmersiveLayers>({ rss: false });
  const [queue, setQueue] = useState<Message[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const isLoading = false;

  // Queue control state - defaults to newest, skip watched off
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [skipWatched, setSkipWatched] = useState(false);
  // Viewed IDs live in localStorage; the server snapshot (null) keeps hydration consistent
  const rawViewedIds = useSyncExternalStore(subscribeViewedIds, readViewedIds, () => null);
  const viewedIds = useMemo(() => parseViewedIds(rawViewedIds), [rawViewedIds]);

  const toggleImmersive = useCallback(() => {
    setIsImmersive(prev => !prev);
  }, []);

  const toggleLayer = useCallback((layer: keyof ImmersiveLayers) => {
    setLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  // Mark a message as viewed
  const markAsViewed = useCallback((id: number) => {
    const next = new Set(parseViewedIds(readViewedIds()));
    next.add(id);
    writeViewedIds(JSON.stringify(Array.from(next)));
  }, []);

  // Reset queue: clear viewed IDs, return to newest sort, go to index 0
  const resetQueue = useCallback(() => {
    writeViewedIds(null);
    setSortMode('newest');
    setCurrentIndex(0);
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
