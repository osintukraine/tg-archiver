/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker
  output: 'standalone',

  // Base path for subpath deployments (empty for naked domain/subdomain)
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',

  // Image optimization config
  images: {
    remotePatterns: [
      {
        protocol: 'http',
        hostname: 'minio',
        port: '9000',
        pathname: '/osint-media/**',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '9000',
        pathname: '/osint-media/**',
      },
    ],
  },

  // Disable x-powered-by header
  poweredByHeader: false,

  // Rewrites for development: proxy /media/* to API when accessing Next.js directly
  // Production: Caddy handles /media/* routing (this is just fallback for dev)
  async rewrites() {
    // Use internal Docker network URL (api:8000) for server-side rewrites
    // NEXT_PUBLIC_API_URL is browser-accessible (localhost:8000), not for container-to-container
    const internalApiUrl = process.env.INTERNAL_API_URL || 'http://api:8000';

    return [
      {
        // Proxy /media/* to API's internal media redirect endpoint
        // This allows accessing media when hitting Next.js directly (localhost:3000)
        source: '/media/:path*',
        destination: `${internalApiUrl}/api/media/internal/media-redirect/media/:path*`,
      },
    ];
  },
}

module.exports = nextConfig
