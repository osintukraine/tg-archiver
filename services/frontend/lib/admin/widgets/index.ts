// services/frontend-nextjs/lib/admin/widgets/index.ts

/**
 * Widget Index - Triggers Self-Registration
 *
 * This file imports all widget modules to trigger their self-registration
 * with the widget registry. Each widget calls registerWidget() on module load,
 * populating the global registry.
 *
 * IMPORTANT: Import statements below are for side effects only (triggering
 * registration). The actual exports come from the registry module.
 *
 * To add a new widget:
 * 1. Create widget file in appropriate category folder
 * 2. Call registerWidget() at module level in that file
 * 3. Add import here to trigger registration
 */

// Stats widgets - Core metrics and KPIs
import './stats/MessagesTodayWidget';
import './stats/ActiveChannelsWidget';
import './stats/StorageUsedWidget';
import './stats/SpamRateWidget';
import './stats/ProcessingLatencyWidget';
import './stats/TotalArchivedWidget';

// System widgets - Infrastructure health
import './system/SystemStatusWidget';

// Activity widgets - Recent events and logs
import './activity/RecentActivityWidget';

// Action widgets - Quick controls and shortcuts
import './actions/QuickActionsWidget';

/**
 * Re-export registry functions for convenience.
 * These are the main API for working with registered widgets.
 */
export {
  // Core registry functions
  registerWidget,
  getWidgets,
  getWidget,
  getWidgetsByCategory,
  getWidgetsBySize,

  // Layout helpers
  getDefaultLayout,
  sizeToColSpan,

  // TypeScript types
  type DashboardWidget,
  type WidgetProps,
  type WidgetSize,
  type WidgetCategory,
} from './registry';
