'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  MessageSquare,
  GitBranch,
  Database,
  Code
} from 'lucide-react';
import type { Message } from '@/lib/types';

// Tab view components
import { ContentView } from './tabs/ContentView';
import { MetadataTab } from './tabs/MetadataTab';
import { JSONView } from './tabs/JSONView';

// Social graph components
import { SocialNetworkGraph } from './social-graph/SocialNetworkGraph';
import { CommentThread } from './social-graph/CommentThread';
import { EngagementChart } from './social-graph/EngagementChart';

interface EnhancedPostCardProps {
  message: Message;
  className?: string;
}

export function EnhancedPostCard({ message, className = '' }: EnhancedPostCardProps) {
  const [activeTab, setActiveTab] = useState('content');

  return (
    <Card className={`enhanced-post-card ${className}`}>
      <CardHeader className="pb-2 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground dark:text-gray-400">
              Message #{message.id}
            </span>

            {/* Topic Badge with Color */}
            {message.topic && (
              <span className={`topic-${message.topic.toLowerCase()} text-xs`}>
                {message.topic}
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground dark:text-gray-400" title="Original posting date on Telegram">
            {new Date(message.telegram_date || message.created_at).toLocaleString()}
          </span>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="overflow-x-auto -mx-2 px-2">
            <TabsList className="inline-flex w-auto min-w-full sm:grid sm:grid-cols-4 sm:w-full">
              <TabsTrigger value="content" className="flex items-center gap-1 px-2 sm:px-3">
                <MessageSquare className="h-4 w-4 flex-shrink-0" />
                <span className="hidden sm:inline">Content</span>
              </TabsTrigger>
              <TabsTrigger value="social" className="flex items-center gap-1 px-2 sm:px-3">
                <GitBranch className="h-4 w-4 flex-shrink-0" />
                <span className="hidden sm:inline">Social</span>
              </TabsTrigger>
              <TabsTrigger value="metadata" className="flex items-center gap-1 px-2 sm:px-3">
                <Database className="h-4 w-4 flex-shrink-0" />
                <span className="hidden sm:inline">Metadata</span>
              </TabsTrigger>
              <TabsTrigger value="json" className="flex items-center gap-1 px-2 sm:px-3">
                <Code className="h-4 w-4 flex-shrink-0" />
                <span className="hidden sm:inline">Raw</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="mt-4">
            <TabsContent value="content" className="mt-0">
              <ContentView message={message} />
            </TabsContent>

            <TabsContent value="social" className="mt-0 space-y-6">
              {/* Social Network Graph with comprehensive metrics */}
              <SocialNetworkGraph messageId={message.id} />

              {/* Comment Thread with translation support */}
              {message.has_comments && (
                <CommentThread messageId={message.id} />
              )}

              {/* Engagement Chart */}
              <EngagementChart messageId={message.id} />
            </TabsContent>


            <TabsContent value="metadata" className="mt-0">
              <MetadataTab message={message} />
            </TabsContent>

            <TabsContent value="json" className="mt-0">
              <JSONView message={message} />
            </TabsContent>
          </div>
        </Tabs>
      </CardContent>
    </Card>
  );
}
