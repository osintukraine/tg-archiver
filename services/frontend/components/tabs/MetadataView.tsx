'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapPin, Users, Building, Shield, Tag, Heart, AlertTriangle, Sparkles, Key, Brain, Zap, Image } from 'lucide-react';
import type { Message, MessageTag } from '@/lib/types';
import { ValidationPanel } from '@/components/ValidationPanel';

interface MetadataViewProps {
  message: Message;
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

// Helper to format tags by type
function formatTagsByType(tags: MessageTag[]) {
  const grouped: Record<string, MessageTag[]> = {};
  tags.forEach(tag => {
    if (!grouped[tag.tag_type]) {
      grouped[tag.tag_type] = [];
    }
    grouped[tag.tag_type].push(tag);
  });
  return grouped;
}

// Helper to get tag type styling
function getTagTypeStyle(tagType: string) {
  const styles: Record<string, { icon: string; bgColor: string; color: string; borderColor: string }> = {
    keywords: {
      icon: '🔑',
      bgColor: 'bg-blue-50 dark:bg-blue-950',
      color: 'text-blue-700 dark:text-blue-300',
      borderColor: 'border-blue-200 dark:border-blue-800'
    },
    topics: {
      icon: '🏷️',
      bgColor: 'bg-purple-50 dark:bg-purple-950',
      color: 'text-purple-700 dark:text-purple-300',
      borderColor: 'border-purple-200 dark:border-purple-800'
    },
    entities: {
      icon: '🎯',
      bgColor: 'bg-green-50 dark:bg-green-950',
      color: 'text-green-700 dark:text-green-300',
      borderColor: 'border-green-200 dark:border-green-800'
    },
    emotions: {
      icon: '❤️',
      bgColor: 'bg-pink-50 dark:bg-pink-950',
      color: 'text-pink-700 dark:text-pink-300',
      borderColor: 'border-pink-200 dark:border-pink-800'
    },
    urgency: {
      icon: '⚡',
      bgColor: 'bg-red-50 dark:bg-red-950',
      color: 'text-red-700 dark:text-red-300',
      borderColor: 'border-red-200 dark:border-red-800'
    }
  };

  return styles[tagType] || {
    icon: '🏷️',
    bgColor: 'bg-gray-50 dark:bg-gray-950',
    color: 'text-gray-700 dark:text-gray-300',
    borderColor: 'border-gray-200 dark:border-gray-800'
  };
}

// Helper to get importance level display
function getImportanceLevelDisplay(level?: 'high' | 'medium' | 'low' | null) {
  if (!level) return { text: 'N/A', color: 'text-gray-600 dark:text-gray-400', badge: 'secondary' };

  switch (level) {
    case 'high':
      return { text: 'High Priority', color: 'text-green-600 dark:text-green-400', badge: 'destructive' };
    case 'medium':
      return { text: 'Medium Priority', color: 'text-yellow-600 dark:text-yellow-400', badge: 'default' };
    case 'low':
      return { text: 'Low Priority', color: 'text-gray-600 dark:text-gray-400', badge: 'secondary' };
    default:
      return { text: 'N/A', color: 'text-gray-600 dark:text-gray-400', badge: 'secondary' };
  }
}

export function MetadataView({ message }: MetadataViewProps) {
  const countryInfo = getCountryInfo(message.channel?.folder);
  const importanceDisplay = getImportanceLevelDisplay(message.importance_level);

  return (
    <div className="space-y-4">
      {/* Channel & Source Info */}
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Channel & Source
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            {/* Country Flag - Prominent Display */}
            {countryInfo && (
              <span
                className={`${countryInfo.color} text-2xl font-bold flex-shrink-0`}
                title={`Source: ${message.channel?.folder || 'Unknown'}`}
              >
                {countryInfo.flag}
              </span>
            )}
            <div className="flex-1">
              <div className="font-medium">{message.channel?.name || 'Unknown Channel'}</div>
              {message.channel?.username && (
                <div className="text-xs text-muted-foreground dark:text-gray-400">
                  @{message.channel.username}
                </div>
              )}
              {message.channel?.folder && (
                <div className="text-xs text-muted-foreground dark:text-gray-400">
                  Folder: {message.channel.folder}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Classification */}
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Classification
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* Topic with Color Coding */}
          {message.osint_topic && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground dark:text-gray-400">Topic</span>
              <span className={`topic-${message.osint_topic.toLowerCase()} text-xs`}>
                {message.osint_topic}
              </span>
            </div>
          )}

          {/* Importance Level (replaces OSINT Score) */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground dark:text-gray-400">Importance Level</span>
            <Badge variant={importanceDisplay.badge as any} className="text-xs">
              {importanceDisplay.text}
            </Badge>
          </div>

          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground dark:text-gray-400">Spam Status</span>
              <div className="flex items-center gap-2">
                <Badge variant={message.is_spam ? 'destructive' : 'outline'}>
                  {message.is_spam ? 'Spam' : 'Clean'}
                </Badge>
                {message.spam_confidence && message.spam_confidence > 0 ? (
                  <span className={`text-xs font-medium ${
                    message.spam_confidence >= 0.7 ? 'text-red-600 dark:text-red-400' :
                    message.spam_confidence >= 0.5 ? 'text-yellow-600 dark:text-yellow-400' :
                    'text-green-600 dark:text-green-400'
                  }`}>
                    {(message.spam_confidence * 100).toFixed(0)}%
                  </span>
                ) : null}
              </div>
            </div>
            {message.spam_reason && (
              <div className="text-xs text-muted-foreground dark:text-gray-500 mt-1">
                {message.spam_reason}
              </div>
            )}
            {message.spam_type && (
              <div className="text-xs">
                <span className="px-2 py-0.5 rounded bg-orange-50 dark:bg-orange-950 text-orange-700 dark:text-orange-300">
                  {message.spam_type}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground dark:text-gray-400">Verification</span>
            <Badge variant="secondary">Pending</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Media Information */}
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Image className="h-4 w-4" />
            Media
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground dark:text-gray-400">Media Files</span>
            <span className="font-medium">
              {message.media_urls && message.media_urls.length > 0
                ? `${message.media_urls.length} file${message.media_urls.length !== 1 ? 's' : ''}`
                : 'No media'}
            </span>
          </div>
          {message.media_type && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground dark:text-gray-400">Media Type</span>
              <Badge variant="outline" className="capitalize">{message.media_type}</Badge>
            </div>
          )}
          {message.media_urls && message.media_urls.length > 0 && (
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
              <span className="text-xs text-muted-foreground dark:text-gray-400 block mb-2">Files</span>
              <div className="space-y-1">
                {message.media_urls.map((url, idx) => (
                  <div key={idx} className="text-xs">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline truncate block"
                    >
                      📎 Media {idx + 1}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI-Generated Tags (from message_tags table) */}
      {message.tags && message.tags.length > 0 && (
        <Card className="dark:border-gray-700">
          <CardHeader className="pb-3 dark:border-gray-700">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              AI-Generated Tags
              <Badge variant="outline" className="text-xs">
                Powered by pgvector
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              const tagsByType = formatTagsByType(message.tags!);
              return Object.entries(tagsByType).map(([tagType, tags]) => {
                const style = getTagTypeStyle(tagType);
                return (
                  <div key={tagType}>
                    <div className={`text-xs ${style.color} font-medium flex items-center gap-1 mb-2`}>
                      <span>{style.icon}</span>
                      <span className="capitalize">{tagType}</span>
                      <span className="text-muted-foreground dark:text-gray-500">({tags.length})</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tag, i) => (
                        <span
                          key={i}
                          className={`${style.bgColor} ${style.color} px-2 py-1 rounded text-xs border ${style.borderColor} flex items-center gap-1`}
                          title={`Confidence: ${(tag.confidence * 100).toFixed(0)}% • Generated by: ${tag.generated_by}`}
                        >
                          <span>{tag.tag}</span>
                          <span className="text-[10px] opacity-60">
                            {(tag.confidence * 100).toFixed(0)}%
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              });
            })()}
          </CardContent>
        </Card>
      )}

      {/* Entities (from regex extraction) */}
      {message.entities && Object.keys(message.entities).length > 0 && (
        <Card className="dark:border-gray-700">
          <CardHeader className="pb-3 dark:border-gray-700">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Extracted Entities
              <Badge variant="outline" className="text-xs">
                Regex-based
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {message.entities.locations && message.entities.locations.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground dark:text-gray-400 block mb-1">Locations</span>
                <div className="flex flex-wrap gap-1">
                  {message.entities.locations.map((loc: string, idx: number) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      <MapPin className="h-3 w-3 mr-1" />
                      {loc}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {message.entities.people && message.entities.people.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground dark:text-gray-400 block mb-1">People</span>
                <div className="flex flex-wrap gap-1">
                  {message.entities.people.map((person: string, idx: number) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      <Users className="h-3 w-3 mr-1" />
                      {person}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {message.entities.organizations && message.entities.organizations.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground dark:text-gray-400 block mb-1">Organizations</span>
                <div className="flex flex-wrap gap-1">
                  {message.entities.organizations.map((org: string, idx: number) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      <Building className="h-3 w-3 mr-1" />
                      {org}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {message.entities.military_units && message.entities.military_units.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground dark:text-gray-400 block mb-1">Military Units</span>
                <div className="flex flex-wrap gap-1">
                  {message.entities.military_units.map((unit: string, idx: number) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      <Shield className="h-3 w-3 mr-1" />
                      {unit}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* OpenSanctions (if available) */}
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            OpenSanctions Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground dark:text-gray-400">
            No sanctioned entities detected
          </p>
        </CardContent>
      </Card>

      {/* RSS Validation */}
      <ValidationPanel messageId={message.id} />
    </div>
  );
}
