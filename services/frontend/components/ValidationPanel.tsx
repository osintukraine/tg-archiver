'use client';

import { useState, useEffect, useRef } from 'react';
import { getMessageValidation, ValidationPendingResponse } from '../lib/api';
import type { ValidationResponse, ArticleValidationItem } from '../lib/types';

interface ValidationPanelProps {
  messageId: number;
}

/**
 * Validation Panel Component
 *
 * Displays pre-computed validation results for a Telegram message.
 * Shows how RSS news articles confirm, contradict, or provide context.
 *
 * Architecture:
 * - API returns cached results instantly (no LLM on critical path)
 * - If validation pending (202), shows pending state and auto-retries
 * - Background enrichment computes validations asynchronously
 */
export function ValidationPanel({ messageId }: ValidationPanelProps) {
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [pending, setPending] = useState<ValidationPendingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Max retries for pending state (3 retries = ~90 seconds total)
  const MAX_RETRIES = 3;

  useEffect(() => {
    async function fetchValidation() {
      try {
        // Only show loading spinner on first load, not during retries
        if (!pending) {
          setLoading(true);
        }
        setError(null);
        const data = await getMessageValidation(messageId);

        // Handle different response types
        if (data === null) {
          // No correlations found
          setValidation(null);
          setPending(null);
        } else if ('status' in data && data.status === 'pending') {
          // Validation is pending (202)
          setPending(data as ValidationPendingResponse);
          setValidation(null);

          // Schedule retry if under max retries
          if (retryCount < MAX_RETRIES) {
            const retryDelay = (data as ValidationPendingResponse).retry_after * 1000 || 30000;
            retryTimerRef.current = setTimeout(() => {
              setRetryCount(prev => prev + 1);
            }, retryDelay);
          }
        } else {
          // Validation complete (200)
          setValidation(data as ValidationResponse);
          setPending(null);
        }
      } catch (err) {
        // Silently handle "no validation data" cases (404, no articles found)
        if (err instanceof Error && (err.message.includes('404') || err.message.includes('No similar articles'))) {
          setValidation(null);
          setPending(null);
          setError(null);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load validation');
        }
      } finally {
        setLoading(false);
      }
    }

    fetchValidation();

    // Cleanup timer on unmount
    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
      }
    };
  }, [messageId, retryCount]);

  // Loading state
  if (loading && !pending) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
          <span>Loading validation...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 border border-red-200 dark:border-red-800">
        <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
      </div>
    );
  }

  // Pending state (validation being computed in background)
  if (pending) {
    return (
      <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 border border-yellow-200 dark:border-yellow-800">
        <div className="flex items-center gap-2 mb-2">
          <div className="animate-spin h-4 w-4 border-2 border-yellow-500 border-t-transparent rounded-full"></div>
          <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
            Cross-Reference Analysis in Progress
          </h3>
        </div>
        <p className="text-sm text-yellow-700 dark:text-yellow-400">
          Found {pending.correlation_count} related article{pending.correlation_count !== 1 ? 's' : ''}.
          AI is analyzing relevance in the background.
        </p>
        <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-2">
          {retryCount < MAX_RETRIES
            ? `Auto-refreshing in ${pending.retry_after}s... (attempt ${retryCount + 1}/${MAX_RETRIES + 1})`
            : 'Still processing. Please refresh the page in a minute.'}
        </p>
      </div>
    );
  }

  // No validation data at all - don't show panel
  if (!validation) {
    return null;
  }

  // Validation complete but no relevant articles found
  if (validation.total_articles_found === 0) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-xl">🔍</div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Cross-Reference with News Sources
          </h3>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          No similar news articles found for cross-referencing.
        </p>
      </div>
    );
  }

  const { summary, articles_by_type, overall_confidence, article_validations, cached } = validation;

  return (
    <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-900 rounded-lg p-4 border border-blue-200 dark:border-gray-700 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="text-2xl">🔍</div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              Cross-Reference with News Sources
              <span className="text-xs font-normal px-2 py-0.5 bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 rounded">
                Experimental
              </span>
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 max-w-2xl">
              Automated search for related news articles using AI semantic matching.
              Shows only high-confidence matches (≥70%). Not a substitute for manual fact-checking.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              {validation.total_articles_found} article{validation.total_articles_found !== 1 ? 's' : ''} analyzed
              {cached && ' • cached result'}
            </p>
          </div>
        </div>

        {/* Confidence Badge */}
        <div className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${
          overall_confidence >= 80 ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
          overall_confidence >= 60 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
          'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
        }`}>
          {Math.round(overall_confidence)}% confidence
        </div>
      </div>

      {/* Summary */}
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-4 leading-relaxed">
        {summary}
      </p>

      {/* Validation Type Badges */}
      <div className="flex flex-wrap gap-2 mb-4">
        {articles_by_type.confirms > 0 && (
          <ValidationBadge
            type="confirms"
            count={articles_by_type.confirms}
            icon="✓"
            color="green"
          />
        )}
        {articles_by_type.contradicts > 0 && (
          <ValidationBadge
            type="contradicts"
            count={articles_by_type.contradicts}
            icon="✗"
            color="red"
          />
        )}
        {articles_by_type.context > 0 && (
          <ValidationBadge
            type="context"
            count={articles_by_type.context}
            icon="📄"
            color="blue"
          />
        )}
        {articles_by_type.alternative > 0 && (
          <ValidationBadge
            type="alternative"
            count={articles_by_type.alternative}
            icon="🔄"
            color="purple"
          />
        )}
      </div>

      {/* Expand/Collapse Button */}
      {article_validations.length > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
        >
          {expanded ? '▼ Hide article details' : '▶ Show article details'}
        </button>
      )}

      {/* Article Details (Collapsible) */}
      {expanded && (
        <div className="mt-4 space-y-3">
          {article_validations.map((article) => (
            <ArticleCard key={article.article_id} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Validation Badge Component
 */
function ValidationBadge({ type, count, icon, color }: {
  type: string;
  count: number;
  icon: string;
  color: 'green' | 'red' | 'blue' | 'purple';
}) {
  const colorClasses = {
    green: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800',
    red: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800',
    purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800',
  };

  return (
    <div className={`px-3 py-1 rounded-full text-xs font-medium border ${colorClasses[color]}`}>
      <span className="mr-1">{icon}</span>
      {count} {type}
    </div>
  );
}

/**
 * Trust Level Badge Component
 * Displays source trust level with color coding (1-5 scale)
 */
function TrustLevelBadge({ level, category }: { level: number; category: string | null }) {
  // Trust level colors and labels
  const trustConfig = {
    5: { label: 'Highest', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400', dots: 5 },
    4: { label: 'High', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', dots: 4 },
    3: { label: 'Medium', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400', dots: 3 },
    2: { label: 'Low', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400', dots: 2 },
    1: { label: 'Minimal', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400', dots: 1 },
  };

  const categoryLabels: Record<string, string> = {
    ukraine: '🇺🇦',
    russia: '🇷🇺',
    neutral: '🌐',
    international: '🌍',
    social_media: '📱',
    aggregator: '📰',
  };

  const config = trustConfig[level as keyof typeof trustConfig] || trustConfig[3];
  const categoryEmoji = category ? categoryLabels[category] || '' : '';

  return (
    <div
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${config.color}`}
      title={`Trust: ${config.label} (${level}/5)${category ? ` • ${category}` : ''}`}
    >
      {categoryEmoji && <span>{categoryEmoji}</span>}
      <span className="flex gap-0.5">
        {[...Array(5)].map((_, i) => (
          <span key={i} className={i < config.dots ? 'opacity-100' : 'opacity-30'}>●</span>
        ))}
      </span>
    </div>
  );
}

/**
 * Article Card Component
 */
function ArticleCard({ article }: { article: ArticleValidationItem }) {
  const validationColors = {
    confirms: 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/10',
    contradicts: 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10',
    context: 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/10',
    alternative: 'border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/10',
    none: 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/10',
  };

  const validationIcons = {
    confirms: '✓',
    contradicts: '✗',
    context: '📄',
    alternative: '🔄',
    none: '—',
  };

  return (
    <div className={`p-3 rounded-lg border-l-4 ${validationColors[article.validation_type]}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1">
          <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-1">
            <span className="mr-2">{validationIcons[article.validation_type]}</span>
            {article.title}
          </h4>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {article.source_name} • {new Date(article.published_at).toLocaleDateString()}
            </p>
            <TrustLevelBadge
              level={article.source_trust_level || 3}
              category={article.source_category}
            />
          </div>
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-500 font-mono">
          {Math.round(article.confidence)}%
        </div>
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
        {article.relevance_explanation}
      </p>

      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
      >
        Read article →
      </a>
    </div>
  );
}
