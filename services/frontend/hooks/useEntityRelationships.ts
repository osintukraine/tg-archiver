import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getEntityRelationships } from '@/lib/api';
import type { RelationshipsResponse } from '@/lib/types';

/**
 * Hook to fetch entity relationship graph data
 *
 * Returns cached relationships if available, otherwise signals need for enrichment.
 * Use the refresh function to force a re-fetch from Wikidata/OpenSanctions.
 */
export function useEntityRelationships(
  source: 'curated' | 'opensanctions',
  entityId: string,
  options: {
    enabled?: boolean;
  } = {}
) {
  const queryClient = useQueryClient();
  const { enabled = true } = options;

  const query = useQuery({
    queryKey: ['entity-relationships', source, entityId],
    queryFn: () => getEntityRelationships(source, entityId),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: enabled && !!entityId,
  });

  // Function to trigger a refresh (force re-fetch from backend)
  const refresh = async () => {
    const data = await getEntityRelationships(source, entityId, true);
    queryClient.setQueryData(['entity-relationships', source, entityId], data);
    return data;
  };

  // Computed properties for convenience
  const totalRelationships =
    (query.data?.corporate?.length || 0) +
    (query.data?.political?.length || 0) +
    (query.data?.associates?.length || 0);

  const hasRelationships = totalRelationships > 0;
  const needsEnrichment = query.data?.cached === false;

  return {
    ...query,
    refresh,
    totalRelationships,
    hasRelationships,
    needsEnrichment,
  };
}
