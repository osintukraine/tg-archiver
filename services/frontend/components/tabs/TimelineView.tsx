'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Clock, ChevronDown, Loader2 } from 'lucide-react';
import { useTimelineContext } from '@/hooks/useTimelineContext';
import type { Message } from '@/lib/types';

interface TimelineViewProps {
  message: Message;
}

export function TimelineView({ message }: TimelineViewProps) {
  const { data, isLoading, error } = useTimelineContext(message.id, {
    beforeCount: 5,
    afterCount: 5,
    sameChannelOnly: false
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Loading temporal context...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-destructive">Failed to load timeline</p>
        <p className="text-xs text-muted-foreground mt-1">{error.message}</p>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Clock className="h-4 w-4" />
        <h3 className="text-sm font-medium">Temporal Context</h3>
      </div>

      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200" />

        <div className="space-y-4">
          {/* Before messages */}
          {data.before.map((msg, idx) => (
            <TimelineMessage
              key={msg.id}
              message={msg}
              position="before"
              isFirst={idx === 0}
            />
          ))}

          {/* Current message */}
          <div className="relative pl-12">
            <div className="absolute left-2 top-2 w-4 h-4 rounded-full bg-primary border-4 border-background ring-2 ring-primary/20" />
            <Card className="border-primary shadow-md">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium text-primary">CURRENT MESSAGE</span>
                  <ChevronDown className="h-3 w-3 text-primary" />
                </div>
                <p className="text-sm line-clamp-2">
                  {data.center_message.content}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(data.center_message.created_at).toLocaleString()}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* After messages */}
          {data.after.map((msg, idx) => (
            <TimelineMessage
              key={msg.id}
              message={msg}
              position="after"
              isLast={idx === data.after.length - 1}
            />
          ))}
        </div>
      </div>

      <div className="text-xs text-gray-700 dark:text-gray-300 bg-slate-50 dark:bg-slate-800 p-3 rounded">
        <p className="font-medium mb-1">Timeline Context:</p>
        <p>
          Showing {data.before.length} messages before and {data.after.length} messages after.
          This helps understand the temporal flow of events and narrative development.
        </p>
      </div>
    </div>
  );
}

interface TimelineMessageProps {
  message: {
    id: number;
    content: string;
    telegram_date?: string;
    created_at: string;
    channel: string;
  };
  position: 'before' | 'after';
  isFirst?: boolean;
  isLast?: boolean;
}

function TimelineMessage({ message, position, isFirst, isLast }: TimelineMessageProps) {
  return (
    <div className="relative pl-12">
      <div className={`absolute left-2 top-2 w-4 h-4 rounded-full border-4 border-background ${
        position === 'before' ? 'bg-slate-300' : 'bg-slate-400'
      }`} />
      <Card className="hover:border-primary/50 transition-colors">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted-foreground">{message.channel}</span>
            <span className="text-xs text-muted-foreground">•</span>
            <span className="text-xs text-muted-foreground" title="Original posting date">
              {new Date(message.telegram_date || message.created_at).toLocaleString()}
            </span>
          </div>
          <p className="text-sm line-clamp-2">{message.content}</p>
        </CardContent>
      </Card>
    </div>
  );
}
