# Immersive Media Player Components

Full-viewport media player for OSINT Intelligence Platform's immersive viewing mode.

## Components

### ImmersiveMediaPlayer
Main container component that manages the immersive viewing experience.

**Features:**
- Full viewport (100vh/100vw, fixed position)
- Dark background with glass overlay panels
- Message queue navigation
- Keyboard controls (Esc, arrows, space, M)
- Auto-advance for images (8s default)
- Videos auto-advance on end
- Play/pause and mute controls
- Progress indicator

**Usage:**
```tsx
import { ImmersiveMediaPlayer } from '@/components/immersive/ImmersiveMediaPlayer';

function MyComponent() {
  const [showPlayer, setShowPlayer] = useState(false);
  const [currentMessage, setCurrentMessage] = useState<Message | null>(null);

  return (
    <>
      {/* Your regular content */}
      <button onClick={() => {
        setCurrentMessage(message);
        setShowPlayer(true);
      }}>
        View in Immersive Mode
      </button>

      {/* Immersive player */}
      {showPlayer && currentMessage && (
        <ImmersiveMediaPlayer
          initialMessage={currentMessage}
          messages={messageQueue}  // Optional: array of messages to navigate
          onClose={() => setShowPlayer(false)}
          autoAdvance={true}  // Optional: default true
          autoAdvanceDelay={8000}  // Optional: milliseconds, default 8000
        />
      )}
    </>
  );
}
```

### MediaRenderer
Handles full-screen display of images, videos, and documents.

**Features:**
- Full viewport object-cover display
- Videos auto-play MUTED (browser requirement)
- Video onEnded callback
- Loading states and error handling
- Respects pause/mute states

**Usage:**
```tsx
import { MediaRenderer } from '@/components/immersive/MediaRenderer';

<MediaRenderer
  mediaUrl={mediaUrl}
  mediaType="video"
  onVideoEnd={() => console.log('Video ended')}
  isPaused={false}
  isMuted={true}
/>
```

### useAutoAdvance Hook
Timer hook for managing auto-advance functionality.

**Features:**
- Countdown timer with millisecond precision
- Pause/resume support
- Reset function
- Returns remaining time for progress bars

**Usage:**
```tsx
import { useAutoAdvance } from '@/hooks/useAutoAdvance';

const { remainingTime, reset } = useAutoAdvance(
  enabled,        // boolean
  8000,          // delay in ms
  handleAdvance, // callback
  isPaused       // optional pause state
);

// Use remainingTime for progress indicators
const progress = ((8000 - remainingTime) / 8000) * 100;
```

## Keyboard Controls

| Key | Action |
|-----|--------|
| Esc | Close player |
| Left Arrow | Previous message |
| Right Arrow | Next message |
| Space | Play/Pause |
| M | Mute/Unmute (videos only) |

## CSS Classes

Added to `app/globals.css`:

```css
.immersive-overlay {
  backdrop-filter: blur(16px);
  background: rgba(0, 0, 0, 0.7);
}

.immersive-glass {
  backdrop-filter: blur(12px);
  background: rgba(15, 20, 25, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.75rem;
}
```

## Design Patterns

### Auto-Advance Logic
- **Images**: Use timer hook with configurable delay (default 8s)
- **Videos**: Auto-advance on video `onEnded` event
- **Documents**: No auto-advance (user must navigate manually)

### Media Type Detection
1. Check `message.media_items[0].media_type` (preferred)
2. Fallback to extension-based detection
3. Audio types map to 'document' for rendering

### Browser Auto-Play Requirements
Videos MUST start muted for auto-play to work:
```tsx
<video autoPlay muted={true} ... />
```
User can unmute with 'M' key after playback starts.

## Integration Example

Full example showing integration with PostCard:

```tsx
'use client';

import { useState } from 'react';
import { PostCard } from '@/components/PostCard';
import { ImmersiveMediaPlayer } from '@/components/immersive/ImmersiveMediaPlayer';
import type { Message } from '@/lib/types';

export function MessageFeed({ messages }: { messages: Message[] }) {
  const [immersiveMessage, setImmersiveMessage] = useState<Message | null>(null);

  // Filter messages with media for the queue
  const messagesWithMedia = messages.filter(m =>
    m.first_media_url || (m.media_urls && m.media_urls.length > 0)
  );

  return (
    <>
      <div className="space-y-4">
        {messages.map(message => (
          <PostCard
            key={message.id}
            message={message}
            density="detailed"
            onClick={() => {
              // Only show immersive player if message has media
              if (message.first_media_url || message.media_urls?.length) {
                setImmersiveMessage(message);
              }
            }}
          />
        ))}
      </div>

      {immersiveMessage && (
        <ImmersiveMediaPlayer
          initialMessage={immersiveMessage}
          messages={messagesWithMedia}
          onClose={() => setImmersiveMessage(null)}
        />
      )}
    </>
  );
}
```

## Technical Notes

### Z-Index Layering
- ImmersiveMediaPlayer: `z-[200]`
- MediaLightbox: `z-[100]`
- Regular modals: `z-50`

### Performance
- Images preload adjacent items for smooth navigation
- Videos use `preload="metadata"` for faster startup
- Auto-hide controls after 3s of inactivity

### Accessibility
- Keyboard navigation fully supported
- Visual progress indicators
- Clear control labels with tooltips
- ARIA labels on interactive elements

### Mobile Considerations
- Touch swipe support (TODO: future enhancement)
- `playsInline` attribute for iOS
- Full viewport on mobile devices
- Controls auto-hide for clean viewing
