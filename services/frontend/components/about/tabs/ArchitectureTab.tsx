// services/frontend-nextjs/components/about/tabs/ArchitectureTab.tsx

'use client';

import { useState, useEffect } from 'react';
import { ViewMode, SystemHealth, AboutStats, PipelineMetrics, ServicesMetrics, DataQualityMetrics } from '@/types/about';
import ViewToggle from '../ViewToggle';
import Legend from '../Legend';
import ArchitectureDiagramWithSwimlanes from '../ArchitectureDiagramWithSwimlanes';
import StatsPanel from '../StatsPanel';
import {
  statusColors,
  getPercentageColor,
  getPercentageBgColor,
  getBacklogStatusColor,
  getBacklogStatusBgColor,
} from '@/lib/theme';

interface ArchitectureTabProps {
  systemHealth?: SystemHealth | null;
  aboutStats?: AboutStats | null;
  pipelineMetrics?: PipelineMetrics | null;
  servicesMetrics?: ServicesMetrics | null;
  qualityMetrics?: DataQualityMetrics | null;
  isLoading: boolean;
  error?: Error | null;
}

export default function ArchitectureTab({
  systemHealth,
  aboutStats,
  pipelineMetrics,
  servicesMetrics,
  qualityMetrics,
  isLoading,
  error,
}: ArchitectureTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('pipeline');

  // Keyboard navigation for view mode
  useEffect(() => {
    const handleKeyPress = (e: globalThis.KeyboardEvent) => {
      // Toggle view with 'v' key
      if (e.key === 'v' || e.key === 'V') {
        setViewMode(current => current === 'pipeline' ? 'infrastructure' : 'pipeline');
      }

      // Toggle with arrow keys
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        setViewMode(current => current === 'pipeline' ? 'infrastructure' : 'pipeline');
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Info Banner */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <p className="text-sm text-blue-800 dark:text-blue-300">
          💡 <strong>Tip:</strong> Hover over nodes to see service descriptions. Click expandable services (with chevron icon) for detailed information.
          Press <kbd className="px-2 py-1 bg-blue-100 dark:bg-blue-800 rounded text-xs">V</kbd> or{' '}
          <kbd className="px-2 py-1 bg-blue-100 dark:bg-blue-800 rounded text-xs">← →</kbd> to toggle views.
        </p>
      </div>

      {error && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
          <p className="text-sm text-yellow-800 dark:text-yellow-300">
            ⚠️ Live data unavailable - showing static architecture
          </p>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <ViewToggle viewMode={viewMode} onToggle={setViewMode} />
        <Legend />
      </div>

      {/* Live KPIs (when Prometheus available) */}
      {pipelineMetrics?.prometheus_available && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
            <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              {pipelineMetrics.kpi.messages_per_second.toFixed(1)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">msg/sec</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {pipelineMetrics.kpi.archive_rate.toFixed(1)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">archived/sec</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
            <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">
              {pipelineMetrics.kpi.total_queue_depth}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">queue depth</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {pipelineMetrics.kpi.llm_requests_per_minute.toFixed(0)}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">LLM req/min</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
              {pipelineMetrics.kpi.llm_avg_latency_seconds.toFixed(1)}s
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">LLM latency</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 text-center">
            <div className={`text-2xl font-bold ${
              pipelineMetrics.kpi.enrichment_lag_seconds > 300
                ? 'text-red-600 dark:text-red-400'
                : 'text-cyan-600 dark:text-cyan-400'
            }`}>
              {pipelineMetrics.kpi.enrichment_lag_seconds.toFixed(0)}s
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">enrich lag</div>
          </div>
        </div>
      )}

      {/* Services Health Summary (when available) */}
      {servicesMetrics?.prometheus_available && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Service Health</h3>
            <span className="text-xs text-gray-500">
              {servicesMetrics.total_services} services monitored
            </span>
          </div>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${statusColors.healthyBg}`} />
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {servicesMetrics.healthy_count} healthy
              </span>
            </div>
            {servicesMetrics.degraded_count > 0 && (
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${statusColors.degradedBg}`} />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {servicesMetrics.degraded_count} degraded
                </span>
              </div>
            )}
            {servicesMetrics.down_count > 0 && (
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${statusColors.downBg}`} />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {servicesMetrics.down_count} down
                </span>
              </div>
            )}
          </div>
          {/* Service categories breakdown */}
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              {['core', 'infrastructure', 'enrichment', 'monitoring'].map(category => {
                const services = servicesMetrics.services.filter(s => s.category === category);
                const healthyCount = services.filter(s => s.status === 'healthy').length;
                // Calculate health percentage for color
                const healthPercent = services.length > 0 ? (healthyCount / services.length) * 100 : 0;
                return (
                  <div key={category} className="flex items-center justify-between">
                    <span className="text-gray-500 dark:text-gray-400 capitalize">{category}</span>
                    <span className={`font-medium ${getPercentageColor(healthPercent, { good: 100, warn: 50 })}`}>
                      {healthyCount}/{services.length}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Data Quality Panel */}
      {qualityMetrics && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Data Quality Coverage
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {/* Translation */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">Translation</span>
                <span className="text-xs font-medium text-green-600 dark:text-green-400">
                  {qualityMetrics.translation_coverage_percent}%
                </span>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full"
                  style={{ width: `${qualityMetrics.translation_coverage_percent}%` }}
                />
              </div>
            </div>
            {/* Embeddings */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">Embeddings</span>
                <span className={`text-xs font-medium ${getPercentageColor(qualityMetrics.embedding_coverage_percent)}`}>
                  {qualityMetrics.embedding_coverage_percent}%
                </span>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${getPercentageBgColor(qualityMetrics.embedding_coverage_percent)}`}
                  style={{ width: `${qualityMetrics.embedding_coverage_percent}%` }}
                />
              </div>
            </div>
            {/* Classification */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">Classification</span>
                <span className="text-xs font-medium text-green-600 dark:text-green-400">
                  {qualityMetrics.classification_coverage_percent}%
                </span>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full"
                  style={{ width: `${qualityMetrics.classification_coverage_percent}%` }}
                />
              </div>
            </div>
            {/* Media Archive */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">Media Archive</span>
                <span className={`text-xs font-medium ${getPercentageColor(qualityMetrics.media_archive_rate)}`}>
                  {qualityMetrics.media_archive_rate}%
                </span>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${getPercentageBgColor(qualityMetrics.media_archive_rate)}`}
                  style={{ width: `${qualityMetrics.media_archive_rate}%` }}
                />
              </div>
            </div>
            {/* Enrichment Backlog */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500 dark:text-gray-400">Backlog</span>
                <span className={`text-xs font-medium ${getBacklogStatusColor(qualityMetrics.enrichment_backlog_size)}`}>
                  {qualityMetrics.enrichment_backlog_size} msgs
                </span>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${getBacklogStatusBgColor(qualityMetrics.enrichment_backlog_size)}`}
                  style={{ width: `${Math.min(100, (1 - qualityMetrics.enrichment_backlog_size / 1000) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Diagram with Swimlane Groups */}
      <ArchitectureDiagramWithSwimlanes
        viewMode={viewMode}
        systemHealth={systemHealth}
        aboutStats={aboutStats}
        pipelineMetrics={pipelineMetrics}
        showSwimlanes={true}
      />

      {/* Stats Panel */}
      <StatsPanel
        systemHealth={systemHealth}
        aboutStats={aboutStats}
        isLoading={isLoading}
      />

      {/* Description */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        {viewMode === 'pipeline' ? (
          <>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
              Processing Pipeline
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              Messages flow from Telegram sources through the listener service into a
              Redis queue. Processor workers pull messages and run them through
              enrichment stages: spam filtering (95% accuracy), entity extraction,
              and media archiving with SHA-256 deduplication. Enrichment workers handle
              AI tagging, translation, and semantic embeddings.
            </p>
            <p className="text-gray-600 dark:text-gray-400">
              Enriched messages are stored in PostgreSQL with pgvector for semantic
              search. The API layer exposes REST endpoints with 15+ search filters, and
              dynamic RSS feeds allow subscribing to any search query.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-3">
              Infrastructure Stack
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              The platform runs 11 containerized services: PostgreSQL and Redis form the
              data backbone, with MinIO for object storage and Ollama for self-hosted
              LLMs. Active services include the listener (Telethon), processor workers
              (enrichment pipeline), API (FastAPI), and frontend (Next.js 14).
            </p>
            <p className="text-gray-600 dark:text-gray-400">
              Monitoring is handled by Prometheus for metrics collection and Grafana for
              visualization. All services are self-hosted with no external API
              dependencies, ensuring complete data sovereignty.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
