'use client';

import React, { memo, useCallback } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { Newspaper, Link2, ExternalLink } from 'lucide-react';

/** Strip HTML tags to plain text */
function stripHtml(html: string | undefined): string {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim();
}

export interface RSSNodeData {
  id: number;
  title: string;
  summary?: string;
  source: string;
  publishedAt: string;
  url?: string;
  correlationCount: number;
  selected?: boolean;
}

function RSSNodeComponent({ data, selected }: NodeProps<RSSNodeData>) {
  const formattedTime = new Date(data.publishedAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  // Open article in new tab
  const handleOpenArticle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (data.url) {
      window.open(data.url, '_blank', 'noopener,noreferrer');
    }
  }, [data.url]);

  return (
    <div
      className={`
        w-80 bg-gray-800 rounded-lg shadow-md border-2 transition-all cursor-pointer
        ${selected || data.selected
          ? 'border-blue-500 shadow-lg shadow-blue-500/20'
          : 'border-gray-700 hover:border-blue-400'
        }
      `}
    >
      {/* Header with icon */}
      <div className="px-3 py-2 border-b border-gray-700 flex items-start gap-2">
        <Newspaper className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-gray-100 line-clamp-2 leading-tight">
            {data.title}
          </h3>
        </div>
      </div>

      {/* Summary */}
      {data.summary && (
        <div className="px-3 py-2">
          <p className="text-xs text-gray-400 line-clamp-2">
            {stripHtml(data.summary)}
          </p>
        </div>
      )}

      {/* Footer with metadata */}
      <div className="px-3 py-2 bg-gray-900 rounded-b-lg flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 text-gray-400">
          <span className="font-medium">{formattedTime}</span>
          <span>•</span>
          <span className="truncate max-w-[100px]">{data.source}</span>
        </div>

        <div className="flex items-center gap-2">
          {data.correlationCount > 0 && (
            <div className="flex items-center gap-1 text-blue-400 font-medium">
              <Link2 className="w-3 h-3" />
              <span>{data.correlationCount}</span>
            </div>
          )}
          {data.url && (
            <button
              onClick={handleOpenArticle}
              className="p-1 hover:bg-gray-700 rounded transition-colors"
              title="Open article"
            >
              <ExternalLink className="w-3.5 h-3.5 text-gray-400 hover:text-blue-400" />
            </button>
          )}
        </div>
      </div>

      {/* Handle for outgoing connections (to Telegram nodes) */}
      {data.correlationCount > 0 && (
        <Handle
          type="source"
          position={Position.Right}
          className="w-3 h-3 !bg-blue-500 !border-2 !border-gray-800"
        />
      )}
    </div>
  );
}

export const RSSNode = memo(RSSNodeComponent);
