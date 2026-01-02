# Next.js Frontend with Bun Runtime
# Multi-stage build for minimal production image

FROM oven/bun:1 AS base

# ========================================
# Dependencies Stage
# ========================================
FROM base AS deps
WORKDIR /app

# Copy package files (paths relative to repo root - see docker-compose.yml context)
COPY services/frontend/package.json services/frontend/bun.lock ./

# Install dependencies (temporarily not using frozen lockfile while updating deps)
RUN bun install

# ========================================
# Builder Stage
# ========================================
FROM base AS builder
WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copy application code (from services/frontend/ to /app/)
COPY services/frontend/ .

# Environment variables for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# CRITICAL: Next.js bakes NEXT_PUBLIC_* vars into bundle at build time
# Must be set here, not just at runtime
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_MINIO_URL=http://localhost:9000/osint-media
ARG NEXT_PUBLIC_BASE_URL=http://localhost:3000
ARG NEXT_PUBLIC_PLATFORM_NAME="tg-archiver"
ARG NEXT_PUBLIC_AUTH_PROVIDER=none
ARG NEXT_PUBLIC_KOFI_USERNAME=""
ARG NEXT_PUBLIC_TRANSLATION_ENABLED=true
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_MINIO_URL=${NEXT_PUBLIC_MINIO_URL}
ENV NEXT_PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL}
ENV NEXT_PUBLIC_PLATFORM_NAME=${NEXT_PUBLIC_PLATFORM_NAME}
ENV NEXT_PUBLIC_AUTH_PROVIDER=${NEXT_PUBLIC_AUTH_PROVIDER}
ENV NEXT_PUBLIC_KOFI_USERNAME=${NEXT_PUBLIC_KOFI_USERNAME}
ENV NEXT_PUBLIC_TRANSLATION_ENABLED=${NEXT_PUBLIC_TRANSLATION_ENABLED}

# Build Next.js application
RUN bun run build

# ========================================
# Production Runner Stage
# ========================================
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Create non-root user for security
# Using groupadd/useradd (standard Linux) instead of addgroup/adduser (Debian-specific)
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Copy standalone build
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Copy public directory (contains static assets like images, fonts, etc.)
# Will be empty if no static assets are used
COPY --from=builder /app/public ./public

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD bun -e "fetch('http://localhost:3000').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start application with Bun
CMD ["bun", "run", "server.js"]
