# Social Graph Components

React components for visualizing social network data, comment threads, and engagement metrics in the OSINT Intelligence Platform.

## Components

### SocialNetworkGraph

Interactive graph visualization using Cytoscape.js showing message propagation through forwards and replies.

```tsx
import { SocialNetworkGraph } from '@/components/social-graph';

<SocialNetworkGraph messageId={123} />
```

**Features**:
- Force-directed layout
- Color-coded nodes (authors, channels, messages)
- Interactive zoom/pan
- Export to PNG
- Dark mode support

### CommentThread

Reddit-style threaded comment display with nested replies.

```tsx
import { CommentThread } from '@/components/social-graph';

<CommentThread messageId={123} />
```

**Features**:
- Nested replies (up to 5 levels)
- Collapsible threads
- Engagement metrics
- Pagination
- Time ago formatting

### EngagementChart

Time-series visualization of views, forwards, and reactions.

```tsx
import { EngagementChart } from '@/components/social-graph';

<EngagementChart messageId={123} />
```

**Features**:
- SVG-based line chart
- Three metrics (views, forwards, reactions)
- Summary statistics
- Peak engagement indicator
- Dark mode support

## API Hooks

```tsx
import { useSocialGraph, useComments, useEngagementTimeline } from '@/hooks/useSocialGraph';

// Social network data
const { data, isLoading, error } = useSocialGraph(messageId, {
  include_forwards: true,
  include_replies: true,
  max_depth: 3
});

// Comments/replies
const { data, isLoading, error } = useComments(messageId, {
  limit: 50,
  offset: 0,
  sort: 'asc',
  include_replies: true
});

// Engagement timeline
const { data, isLoading, error } = useEngagementTimeline(messageId, {
  granularity: 'hour',
  time_range_hours: 168 // 7 days
});
```

## Type Definitions

See `/types/social-graph.ts` for complete TypeScript interfaces:

- `MessageSocialGraph` - Social network structure
- `Comment` - Comment/reply data
- `EngagementTimeline` - Time-series data
- Node/edge types and parameters

## Integration

These components are integrated into `EnhancedPostCard` under the Network tab → Social sub-tab.

## Dependencies

All required dependencies are already in `package.json`:
- cytoscape
- cytoscape-fcose
- @tanstack/react-query
- date-fns
- lucide-react

## Backend Requirements

The following API endpoints must be implemented:

```
GET /api/social-graph/messages/{id}
GET /api/social-graph/messages/{id}/comments
GET /api/social-graph/messages/{id}/engagement-timeline
```

See type definitions for expected response formats.
