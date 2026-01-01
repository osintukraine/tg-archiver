'use client';

/**
 * EnrichmentTab Component
 *
 * AI enrichment and technical metadata:
 * - Sentiment analysis with explanation
 * - Urgency meter with full scale
 * - Complexity indicator
 * - Key phrases (all of them)
 * - AI summary
 * - All AI tags grouped by type with confidence scores
 * - Embedding metadata (model, generated_at)
 * - Spam details (reason, type, confidence, review_status)
 * - Human review status
 * - Authenticity hashes (content_hash, metadata_hash)
 * - Archival metadata (archive_triggered_by, archive_priority)
 * - Translation metadata (provider, cost, timestamp)
 */

import { format } from 'date-fns';
import type { Message, Channel, MessageTag } from '@/lib/types';
import SentimentBadge from '../SentimentBadge';
import UrgencyMeter from '../UrgencyMeter';

interface EnrichmentTabProps {
  message: Message;
  channel?: Channel;
}

// Helper to get tag type styling
function getTagTypeStyle(tagType: string): { color: string; bgColor: string; icon: string } {
  switch (tagType) {
    case 'keywords':
      return { color: 'text-blue-300', bgColor: 'bg-blue-500/15', icon: '🔑' };
    case 'topics':
      return { color: 'text-green-300', bgColor: 'bg-green-500/15', icon: '📂' };
    case 'entities':
      return { color: 'text-orange-300', bgColor: 'bg-orange-500/15', icon: '🏷️' };
    case 'emotions':
      return { color: 'text-pink-300', bgColor: 'bg-pink-500/15', icon: '💭' };
    case 'urgency':
      return { color: 'text-amber-300', bgColor: 'bg-amber-500/15', icon: '⚡' };
    default:
      return { color: 'text-gray-300', bgColor: 'bg-gray-500/15', icon: '📌' };
  }
}

// Helper to format tags grouped by type
function formatTagsByType(tags: MessageTag[] | undefined): Record<string, MessageTag[]> {
  if (!tags || tags.length === 0) return {};

  const grouped: Record<string, MessageTag[]> = {};
  tags.forEach(tag => {
    if (!grouped[tag.tag_type]) {
      grouped[tag.tag_type] = [];
    }
    grouped[tag.tag_type].push(tag);
  });

  // Sort each group by confidence (highest first)
  Object.keys(grouped).forEach(type => {
    grouped[type].sort((a, b) => b.confidence - a.confidence);
  });

  return grouped;
}

// Complexity level labels
const COMPLEXITY_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  simple: { label: 'Simple', color: 'text-green-400', icon: '📄' },
  moderate: { label: 'Moderate', color: 'text-yellow-400', icon: '📑' },
  complex: { label: 'Complex', color: 'text-red-400', icon: '📚' },
};

