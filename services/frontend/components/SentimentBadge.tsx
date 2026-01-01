'use client';

/**
 * SentimentBadge Component
 *
 * Displays color-coded emotional context indicator for message sentiment.
 * Supports compact and detailed display modes.
 */

interface SentimentBadgeProps {
  sentiment: 'positive' | 'negative' | 'neutral' | 'urgent' | null;
  mode?: 'compact' | 'detailed';
  showIcon?: boolean;
  showLabel?: boolean;
}

const SENTIMENT_CONFIG = {
  positive: {
    icon: '😊',
    label: 'POSITIVE',
    color: 'text-green-400',
    bg: 'bg-green-500/15',
    border: 'border-green-500/30'
  },
  negative: {
    icon: '😡',
    label: 'NEGATIVE',
    color: 'text-red-400',
    bg: 'bg-red-500/15',
    border: 'border-red-500/30'
  },
  neutral: {
    icon: '😐',
    label: 'NEUTRAL',
    color: 'text-gray-400',
    bg: 'bg-gray-500/15',
    border: 'border-gray-500/30'
  },
  urgent: {
    icon: '🚨',
    label: 'URGENT',
    color: 'text-orange-400',
    bg: 'bg-orange-500/15',
    border: 'border-orange-500/30'
  },
  unknown: {
    icon: '❓',
    label: 'UNKNOWN',
    color: 'text-gray-500',
    bg: 'bg-gray-600/10',
    border: 'border-gray-600/20'
  }
};

export default function SentimentBadge({
  sentiment,
  mode = 'compact',
  showIcon = true,
  showLabel = true
}: SentimentBadgeProps) {
  if (!sentiment) return null;

  const config = SENTIMENT_CONFIG[sentiment] || SENTIMENT_CONFIG.unknown;
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
      aria-label={`Sentiment: ${sentiment}`}
    >
      {showIcon && <span>{config.icon}</span>}
      {showLabel && <span className="font-medium">{config.label}</span>}
    </span>
  );
}
