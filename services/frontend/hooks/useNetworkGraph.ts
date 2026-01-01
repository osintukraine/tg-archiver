import { useQuery } from '@tanstack/react-query';
import { getMessageNetwork } from '@/lib/api';

interface NetworkNode {
  id: string;
  type: 'message' | 'location' | 'person' | 'organization' | 'military_unit' | 'related_message';
  label: string;
  position?: { x: number; y: number };
  data: Record<string, any>;
}

interface NetworkEdge {
  id: string;
  source: string;
  target: string;
  type: 'mentions' | 'similar' | 'located_in' | 'affiliated_with';
  label?: string;
  weight?: number;
}

interface NetworkGraphResponse {
  message_id: number;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  metadata?: {
    total_nodes: number;
    total_edges: number;
    regex_entity_count: number;
    curated_entity_count: number;
    ai_tag_count: number;
    similar_count: number;
  };
}

interface UseNetworkGraphOptions {
  includeSimilar?: boolean;
  similarityThreshold?: number;
}

export function useNetworkGraph(
  messageId: number,
  options: UseNetworkGraphOptions = {}
) {
  const {
    includeSimilar = true,
    similarityThreshold = 0.8
  } = options;

  return useQuery<NetworkGraphResponse>({
    queryKey: ['network-graph', messageId, includeSimilar, similarityThreshold],
    queryFn: () => getMessageNetwork(messageId, {
      include_similar: includeSimilar,
      similarity_threshold: similarityThreshold
    }),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!messageId
  });
}
