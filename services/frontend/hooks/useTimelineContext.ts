import { useQuery } from '@tanstack/react-query';
import { getMessageTimeline } from '@/lib/api';

interface TimelineMessage {
  id: number;
  content: string;
  telegram_date?: string;
  created_at: string;
  channel: string;
}

interface TimelineContextResponse {
  center_message: {
    id: number;
    content: string;
    telegram_date?: string;
    created_at: string;
  };
  before: TimelineMessage[];
  after: TimelineMessage[];
}

interface UseTimelineContextOptions {
  beforeCount?: number;
  afterCount?: number;
  sameChannelOnly?: boolean;
  useSemantic?: boolean;
  similarityThreshold?: number;
}

export function useTimelineContext(
  messageId: number,
  options: UseTimelineContextOptions = {}
) {
  const {
    beforeCount = 5,
    afterCount = 5,
    sameChannelOnly = false,
    useSemantic = true,  // Enable semantic timeline by default
    similarityThreshold = 0.7
  } = options;

  return useQuery<TimelineContextResponse>({
    queryKey: ['timeline-context', messageId, beforeCount, afterCount, sameChannelOnly, useSemantic, similarityThreshold],
    queryFn: () => getMessageTimeline(messageId, {
      before_count: beforeCount,
      after_count: afterCount,
      same_channel_only: sameChannelOnly,
      use_semantic: useSemantic,
      similarity_threshold: similarityThreshold
    }),
    staleTime: 1 * 60 * 1000, // 1 minute
    enabled: !!messageId
  });
}
