'use client';

import { useEffect, useState } from 'react';
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

export interface MapMessageProperties {
  message_id: number;
  content?: string;
  content_translated?: string;
  telegram_date?: string;
  channel_name?: string;
  channel_username?: string;
  channel_affiliation?: string;
  location_name?: string;
  location_hierarchy?: string;
  confidence?: number;
  extraction_method?: string;
  precision_level?: string;
  population?: number;
  media_count?: number;
  first_media_url?: string;
  first_media_type?: string;
}

interface MapHoverCardProps {
  properties: MapMessageProperties;
  onExpand?: () => void;
}

export default function MapHoverCard({ properties, onExpand }: MapHoverCardProps) {
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
    channel_name,
    channel_affiliation,
    telegram_date,
    location_name,
    location_hierarchy,
    confidence,
    precision_level,
    content,
    content_translated,
    first_media_url,
  } = properties;

  // Choose content based on translation mode
  const displayContent = translationMode === 'translation' && content_translated
    ? content_translated
    : content;

  // Flag based on affiliation (supports both short and full names)
  const normalized = channel_affiliation?.toLowerCase();
  const flag = (normalized === 'ua' || normalized === 'ukraine') ? '🇺🇦' :
    (normalized === 'ru' || normalized === 'russia') ? '🇷🇺' : '🏳️';

  // Confidence badge color
  const confidenceColor = confidence && confidence >= 0.9 ? 'text-green-600' :
    confidence && confidence >= 0.75 ? 'text-yellow-600' : 'text-red-500';

  const confidenceLabel = precision_level === 'high' ? 'High confidence' :
    precision_level === 'medium' ? 'Medium confidence' : 'Low confidence';

  // Format time
  const timeStr = telegram_date
    ? new Date(telegram_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  // Border color based on confidence
  const borderColor = precision_level === 'high' ? 'border-green-400' :
    precision_level === 'medium' ? 'border-yellow-400' : 'border-red-400';

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg w-64 border-l-4 ${borderColor}`}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{flag}</span>
          <span className="font-medium text-gray-800 dark:text-gray-200 truncate max-w-[140px]">
            {escapeHtml(channel_name || 'Unknown')}
          </span>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">{timeStr}</span>
      </div>

      {/* Location */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300">
          <span>📍</span>
          <span>{escapeHtml(location_name || 'Unknown')}</span>
          {location_hierarchy && (
            <span className="text-gray-500 dark:text-gray-400">, {escapeHtml(location_hierarchy)}</span>
          )}
        </div>
        <div className={`text-xs ${confidenceColor} flex items-center gap-1 mt-1`}>
          <span>●</span>
          <span>{confidenceLabel}</span>
        </div>
      </div>

      {/* Content preview */}
      <div className="px-3 py-2 flex gap-2">
        {first_media_url && (
          <div className="w-14 h-14 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden flex-shrink-0">
            <img
              src={getMediaUrl(first_media_url) || ''}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>
        )}
        <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-3">
          {displayContent ? escapeHtml(displayContent.substring(0, 100)) : 'No content'}
          {displayContent && displayContent.length > 100 && '...'}
        </p>
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
        <button
          onClick={onExpand}
          className="w-full text-center text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          Click to expand
        </button>
      </div>
    </div>
  );
}
