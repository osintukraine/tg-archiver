'use client';

/**
 * SimilarMessages Component
 *
 * Displays semantically similar messages using AI embeddings.
 * Shows 5 most similar messages with similarity scores.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { getSimilarMessages } from '@/lib/api';
import type { Message } from '@/lib/types';

interface SimilarMessagesProps {
  messageId: number;
}

export function SimilarMessages({ messageId }: SimilarMessagesProps) {
  const [similar, setSimilar] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSimilar() {
      try {
        setLoading(true);
        setError(null);
        const messages = await getSimilarMessages(messageId, 5);
        setSimilar(messages);
      } catch (err) {
        console.error('Failed to fetch similar messages:', err);
        setError(err instanceof Error ? err.message : 'Failed to load similar messages');
      } finally {
        setLoading(false);
      }
    }

    fetchSimilar();
  }, [messageId]);

  // Helper to get importance level badge color
  const getImportanceLevelColor = (level?: 'high' | 'medium' | 'low' | null) => {
    if (!level) return 'bg-gray-700/10 text-gray-400';
    switch (level) {
      case 'high':
        return 'bg-green-500/10 text-green-400';
      case 'medium':
        return 'bg-yellow-500/10 text-yellow-400';
      case 'low':
        return 'bg-gray-700/10 text-gray-400';
      default:
        return 'bg-gray-700/10 text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="glass p-4 sm:p-6 rounded-xl">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <h2 className="text-lg sm:text-xl font-bold">Similar Messages</h2>
          <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded">AI-Powered</span>
        </div>
        <div className="flex items-center gap-3 text-text-tertiary">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"></div>
          <span className="text-sm">Finding semantically similar messages...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass p-4 sm:p-6 rounded-xl">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <h2 className="text-lg sm:text-xl font-bold">Similar Messages</h2>
        </div>
        <div className="text-text-tertiary text-sm">
          {error.includes('embeddings') ? (
            <>
              <p>This message doesn&apos;t have AI embeddings yet.</p>
              <p className="mt-2">Embeddings are generated automatically for new messages.</p>
            </>
          ) : (
            <p>Unable to load similar messages: {error}</p>
          )}
        </div>
      </div>
    );
  }

  if (similar.length === 0) {
    return (
      <div className="glass p-4 sm:p-6 rounded-xl">
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <h2 className="text-lg sm:text-xl font-bold">Similar Messages</h2>
          <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded">AI-Powered</span>
        </div>
        <p className="text-text-tertiary text-sm">No similar messages found.</p>
      </div>
    );
  }

  return (
    <div className="glass p-4 sm:p-6 rounded-xl">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
        <h2 className="text-lg sm:text-xl font-bold">Similar Messages</h2>
        <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded">AI-Powered</span>
      </div>

      <p className="text-text-tertiary text-sm mb-4">
        Messages with similar semantic meaning based on AI embeddings
      </p>

      <div className="space-y-2 sm:space-y-3">
        {similar.map((msg) => (
          <Link
            key={msg.id}
            href={`/messages/${msg.id}`}
            className="block bg-bg-secondary hover:bg-bg-tertiary border border-border-subtle hover:border-accent-primary/50 rounded-lg p-3 sm:p-4 transition-colors"
          >
            <div className="flex items-start gap-2 sm:gap-3">
              {/* Similarity indicator */}
              <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-primary" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                </svg>
              </div>

              {/* Message preview */}
              <div className="flex-1 min-w-0">
                {/* Channel info */}
                {msg.channel && (
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-1">
                    <span className="text-xs text-text-tertiary">
                      {msg.channel.verified && '✓ '}
                      @{msg.channel.username || msg.channel.name || `Channel ${msg.channel_id}`}
                    </span>
                    <span className="text-xs text-text-tertiary">•</span>
                    <span className="text-xs text-text-tertiary">
                      {format(new Date(msg.created_at), 'MMM d, HH:mm')}
                    </span>
                  </div>
                )}

                {/* Content preview */}
                <p className="text-text-primary text-sm line-clamp-2 mb-2">
                  {msg.content_translated || msg.content || 'No content'}
                </p>

                {/* Metadata */}
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
                  {msg.importance_level && (
                    <span className={`px-2 py-0.5 rounded ${getImportanceLevelColor(msg.importance_level)}`}>
                      {msg.importance_level === 'high' ? 'High' : msg.importance_level === 'medium' ? 'Medium' : 'Low'}
                    </span>
                  )}
                  {msg.osint_topic && (
                    <span className="text-text-tertiary">Topic: {msg.osint_topic}</span>
                  )}
                  {msg.tags && msg.tags.length > 0 && (
                    <span className="text-text-tertiary">{msg.tags.length} tags</span>
                  )}
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
