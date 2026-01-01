'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import Link from 'next/link';
import type { Message } from '@/lib/types';

// Helper to get country border class for hover effect
function getCountryBorderClass(folder: string | null | undefined): string {
  if (!folder) return 'country-border-unaffiliated';
  const folderUpper = folder.toUpperCase();
  if (folderUpper.includes('-UA')) return 'country-border-ua';
  if (folderUpper.includes('-RU')) return 'country-border-ru';
  return 'country-border-unaffiliated';
}

interface GlassPanelProps {
  message: Message;
}

export function GlassPanel({ message }: GlassPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  const channelName = message.channel?.name || `Channel ${message.channel_id}`;
  const countryFlag = getCountryFlag(message.channel?.folder);
  const countryBorderClass = getCountryBorderClass(message.channel?.folder);
  const timestamp = message.telegram_date
    ? format(new Date(message.telegram_date), 'MMM d, HH:mm')
    : '';

  const content = message.content_translated || message.content || '';
  const previewContent = content.length > 120 ? content.slice(0, 120) + '...' : content;

  // Counts
  const mediaCount = message.media_items?.length || 0;
  const hasViews = message.views && message.views > 0;
  const hasForwards = message.forwards && message.forwards > 0;

  // Minimized state: show only a small restore button
  if (isMinimized) {
    return (
      <div className="absolute bottom-4 left-4 z-40">
        <button
          onClick={() => setIsMinimized(false)}
          className={`flex items-center gap-2 px-3 py-2 rounded-full bg-black/70 backdrop-blur-sm text-white hover:bg-black/90 transition-colors ${countryBorderClass}`}
          title="Show info panel"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-medium">{countryFlag} Info</span>
        </button>
      </div>
    );
  }

  return (
    <div className="absolute bottom-0 left-0 right-0 z-40 p-4">
      {/* Outer wrapper for country border (no overflow-hidden so pseudo-element isn't clipped) */}
      <div className={`rounded-xl transition-all duration-300 ${countryBorderClass}`}>
        {/* Inner container with overflow handling and glass effect */}
        <div
          className={`rounded-xl overflow-hidden transition-all duration-300 ${
            isExpanded ? 'max-h-[70vh] overflow-y-auto' : 'max-h-40'
          }`}
          style={{
            background: 'rgba(15, 20, 25, 0.9)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
        >
        <div className="p-4 space-y-3">
          {/* Header: Channel + Time + Quick badges + Minimize */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg flex-shrink-0">{countryFlag}</span>
              <span className="text-white font-medium truncate">{channelName}</span>
              {message.channel?.username && (
                <span className="text-gray-500 text-sm">@{message.channel.username}</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Importance badge */}
              {message.importance_level && (
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  message.importance_level === 'high' ? 'bg-red-500/30 text-red-400' :
                  message.importance_level === 'medium' ? 'bg-yellow-500/30 text-yellow-400' :
                  'bg-gray-500/30 text-gray-400'
                }`}>
                  {message.importance_level.toUpperCase()}
                </span>
              )}
              <span className="text-gray-400 text-sm">{timestamp}</span>
              {/* Minimize button */}
              <button
                onClick={() => setIsMinimized(true)}
                className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                title="Minimize panel"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Quick stats row */}
          <div className="flex items-center gap-4 text-sm text-gray-400">
            {mediaCount > 0 && (
              <span className="flex items-center gap-1">
                📷 {mediaCount} media
              </span>
            )}
            {hasViews && (
              <span className="flex items-center gap-1">
                👁 {formatNumber(message.views!)}
              </span>
            )}
            {hasForwards && (
              <span className="flex items-center gap-1">
                🔄 {formatNumber(message.forwards!)}
              </span>
            )}
          </div>

          {/* Content preview or full */}
          <p className="text-white/90 text-sm leading-relaxed">
            {isExpanded ? content : previewContent}
          </p>

          {/* Expand/collapse button */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-cyan-400 text-sm hover:underline flex items-center gap-1"
          >
            {isExpanded ? 'Show less' : 'Tap for details'}
            <svg
              className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Expanded: Detailed analyst view */}
          {isExpanded && (
            <div className="pt-3 border-t border-white/10 space-y-4">

              {/* AI Analysis section */}
              {(message.osint_topic || message.content_sentiment || message.content_urgency_level) && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    AI Analysis
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {message.osint_topic && (
                      <span className="px-2 py-1 rounded text-xs bg-purple-500/20 text-purple-300">
                        📊 {message.osint_topic}
                      </span>
                    )}
                    {message.content_sentiment && (
                      <span className="px-2 py-1 rounded text-xs bg-white/10 text-white/80">
                        {getSentimentEmoji(message.content_sentiment)} {message.content_sentiment}
                      </span>
                    )}
                    {message.content_urgency_level !== null && message.content_urgency_level > 30 && (
                      <span className="px-2 py-1 rounded text-xs bg-orange-500/20 text-orange-400">
                        ⚡ Urgency {message.content_urgency_level}%
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Location */}
              {message.location && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Location
                  </h4>
                  <div className="flex items-center gap-2 text-cyan-400 text-sm">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                    </svg>
                    <span>{message.location.location_name}</span>
                    {message.location.confidence !== null && (
                      <span className="text-gray-500 text-xs">
                        {Math.round(message.location.confidence * 100)}% confidence
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* OpenSanctions Entities */}
              {message.opensanctions_entities && message.opensanctions_entities.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                    <span>⚠️</span> OpenSanctions Watchlist
                  </h4>
                  <div className="space-y-2">
                    {message.opensanctions_entities.slice(0, 3).map((entity, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between px-2 py-1.5 rounded bg-red-500/10 border border-red-500/20"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-red-300">{entity.name}</span>
                          <span className="text-xs text-red-400/60">{entity.schema_type}</span>
                        </div>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          entity.risk_classification === 'sanctioned' ? 'bg-red-600/30 text-red-300' :
                          entity.risk_classification === 'pep' ? 'bg-yellow-600/30 text-yellow-300' :
                          'bg-gray-600/30 text-gray-300'
                        }`}>
                          {entity.risk_classification}
                        </span>
                      </div>
                    ))}
                    {message.opensanctions_entities.length > 3 && (
                      <p className="text-xs text-gray-500">
                        +{message.opensanctions_entities.length - 3} more entities
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Forward source */}
              {message.forward_from_channel_id && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Forwarded From
                  </h4>
                  <div className="flex items-center gap-2 text-gray-400 text-sm">
                    <span>↩️</span>
                    <span>Channel ID: {message.forward_from_channel_id}</span>
                  </div>
                </div>
              )}

              {/* Key phrases */}
              {message.key_phrases && message.key_phrases.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Key Phrases
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {message.key_phrases.slice(0, 5).map((phrase, idx) => (
                      <span key={idx} className="px-2 py-0.5 rounded text-xs bg-white/5 text-white/60">
                        {phrase}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* View full message link */}
              <div className="pt-2">
                <Link
                  href={`/messages/${message.id}`}
                  target="_blank"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-colors text-sm font-medium"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View Full Message (with tabs)
                </Link>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

function getCountryFlag(folder: string | null | undefined): string {
  if (!folder) return '📺';
  const upper = folder.toUpperCase();
  if (upper.includes('-UA') || upper.includes('UKRAINE')) return '🇺🇦';
  if (upper.includes('-RU') || upper.includes('RUSSIA')) return '🇷🇺';
  return '📺';
}

function getSentimentEmoji(sentiment: string): string {
  switch (sentiment) {
    case 'positive': return '😊';
    case 'negative': return '😡';
    case 'urgent': return '⚠️';
    default: return '😐';
  }
}

function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}
