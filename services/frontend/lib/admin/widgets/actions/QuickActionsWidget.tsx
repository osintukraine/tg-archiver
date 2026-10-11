// services/frontend-nextjs/lib/admin/widgets/actions/QuickActionsWidget.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { registerWidget, WidgetProps } from '../registry';
import { WidgetCard } from '../WidgetCard';
import { adminApi } from '@/lib/admin-api';

/**
 * QuickActionsWidget Component
 *
 * Provides quick action buttons for common admin tasks.
 * Each action has icon, label, description, and proper feedback.
 */

interface ActionButton {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: () => Promise<void>;
  colorClass: string;
}

function QuickActionsWidget({ className }: WidgetProps) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Clear cache action
  const handleClearCache = async () => {
    setLoading('clear-cache');
    setFeedback(null);
    try {
      await adminApi.post('/api/admin/cache/clear');
      setFeedback({ type: 'success', text: 'Cache cleared successfully' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to clear cache'
      });
    } finally {
      setLoading(null);
    }
  };

  // Refresh stats action (reload page data)
  const handleRefreshStats = async () => {
    setLoading('refresh-stats');
    setFeedback(null);
    try {
      // Trigger a page refresh by reloading router
      router.refresh();
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay for visual feedback
      setFeedback({ type: 'success', text: 'Dashboard refreshed' });
    } catch {
      setFeedback({
        type: 'error',
        text: 'Failed to refresh dashboard'
      });
    } finally {
      setLoading(null);
    }
  };

  // Export data action (navigate to export page)
  const handleExportData = async () => {
    setLoading('export-data');
    try {
      router.push('/admin/export');
    } finally {
      setLoading(null);
    }
  };

  // View logs action (navigate to audit page)
  const handleViewLogs = async () => {
    setLoading('view-logs');
    try {
      router.push('/admin/audit');
    } finally {
      setLoading(null);
    }
  };

  const actions: ActionButton[] = [
    {
      id: 'clear-cache',
      label: 'Clear Cache',
      description: 'Clear Redis cache',
      colorClass: 'text-red-500',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
      action: handleClearCache,
    },
    {
      id: 'refresh-stats',
      label: 'Refresh Stats',
      description: 'Reload dashboard data',
      colorClass: 'text-blue-500',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ),
      action: handleRefreshStats,
    },
    {
      id: 'export-data',
      label: 'Export Data',
      description: 'Download platform data',
      colorClass: 'text-green-500',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      ),
      action: handleExportData,
    },
    {
      id: 'view-logs',
      label: 'View Logs',
      description: 'Open audit log',
      colorClass: 'text-purple-500',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
      action: handleViewLogs,
    },
  ];

  return (
    <WidgetCard title="Quick Actions" className={className}>
      {/* Feedback message */}
      {feedback && (
        <div
          className={`mb-4 p-3 rounded-lg text-sm ${
            feedback.type === 'success'
              ? 'bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20'
              : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Action buttons grid */}
      <div className="grid grid-cols-2 gap-3">
        {actions.map((action) => (
          <button
            key={action.id}
            onClick={action.action}
            disabled={loading === action.id}
            className="
              p-4 bg-bg-secondary hover:bg-bg-tertiary rounded-lg
              text-left transition-all group
              disabled:opacity-50 disabled:cursor-not-allowed
              border border-border-subtle hover:border-border-primary
            "
          >
            <div className="flex items-start gap-3">
              <span
                className={`
                  transition-colors text-text-tertiary
                  group-hover:${action.colorClass}
                  ${loading === action.id ? 'animate-pulse' : ''}
                `}
              >
                {action.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-text-primary text-sm">
                  {loading === action.id ? 'Loading...' : action.label}
                </div>
                <div className="text-xs text-text-tertiary mt-0.5">
                  {action.description}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </WidgetCard>
  );
}

// Self-register widget
registerWidget({
  id: 'quick-actions',
  title: 'Quick Actions',
  description: 'Common administrative tasks',
  component: QuickActionsWidget,
  defaultSize: 'small',
  category: 'actions',
});

export default QuickActionsWidget;
