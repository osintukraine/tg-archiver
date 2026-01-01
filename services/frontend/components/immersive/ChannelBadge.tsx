'use client';

/**
 * ChannelBadge Component
 *
 * Displays channel name with flag, verification status, and timestamp
 * Used in immersive media mode top overlay
 */

import { format } from 'date-fns';

interface ChannelBadgeProps {
  channelName: string;
  channelFolder?: string;
  isVerified?: boolean;
  timestamp?: string;
}

// Helper to get country flag from folder
function getCountryFlag(folder: string | undefined): string | null {
  if (!folder) return null;

  const folderUpper = folder.toUpperCase();

  if (folderUpper.includes('-UA')) {
    return '🇺🇦';
  }

  if (folderUpper.includes('-RU')) {
    return '🇷🇺';
  }

  return null;
}

export function ChannelBadge({
  channelName,
  channelFolder,
  isVerified = false,
  timestamp,
}: ChannelBadgeProps) {
  const flag = getCountryFlag(channelFolder);

  return (
    <div
      className="flex items-center justify-between px-6 py-3 rounded-lg transition-all duration-300"
      style={{
        background: 'rgba(15, 20, 25, 0.85)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      {/* Left: Flag + Channel Name + Verified */}
      <div className="flex items-center gap-3">
        {flag && (
          <span className="text-2xl" title={`Source: ${channelFolder}`}>
            {flag}
          </span>
        )}
        <span className="text-white font-medium text-lg">
          {channelName}
        </span>
        {isVerified && (
          <span
            className="text-[#00d4ff] text-sm flex items-center gap-1"
            title="Verified channel"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            Verified
          </span>
        )}
      </div>

      {/* Right: Timestamp */}
      {timestamp && (
        <span className="text-gray-300 text-sm">
          {format(new Date(timestamp), 'h:mm a')}
        </span>
      )}
    </div>
  );
}
