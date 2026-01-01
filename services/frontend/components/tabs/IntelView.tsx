'use client';

import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapPin, Users, Building, Shield, Tag, Heart, AlertTriangle, Sparkles, Key, Brain, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import type { Message, MessageTag, OpenSanctionsEntityMatch, CuratedEntityMatch } from '@/lib/types';
import { ValidationPanel } from '@/components/ValidationPanel';
import SentimentBadge from '@/components/SentimentBadge';
import UrgencyMeter from '@/components/UrgencyMeter';
import ReviewStatusBadge from '@/components/ReviewStatusBadge';

interface IntelViewProps {
  message: Message;
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

// Helper to get risk classification styling for OpenSanctions entities
function getRiskClassificationStyle(riskClassification: string) {
  const styles: Record<string, { icon: string; bgColor: string; color: string; borderColor: string; label: string }> = {
    sanctioned: {
      icon: '🚫',
      bgColor: 'bg-red-100 dark:bg-red-950',
      color: 'text-red-800 dark:text-red-200',
      borderColor: 'border-red-300 dark:border-red-700',
      label: 'Sanctioned'
    },
    pep: {
      icon: '👔',
      bgColor: 'bg-amber-100 dark:bg-amber-950',
      color: 'text-amber-800 dark:text-amber-200',
      borderColor: 'border-amber-300 dark:border-amber-700',
      label: 'PEP'  // Politically Exposed Person
    },
    criminal: {
      icon: '⚠️',
      bgColor: 'bg-orange-100 dark:bg-orange-950',
      color: 'text-orange-800 dark:text-orange-200',
      borderColor: 'border-orange-300 dark:border-orange-700',
      label: 'Criminal'
    },
    corporate: {
      icon: '🏢',
      bgColor: 'bg-slate-100 dark:bg-slate-800',
      color: 'text-slate-700 dark:text-slate-200',
      borderColor: 'border-slate-300 dark:border-slate-600',
      label: 'Corporate'
    }
  };

  return styles[riskClassification] || {
    icon: '❓',
    bgColor: 'bg-gray-100 dark:bg-gray-800',
    color: 'text-gray-700 dark:text-gray-300',
    borderColor: 'border-gray-300 dark:border-gray-600',
    label: riskClassification
  };
}

// Helper to get topic emoji
function getTopicEmoji(topic: string): string {
  const emojis: Record<string, string> = {
    // Conflict-related topics (12 total)
    combat: '⚔️',
    military_equipment: '🛡️',
    casualties: '💀',
    territorial_control: '🗺️',
    humanitarian: '🏥',
    civilians: '👥',
    infrastructure: '🏗️',
    political: '🏛️',
    diplomatic: '🤝',
    economic: '💰',
    propaganda: '📢',
    general: '📝',
    // Default
    unknown: '❓'
  };
  return emojis[topic.toLowerCase()] || '📋';
}

// Helper to get curated entity type styling
function getCuratedEntityStyle(entityType: string) {
  const styles: Record<string, { icon: string; bgColor: string; color: string; borderColor: string }> = {
    equipment: {
      icon: '🛡️',
      bgColor: 'bg-orange-50 dark:bg-orange-950',
      color: 'text-orange-700 dark:text-orange-300',
      borderColor: 'border-orange-200 dark:border-orange-800'
    },
    individual: {
      icon: '👤',
      bgColor: 'bg-purple-50 dark:bg-purple-950',
      color: 'text-purple-700 dark:text-purple-300',
      borderColor: 'border-purple-200 dark:border-purple-800'
    },
    organization: {
      icon: '🏢',
      bgColor: 'bg-blue-50 dark:bg-blue-950',
      color: 'text-blue-700 dark:text-blue-300',
      borderColor: 'border-blue-200 dark:border-blue-800'
    },
    location: {
      icon: '📍',
      bgColor: 'bg-green-50 dark:bg-green-950',
      color: 'text-green-700 dark:text-green-300',
      borderColor: 'border-green-200 dark:border-green-800'
    },
    military_unit: {
      icon: '⚔️',
      bgColor: 'bg-red-50 dark:bg-red-950',
      color: 'text-red-700 dark:text-red-300',
      borderColor: 'border-red-200 dark:border-red-800'
    },
    ship: {
      icon: '🚢',
      bgColor: 'bg-cyan-50 dark:bg-cyan-950',
      color: 'text-cyan-700 dark:text-cyan-300',
      borderColor: 'border-cyan-200 dark:border-cyan-800'
    },
    aircraft: {
      icon: '✈️',
      bgColor: 'bg-sky-50 dark:bg-sky-950',
      color: 'text-sky-700 dark:text-sky-300',
      borderColor: 'border-sky-200 dark:border-sky-800'
    },
    event: {
      icon: '📅',
      bgColor: 'bg-amber-50 dark:bg-amber-950',
      color: 'text-amber-700 dark:text-amber-300',
      borderColor: 'border-amber-200 dark:border-amber-800'
    }
  };

  return styles[entityType] || {
    icon: '🏷️',
    bgColor: 'bg-gray-50 dark:bg-gray-950',
    color: 'text-gray-700 dark:text-gray-300',
    borderColor: 'border-gray-200 dark:border-gray-800'
  };
}

// Group curated entities by type
function groupCuratedEntitiesByType(entities: CuratedEntityMatch[]) {
  const grouped: Record<string, CuratedEntityMatch[]> = {};
  entities.forEach(entity => {
    const type = entity.entity_type;
    if (!grouped[type]) {
      grouped[type] = [];
    }
    grouped[type].push(entity);
  });
  return grouped;
}

// Group OpenSanctions entities by risk classification
function groupByRiskClassification(entities: OpenSanctionsEntityMatch[]) {
  const grouped: Record<string, OpenSanctionsEntityMatch[]> = {};
  entities.forEach(entity => {
    const risk = entity.risk_classification || 'unknown';
    if (!grouped[risk]) {
      grouped[risk] = [];
    }
    grouped[risk].push(entity);
  });
  // Sort keys to show sanctioned first, then pep, criminal, corporate
  const order = ['sanctioned', 'pep', 'criminal', 'corporate', 'unknown'];
  const sortedKeys = Object.keys(grouped).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const sorted: Record<string, OpenSanctionsEntityMatch[]> = {};
  sortedKeys.forEach(key => {
    sorted[key] = grouped[key];
  });
  return sorted;
}

// Helper to get complexity styling
function getComplexityStyle(complexity: string) {
  const styles: Record<string, { icon: string; color: string; bgColor: string; borderColor: string }> = {
    simple: {
      icon: '🟢',
      color: 'text-green-700 dark:text-green-300',
      bgColor: 'bg-green-50 dark:bg-green-950',
      borderColor: 'border-green-200 dark:border-green-800'
    },
    moderate: {
      icon: '🟡',
      color: 'text-amber-700 dark:text-amber-300',
      bgColor: 'bg-amber-50 dark:bg-amber-950',
      borderColor: 'border-amber-200 dark:border-amber-800'
    },
    complex: {
      icon: '🔴',
      color: 'text-red-700 dark:text-red-300',
      bgColor: 'bg-red-50 dark:bg-red-950',
      borderColor: 'border-red-200 dark:border-red-800'
    }
  };

  return styles[complexity] || styles.moderate;
}

// Helper to get spam review status styling
function getSpamReviewStatusStyle(status: string) {
  const styles: Record<string, { label: string; color: string; bgColor: string; borderColor: string }> = {
    pending: {
      label: 'Pending Review',
      color: 'text-yellow-700 dark:text-yellow-300',
      bgColor: 'bg-yellow-50 dark:bg-yellow-950',
      borderColor: 'border-yellow-200 dark:border-yellow-800'
    },
    reviewed: {
      label: 'Reviewed',
      color: 'text-blue-700 dark:text-blue-300',
      bgColor: 'bg-blue-50 dark:bg-blue-950',
      borderColor: 'border-blue-200 dark:border-blue-800'
    },
    false_positive: {
      label: 'False Positive',
      color: 'text-orange-700 dark:text-orange-300',
      bgColor: 'bg-orange-50 dark:bg-orange-950',
      borderColor: 'border-orange-200 dark:border-orange-800'
    },
    true_positive: {
      label: 'True Positive',
      color: 'text-red-700 dark:text-red-300',
      bgColor: 'bg-red-50 dark:bg-red-950',
      borderColor: 'border-red-200 dark:border-red-800'
    },
    reprocessed: {
      label: 'Reprocessed',
      color: 'text-green-700 dark:text-green-300',
      bgColor: 'bg-green-50 dark:bg-green-950',
      borderColor: 'border-green-200 dark:border-green-800'
    }
  };

  return styles[status] || {
    label: status,
    color: 'text-gray-700 dark:text-gray-300',
    bgColor: 'bg-gray-50 dark:bg-gray-950',
    borderColor: 'border-gray-200 dark:border-gray-800'
  };
}

export function IntelView({ message }: IntelViewProps) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [embeddingExpanded, setEmbeddingExpanded] = useState(false);

