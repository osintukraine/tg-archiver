# Frontend Service

Next.js 14 web application - message search, channel browsing, and social graph visualization.

## Quick Start (localhost)

```bash
# Prerequisites - start API
docker-compose up -d api

# Run locally
cd services/frontend
npm install  # or: bun install

export NEXT_PUBLIC_API_URL=http://localhost:8000

# Development with hot reload
npm run dev  # or: bun dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Essential Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Yes | API base URL (must be browser-accessible) |
| `NEXT_PUBLIC_KRATOS_URL` | No | Ory Kratos URL (if auth enabled) |

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `app/` | Next.js App Router pages |
| `components/` | React components |
| `lib/` | Utilities, API clients, types |
| `components/social-graph/` | Network visualization |
| `contexts/` | React context providers |

## Key Pages

| Route | Description |
|-------|-------------|
| `/` | Message search and feed |
| `/messages/[id]` | Message detail view |
| `/channels` | Channel browser and statistics |
| `/search` | Advanced search interface |
| `/profile/feeds` | RSS feed management |
| `/profile/api-keys` | API key management |
| `/about` | System architecture and information |

## Features

### Message Search
- Full-text search across all archived messages
- Filter by channel, date range, media type
- Sort by relevance or recency
- Keyboard shortcuts for power users

### Channel Browser
- Browse all monitored channels
- Channel statistics and activity graphs
- Subscribe to RSS feeds per channel

### Message Detail View
- Full message content with media gallery
- Translation toggle for multilingual content
- Social graph showing forwards and replies
- Engagement metrics (views, forwards, comments)
- Related messages and discussion threads

### RSS Feed Management
- Generate custom RSS/Atom/JSON feeds
- Filter feeds by channels, topics, or keywords
- Secure feed URLs with authentication tokens

## Common Local Issues

### "API fetch failed"
Ensure API is running:
```bash
curl http://localhost:8000/health
export NEXT_PUBLIC_API_URL=http://localhost:8000
```

### "Hydration mismatch"
Browser extensions can cause this. Try incognito mode or disable extensions.

### "Build fails with type errors"
```bash
npm run type-check  # Fix errors, then rebuild
```

### Images not loading
Check that MinIO is running and accessible:
```bash
curl http://localhost:9000/health/live
```

## Development

```bash
npm run dev         # Development server (hot reload)
npm run type-check  # Type checking without build
npm run lint        # ESLint checking
npm run build       # Production build
npm run start       # Start production server
```

## Component Architecture

### PostCard Component
Main message display component with multiple density modes:
- `compact` - Minimal view for lists
- `detailed` - Full content with media
- `immersive` - Full-screen media player

### SearchFilters Component
Advanced filtering interface:
- Date range picker
- Channel multi-select
- Media type filters
- Translation filters

### Social Graph Components
Network visualization using Cytoscape.js:
- Message forward chains
- Reply threads
- Comment discussions
- Engagement timelines

## Styling

Uses Tailwind CSS with custom configuration:
- Dark mode support (default)
- Custom color scheme for message types
- Responsive design for mobile/tablet/desktop
- Shadcn UI components for consistent interface

## API Integration

The frontend uses a REST API client in `/lib/api.ts`:

```typescript
import { searchMessages, getChannel, getMessageById } from '@/lib/api';

// Search messages
const results = await searchMessages({
  query: 'search term',
  channel_ids: [1, 2, 3],
  limit: 50,
  offset: 0
});

// Get channel details
const channel = await getChannel(channelId);

// Get message by ID
const message = await getMessageById(messageId);
```

## Authentication (Optional)

Basic authentication using Ory Kratos (disabled by default):

1. Enable in `.env`:
```bash
NEXT_PUBLIC_KRATOS_URL=http://localhost:4433
```

2. Configure Kratos instance
3. Use `AuthContext` for protected routes

## Performance Optimization

### Image Loading
- Lazy loading with Next.js Image component
- Progressive JPEG/WebP support
- Automatic responsive sizes

### Code Splitting
- Route-based code splitting (automatic with App Router)
- Dynamic imports for heavy components
- Optimized bundle sizes

### Caching
- SWR for data fetching with automatic revalidation
- Browser cache for media assets
- Service worker for offline support (optional)

## Accessibility

- Semantic HTML structure
- ARIA labels on interactive elements
- Keyboard navigation support
- Screen reader compatible
- Focus management for modals

## Browser Support

- Modern evergreen browsers (Chrome, Firefox, Safari, Edge)
- Mobile browsers (iOS Safari, Chrome Mobile)
- No IE11 support

## Deployment

### Docker (Production)
```bash
docker build -t tg-archiver-frontend .
docker run -p 3000:3000 -e NEXT_PUBLIC_API_URL=https://api.example.com tg-archiver-frontend
```

### Static Export (Optional)
For static hosting:
```bash
npm run build
npm run export
# Deploy /out directory to static host
```

Note: Some features require server-side rendering and won't work with static export.

## Troubleshooting

### Media not displaying
1. Check MinIO is running: `docker-compose ps minio`
2. Verify media URL format in API responses
3. Check browser console for CORS errors
4. Ensure `NEXT_PUBLIC_API_URL` is correct

### Search not working
1. Verify API `/search` endpoint is responding
2. Check PostgreSQL full-text search index
3. Review browser console for errors
4. Test API directly: `curl http://localhost:8000/messages/search?q=test`

### Slow page loads
1. Check API response times
2. Monitor database query performance
3. Review Next.js build output for large bundles
4. Consider implementing pagination for large result sets

## Contributing

When adding new features:
1. Follow existing component patterns
2. Use TypeScript for type safety
3. Add proper error handling
4. Test on mobile and desktop
5. Update this README if adding new routes or features
