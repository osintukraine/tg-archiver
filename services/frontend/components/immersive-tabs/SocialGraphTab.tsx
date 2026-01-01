'use client';

/**
 * SocialGraphTab Component
 *
 * Social graph and engagement visualization:
 * - Engagement metrics (views, forwards, comments) in large stat cards
 * - Virality ratio with color coding
 * - Forward chain visualization (if forwarded)
 * - Reply thread indicator (if reply)
 * - Discussion thread link (if has_comments)
 * - Author info (if author_user_id available)
 */

import { format } from 'date-fns';
import type { Message, Channel } from '@/lib/types';
import { formatNumber, calculateViralityRatio, getViralityColor } from '@/lib/utils';
import ViralityIndicator from '../ViralityIndicator';
import { SocialNetworkGraph } from '../social-graph/SocialNetworkGraph';

interface SocialGraphTabProps {
  message: Message;
  channel?: Channel;
}

export default function SocialGraphTab({ message, channel }: SocialGraphTabProps) {
  const hasEngagement = message.views !== null || message.forwards !== null || message.comments_count > 0;
  const hasSocialGraph = message.forward_from_channel_id !== null ||
                         message.replied_to_message_id !== null ||
                         message.has_comments ||
                         message.author_user_id !== null;

  const viralityRatio = message.views && message.forwards
    ? calculateViralityRatio(message.forwards, message.views)
    : 0;

  if (!hasEngagement && !hasSocialGraph) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="text-center text-text-tertiary">
          <div className="text-4xl mb-2">📊</div>
          <p>No social graph or engagement data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Engagement Metrics */}
      {hasEngagement && (
        <div>
          <h3 className="text-sm font-medium text-text-tertiary mb-4">Engagement Metrics</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Views */}
            {message.views !== null && (
              <div className="bg-bg-secondary rounded-lg p-6 border border-border-subtle">
                <div className="flex items-center gap-2 text-text-tertiary mb-2">
                  <span className="text-xl">👁️</span>
                  <span className="text-sm font-medium">Views</span>
                </div>
                <div className="text-3xl font-bold text-text-primary">
                  {formatNumber(message.views)}
                </div>
                <div className="text-xs text-text-tertiary mt-1">
                  {message.views.toLocaleString()} total
                </div>
              </div>
            )}

            {/* Forwards */}
            {message.forwards !== null && (
              <div className="bg-bg-secondary rounded-lg p-6 border border-border-subtle">
                <div className="flex items-center gap-2 text-text-tertiary mb-2">
                  <span className="text-xl">⤴️</span>
                  <span className="text-sm font-medium">Forwards</span>
                </div>
                <div className={`text-3xl font-bold ${getViralityColor(viralityRatio)}`}>
                  {formatNumber(message.forwards)}
                </div>
                <div className="text-xs text-text-tertiary mt-1">
                  {message.forwards.toLocaleString()} total
                </div>
              </div>
            )}

            {/* Comments */}
            {message.comments_count > 0 && (
              <div className="bg-bg-secondary rounded-lg p-6 border border-border-subtle">
                <div className="flex items-center gap-2 text-text-tertiary mb-2">
                  <span className="text-xl">💬</span>
                  <span className="text-sm font-medium">Comments</span>
                </div>
                <div className="text-3xl font-bold text-purple-400">
                  {message.comments_count}
                </div>
                <div className="text-xs text-text-tertiary mt-1">
                  discussion thread
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Virality Analysis */}
      {message.views !== null && message.forwards !== null && message.views > 0 && (
        <div className="bg-bg-secondary rounded-lg p-6 border border-border-subtle">
          <h3 className="text-sm font-medium text-text-tertiary mb-4">Virality Analysis</h3>
          <div className="flex items-center gap-4">
            <ViralityIndicator
              views={message.views}
              forwards={message.forwards}
              size="lg"
            />
            <div className="flex-1 text-sm text-text-secondary">
              <p className="mb-2">
                <strong className={getViralityColor(viralityRatio)}>
                  {viralityRatio > 5 ? 'Highly viral' : viralityRatio > 1 ? 'Above average' : 'Normal'}
                </strong> forward rate for this message.
              </p>
              <p className="text-xs text-text-tertiary">
                {viralityRatio > 5 && 'This message is spreading rapidly across Telegram. Top 1% virality.'}
                {viralityRatio > 1 && viralityRatio <= 5 && 'This message has elevated sharing activity.'}
                {viralityRatio <= 1 && 'Standard engagement levels for this channel.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Social Graph Information */}
      {hasSocialGraph && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-text-tertiary">Social Graph</h3>

          {/* Forward Chain */}
          {message.forward_from_channel_id !== null && (
            <div className="bg-blue-500/10 border-l-4 border-blue-500 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">⤴️</span>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-blue-400 mb-1">Forwarded Message</h4>
                  <p className="text-sm text-text-secondary mb-2">
                    This message was forwarded from another channel, indicating cross-channel information flow.
                  </p>
                  <div className="space-y-1 text-xs text-text-tertiary font-mono">
                    <div>Source Channel ID: {message.forward_from_channel_id}</div>
                    {message.forward_from_message_id && (
                      <div>Source Message ID: {message.forward_from_message_id}</div>
                    )}
                    {message.forward_date && (
                      <div>Original Date: {format(new Date(message.forward_date), 'MMM d, yyyy • HH:mm:ss')}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Reply Thread */}
          {message.replied_to_message_id !== null && (
            <div className="bg-green-500/10 border-l-4 border-green-500 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">↩️</span>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-green-400 mb-1">Reply Thread</h4>
                  <p className="text-sm text-text-secondary mb-2">
                    This message is a reply to another message in this channel.
                  </p>
                  <div className="space-y-1 text-xs text-text-tertiary font-mono">
                    <div>Replied to Message ID: {message.replied_to_message_id}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Discussion Thread */}
          {message.has_comments && (
            <div className="bg-purple-500/10 border-l-4 border-purple-500 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">💬</span>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-purple-400 mb-1">Discussion Thread</h4>
                  <p className="text-sm text-text-secondary mb-2">
                    This message has an active discussion thread with {message.comments_count} comment{message.comments_count !== 1 ? 's' : ''}.
                  </p>
                  {message.linked_chat_id && (
                    <div className="text-xs text-text-tertiary font-mono">
                      Linked Chat ID: {message.linked_chat_id}
                    </div>
                  )}
                  {channel && channel.username && (
                    <a
                      href={`https://t.me/${channel.username}/${message.message_id}?thread=${message.message_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-3 text-sm text-purple-400 hover:underline"
                    >
                      View discussion on Telegram →
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Author Information */}
          {message.author_user_id !== null && (
            <div className="bg-orange-500/10 border-l-4 border-orange-500 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">👤</span>
                <div className="flex-1">
                  <h4 className="text-sm font-medium text-orange-400 mb-1">Message Author</h4>
                  <p className="text-sm text-text-secondary mb-2">
                    This message has an identified author (common in group chats).
                  </p>
                  <div className="text-xs text-text-tertiary font-mono">
                    Author User ID: {message.author_user_id}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Social Network Graph Visualization */}
      <SocialNetworkGraph messageId={message.id} />
    </div>
  );
}
