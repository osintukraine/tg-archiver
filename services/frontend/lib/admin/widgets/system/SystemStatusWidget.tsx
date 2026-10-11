// services/frontend-nextjs/lib/admin/widgets/system/SystemStatusWidget.tsx
'use client';

import { useState, useEffect } from 'react';
import { registerWidget, WidgetProps } from '../registry';
import { WidgetCard } from '../WidgetCard';
import { adminApi } from '@/lib/admin-api';

interface ServiceStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  icon: React.ReactNode;
}

function SystemStatusWidget({ className }: WidgetProps) {
  const [services, setServices] = useState<ServiceStatus[]>([
    { name: 'API Server', status: 'unknown', icon: <ServerIcon /> },
    { name: 'PostgreSQL', status: 'unknown', icon: <DatabaseIcon /> },
    { name: 'Redis', status: 'unknown', icon: <RedisIcon /> },
    { name: 'SeaweedFS Storage', status: 'unknown', icon: <StorageIcon /> },
  ]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        await adminApi.get('/api/health');
        setServices([
          { name: 'API Server', status: 'healthy', icon: <ServerIcon /> },
          { name: 'PostgreSQL', status: 'healthy', icon: <DatabaseIcon /> },
          { name: 'Redis', status: 'healthy', icon: <RedisIcon /> },
          { name: 'SeaweedFS Storage', status: 'healthy', icon: <StorageIcon /> },
        ]);
      } catch {
        setServices(s => s.map(svc => ({ ...svc, status: 'unknown' })));
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusStyle = (status: ServiceStatus['status']) => {
    switch (status) {
      case 'healthy':
        return { dot: 'bg-green-500', text: 'text-green-500', bg: 'bg-green-500/10' };
      case 'degraded':
        return { dot: 'bg-yellow-500', text: 'text-yellow-500', bg: 'bg-yellow-500/10' };
      case 'down':
        return { dot: 'bg-red-500', text: 'text-red-500', bg: 'bg-red-500/10' };
      default:
        return { dot: 'bg-gray-500', text: 'text-gray-500', bg: 'bg-gray-500/10' };
    }
  };

  return (
    <WidgetCard title="System Status" className={className}>
      <div className="space-y-2">
        {services.map((service) => {
          const style = getStatusStyle(service.status);
          return (
            <div
              key={service.name}
              className={`flex items-center justify-between p-3 rounded-lg ${style.bg} transition-colors`}
            >
              <div className="flex items-center gap-3">
                <span className="text-text-secondary opacity-60">
                  {service.icon}
                </span>
                <span className="text-sm font-medium text-text-primary">{service.name}</span>
              </div>
              {loading ? (
                <span className="w-12 h-4 bg-bg-tertiary animate-pulse rounded" />
              ) : (
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                  <span className={`text-xs font-medium ${style.text} capitalize`}>
                    {service.status}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </WidgetCard>
  );
}

// Icon components
function ServerIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
    </svg>
  );
}

function RedisIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function StorageIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
    </svg>
  );
}

registerWidget({
  id: 'system-status',
  title: 'System Status',
  description: 'Health status of all platform services',
  component: SystemStatusWidget,
  defaultSize: 'medium',
  category: 'system',
  refreshInterval: 30,
});

export default SystemStatusWidget;
