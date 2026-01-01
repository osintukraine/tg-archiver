'use client';

/**
 * Message List Component
 *
 * Client-side wrapper for message browsing with configurable density
 * Supports compact, detailed, and immersive view modes
 */

import { PostCard } from './PostCard';
import type { Message, DensityMode } from '@/lib/types';

interface MessageListProps {
  messages: Message[];
  density?: DensityMode;
}

export function MessageList({ messages, density = 'compact' }: MessageListProps) {
  return (
    <div className="space-y-4">
      {/* Messages */}
      {messages.map((message) => (
        <a
          key={message.id}
          href={`/messages/${message.id}`}
          className="block hover:opacity-90 transition-opacity"
        >
          <PostCard
            message={message}
            channel={message.channel}
            density={density}
          />
        </a>
      ))}
    </div>
  );
}
