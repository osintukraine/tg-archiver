import { useQuery } from '@tanstack/react-query';
import { getChannelNetwork } from '@/lib/api';

interface ChannelNetworkNode {
  id: string;
  type: 'message' | 'topic_cluster' | 'time_period';
  label: string;
  position?: { x: number; y: number };
  data: Record<string, any>;
}

interface ChannelNetworkEdge {
  id: string;
  source: string;
  target: string;
  type: 'similar' | 'temporal' | 'cluster';
  label?: string;
  weight?: number;
}

interface ChannelNetworkResponse {
  channel_id: number;
  channel_name: string;
  nodes: ChannelNetworkNode[];
  edges: ChannelNetworkEdge[];
  clusters?: {
    id: number;
    label: string;
    message_count: number;
    top_keywords: string[];
  }[];
  metadata: {
    total_messages: number;
    total_nodes: number;
    total_edges: number;
    time_span_days: number;
  };
}

interface UseChannelNetworkOptions {
  similarityThreshold?: number;
  maxMessages?: number;
  timeWindow?: string; // '7d', '30d', '90d', 'all'
  includeClusters?: boolean;
}

export function useChannelNetwork(
  channelId: number,
  options: UseChannelNetworkOptions = {}
) {
  const {
    similarityThreshold = 0.7,
    maxMessages = 100,
    timeWindow = '30d',
    includeClusters = true
  } = options;

  return useQuery<ChannelNetworkResponse>({
    queryKey: ['channel-network', channelId, similarityThreshold, maxMessages, timeWindow, includeClusters],
    queryFn: () => getChannelNetwork(channelId, {
      similarity_threshold: similarityThreshold,
      max_messages: maxMessages,
      time_window: timeWindow,
      include_clusters: includeClusters
    }),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!channelId
  });
}
