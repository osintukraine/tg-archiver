'use client';

import { useEffect, useState, useRef } from 'react';
import { Map as MapLibreMap, Marker, Popup } from 'maplibre-gl';
import { API_URL } from '../../lib/api';

// Tier colors matching task specification
const TIER_COLORS = {
  rumor: '#ef4444',      // red
  unconfirmed: '#eab308', // yellow
  confirmed: '#22c55e',   // green
  verified: '#3b82f6',    // blue
} as const;

interface EventLayerProps {
  map: MapLibreMap | null;
  visible: boolean;
  dateRange: { start: Date | null; end: Date | null };
}

interface ClusterFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: {
    cluster_id: number;
    tier: string;
    status: string;
    claim_type?: string;
    channel_count: number;
    message_count: number;
    detected_at: string;
    summary?: string;
  };
}

interface ClusterMessage {
  message_id: number;
  latitude: number;
  longitude: number;
  content: string;
  channel_name: string;
  telegram_date?: string;
}

interface ClusterMessagesResponse {
  cluster_id: number;
  tier: string;
  messages: ClusterMessage[];
}

export default function EventLayer({
  map,
  visible,
  dateRange,
}: EventLayerProps) {
  const [loading, setLoading] = useState(false);
  const [expandedClusterId, setExpandedClusterId] = useState<number | null>(null);
  const [expandLoading, setExpandLoading] = useState<number | null>(null);
  const [expandError, setExpandError] = useState<{ clusterId: number; message: string } | null>(null);
  const markersRef = useRef<Map<number, Marker[]>>(new Map());
  const expandedMarkersRef = useRef<Marker[]>([]);

  useEffect(() => {
    if (!map) return;

    const loadClusters = async () => {
      if (!visible) {
        // Clear all markers when layer is hidden
        clearAllMarkers();
        return;
      }

      setLoading(true);
      const bounds = map.getBounds();

      try {
        const params = new URLSearchParams({
          south: bounds.getSouth().toString(),
          west: bounds.getWest().toString(),
          north: bounds.getNorth().toString(),
          east: bounds.getEast().toString(),
          limit: '200',
        });

        // Add date range filters
        if (dateRange.start) {
          params.append('start_date', dateRange.start.toISOString());
        }
        if (dateRange.end) {
          params.append('end_date', dateRange.end.toISOString());
        }

        const res = await fetch(`${API_URL}/api/map/clusters?${params}`);
        if (!res.ok) {
          throw new Error('Failed to load clusters');
        }

        const data: { features: ClusterFeature[] } = await res.json();

        // Clear existing markers
        clearAllMarkers();

        // Add cluster markers
        data.features.forEach((feature) => {
          addClusterMarker(feature);
        });

        console.log(`[EventLayer] Loaded ${data.features.length} clusters`);
      } catch (e) {
        console.error('Error loading event clusters:', e);
      } finally {
        setLoading(false);
      }
    };

    loadClusters();

    // Reload clusters when map moves
    const handleMoveEnd = () => {
      if (visible) {
        loadClusters();
      }
    };

    map.on('moveend', handleMoveEnd);

    return () => {
      map.off('moveend', handleMoveEnd);
      clearAllMarkers();
    };
  }, [map, visible, dateRange]);

  const clearAllMarkers = () => {
    // Clear cluster markers
    markersRef.current.forEach((markers) => {
      markers.forEach(marker => marker.remove());
    });
    markersRef.current.clear();

    // Clear expanded markers
    expandedMarkersRef.current.forEach(marker => marker.remove());
    expandedMarkersRef.current = [];

    setExpandedClusterId(null);
    setExpandError(null);
  };

  const addClusterMarker = (feature: ClusterFeature) => {
    if (!map) return;

    const [lng, lat] = feature.geometry.coordinates;
    const { cluster_id, tier, message_count, channel_count, summary, detected_at } = feature.properties;

    // Get tier color
    const tierColor = TIER_COLORS[tier as keyof typeof TIER_COLORS] || '#6b7280';

    // Create cluster marker element
    const el = document.createElement('div');
    el.className = 'event-cluster-marker';
    el.style.cssText = `
      width: 40px;
      height: 40px;
      cursor: pointer;
    `;

    // Add circle with tier color
    const circle = document.createElement('div');
    circle.style.cssText = `
      width: 40px;
      height: 40px;
      background: ${tierColor};
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      color: white;
    `;

    // Add message count badge
    const badge = document.createElement('div');
    badge.style.cssText = `
      position: absolute;
      top: -8px;
      right: -8px;
      background: #1f2937;
      color: white;
      border-radius: 12px;
      padding: 2px 6px;
      font-size: 11px;
      font-weight: bold;
      border: 2px solid white;
      min-width: 20px;
      text-align: center;
    `;
    badge.textContent = message_count.toString();

    el.appendChild(circle);
    el.appendChild(badge);

    // Hover effect - use opacity instead of transform to avoid positioning issues
    el.addEventListener('mouseenter', () => {
      circle.style.opacity = '0.85';
    });
    el.addEventListener('mouseleave', () => {
      circle.style.opacity = '1';
    });

    // Create popup with cluster info
    const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
    const isLoading = expandLoading === cluster_id;
    const hasError = expandError?.clusterId === cluster_id;

    const popupContent = `
      <div style="max-width: 350px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <strong style="font-size: 14px;">Cluster #${cluster_id}</strong>
          <span style="background: ${tierColor}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">
            ${tierLabel}
          </span>
        </div>
        <p style="margin: 4px 0; font-size: 12px;">
          <strong>${channel_count}</strong> channels,
          <strong>${message_count}</strong> messages
        </p>
        ${summary ? `<p style="margin: 8px 0 4px 0; font-size: 11px; color: #444; line-height: 1.4;">${summary}</p>` : ''}
        ${detected_at ? `<p style="margin: 4px 0; font-size: 10px; color: #999;">Detected: ${new Date(detected_at).toLocaleString()}</p>` : ''}
        ${hasError ? `
          <div style="margin: 8px 0; padding: 6px; background: #fee; border: 1px solid #fcc; border-radius: 4px;">
            <p style="margin: 0; font-size: 11px; color: #c00; font-weight: bold;">Error loading messages</p>
            <p style="margin: 4px 0 0 0; font-size: 10px; color: #666;">${expandError.message}</p>
          </div>
        ` : ''}
        <p style="margin: 8px 0 0 0; font-size: 11px; color: ${isLoading ? '#999' : '#3b82f6'}; font-weight: bold;">
          ${isLoading ? 'Loading...' : (hasError ? 'Click to retry' : 'Click to expand cluster')}
        </p>
      </div>
    `;

    const popup = new Popup({ offset: 25, closeButton: false });
    popup.setHTML(popupContent);

    // Add click handler for expansion
    el.addEventListener('click', async (e) => {
      e.stopPropagation();

      // Prevent double-clicks during loading
      if (expandLoading !== null) {
        return;
      }

      if (expandedClusterId === cluster_id) {
        // Collapse if already expanded
        collapseCluster();
      } else {
        // Expand this cluster
        await expandCluster(cluster_id, lng, lat, tierColor);
      }
    });

    // Create and add marker - anchor at center to prevent displacement on zoom
    const marker = new Marker({ element: el, anchor: 'center' })
      .setLngLat([lng, lat])
      .setPopup(popup)
      .addTo(map);

    // Store marker reference
    if (!markersRef.current.has(cluster_id)) {
      markersRef.current.set(cluster_id, []);
    }
    markersRef.current.get(cluster_id)!.push(marker);
  };

  const expandCluster = async (clusterId: number, centerLng: number, centerLat: number, tierColor: string) => {
    if (!map) return;

    // Set loading state
    setExpandLoading(clusterId);
    setExpandError(null);

    // First, collapse any existing expansion
    collapseCluster();

    try {
      // Fetch cluster messages
      const res = await fetch(`${API_URL}/api/map/clusters/${clusterId}/messages`);

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        let errorMessage = `Failed to load messages (${res.status})`;

        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.detail) {
            errorMessage = errorJson.detail;
          }
        } catch {
          // Use default error message
        }

        throw new Error(errorMessage);
      }

      const data: ClusterMessagesResponse = await res.json();
      const messages = data.messages;

      if (!messages || messages.length === 0) {
        setExpandError({
          clusterId,
          message: 'No messages found for this cluster',
        });
        return;
      }

      // Calculate spider pattern positions
      const radius = 50; // pixels from center
      const angleStep = (2 * Math.PI) / messages.length;

      // Add expanded message markers
      messages.forEach((message, index) => {
        // Calculate position in circle around center
        const angle = index * angleStep;

        // Convert pixel offset to lng/lat offset (approximate)
        const metersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, map.getZoom());
        const offsetMeters = radius * metersPerPixel;

        // Simple offset calculation (works for small distances)
        const offsetLng = (offsetMeters * Math.cos(angle)) / (111320 * Math.cos(centerLat * Math.PI / 180));
        const offsetLat = (offsetMeters * Math.sin(angle)) / 110540;

        const messageLng = centerLng + offsetLng;
        const messageLat = centerLat + offsetLat;

        // Create message marker element
        const el = document.createElement('div');
        el.className = 'expanded-message-marker';
        el.style.cssText = `
          width: 16px;
          height: 16px;
          background: ${tierColor};
          border: 2px solid white;
          border-radius: 50%;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          animation: fadeIn 0.2s ease-out;
        `;

        // Add fade-in animation
        if (!document.getElementById('cluster-expansion-animation')) {
          const style = document.createElement('style');
          style.id = 'cluster-expansion-animation';
          style.textContent = `
            @keyframes fadeIn {
              from {
                opacity: 0;
                transform: scale(0.5);
              }
              to {
                opacity: 1;
                transform: scale(1);
              }
            }
          `;
          document.head.appendChild(style);
        }

        // Create message popup
        const popup = new Popup({ offset: 15 }).setHTML(`
          <div style="max-width: 300px;">
            <strong>${message.channel_name}</strong>
            <p style="margin: 5px 0; font-size: 11px; color: #666;">${message.content.substring(0, 150)}...</p>
            ${message.telegram_date ? `<p style="font-size: 10px; color: #999; margin-top: 5px;">${new Date(message.telegram_date).toLocaleString()}</p>` : ''}
          </div>
        `);

        // Add marker - anchor at center for consistent positioning
        const marker = new Marker({ element: el, anchor: 'center' })
          .setLngLat([messageLng, messageLat])
          .setPopup(popup)
          .addTo(map);

        expandedMarkersRef.current.push(marker);

        // Draw connecting line from center to message
        const lineEl = document.createElement('div');
        lineEl.className = 'cluster-expansion-line';
        lineEl.style.cssText = `
          position: absolute;
          width: ${radius}px;
          height: 2px;
          background: ${tierColor};
          opacity: 0.4;
          transform-origin: 0 50%;
          transform: rotate(${angle}rad);
          pointer-events: none;
        `;

        // Position the line at the center point
        const centerPoint = map.project([centerLng, centerLat]);
        lineEl.style.left = `${centerPoint.x}px`;
        lineEl.style.top = `${centerPoint.y}px`;

        map.getContainer().appendChild(lineEl);

        // Store line element for cleanup
        expandedMarkersRef.current.push({
          remove: () => lineEl.remove(),
        } as any);
      });

      setExpandedClusterId(clusterId);
      console.log(`[EventLayer] Expanded cluster ${clusterId} with ${messages.length} messages`);
    } catch (error) {
      console.error('Error expanding cluster:', error);

      const errorMessage = error instanceof Error
        ? error.message
        : 'Failed to load cluster messages. Please try again.';

      setExpandError({
        clusterId,
        message: errorMessage,
      });

      // Refresh the popup to show error state
      updateClusterPopup(clusterId);
    } finally {
      setExpandLoading(null);
    }
  };

  const updateClusterPopup = (clusterId: number) => {
    // This will trigger a re-render of the popup when it's next opened
    // The error state will be shown in the popup content
    const markers = markersRef.current.get(clusterId);
    if (markers && markers.length > 0) {
      const marker = markers[0];
      const popup = marker.getPopup();
      if (popup && popup.isOpen()) {
        // Close and reopen to refresh content
        popup.remove();
        setTimeout(() => {
          marker.togglePopup();
        }, 100);
      }
    }
  };

  const collapseCluster = () => {
    // Remove all expanded markers and lines
    expandedMarkersRef.current.forEach(marker => marker.remove());
    expandedMarkersRef.current = [];

    // Remove any line elements
    document.querySelectorAll('.cluster-expansion-line').forEach(el => el.remove());

    setExpandedClusterId(null);
  };

  // Click away to collapse
  useEffect(() => {
    if (!map || expandedClusterId === null) return;

    const handleMapClick = () => {
      collapseCluster();
      setExpandError(null);
    };

    map.on('click', handleMapClick);

    return () => {
      map.off('click', handleMapClick);
    };
  }, [map, expandedClusterId]);

  return null; // This component doesn't render anything itself
}
