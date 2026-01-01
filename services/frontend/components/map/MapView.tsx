'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import maplibregl, { Map as MapLibreMap, Marker, Popup, GeoJSONSource } from 'maplibre-gl';
// Note: Popup still used for event clusters
import 'maplibre-gl/dist/maplibre-gl.css';
import TimelineSlider from './TimelineSlider';
import HeatMapLayer from './HeatMapLayer';
import EventLayer from './EventLayer';
import TrajectoryLayer from './TrajectoryLayer';
import VesselLayer from './VesselLayer';
import { useMapWebSocket, type ConnectionStatus } from '../../hooks/useMapWebSocket';
import { API_URL } from '../../lib/api';
import MapLegend from './MapLegend';
import MapHoverCard, { type MapMessageProperties } from './MapHoverCard';
import MapExpandedCard from './MapExpandedCard';
import { createFlagMarkerElement } from './mapMarkerUtils';
import MapSidebar, { type RegionFocus, CONFLICT_ZONE_BBOX } from './MapSidebar';

// HTML escape utility to prevent XSS attacks
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

// Ukraine center coordinates
const DEFAULT_CENTER: [number, number] = [35.0, 48.5];
const DEFAULT_ZOOM = 6;

// Debounce delay for API calls on pan/zoom (milliseconds)
const DEBOUNCE_DELAY = 300;

// We handle ALL marker rendering ourselves with custom DOM elements
// MapLibre GeoJSON source is used ONLY for data storage, not rendering
// This eliminates conflicts between MapLibre's clustering and our markers

// Zoom threshold for clustering (individual points visible at zoom >= 9)
const CLUSTER_ZOOM_THRESHOLD = 9;

interface MapFeature {
  geometry: {
    coordinates: [number, number];
  };
  properties: {
    message_id?: number;
    event_id?: number;
    cluster_id?: number;
    content?: string;
    title?: string;
    summary?: string;
    channel_name?: string;
    location_name?: string;
    tier?: string;
    status?: string;
    claim_type?: string;
    channel_count?: number;
    message_count?: number;
    detected_at?: string;
    confidence?: number;
    extraction_method?: string;
    telegram_date?: string | null;
  };
}

