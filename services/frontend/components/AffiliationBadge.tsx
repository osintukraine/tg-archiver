'use client';

/**
 * AffiliationBadge Component
 *
 * Displays channel affiliation indicator (russia, ukraine, unknown).
 * Uses flag colors for clear visual identification of source origin.
 * Human-managed via NocoDB.
 */

interface AffiliationBadgeProps {
  affiliation: string | null | undefined;
  mode?: 'compact' | 'detailed';
  showIcon?: boolean;
  showLabel?: boolean;
}

// Affiliation configuration with national flag colors
const AFFILIATION_CONFIG: Record<string, { icon: string; label: string; color: string; bg: string; border: string }> = {
  ukraine: {
    icon: '🇺🇦',
    label: 'UKRAINE',
    color: 'text-yellow-400',
    bg: 'bg-gradient-to-r from-blue-500/20 to-yellow-500/20',
    border: 'border-blue-500/40'
  },
  russia: {
    icon: '🇷🇺',
    label: 'RUSSIA',
    color: 'text-red-400',
    bg: 'bg-gradient-to-r from-white/10 via-blue-500/10 to-red-500/20',
    border: 'border-red-500/40'
  },
  unknown: {
    icon: '❓',
    label: 'UNKNOWN',
    color: 'text-gray-500',
    bg: 'bg-gray-600/10',
    border: 'border-gray-600/20'
  }
};

export default function AffiliationBadge({
  affiliation,
  mode = 'compact',
  showIcon = true,
  showLabel = true
}: AffiliationBadgeProps) {
  // Don't render if no affiliation
  if (!affiliation) return null;

  const config = AFFILIATION_CONFIG[affiliation] || AFFILIATION_CONFIG.unknown;
  const isCompact = mode === 'compact';

  return (
    <span
      className={`
        inline-flex items-center gap-1
        ${config.bg} ${config.color} ${config.border}
        border rounded
        ${isCompact ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'}
        whitespace-nowrap
      `}
      role="status"
      aria-label={`Affiliation: ${affiliation}`}
      title={`Channel affiliation: ${config.label}`}
    >
      {showIcon && <span>{config.icon}</span>}
      {showLabel && <span className="font-medium">{config.label}</span>}
    </span>
  );
}
