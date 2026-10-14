# Immersive Components

Site-wide full-screen media viewer (stream and grid modes). Toggled from `HeaderNav` via `useImmersive().toggleImmersive()`; `<ImmersiveProvider>` and `<ImmersiveView />` are mounted in `app/layout.tsx`.

## Files

| File | Purpose |
|------|---------|
| `ImmersiveView.tsx` | Overlay shell; loads messages with media through `hooks/useSmartQueue.ts`; Esc exits |
| `StreamView.tsx` | One message at a time; keyboard navigation; images auto-advance after 8 s (`AUTO_ADVANCE_DELAY`), videos advance on end |
| `GridView.tsx` | Thumbnail grid; clicking a thumbnail switches to stream mode |
| `VideoPlayer.tsx` | Props: `message`, `isPaused`, `isMuted`, `onVideoEnd?`, `onPauseChange?` |
| `GlassPanel.tsx` | Channel and text overlay for a `message` |
| `MediaDots.tsx` | Dots for a multi-media message (`total`, `current`, `onSelect?`) |
| `ImmersiveControls.tsx` | View mode, sort (`newest`/`smart`), skip-watched and RSS layer toggles |
| `RssTicker.tsx` | News ticker (`enabled`); fetches `/api/stream/rss?limit=15&hours=24` |

`index.ts` re-exports all of them. State (view mode, sort mode, layers, queue, viewed ids) lives in `contexts/ImmersiveContext.tsx`.

## Keyboard (stream view)

| Key | Action |
|-----|--------|
| Esc | Exit immersive mode |
| Left / Up | Previous |
| Right / Down | Next |
| Space | Pause / resume |
| M | Mute / unmute |

## Styling

`immersive-overlay` and `immersive-glass` are Tailwind `@utility` classes in `app/globals.css`.