export default function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const clusterMarkersRef = useRef<Marker[]>([]);
  // Track markers by message_id for stable updates (no recreation = no teleport)
  const messageMarkersMapRef = useRef<Map<number, { marker: Marker; feature: any }>>(new Map());
  const featuresRef = useRef<any[]>([]); // Store original GeoJSON features
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showClusters, setShowClusters] = useState(true);
  const [showEvents, setShowEvents] = useState(false);
  const [showHeatMap, setShowHeatMap] = useState(false);
  const [showTrajectories, setShowTrajectories] = useState(true); // Movement trajectories (drones, etc.)
  const [showVessels, setShowVessels] = useState(false); // Shadow Fleet vessel tracking (off by default)
  const [liveUpdatesEnabled, setLiveUpdatesEnabled] = useState(true);
  const [heatMapRadius, setHeatMapRadius] = useState(20);
  const [heatMapOpacity, setHeatMapOpacity] = useState(0.7);
  const [heatMapGridSize, setHeatMapGridSize] = useState(0.1);
  const [dateRange, setDateRange] = useState<{ start: Date | null; end: Date | null }>({
    start: null,
    end: null,
  });
  const [expandedMessage, setExpandedMessage] = useState<MapMessageProperties | null>(null);
  const [regionFocus, setRegionFocus] = useState<RegionFocus>('conflict');
  const [hoveredMessage, setHoveredMessage] = useState<{ props: MapMessageProperties; position: { x: number; y: number } } | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Delay hiding hover card
  const isHoveringCardRef = useRef(false); // Track if mouse is over hover card
  const searchParams = useSearchParams();

  // Get URL parameters for initial center and zoom
  const urlLat = searchParams.get('lat');
  const urlLng = searchParams.get('lng');
  const urlZoom = searchParams.get('zoom');

  const initialCenter: [number, number] =
    urlLat && urlLng ? [parseFloat(urlLng), parseFloat(urlLat)] : DEFAULT_CENTER;
  const initialZoom = urlZoom ? parseFloat(urlZoom) : DEFAULT_ZOOM;

  // Handle new feature from WebSocket
  const handleNewFeature = useCallback((feature: MapFeature) => {
    if (!map.current) return;

    const [lng, lat] = feature.geometry.coordinates;
    const props = feature.properties as MapMessageProperties;

    // Create flag marker element
    const el = createFlagMarkerElement(
      props.channel_affiliation,
      props.precision_level,
      props.confidence
    );
    el.classList.add('live-marker'); // Keep animation class

    // Create marker with explicit anchor at center
    const marker = new Marker({ element: el, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(map.current);

    // Get inner element for scale animation (outer is controlled by MapLibre)
    const inner = el.querySelector('.flag-marker-inner') as HTMLElement;

    // Hover to show hover card + scale animation
    el.addEventListener('mouseenter', () => {
      if (inner) inner.style.transform = 'scale(1.3)';
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      const rect = el.getBoundingClientRect();
      setHoveredMessage({
        props,
        position: {
          x: rect.left + rect.width / 2,
          y: rect.top
        }
      });
    });

    el.addEventListener('mouseleave', () => {
      if (inner) inner.style.transform = 'scale(1)';
      hoverTimeoutRef.current = setTimeout(() => {
        if (!isHoveringCardRef.current) {
          setHoveredMessage(null);
        }
      }, 150);
    });

    // Click to expand
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (inner) inner.style.transform = 'scale(1)';
      isHoveringCardRef.current = false;
      setHoveredMessage(null);
      setExpandedMessage(props);
    });

    // Remove after 30 seconds
    setTimeout(() => {
      marker.remove();
    }, 30000);

    console.log('[MapView] New location added:', feature.properties.location_name);
  }, []);

  // WebSocket connection
  const { status: wsStatus, connect: wsConnect, retryCount, maxRetries } = useMapWebSocket({
    bounds: map.current?.getBounds() || null,
    onNewFeature: handleNewFeature,
    enabled: liveUpdatesEnabled && !loading,
  });

  // Handle timeline range change
  const handleTimelineChange = useCallback((startDate: Date | null, endDate: Date | null) => {
    setDateRange({ start: startDate, end: endDate });
  }, []);

  // Fly to a specific location (used by sidebar)
  const handleFlyToLocation = useCallback((lat: number, lng: number, zoom: number = 10) => {
    if (map.current) {
      map.current.flyTo({
        center: [lng, lat],
        zoom,
        duration: 1500,
      });
    }
  }, []);

  // Debounce timer reference
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Refs to always call the latest version of load functions
  // This avoids stale closure issues when dateRange changes
  const loadMessagesRef = useRef<() => Promise<void>>();
  const loadClustersRef = useRef<() => Promise<void>>();

  // Debounced data loading function using refs to avoid stale closures
  // The refs are updated after loadMessages/loadClusters are defined (see useEffect below)
  const debouncedLoadData = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      loadMessagesRef.current?.();
      loadClustersRef.current?.();
    }, DEBOUNCE_DELAY);
  }, []);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    // Get theme from localStorage
    const savedTheme = typeof window !== 'undefined' ? localStorage.getItem('theme') : 'light';
    const mapStyle = savedTheme === 'dark'
      ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
      : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

    // Initialize map
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: mapStyle,
      center: initialCenter,
      zoom: initialZoom,
    });

    map.current.on('load', () => {
      setLoading(false);

      // Add GeoJSON source for messages WITH native MapLibre clustering
      map.current!.addSource('messages', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 8,  // Stop clustering at zoom 9 (show individual points earlier)
        clusterRadius: 50,  // Tighter clustering radius
      });

      // Native cluster circle layer (purple circles)
      map.current!.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'messages',
        filter: ['has', 'point_count'],
        paint: {
          // Size based on point count (step expression)
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            18,   // default size
            10, 22,   // 10+ points
            50, 28,   // 50+ points
            100, 34,  // 100+ points
            500, 40   // 500+ points
          ],
          'circle-color': '#6366f1',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      });

      // Cluster count labels
      map.current!.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'messages',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-size': 12,
        },
        paint: {
          'text-color': '#ffffff',
        },
      });

      // Individual points are rendered as DOM flag markers (updateMessageMarkers)
      // This gives us: flag icons, hover cards, expanded cards

      // Click on cluster to zoom in
      map.current!.on('click', 'clusters', async (e) => {
        const features = map.current!.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        if (!features.length) return;

        const clusterId = features[0].properties?.cluster_id;
        const source = map.current!.getSource('messages') as GeoJSONSource;
        const coords = (features[0].geometry as any).coordinates;

        try {
          // Get cluster expansion zoom (Promise-based API in newer MapLibre)
          const zoom = await source.getClusterExpansionZoom(clusterId);
          if (zoom && map.current) {
            map.current.flyTo({
              center: coords,
              zoom: zoom,
              duration: 500
            });
          }
        } catch (err) {
          // Fallback: just zoom in by 2 levels
          if (map.current) {
            map.current.flyTo({
              center: coords,
              zoom: map.current.getZoom() + 2,
              duration: 500
            });
          }
        }
      });

      // Hover cursor on clusters
      map.current!.on('mouseenter', 'clusters', () => {
        if (map.current) map.current.getCanvas().style.cursor = 'pointer';
      });
      map.current!.on('mouseleave', 'clusters', () => {
        if (map.current) map.current.getCanvas().style.cursor = '';
      });

      // Initial data load
      loadMessages();
      loadClusters();
    });

    // Debounced data reload on map movement (includes zoom)
    // updateMessageMarkers is called from loadMessages with stored features
    map.current.on('moveend', debouncedLoadData);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      // Clean up all markers
      messageMarkersMapRef.current.forEach(({ marker }) => marker.remove());
      messageMarkersMapRef.current.clear();
      clusterMarkersRef.current.forEach(marker => marker.remove());
      map.current?.remove();
    };
  }, []);

  // Reload data when date range changes
  useEffect(() => {
    if (map.current && !loading) {
      loadMessages();
      loadClusters();
    }
  }, [dateRange]);

  const getClusterMarkerStyle = (tier: string): { html: string; color: string } => {
    switch (tier) {
      case 'rumor':
        return {
          html: '△',
          color: '#9ca3af', // gray
        };
      case 'unconfirmed':
        return {
          html: '◇',
          color: '#f97316', // orange
        };
      case 'confirmed':
        return {
          html: '●',
          color: '#3b82f6', // blue
        };
      case 'verified':
        return {
          html: '★',
          color: '#eab308', // gold
        };
      default:
        return {
          html: '○',
          color: '#6b7280',
        };
    }
  };

  const loadMessages = async () => {
    if (!map.current) return;

    const bounds = map.current.getBounds();
    const zoom = Math.floor(map.current.getZoom());

    console.log(`[MapView] loadMessages called, zoom=${zoom}`);

    try {
      // Always fetch individual messages - MapLibre handles clustering natively
      const params = new URLSearchParams({
        south: bounds.getSouth().toString(),
        west: bounds.getWest().toString(),
        north: bounds.getNorth().toString(),
        east: bounds.getEast().toString(),
        limit: '2000',
        zoom: zoom.toString(),
      });

      // Add date range filters
      if (dateRange.start) {
        params.append('start_date', dateRange.start.toISOString());
      }
      if (dateRange.end) {
        params.append('end_date', dateRange.end.toISOString());
      }

      const res = await fetch(`${API_URL}/api/map/messages?${params}`);
      if (!res.ok) throw new Error('Failed to load messages');

      const data = await res.json();

      // Store original features for marker creation (avoid querySourceFeatures issues)
      featuresRef.current = data.features || [];

      // Update the GeoJSON source with new data (MapLibre handles clustering)
      const source = map.current.getSource('messages') as GeoJSONSource;
      if (source) {
        source.setData(data);
      }

      // Update message markers using stored features
      updateMessageMarkers();

      console.log(`[MapView] Loaded ${data.features.length} messages at zoom ${zoom}`);
    } catch (e) {
      console.error('Error loading map messages:', e);
      setError('Failed to load map data');
    }
  };

  const loadClusters = async () => {
    if (!map.current || !showClusters) return;

    const bounds = map.current.getBounds();

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
      if (!res.ok) throw new Error('Failed to load clusters');

      const data = await res.json();

      // Clear existing cluster markers properly (remove MapLibre Marker objects, not just DOM)
      clusterMarkersRef.current.forEach(marker => marker.remove());
      clusterMarkersRef.current = [];

      // Add markers for each cluster
      data.features.forEach((feature: MapFeature) => {
        const [lng, lat] = feature.geometry.coordinates;
        const tier = feature.properties.tier || 'rumor';
        const markerStyle = getClusterMarkerStyle(tier);

        const el = document.createElement('div');
        el.className = 'cluster-marker';
        el.style.cssText = `
          width: 32px;
          height: 32px;
          background: ${markerStyle.color};
          color: white;
          border: 3px solid white;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: bold;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;
        el.innerHTML = markerStyle.html;

        const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
        const popup = new Popup({ offset: 25 }).setHTML(`
          <div style="max-width: 350px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <strong style="font-size: 14px;">Cluster #${feature.properties.cluster_id}</strong>
              <span style="background: ${markerStyle.color}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold;">
                ${escapeHtml(tierLabel)}
              </span>
            </div>
            ${feature.properties.claim_type ? `<p style="margin: 4px 0; font-size: 12px; color: #666;">Type: ${escapeHtml(feature.properties.claim_type)}</p>` : ''}
            <p style="margin: 4px 0; font-size: 12px;">
              <strong>${feature.properties.channel_count || 0}</strong> channels,
              <strong>${feature.properties.message_count || 0}</strong> messages
            </p>
            ${feature.properties.summary ? `<p style="margin: 8px 0 4px 0; font-size: 11px; color: #444; line-height: 1.4;">${escapeHtml(feature.properties.summary)}...</p>` : ''}
            ${feature.properties.detected_at ? `<p style="margin: 4px 0; font-size: 10px; color: #999;">Detected: ${escapeHtml(new Date(feature.properties.detected_at).toLocaleString())}</p>` : ''}
          </div>
        `);

        const marker = new Marker({ element: el })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(map.current!);

        // Track marker for proper cleanup
        clusterMarkersRef.current.push(marker);
      });
    } catch (e) {
      console.error('Error loading map clusters:', e);
      // Don't set error state for clusters - they're optional
    }
  };

  // Helper to create a marker with hover/click handlers
  const createMessageMarker = useCallback((feature: any): { marker: Marker; element: HTMLDivElement } | null => {
    if (!map.current) return null;
    if (!feature.geometry || feature.geometry.type !== 'Point') return null;

    const [lng, lat] = feature.geometry.coordinates;
    const props = feature.properties as MapMessageProperties;

    // Create flag marker element
    const el = createFlagMarkerElement(
      props.channel_affiliation,
      props.precision_level,
      props.confidence
    );

    // Create marker with explicit anchor at center
    const marker = new Marker({ element: el, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(map.current);

    // Get inner element for scale animation (outer is controlled by MapLibre)
    const inner = el.querySelector('.flag-marker-inner') as HTMLElement;

    // Hover to show hover card + scale animation
    el.addEventListener('mouseenter', () => {
      if (inner) inner.style.transform = 'scale(1.3)';
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      const rect = el.getBoundingClientRect();
      setHoveredMessage({
        props,
        position: {
          x: rect.left + rect.width / 2,
          y: rect.top
        }
      });
    });

    el.addEventListener('mouseleave', () => {
      if (inner) inner.style.transform = 'scale(1)';
      hoverTimeoutRef.current = setTimeout(() => {
        if (!isHoveringCardRef.current) {
          setHoveredMessage(null);
        }
      }, 150);
    });

    // Click to expand
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (inner) inner.style.transform = 'scale(1)';
      setHoveredMessage(null);
      setExpandedMessage(props);
    });

    return { marker, element: el };
  }, []);

  // Update individual message markers (DOM-based) when zoomed in
  // MapLibre native layers handle clustering at lower zoom levels
  const updateMessageMarkers = useCallback(() => {
    if (!map.current) return;

    const bounds = map.current.getBounds();
    const features = featuresRef.current;
    const zoom = map.current.getZoom();
    const showIndividualMarkers = zoom >= CLUSTER_ZOOM_THRESHOLD;

    console.log(`[MapView] updateMessageMarkers: zoom=${zoom.toFixed(1)}, showMarkers=${showIndividualMarkers}, features=${features.length}`);

    // When zoomed out, MapLibre's native cluster layers handle display
    // We just hide our DOM markers
    if (!showIndividualMarkers) {
      messageMarkersMapRef.current.forEach(({ marker }) => marker.remove());
      messageMarkersMapRef.current.clear();
      console.log(`[MapView] Cluster mode (native layers) - DOM markers hidden`);
      return;
    }

    // Zoomed in: show individual message markers (DOM-based for custom flags)
    // Build set of message_ids that should be visible
    const visibleIds = new Set<number>();
    features.forEach((feature: any) => {
      if (!feature.geometry || feature.geometry.type !== 'Point') return;
      const [lng, lat] = feature.geometry.coordinates;
      if (!bounds.contains([lng, lat])) return;
      const messageId = feature.properties?.message_id;
      if (messageId) visibleIds.add(messageId);
    });

    // Remove markers that are no longer visible
    const toRemove: number[] = [];
    messageMarkersMapRef.current.forEach((entry, messageId) => {
      if (!visibleIds.has(messageId)) {
        entry.marker.remove();
        toRemove.push(messageId);
      }
    });
    toRemove.forEach(id => messageMarkersMapRef.current.delete(id));

    // Add markers for features that don't have one yet
    features.forEach((feature: any) => {
      if (!feature.geometry || feature.geometry.type !== 'Point') return;
      const [lng, lat] = feature.geometry.coordinates;
      if (!bounds.contains([lng, lat])) return;

      const messageId = feature.properties?.message_id;
      if (!messageId || messageMarkersMapRef.current.has(messageId)) return;

      // Create new marker
      const result = createMessageMarker(feature);
      if (result) {
        messageMarkersMapRef.current.set(messageId, { marker: result.marker, feature });
      }
    });

    console.log(`[MapView] Message mode: ${messageMarkersMapRef.current.size} visible, ${toRemove.length} removed`);
  }, [createMessageMarker]);

  // Keep refs updated with latest load functions to avoid stale closures in debouncedLoadData
  // This ensures the debounced callback always calls the latest version that includes
  // current dateRange values
  useEffect(() => {
    loadMessagesRef.current = loadMessages;
    loadClustersRef.current = loadClusters;
  });

  // Listen for theme changes and update map style dynamically
  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      const customEvent = event as CustomEvent<'light' | 'dark'>;
      const newTheme = customEvent.detail;

      if (!map.current) return;

      const mapStyle = newTheme === 'dark'
        ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
        : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

      // Store current map state
      const currentCenter = map.current.getCenter();
      const currentZoom = map.current.getZoom();
      const currentBearing = map.current.getBearing();
      const currentPitch = map.current.getPitch();

      // Get current GeoJSON data before style change
      const messagesSource = map.current.getSource('messages') as GeoJSONSource;
      let currentMessagesData: any = null;
      if (messagesSource && messagesSource._data) {
        currentMessagesData = messagesSource._data;
      }

      // Change the style
      map.current.setStyle(mapStyle);

      // Re-add sources and layers after style loads
      map.current.once('style.load', () => {
        if (!map.current) return;

        // Restore map position
        map.current.setCenter(currentCenter);
        map.current.setZoom(currentZoom);
        map.current.setBearing(currentBearing);
        map.current.setPitch(currentPitch);

        // Re-add messages source WITH native MapLibre clustering
        map.current.addSource('messages', {
          type: 'geojson',
          data: currentMessagesData || { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterMaxZoom: 8,
          clusterRadius: 50,
        });

        // Re-add native cluster layers
        map.current.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'messages',
          filter: ['has', 'point_count'],
          paint: {
            'circle-radius': ['step', ['get', 'point_count'], 18, 10, 22, 50, 28, 100, 34, 500, 40],
            'circle-color': '#6366f1',
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff',
          },
        });

        map.current.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'messages',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-size': 12,
          },
          paint: { 'text-color': '#ffffff' },
        });

        // Re-create DOM flag markers (for zoom >= 9)
        updateMessageMarkers();

        // Reload event cluster markers if they were visible
        if (showClusters) {
          loadClusters();
        }

        console.log(`[MapView] Map style switched to ${newTheme} mode`);
      });
    };

    window.addEventListener('themeChange', handleThemeChange);

    return () => {
      window.removeEventListener('themeChange', handleThemeChange);
    };
  }, [showClusters, updateMessageMarkers]);



  const getStatusColor = (status: ConnectionStatus): string => {
    switch (status) {
      case 'connected':
        return '#10b981'; // green
      case 'connecting':
        return '#f59e0b'; // yellow
      case 'disconnected':
        return '#6b7280'; // gray
      case 'error':
        return '#ef4444'; // red
      case 'failed':
        return '#dc2626'; // dark red
      default:
        return '#6b7280'; // gray
    }
  };

  const getStatusLabel = (status: ConnectionStatus): string => {
    switch (status) {
      case 'connected':
        return 'Live';
      case 'connecting':
        return 'Connecting...';
      case 'disconnected':
        return 'Offline';
      case 'error':
        return 'Error';
      case 'failed':
        return 'Connection Failed';
      default:
        return 'Unknown';
    }
  };

  // Handler for cluster toggle that properly cleans up markers
  const handleShowClustersChange = useCallback((show: boolean) => {
    setShowClusters(show);
    if (show) {
      loadClusters();
    } else {
      clusterMarkersRef.current.forEach(marker => marker.remove());
      clusterMarkersRef.current = [];
    }
  }, []);

  return (
    <div className="flex w-full h-full">
      {/* Map Container */}
      <div className="relative flex-1 h-full">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-base z-10">
            <span className="text-text-secondary">Loading map...</span>
          </div>
        )}
        {error && (
          <div className="absolute top-4 left-4 bg-red-100 text-red-700 px-4 py-2 rounded z-20">
            {error}
          </div>
        )}

        {/* Timeline Slider - positioned at bottom */}
        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-20">
          <TimelineSlider onRangeChange={handleTimelineChange} />
        </div>

        {/* Heat Map Layer Component */}
        <HeatMapLayer
          map={map.current}
          visible={showHeatMap}
          dateRange={dateRange}
          radius={heatMapRadius}
          opacity={heatMapOpacity}
          gridSize={heatMapGridSize}
        />

        {/* Event Layer Component - Cluster expansion with click-to-expand */}
        <EventLayer
          map={map.current}
          visible={showEvents}
          dateRange={dateRange}
        />

        {/* Trajectory Layer - Movement paths (drones, etc.) */}
        <TrajectoryLayer
          map={map.current}
          visible={showTrajectories}
          dateRange={dateRange}
        />

        {/* Vessel Layer - Shadow Fleet vessel tracking */}
        <VesselLayer
          map={map.current}
          visible={showVessels}
        />

        <div ref={mapContainer} className="w-full h-full" />

        {/* Legend */}
        <MapLegend className="absolute bottom-4 left-4 z-10" />

        {/* Hover Card - positioned near the marker */}
        {hoveredMessage && (
          <div
            className="fixed z-30"
            style={{
              left: hoveredMessage.position.x,
              top: hoveredMessage.position.y,
              transform: 'translate(-50%, -100%) translateY(-10px)'
            }}
            onMouseEnter={() => {
              isHoveringCardRef.current = true;
              if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
                hoverTimeoutRef.current = null;
              }
            }}
            onMouseLeave={() => {
              isHoveringCardRef.current = false;
              setHoveredMessage(null);
            }}
          >
            <MapHoverCard
              properties={hoveredMessage.props}
              onExpand={() => {
                isHoveringCardRef.current = false;
                setHoveredMessage(null);
                setExpandedMessage(hoveredMessage.props);
              }}
            />
          </div>
        )}
      </div>

      {/* Sidebar */}
      <MapSidebar
        regionFocus={regionFocus}
        onRegionFocusChange={setRegionFocus}
        showClusters={showClusters}
        onShowClustersChange={handleShowClustersChange}
        showEvents={showEvents}
        onShowEventsChange={setShowEvents}
        showHeatMap={showHeatMap}
        onShowHeatMapChange={setShowHeatMap}
        showTrajectories={showTrajectories}
        onShowTrajectoriesChange={setShowTrajectories}
        showVessels={showVessels}
        onShowVesselsChange={setShowVessels}
        liveUpdatesEnabled={liveUpdatesEnabled}
        onLiveUpdatesChange={setLiveUpdatesEnabled}
        wsStatus={wsStatus}
        wsRetryCount={retryCount}
        wsMaxRetries={maxRetries}
        onWsReconnect={wsConnect}
        heatMapRadius={heatMapRadius}
        onHeatMapRadiusChange={setHeatMapRadius}
        heatMapOpacity={heatMapOpacity}
        onHeatMapOpacityChange={setHeatMapOpacity}
        selectedMessage={expandedMessage}
        onSelectedMessageChange={setExpandedMessage}
        onFlyToLocation={handleFlyToLocation}
      />
    </div>
  );
}
