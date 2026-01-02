# Social Graph Components

React components for visualizing social network data, comment threads, and engagement metrics in the Telegram archiver.

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

**Use Cases**:
- Visualize how messages spread through forwards
- Identify influential nodes in the network
- Track message propagation patterns
- Analyze reply chains

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

**Use Cases**:
- Browse discussion threads under messages
- Track conversation flow
- Identify active participants
- Monitor engagement in comment sections

### EngagementChart

Time-series visualization of views, forwards, and reactions.

```tsx
import { EngagementChart } from '@/components/social-graph';

<EngagementChart messageId={123} />
```

**Features**:
- SVG-based line chart
- Multiple metrics (views, forwards, reactions)
- Summary statistics
- Peak engagement indicator
- Dark mode support

**Use Cases**:
- Track message engagement over time
- Identify viral moments
- Analyze engagement patterns
- Compare performance across messages

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

These components are integrated into `EnhancedPostCard` under the Social Graph tab.

## Example Integration

```tsx
import { SocialNetworkGraph, CommentThread, EngagementChart } from '@/components/social-graph';

export function MessageDetailPage({ messageId }: { messageId: number }) {
  return (
    <div className="space-y-6">
      <section>
        <h2>Message Propagation</h2>
        <SocialNetworkGraph messageId={messageId} />
      </section>

      <section>
        <h2>Engagement Timeline</h2>
        <EngagementChart messageId={messageId} />
      </section>

      <section>
        <h2>Discussion</h2>
        <CommentThread messageId={messageId} />
      </section>
    </div>
  );
}
```

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

## Configuration

### Graph Layout Options

The SocialNetworkGraph supports various layout algorithms:

```tsx
<SocialNetworkGraph
  messageId={123}
  layout="fcose"  // Options: 'fcose', 'cose', 'circle', 'grid'
/>
```

### Chart Customization

The EngagementChart accepts custom styling:

```tsx
<EngagementChart
  messageId={123}
  height={400}
  showLegend={true}
  colors={{
    views: '#3b82f6',
    forwards: '#10b981',
    reactions: '#f59e0b'
  }}
/>
```

## Performance Considerations

- Graph rendering is optimized for up to 1000 nodes
- Lazy loading for large comment threads
- Debounced zoom/pan events
- Memoized calculations for engagement data

## Accessibility

- Keyboard navigation for graph controls
- Screen reader support for statistics
- High contrast mode support
- Focus indicators for interactive elements

## Future Enhancements

Planned improvements:
- Real-time updates for engagement metrics
- Advanced filtering options
- Export to multiple formats (SVG, JSON, CSV)
- Cluster analysis for large networks
- Sentiment visualization in comment threads
