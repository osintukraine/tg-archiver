/**
 * TypeScript types for Social Graph API
 *
 * API endpoints: /api/social-graph/*
 */

// Node types in social network
export type SocialNodeType = 'author' | 'channel' | 'message' | 'forward_source' | 'reply_to';

// Edge types in social network
export type SocialEdgeType = 'authored' | 'forwarded_from' | 'replied_to' | 'mentioned' | 'same_author';

export interface SocialNetworkNode {
  id: string;
  type: SocialNodeType;
  label: string;
  data: {
    // Author-specific data
    author_id?: number;
    author_name?: string;
    message_count?: number;

    // Channel-specific data
    channel_id?: number;
    channel_username?: string;
    channel_name?: string;
    verified?: boolean;

    // Message-specific data
    message_id?: number;
    content_preview?: string;
    created_at?: string;
    views?: number;
    forwards?: number;

    // Common metadata
    [key: string]: any;
  };
}

export interface SocialNetworkEdge {
  id: string;
  source: string;
  target: string;
  type: SocialEdgeType;
  label?: string;
  weight?: number;
  data?: {
    timestamp?: string;
    forward_count?: number;
    [key: string]: any;
  };
}

export interface MessageSocialGraph {
  message_id: number;
  nodes: SocialNetworkNode[];
  edges: SocialNetworkEdge[];
  metadata: {
    total_nodes: number;
    total_edges: number;
    forward_chain_depth: number;
    reply_thread_depth: number;
    unique_authors: number;
    unique_channels: number;
  };
}

// Comment/Reply structures
export interface Comment {
  id: number;
  message_id: number;
  author_id: number | null;
  author_name: string | null;
  channel_id: number | null;
  channel_name: string | null;
  content: string;
  created_at: string;
  reply_to_id: number | null;
  reply_count: number;
  views: number | null;
  forwards: number | null;
  reactions: number | null;
  depth: number;  // Nesting level for threaded display
  replies?: Comment[];  // Nested replies
}

export interface CommentsResponse {
  message_id: number;
  total_comments: number;
  comments: Comment[];
  has_more: boolean;
  next_offset: number | null;
}

// Engagement timeline
export interface EngagementSnapshot {
  timestamp: string;
  views: number | null;
  forwards: number | null;
  reactions: number | null;
  reply_count: number;
  cumulative_views: number | null;
  cumulative_forwards: number | null;
  cumulative_reactions: number | null;
}

export interface EngagementTimeline {
  message_id: number;
  snapshots: EngagementSnapshot[];
  summary: {
    total_views: number | null;
    total_forwards: number | null;
    total_reactions: number | null;
    total_replies: number;
    peak_views_per_hour: number | null;
    peak_timestamp: string | null;
    time_span_hours: number;
  };
}

// API request parameters
export interface SocialGraphParams {
  include_forwards?: boolean;
  include_replies?: boolean;
  max_depth?: number;
}

export interface CommentsParams {
  limit?: number;
  offset?: number;
  sort?: 'asc' | 'desc';
  include_replies?: boolean;
}

export interface EngagementParams {
  granularity?: 'hour' | 'day' | 'week';
  time_range_hours?: number;
}
