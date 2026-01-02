'use client';

/**
 * BrowseMessages Component
 *
 * Client-side wrapper for message browsing with density control
 * Manages view mode state (compact/detailed)
 */

import { useState } from 'react';
import { MessageList } from './MessageList';
import { Pagination } from './Pagination';
import type { Message, DensityMode } from '@/lib/types';

interface BrowseMessagesProps {
  messages: Message[];
  currentPage: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  total: number;
}

export function BrowseMessages({
  messages,
  currentPage,
  totalPages,
  hasNext,
  hasPrev,
  total,
}: BrowseMessagesProps) {
  const [density, setDensity] = useState<DensityMode>('compact');

  return (
    <>
      {/* Results toolbar */}
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="text-sm text-text-secondary">
          {total.toLocaleString()} results
          {totalPages > 1 && ` • Page ${currentPage} of ${totalPages}`}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-tertiary">View:</span>
          <button
            onClick={() => setDensity('compact')}
            className={`px-2 py-1 text-xs rounded ${
              density === 'compact'
                ? 'bg-accent-primary text-white'
                : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            Compact
          </button>
          <button
            onClick={() => setDensity('detailed')}
            className={`px-2 py-1 text-xs rounded ${
              density === 'detailed'
                ? 'bg-accent-primary text-white'
                : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            Detailed
          </button>
        </div>
      </div>

      {/* Results */}
      {messages.length === 0 ? (
        <div className="glass p-12 rounded-xl text-center">
          <p className="text-text-secondary text-lg">
            No messages found matching your filters.
          </p>
          <p className="text-text-tertiary text-sm mt-2">
            Try adjusting your search criteria or clearing filters.
          </p>
        </div>
      ) : (
        <MessageList messages={messages} density={density} />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8">
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            hasNext={hasNext}
            hasPrev={hasPrev}
          />
        </div>
      )}
    </>
  );
}
