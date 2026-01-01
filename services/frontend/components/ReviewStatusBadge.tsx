'use client';

/**
 * ReviewStatusBadge Component
 *
 * Human review workflow indicator.
 * Shows review status, reviewer name, and manual score.
 */

interface ReviewStatusBadgeProps {
  needsReview: boolean;
  reviewed: boolean;
  reviewedBy?: string;
  manualScore?: number;
  reviewedAt?: string;
  mode?: 'compact' | 'detailed';
}

export default function ReviewStatusBadge({
  needsReview,
  reviewed,
  reviewedBy,
  manualScore,
  reviewedAt,
  mode = 'compact'
}: ReviewStatusBadgeProps) {
  const isCompact = mode === 'compact';

  // Needs review takes priority
  if (needsReview) {
    if (isCompact) {
      return (
        <span
          className="
            inline-flex items-center gap-1
            bg-orange-500/20 text-orange-400
            border border-orange-500/40
            px-2 py-1 rounded
            text-xs font-medium
            whitespace-nowrap
          "
          role="status"
          aria-label="Needs human review"
        >
          <span>⚠️</span>
          <span>NEEDS REVIEW</span>
        </span>
      );
    }

    // Detailed mode
    return (
      <div
        className="
          flex items-center justify-between
          bg-orange-500/20 text-orange-400
          border border-orange-500/40
          px-3 py-2 rounded-lg
        "
        role="status"
        aria-label="Needs human review"
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">⚠️</span>
          <div>
            <div className="font-medium">Needs Human Review</div>
            <div className="text-xs opacity-70">Flagged for analyst verification</div>
          </div>
        </div>
      </div>
    );
  }

  // Reviewed status
  if (reviewed) {
    if (isCompact) {
      return (
        <span
          className="
            inline-flex items-center gap-1
            bg-green-500/20 text-green-400
            border border-green-500/30
            px-2 py-1 rounded
            text-xs
            whitespace-nowrap
          "
          role="status"
          aria-label="Reviewed"
        >
          <span>✓</span>
          <span>Reviewed</span>
        </span>
      );
    }

    // Detailed mode
    return (
      <div
        className="
          flex items-center justify-between
          bg-green-500/20 text-green-400
          border border-green-500/30
          px-3 py-2 rounded-lg
        "
        role="status"
        aria-label={`Reviewed by ${reviewedBy || 'analyst'}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">✓</span>
          <div>
            <div className="font-medium">
              Reviewed{reviewedBy && ` by ${reviewedBy}`}
            </div>
            {manualScore !== undefined && manualScore !== null && (
              <div className="text-xs opacity-70">
                Manual Score: {manualScore}/100
              </div>
            )}
          </div>
        </div>
        {manualScore !== undefined && manualScore !== null && (
          <div className="text-2xl font-bold">{manualScore}</div>
        )}
      </div>
    );
  }

  // No review status to display
  return null;
}
