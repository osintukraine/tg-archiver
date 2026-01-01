'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl, { Map, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import Link from 'next/link';

interface InlineMapProps {
  latitude: number;
  longitude: number;
  locationName?: string;
  zoom?: number;
}

/**
 * InlineMap - Small map preview for message detail pages
 *
 * Shows a single location marker with minimal interaction.
 * Provides "View on full map" link to the main /map page.
 */
export default function InlineMap({
  latitude,
  longitude,
  locationName,
  zoom = 10,
}: InlineMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    try {
      // Initialize map centered on the location
      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '&copy; OpenStreetMap contributors',
            },
          },
          layers: [
            {
              id: 'osm',
              type: 'raster',
              source: 'osm',
            },
          ],
        },
        center: [longitude, latitude],
        zoom: zoom,
        interactive: true, // Allow panning/zooming
        attributionControl: false, // Hide attribution to save space
      });

      // Add marker at the location
      const markerEl = document.createElement('div');
      markerEl.className = 'inline-map-marker';
      markerEl.style.cssText = `
        width: 24px;
        height: 24px;
        background: #ef4444;
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        cursor: pointer;
      `;

      new Marker({ element: markerEl })
        .setLngLat([longitude, latitude])
        .addTo(map.current);

      map.current.on('load', () => {
        setLoading(false);
      });

      map.current.on('error', (e) => {
        console.error('Map error:', e);
        setError('Failed to load map');
        setLoading(false);
      });

      return () => {
        map.current?.remove();
        map.current = null;
      };
    } catch (e) {
      console.error('Error initializing map:', e);
      setError('Failed to initialize map');
      setLoading(false);
    }
  }, [latitude, longitude, zoom]);

  if (error) {
    return (
      <div className="w-full h-48 bg-gray-100 rounded-lg flex items-center justify-center text-gray-500">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-2">
      {/* Map container */}
      <div className="relative w-full h-48 rounded-lg overflow-hidden border border-gray-200">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
            <span className="text-sm text-gray-500">Loading map...</span>
          </div>
        )}
        <div ref={mapContainer} className="w-full h-full" />
      </div>

      {/* Location info and link */}
      <div className="flex items-center justify-between text-sm">
        <div>
          {locationName && (
            <p className="font-medium text-gray-900">{locationName}</p>
          )}
          <p className="text-gray-500 text-xs">
            {latitude.toFixed(4)}, {longitude.toFixed(4)}
          </p>
        </div>
        <Link
          href={`/map?lat=${latitude}&lng=${longitude}&zoom=12`}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          View on full map
        </Link>
      </div>
    </div>
  );
}
