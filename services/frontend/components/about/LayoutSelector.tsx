// services/frontend-nextjs/components/about/LayoutSelector.tsx

'use client';

import { LayoutMode } from '@/types/about';
import { Network, ArrowDown, ArrowRight, ArrowLeft } from 'lucide-react';

interface LayoutSelectorProps {
  layoutMode: LayoutMode;
  onLayoutChange: (mode: LayoutMode) => void;
}

const layoutOptions: Array<{
  mode: LayoutMode;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}> = [
  {
    mode: 'manual',
    label: 'Optimized',
    icon: Network,
    description: 'Hand-crafted layout',
  },
  {
    mode: 'dagre-tb',
    label: 'Top to Bottom',
    icon: ArrowDown,
    description: 'Hierarchical layout (top-bottom)',
  },
  {
    mode: 'dagre-lr',
    label: 'Left to Right',
    icon: ArrowRight,
    description: 'Hierarchical layout (left-right)',
  },
  {
    mode: 'dagre-rl',
    label: 'Right to Left',
    icon: ArrowLeft,
    description: 'Hierarchical layout (right-left)',
  },
];

export default function LayoutSelector({ layoutMode, onLayoutChange }: LayoutSelectorProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">
        Layout Algorithm
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {layoutOptions.map((option) => {
          const Icon = option.icon;
          const isActive = layoutMode === option.mode;

          return (
            <button
              key={option.mode}
              onClick={() => onLayoutChange(option.mode)}
              className={`
                flex flex-col items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all
                ${
                  isActive
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 text-gray-700 dark:text-gray-300'
                }
              `}
              title={option.description}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-blue-600 dark:text-blue-400' : ''}`} />
              <span className="text-xs font-medium text-center">{option.label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
        Switch between manual positioning and automatic hierarchical layouts
      </p>
    </div>
  );
}
