'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  GitBranch, Loader2, AlertCircle, User, MessageCircle, Share2, Eye, TrendingUp,
  ZoomIn, ZoomOut, RefreshCw, Download, X
} from 'lucide-react';
import { useSocialGraph } from '@/hooks/useSocialGraph';
import { useTheme } from 'next-themes';

interface SocialNetworkGraphProps {
  messageId: number;
}

// Helper to get node type category and styling
function getNodeCategory(type: string): { category: string; color: string; icon: string; bgColor: string } {
  switch (type) {
    case 'message':
      return { category: 'Message', color: 'text-blue-400', icon: '📄', bgColor: 'bg-blue-500/20' };
    case 'author':
      return { category: 'Author', color: 'text-green-400', icon: '👤', bgColor: 'bg-green-500/20' };
    case 'forward_source':
      return { category: 'Forward Source', color: 'text-purple-400', icon: '⤴️', bgColor: 'bg-purple-500/20' };
    case 'parent_message':
      return { category: 'Parent Message', color: 'text-orange-400', icon: '↩️', bgColor: 'bg-orange-500/20' };
    case 'comment':
      return { category: 'Comment', color: 'text-pink-400', icon: '💬', bgColor: 'bg-pink-500/20' };
    case 'reaction':
      return { category: 'Reaction', color: 'text-amber-400', icon: '👍', bgColor: 'bg-amber-500/20' };
    default:
      return { category: 'Node', color: 'text-gray-400', icon: '●', bgColor: 'bg-gray-500/20' };
  }
}

// Selected Node Panel Component - Rich details for each node type
interface SelectedNodePanelProps {
  node: any;
  onClose: () => void;
}

