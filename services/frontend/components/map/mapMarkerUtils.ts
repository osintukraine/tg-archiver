/**
 * Utilities for creating flag-based map markers with precision indicators.
 */

export type Affiliation = 'ua' | 'ru' | 'unknown';
export type PrecisionLevel = 'high' | 'medium' | 'low';

/**
 * Get flag emoji for channel affiliation
 * Supports both short codes (ua/ru) and full names (ukraine/russia)
 */
export function getAffiliationFlag(affiliation: string | undefined): string {
  const normalized = affiliation?.toLowerCase();
  switch (normalized) {
    case 'ua':
    case 'ukraine':
      return '🇺🇦';
    case 'ru':
    case 'russia':
      return '🇷🇺';
    default:
      return '🏳️';
  }
}

/**
 * Get marker size based on precision level
 */
export function getMarkerSize(precision: PrecisionLevel | string | undefined): number {
  switch (precision) {
    case 'high': return 24;
    case 'medium': return 32;
    case 'low': return 40;
    default: return 32;
  }
}

/**
 * Get marker opacity based on confidence score
 */
export function getMarkerOpacity(confidence: number | undefined): number {
  if (confidence === undefined) return 0.8;
  if (confidence >= 0.9) return 1.0;
  if (confidence >= 0.8) return 0.85;
  if (confidence >= 0.7) return 0.7;
  return 0.6;
}

/**
 * Get halo radius for precision indicator (0 = no halo)
 */
export function getHaloRadius(precision: PrecisionLevel | string | undefined): number {
  switch (precision) {
    case 'high': return 0;
    case 'medium': return 8;
    case 'low': return 16;
    default: return 8;
  }
}

/**
 * Get halo color based on precision level
 */
function getHaloColor(precision: PrecisionLevel | string | undefined): string {
  switch (precision) {
    case 'high': return 'rgba(34, 197, 94, 0.3)';   // green-500 with opacity
    case 'medium': return 'rgba(234, 179, 8, 0.3)'; // yellow-500 with opacity
    case 'low': return 'rgba(239, 68, 68, 0.3)';    // red-500 with opacity
    default: return 'rgba(156, 163, 175, 0.3)';     // gray-400 with opacity
  }
}

/**
 * Create a marker HTML element with flag and precision indicator
 *
 * IMPORTANT: Uses nested structure to avoid conflicts with MapLibre's transform-based positioning.
 * - Outer div (container): MapLibre controls this with translate() for positioning
 * - Halo div: Shows precision uncertainty as colored ring (larger = less precise)
 * - Inner div (flag): We control this with scale() for hover animation
 */
export function createFlagMarkerElement(
  affiliation: string | undefined,
  precision: PrecisionLevel | string | undefined,
  confidence: number | undefined
): HTMLDivElement {
  const flag = getAffiliationFlag(affiliation);
  const size = getMarkerSize(precision);
  const opacity = getMarkerOpacity(confidence);
  const haloRadius = getHaloRadius(precision);
  const haloColor = getHaloColor(precision);

  // Outer container - MapLibre will apply transforms to this for positioning
  // CRITICAL: Keep styling minimal! Extra positioning CSS breaks MapLibre's marker placement.
  const container = document.createElement('div');
  container.className = 'flag-marker';
  container.style.cssText = `
    cursor: pointer;
  `;

  // Inner wrapper - contains both halo and flag, centered
  const wrapper = document.createElement('div');
  wrapper.className = 'flag-marker-wrapper';
  wrapper.style.cssText = `
    position: relative;
    display: inline-block;
  `;

  // Halo element - shows precision uncertainty (only if haloRadius > 0)
  if (haloRadius > 0) {
    const halo = document.createElement('div');
    halo.className = 'flag-marker-halo';
    const haloSize = size + (haloRadius * 2);
    // Center the halo behind the flag
    const haloOffset = -haloRadius;
    halo.style.cssText = `
      position: absolute;
      top: ${haloOffset}px;
      left: ${haloOffset}px;
      width: ${haloSize}px;
      height: ${haloSize}px;
      border-radius: 50%;
      background: ${haloColor};
      pointer-events: none;
    `;
    wrapper.appendChild(halo);
  }

  // Inner element - we control transforms on this for hover effects
  const inner = document.createElement('div');
  inner.className = 'flag-marker-inner';
  inner.style.cssText = `
    font-size: ${size}px;
    line-height: 1;
    opacity: ${opacity};
    text-align: center;
    transition: transform 0.15s ease-out;
    position: relative;
  `;
  inner.textContent = flag;

  wrapper.appendChild(inner);
  container.appendChild(wrapper);

  return container;
}

/**
 * Get CSS class for confidence-based border color
 */
export function getConfidenceBorderClass(precision: PrecisionLevel | string | undefined): string {
  switch (precision) {
    case 'high': return 'border-green-400';
    case 'medium': return 'border-yellow-400';
    case 'low': return 'border-red-400';
    default: return 'border-gray-400';
  }
}

/**
 * Create popup content element using safe DOM methods (no innerHTML)
 */
export function createPopupContent(
  channelName: string,
  channelAffiliation: string | undefined,
  locationName: string,
  contentPreview: string
): HTMLDivElement {
  const container = document.createElement('div');
  container.className = 'text-sm';

  // Header with flag and channel name
  const header = document.createElement('div');
  header.className = 'font-medium';
  const flag = getAffiliationFlag(channelAffiliation);
  header.textContent = `${flag} ${channelName || 'Unknown'}`;
  container.appendChild(header);

  // Location
  const location = document.createElement('div');
  location.className = 'text-gray-500';
  location.textContent = `📍 ${locationName || 'Unknown'}`;
  container.appendChild(location);

  // Content preview
  if (contentPreview) {
    const content = document.createElement('div');
    content.className = 'text-xs text-gray-400 mt-1';
    content.textContent = contentPreview.substring(0, 100) + (contentPreview.length > 100 ? '...' : '');
    container.appendChild(content);
  }

  return container;
}
