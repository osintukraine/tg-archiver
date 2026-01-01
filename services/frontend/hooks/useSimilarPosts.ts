import { useQuery } from '@tanstack/react-query';
import { getSimilarPosts } from '@/lib/api';

interface SimilarMessage {
  id: number;
  content: string;
  content_translated: string | null;
  importance_level: 'high' | 'medium' | 'low' | null;
  created_at: string;
  channel_name: string;
  similarity: number;
}

interface SimilarPostsResponse {
  message_id: number;
  count: number;
  similar_messages: SimilarMessage[];
}

interface UseSimilarPostsOptions {
  limit?: number;
  threshold?: number;
}

export function useSimilarPosts(
  messageId: number,
  options: UseSimilarPostsOptions = {}
) {
  const { limit = 10, threshold = 0.7 } = options;

  return useQuery<SimilarPostsResponse>({
    queryKey: ['similar-posts', messageId, limit, threshold],
    queryFn: () => getSimilarPosts(messageId, { limit, threshold }),
    staleTime: 10 * 60 * 1000, // 10 minutes
    enabled: !!messageId
  });
}
