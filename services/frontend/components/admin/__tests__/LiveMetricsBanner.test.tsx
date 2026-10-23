import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveMetricsBanner, type LiveMetrics } from '../LiveMetricsBanner';

const LIVE: LiveMetrics = {
  pipeline_active: true,
  messages_per_second: 1.25,
  messages_archived_per_second: 1.2,
  queue_depth: 7,
  dlq_messages: 0,
  services_healthy: 3,
  services_total: 3,
  prometheus_available: true,
};

describe('LiveMetricsBanner', () => {
  it('shows live numbers when Prometheus is available', () => {
    render(<LiveMetricsBanner metrics={LIVE} />);
    expect(screen.getByText('Pipeline Active')).toBeInTheDocument();
    expect(screen.getByText('1.3 msg/sec')).toBeInTheDocument();
    expect(screen.getByText('Queue: 7')).toBeInTheDocument();
    expect(screen.getByText('Services: 3/3 up')).toBeInTheDocument();
  });

  it('shows Idle and a down service', () => {
    render(<LiveMetricsBanner metrics={{ ...LIVE, pipeline_active: false, services_healthy: 2 }} />);
    expect(screen.getByText('Pipeline Idle')).toBeInTheDocument();
    expect(screen.getByText('Services: 2/3 up')).toHaveClass('text-red-400');
  });

  it('shows a neutral line when Prometheus is unavailable', () => {
    render(<LiveMetricsBanner metrics={{ ...LIVE, prometheus_available: false }} />);
    expect(screen.getByText('Live metrics unavailable (start the monitoring profile)')).toBeInTheDocument();
    expect(screen.queryByText(/msg\/sec/)).not.toBeInTheDocument();
  });

  it('renders nothing before the request finishes', () => {
    const { container } = render(<LiveMetricsBanner metrics={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
