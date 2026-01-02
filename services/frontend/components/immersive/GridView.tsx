'use client';

import { useImmersive } from '@/contexts/ImmersiveContext';
import { getMediaUrl } from '@/lib/api';
import { ImmersiveControls } from './ImmersiveControls';
import type { Message } from '@/lib/types';

// Helper to get country border class for hover effect
function getCountryBorderClass(folder: string | null | undefined): string {
  if (!folder) return 'country-border-unaffiliated';
  const folderUpper = folder.toUpperCase();
  if (folderUpper.includes('-UA')) return 'country-border-ua';
  if (folderUpper.includes('-RU')) return 'country-border-ru';
  return 'country-border-unaffiliated';
}

export function GridView() {
  const { queue, setCurrentIndex, setViewMode } = useImmersive();

  const handleSelect = (index: number) => {
    setCurrentIndex(index);
    setViewMode('stream');
  };

  return (
    <div className="fixed inset-0 bg-black overflow-auto">
      <ImmersiveControls />

      <div className="pt-20 pb-8 px-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {queue.map((message, index) => (
            <GridThumbnail
              key={message.id}
              message={message}
              onClick={() => handleSelect(index)}
            />
          ))}
        </div>

        {queue.length === 0 && (
          <div className="flex items-center justify-center h-64">
            <p className="text-white/60">No media in queue</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface GridThumbnailProps {
  message: Message;
  onClick: () => void;
}

function GridThumbnail({ message, onClick }: GridThumbnailProps) {
  const firstMedia = message.media_items?.[0];
  const thumbnailUrl = firstMedia ? getMediaUrl(firstMedia.url) : null;
  const isVideo = firstMedia?.media_type === 'video';
  const mediaCount = message.media_items?.length || 0;
  const countryFlag = getCountryFlag(message.channel?.folder);
  const countryBorderClass = getCountryBorderClass(message.channel?.folder);

  return (
    <button
      onClick={onClick}
      className={`relative aspect-square rounded-lg overflow-hidden bg-gray-900 group transition-all ${countryBorderClass}`}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt=""
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <span className="text-4xl">{isVideo ? '🎬' : '📷'}</span>
        </div>
      )}

      {/* Video indicator */}
      {isVideo && (
        <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/70 text-white text-xs">
          🎬
        </div>
      )}

      {/* Multi-media indicator */}
      {mediaCount > 1 && (
        <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-white text-xs">
          1/{mediaCount}
        </div>
      )}

      {/* Bottom info */}
      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center justify-between">
          <span className="text-sm">{countryFlag}</span>
        </div>
      </div>

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 20 20">
          <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
        </svg>
      </div>
    </button>
  );
}

function getCountryFlag(folder: string | null | undefined): string {
  if (!folder) return '📺';
  const upper = folder.toUpperCase();
  if (upper.includes('-UA')) return '🇺🇦';
  if (upper.includes('-RU')) return '🇷🇺';
  return '📺';
}
