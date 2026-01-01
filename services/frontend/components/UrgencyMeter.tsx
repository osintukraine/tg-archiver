'use client';

/**
 * UrgencyMeter Component
 *
 * Visual 0-100 urgency scale with two display modes:
 * - Compact: Text-only indicator (hidden if urgency < 50)
 * - Detailed: Progress bar with color gradient
 */

import { getUrgencyColor, getUrgencyTextColor } from '@/lib/utils';

interface UrgencyMeterProps {
  urgency: number | null;
  mode?: 'compact' | 'detailed';
  showLabel?: boolean;
}

export default function UrgencyMeter({
  urgency,
  mode = 'compact',
  showLabel = true
}: UrgencyMeterProps) {
  if (urgency === null) return null;

  const isCompact = mode === 'compact';

  // In compact mode, hide if urgency is below threshold
  if (isCompact && urgency < 50) return null;

  if (isCompact) {
    // Compact: Text only with lightning icon
    return (
      <span
        className={`
          inline-flex items-center gap-1
          ${getUrgencyTextColor(urgency)}
          text-xs whitespace-nowrap
        `}
        aria-label={`Urgency: ${urgency}/100`}
      >
        <span>⚡</span>
        <span className="font-medium">{urgency}/100</span>
      </span>
    );
  }

  // Detailed: Progress bar
  return (
    <div className="flex items-center gap-2" aria-label={`Urgency: ${urgency}/100`}>
      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${getUrgencyColor(urgency)} transition-all duration-300`}
          style={{ width: `${urgency}%` }}
        />
      </div>
      {showLabel && (
        <span className={`text-xs font-medium ${getUrgencyTextColor(urgency)} min-w-[3rem] text-right`}>
          {urgency}/100
        </span>
      )}
    </div>
  );
}
