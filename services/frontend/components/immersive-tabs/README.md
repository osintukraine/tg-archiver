# Immersive Tab Components

Tab content components for the PostCard Immersive view redesign.

## Overview

These components provide rich, detailed views of message data in the immersive (full-screen) mode of the PostCard component. Each tab is self-contained and accepts `message` and optional `channel` props.

## Components

### 1. OverviewTab (245 lines)
**Default tab** showing core message information:
- Channel header with country flag and verification badges
- Full content with translation toggle
- Media gallery with support for images, videos, and documents
- Basic metadata grid (message ID, channel ID, dates)
- RSS Validation Panel integration

### 2. SocialGraphTab (242 lines)
Social graph and engagement visualization:
- Large engagement metric cards (views, forwards, comments)
- Virality ratio analysis with color-coded indicators
- Forward chain visualization with source details
- Reply thread indicators
- Discussion thread links (if has_comments)
- Author information (if author_user_id available)
- Network visualization placeholder

### 3. EntitiesTab (283 lines)
Full entity matches display:
- **OpenSanctions entities**: High-risk entities with full cards showing risk classification, datasets, and aliases
- **Curated entities**: Grouped by entity_type (equipment, military_unit, aircraft, etc.)
- **Legacy entities**: Deprecated regex-based entities (hashtags, mentions, locations)
- Source distribution chart showing entity data sources
- Educational content about entity matching methods

### 4. EnrichmentTab (484 lines)
Comprehensive AI enrichment and technical metadata:
- **AI Analysis**: Sentiment, urgency meter, complexity indicator
- **Key phrases**: All extracted phrases displayed
- **AI summary**: Full AI-generated summary with timestamp
- **AI tags**: All tags grouped by type (keywords, topics, entities, emotions, urgency) with confidence scores
- **Vector embeddings**: Model and generation metadata
- **Spam detection**: Full spam analysis details
- **Human review**: Review status and manual scores
- **Authenticity hashes**: Content and metadata hashes for integrity verification
- **Archival metadata**: Trigger information and priority
- **Translation metadata**: Provider, cost, and timestamps
- **Processing timeline**: Full lifecycle tracking

## Usage

```tsx
import { OverviewTab, SocialGraphTab, EntitiesTab, EnrichmentTab } from '@/components/immersive-tabs';

// In your component
<Tabs defaultValue="overview">
  <TabsList>
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="social">Social Graph</TabsTrigger>
    <TabsTrigger value="entities">Entities</TabsTrigger>
    <TabsTrigger value="enrichment">Enrichment</TabsTrigger>
  </TabsList>

  <TabsContent value="overview">
    <OverviewTab message={message} channel={channel} />
  </TabsContent>

  <TabsContent value="social">
    <SocialGraphTab message={message} channel={channel} />
  </TabsContent>

  <TabsContent value="entities">
    <EntitiesTab message={message} channel={channel} />
  </TabsContent>

  <TabsContent value="enrichment">
    <EnrichmentTab message={message} channel={channel} />
  </TabsContent>
</Tabs>
```

## Props Interface

All components accept the same props:

```typescript
interface TabProps {
  message: Message;      // Required: Full message object from API
  channel?: Channel;     // Optional: Channel metadata
}
```

## Features

### Graceful Degradation
- All components handle null/undefined values gracefully
- Empty states with helpful messages when no data is available
- Conditional rendering based on data availability

### Existing Component Reuse
- `SentimentBadge`: Emotional context indicators
- `UrgencyMeter`: 0-100 urgency visualization
- `EntityChip`: Entity display cards (compact/detailed modes)
- `ViralityIndicator`: Virality analysis
- `ValidationPanel`: RSS cross-reference validation

### Utility Functions
Uses existing utilities from `@/lib/utils`:
- `formatNumber`: Format large numbers (K/M suffixes)
- `calculateViralityRatio`: Compute forward/view percentage
- `getViralityColor`: Color coding for virality levels
- `getUrgencyColor`: Color coding for urgency levels

### Styling
- Consistent Tailwind CSS usage matching existing patterns
- Dark mode support via theme variables
- Responsive grid layouts
- Color-coded information hierarchy

## File Structure

```
components/immersive-tabs/
├── index.ts              # Barrel export file
├── OverviewTab.tsx       # Core message information
├── SocialGraphTab.tsx    # Engagement and social graph
├── EntitiesTab.tsx       # Entity matches
├── EnrichmentTab.tsx     # AI enrichment and metadata
└── README.md            # This file
```

## Integration Notes

1. **No external state management needed**: All components are self-contained
2. **Type-safe**: Uses TypeScript types from `@/lib/types`
3. **API integration**: Uses `getMediaUrl` from `@/lib/api` for media display
4. **Consistent patterns**: Follows existing codebase conventions
5. **ESLint clean**: Only minor Next.js Image optimization warning (acceptable)

## Code Statistics

- Total lines: 1,254
- Average component size: 314 lines
- TypeScript interfaces: Fully typed
- External dependencies: Minimal (date-fns, existing components)

## Next Steps for Integration

1. Import the tab components into the PostCard immersive mode
2. Add Tabs UI component wrapper (using existing `@/components/ui/tabs`)
3. Wire up tab navigation state
4. Add keyboard shortcuts for tab navigation (optional)
5. Consider adding tab counts/badges for data availability

## Example Tab Navigation

```tsx
// Show badge counts for data availability
<TabsTrigger value="entities">
  Entities
  {(message.opensanctions_entities?.length || 0) + (message.curated_entities?.length || 0) > 0 && (
    <span className="ml-2 px-2 py-0.5 bg-accent-primary/20 text-accent-primary rounded text-xs">
      {(message.opensanctions_entities?.length || 0) + (message.curated_entities?.length || 0)}
    </span>
  )}
</TabsTrigger>
```

## Performance Considerations

- Components render only their tab content (lazy loading via Tabs component)
- Media uses lazy loading attributes
- Large datasets (tags, entities) are properly chunked and grouped
- Conditional rendering minimizes DOM nodes when data is unavailable
