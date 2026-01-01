import { useQuery } from '@tanstack/react-query';
import { getMessageSocialGraph, getEngagementTimeline, getMessageComments } from '@/lib/api';

/**
 * Hook to fetch social graph data for a message
 */
export function useSocialGraph(
  messageId: number,
  options: {
    include_forwards?: boolean;
    include_replies?: boolean;
    max_depth?: number;
    max_comments?: number;
  } = {}
) {
  return useQuery({
    queryKey: ['social-graph', messageId, options],
    queryFn: () => getMessageSocialGraph(messageId, options),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!messageId,
  });
}

/**
 * Hook to fetch engagement timeline data
 */
export function useEngagementTimeline(
  messageId: number,
  options: {
    granularity?: 'hour' | 'day' | 'week';
    time_range_hours?: number;
  } = {}
) {
  return useQuery({
    queryKey: ['engagement-timeline', messageId, options],
    queryFn: () => getEngagementTimeline(messageId, options),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!messageId,
  });
}

/**
 * Hook to fetch comment thread data
 */
export function useCommentThread(
  messageId: number,
  options: {
    limit?: number;
    offset?: number;
    sort?: 'asc' | 'desc';
    include_replies?: boolean;
  } = {}
) {
  return useQuery({
    queryKey: ['comment-thread', messageId, options],
    queryFn: () => getMessageComments(messageId, options),
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled: !!messageId,
  });
}
