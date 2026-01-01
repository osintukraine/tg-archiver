// services/frontend-nextjs/components/about/Legend.tsx

'use client';

import { MessageCircle, Server, Database, Filter, Globe } from 'lucide-react';

const legendItems = [
  { label: 'Source', color: '#0088cc', icon: MessageCircle },
  { label: 'Service', color: '#7c3aed', icon: Server },
  { label: 'Data Store', color: '#10b981', icon: Database },
  { label: 'Processing', color: '#f59e0b', icon: Filter },
  { label: 'Output', color: '#4f46e5', icon: Globe },
];

export default function Legend() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-100 mb-3">Node Types</h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {legendItems.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <Icon className="w-4 h-4" style={{ color: item.color }} />
              <span className="text-xs text-gray-600 dark:text-gray-400">{item.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
