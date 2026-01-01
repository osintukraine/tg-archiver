/**
 * WebSocket Hook for Immersive Media Mode
 *
 * Connects to the messages WebSocket endpoint and provides:
 * - Real-time new message notifications
 * - Auto-reconnect with exponential backoff
 * - Connection status indicator
 * - Filter for messages with media only
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { API_URL } from '@/lib/api';
import type { Message } from '@/lib/types';

/**
 * Get WebSocket base URL based on API configuration
 *
 * Handles two scenarios:
 * 1. Caddy proxy mode (API_URL is empty): Use window.location.origin with ws(s) protocol
 * 2. Direct API mode (API_URL is set): Convert http(s) to ws(s)
 *
 * This ensures WebSocket connections work both:
 * - Through reverse proxy (Caddy routes /api/messages/ws/* to API)
 * - Direct to API server (development without proxy)
 */
function getWebSocketBaseUrl(): string {
  // Direct API mode - NEXT_PUBLIC_API_URL is set
  if (API_URL) {
    return API_URL.replace(/^http/, 'ws');
  }

  // Caddy proxy mode - use current origin with WebSocket protocol
  // Works for both http://localhost → ws://localhost
  // and https://production.com → wss://production.com
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
  }

  // SSR fallback (shouldn't happen for WebSocket)
  return 'ws://localhost:8000';
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'failed';

interface WebSocketMessage {
  type: 'message' | 'heartbeat';
  data?: Message;
  timestamp?: number;
}

export interface UseImmersiveWebSocketOptions {
  enabled: boolean;
  onNewMessage: (message: Message) => void;
  filters?: {
    hasMedia?: boolean;
  };
}

export interface UseImmersiveWebSocketReturn {
  status: ConnectionStatus;
  messageCount: number;
}

/**
 * Hook for real-time message updates in Immersive Media Mode
 *
 * NOTE: Currently connects to a hypothetical /api/messages/ws/live endpoint.
 * If this endpoint doesn't exist yet, you may need to:
 * 1. Use the existing map WebSocket for location-based messages
 * 2. Wait for backend implementation of messages WebSocket
 * 3. Create a custom implementation
 */
export function useImmersiveWebSocket({
  enabled,
  onNewMessage,
  filters = {},
}: UseImmersiveWebSocketOptions): UseImmersiveWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [messageCount, setMessageCount] = useState(0);
  const [retryCount, setRetryCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onNewMessageRef = useRef(onNewMessage);
  const enabledRef = useRef(enabled);
  const intentionalCloseRef = useRef(false);

  const maxReconnectAttempts = 10;
  const baseReconnectDelay = 1000; // 1 second
  const maxReconnectDelay = 30000; // 30 seconds cap

  // Keep refs up to date without causing re-renders
  useEffect(() => {
    onNewMessageRef.current = onNewMessage;
  }, [onNewMessage]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    // Don't connect if disabled
    if (!enabledRef.current) {
      return;
    }

    // Clear any pending reconnect
    clearReconnectTimeout();

    // If already connected or connecting, don't create another connection
    if (wsRef.current && (
      wsRef.current.readyState === WebSocket.CONNECTING ||
      wsRef.current.readyState === WebSocket.OPEN
    )) {
      console.log('[ImmersiveWebSocket] Already connected/connecting, skipping');
      return;
    }

    // Build WebSocket URL
    const wsBaseUrl = getWebSocketBaseUrl();
    const params = new URLSearchParams();

    if (filters.hasMedia) {
      params.append('has_media', 'true');
    }

    const queryString = params.toString();
    const fullUrl = queryString
      ? `${wsBaseUrl}/api/messages/ws/live?${queryString}`
      : `${wsBaseUrl}/api/messages/ws/live`;

    console.log('[ImmersiveWebSocket] Connecting to:', fullUrl);

    try {
      intentionalCloseRef.current = false;
      setStatus('connecting');
      const ws = new WebSocket(fullUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[ImmersiveWebSocket] Connected');
        setStatus('connected');
        setRetryCount(0);
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          if (message.type === 'message' && message.data) {
            // New message arrived
            console.log('[ImmersiveWebSocket] New message received:', message.data.id);

            // Filter for media if needed (double-check since backend should handle this)
            if (filters.hasMedia && (!message.data.media_items || message.data.media_items.length === 0)) {
              console.log('[ImmersiveWebSocket] Skipping message without media:', message.data.id);
              return;
            }

            // Call callback with new message
            onNewMessageRef.current(message.data);
            setMessageCount(prev => prev + 1);
          } else if (message.type === 'heartbeat') {
            // Heartbeat received - connection is alive
            console.log('[ImmersiveWebSocket] Heartbeat received');
          }
        } catch (err) {
          console.error('[ImmersiveWebSocket] Failed to parse message:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('[ImmersiveWebSocket] Error:', error);
        // Don't set error status here - wait for onclose which always follows onerror
      };

      ws.onclose = (event) => {
        console.log('[ImmersiveWebSocket] Closed:', event.code, event.reason);
        wsRef.current = null;

        // If this was an intentional close, don't reconnect
        if (intentionalCloseRef.current) {
          setStatus('disconnected');
          return;
        }

        // Check for specific close codes that shouldn't trigger reconnect
        if (event.code === 4003) {
          // Origin not allowed - don't retry
          console.error('[ImmersiveWebSocket] Origin not allowed, not retrying');
          setStatus('failed');
          return;
        }

        if (event.code === 4008) {
          // Too many connections - don't retry immediately
          console.error('[ImmersiveWebSocket] Too many connections, not retrying');
          setStatus('failed');
          return;
        }

        setStatus('disconnected');

        // Attempt to reconnect with exponential backoff (capped at 30s)
        setRetryCount(prev => {
          const newCount = prev + 1;

          if (newCount > maxReconnectAttempts) {
            console.error('[ImmersiveWebSocket] Max reconnect attempts reached');
            setStatus('failed');
            return prev;
          }

          const exponentialDelay = baseReconnectDelay * Math.pow(2, prev);
          const delay = Math.min(exponentialDelay, maxReconnectDelay);

          console.log(
            `[ImmersiveWebSocket] Reconnecting in ${delay}ms (attempt ${newCount}/${maxReconnectAttempts})`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);

          return newCount;
        });
      };
    } catch (err) {
      console.error('[ImmersiveWebSocket] Failed to create WebSocket:', err);
      setStatus('error');
    }
  }, [clearReconnectTimeout, filters.hasMedia]);

  const disconnect = useCallback(() => {
    // Mark as intentional so onclose doesn't try to reconnect
    intentionalCloseRef.current = true;

    // Clear reconnect timeout
    clearReconnectTimeout();

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }

    setStatus('disconnected');
    setRetryCount(0);
  }, [clearReconnectTimeout]);

  // Connect on mount or when enabled/filters change
  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    // Cleanup on unmount
    return () => {
      disconnect();
    };
  }, [enabled, filters.hasMedia]); // filters.hasMedia is primitive, safe to depend on

  return {
    status,
    messageCount,
  };
}
