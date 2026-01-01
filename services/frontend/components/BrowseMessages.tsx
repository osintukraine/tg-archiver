'use client';

/**
 * BrowseMessages Component
 *
 * Client-side wrapper for message browsing with density control
 * Manages view mode state (compact/detailed/immersive)
 */

import { useState } from 'react';
import { MessageList } from './MessageList';
import { ResultsToolbar } from './ResultsToolbar';
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
      {/* Persistent Results Toolbar - always visible */}
      <ResultsToolbar
        total={total}
        currentPage={currentPage}
        totalPages={totalPages}
        density={density}
        onDensityChange={setDensity}
      />

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
