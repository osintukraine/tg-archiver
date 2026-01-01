'use client';

/**
 * Results Toolbar Component
 *
 * Persistent toolbar above message list with result count and view controls
 * Always visible regardless of filter state
 */

import { DensityControls } from './DensityControls';
import type { DensityMode } from '@/lib/types';

interface ResultsToolbarProps {
  total: number;
  currentPage: number;
  totalPages: number;
  density: DensityMode;
  onDensityChange: (density: DensityMode) => void;
}

export function ResultsToolbar({
  total,
  currentPage,
  totalPages,
  density,
  onDensityChange,
}: ResultsToolbarProps) {
  return (
    <div className="glass rounded-lg px-4 py-3 mb-6 flex items-center justify-between">
      {/* Left: Result count and pagination info */}
      <div className="flex items-center gap-4">
        <div className="text-text-primary font-medium">
          {total.toLocaleString()} {total === 1 ? 'result' : 'results'}
        </div>
        {totalPages > 1 && (
          <div className="text-text-tertiary text-sm">
            Page {currentPage} of {totalPages}
          </div>
        )}
      </div>

      {/* Right: View density controls */}
      <DensityControls currentDensity={density} onChange={onDensityChange} />
    </div>
  );
}
