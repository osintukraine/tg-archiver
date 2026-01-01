'use client';

/**
 * MediaOverlay Component
 *
 * Glass UI overlay displaying message enrichment data
 * Shows location, content preview, AI enrichment, entities, and engagement
 */

import { useState } from 'react';
import type { Message } from '@/lib/types';
import { formatNumber } from '@/lib/utils';

interface MediaOverlayProps {
  message: Message;
  compact?: boolean;
  onToggleExpand?: () => void;
}

// Helper to get sentiment icon and color
function getSentimentStyle(sentiment: string | null): { icon: string; color: string; label: string } {
  switch (sentiment) {
    case 'positive':
      return { icon: '😊', color: 'text-green-400', label: 'Positive' };
    case 'negative':
      return { icon: '😡', color: 'text-red-400', label: 'Negative' };
    case 'urgent':
      return { icon: '⚠️', color: 'text-orange-400', label: 'Urgent' };
    case 'neutral':
      return { icon: '😐', color: 'text-gray-400', label: 'Neutral' };
    default:
      return { icon: '💭', color: 'text-gray-500', label: 'Unknown' };
  }
}

// Helper to truncate text
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

export function MediaOverlay({ message, compact = false, onToggleExpand }: MediaOverlayProps) {
  const [isExpanded, setIsExpanded] = useState(!compact);

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
    onToggleExpand?.();
  };

  const sentiment = getSentimentStyle(message.content_sentiment);
  const hasLocation = message.location !== null && message.location !== undefined;
  const hasAIEnrichment = message.content_sentiment || message.content_urgency_level !== null || (message.tags && message.tags.length > 0);
  const hasEntities = (message.opensanctions_entities && message.opensanctions_entities.length > 0) ||
                      (message.curated_entities && message.curated_entities.length > 0);
  const hasEngagement = message.views !== null || message.forwards !== null;

  // Content display
  const displayContent = message.content_translated || message.content || 'No content';
  const contentPreview = isExpanded ? displayContent : truncateText(displayContent, 200);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 transition-all duration-300"
      style={{
        maxHeight: isExpanded ? '60vh' : '30vh',
        overflow: 'hidden',
      }}
    >
      <div
        className="mx-6 mb-6 rounded-xl overflow-y-auto transition-all duration-300"
        style={{
          background: 'rgba(15, 20, 25, 0.85)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          maxHeight: isExpanded ? '60vh' : '30vh',
        }}
      >
        <div className="p-6 space-y-4">
          {/* Location Info */}
          {hasLocation && message.location && (
            <div className="flex items-center gap-2 text-[#00d4ff]">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="font-medium">
                {message.location.location_name || 'Location'}
              </span>
              {message.location.confidence !== null && (
                <span className="text-sm text-gray-400">
                  Confidence: {Math.round(message.location.confidence * 100)}%
                </span>
              )}
            </div>
          )}

          {/* Content Preview */}
          <div className="space-y-2">
            <p className="text-white leading-relaxed">
              {contentPreview}
            </p>

            {/* Show More/Less Button */}
            {displayContent.length > 200 && (
              <button
                onClick={handleToggle}
                className="text-[#00d4ff] text-sm hover:underline flex items-center gap-1 transition-all duration-200"
              >
                {isExpanded ? 'SHOW LESS' : 'SHOW MORE'}
                <svg
                  className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )}
          </div>

          {/* AI Enrichment Section */}
          {hasAIEnrichment && isExpanded && (
            <div
              className="rounded-lg p-4 space-y-3"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <div className="text-xs text-gray-400 font-medium uppercase tracking-wide">
                AI Enrichment
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Sentiment Badge */}
                {message.content_sentiment && (
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${sentiment.color}`}
                       style={{ background: 'rgba(255, 255, 255, 0.1)' }}>
                    <span>{sentiment.icon}</span>
                    <span className="text-sm font-medium">{sentiment.label}</span>
                  </div>
                )}

                {/* Urgency Level */}
                {message.content_urgency_level !== null && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-orange-400"
                       style={{ background: 'rgba(255, 255, 255, 0.1)' }}>
                    <span>⚡</span>
                    <span className="text-sm font-medium">Urgency: {message.content_urgency_level}</span>
                  </div>
                )}

                {/* Top AI Tags */}
                {message.tags && message.tags.slice(0, 3).map((tag, idx) => (
                  <div
                    key={idx}
                    className="px-3 py-1.5 rounded-lg text-sm text-blue-300"
                    style={{ background: 'rgba(59, 130, 246, 0.2)' }}
                  >
                    🏷️ {tag.tag}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Entities Section */}
          {hasEntities && isExpanded && (
            <div
              className="rounded-lg p-4 space-y-3"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <div className="text-xs text-gray-400 font-medium uppercase tracking-wide">
                Entities
              </div>

              <div className="space-y-2">
                {/* Sanctioned Entities */}
                {message.opensanctions_entities && message.opensanctions_entities.slice(0, 3).map((entity, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-[#ff4444]"
                    style={{ background: 'rgba(255, 68, 68, 0.15)', border: '1px solid rgba(255, 68, 68, 0.3)' }}
                  >
                    <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span className="text-sm font-medium">{entity.name}</span>
                    <span className="text-xs text-gray-400">
                      ({entity.risk_classification})
                    </span>
                  </div>
                ))}

                {/* Curated Entities */}
                {message.curated_entities && message.curated_entities.slice(0, 3).map((entity, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-blue-400"
                    style={{ background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.3)' }}
                  >
                    <span className="text-sm">📚</span>
                    <span className="text-sm font-medium">{entity.name}</span>
                    <span className="text-xs text-gray-400">
                      ({entity.entity_type})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Engagement Metrics */}
          {hasEngagement && (
            <div className="flex items-center gap-4 text-gray-300 text-sm">
              {message.views !== null && (
                <div className="flex items-center gap-2" title={`${formatNumber(message.views)} views`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <span>{formatNumber(message.views)}</span>
                </div>
              )}

              {message.forwards !== null && (
                <div className="flex items-center gap-2" title={`${formatNumber(message.forwards)} forwards`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  <span>{formatNumber(message.forwards)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
