'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GitBranch, ExternalLink, Loader2 } from 'lucide-react';
import { useSimilarPosts } from '@/hooks/useSimilarPosts';
import type { Message } from '@/lib/types';

interface SimilarPostsViewProps {
  message: Message;
}

export function SimilarPostsView({ message }: SimilarPostsViewProps) {
  const { data, isLoading, error } = useSimilarPosts(message.id, {
    limit: 10,
    threshold: 0.7
  });

  // Helper to get importance level badge variant
  const getImportanceLevelVariant = (level?: 'high' | 'medium' | 'low' | null): "default" | "destructive" | "secondary" => {
    if (!level) return 'secondary';
    switch (level) {
      case 'high':
        return 'destructive';
      case 'medium':
        return 'default';
      case 'low':
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Finding similar messages using semantic embeddings...
        </span>
      </div>
    );
  }

  if (error) {
    // Check if error is due to missing embeddings
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isEmbeddingError = errorMessage.includes('no embedding') || errorMessage.includes('Cannot find similar');

    return (
      <div className="text-center py-12">
        <GitBranch className="h-12 w-12 mx-auto text-muted-foreground/20 mb-3" />
        {isEmbeddingError ? (
          <>
            <p className="text-sm text-muted-foreground">Message not yet enriched</p>
            <p className="text-xs text-muted-foreground mt-1">
              This message hasn&apos;t been processed by the enricher service yet.
              Semantic embeddings will be available shortly.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-destructive">Failed to load similar messages</p>
            <p className="text-xs text-muted-foreground mt-1">{errorMessage}</p>
          </>
        )}
      </div>
    );
  }

  if (!data || data.similar_messages.length === 0) {
    return (
      <div className="text-center py-12">
        <GitBranch className="h-12 w-12 mx-auto text-muted-foreground/20 mb-3" />
        <p className="text-sm text-muted-foreground">No similar messages found</p>
        <p className="text-xs text-muted-foreground mt-1">
          This message may be unique or doesn&apos;t have semantic embeddings yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          {data.count} Similar Messages
        </h3>
        <Badge variant="outline" className="text-xs">
          Powered by pgvector
        </Badge>
      </div>

      <div className="space-y-3">
        {data.similar_messages.map((similar) => (
          <Card key={similar.id} className="hover:border-primary/50 transition-colors cursor-pointer">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-muted-foreground">
                      {similar.channel_name}
                    </span>
                    <Badge
                      variant={similar.similarity >= 0.9 ? 'default' : 'secondary'}
                      className="text-xs"
                    >
                      {(similar.similarity * 100).toFixed(0)}% similar
                    </Badge>
                  </div>
                  <p className="text-sm line-clamp-3">
                    {similar.content_translated || similar.content}
                  </p>
                </div>
                {similar.importance_level && (
                  <Badge
                    variant={getImportanceLevelVariant(similar.importance_level)}
                    className="text-xs shrink-0"
                  >
                    {similar.importance_level === 'high' ? 'High' : similar.importance_level === 'medium' ? 'Medium' : 'Low'}
                  </Badge>
                )}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{new Date(similar.created_at).toLocaleString()}</span>
                <a
                  href={`/messages/${similar.id}`}
                  className="text-blue-500 hover:text-blue-600 flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  View message
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="text-xs text-muted-foreground bg-slate-50 p-3 rounded">
        <p className="font-medium mb-1">How similarity works:</p>
        <p>
          Messages are compared using 384-dimensional semantic embeddings.
          Similar content is found even when different words are used.
          Threshold: {(0.7 * 100).toFixed(0)}% minimum similarity.
        </p>
      </div>
    </div>
  );
}
