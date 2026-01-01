'use client';

import React, { memo, useCallback } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { MessageCircle, ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';

export interface TelegramNodeData {
  id: number;
  content: string;
  channelName: string;
  channelFolder?: string;
  createdAt: string;
  similarityScore: number;
  selected?: boolean;
}

// Get country flag from folder name
function getCountryFlag(folder: string | undefined): string {
  if (!folder) return '';
  const folderUpper = folder.toUpperCase();
  if (folderUpper.includes('-UA')) return '🇺🇦';
  if (folderUpper.includes('-RU')) return '🇷🇺';
  return '';
}

function TelegramNodeComponent({ data, selected }: NodeProps<TelegramNodeData>) {
  const router = useRouter();

  const formattedTime = new Date(data.createdAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const flag = getCountryFlag(data.channelFolder);
  const similarityPercent = Math.round(data.similarityScore * 100);

  // Color based on similarity score
  const getSimilarityColor = (score: number) => {
    if (score >= 0.7) return 'text-green-400';
    if (score >= 0.5) return 'text-yellow-400';
    return 'text-orange-400';
  };

  // Navigate to message detail
  const handleViewMessage = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger node selection
    router.push(`/messages/${data.id}`);
  }, [router, data.id]);

  return (
    <div
      className={`
        w-72 bg-gray-800 rounded-lg shadow-md border-2 transition-all cursor-pointer
        ${selected || data.selected
          ? 'border-purple-500 shadow-lg shadow-purple-500/20'
          : 'border-gray-700 hover:border-purple-400'
        }
      `}
    >
      {/* Handle for incoming connections (from RSS nodes) */}
      <Handle
        type="target"
        position={Position.Left}
        className="w-3 h-3 !bg-purple-500 !border-2 !border-gray-800"
      />

      {/* Header with icon */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-start gap-2">
        <MessageCircle className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-100 line-clamp-2 leading-tight">
            {data.content}
          </p>
        </div>
      </div>

      {/* Footer with metadata */}
      <div className="px-3 py-2 bg-gray-900 rounded-b-lg flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-gray-400">
          <span className="font-medium">{formattedTime}</span>
          <span>•</span>
          {flag && <span>{flag}</span>}
          <span className="truncate max-w-[80px]">{data.channelName}</span>
        </div>

        <div className="flex items-center gap-2">
          <span className={`font-medium ${getSimilarityColor(data.similarityScore)}`}>
            {similarityPercent}%
          </span>
          <button
            onClick={handleViewMessage}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
            title="View full message"
          >
            <ExternalLink className="w-3.5 h-3.5 text-gray-400 hover:text-purple-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

export const TelegramNode = memo(TelegramNodeComponent);
