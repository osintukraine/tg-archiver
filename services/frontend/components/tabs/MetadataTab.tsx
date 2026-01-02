'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Hash, Radio, Calendar, Image as ImageIcon, Languages, Eye, Database, Archive, Network } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import type { Message } from '@/lib/types';

interface MetadataTabProps {
  message: Message;
}

/**
 * Metadata Tab Component
 *
 * Displays post structure and provenance information:
 * - Message identifiers (database ID, Telegram ID)
 * - Channel information (name, username, folder, rule)
 * - Timestamps (created, telegram_date, updated)
 * - Media information (count, type, URLs)
 * - Translation status (language, provider, timestamp, cost)
 * - Social metrics (views, forwards, reactions)
 * - Processing metadata (backfill status, grouped_id)
 * - Archival context (triggered_by, triggered_at, priority)
 * - Social graph context (author, forwards, replies, linked chats)
 */
export function MetadataTab({ message }: MetadataTabProps) {
  const hasMedia = message.media_urls && message.media_urls.length > 0;
  const hasArchivalContext = message.archive_triggered_by || message.archive_triggered_at || message.archive_priority !== null;
  const hasSocialGraphContext = message.author_user_id || message.forward_from_channel_id ||
                                message.forward_from_message_id || message.forward_date ||
                                message.replied_to_message_id || message.linked_chat_id;

  return (
    <div className="space-y-4">
      {/* Message Identifiers */}
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Hash className="h-4 w-4" />
            Message Identifiers
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground dark:text-gray-400">Database ID</span>
            <span className="font-mono font-medium">{message.id}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground dark:text-gray-400">Telegram Message ID</span>
            <span className="font-mono font-medium">{message.message_id}</span>
          </div>
          {message.grouped_id && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground dark:text-gray-400">Album/Group ID</span>
              <span className="font-mono font-medium">{message.grouped_id}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Channel Information */}
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Radio className="h-4 w-4" />
            Channel Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {message.channel && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Channel Name</span>
                <span className="font-medium">{message.channel.name || 'Unknown'}</span>
              </div>
              {message.channel.username && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground dark:text-gray-400">Username</span>
                  <a
                    href={`https://t.me/${message.channel.username}/${message.message_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    @{message.channel.username}
                  </a>
                </div>
              )}
              {message.channel.folder && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground dark:text-gray-400">Folder</span>
                  <Badge variant="outline">{message.channel.folder}</Badge>
                </div>
              )}
              {message.channel.rule && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground dark:text-gray-400">Processing Rule</span>
                  <Badge variant="secondary" className="capitalize">
                    {message.channel.rule.replace('_', ' ')}
                  </Badge>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Channel Status</span>
                <div className="flex gap-1">
                  {message.channel.verified && <Badge variant="default" className="text-xs">Verified</Badge>}
                  {message.channel.scam && <Badge variant="destructive" className="text-xs">Scam</Badge>}
                  {message.channel.fake && <Badge variant="destructive" className="text-xs">Fake</Badge>}
                  {message.channel.restricted && <Badge variant="outline" className="text-xs">Restricted</Badge>}
                  {!message.channel.verified && !message.channel.scam && !message.channel.fake && (
                    <span className="text-xs text-muted-foreground dark:text-gray-400">Standard</span>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Timestamps */}
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Timestamps
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground dark:text-gray-400">Created (Database)</span>
            <span className="font-mono text-xs">
              {new Date(message.created_at).toLocaleString()}
            </span>
          </div>
          {message.telegram_date && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground dark:text-gray-400">Posted (Telegram)</span>
              <span className="font-mono text-xs">
                {new Date(message.telegram_date).toLocaleString()}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground dark:text-gray-400">Last Updated</span>
            <span className="font-mono text-xs">
              {new Date(message.updated_at).toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Media Information */}
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            Media
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground dark:text-gray-400">Media Files</span>
            <span className="font-medium">
              {hasMedia
                ? `${message.media_urls.length} file${message.media_urls.length !== 1 ? 's' : ''}`
                : 'No media'}
            </span>
          </div>
          {message.media_type && hasMedia && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground dark:text-gray-400">Media Type</span>
              <Badge variant="outline" className="capitalize">{message.media_type}</Badge>
            </div>
          )}
          {hasMedia && (
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
              <span className="text-xs text-muted-foreground dark:text-gray-400 block mb-2">Media URLs</span>
              <div className="space-y-1">
                {message.media_urls.map((url, idx) => (
                  <div key={idx} className="text-xs">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline truncate block font-mono"
                    >
                      {url.split('/').pop()?.substring(0, 40) || `Media ${idx + 1}`}...
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Translation Information */}
      {(message.language_detected || message.content_translated) && (
        <Card className="dark:border-gray-700">
          <CardHeader className="pb-3 dark:border-gray-700">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Languages className="h-4 w-4" />
              Translation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {message.language_detected && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Detected Language</span>
                <Badge variant="outline" className="uppercase">{message.language_detected}</Badge>
              </div>
            )}
            {message.content_translated && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground dark:text-gray-400">Translation Available</span>
                  <Badge variant="default">Yes</Badge>
                </div>
                {message.translation_target && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground dark:text-gray-400">Target Language</span>
                    <Badge variant="outline" className="uppercase">{message.translation_target}</Badge>
                  </div>
                )}
                {message.translation_provider && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground dark:text-gray-400">Translation Provider</span>
                    <Badge variant="secondary">{message.translation_provider}</Badge>
                  </div>
                )}
                {message.translation_timestamp && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground dark:text-gray-400">Translation Timestamp</span>
                    <span className="font-mono text-xs">
                      {new Date(message.translation_timestamp).toLocaleString()}
                    </span>
                  </div>
                )}
                {message.translation_cost_usd !== null && message.translation_cost_usd > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground dark:text-gray-400">Translation Cost</span>
                    <span className="font-mono text-xs">
                      ${message.translation_cost_usd.toFixed(4)} USD
                    </span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Social Metrics */}
      {(message.views !== null && message.views !== undefined) ||
       (message.forwards !== null && message.forwards !== undefined) ||
       (message.comments_count > 0) ? (
        <Card className="dark:border-gray-700">
          <CardHeader className="pb-3 dark:border-gray-700">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Social Metrics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {message.views !== null && message.views !== undefined && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Views</span>
                <span className="font-medium">{message.views.toLocaleString()}</span>
              </div>
            )}
            {message.forwards !== null && message.forwards !== undefined && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Forwards</span>
                <span className="font-medium">{message.forwards.toLocaleString()}</span>
              </div>
            )}
            {message.comments_count > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Comments</span>
                <span className="font-medium">{message.comments_count.toLocaleString()}</span>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Processing Status */}
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Database className="h-4 w-4" />
            Processing Status
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground dark:text-gray-400">Backfilled</span>
            <Badge variant={message.is_backfilled ? 'secondary' : 'outline'}>
              {message.is_backfilled ? 'Yes' : 'No'}
            </Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground dark:text-gray-400">Channel ID</span>
            <span className="font-mono font-medium">{message.channel_id}</span>
          </div>
        </CardContent>
      </Card>

      {/* Archival Context */}
      {hasArchivalContext && (
        <Card className="dark:border-gray-700">
          <CardHeader className="pb-3 dark:border-gray-700">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Archive className="h-4 w-4" />
              Archival Context
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {message.archive_triggered_by && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Triggered By Message ID</span>
                <span className="font-mono font-medium">{message.archive_triggered_by}</span>
              </div>
            )}
            {message.archive_triggered_at && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Triggered At</span>
                <span className="font-mono text-xs">
                  {new Date(message.archive_triggered_at).toLocaleString()}
                </span>
              </div>
            )}
            {message.archive_priority !== null && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Archive Priority</span>
                <Badge variant={message.archive_priority >= 50 ? 'default' : 'secondary'}>
                  {message.archive_priority}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Social Graph Context */}
      {hasSocialGraphContext && (
        <Card className="dark:border-gray-700">
          <CardHeader className="pb-3 dark:border-gray-700">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Network className="h-4 w-4" />
              Social Graph Context
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {message.author_user_id && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Author User ID</span>
                <span className="font-mono font-medium">{message.author_user_id}</span>
              </div>
            )}
            {message.forward_from_channel_id && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Forwarded From Channel</span>
                <span className="font-mono font-medium">{message.forward_from_channel_id}</span>
              </div>
            )}
            {message.forward_from_message_id && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Forwarded From Message</span>
                <span className="font-mono font-medium">{message.forward_from_message_id}</span>
              </div>
            )}
            {message.forward_date && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Forward Date</span>
                <span className="font-mono text-xs">
                  {new Date(message.forward_date).toLocaleString()}
                </span>
              </div>
            )}
            {message.replied_to_message_id && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Replied To Message</span>
                <span className="font-mono font-medium">{message.replied_to_message_id}</span>
              </div>
            )}
            {message.linked_chat_id && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Linked Chat ID</span>
                <span className="font-mono font-medium">{message.linked_chat_id}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Message Authenticity Hashing */}
      {(message.content_hash || message.metadata_hash) && (
        <Card className="dark:border-gray-700 border-l-4 border-l-green-500">
          <CardHeader className="pb-3 dark:border-gray-700">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <span className="text-green-600 dark:text-green-400">*</span>
              Message Authenticity
            </CardTitle>
            <p className="text-xs text-muted-foreground dark:text-gray-400 mt-1">
              Cryptographic hashes prove message authenticity and detect tampering
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {message.metadata_hash && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground dark:text-gray-400">
                    Metadata Hash
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(message.metadata_hash || '');
                      // Optional: Show toast notification
                    }}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Copy
                  </button>
                </div>
                <div className="font-mono text-xs bg-muted dark:bg-gray-800 p-2 rounded break-all">
                  {message.metadata_hash}
                </div>
                <p className="text-xs text-muted-foreground dark:text-gray-500">
                  SHA-256 hash of full message metadata (message_id, channel_id, date, content, sender, forward data)
                </p>
              </div>
            )}

            {message.content_hash && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground dark:text-gray-400">
                    Content Hash
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(message.content_hash || '');
                    }}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Copy
                  </button>
                </div>
                <div className="font-mono text-xs bg-muted dark:bg-gray-800 p-2 rounded break-all">
                  {message.content_hash}
                </div>
                <p className="text-xs text-muted-foreground dark:text-gray-500">
                  SHA-256 hash of message content only
                </p>
              </div>
            )}

            <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground dark:text-gray-400 border-t dark:border-gray-700">
              <div>
                <span className="font-medium">Algorithm:</span>{' '}
                <span className="font-mono">{message.hash_algorithm || 'sha256'}</span>
              </div>
              {message.hash_version && (
                <div>
                  <span className="font-medium">Version:</span>{' '}
                  <span className="font-mono">{message.hash_version}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
