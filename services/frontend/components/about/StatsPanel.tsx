'use client';

import { SystemHealth, AboutStats } from '@/types/about';
import { Database, Radio, BarChart } from 'lucide-react';

interface StatsPanelProps {
  systemHealth?: SystemHealth | null;
  aboutStats?: AboutStats | null;
  isLoading?: boolean;
}

export default function StatsPanel({
  systemHealth,
  aboutStats,
  isLoading,
}: StatsPanelProps) {
  const stats = [
    {
      label: 'Total Messages',
      value: isLoading ? '...' : (aboutStats?.messages_formatted || '—'),
      icon: Database,
      color: 'text-green-600',
    },
    {
      label: 'Channels Monitored',
      value: isLoading ? '...' : (aboutStats?.channels?.toString() || '—'),
      icon: Radio,
      color: 'text-blue-600',
    },
    {
      label: 'Services Active',
      value: isLoading ? '...' : (systemHealth?.services.filter(s => s.status === 'healthy').length.toString() || '—'),
      icon: BarChart,
      color: 'text-purple-600',
    },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="flex items-center gap-4">
              <div className={`p-3 rounded-lg bg-gray-50 dark:bg-gray-900 ${stat.color}`}>
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{stat.value}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">{stat.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {aboutStats?.timestamp && !isLoading && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-4 text-center">
          Last updated: {new Date(aboutStats.timestamp).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
