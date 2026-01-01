// services/frontend-nextjs/components/about/ViewToggle.tsx

'use client';

import { ViewMode } from '@/types/about';

interface ViewToggleProps {
  viewMode: ViewMode;
  onToggle: (mode: ViewMode) => void;
}

export default function ViewToggle({ viewMode, onToggle }: ViewToggleProps) {
  return (
    <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
      <button
        onClick={() => onToggle('pipeline')}
        className={`px-4 py-2 rounded-md transition-colors ${
          viewMode === 'pipeline'
            ? 'bg-white dark:bg-gray-700 shadow-sm font-semibold text-blue-600 dark:text-blue-400'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
        }`}
        aria-label="Switch to pipeline view"
        aria-pressed={viewMode === 'pipeline'}
      >
        Processing Pipeline
      </button>
      <button
        onClick={() => onToggle('infrastructure')}
        className={`px-4 py-2 rounded-md transition-colors ${
          viewMode === 'infrastructure'
            ? 'bg-white dark:bg-gray-700 shadow-sm font-semibold text-blue-600 dark:text-blue-400'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
        }`}
        aria-label="Switch to infrastructure view"
        aria-pressed={viewMode === 'infrastructure'}
      >
        Infrastructure Stack
      </button>
    </div>
  );
}
