'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  MessageSquare,
  Network,
  GitBranch,
  Clock,
  Database,
  Code
} from 'lucide-react';
import type { Message } from '@/lib/types';

// Tab view components
import { ContentView } from './tabs/ContentView';
import { CytoscapeNetworkView } from './tabs/CytoscapeNetworkView';
import { SimilarPostsView } from './tabs/SimilarPostsView';
import { EventTimelineView } from './tabs/EventTimelineView';
import { MetadataTab } from './tabs/MetadataTab';
import { IntelView } from './tabs/IntelView';
import { JSONView } from './tabs/JSONView';

// Social graph components
import { SocialNetworkGraph } from './social-graph/SocialNetworkGraph';
import { CommentThread } from './social-graph/CommentThread';
import { EngagementChart } from './social-graph/EngagementChart';

interface EnhancedPostCardProps {
  message: Message;
  className?: string;
}

// Helper to get country info from channel folder
function getCountryInfo(folder: string | null | undefined): { flag: string; label: string; color: string } | null {
  if (!folder) return null;

  const folderUpper = folder.toUpperCase();

  if (folderUpper.includes('-UA')) {
    return { flag: '🇺🇦', label: 'UA', color: 'text-blue-400' };
  }

  if (folderUpper.includes('-RU')) {
    return { flag: '🇷🇺', label: 'RU', color: 'text-red-400' };
  }

  return null;
}

// Helper to get country border class for hover effect
function getCountryBorderClass(folder: string | null | undefined): string {
  if (!folder) return 'country-border-unaffiliated';

  const folderUpper = folder.toUpperCase();

  if (folderUpper.includes('-UA')) {
    return 'country-border-ua';
  }

  if (folderUpper.includes('-RU')) {
    return 'country-border-ru';
  }

  return 'country-border-unaffiliated';
}

// Helper to get importance badge styling
function getImportanceBadge(importance: string | null): { color: string; label: string; bgColor: string } {
  if (importance === 'high') return {
    color: 'text-white',
    label: '🔴 High Priority',
    bgColor: 'bg-red-500'
  };
  if (importance === 'medium') return {
    color: 'text-white',
    label: '🟡 Medium Priority',
    bgColor: 'bg-yellow-600'
  };
  if (importance === 'low') return {
    color: 'text-white',
    label: '⚪ Low Priority',
    bgColor: 'bg-gray-500'
  };
  return {
    color: 'text-gray-400',
    label: 'No Keywords',
    bgColor: 'bg-gray-300'
  };
}

export function EnhancedPostCard({ message, className = '' }: EnhancedPostCardProps) {
  const [activeTab, setActiveTab] = useState('content');
  const [networkSubTab, setNetworkSubTab] = useState('entities');
  const countryInfo = getCountryInfo(message.channel?.folder);
  const countryBorderClass = getCountryBorderClass(message.channel?.folder);

  return (
    <Card className={`enhanced-post-card ${countryBorderClass} ${className}`}>
      <CardHeader className="pb-2 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Country Flag - Prominent Display */}
            {countryInfo && (
              <span
                className={`${countryInfo.color} text-xl font-bold flex-shrink-0`}
                title={`Source: ${message.channel?.folder || 'Unknown'}`}
              >
                {countryInfo.flag}
              </span>
            )}

            <span className="text-sm font-medium text-muted-foreground dark:text-gray-400">
              Message #{message.id}
            </span>

            {/* Topic Badge with Color */}
            {message.osint_topic && (
              <span className={`topic-${message.osint_topic.toLowerCase()} text-xs`}>
                {message.osint_topic}
              </span>
            )}

            {/* Importance Badge */}
            {message.importance_level && (
              <span className={`text-xs px-2 py-1 rounded ${getImportanceBadge(message.importance_level).bgColor} ${getImportanceBadge(message.importance_level).color}`}>
                {getImportanceBadge(message.importance_level).label}
              </span>
            )}

            {/* Keyword Count (for debugging) - FIXED: Use proper null check to avoid rendering 0 */}
            {(message.keyword_match_count ?? 0) > 0 && (
              <span className="text-xs text-muted-foreground dark:text-gray-400 ml-2">
                🔑 {message.keyword_match_count} keywords
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
            <TabsList className="inline-flex w-auto min-w-full sm:grid sm:grid-cols-7 sm:w-full">
              <TabsTrigger value="content" className="flex items-center gap-1 px-2 sm:px-3">
                <MessageSquare className="h-4 w-4 flex-shrink-0" />
                <span className="hidden sm:inline">Content</span>
              </TabsTrigger>
              <TabsTrigger value="network" className="flex items-center gap-1 px-2 sm:px-3">
                <Network className="h-4 w-4 flex-shrink-0" />
                <span className="hidden sm:inline">Network</span>
              </TabsTrigger>
              <TabsTrigger value="similar" className="flex items-center gap-1 px-2 sm:px-3">
                <GitBranch className="h-4 w-4 flex-shrink-0" />
                <span className="hidden sm:inline">Related</span>
              </TabsTrigger>
              <TabsTrigger value="timeline" className="flex items-center gap-1 px-2 sm:px-3">
                <Clock className="h-4 w-4 flex-shrink-0" />
                <span className="hidden sm:inline">Timeline</span>
              </TabsTrigger>
              <TabsTrigger value="metadata" className="flex items-center gap-1 px-2 sm:px-3">
                <Database className="h-4 w-4 flex-shrink-0" />
                <span className="hidden sm:inline">Metadata</span>
              </TabsTrigger>
              <TabsTrigger value="intel" className="flex items-center gap-1 px-2 sm:px-3">
                <Database className="h-4 w-4 flex-shrink-0" />
                <span className="hidden sm:inline">Intel</span>
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

            <TabsContent value="network" className="mt-0">
              {/* Sub-tabs for Network: Entities vs Social */}
              <Tabs value={networkSubTab} onValueChange={setNetworkSubTab} className="w-full">
                <TabsList className="grid grid-cols-2 w-full mb-4">
                  <TabsTrigger value="entities" className="flex items-center gap-1">
                    <Network className="h-4 w-4" />
                    <span>Entities</span>
                  </TabsTrigger>
                  <TabsTrigger value="social" className="flex items-center gap-1">
                    <GitBranch className="h-4 w-4" />
                    <span>Social</span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="entities" className="mt-0">
                  <CytoscapeNetworkView message={message} />
                </TabsContent>

                <TabsContent value="social" className="mt-0 space-y-6">
                  {/* Social Network Graph with comprehensive metrics */}
                  <SocialNetworkGraph messageId={message.id} />

                  {/* Comment Thread with translation support */}
                  {message.has_comments && (
                    <CommentThread messageId={message.id} />
                  )}
                </TabsContent>
              </Tabs>
            </TabsContent>

            <TabsContent value="similar" className="mt-0">
              <SimilarPostsView message={message} />
            </TabsContent>

            <TabsContent value="timeline" className="mt-0">
              <EventTimelineView message={message} />
            </TabsContent>

            <TabsContent value="metadata" className="mt-0">
              <MetadataTab message={message} />
            </TabsContent>

            <TabsContent value="intel" className="mt-0">
              <IntelView message={message} />
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
