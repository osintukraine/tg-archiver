'use client';

/**
 * SocialGraphIndicator Component
 *
 * Shows forward chains, reply threads, and comments in compact form.
 * Color-coded: Forward=blue, Reply=green, Comments=purple
 */

interface SocialGraphIndicatorProps {
  forwardFromChannelId?: number;
  repliedToMessageId?: number;
  commentsCount: number;
  hasComments: boolean;
  mode?: 'compact' | 'detailed';
  className?: string;
}

export default function SocialGraphIndicator({
  forwardFromChannelId,
  repliedToMessageId,
  commentsCount,
  hasComments,
  mode = 'compact',
  className = ''
}: SocialGraphIndicatorProps) {
  const isCompact = mode === 'compact';
  const hasAnyIndicator = forwardFromChannelId || repliedToMessageId || hasComments;

  if (!hasAnyIndicator) return null;

  if (isCompact) {
    // Compact: Icon badges with counts
    return (
      <div className={`flex items-center gap-2 text-xs ${className}`}>
        {forwardFromChannelId && (
          <span
            className="flex items-center gap-0.5 text-blue-400 bg-blue-500/15 px-1.5 py-0.5 rounded border border-blue-500/30"
            title="Forwarded message"
          >
            <span>⤴️</span>
          </span>
        )}

        {hasComments && commentsCount > 0 && (
          <span
            className="flex items-center gap-0.5 text-purple-400 bg-purple-500/15 px-1.5 py-0.5 rounded border border-purple-500/30"
            title={`${commentsCount} comments`}
          >
            <span>💬</span>
            <span className="font-medium">{commentsCount}</span>
          </span>
        )}

        {repliedToMessageId && (
          <span
            className="flex items-center gap-0.5 text-green-400 bg-green-500/15 px-1.5 py-0.5 rounded border border-green-500/30"
            title="Reply to another message"
          >
            <span>↩️</span>
          </span>
        )}
      </div>
    );
  }

  // Detailed: Expanded badges with labels
  return (
    <div className={`flex flex-wrap gap-2 text-sm ${className}`}>
      {forwardFromChannelId && (
        <div className="flex items-center gap-2 text-blue-400 bg-blue-500/15 px-3 py-1.5 rounded border border-blue-500/30">
          <span>⤴️</span>
          <span>Forwarded Message</span>
        </div>
      )}

      {hasComments && commentsCount > 0 && (
        <div className="flex items-center gap-2 text-purple-400 bg-purple-500/15 px-3 py-1.5 rounded border border-purple-500/30">
          <span>💬</span>
          <span>{commentsCount} {commentsCount === 1 ? 'Comment' : 'Comments'}</span>
        </div>
      )}

      {repliedToMessageId && (
        <div className="flex items-center gap-2 text-green-400 bg-green-500/15 px-3 py-1.5 rounded border border-green-500/30">
          <span>↩️</span>
          <span>Reply Thread</span>
        </div>
      )}
    </div>
  );
}
