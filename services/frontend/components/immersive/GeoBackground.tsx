'use client';

interface GeoBackgroundProps {
  latitude: number | null;
  longitude: number | null;
  enabled: boolean;
}

export function GeoBackground({ latitude, longitude, enabled }: GeoBackgroundProps) {
  // Don't render if disabled or no coordinates
  if (!enabled || latitude === null || longitude === null) {
    return null;
  }

  // Use CartoDB dark-matter tiles with a static approach
  // Create a tile URL centered on the location at zoom 10
  const zoom = 10;

  // Calculate tile coordinates from lat/lng
  const n = Math.pow(2, zoom);
  const x = Math.floor((longitude + 180) / 360 * n);
  const latRad = latitude * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);

  // Generate multiple tiles around the center for coverage
  const tiles = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      tiles.push({
        x: x + dx,
        y: y + dy,
        offsetX: (dx + 2) * 256,
        offsetY: (dy + 2) * 256,
      });
    }
  }

  return (
    <div
      className="absolute inset-0 overflow-hidden pointer-events-none"
      style={{ opacity: 0.5, zIndex: 0 }}
    >
      <div
        className="absolute"
        style={{
          // Center the tile grid
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 256 * 5,
          height: 256 * 5,
        }}
      >
        {tiles.map((tile, i) => (
          <img
            key={i}
            src={`https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/${zoom}/${tile.x}/${tile.y}.png`}
            alt=""
            className="absolute"
            style={{
              left: tile.offsetX,
              top: tile.offsetY,
              width: 256,
              height: 256,
            }}
            loading="lazy"
          />
        ))}
      </div>

      {/* Gradient overlay to fade edges */}
      <div className="absolute inset-0 bg-gradient-radial from-transparent via-transparent to-black" />
    </div>
  );
}