function SelectedNodePanel({ node, onClose }: SelectedNodePanelProps) {
  const { category, color, icon, bgColor } = getNodeCategory(node.type);

  return (
    <div className={`${bgColor} border border-border rounded-lg p-4 mb-3`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {node.type === 'reaction' ? (
            <span className="text-2xl">{node.emoji || '👍'}</span>
          ) : (
            <span className="text-xl">{icon}</span>
          )}
          <div>
            {node.type === 'reaction' ? (
              <h4 className="text-sm font-semibold">Reaction</h4>
            ) : (
              <h4 className="text-sm font-semibold">{node.label}</h4>
            )}
            <Badge variant="outline" className={`${color} text-xs mt-0.5`}>
              {category}
            </Badge>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-6 w-6 p-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-3">
        {/* Message Node */}
        {node.type === 'message' && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-3">
              {node.views !== undefined && (
                <div className="bg-background/50 rounded p-2 text-center">
                  <p className="text-xs text-muted-foreground">Views</p>
                  <p className="text-sm font-medium">{node.views?.toLocaleString() || '0'}</p>
                </div>
              )}
              {node.forwards !== undefined && (
                <div className="bg-background/50 rounded p-2 text-center">
                  <p className="text-xs text-muted-foreground">Forwards</p>
                  <p className="text-sm font-medium">{node.forwards?.toLocaleString() || '0'}</p>
                </div>
              )}
              {node.comments_count !== undefined && (
                <div className="bg-background/50 rounded p-2 text-center">
                  <p className="text-xs text-muted-foreground">Comments</p>
                  <p className="text-sm font-medium">{node.comments_count || '0'}</p>
                </div>
              )}
            </div>
            {node.content && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Content Preview:</span>
                <p className="text-xs p-2 bg-background/50 rounded mt-1 max-h-16 overflow-y-auto">
                  {node.content.substring(0, 200)}{node.content.length > 200 ? '...' : ''}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Author Node */}
        {node.type === 'author' && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Channel or user who posted this message.</p>
            {node.user_id && (
              <p className="text-xs text-muted-foreground">
                User ID: <span className="font-mono">{node.user_id}</span>
              </p>
            )}
          </div>
        )}

        {/* Forward Source Node */}
        {node.type === 'forward_source' && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Message was forwarded from this channel.</p>
            {node.channel_id && (
              <p className="text-xs text-muted-foreground">
                Channel ID: <span className="font-mono">{node.channel_id}</span>
              </p>
            )}
          </div>
        )}

        {/* Parent Message Node */}
        {node.type === 'parent_message' && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">This message is a reply to another message.</p>
            {node.message_id && (
              <p className="text-xs text-muted-foreground">
                Parent Message ID: <span className="font-mono">{node.message_id}</span>
              </p>
            )}
          </div>
        )}

        {/* Comment Node */}
        {node.type === 'comment' && (
          <div className="space-y-2">
            {node.user_name && (
              <p className="text-xs text-muted-foreground">
                By: <span className="font-medium">{node.user_name}</span>
              </p>
            )}
            {node.text && (
              <p className="text-sm p-2 bg-background/50 rounded max-h-20 overflow-y-auto">
                {node.text}
              </p>
            )}
            {node.date && (
              <p className="text-xs text-muted-foreground">
                Posted: {new Date(node.date).toLocaleString()}
              </p>
            )}
          </div>
        )}

        {/* Reaction Node */}
        {node.type === 'reaction' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold">{node.count?.toLocaleString() || 0}</span>
              <span className="text-sm text-muted-foreground">total reactions</span>
            </div>
            {node.emoji?.includes('ReactionPaid') && (
              <Badge variant="outline" className="text-xs text-amber-400 border-amber-400">
                ⭐ Paid Reaction
              </Badge>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Color palette for nodes and edges
function getColorPalette(isDark: boolean) {
  return {
    message: { bg: isDark ? '#3b82f6' : '#2563eb', border: isDark ? '#60a5fa' : '#1d4ed8' },
    author: { bg: isDark ? '#6b9a8a' : '#4d7a6a', border: isDark ? '#8ab6a6' : '#3a6050' },
    forward: { bg: isDark ? '#9b8ac2' : '#7b6aa2', border: isDark ? '#b5a6d4' : '#5f5082' },
    parent: { bg: isDark ? '#c99b6d' : '#a67c52', border: isDark ? '#ddb896' : '#8a6642' },
    comment: { bg: isDark ? '#b88a9a' : '#986a7a', border: isDark ? '#cfa8b6' : '#7a5262' },
    reaction: { bg: isDark ? '#c9a86d' : '#a68a52', border: isDark ? '#ddc496' : '#8a7042' },
    edge: { line: isDark ? '#4a5568' : '#a0aec0' },
  };
}

function getNodeColor(type: string, isDark: boolean): string {
  const colors = getColorPalette(isDark);
  switch (type) {
    case 'message': return colors.message.bg;
    case 'author': return colors.author.bg;
    case 'forward_source': return colors.forward.bg;
    case 'parent_message': return colors.parent.bg;
    case 'comment': return colors.comment.bg;
    case 'reaction': return colors.reaction.bg;
    default: return isDark ? '#475569' : '#64748b';
  }
}

function getNodeSize(type: string, count?: number): number {
  switch (type) {
    case 'message': return 20;
    case 'author': return 15;
    case 'forward_source': return 14;
    case 'parent_message': return 14;
    case 'comment': return 10;
    case 'reaction': return Math.min(8 + (count || 1) * 0.5, 20);
    default: return 12;
  }
}

function getEdgeColor(type: string, isDark: boolean): string {
  const colors = getColorPalette(isDark);
  switch (type) {
    case 'authored': return colors.author.bg;
    case 'forwarded_from': return colors.forward.bg;
    case 'reply_to': return colors.parent.bg;
    case 'commented_on': return colors.comment.bg;
    case 'reacted': return isDark ? '#64748b' : '#94a3b8';
    default: return colors.edge.line;
  }
}

export function SocialNetworkGraph({ messageId }: SocialNetworkGraphProps) {
  const { data, isLoading, error } = useSocialGraph(messageId, {
    include_forwards: true,
    include_replies: true,
    max_depth: 3,
    max_comments: 50,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<any>(null);
  const graphRef = useRef<any>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isBrowser, setIsBrowser] = useState(false);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
    setIsBrowser(true);
  }, []);

  const isDark = mounted ? resolvedTheme === 'dark' : false;

  const nodes = data?.nodes || [];
  const edges = data?.edges || [];
  const metadata = data?.metadata || {};
  const reactions = data?.reactions || [];

  const hasAuthor = metadata.has_author;
  const isForward = metadata.is_forward;
  const isReply = metadata.is_reply;
  const hasComments = metadata.has_comments;
  const hasReactions = reactions.length > 0;
  const hasRelationships = hasAuthor || isForward || isReply || hasComments || hasReactions;

  // Initialize Sigma graph
  useEffect(() => {
    if (!isBrowser || !containerRef.current || !hasRelationships || nodes.length === 0 || isLoading || error) {
      return;
    }

    if (isInitialized) {
      return;
    }

    let mounted = true;

    const initSigma = async () => {
      try {
        const Graph = (await import('graphology')).default;
        const Sigma = (await import('sigma')).default;
        const forceAtlas2 = (await import('graphology-layout-forceatlas2')).default;

        if (!mounted || !containerRef.current) return;

        // Create graph
        const graph = new Graph();

        // Add nodes
        nodes.forEach((node: any, index: number) => {
          const angle = (2 * Math.PI * index) / nodes.length;
          const radius = 100;

          graph.addNode(node.id, {
            label: node.label,
            x: Math.cos(angle) * radius + (Math.random() - 0.5) * 20,
            y: Math.sin(angle) * radius + (Math.random() - 0.5) * 20,
            size: getNodeSize(node.type, node.data?.count),
            color: getNodeColor(node.type, isDark),
            nodeType: node.type,  // Store our category in nodeType, not type (reserved by Sigma)
            ...node.data,
          });
        });

        // Add edges
        edges.forEach((edge: any) => {
          if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
            try {
              graph.addEdge(edge.source, edge.target, {
                label: edge.label || edge.type,
                color: getEdgeColor(edge.type, isDark),
                size: edge.type === 'reacted' ? 1 : 2,
                edgeType: edge.type,  // Store our category in edgeType, not type (reserved by Sigma)
              });
            } catch (e) {
              // Edge might already exist
            }
          }
        });

        // Add reaction nodes (reactions come as separate array from API)
        // Find the message node to connect reactions to
        const messageNode = nodes.find((n: any) => n.type === 'message');
        if (messageNode && reactions.length > 0) {
          reactions.forEach((reaction: any, idx: number) => {
            const reactionId = `reaction-${reaction.emoji}-${idx}`;
            const angle = (2 * Math.PI * idx) / reactions.length + Math.PI; // Offset from other nodes
            const radius = 80;

            graph.addNode(reactionId, {
              label: `${reaction.emoji} ${reaction.count}`,
              x: Math.cos(angle) * radius + (Math.random() - 0.5) * 10,
              y: Math.sin(angle) * radius + (Math.random() - 0.5) * 10,
              size: getNodeSize('reaction', reaction.count),
              color: getNodeColor('reaction', isDark),
              nodeType: 'reaction',
              emoji: reaction.emoji,
              count: reaction.count,
            });

            // Connect reaction to message
            try {
              graph.addEdge(reactionId, messageNode.id, {
                label: 'reacted',
                color: getEdgeColor('reacted', isDark),
                size: 1,
                edgeType: 'reacted',
              });
            } catch (e) {
              // Edge might already exist
            }
          });
        }

        // Run ForceAtlas2 layout
        forceAtlas2.assign(graph, {
          iterations: 100,
          settings: {
            gravity: 1,
            scalingRatio: 10,
            barnesHutOptimize: nodes.length > 50,
            strongGravityMode: false,
            slowDown: 1,
          },
        });

        // Create Sigma instance
        const sigma = new Sigma(graph, containerRef.current, {
          renderEdgeLabels: false,
          defaultEdgeType: 'arrow',
          labelSize: 12,
          labelWeight: 'bold',
          labelColor: { color: isDark ? '#e2e8f0' : '#334155' },
          defaultNodeColor: isDark ? '#475569' : '#64748b',
          defaultEdgeColor: isDark ? '#4a5568' : '#a0aec0',
          minCameraRatio: 0.1,
          maxCameraRatio: 10,
        });

        // Set Sigma canvas background to transparent so container bg shows through
        const canvas = containerRef.current.querySelector('canvas');
        if (canvas) {
          canvas.style.background = 'transparent';
        }

        // Click handler for node selection
        sigma.on('clickNode', ({ node }) => {
          const nodeAttrs = graph.getNodeAttributes(node);
          setSelectedNode({
            id: node,
            type: nodeAttrs.nodeType,  // Use nodeType (our custom attribute)
            label: nodeAttrs.label,
            ...nodeAttrs,
          });
        });

        // Click on background to deselect
        sigma.on('clickStage', () => {
          setSelectedNode(null);
        });

        // Hover effects
        let hoveredNode: string | null = null;

        sigma.on('enterNode', ({ node }) => {
          hoveredNode = node;
          sigma.setSetting('nodeReducer', (n, data) => {
            if (n === hoveredNode) {
              return { ...data, size: data.size * 1.3 };
            }
            return data;
          });
          sigma.refresh();
        });

        sigma.on('leaveNode', () => {
          hoveredNode = null;
          sigma.setSetting('nodeReducer', null);
          sigma.refresh();
        });

        graphRef.current = graph;
        sigmaRef.current = sigma;

        if (mounted) {
          setIsInitialized(true);
        }
      } catch (err) {
        console.error('Failed to initialize Sigma:', err);
      }
    };

    initSigma();

    return () => {
      mounted = false;
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
      graphRef.current = null;
      setIsInitialized(false);
    };
  }, [nodes, edges, reactions, hasRelationships, isLoading, error, isBrowser, isDark]);

  // Update colors when theme changes
  useEffect(() => {
    if (sigmaRef.current && graphRef.current && isInitialized && mounted) {
      const graph = graphRef.current;

      // Update node colors
      graph.forEachNode((node: string) => {
        const type = graph.getNodeAttribute(node, 'type');
        graph.setNodeAttribute(node, 'color', getNodeColor(type, isDark));
      });

      // Update edge colors
      graph.forEachEdge((edge: string) => {
        const type = graph.getEdgeAttribute(edge, 'type');
        graph.setEdgeAttribute(edge, 'color', getEdgeColor(type, isDark));
      });

      sigmaRef.current.setSetting('labelColor', { color: isDark ? '#e2e8f0' : '#334155' });
      sigmaRef.current.refresh();
    }
  }, [isDark, isInitialized, mounted]);

  // Control functions
  const handleZoomIn = useCallback(() => {
    if (sigmaRef.current) {
      const camera = sigmaRef.current.getCamera();
      camera.animatedZoom({ duration: 300 });
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (sigmaRef.current) {
      const camera = sigmaRef.current.getCamera();
      camera.animatedUnzoom({ duration: 300 });
    }
  }, []);

  const handleReset = useCallback(() => {
    if (sigmaRef.current) {
      const camera = sigmaRef.current.getCamera();
      camera.animatedReset({ duration: 300 });
    }
  }, []);

  const handleReLayout = useCallback(async () => {
    if (!graphRef.current) return;

    try {
      const forceAtlas2 = (await import('graphology-layout-forceatlas2')).default;
      forceAtlas2.assign(graphRef.current, {
        iterations: 100,
        settings: {
          gravity: 1,
          scalingRatio: 10,
          barnesHutOptimize: nodes.length > 50,
        },
      });
      sigmaRef.current?.refresh();
    } catch (err) {
      console.error('Failed to re-layout:', err);
    }
  }, [nodes.length]);

  const handleExport = useCallback(() => {
    if (!containerRef.current) return;

    // Find the canvas element
    const canvas = containerRef.current.querySelector('canvas');
    if (!canvas) return;

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `social-graph-message-${messageId}.png`;
    link.click();
  }, [messageId]);

  if (isLoading) {
    return (
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            Social Network Graph
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading social graph...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            Social Network Graph
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <AlertCircle className="h-8 w-8 mx-auto text-destructive mb-2" />
            <p className="text-sm text-muted-foreground">Failed to load social graph</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="dark:border-gray-700">
      <CardHeader className="pb-3 dark:border-gray-700">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          Social Network Graph
          <span className="text-xs text-muted-foreground ml-auto">
            {nodes.length} nodes • {edges.length} edges
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasRelationships ? (
          <div className="text-center py-12 space-y-4">
            <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground/20 mb-3" />
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">
                No Social Relationships Found
              </p>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                This message does not have author information, is not a forward or reply, and has no comments.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Engagement Metrics Row */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 bg-muted/50 dark:bg-muted/20 rounded-lg">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-blue-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Views</p>
                  <p className="text-sm font-medium">
                    {metadata.views?.toLocaleString() || '0'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-green-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Forwards</p>
                  <p className="text-sm font-medium">
                    {metadata.forwards?.toLocaleString() || '0'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-purple-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Engagement</p>
                  <p className="text-sm font-medium">
                    {metadata.engagement_rate
                      ? `${(metadata.engagement_rate * 100).toFixed(2)}%`
                      : 'N/A'}
                  </p>
                </div>
              </div>
            </div>

            {/* Virality Badge */}
            {metadata.virality && metadata.virality !== 'none' && (
              <div className="px-4 py-3 bg-gradient-to-r from-orange-50 to-red-50 dark:from-orange-950/20 dark:to-red-950/20 rounded-lg border border-orange-200 dark:border-orange-800">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                      metadata.virality === 'very_high'
                        ? 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
                        : metadata.virality === 'high'
                        ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300'
                        : metadata.virality === 'medium'
                        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300'
                        : 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
                    }`}
                  >
                    🔥 {metadata.virality.replace('_', ' ').toUpperCase()} Virality
                  </span>
                  <span className="text-xs text-muted-foreground">
                    • {metadata.reach?.replace('_', ' ')} reach
                  </span>
                </div>
              </div>
            )}

            {/* Reactions Display */}
            {hasReactions && (
              <div className="p-4 bg-muted/50 dark:bg-muted/20 rounded-lg">
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <span>💬</span>
                  Reactions
                  <span className="text-xs text-muted-foreground font-normal">
                    ({metadata.reactions_total?.toLocaleString() || 0} total)
                  </span>
                </h4>
                <div className="flex flex-wrap gap-2">
                  {reactions
                    .filter((r: any) => !r.emoji.includes('ReactionPaid'))
                    .sort((a: any, b: any) => b.count - a.count)
                    .map((reaction: any, idx: number) => (
                      <div
                        key={idx}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-800 rounded-full border border-muted shadow-sm"
                      >
                        <span className="text-lg">{reaction.emoji}</span>
                        <span className="text-sm font-medium">
                          {reaction.count.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  {reactions.some((r: any) => r.emoji.includes('ReactionPaid')) && (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-950/30 dark:to-amber-950/30 rounded-full border border-yellow-200 dark:border-yellow-800">
                      <span className="text-lg">⭐</span>
                      <span className="text-sm font-medium text-yellow-700 dark:text-yellow-300">
                        {reactions.find((r: any) => r.emoji.includes('ReactionPaid'))?.count || 0} Paid
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Social Relationship Indicators */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 dark:bg-muted/20 rounded-lg">
              <div className="flex items-center gap-2">
                <User className={'h-4 w-4 ' + (hasAuthor ? 'text-green-500' : 'text-muted-foreground/50')} />
                <div>
                  <p className="text-xs text-muted-foreground">Author</p>
                  <p className="text-sm font-medium truncate max-w-[120px]" title={metadata.author?.name || 'Unknown'}>
                    {metadata.author?.name || 'Unknown'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Share2 className={'h-4 w-4 ' + (isForward ? 'text-purple-500' : 'text-muted-foreground/50')} />
                <div>
                  <p className="text-xs text-muted-foreground">Forwarded</p>
                  <p className="text-sm font-medium">{isForward ? 'Yes' : 'No'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <MessageCircle className={'h-4 w-4 ' + (isReply ? 'text-orange-500' : 'text-muted-foreground/50')} />
                <div>
                  <p className="text-xs text-muted-foreground">Reply</p>
                  <p className="text-sm font-medium">{isReply ? 'Yes' : 'No'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <MessageCircle className={'h-4 w-4 ' + (hasComments ? 'text-pink-500' : 'text-muted-foreground/50')} />
                <div>
                  <p className="text-xs text-muted-foreground">Comments</p>
                  <p className="text-sm font-medium">{metadata.comments_count || 0}</p>
                </div>
              </div>
            </div>

            {/* Graph Controls */}
            <div className="flex flex-wrap gap-2 items-center">
              <Button size="sm" variant="outline" onClick={handleZoomIn} title="Zoom In">
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" onClick={handleZoomOut} title="Zoom Out">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="outline" onClick={handleReset} title="Reset View">
                Reset
              </Button>
              <Button size="sm" variant="outline" onClick={handleReLayout} title="Re-run Layout">
                <RefreshCw className="h-4 w-4" />
              </Button>

              <div className="h-6 w-px bg-border" />

              <Button size="sm" variant="outline" onClick={handleExport} title="Export as PNG">
                <Download className="h-4 w-4 mr-1" />
                PNG
              </Button>
            </div>

            {/* Selected Node Details Panel */}
            {selectedNode && (
              <SelectedNodePanel node={selectedNode} onClose={() => setSelectedNode(null)} />
            )}

            {/* Interactive Graph Container */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Social Network Graph (ForceAtlas2)
                </span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#3b82f6' }} />
                    <span>Message</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#6b9a8a' }} />
                    <span>Author</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#9b8ac2' }} />
                    <span>Forward</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#c99b6d' }} />
                    <span>Reply</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#b88a9a' }} />
                    <span>Comment</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#c9a86d' }} />
                    <span>Reaction</span>
                  </div>
                </div>
              </div>
              <div
                ref={containerRef}
                className="w-full border border-muted rounded-lg"
                style={{
                  height: '500px',
                  backgroundColor: isDark ? '#0f172a' : '#f8fafc',
                }}
              />
              <p className="text-xs text-muted-foreground text-center mt-2">
                Drag to pan • Scroll to zoom • Click nodes for details
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