  // Check if we have any AI enrichment data
  const hasAIEnrichment = message.content_sentiment ||
                          message.content_urgency_level !== null ||
                          message.content_complexity ||
                          (message.key_phrases && message.key_phrases.length > 0) ||
                          message.summary;

  // Check if we have embedding data
  const hasEmbeddings = message.embedding_model || message.embedding_generated_at;

  return (
    <div className="space-y-4">
      {/* LLM Classification */}
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Brain className="h-4 w-4" />
            LLM Classification
            <Badge variant="outline" className="text-xs">
              Powered by Ollama
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground dark:text-gray-400">Topic</span>
            {message.osint_topic ? (
              <Badge variant="secondary" className="capitalize">
                {getTopicEmoji(message.osint_topic)} {message.osint_topic}
              </Badge>
            ) : (
              <span className="text-muted-foreground dark:text-gray-400">Not classified</span>
            )}
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground dark:text-gray-400">Importance</span>
            {message.importance_level ? (
              <Badge variant={
                message.importance_level === 'high' ? 'destructive' :
                message.importance_level === 'medium' ? 'secondary' :
                'outline'
              }>
                {message.importance_level === 'high' ? '🔴 High' :
                 message.importance_level === 'medium' ? '🟡 Medium' :
                 '⚪ Low'}
              </Badge>
            ) : (
              <span className="text-muted-foreground dark:text-gray-400">Not classified</span>
            )}
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground dark:text-gray-400">Spam Status</span>
            <Badge variant={message.is_spam ? 'destructive' : 'outline'}>
              {message.is_spam ? '🚫 Spam' : '✓ Clean'}
            </Badge>
          </div>

          {/* Enhanced spam information */}
          {message.is_spam && (
            <div className="mt-2 space-y-2">
              {message.spam_type && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground dark:text-gray-400">Spam Type</span>
                  <Badge variant="outline" className="capitalize">
                    {message.spam_type.replace('_', ' ')}
                  </Badge>
                </div>
              )}

              {message.spam_confidence !== null && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground dark:text-gray-400">Confidence</span>
                  <span className="font-medium text-red-600 dark:text-red-400">
                    {Math.round(message.spam_confidence * 100)}%
                  </span>
                </div>
              )}

              {message.spam_review_status && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground dark:text-gray-400">Review Status</span>
                  {(() => {
                    const style = getSpamReviewStatusStyle(message.spam_review_status);
                    return (
                      <span className={`text-xs px-2 py-0.5 rounded border ${style.bgColor} ${style.color} ${style.borderColor}`}>
                        {style.label}
                      </span>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {message.spam_reason && (
            <div className="text-xs text-muted-foreground dark:text-gray-400 bg-red-50 dark:bg-red-950 p-2 rounded">
              <span className="font-medium">Spam reason:</span> {message.spam_reason}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Enrichment */}
      {hasAIEnrichment && (
        <Card className="dark:border-gray-700">
          <CardHeader className="pb-3 dark:border-gray-700">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              AI Enrichment
              <Badge variant="outline" className="text-xs">
                Automated Analysis
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Sentiment */}
            {message.content_sentiment && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Sentiment</span>
                <SentimentBadge
                  sentiment={message.content_sentiment as 'positive' | 'negative' | 'neutral' | 'urgent'}
                  mode="compact"
                />
              </div>
            )}

            {/* Urgency */}
            {message.content_urgency_level !== null && (
              <div className="space-y-1">
                <span className="text-sm text-muted-foreground dark:text-gray-400">Urgency Level</span>
                <UrgencyMeter
                  urgency={message.content_urgency_level}
                  mode="detailed"
                  showLabel={true}
                />
              </div>
            )}

            {/* Complexity */}
            {message.content_complexity && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground dark:text-gray-400">Complexity</span>
                {(() => {
                  const style = getComplexityStyle(message.content_complexity);
                  return (
                    <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs border ${style.bgColor} ${style.color} ${style.borderColor}`}>
                      <span>{style.icon}</span>
                      <span className="capitalize font-medium">{message.content_complexity}</span>
                    </span>
                  );
                })()}
              </div>
            )}

            {/* Key Phrases */}
            {message.key_phrases && message.key_phrases.length > 0 && (
              <div className="space-y-2">
                <span className="text-sm text-muted-foreground dark:text-gray-400">Key Phrases</span>
                <div className="flex flex-wrap gap-2">
                  {message.key_phrases.map((phrase, idx) => (
                    <span
                      key={idx}
                      className="bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded text-xs border border-indigo-200 dark:border-indigo-800"
                    >
                      {phrase}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* AI Summary (Collapsible) */}
            {message.summary && (
              <div className="space-y-2">
                <button
                  onClick={() => setSummaryExpanded(!summaryExpanded)}
                  className="flex items-center justify-between w-full text-sm text-muted-foreground dark:text-gray-400 hover:text-foreground dark:hover:text-gray-200 transition-colors"
                >
                  <span className="font-medium">AI Summary</span>
                  <div className="flex items-center gap-2">
                    {message.summary_generated_at && (
                      <span className="text-xs opacity-60">
                        {new Date(message.summary_generated_at).toLocaleDateString()}
                      </span>
                    )}
                    {summaryExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </button>
                {summaryExpanded && (
                  <div className="text-sm bg-indigo-50 dark:bg-indigo-950 text-indigo-900 dark:text-indigo-100 p-3 rounded border border-indigo-200 dark:border-indigo-800">
                    {message.summary}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Human Review Status */}
      {(message.needs_human_review || message.osint_reviewed) && (
        <Card className="dark:border-gray-700">
          <CardHeader className="pb-3 dark:border-gray-700">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Human Review Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ReviewStatusBadge
              needsReview={message.needs_human_review}
              reviewed={message.osint_reviewed}
              reviewedBy={message.reviewed_by || undefined}
              manualScore={message.osint_manual_score || undefined}
              reviewedAt={message.reviewed_at || undefined}
              mode="detailed"
            />

            {/* Additional review details */}
            {message.osint_reviewed && (
              <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                {message.reviewed_by && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground dark:text-gray-400">Reviewed By</span>
                    <span className="font-medium">{message.reviewed_by}</span>
                  </div>
                )}

                {message.reviewed_at && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground dark:text-gray-400">Reviewed At</span>
                    <span className="text-xs opacity-70">
                      {new Date(message.reviewed_at).toLocaleString()}
                    </span>
                  </div>
                )}

                {message.osint_manual_score !== null && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground dark:text-gray-400">Manual Score</span>
                    <span className="font-bold text-lg">
                      {message.osint_manual_score}/100
                    </span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

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

      {/* Curated Entity Matches (from knowledge graph) */}
      {message.curated_entities && message.curated_entities.length > 0 && (
        <Card className="dark:border-gray-700">
          <CardHeader className="pb-3 dark:border-gray-700">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Tag className="h-4 w-4" />
              Knowledge Graph Entities
              <Badge variant="outline" className="text-xs">
                {message.curated_entities.length} matches
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              const groupedEntities = groupCuratedEntitiesByType(message.curated_entities!);
              return Object.entries(groupedEntities).map(([entityType, entities]) => {
                const style = getCuratedEntityStyle(entityType);
                return (
                  <div key={entityType}>
                    <div className={`text-xs ${style.color} font-medium flex items-center gap-1 mb-2`}>
                      <span>{style.icon}</span>
                      <span className="capitalize">{entityType.replace('_', ' ')}</span>
                      <span className="text-muted-foreground dark:text-gray-500">({entities.length})</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {entities.map((entity, idx) => (
                        <span
                          key={`${entity.entity_id}-${idx}`}
                          className={`${style.bgColor} ${style.color} px-2 py-1 rounded text-xs border ${style.borderColor} flex items-center gap-1 cursor-help`}
                          title={[
                            entity.description ? entity.description : null,
                            `Match: ${entity.match_type}`,
                            `Confidence: ${(entity.similarity_score * 100).toFixed(0)}%`,
                            `Source: ${entity.source_reference}`,
                          ].filter(Boolean).join('\n')}
                        >
                          <span className="font-medium">{entity.name}</span>
                          <span className="text-[10px] opacity-70">
                            {(entity.similarity_score * 100).toFixed(0)}%
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

      {/* OpenSanctions Entity Matches */}
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            OpenSanctions Matches
            {message.opensanctions_entities && message.opensanctions_entities.length > 0 && (
              <Badge variant="destructive" className="text-xs ml-2">
                {message.opensanctions_entities.length} found
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {message.opensanctions_entities && message.opensanctions_entities.length > 0 ? (
            <div className="space-y-4">
              {(() => {
                const groupedEntities = groupByRiskClassification(message.opensanctions_entities);
                return Object.entries(groupedEntities).map(([riskClass, entities]) => {
                  const style = getRiskClassificationStyle(riskClass);
                  return (
                    <div key={riskClass}>
                      <div className={`text-xs font-medium flex items-center gap-1 mb-2 ${style.color}`}>
                        <span>{style.icon}</span>
                        <span>{style.label}</span>
                        <span className="text-muted-foreground dark:text-gray-500">({entities.length})</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {entities.map((entity, idx) => (
                          <span
                            key={`${entity.entity_id}-${idx}`}
                            className={`${style.bgColor} ${style.color} px-2 py-1 rounded text-xs border ${style.borderColor} flex items-center gap-1 cursor-help`}
                            title={[
                              `ID: ${entity.opensanctions_id}`,
                              `Type: ${entity.entity_type}`,
                              entity.description ? `Description: ${entity.description}` : null,
                              `Match Score: ${(entity.match_score * 100).toFixed(0)}%`,
                              `Method: ${entity.match_method}`,
                              entity.datasets?.length ? `Datasets: ${entity.datasets.join(', ')}` : null,
                              entity.aliases?.length ? `Aliases: ${entity.aliases.slice(0, 3).join(', ')}${entity.aliases.length > 3 ? '...' : ''}` : null,
                            ].filter(Boolean).join('\n')}
                          >
                            <span className="font-medium">{entity.name}</span>
                            <span className="text-[10px] opacity-70">
                              {(entity.match_score * 100).toFixed(0)}%
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground dark:text-gray-400">
              No sanctioned entities detected
            </p>
          )}
        </CardContent>
      </Card>

      {/* Vector Embeddings (Collapsible) */}
      {hasEmbeddings && (
        <Card className="dark:border-gray-700">
          <CardHeader className="pb-3 dark:border-gray-700">
            <button
              onClick={() => setEmbeddingExpanded(!embeddingExpanded)}
              className="w-full flex items-center justify-between hover:opacity-80 transition-opacity"
            >
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Vector Embeddings
                <Badge variant="outline" className="text-xs">
                  Semantic Search
                </Badge>
              </CardTitle>
              {embeddingExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </CardHeader>
          {embeddingExpanded && (
            <CardContent className="space-y-2">
              {message.embedding_model && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground dark:text-gray-400">Model</span>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {message.embedding_model}
                  </Badge>
                </div>
              )}

              {message.embedding_generated_at && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground dark:text-gray-400">Generated At</span>
                  <span className="text-xs opacity-70">
                    {new Date(message.embedding_generated_at).toLocaleString()}
                  </span>
                </div>
              )}

              <div className="text-xs text-muted-foreground dark:text-gray-400 bg-blue-50 dark:bg-blue-950 p-2 rounded border border-blue-200 dark:border-blue-800">
                Vector embeddings enable semantic similarity search, allowing you to find messages with similar meaning even if they use different words.
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* RSS Validation */}
      <ValidationPanel messageId={message.id} />
    </div>
  );
}
