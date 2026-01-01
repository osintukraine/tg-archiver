/**
 * WebSocket Hook for Real-Time Map Updates
 *
 * Connects to the map WebSocket endpoint and provides:
 * - Real-time location updates within bounding box
 * - Auto-reconnect with exponential backoff
 * - Connection status indicator
 * - Heartbeat handling
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { LngLatBounds } from 'maplibre-gl';
import { API_URL } from '../lib/api';

/**
 * Get WebSocket base URL based on API configuration
 *
 * Handles two scenarios:
 * 1. Caddy proxy mode (API_URL is empty): Use window.location.origin with ws(s) protocol
 * 2. Direct API mode (API_URL is set): Convert http(s) to ws(s)
 *
 * This ensures WebSocket connections work both:
 * - Through reverse proxy (Caddy routes /api/map/ws/* to API)
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

// Convert bounds to a stable string for dependency comparison
function boundsToKey(bounds: LngLatBounds | null): string {
  if (!bounds) return '';
  // Round to 3 decimal places to avoid micro-changes causing reconnects
  return `${bounds.getSouth().toFixed(3)},${bounds.getWest().toFixed(3)},${bounds.getNorth().toFixed(3)},${bounds.getEast().toFixed(3)}`;
}

interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
  properties: {
    message_id: number;
    location_name: string;
    channel_name: string;
    content: string;
    confidence: number;
    extraction_method: string;
    telegram_date: string | null;
  };
}

interface WebSocketMessage {
  type: 'feature' | 'heartbeat';
  data?: GeoJSONFeature;
  timestamp?: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'failed';

interface UseMapWebSocketOptions {
  bounds: LngLatBounds | null;
  onNewFeature: (feature: GeoJSONFeature) => void;
  enabled?: boolean;
}

interface UseMapWebSocketReturn {
  status: ConnectionStatus;
  connect: () => void;
  disconnect: () => void;
  retryCount: number;
  maxRetries: number;
}

export function useMapWebSocket({
  bounds,
  onNewFeature,
  enabled = true,
}: UseMapWebSocketOptions): UseMapWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [retryCount, setRetryCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Use refs for values that shouldn't trigger reconnects
  const boundsRef = useRef<LngLatBounds | null>(bounds);
  const onNewFeatureRef = useRef(onNewFeature);
  const enabledRef = useRef(enabled);
  // Track intentional disconnects to prevent auto-reconnect
  const intentionalCloseRef = useRef(false);

  const maxReconnectAttempts = 10;
  const baseReconnectDelay = 1000; // 1 second
  const maxReconnectDelay = 30000; // 30 seconds cap

  // Keep refs up to date without causing re-renders
  useEffect(() => {
    boundsRef.current = bounds;
  }, [bounds]);

  useEffect(() => {
    onNewFeatureRef.current = onNewFeature;
  }, [onNewFeature]);

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
    const currentBounds = boundsRef.current;

    // Don't connect if disabled or no bounds
    if (!enabledRef.current || !currentBounds) {
      return;
    }

    // Clear any pending reconnect
    clearReconnectTimeout();

    // If already connected or connecting, don't create another connection
    if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
      console.log('[MapWebSocket] Already connected/connecting, skipping');
      return;
    }

    // Build WebSocket URL
    const south = currentBounds.getSouth();
    const west = currentBounds.getWest();
    const north = currentBounds.getNorth();
    const east = currentBounds.getEast();
    const wsBaseUrl = getWebSocketBaseUrl();
    const fullUrl = `${wsBaseUrl}/api/map/ws/map/live?south=${south}&west=${west}&north=${north}&east=${east}`;

    console.log('[MapWebSocket] Connecting to:', fullUrl);

    try {
      intentionalCloseRef.current = false;
      setStatus('connecting');
      console.log('[MapWebSocket] Connecting...');
      const ws = new WebSocket(fullUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[MapWebSocket] Connected');
        setStatus('connected');
        setRetryCount(0);
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          if (message.type === 'feature' && message.data) {
            // New geocoded message - use ref to get current callback
            onNewFeatureRef.current(message.data);
          } else if (message.type === 'heartbeat') {
            // Heartbeat received - connection is alive
            console.log('[MapWebSocket] Heartbeat received');
          }
        } catch (err) {
          console.error('[MapWebSocket] Failed to parse message:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('[MapWebSocket] Error:', error);
        // Don't set error status here - wait for onclose which always follows onerror
      };

      ws.onclose = (event) => {
        console.log('[MapWebSocket] Closed:', event.code, event.reason);
        wsRef.current = null;

        // If this was an intentional close, don't reconnect
        if (intentionalCloseRef.current) {
          setStatus('disconnected');
          return;
        }

        // Check for specific close codes that shouldn't trigger reconnect
        if (event.code === 4003) {
          // Origin not allowed - don't retry
          console.error('[MapWebSocket] Origin not allowed, not retrying');
          setStatus('failed');
          return;
        }

        if (event.code === 4008) {
          // Too many connections - don't retry immediately
          console.error('[MapWebSocket] Too many connections, not retrying');
          setStatus('failed');
          return;
        }

        setStatus('disconnected');

        // Attempt to reconnect with exponential backoff (capped at 30s)
        setRetryCount(prev => {
          const newCount = prev + 1;

          if (newCount > maxReconnectAttempts) {
            console.error('[MapWebSocket] Max reconnect attempts reached');
            setStatus('failed');
            return prev;
          }

          const exponentialDelay = baseReconnectDelay * Math.pow(2, prev);
          const delay = Math.min(exponentialDelay, maxReconnectDelay);

          console.log(
            `[MapWebSocket] Reconnecting in ${delay}ms (attempt ${newCount}/${maxReconnectAttempts})`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);

          return newCount;
        });
      };
    } catch (err) {
      console.error('[MapWebSocket] Failed to create WebSocket:', err);
      setStatus('error');
    }
  }, [clearReconnectTimeout]); // Minimal dependencies - uses refs for everything else

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

  // Stable bounds key to prevent unnecessary reconnects on tiny changes
  const boundsKey = boundsToKey(bounds);

  // Connect on mount or when bounds/enabled change significantly
  useEffect(() => {
    if (enabled && bounds) {
      // Disconnect old connection first (intentionally)
      if (wsRef.current) {
        intentionalCloseRef.current = true;
        wsRef.current.close(1000, 'Bounds changed');
        wsRef.current = null;
      }
      clearReconnectTimeout();
      setRetryCount(0);

      // Small delay to ensure clean disconnect before reconnect
      const connectTimeout = setTimeout(() => {
        connect();
      }, 100);

      return () => {
        clearTimeout(connectTimeout);
      };
    } else {
      disconnect();
    }
  }, [enabled, boundsKey]); // Use boundsKey not bounds - prevents object reference issues

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    status,
    connect,
    disconnect,
    retryCount,
    maxRetries: maxReconnectAttempts,
  };
}
