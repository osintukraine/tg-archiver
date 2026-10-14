# Social Graph Components

Message-level propagation graph, comment thread and engagement chart. Each takes a single prop, `messageId: number`, and is rendered by `components/EnhancedPostCard.tsx`.

```tsx
import { SocialNetworkGraph, CommentThread, EngagementChart } from '@/components/social-graph';
```

| Component | What it shows |
|-----------|---------------|
| `SocialNetworkGraph` | Sigma.js + graphology graph (ForceAtlas2 layout, loaded on demand) of the message, its author, forward sources, sibling forwards, replies and comments. Re-layout and PNG export buttons, selected-node panel with comment translation |
| `CommentThread` | Comments and replies under the message, with per-comment translation (`translateComment`) |
| `EngagementChart` | Recharts line chart of views, forwards and reactions; fixed to hourly granularity over the last 168 h |

## Data

Hooks in `hooks/useSocialGraph.ts` (React Query, wrapping `lib/api.ts`): `useSocialGraph`, `useEngagementTimeline`, `useCommentThread`. Types are in `types/social-graph.ts`.

API endpoints (`services/api/src/routers/social_graph.py`):

```
GET /api/social-graph/messages/{id}
GET /api/social-graph/messages/{id}/comments
GET /api/social-graph/messages/{id}/engagement-timeline
```