export default function EnrichmentTab({ message }: EnrichmentTabProps) {
  const hasAIEnrichment = message.content_sentiment ||
                          message.content_urgency_level !== null ||
                          message.content_complexity ||
                          message.key_phrases ||
                          message.summary;

  const hasTags = message.tags && message.tags.length > 0;
  const hasEmbedding = message.embedding_model !== null;
  const hasSpamData = message.is_spam || message.spam_confidence !== null;
  const hasHumanReview = message.needs_human_review || message.osint_reviewed;
  const hasHashes = message.content_hash !== null || message.metadata_hash !== null;
  const hasArchivalData = message.archive_triggered_by !== null;
  const hasTranslationData = message.translation_provider !== null;

  const tagsByType = formatTagsByType(message.tags);
  const complexityInfo = message.content_complexity
    ? COMPLEXITY_LABELS[message.content_complexity] || { label: message.content_complexity, color: 'text-text-secondary', icon: '📄' }
    : null;

  return (
    <div className="space-y-6">
      {/* AI Enrichment Summary */}
      {hasAIEnrichment && (
        <div>
          <h3 className="text-sm font-medium text-text-tertiary mb-4">AI Analysis</h3>

          {/* Sentiment, Urgency, Complexity */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            {/* Sentiment */}
            {message.content_sentiment && (
              <div className="bg-bg-secondary rounded-lg p-4 border border-border-subtle">
                <div className="text-xs text-text-tertiary mb-2">Sentiment</div>
                <SentimentBadge sentiment={message.content_sentiment as 'positive' | 'negative' | 'neutral' | 'urgent' | null} mode="detailed" />
                <p className="text-xs text-text-secondary mt-2">
                  Overall emotional tone detected in content
                </p>
              </div>
            )}

            {/* Urgency */}
            {message.content_urgency_level !== null && (
              <div className="bg-bg-secondary rounded-lg p-4 border border-border-subtle">
                <div className="text-xs text-text-tertiary mb-3">Urgency Level</div>
                <UrgencyMeter urgency={message.content_urgency_level} mode="detailed" showLabel={true} />
                <p className="text-xs text-text-secondary mt-2">
                  {message.content_urgency_level >= 80 && 'Critical time-sensitive information'}
                  {message.content_urgency_level >= 60 && message.content_urgency_level < 80 && 'High urgency, timely action recommended'}
                  {message.content_urgency_level >= 40 && message.content_urgency_level < 60 && 'Moderate urgency'}
                  {message.content_urgency_level < 40 && 'Low urgency, routine information'}
                </p>
              </div>
            )}

            {/* Complexity */}
            {complexityInfo && (
              <div className="bg-bg-secondary rounded-lg p-4 border border-border-subtle">
                <div className="text-xs text-text-tertiary mb-2">Complexity</div>
                <div className={`flex items-center gap-2 ${complexityInfo.color}`}>
                  <span className="text-2xl">{complexityInfo.icon}</span>
                  <span className="text-lg font-medium">{complexityInfo.label}</span>
                </div>
                <p className="text-xs text-text-secondary mt-2">
                  Content structure and information density
                </p>
              </div>
            )}
          </div>

          {/* Key Phrases */}
          {message.key_phrases && message.key_phrases.length > 0 && (
            <div className="bg-bg-secondary rounded-lg p-4 border border-border-subtle">
              <div className="text-xs text-text-tertiary mb-3">Key Phrases ({message.key_phrases.length})</div>
              <div className="flex flex-wrap gap-2">
                {message.key_phrases.map((phrase, idx) => (
                  <span
                    key={idx}
                    className="px-3 py-1.5 rounded text-sm bg-purple-500/15 text-purple-300 border border-purple-500/20"
                  >
                    {phrase}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* AI Summary */}
          {message.summary && (
            <div className="bg-bg-secondary rounded-lg p-4 border border-border-subtle">
              <div className="text-xs text-text-tertiary mb-3">AI-Generated Summary</div>
              <p className="text-sm text-text-primary leading-relaxed">
                {message.summary}
              </p>
              {message.summary_generated_at && (
                <p className="text-xs text-text-tertiary mt-2">
                  Generated: {format(new Date(message.summary_generated_at), 'MMM d, yyyy • HH:mm:ss')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* AI Tags */}
      {hasTags && (
        <div>
          <h3 className="text-sm font-medium text-text-tertiary mb-4">
            AI Tags ({message.tags!.length} total)
          </h3>
          <div className="space-y-4">
            {Object.entries(tagsByType).map(([tagType, tags]) => {
              const style = getTagTypeStyle(tagType);
              return (
                <div key={tagType} className="bg-bg-secondary rounded-lg p-4 border border-border-subtle">
                  <div className={`flex items-center gap-2 mb-3 ${style.color}`}>
                    <span className="text-lg">{style.icon}</span>
                    <h4 className="text-sm font-medium capitalize">
                      {tagType} ({tags.length})
                    </h4>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag, i) => (
                      <span
                        key={i}
                        className={`${style.bgColor} ${style.color} px-3 py-1.5 rounded text-sm border border-current/20 flex items-center gap-2`}
                        title={`Generated by ${tag.generated_by} • ${format(new Date(tag.created_at), 'MMM d, yyyy')}`}
                      >
                        <span>{tag.tag}</span>
                        <span className="text-xs opacity-60 font-medium">
                          {(tag.confidence * 100).toFixed(0)}%
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Embedding Metadata */}
      {hasEmbedding && (
        <div>
          <h3 className="text-sm font-medium text-text-tertiary mb-4">Vector Embeddings</h3>
          <div className="bg-bg-secondary rounded-lg p-4 border border-border-subtle">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-text-tertiary mb-1">Model</div>
                <div className="text-sm text-text-primary font-mono">{message.embedding_model}</div>
              </div>
              {message.embedding_generated_at && (
                <div>
                  <div className="text-xs text-text-tertiary mb-1">Generated</div>
                  <div className="text-sm text-text-primary">
                    {format(new Date(message.embedding_generated_at), 'MMM d, yyyy • HH:mm:ss')}
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs text-text-secondary mt-3">
              Semantic vector embeddings enable similarity search and clustering analysis
            </p>
          </div>
        </div>
      )}

      {/* Spam Detection */}
      {hasSpamData && (
        <div>
          <h3 className="text-sm font-medium text-text-tertiary mb-4">Spam Detection</h3>
          <div className={`rounded-lg p-4 border-2 ${
            message.is_spam ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'
          }`}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{message.is_spam ? '🚫' : '✅'}</span>
                <span className={`text-lg font-medium ${message.is_spam ? 'text-red-400' : 'text-green-400'}`}>
                  {message.is_spam ? 'Spam Detected' : 'Not Spam'}
                </span>
              </div>
              {message.spam_confidence !== null && (
                <span className={`text-sm font-medium ${message.is_spam ? 'text-red-400' : 'text-green-400'}`}>
                  {(message.spam_confidence * 100).toFixed(1)}% confidence
                </span>
              )}
            </div>

            {message.spam_reason && (
              <div className="mb-2">
                <div className="text-xs text-text-tertiary mb-1">Reason</div>
                <div className="text-sm text-text-primary">{message.spam_reason}</div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-xs">
              {message.spam_type && (
                <div>
                  <div className="text-text-tertiary mb-1">Type</div>
                  <div className="text-text-primary capitalize">{message.spam_type.replace('_', ' ')}</div>
                </div>
              )}
              {message.spam_review_status && (
                <div>
                  <div className="text-text-tertiary mb-1">Review Status</div>
                  <div className="text-text-primary capitalize">{message.spam_review_status.replace('_', ' ')}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Human Review Status */}
      {hasHumanReview && (
        <div>
          <h3 className="text-sm font-medium text-text-tertiary mb-4">Human Review</h3>
          <div className="bg-bg-secondary rounded-lg p-4 border border-border-subtle">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-tertiary">Needs Review:</span>
                <span className={`text-sm font-medium ${message.needs_human_review ? 'text-orange-400' : 'text-green-400'}`}>
                  {message.needs_human_review ? 'Yes' : 'No'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-text-tertiary">Reviewed:</span>
                <span className={`text-sm font-medium ${message.osint_reviewed ? 'text-green-400' : 'text-text-secondary'}`}>
                  {message.osint_reviewed ? 'Yes' : 'No'}
                </span>
              </div>

              {message.osint_manual_score !== null && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-tertiary">Manual Score:</span>
                  <span className="text-sm font-medium text-text-primary">{message.osint_manual_score}</span>
                </div>
              )}

              {message.reviewed_by && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-tertiary">Reviewed By:</span>
                  <span className="text-sm text-text-primary">{message.reviewed_by}</span>
                </div>
              )}

              {message.reviewed_at && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-text-tertiary">Reviewed At:</span>
                  <span className="text-sm text-text-primary">
                    {format(new Date(message.reviewed_at), 'MMM d, yyyy • HH:mm:ss')}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Authenticity Hashes */}
      {hasHashes && (
        <div>
          <h3 className="text-sm font-medium text-text-tertiary mb-4">Message Authenticity</h3>
          <div className="bg-bg-secondary rounded-lg p-4 border border-border-subtle">
            <p className="text-xs text-text-secondary mb-3">
              Cryptographic hashes ensure message integrity and detect tampering
            </p>
            <div className="space-y-3 font-mono text-xs">
              {message.content_hash && (
                <div>
                  <div className="text-text-tertiary mb-1">Content Hash ({message.hash_algorithm})</div>
                  <div className="text-text-primary break-all bg-bg-tertiary p-2 rounded">
                    {message.content_hash}
                  </div>
                </div>
              )}

              {message.metadata_hash && (
                <div>
                  <div className="text-text-tertiary mb-1">Metadata Hash ({message.hash_algorithm})</div>
                  <div className="text-text-primary break-all bg-bg-tertiary p-2 rounded">
                    {message.metadata_hash}
                  </div>
                </div>
              )}

              {message.hash_generated_at && (
                <div className="flex items-center gap-2 text-text-tertiary">
                  <span>Generated:</span>
                  <span className="text-text-primary">
                    {format(new Date(message.hash_generated_at), 'MMM d, yyyy • HH:mm:ss')}
                  </span>
                  {message.hash_version && <span>• v{message.hash_version}</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Archival Metadata */}
      {hasArchivalData && (
        <div>
          <h3 className="text-sm font-medium text-text-tertiary mb-4">Archival Information</h3>
          <div className="bg-bg-secondary rounded-lg p-4 border border-border-subtle">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-text-tertiary mb-1">Triggered By</div>
                <div className="text-text-primary font-mono">Message #{message.archive_triggered_by}</div>
              </div>

              {message.archive_priority !== null && (
                <div>
                  <div className="text-xs text-text-tertiary mb-1">Priority</div>
                  <div className="text-text-primary">{message.archive_priority}</div>
                </div>
              )}

              {message.archive_triggered_at && (
                <div className="col-span-2">
                  <div className="text-xs text-text-tertiary mb-1">Triggered At</div>
                  <div className="text-text-primary">
                    {format(new Date(message.archive_triggered_at), 'MMM d, yyyy • HH:mm:ss')}
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs text-text-secondary mt-3">
              Selective archival: Message archived based on trigger rules and priority scoring
            </p>
          </div>
        </div>
      )}

      {/* Translation Metadata */}
      {hasTranslationData && (
        <div>
          <h3 className="text-sm font-medium text-text-tertiary mb-4">Translation</h3>
          <div className="bg-bg-secondary rounded-lg p-4 border border-border-subtle">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-text-tertiary mb-1">Provider</div>
                <div className="text-text-primary">{message.translation_provider}</div>
              </div>

              {message.language_detected && (
                <div>
                  <div className="text-xs text-text-tertiary mb-1">Detected Language</div>
                  <div className="text-text-primary">{message.language_detected}</div>
                </div>
              )}

              {message.translation_target && (
                <div>
                  <div className="text-xs text-text-tertiary mb-1">Target Language</div>
                  <div className="text-text-primary">{message.translation_target}</div>
                </div>
              )}

              {message.translation_cost_usd !== null && (
                <div>
                  <div className="text-xs text-text-tertiary mb-1">Cost</div>
                  <div className="text-text-primary">${message.translation_cost_usd.toFixed(4)} USD</div>
                </div>
              )}

              {message.translation_timestamp && (
                <div className="col-span-2">
                  <div className="text-xs text-text-tertiary mb-1">Translated At</div>
                  <div className="text-text-primary">
                    {format(new Date(message.translation_timestamp), 'MMM d, yyyy • HH:mm:ss')}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Processing Info */}
      <div className="bg-bg-secondary rounded-lg p-4 border border-border-subtle">
        <h3 className="text-sm font-medium text-text-tertiary mb-3">Processing Timeline</h3>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Message Archived</span>
            <span className="text-text-primary font-mono">
              {format(new Date(message.created_at), 'MMM d, yyyy • HH:mm:ss')}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-text-secondary">Last Updated</span>
            <span className="text-text-primary font-mono">
              {format(new Date(message.updated_at), 'MMM d, yyyy • HH:mm:ss')}
            </span>
          </div>
          {message.is_backfilled && (
            <div className="flex items-center gap-2 text-accent-warning">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <span>Backfilled from historical data</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
