# Frontend Service

Next.js 16 (App Router), React 19, Tailwind CSS 4, TypeScript 6. Built and run with Bun (`oven/bun` image). Archive browsing, search, channel pages, RSS feed management, social graph and an admin area. Served through Caddy at `http://localhost` in the full stack.

## Local development

Production builds go through Docker (`docker-compose build frontend`, see `CLAUDE.md`). For a dev server against a running API:

```bash
cd services/frontend
bun install
NEXT_PUBLIC_API_URL=http://localhost:8000 bun run dev   # http://localhost:3000
```

The API port is not published by default; uncomment it in `docker-compose.yml` for direct access, or leave `NEXT_PUBLIC_API_URL` empty to use relative URLs behind a proxy.

| Script | Purpose |
|--------|---------|
| `bun run dev` | Dev server |
| `bun run lint` | ESLint 10 (flat config, `eslint.config.mjs`) |
| `bun run type-check` | `tsc --noEmit` |
| `bun run test` / `test:run` | Vitest, watch / single run |
| `bun run build` | Production build (`output: 'standalone'`) |

## Environment

`NEXT_PUBLIC_*` values are baked in at build time; rebuild the image after changing them. Compose passes these as build args:

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Browser-side API base. Empty = relative URLs |
| `NEXT_PUBLIC_BASE_URL` | Set from `PUBLIC_BASE_URL`; used for OpenGraph and absolute URLs |
| `NEXT_PUBLIC_MINIO_URL` | Optional media URL prefix; empty = relative `/media/...` |
| `NEXT_PUBLIC_TRANSLATION_ENABLED` | Set from `TRANSLATION_ENABLED` |
| `NEXT_PUBLIC_RSS_ENABLED` | Enable RSS-related UI (default `false`) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key for the suggest-a-channel form |
| `API_URL` | Server-side API base (runtime; default `http://api:8000`) |

## Layout

| Path | Purpose |
|------|---------|
| `app/` | Pages: `/`, `/search`, `/channels`, `/channels/[username]`, `/messages/[id]`, `/news`, `/about`, `/suggest-channel`, `/auth/login`, `/profile` (`api-keys`, `feeds`, `usage`), `/settings/feed-tokens`, `/admin/*` |
| `components/` | UI components; `ui/` holds shadcn-style primitives, `social-graph/` and `immersive/` have their own READMEs |
| `lib/` | `api.ts` (public client), `admin-api.ts` (admin client with JWT + CSRF), `auth-utils.ts` (`getAuthHeaders()`), `types.ts` |
| `hooks/`, `contexts/` | React Query hooks; Auth, ContentWarning and Immersive providers |

State-changing requests need the `X-CSRF-Token` header. The API clients add it; code that calls `fetch` directly must use `getAuthHeaders()`.

## Notes

- Public archive pages show an 18+ content-warning modal until accepted (`EXEMPT_ROUTES` in `lib/content-warning-config.ts` lists the exceptions).
- Data fetching uses TanStack React Query.
- Tests live next to the code in `__tests__/` folders (Vitest + React Testing Library).
