'use client';

/**
 * VesselLayer - Renders Shadow Fleet vessel markers on the map.
 *
 * Fetches vessel data from the backend API (which proxies Shadow Fleet)
 * and displays ship markers with color-coding:
 * - Red: Sanctioned vessels (matched to OpenSanctions)
 * - Yellow: Heading to Russian ports
 * - Gray: Regular tracked vessels
 */

import { useEffect, useRef, useCallback } from 'react';
import { Map as MapLibreMap, Marker, Popup } from 'maplibre-gl';
import { fetchVessels } from '../../lib/api/vessels';
import { VESSEL_COLORS, type VesselFeature, type VesselProperties } from '../../lib/types/vessel';

interface VesselLayerProps {
  map: MapLibreMap | null;
  visible: boolean;
}

/**
 * Creates a ship marker SVG element using safe DOM methods.
 * No innerHTML used to avoid XSS vulnerabilities.
 */
function createShipMarkerElement(status: VesselProperties['status']): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'vessel-marker';
  container.style.cssText = `
    width: 24px;
    height: 24px;
    cursor: pointer;
    transition: transform 0.15s ease-out;
  `;

  // Create SVG element using createElementNS (safe DOM method)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');

  // Ship hull path
  const hullPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hullPath.setAttribute('d', 'M3 17h18l-2 4H5l-2-4z');
  hullPath.setAttribute('fill', VESSEL_COLORS[status]);
  hullPath.setAttribute('stroke', 'white');
  hullPath.setAttribute('stroke-width', '1.5');

  // Ship cabin path
  const cabinPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  cabinPath.setAttribute('d', 'M6 17V11h12v6');
  cabinPath.setAttribute('fill', VESSEL_COLORS[status]);
  cabinPath.setAttribute('stroke', 'white');
  cabinPath.setAttribute('stroke-width', '1.5');

  // Ship mast path
  const mastPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  mastPath.setAttribute('d', 'M12 11V4M9 7h6');
  mastPath.setAttribute('stroke', 'white');
  mastPath.setAttribute('stroke-width', '1.5');
  mastPath.setAttribute('stroke-linecap', 'round');

  // Assemble SVG
  svg.appendChild(hullPath);
  svg.appendChild(cabinPath);
  svg.appendChild(mastPath);
  container.appendChild(svg);

  // Add drop shadow for depth
  container.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))';

  return container;
}

/**
 * Formats the last seen time as a relative string.
 */
function formatLastSeen(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Creates popup HTML content for a vessel.
 * Uses text escaping to prevent XSS.
 */
function createPopupContent(props: VesselProperties): string {
  const escapeHtml = (str: string | null): string => {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const statusLabel = {
    sanctioned: 'Sanctioned',
    ru_destination: 'RU Destination',
    regular: 'Tracked',
  }[props.status];

  const statusColor = VESSEL_COLORS[props.status];

  let html = `
    <div style="max-width: 300px; font-family: system-ui, sans-serif;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
        <strong style="font-size: 14px;">${escapeHtml(props.name)}</strong>
        <span style="background: ${statusColor}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">
          ${statusLabel}
        </span>
      </div>

      <div style="font-size: 12px; color: #666; margin-bottom: 8px;">
        <div><strong>IMO:</strong> ${props.imo}</div>
        <div><strong>MMSI:</strong> ${props.mmsi}</div>
        ${props.call_signal ? `<div><strong>Call Sign:</strong> ${escapeHtml(props.call_signal)}</div>` : ''}
        ${props.destination ? `<div><strong>Destination:</strong> ${escapeHtml(props.destination)}</div>` : ''}
      </div>
  `;

  // Sanctions info
  if (props.status === 'sanctioned' && props.sanctions_programs) {
    html += `
      <div style="background: #fee2e2; border: 1px solid #fca5a5; padding: 6px 8px; border-radius: 4px; margin-bottom: 8px;">
        <div style="font-size: 11px; font-weight: 600; color: #991b1b;">⚠️ Sanctions Programs:</div>
        <div style="font-size: 11px; color: #b91c1c;">${props.sanctions_programs.map(escapeHtml).join(', ')}</div>
      </div>
    `;
  }

  // Owner info
  if (props.owner) {
    html += `
      <div style="font-size: 11px; color: #666; padding-top: 6px; border-top: 1px solid #eee;">
        <div><strong>Owner:</strong> ${escapeHtml(props.owner.name)}</div>
        ${props.owner.parent_entity ? `<div><strong>Parent:</strong> ${escapeHtml(props.owner.parent_entity)}</div>` : ''}
      </div>
    `;
  }

  // Last seen
  html += `
    <div style="font-size: 10px; color: #999; margin-top: 8px;">
      Last seen: ${formatLastSeen(props.last_seen)}
    </div>
  </div>
  `;

  return html;
}

export default function VesselLayer({ map, visible }: VesselLayerProps) {
  const markersRef = useRef<Map<number, Marker>>(new Map());

  // Clear all markers
  const clearMarkers = useCallback(() => {
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current.clear();
  }, []);

  // Load vessels within current bounds
  const loadVessels = useCallback(async () => {
    if (!map || !visible) {
      clearMarkers();
      return;
    }

    const bounds = map.getBounds();

    try {
      const data = await fetchVessels({
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
      });

      // Build set of visible MMSIs
      const visibleMmsis = new Set(
        data.features.map((f: VesselFeature) => f.properties.mmsi)
      );

      // Remove markers that are no longer in view
      markersRef.current.forEach((marker, mmsi) => {
        if (!visibleMmsis.has(mmsi)) {
          marker.remove();
          markersRef.current.delete(mmsi);
        }
      });

      // Add/update markers for visible vessels
      data.features.forEach((feature: VesselFeature) => {
        const [lng, lat] = feature.geometry.coordinates;
        const props = feature.properties;
        const mmsi = props.mmsi;

        // Skip if marker already exists at this location
        if (markersRef.current.has(mmsi)) {
          // Update position if vessel moved
          const existingMarker = markersRef.current.get(mmsi)!;
          existingMarker.setLngLat([lng, lat]);
          return;
        }

        // Create marker element
        const el = createShipMarkerElement(props.status);

        // Hover effects
        el.addEventListener('mouseenter', () => {
          el.style.transform = 'scale(1.3)';
        });
        el.addEventListener('mouseleave', () => {
          el.style.transform = 'scale(1)';
        });

        // Create popup
        const popup = new Popup({
          offset: 15,
          closeButton: true,
          maxWidth: '320px',
        }).setHTML(createPopupContent(props));

        // Create and add marker
        const marker = new Marker({ element: el, anchor: 'center' })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(map);

        markersRef.current.set(mmsi, marker);
      });

      console.log(`[VesselLayer] Loaded ${data.features.length} vessels`);
    } catch (error) {
      console.error('[VesselLayer] Failed to load vessels:', error);
    }
  }, [map, visible, clearMarkers]);

  // Load vessels on mount and visibility change
  useEffect(() => {
    if (!map) return;

    if (visible) {
      loadVessels();
    } else {
      clearMarkers();
    }
  }, [map, visible, loadVessels, clearMarkers]);

  // Reload on map movement
  useEffect(() => {
    if (!map || !visible) return;

    const handleMoveEnd = () => {
      loadVessels();
    };

    map.on('moveend', handleMoveEnd);

    return () => {
      map.off('moveend', handleMoveEnd);
    };
  }, [map, visible, loadVessels]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearMarkers();
    };
  }, [clearMarkers]);

  // This component doesn't render anything itself - it adds markers imperatively
  return null;
}
