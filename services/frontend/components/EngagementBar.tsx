'use client';

/**
 * EngagementBar Component
 *
 * Inline engagement metrics with virality indicator.
 * Shows views, forwards (with virality ratio), and comments.
 */

import { formatNumber, calculateViralityRatio, getViralityColor } from '@/lib/utils';

interface EngagementBarProps {
  views: number | null;
  forwards: number | null;
  commentsCount: number;
  mode?: 'compact' | 'detailed';
}

export default function EngagementBar({
  views,
  forwards,
  commentsCount,
  mode = 'compact'
}: EngagementBarProps) {
  const viralityRatio = views && forwards ? calculateViralityRatio(forwards, views) : 0;
  const isCompact = mode === 'compact';

  if (isCompact) {
    // Compact: Inline metrics
    return (
      <div className="flex items-center gap-3 text-xs text-text-tertiary">
        {views !== null && views > 0 && (
          <span className="flex items-center gap-1" title={`${views.toLocaleString()} views`}>
            <span>👁️</span>
            <span>{formatNumber(views)}</span>
          </span>
        )}

        {forwards !== null && forwards > 0 && (
          <span
            className={`flex items-center gap-1 ${getViralityColor(viralityRatio)}`}
            title={`${forwards.toLocaleString()} forwards (${viralityRatio.toFixed(2)}% virality)`}
          >
            <span>⤴️</span>
            <span>{formatNumber(forwards)}</span>
            <span className="font-medium">({viralityRatio.toFixed(1)}%)</span>
          </span>
        )}

        {commentsCount > 0 && (
          <span className="flex items-center gap-1" title={`${commentsCount} comments`}>
            <span>💬</span>
            <span>{commentsCount}</span>
          </span>
        )}
      </div>
    );
  }

  // Detailed: Vertical stat cards
  return (
    <div className="grid grid-cols-3 gap-4">
      {views !== null && (
        <div className="bg-bg-secondary rounded-lg p-3">
          <div className="text-xs text-text-tertiary mb-1">👁️ Views</div>
          <div className="text-lg font-bold text-text-primary">
            {formatNumber(views)}
          </div>
        </div>
      )}

      {forwards !== null && (
        <div className="bg-bg-secondary rounded-lg p-3">
          <div className="text-xs text-text-tertiary mb-1">⤴️ Forwards</div>
          <div className={`text-lg font-bold ${getViralityColor(viralityRatio)}`}>
            {formatNumber(forwards)}
          </div>
          <div className="text-xs text-text-tertiary mt-1">
            {viralityRatio.toFixed(2)}% virality
          </div>
        </div>
      )}

      {commentsCount > 0 && (
        <div className="bg-bg-secondary rounded-lg p-3">
          <div className="text-xs text-text-tertiary mb-1">💬 Comments</div>
          <div className="text-lg font-bold text-purple-400">
            {commentsCount}
          </div>
        </div>
      )}
    </div>
  );
}
