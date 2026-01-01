'use client';

import { getWidgets } from '@/lib/admin/widgets';
// Import widgets to trigger registration
import '@/lib/admin/widgets';

/**
 * Admin Dashboard Page
 *
 * Section-based layout with responsive widgets.
 * Organized by function: Metrics → Health → Actions/Activity
 */

export default function AdminDashboard() {
  const widgets = getWidgets();

  // Get widget components by ID
  const getWidget = (id: string) => {
    const widget = widgets.find(w => w.id === id);
    return widget?.component;
  };

  // Widget components
  const MessagesToday = getWidget('messages-today');
  const ActiveChannels = getWidget('active-channels');
  const EntityCount = getWidget('entity-count');
  const StorageUsed = getWidget('storage-used');
  const SpamRate = getWidget('spam-rate');
  const ProcessingLatency = getWidget('processing-latency');
  const SystemStatus = getWidget('system-status');
  const QuickActions = getWidget('quick-actions');
  const RecentActivity = getWidget('recent-activity');
  const TotalArchived = getWidget('total-archived');

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-text-primary">Dashboard</h1>
        <p className="text-text-secondary mt-2">
          Platform overview and quick actions
        </p>
      </div>

      {/* Section 1: Key Metrics - Responsive grid that wraps naturally */}
      <section>
        <h2 className="text-sm font-medium text-text-tertiary uppercase tracking-wide mb-4">
          Key Metrics
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {MessagesToday && <MessagesToday />}
          {ActiveChannels && <ActiveChannels />}
          {EntityCount && <EntityCount />}
          {StorageUsed && <StorageUsed />}
        </div>
      </section>

      {/* Section 2: Health & Performance */}
      <section>
        <h2 className="text-sm font-medium text-text-tertiary uppercase tracking-wide mb-4">
          Health & Performance
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SpamRate && <SpamRate />}
          {ProcessingLatency && <ProcessingLatency />}
          {TotalArchived && <TotalArchived />}
        </div>
      </section>

      {/* Section 3: System & Actions - Side by side on larger screens */}
      <section>
        <h2 className="text-sm font-medium text-text-tertiary uppercase tracking-wide mb-4">
          System & Actions
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {SystemStatus && <SystemStatus />}
          {QuickActions && <QuickActions />}
        </div>
      </section>

      {/* Section 4: Recent Activity - Full width */}
      <section>
        <h2 className="text-sm font-medium text-text-tertiary uppercase tracking-wide mb-4">
          Recent Activity
        </h2>
        {RecentActivity && <RecentActivity />}
      </section>
    </div>
  );
}
