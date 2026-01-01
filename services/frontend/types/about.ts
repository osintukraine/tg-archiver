// services/frontend-nextjs/types/about.ts

import { LucideIcon } from 'lucide-react';

export type ViewMode = 'pipeline' | 'infrastructure';

export type LayoutMode = 'manual' | 'dagre-tb' | 'dagre-lr' | 'dagre-rl';

export type NodeStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface Badge {
  label: string;
  color: 'green' | 'yellow' | 'red' | 'blue' | 'purple' | 'orange' | 'indigo' | 'gray';
}

export interface NodeData {
  label: string;
  icon: LucideIcon;
  color: string;
  badges?: Badge[];
  status?: NodeStatus;
  description?: string;
  lastUpdate?: string;
  audience?: string;
  audienceDescription?: string;
  layer?: number;
  layerName?: string;
  required?: boolean;        // Required vs optional service
  expandable?: boolean;      // Has detail panel
  onExpand?: () => void;     // Click handler for expandable nodes
  details?: Record<string, string>;  // Detail panel metadata
  service_name?: string;     // Docker service name
  replicas?: number;         // Number of replicas
  type?: string;             // Service type
}

export interface SystemHealth {
  services: ServiceStatus[];
  timestamp: string;
}

export interface ServiceStatus {
  name: string;
  status: NodeStatus;
  uptime_percent?: number;
  metrics?: Record<string, number>;
  error?: string;
}

export interface AnalyticsStats {
  total_messages: number;
  messages_by_topic: Record<string, number>;
  processing_rate?: number;
  total_channels?: number;
}

export interface AboutStats {
  channels: number;
  messages: number;
  messages_formatted: string;
  media_size_bytes: number;
  media_size_formatted: string;
  entities: number;
  spam_blocked: number;
  spam_blocked_formatted: string;
  sanctions_matches: number;
  timestamp: string;
}

// Pipeline metrics types for live architecture diagram
export interface PipelineStage {
  id: string;
  name: string;
  status: NodeStatus;
  throughput: number;
  queue_depth?: number | null;
  latency_ms?: number | null;
  error_rate?: number | null;
  last_activity?: string | null;
  details?: Record<string, unknown>;
}

export interface EnrichmentWorker {
  task: string;
  status: NodeStatus;
  queue_depth: number;
  queue_lag_seconds: number;
  processed_total: number;
  errors_total: number;
  last_cycle_duration_seconds?: number | null;
}

export interface PipelineMetrics {
  timestamp: string;
  pipeline_active: boolean;
  overall_status: NodeStatus;
  stages: PipelineStage[];
  enrichment_workers: EnrichmentWorker[];
  kpi: {
    messages_per_second: number;
    archive_rate: number;
    total_queue_depth: number;
    llm_requests_per_minute: number;
    llm_avg_latency_seconds: number;
    enrichment_lag_seconds: number;
  };
  prometheus_available: boolean;
  cache_ttl_seconds: number;
}

// Service metrics from /api/metrics/services
export interface ServiceMetric {
  name: string;
  display_name: string;
  status: NodeStatus;
  category: 'core' | 'infrastructure' | 'enrichment' | 'monitoring';
  requests_per_second?: number | null;
  latency_ms?: number | null;
  queue_depth?: number | null;
  connections?: number | null;
  memory_mb?: number | null;
  error_rate?: number | null;
  up: boolean;
}

export interface ServicesMetrics {
  timestamp: string;
  total_services: number;
  healthy_count: number;
  degraded_count: number;
  down_count: number;
  services: ServiceMetric[];
  prometheus_available: boolean;
  cached: boolean;
  cache_ttl_seconds: number;
}

// Data quality metrics from /api/admin/stats/quality
export interface DataQualityMetrics {
  messages_with_translation: number;
  messages_needing_translation: number;
  translation_coverage_percent: number;
  messages_with_embedding: number;
  messages_needing_embedding: number;
  embedding_coverage_percent: number;
  messages_classified: number;
  messages_unclassified: number;
  classification_coverage_percent: number;
  media_archived: number;
  media_missing: number;
  media_archive_rate: number;
  messages_with_entities: number;
  entity_coverage_percent: number;
  oldest_unprocessed_message?: string | null;
  enrichment_backlog_size: number;
  timestamp: string;
  cached: boolean;
}

// =============================================================================
// Activity Data Types (for /api/about/activity)
// =============================================================================

export type ActivityStatus = 'active' | 'slow' | 'idle';
export type VolumeTimeframe = '24h' | '7d' | '30d';
export type TopicsTimeframe = '24h' | '7d';
export type VolumeGranularity = 'hour' | 'day';

export interface PulseData {
  messages_last_hour: number;
  messages_today: number;
  channels_active_24h: number;
  status: ActivityStatus;
}

export interface VolumeBucket {
  timestamp: string;
  count: number;
}

export interface VolumeData {
  granularity: VolumeGranularity;
  timeframe: VolumeTimeframe;
  buckets: VolumeBucket[];
  peak: VolumeBucket | null;
  average: number;
  total: number;
}

export interface TopicItem {
  topic: string;
  count: number;
  percent: number;
}

export interface TopicsData {
  timeframe: TopicsTimeframe;
  items: TopicItem[];
  total: number;
}

export interface ChannelActivityItem {
  id: number;
  name: string;
  username: string | null;
  count: number;
}

export interface ChannelsActivityData {
  timeframe: '24h';
  items: ChannelActivityItem[];
  total_active: number;
}

export interface ActivityData {
  pulse: PulseData;
  volume: VolumeData;
  topics: TopicsData;
  channels: ChannelsActivityData;
  timestamp: string;
}
