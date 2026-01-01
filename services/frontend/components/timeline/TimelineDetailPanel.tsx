'use client';

import React from 'react';
import Link from 'next/link';
import { ExternalLink, Newspaper, MessageCircle, Link2, X } from 'lucide-react';
import type { TimelineRSSArticle, TimelineCorrelation } from '@/lib/timeline-utils';

/**
 * Strip HTML tags and convert to readable plain text.
 * Preserves paragraph breaks and basic formatting.
 */
function stripHtmlToText(html: string): string {
  if (!html) return '';

  return html
    // Replace </p> and <br> with newlines for paragraph breaks
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Remove all other HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    // Clean up excessive whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface TimelineDetailPanelProps {
  selectedNode: {
    type: 'rss' | 'telegram';
    data: TimelineRSSArticle | TimelineCorrelation['message'];
    article?: TimelineRSSArticle; // Parent article for telegram nodes
    similarityScore?: number;
  } | null;
  onClose: () => void;
}

export function TimelineDetailPanel({ selectedNode, onClose }: TimelineDetailPanelProps) {
  if (!selectedNode) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 p-6">
        <div className="text-center">
          <Newspaper className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Select an item from the timeline to view details</p>
        </div>
      </div>
    );
  }

  if (selectedNode.type === 'rss') {
    const article = selectedNode.data as TimelineRSSArticle;
    return <RSSDetailView article={article} onClose={onClose} />;
  }

  const message = selectedNode.data as TimelineCorrelation['message'];
  return (
    <TelegramDetailView
      message={message}
      article={selectedNode.article}
      similarityScore={selectedNode.similarityScore}
      onClose={onClose}
    />
  );
}

function RSSDetailView({
  article,
  onClose,
}: {
  article: TimelineRSSArticle;
  onClose: () => void;
}) {
  const correlations = article.correlations || [];

  return (
    <div className="h-full overflow-y-auto bg-gray-800">
      {/* Header */}
      <div className="sticky top-0 bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Newspaper className="w-5 h-5 text-blue-400" />
          <span className="text-sm font-medium text-blue-400">
            RSS Article
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Title */}
        <h2 className="text-lg font-semibold text-white leading-tight">
          {article.title}
        </h2>

        {/* Metadata */}
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <span>{article.source_name}</span>
          <span>•</span>
          <span>
            {new Date(article.published_at).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>

        {/* Content/Summary - strip HTML for safe display */}
        {(article.content || article.summary) && (
          <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
            {stripHtmlToText(article.content || article.summary || '')}
          </div>
        )}

        {/* External link */}
        {article.url && (
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 hover:underline"
          >
            <ExternalLink className="w-4 h-4" />
            Read full article
          </a>
        )}

        {/* Correlated messages */}
        {correlations.length > 0 && (
          <div className="mt-6 pt-4 border-t border-gray-700">
            <h3 className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-3">
              <Link2 className="w-4 h-4" />
              {correlations.length} Correlated Telegram Message{correlations.length !== 1 ? 's' : ''}
            </h3>

            <div className="space-y-3">
              {correlations.map((corr) => (
                <CorrelatedMessageCard key={corr.message_id} correlation={corr} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TelegramDetailView({
  message,
  article,
  similarityScore,
  onClose,
}: {
  message: TimelineCorrelation['message'];
  article?: TimelineRSSArticle;
  similarityScore?: number;
  onClose: () => void;
}) {
  // Get country flag
  const getCountryFlag = (folder?: string) => {
    if (!folder) return '';
    const folderUpper = folder.toUpperCase();
    if (folderUpper.includes('-UA')) return '🇺🇦';
    if (folderUpper.includes('-RU')) return '🇷🇺';
    return '';
  };

  const flag = getCountryFlag(message.channel_folder);

  return (
    <div className="h-full overflow-y-auto bg-gray-800">
      {/* Header */}
      <div className="sticky top-0 bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-purple-400" />
          <span className="text-sm font-medium text-purple-400">
            Telegram Message
          </span>
          {similarityScore && (
            <span className="text-xs px-2 py-0.5 bg-purple-900 text-purple-300 rounded-full">
              {Math.round(similarityScore * 100)}% match
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-200"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Channel info */}
        <div className="flex items-center gap-2 text-sm">
          {flag && <span className="text-lg">{flag}</span>}
          <span className="font-medium text-white">
            {message.channel_name}
          </span>
          <span className="text-gray-500">•</span>
          <span className="text-gray-400" title="Original posting date">
            {new Date(message.telegram_date || message.created_at).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>

        {/* Message content */}
        <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
          {message.content_translated || message.content}
        </div>

        {/* Original text if translated */}
        {message.content_translated && message.content_translated !== message.content && (
          <details className="text-xs text-gray-400">
            <summary className="cursor-pointer hover:text-gray-300">
              Show original
            </summary>
            <div className="mt-2 p-2 bg-gray-900 rounded whitespace-pre-wrap">
              {message.content}
            </div>
          </details>
        )}

        {/* View full message link */}
        <Link
          href={`/messages/${message.id}`}
          className="inline-flex items-center gap-2 text-sm text-purple-400 hover:text-purple-300 hover:underline"
        >
          <ExternalLink className="w-4 h-4" />
          View full message
        </Link>

        {/* Related article */}
        {article && (
          <div className="mt-6 pt-4 border-t border-gray-700">
            <h3 className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-3">
              <Newspaper className="w-4 h-4" />
              Related Article
            </h3>

            <div className="p-3 bg-blue-950 rounded-lg border border-blue-800">
              <h4 className="text-sm font-medium text-blue-100 line-clamp-2">
                {article.title}
              </h4>
              <div className="mt-1 text-xs text-blue-300">
                {article.source_name} •{' '}
                {new Date(article.published_at).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CorrelatedMessageCard({ correlation }: { correlation: TimelineCorrelation }) {
  const { message, similarity_score } = correlation;

  const getCountryFlag = (folder?: string) => {
    if (!folder) return '';
    const folderUpper = folder.toUpperCase();
    if (folderUpper.includes('-UA')) return '🇺🇦';
    if (folderUpper.includes('-RU')) return '🇷🇺';
    return '';
  };

  const flag = getCountryFlag(message.channel_folder);
  const similarityPercent = Math.round(similarity_score * 100);

  return (
    <Link
      href={`/messages/${message.id}`}
      className="block p-3 bg-purple-950 rounded-lg border border-purple-800 hover:border-purple-600 transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs text-purple-300">
          {flag && <span>{flag}</span>}
          <span className="font-medium">{message.channel_name}</span>
        </div>
        <span className="text-xs font-medium text-purple-400">
          {similarityPercent}%
        </span>
      </div>
      <p className="text-sm text-purple-100 line-clamp-3">
        {message.content_translated || message.content}
      </p>
      <div className="mt-2 flex items-center justify-between text-xs text-purple-400">
        <span title="Original posting time">
          {new Date(message.telegram_date || message.created_at).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <span className="flex items-center gap-1 hover:text-purple-300">
          View message <ExternalLink className="w-3 h-3" />
        </span>
      </div>
    </Link>
  );
}
