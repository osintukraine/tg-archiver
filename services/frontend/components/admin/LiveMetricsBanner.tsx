/** Live pipeline numbers from GET /api/metrics/overview (Prometheus). */
export interface LiveMetrics {
  pipeline_active: boolean;
  messages_per_second: number;
  messages_archived_per_second: number;
  queue_depth: number;
  dlq_messages: number;
  services_healthy: number;
  services_total: number;
  prometheus_available: boolean;
}

export function LiveMetricsBanner({ metrics }: { metrics: LiveMetrics | null }) {
  if (!metrics) return null;

  if (!metrics.prometheus_available) {
    return (
      <p className="text-sm text-text-tertiary" data-testid="live-metrics-unavailable">
        Live metrics unavailable (start the monitoring profile)
      </p>
    );
  }

  const servicesDown = metrics.services_total - metrics.services_healthy;
  return (
    <div
      className={`glass p-4 flex items-center justify-between border ${
        metrics.pipeline_active ? 'border-green-500/50' : 'border-yellow-500/50'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-3 h-3 rounded-full ${metrics.pipeline_active ? 'bg-green-500' : 'bg-yellow-500'}`}
        />
        <span className="font-medium">Pipeline {metrics.pipeline_active ? 'Active' : 'Idle'}</span>
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <span>{metrics.messages_per_second.toFixed(1)} msg/sec</span>
        <span>{metrics.messages_archived_per_second.toFixed(1)} archived/sec</span>
        <span>Queue: {metrics.queue_depth}</span>
        <span className={metrics.dlq_messages > 0 ? 'text-red-400' : undefined}>
          DLQ: {metrics.dlq_messages}
        </span>
        <span className={servicesDown > 0 ? 'text-red-400' : 'text-green-400'}>
          Services: {metrics.services_healthy}/{metrics.services_total} up
        </span>
      </div>
    </div>
  );
}
