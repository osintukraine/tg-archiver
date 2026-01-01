import { useQuery } from '@tanstack/react-query';
import { SystemHealth, AboutStats, PipelineMetrics, ServicesMetrics, DataQualityMetrics } from '@/types/about';
import { API_URL as API_BASE } from '../lib/api';

// Default services metrics when Prometheus unavailable
const DEFAULT_SERVICES_METRICS: ServicesMetrics = {
  timestamp: new Date().toISOString(),
  total_services: 0,
  healthy_count: 0,
  degraded_count: 0,
  down_count: 0,
  services: [],
  prometheus_available: false,
  cached: false,
  cache_ttl_seconds: 15,
};

// Default data quality metrics
const DEFAULT_QUALITY_METRICS: DataQualityMetrics = {
  messages_with_translation: 0,
  messages_needing_translation: 0,
  translation_coverage_percent: 0,
  messages_with_embedding: 0,
  messages_needing_embedding: 0,
  embedding_coverage_percent: 0,
  messages_classified: 0,
  messages_unclassified: 0,
  classification_coverage_percent: 0,
  media_archived: 0,
  media_missing: 0,
  media_archive_rate: 0,
  messages_with_entities: 0,
  entity_coverage_percent: 0,
  enrichment_backlog_size: 0,
  timestamp: new Date().toISOString(),
  cached: false,
};

// Default pipeline metrics when Prometheus unavailable
const DEFAULT_PIPELINE_METRICS: PipelineMetrics = {
  timestamp: new Date().toISOString(),
  pipeline_active: false,
  overall_status: 'unknown',
  stages: [],
  enrichment_workers: [],
  kpi: {
    messages_per_second: 0,
    archive_rate: 0,
    total_queue_depth: 0,
    llm_requests_per_minute: 0,
    llm_avg_latency_seconds: 0,
    enrichment_lag_seconds: 0,
  },
  prometheus_available: false,
  cache_ttl_seconds: 15,
};

// Default about stats
const DEFAULT_ABOUT_STATS: AboutStats = {
  channels: 0,
  messages: 0,
  messages_formatted: '0',
  media_size_bytes: 0,
  media_size_formatted: '0 B',
  entities: 0,
  spam_blocked: 0,
  spam_blocked_formatted: '0',
  sanctions_matches: 0,
  timestamp: new Date().toISOString(),
};

export const useAboutPageData = () => {
  // Tier 1: System health - fast operational metrics (10s polling)
  // staleTime = refetchInterval to prevent window focus refetches
  const systemHealth = useQuery<SystemHealth>({
    queryKey: ['system', 'health'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/api/system/health`);
        if (!res.ok) throw new Error('Failed to fetch system health');
        return res.json();
      } catch (error) {
        console.error('System health fetch error:', error);
        throw error;
      }
    },
    refetchInterval: 10000,  // 10 seconds
    staleTime: 10000,        // Match refetchInterval
    gcTime: 30000,           // Keep in cache 30s after unmount
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  // Tier 2: Platform stats - analytical data (60s polling)
  const aboutStats = useQuery<AboutStats>({
    queryKey: ['about', 'stats'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/api/about/stats`);
        if (!res.ok) return DEFAULT_ABOUT_STATS;
        return res.json();
      } catch {
        return DEFAULT_ABOUT_STATS;
      }
    },
    refetchInterval: 60000,  // 60 seconds
    staleTime: 60000,        // Match refetchInterval
    gcTime: 120000,          // Keep 2 minutes after unmount
    retry: 2,
  });

  // Tier 1: Pipeline metrics - Prometheus-backed (15s polling)
  const pipelineMetrics = useQuery<PipelineMetrics>({
    queryKey: ['metrics', 'pipeline'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/api/metrics/pipeline`);
        if (!res.ok) return DEFAULT_PIPELINE_METRICS;
        return res.json();
      } catch {
        return DEFAULT_PIPELINE_METRICS;
      }
    },
    refetchInterval: 15000,  // 15 seconds (matches Prometheus scrape)
    staleTime: 15000,        // Match refetchInterval
    gcTime: 30000,
    retry: 1,
    retryDelay: 1000,
  });

  // Tier 1: Services metrics - Prometheus-backed (15s polling)
  const servicesMetrics = useQuery<ServicesMetrics>({
    queryKey: ['metrics', 'services'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/api/metrics/services`);
        if (!res.ok) return DEFAULT_SERVICES_METRICS;
        return res.json();
      } catch {
        return DEFAULT_SERVICES_METRICS;
      }
    },
    refetchInterval: 15000,  // 15 seconds
    staleTime: 15000,        // Match refetchInterval
    gcTime: 30000,
    retry: 1,
    retryDelay: 1000,
  });

  // Tier 2: Data quality metrics - slower changing (60s polling)
  const qualityMetrics = useQuery<DataQualityMetrics>({
    queryKey: ['admin', 'stats', 'quality'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/api/admin/stats/quality`);
        if (!res.ok) return DEFAULT_QUALITY_METRICS;
        return res.json();
      } catch {
        return DEFAULT_QUALITY_METRICS;
      }
    },
    refetchInterval: 60000,  // 60 seconds
    staleTime: 60000,        // Match refetchInterval
    gcTime: 120000,
    retry: 1,
  });

  return {
    systemHealth: systemHealth.data,
    aboutStats: aboutStats.data,
    pipelineMetrics: pipelineMetrics.data,
    servicesMetrics: servicesMetrics.data,
    qualityMetrics: qualityMetrics.data,
    isLoading: systemHealth.isLoading || aboutStats.isLoading,
    isPipelineLoading: pipelineMetrics.isLoading,
    isServicesLoading: servicesMetrics.isLoading,
    isQualityLoading: qualityMetrics.isLoading,
    error: systemHealth.error || aboutStats.error,
    pipelineError: pipelineMetrics.error,
  };
};
