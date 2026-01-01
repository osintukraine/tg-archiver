'use client';

import { useEffect, useState } from 'react';
import { Map } from 'maplibre-gl';
import { API_URL } from '../../lib/api';

interface HeatMapLayerProps {
  map: Map | null;
  visible: boolean;
  dateRange: { start: Date | null; end: Date | null };
  radius: number;
  opacity: number;
  gridSize: number;
}

interface HeatmapFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: {
    weight: number;
  };
}

interface HeatmapData {
  type: 'FeatureCollection';
  features: HeatmapFeature[];
}

export default function HeatMapLayer({
  map,
  visible,
  dateRange,
  radius,
  opacity,
  gridSize,
}: HeatMapLayerProps) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!map) return;

    const loadHeatmapData = async () => {
      if (!visible) {
        // Remove heatmap layer and source if hidden
        if (map.getLayer('heatmap-layer')) {
          map.removeLayer('heatmap-layer');
        }
        if (map.getSource('heatmap-source')) {
          map.removeSource('heatmap-source');
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
          grid_size: gridSize.toString(),
        });

        // Add date range filters
        if (dateRange.start) {
          params.append('start_date', dateRange.start.toISOString());
        }
        if (dateRange.end) {
          params.append('end_date', dateRange.end.toISOString());
        }

        const res = await fetch(`${API_URL}/api/map/heatmap?${params}`);
        if (!res.ok) {
          throw new Error('Failed to load heatmap data');
        }

        const data: HeatmapData = await res.json();

        // Remove existing layer and source
        if (map.getLayer('heatmap-layer')) {
          map.removeLayer('heatmap-layer');
        }
        if (map.getSource('heatmap-source')) {
          map.removeSource('heatmap-source');
        }

        // Add source with heatmap data
        map.addSource('heatmap-source', {
          type: 'geojson',
          data: data,
        });

        // Add heatmap layer
        map.addLayer({
          id: 'heatmap-layer',
          type: 'heatmap',
          source: 'heatmap-source',
          paint: {
            // Increase weight as message count increases
            'heatmap-weight': [
              'interpolate',
              ['linear'],
              ['get', 'weight'],
              0, 0,
              10, 0.5,
              50, 1
            ],
            // Increase intensity as zoom level increases
            'heatmap-intensity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              0, 1,
              9, 3
            ],
            // Color gradient from cool (blue) to hot (red)
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0, 'rgba(0,0,255,0)',      // transparent blue at zero density
              0.2, 'rgb(0,255,255)',      // cyan
              0.4, 'rgb(0,255,0)',        // green
              0.6, 'rgb(255,255,0)',      // yellow
              0.8, 'rgb(255,128,0)',      // orange
              1, 'rgb(255,0,0)'           // red at max density
            ],
            // Adjust radius based on zoom level and user setting
            'heatmap-radius': [
              'interpolate',
              ['linear'],
              ['zoom'],
              0, radius * 0.5,
              9, radius
            ],
            // Transition from heatmap to circle layer as zoom increases
            'heatmap-opacity': opacity
          }
        });

        console.log(`[HeatMapLayer] Loaded ${data.features.length} heatmap cells`);
      } catch (e) {
        console.error('Error loading heatmap data:', e);
      } finally {
        setLoading(false);
      }
    };

    loadHeatmapData();

    // Reload heatmap when map moves
    const handleMoveEnd = () => {
      if (visible) {
        loadHeatmapData();
      }
    };

    map.on('moveend', handleMoveEnd);

    return () => {
      map.off('moveend', handleMoveEnd);
    };
  }, [map, visible, dateRange, radius, opacity, gridSize]);

  return null; // This component doesn't render anything itself
}
