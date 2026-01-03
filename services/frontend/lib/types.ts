/**
 * TypeScript types for tg-archiver API
 *
 * Source: FastAPI OpenAPI schema at http://localhost:8000/docs
 */

export interface ChannelCategory {
  id: number;
  name: string;
  color: string;
  description?: string;
  channel_count?: number;
}

export interface MessageTopic {
  id: number;
  name: string;
  label: string;
  color: string;
  description?: string;
  message_count?: number;
}

export interface TelegramFolder {
  name: string;
  channel_count: number;
}

export interface Channel {
  id: number;
  telegram_id: number;
  username: string | null;
  name: string | null;
  description: string | null;
  folder: string | null;
  rule: string | null;
  active: boolean;
  verified: boolean;
  scam: boolean;
  fake: boolean;
  restricted: boolean;
  category: ChannelCategory | null;
}

/**
 * Structured media item for proper HTML5 element rendering
 */
export interface MediaItem {
  url: string;           // S3 key for the media file
  mime_type: string;     // MIME type (e.g., "video/mp4", "image/jpeg", "audio/mpeg")
  media_type: 'image' | 'video' | 'audio' | 'document';  // Semantic category for HTML element selection
}

export interface Message {
  id: number;
  message_id: number;
  channel_id: number;
  content: string;
  telegram_date: string | null;

  // Translation
  language_detected: string | null;
  content_translated: string | null;
  translation_target: string | null;
  translation_provider: string | null;
  translation_timestamp: string | null;
  translation_cost_usd: number | null;

  // Media
  media_type: string | null;
  media_url_telegram: string | null;
  media_urls: string[];  // DEPRECATED: Use media_items instead
  media_items: MediaItem[];  // Structured media with mime_type for proper HTML5 rendering
  first_media_url: string | null;
  media_was_available: boolean | null;
  media_expired_at: string | null;

  // Classification
  topic: string | null;

  // Extracted entities (hashtags, mentions, URLs)
  entities?: Record<string, string[]> | null;

  // Engagement metrics from Telegram
  views: number | null;
  forwards: number | null;

  // Social graph metadata
  author_user_id: number | null;
  replied_to_message_id: number | null;
  forward_from_channel_id: number | null;
  forward_from_message_id: number | null;
  forward_date: string | null;

  // Comments/Discussion
  has_comments: boolean;
  comments_count: number;
  linked_chat_id: number | null;

  // Selective archival
  archive_triggered_by: number | null;
  archive_triggered_at: string | null;
  archive_priority: number | null;

  // AI-generated tags (from semantic API)
  tags?: MessageTag[];

  // Metadata
  is_backfilled: boolean;
  grouped_id: number | null;
  created_at: string;
  updated_at: string;

  // Message Authenticity Hashing (Phase 3)
  content_hash: string | null;
  metadata_hash: string | null;
  hash_algorithm: string | null;
  hash_generated_at: string | null;
  hash_version: number | null;

  // Relations (optional)
  channel?: Channel;

  // Geolocation (from message_locations table)
  location?: MessageLocation | null;
}

/**
 * Geocoded location for a message
 */
export interface MessageLocation {
  id: number;
  message_id: number;
  location_name: string | null;
  latitude: number;
  longitude: number;
  extraction_method: 'gazetteer' | 'llm_relative' | 'nominatim' | 'manual' | null;
  confidence: number | null;  // 0.0-1.0
  gazetteer_id: number | null;
  raw_location_text: string | null;
  created_at: string;
}

export interface MessageTag {
  id: number;
  message_id: number;
  tag: string;
  tag_type: 'keywords' | 'topics' | 'entities' | 'emotions' | 'urgency';
  confidence: number;
  generated_by: string;
  created_at: string;
}

export interface SearchResult {
  items: Message[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;  // API returns total_pages, not pages
  has_next: boolean;
  has_prev: boolean;
}

export interface SearchParams {
  q?: string;
  channel_id?: number;
  channel_username?: string;
  channel_folder?: string;  // Filter by folder pattern
  category_id?: number;  // Filter by channel category
  // Content filters
  language?: string;  // Detected language code (e.g., 'uk', 'ru', 'en')
  has_comments?: boolean;  // Messages with discussion threads
  topic?: string;  // Message topic classification
  has_media?: boolean;
  media_type?: string;
  // Engagement filters
  min_views?: number;  // Minimum view count
  min_forwards?: number;  // Minimum forward count
  // Date filters
  date_from?: string;
  date_to?: string;
  days?: number;
  // Pagination & sorting
  page?: number;
  page_size?: number;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
}

export interface AdjacentMessages {
  current_id: number;
  prev_id: number | null;
  next_id: number | null;
}

export type DensityMode = 'compact' | 'detailed' | 'immersive';

export interface PostCardProps {
  message: Message;
  channel?: Channel;
  density?: DensityMode;
  onDensityChange?: (density: DensityMode) => void;
  onClick?: () => void;
}
