/**
 * Site-wide constants for SEO, branding, and metadata
 *
 * Centralized here to avoid duplication across pages and components.
 * Used by OpenGraph tags, layout metadata, and anywhere site info is needed.
 */

/** Site name displayed in OpenGraph og:site_name and page titles */
export const SITE_NAME = process.env.NEXT_PUBLIC_PLATFORM_NAME || 'Telegram Archive';

/** Default meta description for SEO */
export const SITE_DESCRIPTION = 'Archive and browse Telegram channels with search, filtering, and media storage';

/** Default base URL used when NEXT_PUBLIC_BASE_URL is not set */
export const DEFAULT_BASE_URL = 'http://localhost:3000';

/**
 * Feature Flags
 *
 * These control optional features that can be enabled/disabled at build time.
 */

/**
 * Enable external RSS news ingestion feature.
 * When true: Shows News page, admin RSS feeds management, and immersive RSS ticker.
 * When false: Hides all external RSS news features (native RSS output still works).
 */
export const RSS_ENABLED = process.env.NEXT_PUBLIC_RSS_ENABLED === 'true';
