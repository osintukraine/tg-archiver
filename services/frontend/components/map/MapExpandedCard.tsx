'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { MapMessageProperties } from './MapHoverCard';
import { getMediaUrl } from '@/lib/api';

// HTML escape utility
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

interface MapExpandedCardProps {
  properties: MapMessageProperties;
  onClose?: () => void;
  embedded?: boolean; // When true, adapts styling for sidebar
}

export default function MapExpandedCard({ properties, onClose, embedded = false }: MapExpandedCardProps) {
  const [translationMode, setTranslationMode] = useState<'original' | 'translation'>('original');

  // Listen for translation mode changes
  useEffect(() => {
    const savedMode = localStorage.getItem('translationMode');
    if (savedMode === 'translation' || savedMode === 'original') {
      setTranslationMode(savedMode);
    }

    const handleChange = (e: CustomEvent<string>) => {
      if (e.detail === 'translation' || e.detail === 'original') {
        setTranslationMode(e.detail);
      }
    };

    window.addEventListener('translationModeChange', handleChange as EventListener);
    return () => window.removeEventListener('translationModeChange', handleChange as EventListener);
  }, []);

  const {
    message_id,
    channel_name,
    channel_username,
    channel_affiliation,
    telegram_date,
    location_name,
    location_hierarchy,
    confidence,
    extraction_method,
    precision_level,
    population,
    content,
    content_translated,
    first_media_url,
    first_media_type,
    media_count,
  } = properties;

  // Choose content based on translation mode
  const displayContent = translationMode === 'translation' && content_translated
    ? content_translated
    : content;

  // Flag based on affiliation
  const flag = channel_affiliation === 'ua' ? '🇺🇦' : channel_affiliation === 'ru' ? '🇷🇺' : '🏳️';

  // Confidence info
  const confidenceColor = precision_level === 'high' ? 'text-green-600' :
    precision_level === 'medium' ? 'text-yellow-600' : 'text-red-500';

  const confidenceLabel = precision_level === 'high' ? 'High confidence' :
    precision_level === 'medium' ? 'Medium confidence' : 'Low confidence';

  const methodLabel = extraction_method === 'gazetteer' ? 'Gazetteer match' :
    extraction_method === 'nominatim' ? 'OSM lookup' :
    extraction_method === 'llm_relative' ? 'LLM relative' : extraction_method;

  // Format date
  const dateStr = telegram_date
    ? new Date(telegram_date).toLocaleString()
    : 'Unknown date';

  // Border color based on confidence
  const borderColor = precision_level === 'high' ? 'border-green-400' :
    precision_level === 'medium' ? 'border-yellow-400' : 'border-red-400';

  // Conditional styles for embedded vs floating mode
  const containerClass = embedded
    ? `bg-bg-secondary rounded-lg border-l-4 ${borderColor} overflow-hidden flex flex-col`
    : `bg-white dark:bg-gray-800 rounded-lg shadow-xl w-80 border-l-4 ${borderColor} max-h-[500px] overflow-hidden flex flex-col`;

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">{flag}</span>
            <span className="font-semibold text-text-primary">
              {escapeHtml(channel_name || 'Unknown')}
            </span>
          </div>
          {channel_username && (
            <div className="text-xs text-text-tertiary">
              @{escapeHtml(channel_username)}
            </div>
          )}
        </div>
        {!embedded && onClose && (
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary text-xl"
          >
            ✕
          </button>
        )}
      </div>

      {/* Location details */}
      <div className="px-4 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-1 text-sm text-text-primary">
          <span>📍</span>
          <span className="font-medium">{escapeHtml(location_name || 'Unknown')}</span>
          {location_hierarchy && (
            <span className="text-gray-500 dark:text-gray-400">, {escapeHtml(location_hierarchy)}</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 text-xs">
          <span className={`${confidenceColor} flex items-center gap-1`}>
            <span>●</span>
            <span>{confidenceLabel}</span>
          </span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-500 dark:text-gray-400">{methodLabel}</span>
        </div>
        {population && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Population: {population.toLocaleString()}
          </div>
        )}
      </div>

      {/* Media */}
      {first_media_url && (
        <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="bg-gray-100 dark:bg-gray-700 rounded overflow-hidden">
            {first_media_type === 'video' ? (
              <div className="w-full h-40 flex items-center justify-center bg-gray-200 dark:bg-gray-600">
                <span className="text-4xl">🎬</span>
              </div>
            ) : (
              <img
                src={getMediaUrl(first_media_url) || ''}
                alt=""
                className="w-full max-h-48 object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = '/placeholder-image.png';
                }}
              />
            )}
          </div>
          {media_count && media_count > 1 && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
              1 of {media_count} media items
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="px-4 py-3 flex-1 overflow-y-auto">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{dateStr}</div>
        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap max-h-[200px] overflow-y-auto">
          {displayContent ? escapeHtml(displayContent) : 'No content available'}
        </p>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex gap-2 flex-shrink-0">
        <Link
          href={`/messages/${message_id}`}
          target="_blank"
          className="flex-1 text-center py-2 px-3 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
        >
          View Full Message →
        </Link>
      </div>
    </div>
  );
}
