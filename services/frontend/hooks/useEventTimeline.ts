import { useQuery } from '@tanstack/react-query';
import { API_URL } from '../lib/api';

/**
 * Event Timeline Hooks - React Query hooks for event-based timeline feature.
 *
 * Provides hooks for:
 * - useMessageEvents(messageId) - Get events for a message
 * - useEventTimeline(eventId) - Get full timeline for an event
 */

// ============================================================================
// Types
// ============================================================================

interface EventMessage {
  id: number;
  content: string;
  created_at: string;
  channel_name: string;
  channel_username?: string;
  importance_level: 'high' | 'medium' | 'low' | null;
  views?: number;
  forwards?: number;
  media_type?: string;
  link_confidence: number | null;
}

interface EventData {
  id: number;
  title: string;
  first_message_at: string;
  last_message_at: string;
}

interface EventTimelineResponse {
  event: EventData;
  messages: EventMessage[];
  count: number;
}

interface EventInfo {
  id: number;
  title: string;
  event_type: string;
  first_message_at: string;
  last_message_at: string;
  message_count: number;
  status: string;
  entity_fingerprint: string[];
  link_confidence: number | null;
  link_method: string;
  shared_entities?: any[];
}

interface MessageEventsResponse {
  message_id: number;
  events: EventInfo[];
  count: number;
}

// ============================================================================
// API Helper Functions
// ============================================================================

/**
 * Fetch helper with error handling
 */
async function fetchApi<T>(path: string): Promise<T> {
  const url = `${API_URL}${path}`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store', // Disable Next.js caching
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `Failed to fetch: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get all events associated with a message
 */
async function getEventsForMessage(messageId: number): Promise<MessageEventsResponse> {
  return fetchApi<MessageEventsResponse>(`/api/events/message/${messageId}`);
}

/**
 * Get full timeline for an event (chronological message list)
 */
async function getEventTimeline(eventId: number): Promise<EventTimelineResponse> {
  return fetchApi<EventTimelineResponse>(`/api/events/${eventId}/timeline`);
}

// ============================================================================
// React Query Hooks
// ============================================================================

/**
 * Hook to get events associated with a message.
 *
 * Returns all events that this message belongs to, ordered by link confidence.
 * Used to determine if a message is part of any event cluster.
 *
 * @param messageId - Message ID to fetch events for
 * @returns React Query result with MessageEventsResponse
 */
export function useMessageEvents(messageId: number) {
  return useQuery<MessageEventsResponse>({
    queryKey: ['message-events', messageId],
    queryFn: () => getEventsForMessage(messageId),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!messageId,
  });
}

/**
 * Hook to get full chronological timeline for an event.
 *
 * Returns all messages in the event ordered chronologically,
 * with metadata for timeline visualization.
 *
 * @param eventId - Event ID to fetch timeline for (null to disable)
 * @returns React Query result with EventTimelineResponse
 */
export function useEventTimeline(eventId: number | null) {
  return useQuery<EventTimelineResponse>({
    queryKey: ['event-timeline', eventId],
    queryFn: () => getEventTimeline(eventId!),
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!eventId,
  });
}
