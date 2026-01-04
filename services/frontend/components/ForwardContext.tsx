"use client";

import { useState, useEffect } from "react";
import { ExternalLink, Users, Eye, Share2, MessageCircle, Clock } from "lucide-react";

interface ForwardContextData {
  has_forward_context: boolean;
  source?: {
    name: string;
    username: string | null;
    subscribers: number | null;
    verified: boolean;
    telegram_id: number;
    join_status: string;
  };
  original?: {
    message_id: number;
    content: string | null;
    views: number | null;
    forwards: number | null;
    comments_count: number | null;
    date: string | null;
    has_media: boolean;
  };
  propagation_seconds: number | null;
  reactions: Array<{ emoji: string; count: number }>;
  reactions_total: number;
  comments: Array<{ author: string; content: string; date: string | null }>;
  comments_fetched: number;
}

interface ForwardContextProps {
  messageId: number;
  hasForward: boolean;
}

export function ForwardContext({ messageId, hasForward }: ForwardContextProps) {
  const [data, setData] = useState<ForwardContextData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!hasForward) return;

    const fetchContext = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/messages/${messageId}/forward-context`);
        const json = await res.json();
        setData(json);
      } catch (e) {
        console.error("Failed to fetch forward context:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchContext();
  }, [messageId, hasForward]);

  if (!hasForward || loading || !data?.has_forward_context) {
    return null;
  }

  const formatPropagation = (seconds: number | null) => {
    if (!seconds) return "Unknown";
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  return (
    <div className="mt-3 border border-blue-500/30 rounded-lg bg-blue-500/5 overflow-hidden">
      {/* Header - Always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-blue-500/10 transition-colors"
      >
        <div className="flex items-center gap-2 text-blue-400 text-sm">
          <Share2 className="w-4 h-4" />
          <span className="font-medium">Forward from {data.source?.name}</span>
          {data.source?.username && (
            <span className="text-blue-300/60">@{data.source.username}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-text-tertiary">
          {data.original?.views && (
            <span className="flex items-center gap-1">
              <Eye className="w-3 h-3" />
              {data.original.views.toLocaleString()}
            </span>
          )}
          {data.reactions_total > 0 && (
            <span>{data.reactions_total} reactions</span>
          )}
          <span className="text-blue-400">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-blue-500/20">
          {/* Source channel info */}
          <div className="pt-3 flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Users className="w-4 h-4" />
              <span>{data.source?.subscribers?.toLocaleString() || "?"} subscribers</span>
            </div>
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Clock className="w-4 h-4" />
              <span>Propagated in {formatPropagation(data.propagation_seconds)}</span>
            </div>
            {data.source?.username && (
              <a
                href={`https://t.me/${data.source.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-400 hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                View channel
              </a>
            )}
          </div>

          {/* Original stats */}
          <div className="grid grid-cols-4 gap-2">
            <div className="bg-background-tertiary rounded p-2 text-center">
              <div className="text-lg font-bold text-text-primary">
                {data.original?.views?.toLocaleString() || "—"}
              </div>
              <div className="text-xs text-text-tertiary">Views</div>
            </div>
            <div className="bg-background-tertiary rounded p-2 text-center">
              <div className="text-lg font-bold text-text-primary">
                {data.original?.forwards?.toLocaleString() || "—"}
              </div>
              <div className="text-xs text-text-tertiary">Forwards</div>
            </div>
            <div className="bg-background-tertiary rounded p-2 text-center">
              <div className="text-lg font-bold text-text-primary">
                {data.reactions_total.toLocaleString()}
              </div>
              <div className="text-xs text-text-tertiary">Reactions</div>
            </div>
            <div className="bg-background-tertiary rounded p-2 text-center">
              <div className="text-lg font-bold text-text-primary">
                {data.original?.comments_count?.toLocaleString() || "—"}
              </div>
              <div className="text-xs text-text-tertiary">Comments</div>
            </div>
          </div>

          {/* Reactions */}
          {data.reactions.length > 0 && (
            <div>
              <div className="text-xs text-text-tertiary mb-1.5">Reactions from original</div>
              <div className="flex flex-wrap gap-1.5">
                {data.reactions.slice(0, 8).map((r, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 bg-background-tertiary px-2 py-0.5 rounded text-sm"
                  >
                    <span>{r.emoji}</span>
                    <span className="text-text-secondary">{r.count}</span>
                  </span>
                ))}
                {data.reactions.length > 8 && (
                  <span className="text-xs text-text-tertiary self-center">
                    +{data.reactions.length - 8} more
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Sample comments */}
          {data.comments.length > 0 && (
            <div>
              <div className="text-xs text-text-tertiary mb-1.5 flex items-center gap-1">
                <MessageCircle className="w-3 h-3" />
                Comments from original ({data.original?.comments_count || data.comments_fetched})
              </div>
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {data.comments.slice(0, 5).map((c, i) => (
                  <div key={i} className="text-sm bg-background-tertiary rounded px-2 py-1.5">
                    <span className="text-text-tertiary">{c.author}: </span>
                    <span className="text-text-secondary">{c.content?.slice(0, 150)}{(c.content?.length || 0) > 150 ? "..." : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
