'use client';

/**
 * ChannelSourceBadge Component
 *
 * Displays channel source type indicator (state_media, military_unit, personality, etc.)
 * Human-managed via NocoDB, shows classification of what kind of source the channel is.
 */

interface ChannelSourceBadgeProps {
  sourceType: string | null | undefined;
  mode?: 'compact' | 'detailed';
  showIcon?: boolean;
  showLabel?: boolean;
}

// Source type configuration with colors and icons
const SOURCE_TYPE_CONFIG: Record<string, { icon: string; label: string; color: string; bg: string; border: string }> = {
  state_media: {
    icon: '🏛️',
    label: 'STATE MEDIA',
    color: 'text-purple-400',
    bg: 'bg-purple-500/15',
    border: 'border-purple-500/30'
  },
  military_unit: {
    icon: '⚔️',
    label: 'MILITARY UNIT',
    color: 'text-green-400',
    bg: 'bg-green-500/15',
    border: 'border-green-500/30'
  },
  military_official: {
    icon: '🎖️',
    label: 'MILITARY OFFICIAL',
    color: 'text-green-500',
    bg: 'bg-green-600/15',
    border: 'border-green-600/30'
  },
  government_official: {
    icon: '👔',
    label: 'GOVERNMENT',
    color: 'text-blue-400',
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/30'
  },
  journalist: {
    icon: '📰',
    label: 'JOURNALIST',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/15',
    border: 'border-cyan-500/30'
  },
  osint_aggregator: {
    icon: '🔍',
    label: 'OSINT',
    color: 'text-amber-400',
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/30'
  },
  news_aggregator: {
    icon: '📡',
    label: 'NEWS',
    color: 'text-gray-400',
    bg: 'bg-gray-500/15',
    border: 'border-gray-500/30'
  },
  personality: {
    icon: '🎤',
    label: 'PERSONALITY',
    color: 'text-pink-400',
    bg: 'bg-pink-500/15',
    border: 'border-pink-500/30'
  },
  regional: {
    icon: '📍',
    label: 'REGIONAL',
    color: 'text-teal-400',
    bg: 'bg-teal-500/15',
    border: 'border-teal-500/30'
  },
  militant: {
    icon: '⚠️',
    label: 'MILITANT',
    color: 'text-red-400',
    bg: 'bg-red-500/15',
    border: 'border-red-500/30'
  },
  unknown: {
    icon: '❓',
    label: 'UNCATEGORIZED',
    color: 'text-gray-500',
    bg: 'bg-gray-600/10',
    border: 'border-gray-600/20'
  }
};

export default function ChannelSourceBadge({
  sourceType,
  mode = 'compact',
  showIcon = true,
  showLabel = true
}: ChannelSourceBadgeProps) {
  // Don't render if no source type
  if (!sourceType) return null;

  const config = SOURCE_TYPE_CONFIG[sourceType] || SOURCE_TYPE_CONFIG.unknown;
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
      aria-label={`Source type: ${sourceType}`}
      title={`Channel source: ${config.label}`}
    >
      {showIcon && <span>{config.icon}</span>}
      {showLabel && <span className="font-medium">{config.label}</span>}
    </span>
  );
}
