'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, Download, Check } from 'lucide-react';
import type { Message } from '@/lib/types';

interface JSONViewProps {
  message: Message;
}

/**
 * Filter message data to show only relevant, non-null fields.
 * Removes deprecated fields, internal tracking, and null values for cleaner output.
 */
function getCleanMessageData(message: Message): Record<string, unknown> {
  const clean: Record<string, unknown> = {};

  // Core identification
  clean.id = message.id;
  clean.message_id = message.message_id;
  clean.channel_id = message.channel_id;
  if (message.telegram_date) clean.telegram_date = message.telegram_date;

  // Content
  if (message.content) clean.content = message.content;
  if (message.content_translated) clean.content_translated = message.content_translated;
  if (message.language_detected) clean.language_detected = message.language_detected;

  // Translation metadata (only if translated)
  if (message.content_translated) {
    if (message.translation_provider) clean.translation_provider = message.translation_provider;
    if (message.translation_target) clean.translation_target = message.translation_target;
  }

  // Topic classification
  if (message.topic) clean.topic = message.topic;

  // Engagement metrics
  if (message.views) clean.views = message.views;
  if (message.forwards) clean.forwards = message.forwards;

  // Media (only if present)
  if (message.media_type) {
    clean.media = {
      type: message.media_type,
      ...(message.media_items?.length && { items: message.media_items }),
      ...(message.grouped_id && { grouped_id: message.grouped_id }),
    };
  }

  // Social graph (only if present)
  const social: Record<string, unknown> = {};
  if (message.author_user_id) social.author_user_id = message.author_user_id;
  if (message.replied_to_message_id) social.replied_to_message_id = message.replied_to_message_id;
  if (message.forward_from_channel_id) {
    social.forwarded_from = {
      channel_id: message.forward_from_channel_id,
      message_id: message.forward_from_message_id,
      date: message.forward_date,
    };
  }
  if (message.has_comments) {
    social.comments = {
      has_comments: true,
      count: message.comments_count,
      linked_chat_id: message.linked_chat_id,
    };
  }
  if (Object.keys(social).length) clean.social = social;

  // Spam detection (only if flagged)
  if (message.is_spam) {
    clean.spam = {
      is_spam: true,
      ...(message.spam_confidence && { confidence: message.spam_confidence }),
      ...(message.spam_reason && { reason: message.spam_reason }),
      ...(message.spam_type && { type: message.spam_type }),
    };
  }

  // Extracted entities (hashtags, mentions, URLs)
  if (message.entities && Object.keys(message.entities).length) {
    clean.entities = message.entities;
  }

  // AI-generated tags
  if (message.tags?.length) {
    clean.tags = message.tags;
  }

  // Content authenticity hashes (only if present)
  if (message.content_hash || message.metadata_hash) {
    clean.hashes = {
      ...(message.content_hash && { content: message.content_hash }),
      ...(message.metadata_hash && { metadata: message.metadata_hash }),
      ...(message.hash_algorithm && { algorithm: message.hash_algorithm }),
    };
  }

  // Channel info (if embedded)
  if (message.channel) {
    clean.channel = {
      id: message.channel.id,
      telegram_id: message.channel.telegram_id,
      username: message.channel.username,
      name: message.channel.name,
      ...(message.channel.verified && { verified: true }),
    };
  }

  // Timestamps
  clean.created_at = message.created_at;
  if (message.updated_at !== message.created_at) {
    clean.updated_at = message.updated_at;
  }
  if (message.is_backfilled) clean.is_backfilled = true;

  return clean;
}

export function JSONView({ message }: JSONViewProps) {
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const displayData = showRaw ? message : getCleanMessageData(message);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(displayData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([JSON.stringify(displayData, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `message-${message.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-medium">API Response</h3>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={showRaw}
              onChange={(e) => setShowRaw(e.target.checked)}
              className="rounded border-gray-300"
            />
            Show all fields
          </label>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="flex items-center gap-2"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copy
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            className="flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Download
          </Button>
        </div>
      </div>

      <div className="bg-slate-950 text-slate-50 p-4 rounded-lg overflow-x-auto">
        <pre className="text-xs font-mono">
          <code>{JSON.stringify(displayData, null, 2)}</code>
        </pre>
      </div>

      <div className="text-xs text-muted-foreground">
        <p>API Endpoint: <code className="bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">GET /api/messages/{message.id}</code></p>
      </div>
    </div>
  );
}
