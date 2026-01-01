'use client';

/**
 * Density Controls Component
 *
 * Toggle buttons to switch between compact, detailed, and immersive view modes
 */

import { DensityMode } from '@/lib/types';

interface DensityControlsProps {
  currentDensity: DensityMode;
  onChange: (density: DensityMode) => void;
}

export function DensityControls({ currentDensity, onChange }: DensityControlsProps) {
  const modes: { value: 'compact' | 'detailed'; label: string; icon: string; description: string }[] = [
    {
      value: 'compact',
      label: 'Compact',
      icon: '☰',
      description: 'Timeline scrolling (120px height, 2-line preview)'
    },
    {
      value: 'detailed',
      label: 'Detailed',
      icon: '⊞',
      description: 'Full content (~400px height) - click message for full details'
    }
  ];

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-text-tertiary mr-2">View:</span>
      {modes.map((mode) => (
        <button
          key={mode.value}
          onClick={() => onChange(mode.value)}
          className={`
            px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200
            ${currentDensity === mode.value
              ? 'bg-accent-primary text-white shadow-sm'
              : 'bg-bg-secondary text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
            }
          `}
          title={mode.description}
        >
          <span className="mr-1.5">{mode.icon}</span>
          {mode.label}
        </button>
      ))}
    </div>
  );
}
