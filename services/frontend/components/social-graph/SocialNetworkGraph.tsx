'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  GitBranch, Loader2, AlertCircle, User, MessageCircle, Share2, Eye, TrendingUp,
  ZoomIn, ZoomOut, Layout, RefreshCw, Download, X, ExternalLink
} from 'lucide-react';
import { useSocialGraph } from '@/hooks/useSocialGraph';
import { useTheme } from 'next-themes';

interface SocialNetworkGraphProps {
  messageId: number;
}

// Available Cytoscape layouts for social graph (matching Entity graph options)
const LAYOUTS = [
  { value: 'fcose', label: 'Force-Directed (fCoSE)', description: 'Physics-based, organic clustering' },
  { value: 'cose', label: 'Force-Directed (CoSE)', description: 'Simpler physics simulation' },
  { value: 'grid', label: 'Grid', description: 'Organized grid pattern' },
  { value: 'circle', label: 'Circle', description: 'Circular layout' },
  { value: 'concentric', label: 'Concentric', description: 'Concentric circles by importance' },
  { value: 'breadthfirst', label: 'Breadth-First', description: 'Hierarchical tree layout' },
  { value: 'cose-bilkent', label: 'CoSE-Bilkent', description: 'Advanced force-directed' },
];

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
      {/* Header - different for each node type to avoid redundancy */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* For reactions: show emoji as icon, for others: show category icon */}
          {node.type === 'reaction' ? (
            <span className="text-2xl">{node.emoji || '👍'}</span>
          ) : (
            <span className="text-xl">{icon}</span>
          )}
          <div>
            {/* For reactions: don't repeat the emoji in title */}
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
        {/* Message Node - show engagement and content */}
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
            {node.message_id && (
              <p className="text-xs text-muted-foreground">
                Original Message ID: <span className="font-mono">{node.message_id}</span>
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

        {/* Reaction Node - count and type info, emoji already shown in header */}
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

export function SocialNetworkGraph({ messageId }: SocialNetworkGraphProps) {
  const { data, isLoading, error } = useSocialGraph(messageId, {
    include_forwards: true,
    include_replies: true,
    max_depth: 3,
    max_comments: 50,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isBrowser, setIsBrowser] = useState(false);
  const [selectedLayout, setSelectedLayout] = useState('fcose');
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();

  // Wait for theme to be resolved (prevents hydration mismatch)
  useEffect(() => {
    setMounted(true);
  }, []);

  // Use resolvedTheme which handles 'system' automatically
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

  // Ensure we're in browser environment
  useEffect(() => {
    setIsBrowser(true);
  }, []);

  // Update styles when theme changes (including canvas background)
  useEffect(() => {
    if (cyRef.current && isInitialized && mounted) {
      cyRef.current.style(getSocialGraphStyles(isDark));
      // Update the container background color when theme changes
      if (containerRef.current) {
        containerRef.current.style.backgroundColor = isDark ? '#0f172a' : '#f8fafc';
        // Also ensure canvas stays transparent
        const canvasElements = containerRef.current.querySelectorAll('canvas');
        canvasElements.forEach((canvas: HTMLCanvasElement) => {
          canvas.style.backgroundColor = 'transparent';
        });
      }
    }
  }, [isDark, isInitialized, mounted]);

  // Initialize Cytoscape graph
  useEffect(() => {
    if (!isBrowser || !containerRef.current || !hasRelationships || nodes.length === 0 || isLoading || error) {
      return;
    }

    // Prevent double initialization
    if (isInitialized) {
      return;
    }

    let mounted = true;

    const initCytoscape = async () => {
      try {
        const cytoscape = (await import('cytoscape')).default;
        const fcose = (await import('cytoscape-fcose')).default;
        const coseBilkent = (await import('cytoscape-cose-bilkent')).default;

        if (!mounted || !containerRef.current) return;

        // Register layout plugins
        cytoscape.use(fcose);
        cytoscape.use(coseBilkent);

        // Transform data to Cytoscape format
        const elements = [
          ...nodes.map((node: any) => ({
            data: {
              id: node.id,
              label: node.label,
              type: node.type,
              ...node.data,
            },
          })),
          ...edges.map((edge: any) => ({
            data: {
              id: edge.id,
              source: edge.source,
              target: edge.target,
              label: edge.label || edge.type,
              type: edge.type,
            },
          })),
        ];

        // Initialize Cytoscape with improved configuration
        const cy = cytoscape({
          container: containerRef.current,
          elements,
          style: getSocialGraphStyles(isDark),
          minZoom: 0.3,
          maxZoom: 3,
          wheelSensitivity: 0.2,
        });

        // Make Cytoscape canvas transparent so container background shows through
        if (containerRef.current) {
          const canvasElements = containerRef.current.querySelectorAll('canvas');
          canvasElements.forEach((canvas: HTMLCanvasElement) => {
            canvas.style.backgroundColor = 'transparent';
          });
        }

        // Add interaction handlers
        cy.on('tap', 'node', (evt: any) => {
          const node = evt.target;
          setSelectedNode({
            id: node.id(),
            type: node.data('type'),
            label: node.data('label'),
            ...node.data(),
          });
        });

        cy.on('tap', (evt: any) => {
          if (evt.target === cy) {
            setSelectedNode(null);
          }
        });

        cy.on('mouseover', 'node', (evt: any) => {
          evt.target.style('border-width', '4px');
        });

        cy.on('mouseout', 'node', (evt: any) => {
          evt.target.style('border-width', '2px');
        });

        cyRef.current = cy;

        // Run initial layout
        runLayout(cy, 'fcose');

        if (mounted) {
          setIsInitialized(true);
        }
      } catch (err) {
        console.error('Failed to initialize Cytoscape:', err);
      }
    };

    initCytoscape();

    return () => {
      mounted = false;
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
      setIsInitialized(false);
    };
  }, [nodes, edges, hasRelationships, isLoading, error, isBrowser]);

  // Run layout with specified algorithm
  const runLayout = (cy: any, layoutName: string) => {
    const layoutConfigs: Record<string, any> = {
      fcose: {
        name: 'fcose',
        quality: 'default',
        randomize: true,
        animate: true,
        animationDuration: 800,
        fit: true,
        padding: 50,
        nodeDimensionsIncludeLabels: true,
        uniformNodeDimensions: false,
        packComponents: true,
        nodeRepulsion: 8000,
        idealEdgeLength: 120,
        edgeElasticity: 0.45,
        nestingFactor: 0.1,
        gravity: 0.25,
        numIter: 2500,
        nodeSeparation: 100,
      },
      concentric: {
        name: 'concentric',
        fit: true,
        padding: 50,
        animate: true,
        animationDuration: 500,
        startAngle: Math.PI * 3 / 2,
        sweep: undefined,
        clockwise: true,
        equidistant: false,
        minNodeSpacing: 50,
        concentric: (node: any) => {
          // Center message gets highest priority
          if (node.data('type') === 'message') return 100;
          if (node.data('type') === 'author') return 80;
          if (node.data('type') === 'forward_source' || node.data('type') === 'parent_message') return 60;
          return 40; // comments
        },
        levelWidth: () => 2,
      },
      breadthfirst: {
        name: 'breadthfirst',
        fit: true,
        padding: 50,
        animate: true,
        animationDuration: 500,
        directed: true,
        spacingFactor: 1.5,
        avoidOverlap: true,
        roots: nodes.filter((n: any) => n.type === 'message').map((n: any) => n.id),
      },
      circle: {
        name: 'circle',
        fit: true,
        padding: 50,
        animate: true,
        animationDuration: 500,
        avoidOverlap: true,
        startAngle: Math.PI * 3 / 2,
      },
      grid: {
        name: 'grid',
        fit: true,
        padding: 50,
        avoidOverlapPadding: 20,
        condense: true,
        animate: true,
        animationDuration: 500,
      },
      cose: {
        name: 'cose',
        animate: true,
        animationDuration: 1000,
        fit: true,
        padding: 50,
        nodeRepulsion: 400000,
        idealEdgeLength: 100,
        nodeOverlap: 20,
        refresh: 20,
        randomize: false,
        componentSpacing: 100,
        edgeElasticity: 100,
        nestingFactor: 5,
        gravity: 80,
        numIter: 1000,
        initialTemp: 200,
        coolingFactor: 0.95,
        minTemp: 1.0,
      },
      'cose-bilkent': {
        name: 'cose-bilkent',
        animate: true,
        animationDuration: 1000,
        fit: true,
        padding: 50,
        nodeDimensionsIncludeLabels: true,
        idealEdgeLength: 100,
        edgeElasticity: 0.45,
        nodeRepulsion: 4500,
        nestingFactor: 0.1,
        gravity: 0.25,
        numIter: 2500,
        tile: true,
        randomize: true,
      },
    };

    const config = layoutConfigs[layoutName] || layoutConfigs.fcose;
    const layout = cy.layout(config);

    layout.on('layoutstop', () => {
      setTimeout(() => {
        cy.fit(undefined, 50);
      }, 100);
    });

    layout.run();
  };

  // Control functions
  const handleZoomIn = () => {
    if (cyRef.current) {
      cyRef.current.zoom({
        level: cyRef.current.zoom() * 1.3,
        renderedPosition: { x: cyRef.current.width() / 2, y: cyRef.current.height() / 2 }
      });
    }
  };

  const handleZoomOut = () => {
    if (cyRef.current) {
      cyRef.current.zoom({
        level: cyRef.current.zoom() * 0.7,
        renderedPosition: { x: cyRef.current.width() / 2, y: cyRef.current.height() / 2 }
      });
    }
  };

  const handleReset = () => {
    if (cyRef.current) {
      cyRef.current.fit(undefined, 50);
      cyRef.current.center();
    }
  };

  const handleLayoutChange = (layoutName: string) => {
    setSelectedLayout(layoutName);
    if (cyRef.current) {
      runLayout(cyRef.current, layoutName);
    }
  };

  const handleReLayout = () => {
    if (cyRef.current) {
      runLayout(cyRef.current, selectedLayout);
    }
  };

  const handleExport = () => {
    if (!cyRef.current) return;
    const png = cyRef.current.png({ scale: 2, bg: isDark ? '#0f172a' : '#f8fafc' });
    const link = document.createElement('a');
    link.href = png;
    link.download = `social-graph-message-${messageId}.png`;
    link.click();
  };

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
            <div className="bg-muted/50 dark:bg-muted/20 rounded-lg p-4 max-w-md mx-auto text-left">
              <p className="text-xs font-medium mb-2">Social Data Captured:</p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                <li>Message author (if available from Telegram)</li>
                <li>Forward source (channel and original message)</li>
                <li>Reply parent (conversation threading)</li>
                <li>Comments from linked discussion groups</li>
              </ul>
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
                  {/* Show paid reactions separately if any */}
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
              {/* Layout Switcher */}
              <div className="flex items-center gap-2">
                <Layout className="h-4 w-4 text-muted-foreground" />
                <select
                  value={selectedLayout}
                  onChange={(e) => handleLayoutChange(e.target.value)}
                  className="h-8 w-[160px] rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  title="Select graph layout"
                >
                  {LAYOUTS.map((layout) => (
                    <option key={layout.value} value={layout.value}>
                      {layout.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="h-6 w-px bg-border" />

              {/* View Controls */}
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

              {/* Export */}
              <Button size="sm" variant="outline" onClick={handleExport} title="Export as PNG">
                <Download className="h-4 w-4 mr-1" />
                PNG
              </Button>
            </div>

            {/* Selected Node Details Panel - appears between toolbar and canvas */}
            {selectedNode && (
              <SelectedNodePanel node={selectedNode} onClose={() => setSelectedNode(null)} />
            )}

            {/* Interactive Graph Container */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">Social Network Graph</span>
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
                className="w-full border border-muted rounded-lg social-graph-container"
                style={{
                  height: '500px',
                  backgroundColor: isDark ? '#0f172a' : '#f8fafc',
                }}
              />
              <p className="text-xs text-muted-foreground text-center mt-2">
                Drag to pan • Scroll to zoom • Click nodes for details • Use layout selector for different views
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Professional Social Graph Theme - Theme-adaptive Cytoscape stylesheet
// Uses muted, professional colors that complement the Entity graph palette
function getSocialGraphStyles(isDark: boolean): any[] {
  const bgColor = isDark ? '#0f172a' : '#f8fafc';
  const textColor = isDark ? '#e2e8f0' : '#334155';

  // Theme-adaptive color palette for social relationships
  // Designed to be softer and more muted than typical bright UI colors
  const colors = {
    // Central message node - matches Entity graph
    message: {
      bg: isDark ? '#3b82f6' : '#2563eb',
      border: isDark ? '#60a5fa' : '#1d4ed8',
    },
    // Author - soft sage green
    author: {
      bg: isDark ? '#6b9a8a' : '#4d7a6a',      // Sage green
      border: isDark ? '#8ab6a6' : '#3a6050',
    },
    // Forward source - muted lavender
    forward: {
      bg: isDark ? '#9b8ac2' : '#7b6aa2',      // Muted lavender
      border: isDark ? '#b5a6d4' : '#5f5082',
    },
    // Parent message (reply) - warm coral
    parent: {
      bg: isDark ? '#c99b6d' : '#a67c52',      // Warm copper
      border: isDark ? '#ddb896' : '#8a6642',
    },
    // Comment nodes - dusty rose
    comment: {
      bg: isDark ? '#b88a9a' : '#986a7a',      // Dusty rose
      border: isDark ? '#cfa8b6' : '#7a5262',
    },
    // Reactions - base warm amber
    reaction: {
      bg: isDark ? '#c9a86d' : '#a68a52',      // Warm amber
      border: isDark ? '#ddc496' : '#8a7042',
    },
    // Specific reaction colors - all muted versions
    reactionFire: { bg: isDark ? '#c99b6d' : '#a67c52', border: isDark ? '#ddb896' : '#8a6642' },
    reactionHeart: { bg: isDark ? '#c28a8a' : '#a26a6a', border: isDark ? '#d4a6a6' : '#825050' },
    reactionThumbUp: { bg: isDark ? '#6b9a8a' : '#4d7a6a', border: isDark ? '#8ab6a6' : '#3a6050' },
    reactionThumbDown: { bg: isDark ? '#6b7a8a' : '#4d5a6a', border: isDark ? '#8a96a6' : '#3a4650' },
    reaction100: { bg: isDark ? '#c9a86d' : '#a68a52', border: isDark ? '#ddc496' : '#8a7042' },
    reactionAngry: { bg: isDark ? '#c2847a' : '#9f5d53', border: isDark ? '#d4a29a' : '#7c443c' },
    reactionSad: { bg: isDark ? '#6b8cae' : '#4a6a8a', border: isDark ? '#8ba8c6' : '#3d5570' },
    reactionThink: { bg: isDark ? '#9b8ac2' : '#7b6aa2', border: isDark ? '#b5a6d4' : '#5f5082' },
    reactionHappy: { bg: isDark ? '#c9a86d' : '#a68a52', border: isDark ? '#ddc496' : '#8a7042' },
    reactionPaid: { bg: isDark ? '#d4a574' : '#b8864c', border: isDark ? '#e8c49c' : '#9a6c38' },
    // Edge colors
    edge: {
      line: isDark ? '#4a5568' : '#a0aec0',
      arrow: isDark ? '#5a6578' : '#8a9ab0',
    },
    edgeAuthor: isDark ? '#6b9a8a' : '#4d7a6a',
    edgeForward: isDark ? '#9b8ac2' : '#7b6aa2',
    edgeReply: isDark ? '#c99b6d' : '#a67c52',
    edgeComment: isDark ? '#b88a9a' : '#986a7a',
    edgeReaction: isDark ? '#64748b' : '#94a3b8',
  };

  return [
    // Core container style - sets the canvas background
    {
      selector: 'core',
      style: {
        'active-bg-color': isDark ? '#1e293b' : '#e2e8f0',
        'active-bg-opacity': 0.5,
      }
    },

    // Default node style
    {
      selector: 'node',
      style: {
        'label': 'data(label)',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'font-size': '10px',
        'font-family': 'Inter, system-ui, sans-serif',
        'font-weight': '500',
        'color': textColor,
        'text-margin-y': 5,
        'background-color': isDark ? '#475569' : '#64748b',
        'background-opacity': 0.92,
        'border-color': isDark ? '#64748b' : '#475569',
        'border-width': 2,
        'width': 40,
        'height': 40,
        'text-wrap': 'ellipsis',
        'text-max-width': '80px',
        'transition-property': 'background-color, border-color, width, height',
        'transition-duration': '0.15s',
      },
    },

    // Message node (center) - Prominent but not harsh
    {
      selector: 'node[type="message"]',
      style: {
        'background-color': colors.message.bg,
        'border-color': colors.message.border,
        'border-width': 3,
        'width': 60,
        'height': 60,
        'font-size': '11px',
        'font-weight': '600',
        'color': isDark ? '#f1f5f9' : '#ffffff',
        'text-outline-width': isDark ? 0 : 1,
        'text-outline-color': isDark ? 'transparent' : 'rgba(0,0,0,0.2)',
      },
    },

    // Author node - Sage green
    {
      selector: 'node[type="author"]',
      style: {
        'background-color': colors.author.bg,
        'border-color': colors.author.border,
        'shape': 'ellipse',
        'width': 45,
        'height': 45,
        'color': isDark ? '#f1f5f9' : '#ffffff',
      },
    },

    // Forward source - Lavender
    {
      selector: 'node[type="forward_source"]',
      style: {
        'background-color': colors.forward.bg,
        'border-color': colors.forward.border,
        'shape': 'round-rectangle',
        'width': 50,
        'height': 35,
        'color': isDark ? '#f1f5f9' : '#ffffff',
      },
    },

    // Parent message (reply to) - Copper
    {
      selector: 'node[type="parent_message"]',
      style: {
        'background-color': colors.parent.bg,
        'border-color': colors.parent.border,
        'shape': 'round-rectangle',
        'width': 50,
        'height': 35,
        'color': isDark ? '#f1f5f9' : '#ffffff',
      },
    },

    // Comment nodes - Dusty rose, smaller
    {
      selector: 'node[type="comment"]',
      style: {
        'background-color': colors.comment.bg,
        'border-color': colors.comment.border,
        'width': 30,
        'height': 30,
        'font-size': '8px',
        'color': isDark ? '#f1f5f9' : '#ffffff',
      },
    },

    // Edge styles - Clean, subtle connections
    {
      selector: 'edge',
      style: {
        'width': 2,
        'line-color': colors.edge.line,
        'target-arrow-color': colors.edge.arrow,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.8,
        'curve-style': 'bezier',
        'label': 'data(label)',
        'font-size': '8px',
        'font-family': 'Inter, system-ui, sans-serif',
        'color': isDark ? '#8892a6' : '#5a6678',
        'text-rotation': 'autorotate',
        'text-margin-y': -8,
        'text-background-color': bgColor,
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
        'opacity': 0.75,
      },
    },

    // Author edge
    {
      selector: 'edge[type="authored"]',
      style: {
        'line-color': colors.edgeAuthor,
        'target-arrow-color': colors.edgeAuthor,
        'width': 2.5,
      },
    },

    // Forward edge
    {
      selector: 'edge[type="forwarded_from"]',
      style: {
        'line-color': colors.edgeForward,
        'target-arrow-color': colors.edgeForward,
        'line-style': 'dashed',
        'width': 2.5,
      },
    },

    // Reply edge
    {
      selector: 'edge[type="reply_to"]',
      style: {
        'line-color': colors.edgeReply,
        'target-arrow-color': colors.edgeReply,
        'width': 2.5,
      },
    },

    // Comment edge
    {
      selector: 'edge[type="commented_on"]',
      style: {
        'line-color': colors.edgeComment,
        'target-arrow-color': colors.edgeComment,
        'width': 1.5,
        'opacity': 0.6,
      },
    },

    // Reaction nodes - Base style with muted amber
    {
      selector: 'node[type="reaction"]',
      style: {
        'background-color': colors.reaction.bg,
        'border-color': colors.reaction.border,
        'shape': 'ellipse',
        'width': 'mapData(count, 1, 10000, 25, 60)',
        'height': 'mapData(count, 1, 10000, 25, 60)',
        'font-size': '9px',
        'text-valign': 'center',
        'text-halign': 'center',
        'color': isDark ? '#f1f5f9' : '#ffffff',
      },
    },

    // Fire 🔥 reaction - Warm copper
    {
      selector: 'node[type="reaction"][emoji="🔥"]',
      style: {
        'background-color': colors.reactionFire.bg,
        'border-color': colors.reactionFire.border,
      },
    },

    // Heart ❤️ reaction - Muted rose
    {
      selector: 'node[type="reaction"][emoji="❤"]',
      style: {
        'background-color': colors.reactionHeart.bg,
        'border-color': colors.reactionHeart.border,
      },
    },

    // Thumbs up 👍 reaction - Sage green
    {
      selector: 'node[type="reaction"][emoji="👍"]',
      style: {
        'background-color': colors.reactionThumbUp.bg,
        'border-color': colors.reactionThumbUp.border,
      },
    },

    // Thumbs down 👎 reaction - Cool gray
    {
      selector: 'node[type="reaction"][emoji="👎"]',
      style: {
        'background-color': colors.reactionThumbDown.bg,
        'border-color': colors.reactionThumbDown.border,
      },
    },

    // 100 💯 reaction - Warm amber
    {
      selector: 'node[type="reaction"][emoji="💯"]',
      style: {
        'background-color': colors.reaction100.bg,
        'border-color': colors.reaction100.border,
      },
    },

    // Angry 😡 reaction - Soft terracotta
    {
      selector: 'node[type="reaction"][emoji="😡"]',
      style: {
        'background-color': colors.reactionAngry.bg,
        'border-color': colors.reactionAngry.border,
      },
    },

    // Sad 😢 reaction - Slate blue
    {
      selector: 'node[type="reaction"][emoji="😢"]',
      style: {
        'background-color': colors.reactionSad.bg,
        'border-color': colors.reactionSad.border,
      },
    },

    // Thinking 🤔 reaction - Lavender
    {
      selector: 'node[type="reaction"][emoji="🤔"]',
      style: {
        'background-color': colors.reactionThink.bg,
        'border-color': colors.reactionThink.border,
      },
    },

    // Happy 😁 reaction - Warm amber
    {
      selector: 'node[type="reaction"][emoji="😁"]',
      style: {
        'background-color': colors.reactionHappy.bg,
        'border-color': colors.reactionHappy.border,
      },
    },

    // Paid reaction ⭐ - Warm gold
    {
      selector: 'node[type="reaction"][emoji*="ReactionPaid"]',
      style: {
        'background-color': colors.reactionPaid.bg,
        'border-color': colors.reactionPaid.border,
        'border-width': 3,
      },
    },

    // Reaction edge - subtle, no arrow
    {
      selector: 'edge[type="reacted"]',
      style: {
        'line-color': colors.edgeReaction,
        'target-arrow-shape': 'none',
        'width': 1.5,
        'opacity': 0.45,
        'line-style': 'dotted',
      },
    },
  ];
}
