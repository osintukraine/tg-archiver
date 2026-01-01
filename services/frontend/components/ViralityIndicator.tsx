'use client';

/**
 * ViralityIndicator Component
 *
 * Standalone virality visualization showing forward/view ratio.
 * Three size variants: sm, md, lg
 */

import { calculateViralityRatio, getViralityColor } from '@/lib/utils';

interface ViralityIndicatorProps {
  views: number;
  forwards: number;
  size?: 'sm' | 'md' | 'lg';
}

const VIRALITY_LEVELS = {
  viral: {
    threshold: 5,
    label: 'Viral',
    color: 'text-red-400',
    bg: 'bg-red-500/20',
    border: 'border-red-500/40'
  },
  elevated: {
    threshold: 1,
    label: 'Elevated',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/20',
    border: 'border-yellow-500/40'
  },
  normal: {
    threshold: 0,
    label: 'Normal',
    color: 'text-text-tertiary',
    bg: 'bg-gray-500/10',
    border: 'border-gray-500/30'
  }
};

function getViralityLevel(ratio: number) {
  if (ratio > 5) return VIRALITY_LEVELS.viral;
  if (ratio > 1) return VIRALITY_LEVELS.elevated;
  return VIRALITY_LEVELS.normal;
}

export default function ViralityIndicator({
  views,
  forwards,
  size = 'md'
}: ViralityIndicatorProps) {
  const ratio = calculateViralityRatio(forwards, views);
  const level = getViralityLevel(ratio);

  // Size configurations
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-base px-3 py-1.5'
  };

  const iconSizes = {
    sm: 'text-xs',
    md: 'text-base',
    lg: 'text-xl'
  };

  if (size === 'sm') {
    // Small: Just percentage with color
    return (
      <span
        className={`${getViralityColor(ratio)} font-medium`}
        title={`${ratio.toFixed(2)}% virality (${forwards.toLocaleString()} forwards / ${views.toLocaleString()} views)`}
      >
        ({ratio.toFixed(1)}%)
      </span>
    );
  }

  if (size === 'md') {
    // Medium: Icon + percentage
    return (
      <span
        className={`
          inline-flex items-center gap-1
          ${level.color} ${level.bg} ${level.border}
          border rounded
          ${sizeClasses[size]}
          whitespace-nowrap
        `}
        title={`${level.label} virality: ${ratio.toFixed(2)}%`}
      >
        <span className={iconSizes[size]}>⤴️</span>
        <span className="font-medium">{ratio.toFixed(1)}%</span>
      </span>
    );
  }

  // Large: Full badge with label
  return (
    <div
      className={`
        inline-flex items-center gap-2
        ${level.color} ${level.bg} ${level.border}
        border rounded-lg
        ${sizeClasses[size]}
      `}
      title={`${forwards.toLocaleString()} forwards / ${views.toLocaleString()} views`}
    >
      <span className={iconSizes[size]}>⤴️</span>
      <div className="flex flex-col items-start">
        <span className="text-xs opacity-70 uppercase">{level.label}</span>
        <span className="text-lg font-bold leading-none">{ratio.toFixed(1)}%</span>
      </div>
      <div className="text-xs opacity-60">
        {forwards.toLocaleString()} / {views.toLocaleString()}
      </div>
    </div>
  );
}
