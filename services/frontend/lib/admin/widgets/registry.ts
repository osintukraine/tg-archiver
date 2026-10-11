// services/frontend-nextjs/lib/admin/widgets/registry.ts
import React from 'react';

/**
 * Dashboard Widget Registry
 *
 * Centralized registry for self-registering dashboard widgets.
 * Widgets register themselves on import.
 */

export interface WidgetProps {
  onRefresh?: () => void;
  isLoading?: boolean;
  className?: string;
}

export type WidgetSize = 'small' | 'medium' | 'large' | 'full';
export type WidgetCategory = 'stats' | 'activity' | 'system' | 'actions';

export interface DashboardWidget {
  id: string;
  title: string;
  description: string;
  component: React.ComponentType<WidgetProps>;
  defaultSize: WidgetSize;
  category: WidgetCategory;
  refreshInterval?: number;  // in seconds
  minRole?: 'user' | 'admin';
}

// Widget registry - populated by widget self-registration
const WIDGET_REGISTRY: Map<string, DashboardWidget> = new Map();

/**
 * Register a widget in the global registry.
 * Called by each widget on module load.
 */
export function registerWidget(widget: DashboardWidget): void {
  if (WIDGET_REGISTRY.has(widget.id)) {
    console.warn(`Widget "${widget.id}" already registered, overwriting.`);
  }
  WIDGET_REGISTRY.set(widget.id, widget);
}

/**
 * Get all registered widgets.
 */
export function getWidgets(): DashboardWidget[] {
  return Array.from(WIDGET_REGISTRY.values());
}

/**
 * Get widget by ID.
 */
export function getWidget(id: string): DashboardWidget | undefined {
  return WIDGET_REGISTRY.get(id);
}

/**
 * Get widgets filtered by category.
 */
export function getWidgetsByCategory(category: WidgetCategory): DashboardWidget[] {
  return getWidgets().filter(w => w.category === category);
}

/**
 * Get widgets filtered by size.
 */
export function getWidgetsBySize(size: WidgetSize): DashboardWidget[] {
  return getWidgets().filter(w => w.defaultSize === size);
}

/**
 * Convert widget size to Tailwind grid column classes.
 */
export function sizeToColSpan(size: WidgetSize): string {
  switch (size) {
    case 'small':
      return 'col-span-1';
    case 'medium':
      return 'col-span-1 md:col-span-2';
    case 'large':
      return 'col-span-1 md:col-span-2 lg:col-span-3';
    case 'full':
      return 'col-span-1 md:col-span-2 lg:col-span-4';
    default:
      return 'col-span-1';
  }
}

/**
 * Get default dashboard layout (widget IDs in display order).
 */
export function getDefaultLayout(): string[] {
  return [
    'messages-today',
    'active-channels',
    'entity-count',
    'storage-used',
    'spam-rate',
    'processing-latency',
    'quick-actions',
    'system-status',
    'recent-activity',
    'total-archived',
  ];
}
