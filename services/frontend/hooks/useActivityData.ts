// services/frontend-nextjs/hooks/useActivityData.ts

import { useQuery } from '@tanstack/react-query';
import { API_URL as API_BASE } from '../lib/api';
import {
  ActivityData,
  PulseData,
  VolumeData,
  TopicsData,
  ChannelsActivityData,
  VolumeTimeframe,
  TopicsTimeframe,
  PlatformStats,
} from '@/types/about';

// Default pulse data when API unavailable
const DEFAULT_PULSE: PulseData = {
  messages_last_hour: 0,
  messages_today: 0,
  channels_active_24h: 0,
  status: 'idle',
};

// Default volume data
const DEFAULT_VOLUME: VolumeData = {
  granularity: 'hour',
  timeframe: '24h',
  buckets: [],
  peak: null,
  average: 0,
  total: 0,
};

// Default topics data
const DEFAULT_TOPICS: TopicsData = {
  timeframe: '24h',
  items: [],
  total: 0,
};

// Default channels data
const DEFAULT_CHANNELS: ChannelsActivityData = {
  timeframe: '24h',
  items: [],
  total_active: 0,
};

// Default activity response
const DEFAULT_ACTIVITY: ActivityData = {
  pulse: DEFAULT_PULSE,
  volume: DEFAULT_VOLUME,
  topics: DEFAULT_TOPICS,
  channels: DEFAULT_CHANNELS,
  timestamp: new Date().toISOString(),
};

interface UseActivityDataOptions {
  volumeTimeframe?: VolumeTimeframe;
  topicsTimeframe?: TopicsTimeframe;
  /** Refresh interval for pulse data in ms (default: 30000 = 30s) */
  pulseRefreshInterval?: number;
  /** Whether to enable automatic refetching */
  enabled?: boolean;
}

/**
 * Hook for fetching platform activity data.
 *
 * Provides:
 * - pulse: Real-time metrics (messages/hour, today, active channels)
 * - volume: Message volume over time (hourly or daily buckets)
 * - topics: Topic distribution
 * - channels: Most active channels
 *
 * @example
 * ```tsx
 * const { data, isLoading } = useActivityData({ volumeTimeframe: '7d' });
 * ```
 */
export const useActivityData = (options: UseActivityDataOptions = {}) => {
  const {
    volumeTimeframe = '24h',
    topicsTimeframe = '24h',
    pulseRefreshInterval = 30000, // 30 seconds
    enabled = true,
  } = options;

  // Build query params
  const params = new URLSearchParams();
  params.set('volume_timeframe', volumeTimeframe);
  params.set('topics_timeframe', topicsTimeframe);

  const query = useQuery<ActivityData>({
    queryKey: ['about', 'activity', volumeTimeframe, topicsTimeframe],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/api/about/activity?${params}`);
        if (!res.ok) {
          console.error('Activity API error:', res.status);
          return DEFAULT_ACTIVITY;
        }
        return res.json();
      } catch (error) {
        console.error('Activity fetch error:', error);
        return DEFAULT_ACTIVITY;
      }
    },
    refetchInterval: pulseRefreshInterval,
    staleTime: pulseRefreshInterval,
    gcTime: 60000, // Keep in cache for 1 minute after unmount
    retry: 2,
    retryDelay: 1000,
    enabled,
  });

  return {
    // Full data object
    data: query.data,

    // Individual sections for convenience
    pulse: query.data?.pulse ?? DEFAULT_PULSE,
    volume: query.data?.volume ?? DEFAULT_VOLUME,
    topics: query.data?.topics ?? DEFAULT_TOPICS,
    channels: query.data?.channels ?? DEFAULT_CHANNELS,

    // Query state
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,

    // Manual refetch
    refetch: query.refetch,
  };
};

/**
 * Hook for fetching only pulse data with faster refresh.
 * Use this for the Overview tab's live pulse indicator.
 */
export const usePulseData = (refreshInterval = 30000) => {
  const { pulse, isLoading, isFetching, error } = useActivityData({
    pulseRefreshInterval: refreshInterval,
  });

  return { pulse, isLoading, isFetching, error };
};

// Default platform stats when API unavailable
const DEFAULT_STATS: PlatformStats = {
  channels: 0,
  messages: 0,
  messages_formatted: '0',
  media_size_bytes: 0,
  media_size_formatted: '0 B',
  timestamp: new Date().toISOString(),
};

/**
 * Hook for fetching platform summary statistics.
 * Provides lifetime totals for the platform.
 */
export const usePlatformStats = () => {
  const query = useQuery<PlatformStats>({
    queryKey: ['about', 'stats'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/api/about/stats`);
        if (!res.ok) {
          console.error('Stats API error:', res.status);
          return DEFAULT_STATS;
        }
        return res.json();
      } catch (error) {
        console.error('Stats fetch error:', error);
        return DEFAULT_STATS;
      }
    },
    staleTime: 60000, // 1 minute
    gcTime: 300000, // 5 minutes
    retry: 2,
  });

  return {
    stats: query.data ?? DEFAULT_STATS,
    isLoading: query.isLoading,
    error: query.error,
  };
};
