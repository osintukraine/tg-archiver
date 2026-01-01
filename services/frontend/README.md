# Frontend Service

Next.js 14 web application - message search, entity exploration, social graph visualization.

## Quick Start (localhost)

```bash
# Prerequisites - start API
docker-compose up -d api

# Run locally
cd services/frontend-nextjs
npm install  # or: bun install

export NEXT_PUBLIC_API_URL=http://localhost:8000

# Development with hot reload
npm run dev  # or: bun dev
```

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
| `components/map/` | Geographic map view |

## Key Pages

| Route | Description |
|-------|-------------|
| `/` | Message search and feed |
| `/messages/[id]` | Message detail view |
| `/channels` | Channel browser |
| `/entities` | Entity explorer |
| `/map` | Geographic map view |
| `/about` | Platform architecture |

## Common Local Issues

### "API fetch failed"
Ensure API is running:
```bash
curl http://localhost:8000/health
export NEXT_PUBLIC_API_URL=http://localhost:8000
```

### "Hydration mismatch"
Browser extensions can cause this. Try incognito mode.

### "Build fails with type errors"
```bash
npm run type-check  # Fix errors, then rebuild
```

## Development

```bash
npm run dev         # Development server
npm run type-check  # Type checking
npm run lint        # Linting
npm run build       # Production build
```

## Full Documentation

See [Platform Docs: Frontend Service](https://docs.osintukraine.com/developer-guide/services/frontend) for:
- Component architecture
- API integration patterns
- Authentication flow
- Map interface guide
