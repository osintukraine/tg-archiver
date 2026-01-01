'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
// Note: Using native select for simplicity - can upgrade to Radix UI Select later if needed
import { Loader2, Network, Download, RefreshCw, ZoomIn, ZoomOut, Layout } from 'lucide-react';
import { useNetworkGraph } from '@/hooks/useNetworkGraph';
import { useTheme } from 'next-themes';
import type { Message } from '@/lib/types';

interface CytoscapeNetworkViewProps {
  message: Message;
}

// Available Cytoscape layouts
const LAYOUTS = [
  { value: 'fcose', label: 'Force-Directed (fCoSE)', description: 'Physics-based, organic clustering' },
  { value: 'cose', label: 'Force-Directed (CoSE)', description: 'Simpler physics simulation' },
  { value: 'grid', label: 'Grid', description: 'Organized grid pattern' },
  { value: 'circle', label: 'Circle', description: 'Circular layout' },
  { value: 'concentric', label: 'Concentric', description: 'Concentric circles by importance' },
  { value: 'breadthfirst', label: 'Breadth-First', description: 'Hierarchical tree layout' },
  { value: 'cose-bilkent', label: 'CoSE-Bilkent', description: 'Advanced force-directed' },
];

// Helper to format node type for display
function formatNodeType(type: string): string {
  return type
    .replace(/^curated_/, '')
    .replace(/^opensanctions_/, '')
    .replace(/^ai_tag_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Helper to get node type category and color
function getNodeCategory(type: string): { category: string; color: string; icon: string } {
  if (type === 'message') return { category: 'Message', color: 'bg-blue-500', icon: '📄' };
  if (type.startsWith('curated_')) return { category: 'Curated Entity', color: 'bg-amber-600', icon: '🎯' };
  if (type.startsWith('opensanctions_')) return { category: 'Sanctions Match', color: 'bg-red-500', icon: '⚠️' };
  if (type.startsWith('ai_tag_')) return { category: 'AI Tag', color: 'bg-purple-500', icon: '🤖' };
  if (type === 'related_message') return { category: 'Related Message', color: 'bg-slate-500', icon: '🔗' };
  return { category: 'Unknown', color: 'bg-gray-500', icon: '❓' };
}

// Selected Node Panel Component - displays rich details when a node is clicked
function SelectedNodePanel({ node, onClose }: { node: any; onClose: () => void }) {
  const { category, color, icon } = getNodeCategory(node.type);

  return (
    <div className="mb-3 p-4 bg-muted/50 dark:bg-muted/20 rounded-lg border border-border animate-in slide-in-from-top-2 duration-200">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{icon}</span>
          <div>
            <h4 className="text-sm font-semibold">{node.label}</h4>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs px-2 py-0.5 rounded ${color} text-white`}>
                {category}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatNodeType(node.type)}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
          title="Close"
        >
          <span className="text-lg">×</span>
        </button>
      </div>

      <div className="space-y-3">
        {/* Message node */}
        {node.type === 'message' && (
          <div className="space-y-2">
            {node.content && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Content:</span>
                <p className="text-sm mt-1 p-2 bg-background rounded max-h-24 overflow-y-auto">
                  {node.content}
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-xs">
              {node.views !== undefined && (
                <div><span className="text-muted-foreground">Views:</span> <span className="font-medium">{node.views?.toLocaleString()}</span></div>
              )}
              {node.forwards !== undefined && (
                <div><span className="text-muted-foreground">Forwards:</span> <span className="font-medium">{node.forwards?.toLocaleString()}</span></div>
              )}
            </div>
          </div>
        )}

        {/* Curated Entity */}
        {node.type.startsWith('curated_') && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {node.similarity_score !== undefined && (
                <div>
                  <span className="text-muted-foreground">Match Score:</span>{' '}
                  <span className="font-medium">{(node.similarity_score * 100).toFixed(1)}%</span>
                </div>
              )}
              {node.source && (
                <div>
                  <span className="text-muted-foreground">Source:</span>{' '}
                  <span className="font-medium">{node.source}</span>
                </div>
              )}
              {node.entity_id && (
                <div>
                  <span className="text-muted-foreground">Entity ID:</span>{' '}
                  <span className="font-mono text-xs">{node.entity_id}</span>
                </div>
              )}
              {node.country && (
                <div>
                  <span className="text-muted-foreground">Country:</span>{' '}
                  <span className="font-medium">{node.country}</span>
                </div>
              )}
            </div>
            {node.description && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Description:</span>
                <p className="text-sm mt-1 p-2 bg-background rounded max-h-20 overflow-y-auto">
                  {node.description}
                </p>
              </div>
            )}
            {node.aliases && node.aliases.length > 0 && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Also known as:</span>
                <p className="text-xs mt-1 text-muted-foreground">
                  {Array.isArray(node.aliases) ? node.aliases.join(', ') : node.aliases}
                </p>
              </div>
            )}
          </div>
        )}

        {/* OpenSanctions */}
        {node.type.startsWith('opensanctions_') && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {node.match_score !== undefined && (
                <div>
                  <span className="text-muted-foreground">Match Score:</span>{' '}
                  <span className="font-medium">{(node.match_score * 100).toFixed(1)}%</span>
                </div>
              )}
              {node.risk_classification && (
                <div>
                  <span className="text-muted-foreground">Risk Level:</span>{' '}
                  <span className={`font-medium ${
                    node.risk_classification === 'high' ? 'text-red-500' :
                    node.risk_classification === 'medium' ? 'text-yellow-500' : 'text-green-500'
                  }`}>
                    {node.risk_classification.toUpperCase()}
                  </span>
                </div>
              )}
              {node.schema && (
                <div>
                  <span className="text-muted-foreground">Type:</span>{' '}
                  <span className="font-medium">{node.schema}</span>
                </div>
              )}
              {node.datasets && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">Datasets:</span>{' '}
                  <span className="font-medium">{Array.isArray(node.datasets) ? node.datasets.join(', ') : node.datasets}</span>
                </div>
              )}
            </div>
            {node.sanctions_reason && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Sanctions Reason:</span>
                <p className="text-sm mt-1 p-2 bg-red-50 dark:bg-red-950/20 rounded border border-red-200 dark:border-red-900">
                  {node.sanctions_reason}
                </p>
              </div>
            )}
          </div>
        )}

        {/* AI Tag */}
        {node.type.startsWith('ai_tag_') && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {node.confidence !== undefined && (
                <div>
                  <span className="text-muted-foreground">Confidence:</span>{' '}
                  <span className="font-medium">{(node.confidence * 100).toFixed(0)}%</span>
                </div>
              )}
              {node.tag_value && (
                <div>
                  <span className="text-muted-foreground">Value:</span>{' '}
                  <span className="font-medium">{node.tag_value}</span>
                </div>
              )}
            </div>
            {node.context && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Context:</span>
                <p className="text-xs mt-1 text-muted-foreground">{node.context}</p>
              </div>
            )}
          </div>
        )}

        {/* Related Message */}
        {node.type === 'related_message' && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 text-xs">
              {node.similarity !== undefined && (
                <div>
                  <span className="text-muted-foreground">Similarity:</span>{' '}
                  <span className="font-medium">{(node.similarity * 100).toFixed(1)}%</span>
                </div>
              )}
              {node.message_id && (
                <div>
                  <span className="text-muted-foreground">Message ID:</span>{' '}
                  <a href={`/messages/${node.message_id}`} className="font-medium text-blue-500 hover:underline">
                    #{node.message_id}
                  </a>
                </div>
              )}
            </div>
            {node.content && (
              <div>
                <span className="text-xs font-medium text-muted-foreground">Preview:</span>
                <p className="text-sm mt-1 p-2 bg-background rounded max-h-16 overflow-y-auto">
                  {node.content.substring(0, 150)}...
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CytoscapeNetworkView({ message }: CytoscapeNetworkViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isBrowser, setIsBrowser] = useState(false);
  const [selectedLayout, setSelectedLayout] = useState('fcose');
  const [mounted, setMounted] = useState(false);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const { theme, systemTheme, resolvedTheme } = useTheme();

  // Wait for theme to be resolved (prevents hydration mismatch)
  useEffect(() => {
    setMounted(true);
  }, []);

  // Use resolvedTheme which handles 'system' automatically
  const isDark = mounted ? resolvedTheme === 'dark' : false;

  const { data, isLoading, error } = useNetworkGraph(message.id, {
    includeSimilar: true,
    similarityThreshold: 0.8
  });

  // Ensure we're in browser environment
  useEffect(() => {
    setIsBrowser(true);
  }, []);

  // Update styles when theme changes (including canvas background)
  useEffect(() => {
    if (cyRef.current && isInitialized && mounted) {
      cyRef.current.style(getCytoscapeStyles(isDark));
      // Update the container background color when theme changes
      if (containerRef.current) {
        containerRef.current.style.backgroundColor = isDark ? '#0f172a' : '#f8fafc';
        // Also ensure canvas stays transparent
        const canvasElements = containerRef.current.querySelectorAll('canvas');
        canvasElements.forEach((canvas: HTMLCanvasElement) => {
          canvas.style.backgroundColor = 'transparent';
        });
      }
      console.log('Updated graph theme:', isDark ? 'dark' : 'light');
    }
  }, [isDark, isInitialized, mounted]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!isBrowser || !containerRef.current || !data) return;

    // Prevent double initialization
    if (isInitialized) {
      console.log('Already initialized, skipping...');
      return;
    }

    let mounted = true;

    // Dynamic import to avoid SSR issues
    const initCytoscape = async () => {
      try {
        const cytoscape = (await import('cytoscape')).default;
        const fcose = (await import('cytoscape-fcose')).default;
        const coseBilkent = (await import('cytoscape-cose-bilkent')).default;

        // Check if component is still mounted
        if (!mounted || !containerRef.current) return;

        // Register layout plugins
        cytoscape.use(fcose);
        cytoscape.use(coseBilkent);

        // Use all nodes from API - no filtering needed
        // API returns: curated entities, OpenSanctions, AI tags, and similar messages
        const filteredNodes = data.nodes;
        const filteredEdges = data.edges;

        // Calculate importance score for each node (0-100 scale)
        // This determines node size in the graph
        const calculateImportance = (node: any): number => {
          const type = node.type;
          const nodeData = node.data || {};

          // Message node is always most important (center of graph)
          if (type === 'message') return 100;

          // OpenSanctions - High profile individuals/organizations
          // Score based on match_score + risk_classification bonus
          if (type.startsWith('opensanctions_')) {
            const matchScore = nodeData.match_score || 0.5;
            const riskBonus = nodeData.risk_classification === 'high' ? 20 :
                              nodeData.risk_classification === 'medium' ? 10 : 0;
            // Famous figures (Putin, Shoigu, Prigozhin) get extra boost based on match quality
            const baseScore = matchScore * 60 + riskBonus;
            return Math.min(95, baseScore + 20); // Cap at 95, leave 100 for message
          }

          // Curated entities - Military equipment, units, locations
          // Score based on similarity_score and entity type significance
          if (type.startsWith('curated_')) {
            const similarity = nodeData.similarity_score || 0.7;
            // Different entity types have different base importance
            const typeBonus =
              type === 'curated_military_vehicle' ? 15 : // Tanks, APCs very important
              type === 'curated_aircraft' ? 15 : // Aircraft significant
              type === 'curated_military_weapon' ? 12 :
              type === 'curated_military_unit' ? 10 :
              type === 'curated_ship' ? 10 :
              type === 'curated_electronic_warfare' ? 8 :
              type === 'curated_component' ? 5 : 0;
            // Exact matches (similarity 1.0) are more important
            return Math.min(85, similarity * 50 + typeBonus + 20);
          }

          // AI tags - Lower importance, informational
          if (type.startsWith('ai_tag_')) {
            const confidence = nodeData.confidence || 0.5;
            // Urgency tags are more important than generic keywords
            const typeBonus =
              type === 'ai_tag_urgency' ? 20 :
              type === 'ai_tag_topic' ? 10 :
              type === 'ai_tag_emotion' ? 8 :
              type === 'ai_tag_keyword' ? 5 :
              type === 'ai_tag_entity' ? 12 : 0;
            return Math.min(60, confidence * 30 + typeBonus);
          }

          // Related/similar messages
          if (type === 'related_message') return 35;

          // Default importance
          return 30;
        };

        // Map importance (20-100) to size dimensions
        const mapImportanceToSize = (importance: number) => {
          // Clamp importance between 20 and 100
          const clamped = Math.max(20, Math.min(100, importance));
          // Linear interpolation: 20->50px, 100->110px for width
          const width = 50 + ((clamped - 20) / 80) * 60;
          // Height is slightly smaller ratio
          const height = 35 + ((clamped - 20) / 80) * 40;
          // Font size: 8-13px
          const fontSize = 8 + ((clamped - 20) / 80) * 5;
          return { width, height, fontSize };
        };

        // Convert API data to Cytoscape format with pre-calculated sizes
        const elements: any[] = [
          // Nodes - add calculated importance and pre-computed size values
          ...filteredNodes.map(node => {
            const importance = calculateImportance(node);
            const { width, height, fontSize } = mapImportanceToSize(importance);
            return {
              data: {
                id: node.id,
                label: node.label,
                type: node.type,
                importance,
                // Pre-computed size values for Cytoscape
                nodeWidth: width,
                nodeHeight: height,
                nodeFontSize: fontSize,
                ...node.data
              }
            };
          }),
          // Edges (filtered to match filtered nodes)
          ...filteredEdges.map(edge => ({
            data: {
              id: edge.id,
              source: edge.source,
              target: edge.target,
              label: edge.label,
              type: edge.type,
              weight: edge.weight || 1
            }
          }))
        ];

        console.log('Initializing Cytoscape network graph:', elements.length, 'elements');

        // Initialize Cytoscape instance
        const cy = cytoscape({
          container: containerRef.current,
          elements,
          style: getCytoscapeStyles(isDark),
          minZoom: 0.1,
          maxZoom: 3,
          wheelSensitivity: 0.2
        });

        console.log('Cytoscape initialized:', cy.nodes().length, 'nodes,', cy.edges().length, 'edges');

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
          const nodeData = node.data();
          console.log('Node clicked:', nodeData);
          setSelectedNode({
            id: node.id(),
            label: nodeData.label,
            type: nodeData.type,
            ...nodeData,
          });
        });

        // Clear selection when clicking empty space
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

        // Run layout immediately while we still have the cy instance
        console.log('Running layout immediately...');
        try {
          const layout = cy.layout({
            name: 'fcose',
            // Quality presets: 'default' | 'draft' | 'proof'
            quality: 'default',
            // Use random initial positions to help algorithm converge
            randomize: true,
            // Animation settings
            animate: true,
            animationDuration: 1000,
            animationEasing: undefined,
            // Layout-specific options
            fit: true,
            padding: 50,
            nodeDimensionsIncludeLabels: true,
            uniformNodeDimensions: false,
            packComponents: true,
            stepSize: 1,
            // Physics simulation parameters
            samplingType: true,
            sampleSize: 25,
            nodeSeparation: 75,
            piTol: 0.0000001,
            idealEdgeLength: (edge: any) => 100,
            edgeElasticity: (edge: any) => 0.45,
            nestingFactor: 0.1,
            gravity: 0.25,
            numIter: 2500,
            tile: true,
            tilingPaddingVertical: 10,
            tilingPaddingHorizontal: 10,
            gravityRangeCompound: 1.5,
            gravityCompound: 1.0,
            gravityRange: 3.8,
            initialEnergyOnIncremental: 0.3
          } as any);

          // Fit viewport after layout completes
          layout.on('layoutstop', function() {
            setTimeout(() => {
              cy.fit(undefined, 50);
              console.log('Force-directed layout complete');
            }, 100);
          });

          layout.run();
        } catch (err) {
          console.error('Failed to run layout:', err);
          // Fallback to simple cose layout if fcose fails
          console.log('Trying fallback cose layout...');
          const fallbackLayout = cy.layout({
            name: 'cose',
            animate: true,
            animationDuration: 1000,
            idealEdgeLength: 100,
            nodeOverlap: 20,
            refresh: 20,
            fit: true,
            padding: 30,
            randomize: false,
            componentSpacing: 100,
            nodeRepulsion: 400000,
            edgeElasticity: 100,
            nestingFactor: 5,
            gravity: 80,
            numIter: 1000,
            initialTemp: 200,
            coolingFactor: 0.95,
            minTemp: 1.0
          });
          fallbackLayout.run();
        }

        // Only update state if still mounted
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
    };
  }, [data, isBrowser]); // Don't include isInitialized to prevent re-run after initialization

  // Control functions
  const handleZoomIn = () => {
    if (cyRef.current) {
      cyRef.current.zoom({
        level: cyRef.current.zoom() * 1.2,
        renderedPosition: { x: cyRef.current.width() / 2, y: cyRef.current.height() / 2 }
      });
    }
  };

  const handleZoomOut = () => {
    if (cyRef.current) {
      cyRef.current.zoom({
        level: cyRef.current.zoom() * 0.8,
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
    if (!cyRef.current) return;

    // Get layout configuration based on selected layout
    const getLayoutConfig = (name: string) => {
      switch (name) {
        case 'fcose':
          return {
            name: 'fcose',
            quality: 'default',
            randomize: true,
            animate: true,
            animationDuration: 1000,
            fit: true,
            padding: 50,
            nodeDimensionsIncludeLabels: true,
            idealEdgeLength: 100,
            edgeElasticity: 0.45,
            nodeSeparation: 75
          };
        case 'cose':
          return {
            name: 'cose',
            animate: true,
            animationDuration: 1000,
            fit: true,
            padding: 50,
            nodeRepulsion: 400000,
            idealEdgeLength: 100
          };
        case 'grid':
          return {
            name: 'grid',
            fit: true,
            padding: 30,
            avoidOverlapPadding: 10,
            condense: true,
            rows: undefined,
            cols: undefined
          };
        case 'circle':
          return {
            name: 'circle',
            fit: true,
            padding: 30,
            avoidOverlap: true,
            radius: undefined
          };
        case 'concentric':
          return {
            name: 'concentric',
            fit: true,
            padding: 30,
            startAngle: 3.14159 / 2,
            sweep: undefined,
            clockwise: true,
            equidistant: false,
            minNodeSpacing: 10
          };
        case 'breadthfirst':
          return {
            name: 'breadthfirst',
            fit: true,
            padding: 30,
            directed: false,
            spacingFactor: 1.75,
            avoidOverlap: true
          };
        case 'cose-bilkent':
          return {
            name: 'cose-bilkent',
            animate: true,
            animationDuration: 1000,
            fit: true,
            padding: 50,
            nodeDimensionsIncludeLabels: true,
            idealEdgeLength: 100,
            edgeElasticity: 0.45
          };
        default:
          return { name, fit: true, padding: 30 };
      }
    };

    const layout = cyRef.current.layout(getLayoutConfig(layoutName) as any);
    layout.run();
  };

  const handleReLayout = () => {
    if (!cyRef.current) return;

    const layout = cyRef.current.layout({
      name: 'fcose',
      quality: 'default',
      randomize: true,
      animate: true,
      animationDuration: 1000,
      fit: true,
      padding: 50,
      nodeDimensionsIncludeLabels: true,
      uniformNodeDimensions: false,
      packComponents: true,
      samplingType: true,
      sampleSize: 25,
      nodeSeparation: 75,
      idealEdgeLength: (edge: any) => 100,
      edgeElasticity: (edge: any) => 0.45,
      nestingFactor: 0.1,
      gravity: 0.25,
      numIter: 2500,
      tile: true,
      gravityRange: 3.8
    });

    layout.run();
  };

  const handleExport = () => {
    if (!cyRef.current) return;

    // Export as PNG
    const png = cyRef.current.png({ scale: 2 });
    const link = document.createElement('a');
    link.href = png;
    link.download = `network-graph-message-${message.id}.png`;
    link.click();
  };

  const handleExportFlowsint = async () => {
    try {
      const { API_URL } = await import('@/lib/api');
      const response = await fetch(`${API_URL}/api/messages/${message.id}/network/export?format=flowsint`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `flowsint-export-${message.id}.json`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export to Flowsint:', error);
      alert(`Failed to export: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  if (isLoading || !isBrowser) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          {!isBrowser ? 'Initializing...' : 'Building force-directed network graph...'}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-destructive">Failed to load network graph</p>
        <p className="text-xs text-muted-foreground mt-1">{error.message}</p>
      </div>
    );
  }

  // Check if there are any curated entity matches (from knowledge graph)
  const hasCuratedEntities = data?.nodes.some(node =>
    node.type.startsWith('curated_')
  ) ?? false;

  // Check if entity matching has been processed
  const hasEntityData = data?.metadata?.curated_entity_count !== undefined;

  if (!data || data.nodes.length === 0) {
    return (
      <div className="text-center py-12">
        <Network className="h-12 w-12 mx-auto text-muted-foreground/20 mb-3" />
        <p className="text-sm text-muted-foreground">No network data available</p>
        <p className="text-xs text-muted-foreground mt-1">
          This message may not have extracted entities or related content
        </p>
      </div>
    );
  }

  // If no curated entities found, show helpful message
  if (!hasCuratedEntities) {
    return (
      <div className="text-center py-12 space-y-4">
        <Network className="h-12 w-12 mx-auto text-muted-foreground/20 mb-3" />
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-2">
            No Entity Matches Found
          </p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            This message has not been matched against the curated knowledge graph
            (1,425 entities from ArmyGuide, Root.NK, ODIN).
          </p>
        </div>
        <div className="bg-muted/50 dark:bg-muted/20 rounded-lg p-4 max-w-md mx-auto text-left">
          <p className="text-xs font-medium mb-2">Why no matches?</p>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>Message content does not mention known entities (tanks, weapons, locations, units)</li>
            <li>Entity matching service has not processed this message yet</li>
            <li>Mentioned entities are not in the curated knowledge graph</li>
          </ul>
        </div>
        {hasEntityData && data.metadata && (
          <div className="text-xs text-muted-foreground">
            <p>Entity processing status: {data.metadata.curated_entity_count === 0 ? 'Processed (no matches)' : 'Pending'}</p>
          </div>
        )}
      </div>
    );
  }

  // Calculate total node count
  const filteredNodeCount = data.nodes.filter(node =>
    node.type === 'message' ||
    node.type.startsWith('curated_') ||
    node.type.startsWith('opensanctions_') ||
    node.type.startsWith('ai_tag_') ||
    node.type === 'related_message'
  ).length;

  const filteredEdgeCount = data.edges.filter(edge => {
    const sourceNode = data.nodes.find(n => n.id === edge.source);
    const targetNode = data.nodes.find(n => n.id === edge.target);
    return sourceNode && targetNode &&
      (sourceNode.type === 'message' || sourceNode.type.startsWith('curated_') || sourceNode.type.startsWith('ai_tag_') || sourceNode.type === 'related_message') &&
      (targetNode.type === 'message' || targetNode.type.startsWith('curated_') || targetNode.type.startsWith('ai_tag_') || targetNode.type === 'related_message');
  }).length;

  return (
    <div className="space-y-4">
      {/* Header with controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Network className="h-4 w-4" />
            Entity Knowledge Graph
          </h3>
          <Badge variant="outline" className="text-xs">
            Entities + Sanctions + AI Tags
          </Badge>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="text-xs">
            {filteredNodeCount} nodes
          </Badge>
          <Badge variant="outline" className="text-xs">
            {filteredEdgeCount} edges
          </Badge>
        </div>
      </div>

      {/* Graph controls */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Layout Switcher */}
        <div className="flex items-center gap-2">
          <Layout className="h-4 w-4 text-muted-foreground" />
          <select
            value={selectedLayout}
            onChange={(e) => handleLayoutChange(e.target.value)}
            className="h-8 w-[200px] rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            title="Select graph layout algorithm"
          >
            {LAYOUTS.map((layout) => (
              <option key={layout.value} value={layout.value}>
                {layout.label}
              </option>
            ))}
          </select>
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-border" />

        {/* View Controls */}
        <Button size="sm" variant="outline" onClick={handleZoomIn} title="Zoom In">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={handleZoomOut} title="Zoom Out">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={handleReset} title="Reset View">
          Reset View
        </Button>

        {/* Divider */}
        <div className="h-6 w-px bg-border" />

        {/* Export Controls */}
        <Button size="sm" variant="outline" onClick={handleExport} title="Export as PNG">
          <Download className="h-4 w-4 mr-1" />
          Export PNG
        </Button>
        <Button size="sm" variant="default" onClick={handleExportFlowsint} title="Export to Flowsint">
          <Download className="h-4 w-4 mr-1" />
          Export to Flowsint
        </Button>
      </div>

      {/* Selected Node Details Panel - appears between toolbar and canvas */}
      {selectedNode && (
        <SelectedNodePanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      )}

      {/* Cytoscape container */}
      <div
        ref={containerRef}
        className="rounded-lg border border-gray-200 dark:border-gray-700 cytoscape-container"
        style={{
          width: '100%',
          height: '700px',
          minHeight: '700px',
          backgroundColor: isDark ? '#0f172a' : '#f8fafc',
          position: 'relative'
        }}
      />

      {/* Legend (same as before, keep the 3-section legend) */}
      <NetworkLegend metadata={data.metadata} />

      {/* Info box */}
      <div className="text-xs text-gray-700 dark:text-gray-300 bg-slate-50 dark:bg-slate-800 p-3 rounded">
        <p className="font-medium mb-1">Entity Knowledge Graph:</p>
        <ul className="space-y-1 ml-4 list-disc">
          <li>Shows <strong>curated entity matches</strong> from knowledge graph (1,425 entities)</li>
          <li>Entities matched from ArmyGuide, Root.NK Database, ODIN Sanctions</li>
          <li>Includes AI-generated tags and similar messages</li>
          <li>Click nodes for details • Drag to explore • Scroll to zoom</li>
        </ul>
      </div>
    </div>
  );
}

// Professional OSINT Theme - Theme-adaptive Cytoscape stylesheet
// Uses muted, professional colors that adapt to dark/light themes
function getCytoscapeStyles(isDark: boolean): any[] {
  const bgColor = isDark ? '#0f172a' : '#f8fafc';
  const textColor = isDark ? '#e2e8f0' : '#334155';

  // Theme-adaptive color palette - muted, professional colors
  // Dark mode: lighter, desaturated colors that glow softly
  // Light mode: deeper but still muted colors that don't strain
  const colors = {
    // Primary message node
    message: {
      bg: isDark ? '#3b82f6' : '#2563eb',      // Blue - slightly muted
      border: isDark ? '#60a5fa' : '#1d4ed8',
    },
    // Military vehicles - warm terracotta instead of harsh red
    militaryVehicle: {
      bg: isDark ? '#c2847a' : '#9f5d53',      // Muted terracotta
      border: isDark ? '#d4a29a' : '#7c443c',
    },
    // Military weapons - copper/bronze
    militaryWeapon: {
      bg: isDark ? '#c99b6d' : '#a67c52',      // Warm copper
      border: isDark ? '#ddb896' : '#8a6642',
    },
    // Aircraft - slate blue
    aircraft: {
      bg: isDark ? '#6b8cae' : '#4a6a8a',      // Muted slate blue
      border: isDark ? '#8ba8c6' : '#3d5570',
    },
    // Electronic warfare - muted purple/violet
    electronicWarfare: {
      bg: isDark ? '#9b8ac2' : '#7b6aa2',      // Muted violet
      border: isDark ? '#b5a6d4' : '#5f5082',
    },
    // Components - warm amber/khaki
    component: {
      bg: isDark ? '#b8a676' : '#968656',      // Khaki/sand
      border: isDark ? '#cfc094' : '#7a6c42',
    },
    // Ships - ocean teal
    ship: {
      bg: isDark ? '#6a9a9a' : '#4d7a7a',      // Muted teal
      border: isDark ? '#8ab6b6' : '#3a6060',
    },
    // Military units - muted rose
    militaryUnit: {
      bg: isDark ? '#b88a9a' : '#986a7a',      // Dusty rose
      border: isDark ? '#cfa8b6' : '#7a5262',
    },
    // OpenSanctions - warning amber (not harsh red/yellow)
    sanctions: {
      bg: isDark ? '#d4a574' : '#b8864c',      // Warm amber
      border: isDark ? '#e8c49c' : '#9a6c38',
    },
    sanctionsPerson: {
      bg: isDark ? '#d4a574' : '#b8864c',
      border: isDark ? '#ecd4b4' : '#9a6c38',
    },
    sanctionsCompany: {
      bg: isDark ? '#c89660' : '#a87840',
      border: isDark ? '#e0b888' : '#886030',
    },
    // AI tags - soft pastels
    aiKeyword: {
      bg: isDark ? '#9b8ac2' : '#7b6aa2',      // Soft violet
      border: isDark ? '#b5a6d4' : '#5f5082',
    },
    aiTopic: {
      bg: isDark ? '#7b9bc2' : '#5b7ba2',      // Soft indigo
      border: isDark ? '#9bb6d8' : '#455f82',
    },
    aiEntity: {
      bg: isDark ? '#b88a9a' : '#986a7a',      // Soft rose
      border: isDark ? '#d0a6b4' : '#7a5060',
    },
    aiEmotion: {
      bg: isDark ? '#c99b6d' : '#a67c52',      // Soft copper
      border: isDark ? '#ddb896' : '#8a6642',
    },
    aiUrgency: {
      bg: isDark ? '#c2847a' : '#9f5d53',      // Soft terracotta
      border: isDark ? '#d4a29a' : '#7c443c',
    },
    // Related messages - subtle
    related: {
      bg: isDark ? '#475569' : '#e2e8f0',
      border: isDark ? '#64748b' : '#cbd5e1',
      text: isDark ? '#94a3b8' : '#475569',
    },
    // Edges
    edge: {
      line: isDark ? '#4a5568' : '#a0aec0',
      arrow: isDark ? '#5a6578' : '#8a9ab0',
    },
    edgeSimilar: isDark ? '#68a89b' : '#4a8a7b',
    edgeEntity: isDark ? '#c99b6d' : '#a67c52',
    edgeSanctions: isDark ? '#d4a574' : '#b8864c',
    edgeAiTag: isDark ? '#9b8ac2' : '#7b6aa2',
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

    // Node defaults - Modern flat design with DYNAMIC SIZING based on importance
    {
      selector: 'node',
      style: {
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': 'data(nodeFontSize)',
        'font-family': 'Inter, system-ui, sans-serif',
        'font-weight': '500',
        'color': isDark ? '#f1f5f9' : '#ffffff',
        'text-outline-width': isDark ? 0 : 1.5,
        'text-outline-color': isDark ? 'transparent' : 'rgba(0,0,0,0.3)',
        'background-color': isDark ? '#475569' : '#64748b',
        'background-opacity': 0.92,
        'border-color': isDark ? '#64748b' : '#475569',
        'border-width': 2,
        'border-opacity': 0.9,
        'width': 'data(nodeWidth)',
        'height': 'data(nodeHeight)',
        'shape': 'round-rectangle',
        'text-wrap': 'ellipsis',
        'text-max-width': 'data(nodeWidth)',
        'overlay-opacity': 0,
        'transition-property': 'background-color, border-color, width, height',
        'transition-duration': '0.2s'
      }
    },

    // Hover state for nodes
    {
      selector: 'node:active',
      style: {
        'overlay-opacity': 0.08,
        'overlay-color': isDark ? '#fff' : '#000'
      }
    },

    // Message node (center) - Prominent but not harsh
    {
      selector: 'node[type="message"]',
      style: {
        'background-color': colors.message.bg,
        'border-color': colors.message.border,
        'border-width': 3,
        'font-weight': '600',
        'shape': 'round-rectangle',
      }
    },

    // Curated entity types - Professional military intelligence colors
    {
      selector: 'node[type="curated_military_vehicle"]',
      style: {
        'background-color': colors.militaryVehicle.bg,
        'border-color': colors.militaryVehicle.border,
        'shape': 'hexagon'
      }
    },
    {
      selector: 'node[type="curated_military_weapon"]',
      style: {
        'background-color': colors.militaryWeapon.bg,
        'border-color': colors.militaryWeapon.border,
        'shape': 'diamond'
      }
    },
    {
      selector: 'node[type="curated_aircraft"]',
      style: {
        'background-color': colors.aircraft.bg,
        'border-color': colors.aircraft.border,
        'shape': 'triangle'
      }
    },
    {
      selector: 'node[type="curated_electronic_warfare"]',
      style: {
        'background-color': colors.electronicWarfare.bg,
        'border-color': colors.electronicWarfare.border,
        'shape': 'octagon'
      }
    },
    {
      selector: 'node[type="curated_component"]',
      style: {
        'background-color': colors.component.bg,
        'border-color': colors.component.border,
        'shape': 'round-rectangle'
      }
    },
    {
      selector: 'node[type="curated_ship"]',
      style: {
        'background-color': colors.ship.bg,
        'border-color': colors.ship.border,
        'shape': 'pentagon'
      }
    },
    {
      selector: 'node[type="curated_military_unit"]',
      style: {
        'background-color': colors.militaryUnit.bg,
        'border-color': colors.militaryUnit.border,
        'shape': 'star'
      }
    },

    // OpenSanctions nodes - Warm amber warning (not harsh red/yellow)
    {
      selector: 'node[type^="opensanctions_"]',
      style: {
        'background-color': colors.sanctions.bg,
        'border-color': colors.sanctions.border,
        'border-width': 3,
        'shape': 'round-rectangle',
      }
    },
    {
      selector: 'node[type="opensanctions_person"]',
      style: {
        'background-color': colors.sanctionsPerson.bg,
        'border-color': colors.sanctionsPerson.border,
        'shape': 'ellipse'
      }
    },
    {
      selector: 'node[type="opensanctions_company"]',
      style: {
        'background-color': colors.sanctionsCompany.bg,
        'border-color': colors.sanctionsCompany.border,
        'shape': 'round-rectangle'
      }
    },

    // AI tag nodes - Soft, informational pastels
    {
      selector: 'node[type^="ai_tag"]',
      style: {
        'shape': 'round-rectangle',
        'border-width': 2,
        'font-weight': '500',
        'background-opacity': 0.88
      }
    },
    {
      selector: 'node[type="ai_tag_keyword"], node[type="ai_tag_keywords"]',
      style: {
        'background-color': colors.aiKeyword.bg,
        'border-color': colors.aiKeyword.border
      }
    },
    {
      selector: 'node[type="ai_tag_topic"]',
      style: {
        'background-color': colors.aiTopic.bg,
        'border-color': colors.aiTopic.border
      }
    },
    {
      selector: 'node[type="ai_tag_entity"], node[type="ai_tag_entities"]',
      style: {
        'background-color': colors.aiEntity.bg,
        'border-color': colors.aiEntity.border
      }
    },
    {
      selector: 'node[type="ai_tag_emotion"], node[type="ai_tag_emotions"]',
      style: {
        'background-color': colors.aiEmotion.bg,
        'border-color': colors.aiEmotion.border
      }
    },
    {
      selector: 'node[type="ai_tag_urgency"]',
      style: {
        'background-color': colors.aiUrgency.bg,
        'border-color': colors.aiUrgency.border
      }
    },

    // Related/Similar message nodes
    {
      selector: 'node[type="related_message"]',
      style: {
        'background-color': colors.related.bg,
        'border-color': colors.related.border,
        'shape': 'round-rectangle',
        'color': colors.related.text,
        'text-outline-width': 0
      }
    },

    // Edge styles - Clean, subtle connections
    {
      selector: 'edge',
      style: {
        'width': 1.5,
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
        'opacity': 0.7,
        'transition-property': 'line-color, width, opacity',
        'transition-duration': '0.15s'
      }
    },

    // Highlighted edges on hover
    {
      selector: 'edge:active',
      style: {
        'opacity': 1,
        'width': 3
      }
    },

    // Similar message edges
    {
      selector: 'edge[type="similar"]',
      style: {
        'line-color': colors.edgeSimilar,
        'target-arrow-color': colors.edgeSimilar,
        'line-style': 'dashed',
        'width': 2,
        'opacity': 0.75
      }
    },

    // Entity match edges
    {
      selector: 'edge[type="entity_match"]',
      style: {
        'width': 'mapData(weight, 0, 1, 1.5, 3.5)',
        'line-color': colors.edgeEntity,
        'target-arrow-color': colors.edgeEntity,
        'opacity': 0.8
      }
    },

    // Sanctions match edges
    {
      selector: 'edge[type="sanctions_match"]',
      style: {
        'width': 'mapData(weight, 0, 1, 2, 4)',
        'line-color': colors.edgeSanctions,
        'target-arrow-color': colors.edgeSanctions,
        'opacity': 0.85,
        'line-style': 'solid'
      }
    },

    // AI tag edges
    {
      selector: 'edge[type="ai_tag"]',
      style: {
        'line-color': colors.edgeAiTag,
        'target-arrow-color': colors.edgeAiTag,
        'width': 1.5,
        'opacity': 0.55,
        'line-style': 'dotted'
      }
    }
  ];
}

// Separate legend component with theme-adaptive colors
function NetworkLegend({ metadata }: { metadata: any }) {
  // Node type color legend - using muted professional colors
  // These should roughly match getCytoscapeStyles dark mode colors
  const nodeColors = [
    { type: 'Message', color: '#3b82f6', description: 'Source message' },
    { type: 'Military Vehicle', color: '#c2847a', description: 'Tanks, APCs, artillery' },
    { type: 'Military Weapon', color: '#c99b6d', description: 'Weapons systems' },
    { type: 'Component', color: '#b8a676', description: 'Equipment parts' },
    { type: 'Ship', color: '#6a9a9a', description: 'Naval vessels' },
    { type: 'Aircraft', color: '#6b8cae', description: 'Air assets' },
    { type: 'Military Unit', color: '#b88a9a', description: 'Army units, brigades' },
    { type: 'Sanctions', color: '#d4a574', description: 'OpenSanctions matches' },
    { type: 'Keywords', color: '#9b8ac2', description: 'AI-extracted keywords' },
    { type: 'Entities', color: '#b88a9a', description: 'AI-identified entities' },
    { type: 'Similar', color: '#475569', description: 'Related messages' },
  ];

  return (
    <div className="space-y-4">
      {/* Statistics Section */}
      <div className="space-y-2">
        <div className="font-medium text-sm text-gray-700 dark:text-gray-300">
          Network Statistics
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-600 dark:text-gray-400">
          <div>Curated Entities: <strong>{metadata.curated_entity_count}</strong></div>
          <div>OpenSanctions: <strong>{metadata.opensanctions_count || 0}</strong></div>
          <div>AI Tags: <strong>{metadata.ai_tag_count}</strong></div>
          <div>Similar Messages: <strong>{metadata.similar_count}</strong></div>
        </div>
      </div>

      {/* Color Legend Section */}
      <div className="space-y-2">
        <div className="font-medium text-sm text-gray-700 dark:text-gray-300">
          Node Color Legend
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
          {nodeColors.map((item) => (
            <div key={item.type} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full border border-gray-300 dark:border-gray-600 flex-shrink-0"
                style={{ backgroundColor: item.color }}
                title={item.description}
              />
              <span className="text-gray-700 dark:text-gray-300 truncate" title={item.description}>
                {item.type}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
