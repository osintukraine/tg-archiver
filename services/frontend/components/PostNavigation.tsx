'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getAdjacentMessages } from '@/lib/api';
import type { AdjacentMessages } from '@/lib/types';

interface PostNavigationProps {
  currentId: number;
}

export function PostNavigation({ currentId }: PostNavigationProps) {
  const [adjacent, setAdjacent] = useState<AdjacentMessages | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAdjacent() {
      try {
        const data = await getAdjacentMessages(currentId);
        setAdjacent(data);
      } catch (error) {
        console.error('Failed to fetch adjacent messages:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchAdjacent();
  }, [currentId]);

  if (loading) {
    return (
      <div className="flex items-center justify-between gap-4">
        <div className="w-32 h-10 bg-bg-secondary animate-pulse rounded-lg" />
        <div className="w-32 h-10 bg-bg-secondary animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!adjacent) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-4">
      {/* Previous Button */}
      {adjacent.prev_id ? (
        <Link
          href={`/messages/${adjacent.prev_id}`}
          className="flex items-center gap-2 px-4 py-2 bg-bg-secondary hover:bg-bg-tertiary border border-border rounded-lg text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span>Previous</span>
        </Link>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2 text-text-tertiary text-sm font-medium cursor-not-allowed opacity-50">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span>Previous</span>
        </div>
      )}

      {/* Back to Browse Link */}
      <Link
        href="/"
        className="px-4 py-2 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg text-sm font-medium transition-colors"
      >
        Back to Browse
      </Link>

      {/* Next Button */}
      {adjacent.next_id ? (
        <Link
          href={`/messages/${adjacent.next_id}`}
          className="flex items-center gap-2 px-4 py-2 bg-bg-secondary hover:bg-bg-tertiary border border-border rounded-lg text-sm font-medium transition-colors"
        >
          <span>Next</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </Link>
      ) : (
        <div className="flex items-center gap-2 px-4 py-2 text-text-tertiary text-sm font-medium cursor-not-allowed opacity-50">
          <span>Next</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      )}
    </div>
  );
}
