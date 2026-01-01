'use client';

import { useEffect, useState } from 'react';
import { Map as MapLibreMap, Popup } from 'maplibre-gl';
import { API_URL } from '../../lib/api';

interface TrajectoryLayerProps {
  map: MapLibreMap | null;
  visible: boolean;
  dateRange: { start: Date | null; end: Date | null };
}

interface TrajectoryFeature {
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: Array<[number, number]>;
  };
  properties: {
    message_id: number;
    origin: string;
    destination: string;
    location_count: number;
    content: string;
    telegram_date?: string;
    channel_name: string;
    channel_folder?: string;
    channel_affiliation?: string;
  };
}

interface TrajectoryData {
  type: 'FeatureCollection';
  features: TrajectoryFeature[];
}

// Color by channel affiliation
const AFFILIATION_COLORS: Record<string, string> = {
  ukraine: '#0057b7',    // Ukrainian blue
  russia: '#cc0000',     // Red
  neutral: '#666666',    // Gray
  unknown: '#888888',
};

export default function TrajectoryLayer({
  map,
  visible,
  dateRange,
}: TrajectoryLayerProps) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!map) return;

    const loadTrajectories = async () => {
      if (!visible) {
        // Remove trajectory layers and source if hidden
        if (map.getLayer('trajectory-arrows')) {
          map.removeLayer('trajectory-arrows');
        }
        if (map.getLayer('trajectory-lines')) {
          map.removeLayer('trajectory-lines');
        }
        if (map.getSource('trajectories')) {
          map.removeSource('trajectories');
        }
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

        const res = await fetch(`${API_URL}/api/map/trajectories?${params}`);
        if (!res.ok) {
          throw new Error('Failed to load trajectories');
        }

        const data: TrajectoryData = await res.json();

        // Remove existing layers and source
        if (map.getLayer('trajectory-arrows')) {
          map.removeLayer('trajectory-arrows');
        }
        if (map.getLayer('trajectory-lines')) {
          map.removeLayer('trajectory-lines');
        }
        if (map.getSource('trajectories')) {
          map.removeSource('trajectories');
        }

        // Add color to each feature based on affiliation
        const coloredFeatures = data.features.map(feature => ({
          ...feature,
          properties: {
            ...feature.properties,
            color: AFFILIATION_COLORS[feature.properties.channel_affiliation || 'unknown'] || AFFILIATION_COLORS.unknown,
          },
        }));

        // Add source with trajectory data
        map.addSource('trajectories', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: coloredFeatures,
          },
        });

        // Add dashed line layer for trajectories
        map.addLayer({
          id: 'trajectory-lines',
          type: 'line',
          source: 'trajectories',
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 3,
            'line-opacity': 0.8,
            'line-dasharray': [2, 2], // Dashed line
          },
        });

        // Add arrow markers at destination (using symbol layer with triangles)
        // Note: For proper arrows, we'd need to add a custom sprite
        // For now, we'll use circle markers at endpoints
        map.addLayer({
          id: 'trajectory-arrows',
          type: 'circle',
          source: 'trajectories',
          paint: {
            'circle-radius': 6,
            'circle-color': ['get', 'color'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
          // Only show at line endpoints (we'll handle this via GeoJSON)
        });

        // Add popup on click
        map.on('click', 'trajectory-lines', (e) => {
          if (!e.features || e.features.length === 0) return;

          const feature = e.features[0];
          const props = feature.properties;

          const popup = new Popup({ offset: 10 })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="max-width: 300px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <strong style="font-size: 14px;">Trajectory</strong>
                  <span style="background: ${props.color}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px;">
                    ${props.channel_affiliation || 'unknown'}
                  </span>
                </div>
                <p style="margin: 4px 0; font-size: 13px;">
                  <strong>${props.origin}</strong> → <strong>${props.destination}</strong>
                </p>
                <p style="margin: 4px 0; font-size: 11px; color: #666;">
                  ${props.location_count} locations • ${props.channel_name}
                </p>
                <p style="margin: 8px 0; font-size: 11px; color: #444; line-height: 1.4;">
                  ${props.content?.substring(0, 150)}${props.content?.length > 150 ? '...' : ''}
                </p>
                ${props.telegram_date ? `<p style="font-size: 10px; color: #999;">${new Date(props.telegram_date).toLocaleString()}</p>` : ''}
                <a href="/messages/${props.message_id}" target="_blank" style="color: #0066cc; font-size: 11px;">View message →</a>
              </div>
            `)
            .addTo(map);
        });

        // Change cursor on hover
        map.on('mouseenter', 'trajectory-lines', () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', 'trajectory-lines', () => {
          map.getCanvas().style.cursor = '';
        });

        console.log(`[TrajectoryLayer] Loaded ${data.features.length} trajectories`);
      } catch (e) {
        console.error('Error loading trajectories:', e);
      } finally {
        setLoading(false);
      }
    };

    loadTrajectories();

    // Reload trajectories when map moves
    const handleMoveEnd = () => {
      if (visible) {
        loadTrajectories();
      }
    };

    map.on('moveend', handleMoveEnd);

    return () => {
      map.off('moveend', handleMoveEnd);
      // Layer-specific event listeners (click, mouseenter, mouseleave) are
      // automatically cleaned up when the layer is removed via removeLayer()
      // We don't need to manually remove them here
    };
  }, [map, visible, dateRange]);

  return null; // This component doesn't render anything itself
}
