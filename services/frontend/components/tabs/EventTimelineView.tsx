'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock, ChevronDown, Loader2, Tag, ExternalLink, AlertCircle } from 'lucide-react';
import { useMessageEvents, useEventTimeline } from '@/hooks/useEventTimeline';
import type { Message } from '@/lib/types';

interface EventTimelineViewProps {
  message: Message;
}

export function EventTimelineView({ message }: EventTimelineViewProps) {
  const { data: eventsData, isLoading: eventsLoading, error: eventsError } = useMessageEvents(message.id);

  // Get the primary event (highest confidence)
  const primaryEvent = eventsData?.events?.[0];

  const {
    data: timelineData,
    isLoading: timelineLoading
  } = useEventTimeline(primaryEvent?.id || null);

  // Helper to get importance level badge color
  const getImportanceLevelColor = (level?: 'high' | 'medium' | 'low' | null) => {
    if (!level) return 'secondary';
    switch (level) {
      case 'high':
        return 'destructive';
      case 'medium':
        return 'default';
      case 'low':
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  // Loading state
  if (eventsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Loading event context...
        </span>
      </div>
    );
  }

  // Error state
  if (eventsError) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground/20 mb-3" />
        <p className="text-sm text-destructive">Failed to load event timeline</p>
        <p className="text-xs text-muted-foreground mt-1">
          {eventsError instanceof Error ? eventsError.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  // Empty state - no events found
  if (!eventsData || eventsData.count === 0) {
    return <EmptyEventState message={message} />;
  }

  // Loading timeline for selected event
  if (timelineLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Loading event timeline...
        </span>
      </div>
    );
  }

  // Render event timeline
  return (
    <div className="space-y-4">
      {/* Event header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          <h3 className="text-sm font-medium">Event Timeline</h3>
        </div>
        <Badge variant="outline" className="text-xs">
          {timelineData?.count || 0} messages
        </Badge>
      </div>

      {/* Event info card */}
      {primaryEvent && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="p-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium line-clamp-2">
                  {primaryEvent.title || 'Untitled Event'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(primaryEvent.first_message_at).toLocaleDateString()} - {' '}
                  {new Date(primaryEvent.last_message_at).toLocaleDateString()}
                </p>
              </div>
              <Badge variant="secondary" className="text-xs">
                {primaryEvent.event_type}
              </Badge>
            </div>
            {primaryEvent.entity_fingerprint && primaryEvent.entity_fingerprint.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {primaryEvent.entity_fingerprint.slice(0, 5).map((entity, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    <Tag className="h-3 w-3 mr-1" />
                    {entity}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-700" />

        <div className="space-y-4">
          {timelineData?.messages.map((msg) => {
            const isCurrentMessage = msg.id === message.id;

            return (
              <div key={msg.id} className="relative pl-12">
                {/* Timeline dot */}
                <div className={`absolute left-2 top-2 w-4 h-4 rounded-full border-4 border-background ${
                  isCurrentMessage
                    ? 'bg-primary ring-2 ring-primary/20'
                    : 'bg-slate-300 dark:bg-slate-600'
                }`} />

                <Card className={`transition-colors ${
                  isCurrentMessage
                    ? 'border-primary shadow-md'
                    : 'hover:border-primary/50'
                }`}>
                  <CardContent className="p-3">
                    {isCurrentMessage && (
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-medium text-primary">CURRENT MESSAGE</span>
                        <ChevronDown className="h-3 w-3 text-primary" />
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-muted-foreground">{msg.channel_name}</span>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(msg.created_at).toLocaleString()}
                      </span>
                      {msg.importance_level && (
                        <Badge variant={getImportanceLevelColor(msg.importance_level)} className="text-xs ml-auto">
                          {msg.importance_level === 'high' ? 'High' : msg.importance_level === 'medium' ? 'Medium' : 'Low'}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm line-clamp-3">{msg.content}</p>
                    {!isCurrentMessage && (
                      <a
                        href={`/messages/${msg.id}`}
                        className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1 mt-2"
                      >
                        View message
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>
      </div>

      {/* Info box */}
      <div className="text-xs text-gray-700 dark:text-gray-300 bg-slate-50 dark:bg-slate-800 p-3 rounded">
        <p className="font-medium mb-1">Event Timeline:</p>
        <p>
          Showing {timelineData?.count || 0} messages that are part of this event.
          Messages are linked by shared entities and semantic similarity.
        </p>
      </div>
    </div>
  );
}

/**
 * Empty state when no events are found for the message.
 * Shows extracted entities as helpful context.
 */
function EmptyEventState({ message }: { message: Message }) {
  // Extract entity names from message
  const entities = message.entities || {};

  // Handle entities as either array or object
  let entityNames: string[] = [];

  if (Array.isArray(entities)) {
    // If entities is already an array
    entityNames = entities
      .map((e: any) => e.text || e.name)
      .filter(Boolean)
      .slice(0, 5);
  } else if (typeof entities === 'object' && entities !== null) {
    // entities is {hashtags: string[], urls: string[], mentions: string[], ...}
    // Flatten all arrays into a single list of entity names
    const allEntities: string[] = [];
    for (const [key, values] of Object.entries(entities)) {
      if (Array.isArray(values)) {
        allEntities.push(...values.slice(0, 3)); // Take up to 3 from each category
      } else if (typeof values === 'string') {
        allEntities.push(values);
      }
    }
    entityNames = allEntities.slice(0, 5);
  }

  return (
    <div className="text-center py-12">
      <Clock className="h-12 w-12 mx-auto text-muted-foreground/20 mb-3" />
      <p className="text-sm text-muted-foreground">No related events found yet</p>

      {entityNames.length > 0 ? (
        <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg max-w-md mx-auto">
          <p className="text-xs text-muted-foreground mb-2">
            This message mentions:
          </p>
          <div className="flex flex-wrap justify-center gap-1">
            {entityNames.map((entity: string, idx: number) => (
              <Badge key={idx} variant="outline" className="text-xs">
                <Tag className="h-3 w-3 mr-1" />
                {entity}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Related events may appear as more coverage is detected.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mt-2">
          Events are automatically detected when similar messages are found.
        </p>
      )}
    </div>
  );
}
