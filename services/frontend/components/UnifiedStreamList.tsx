'use client';

import { useState, useEffect } from 'react';
import { UnifiedItem } from '@/lib/api-unified';
import { formatDistanceToNow } from 'date-fns';
import { FileText, MessageCircle, Globe, AlertTriangle } from 'lucide-react';

interface UnifiedStreamListProps {
  items: UnifiedItem[];
}

export function UnifiedStreamList({ items }: UnifiedStreamListProps) {
  const [showTranslation, setShowTranslation] = useState(false);

  // Listen to translation preference changes
  useEffect(() => {
    // Load initial preference from localStorage (client-side only)
    if (typeof window !== 'undefined') {
      const translationMode = localStorage.getItem('translationMode');
      setShowTranslation(translationMode === 'translation');

      // Listen for changes from HeaderNav toggle
      const handleModeChange = (event: CustomEvent<string>) => {
        setShowTranslation(event.detail === 'translation');
      };

      window.addEventListener('translationModeChange', handleModeChange as EventListener);
      return () => {
        window.removeEventListener('translationModeChange', handleModeChange as EventListener);
      };
    }
  }, []);

  const getTrustLevelColor = (level?: number) => {
    if (!level) return 'text-gray-400';
    if (level >= 4) return 'text-green-500';
    if (level >= 3) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getSourceIcon = (type: 'telegram' | 'rss') => {
    return type === 'telegram' ? (
      <MessageCircle className="w-4 h-4" />
    ) : (
      <FileText className="w-4 h-4" />
    );
  };

  const truncateContent = (content: string, maxLength: number = 200) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  };

  // Helper to get importance level badge color
  const getImportanceLevelColor = (level?: 'high' | 'medium' | 'low' | null) => {
    if (!level) return 'bg-gray-700 text-gray-400';
    switch (level) {
      case 'high':
        return 'bg-green-900 text-green-300';
      case 'medium':
        return 'bg-yellow-900 text-yellow-300';
      case 'low':
        return 'bg-gray-700 text-gray-400';
      default:
        return 'bg-gray-700 text-gray-400';
    }
  };

  // Helper to get the right content based on translation preference
  const getDisplayContent = (item: UnifiedItem): string => {
    if (item.type === 'rss') {
      return item.title; // RSS articles always show title
    }

    // For Telegram messages, respect translation preference
    if (showTranslation && item.content_translated) {
      return item.content_translated;
    }

    return item.content || item.title;
  };

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <div
          key={`${item.type}-${item.id}`}
          className="bg-surface border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
        >
          {/* Header */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              {/* Source Type Icon */}
              <span className={`${item.type === 'telegram' ? 'text-blue-400' : 'text-orange-400'}`}>
                {getSourceIcon(item.type)}
              </span>

              {/* Source Name */}
              <span className="font-medium text-sm">
                {item.source_name}
              </span>

              {/* Category Badge */}
              {item.source_category && (
                <span className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-300">
                  {item.source_category}
                </span>
              )}

              {/* Trust Level (for RSS) */}
              {item.type === 'rss' && item.source_trust_level && (
                <span className={`text-xs ${getTrustLevelColor(item.source_trust_level)}`}>
                  Trust: {item.source_trust_level}/5
                </span>
              )}

              {/* Importance Level Badge */}
              {item.importance_level && (
                <span className={`px-2 py-0.5 text-xs rounded ${getImportanceLevelColor(item.importance_level)}`}>
                  {item.importance_level === 'high' ? 'High' : item.importance_level === 'medium' ? 'Medium' : 'Low'}
                </span>
              )}
            </div>

            {/* Timestamp */}
            <span className="text-xs text-gray-400">
              {formatDistanceToNow(new Date(item.published_at), { addSuffix: true })}
            </span>
          </div>

          {/* Title (for RSS) or Content Preview */}
          {item.type === 'rss' ? (
            <h3 className="font-semibold text-base mb-2 text-white">
              {item.title}
            </h3>
          ) : (
            <div className="text-sm text-gray-300 mb-2">
              {/* Respect translation preference for Telegram messages */}
              {truncateContent(getDisplayContent(item))}
            </div>
          )}

          {/* Content (for RSS articles with content) */}
          {item.type === 'rss' && item.content && (
            <p className="text-sm text-gray-400 mb-2">
              {truncateContent(item.content, 150)}
            </p>
          )}

          {/* Tags */}
          {item.tags && item.tags.length > 0 && (
            <div className="flex gap-1 flex-wrap mb-2">
              {item.tags.map(tag => (
                <span key={tag} className="px-2 py-0.5 text-xs bg-gray-800 rounded">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between mt-3">
            <div className="flex gap-3">
              {/* View Link */}
              {item.type === 'rss' && item.url.startsWith('http') ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  <Globe className="w-3 h-3" />
                  View Article
                </a>
              ) : (
                <a
                  href={`/messages/${item.id}`}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  View Details →
                </a>
              )}
            </div>

            {/* Correlation Count */}
            {item.correlation_count !== undefined && item.correlation_count > 0 && (
              <span className="text-xs text-gray-400">
                {item.correlation_count} related
              </span>
            )}
          </div>
        </div>
      ))}

      {items.length === 0 && (
        <div className="text-center py-8 text-gray-400">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
          <p>No items found in the unified stream</p>
        </div>
      )}
    </div>
  );
}
