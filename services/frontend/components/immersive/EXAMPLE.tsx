'use client';

/**
 * ImmersiveMediaPlayer Integration Example
 *
 * This example demonstrates how to integrate the ImmersiveMediaPlayer
 * into your pages. Copy and adapt this pattern for your use case.
 */

import { useState } from 'react';
import { ImmersiveMediaPlayer } from './ImmersiveMediaPlayer';
import type { Message } from '@/lib/types';

export function ExampleMessageView({ messages }: { messages: Message[] }) {
  const [immersiveMessage, setImmersiveMessage] = useState<Message | null>(null);

  // Filter messages with media for the immersive queue
  const messagesWithMedia = messages.filter(m =>
    m.first_media_url || (m.media_urls && m.media_urls.length > 0)
  );

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Messages with Media</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {messagesWithMedia.map((message) => (
          <button
            key={message.id}
            className="group relative aspect-video rounded-lg overflow-hidden bg-bg-secondary hover:ring-2 hover:ring-accent-primary transition-all cursor-pointer"
            onClick={() => setImmersiveMessage(message)}
          >
            {/* Thumbnail */}
            {message.first_media_url && (
              <div className="absolute inset-0">
                {/* For images */}
                {message.media_items?.[0]?.media_type === 'image' ? (
                  <img
                    src={message.first_media_url}
                    alt="Media thumbnail"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  /* For videos - show play icon */
                  <div className="w-full h-full bg-black flex items-center justify-center">
                    <svg
                      className="w-16 h-16 text-white opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                    </svg>
                  </div>
                )}
              </div>
            )}

            {/* Overlay with metadata */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <p className="text-white text-sm font-medium line-clamp-2">
                {message.content || 'No caption'}
              </p>
              <p className="text-gray-300 text-xs mt-1">
                {message.channel?.name || `Channel ${message.channel_id}`}
              </p>
            </div>

            {/* Media count badge */}
            {message.media_urls && message.media_urls.length > 1 && (
              <div className="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                +{message.media_urls.length - 1}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {messagesWithMedia.length === 0 && (
        <div className="text-center py-12 text-text-tertiary">
          <svg
            className="w-16 h-16 mx-auto mb-4 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <p>No messages with media found</p>
        </div>
      )}

      {/* Immersive Player - Renders full-screen when message is selected */}
      {immersiveMessage && (
        <ImmersiveMediaPlayer
          initialMessage={immersiveMessage}
          messages={messagesWithMedia}
          onClose={() => setImmersiveMessage(null)}
          autoAdvance={true}
          autoAdvanceDelay={8000}
        />
      )}
    </div>
  );
}

/**
 * Alternative: Add immersive button to existing PostCard
 *
 * You can also add a button to your existing PostCard components:
 */
export function PostCardWithImmersive({ message }: { message: Message }) {
  const [showImmersive, setShowImmersive] = useState(false);

  const hasMedia = message.first_media_url || (message.media_urls && message.media_urls.length > 0);

  return (
    <>
      <div className="glass p-4 rounded-lg">
        {/* Your existing PostCard content */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium">{message.channel?.name}</h3>

          {/* Add immersive mode button */}
          {hasMedia && (
            <button
              onClick={() => setShowImmersive(true)}
              className="p-2 rounded hover:bg-bg-secondary transition-colors"
              title="View in immersive mode"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
                />
              </svg>
            </button>
          )}
        </div>

        <p className="text-sm">{message.content}</p>
      </div>

      {showImmersive && (
        <ImmersiveMediaPlayer
          initialMessage={message}
          onClose={() => setShowImmersive(false)}
        />
      )}
    </>
  );
}

/**
 * Usage in a page:
 *
 * import { ExampleMessageView } from '@/components/immersive/EXAMPLE';
 *
 * export default async function MyPage() {
 *   const messages = await fetchMessages();
 *
 *   return <ExampleMessageView messages={messages} />;
 * }
 */
