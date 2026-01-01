// services/frontend-nextjs/components/about/TabNavigation.tsx

'use client';

import { useEffect } from 'react';

export type TabId = 'overview' | 'activity' | 'architecture';

interface Tab {
  id: TabId;
  label: string;
  description: string;
}

interface TabNavigationProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const tabs: Tab[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Platform overview, stats, and capabilities',
  },
  {
    id: 'activity',
    label: 'Activity',
    description: 'Real-time platform activity, message volume, and topic distribution',
  },
  {
    id: 'architecture',
    label: 'Architecture',
    description: 'Interactive pipeline and infrastructure diagrams',
  },
];

export default function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  // Keyboard shortcuts for tab switching
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Numeric keys 1-3 for tabs
      if (e.key === '1') onTabChange('overview');
      if (e.key === '2') onTabChange('activity');
      if (e.key === '3') onTabChange('architecture');
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [onTabChange]);

  return (
    <div className="border-b border-gray-200 dark:border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Tab list */}
        <nav className="-mb-px flex space-x-4 sm:space-x-8 overflow-x-auto" aria-label="Tabs">
          {tabs.map((tab, index) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`
                  group inline-flex items-center py-3 sm:py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap
                  transition-colors
                  ${isActive
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  }
                `}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="flex items-center gap-1.5 sm:gap-2">
                  <span>{tab.label}</span>
                  <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded">
                    {index + 1}
                  </kbd>
                </span>
              </button>
            );
          })}
        </nav>

        {/* Active tab description */}
        <div className="py-2 sm:py-3">
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
            {tabs.find(t => t.id === activeTab)?.description}
          </p>
        </div>
      </div>
    </div>
  );
}
