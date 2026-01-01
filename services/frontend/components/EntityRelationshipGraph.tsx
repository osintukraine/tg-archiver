'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Network, RefreshCw, ZoomIn, ZoomOut, Download } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEntityRelationships } from '@/hooks/useEntityRelationships';
import type { RelationshipItem, RelationshipsResponse } from '@/lib/types';

interface EntityRelationshipGraphProps {
  source: 'curated' | 'opensanctions';
  entityId: string;
  entityName: string;
}

// Relationship category filters
type FilterType = 'all' | 'corporate' | 'political' | 'associates';

// Convert relationship data to Cytoscape elements
function buildGraphElements(
  data: RelationshipsResponse,
  entityName: string,
  filter: FilterType,
  isDark: boolean
) {
  const nodes: any[] = [];
  const edges: any[] = [];

  // Central node (the entity we're viewing)
  nodes.push({
    data: {
      id: 'central',
      label: entityName,
      type: 'central',
      nodeWidth: 110,
      nodeHeight: 45,
      nodeFontSize: 12,
    }
  });

  let edgeId = 0;

  // Helper to add relationships of a specific type
  const addRelationships = (
    relationships: RelationshipItem[],
    category: 'corporate' | 'political' | 'associates'
  ) => {
    if (filter !== 'all' && filter !== category) return;

    relationships.forEach((rel, idx) => {
      const nodeId = `${category}-${idx}`;

      // Format edge label with role/dates
      let edgeLabel = rel.type.replace(/_/g, ' ');
      if (rel.role) edgeLabel = rel.role;
      if (rel.start) {
        edgeLabel += ` (${rel.start}${rel.end ? '-' + rel.end : '-'})`;
      }
      if (rel.share) edgeLabel += ` ${rel.share}`;

      // Add node
      nodes.push({
        data: {
          id: nodeId,
          label: rel.name,
          type: category,
          entity_id: rel.entity_id,
          role: rel.role,
          start: rel.start,
          end: rel.end,
          share: rel.share,
          relation: rel.relation,
          // OpenSanctions enrichment
          opensanctions_id: rel.opensanctions_id,
          is_sanctioned: rel.is_sanctioned,
          risk_classification: rel.risk_classification,
          // Size based on importance (sanctioned entities larger)
          nodeWidth: rel.is_sanctioned ? 95 : 85,
          nodeHeight: rel.is_sanctioned ? 38 : 34,
          nodeFontSize: rel.is_sanctioned ? 11 : 10,
        }
      });

      // Add edge from central node to this relationship
      edges.push({
        data: {
          id: `edge-${edgeId++}`,
          source: 'central',
          target: nodeId,
          label: edgeLabel,
          type: category,
        }
      });
    });
  };

  // Add all relationship types
  addRelationships(data.corporate || [], 'corporate');
  addRelationships(data.political || [], 'political');
  addRelationships(data.associates || [], 'associates');

  return [...nodes, ...edges];
}

// Cytoscape styles for relationship graph
function getRelationshipStyles(isDark: boolean): any[] {
  const bgColor = isDark ? '#0f172a' : '#f8fafc';
  const textColor = isDark ? '#e2e8f0' : '#334155';

  // Professional color scheme matching design doc
  const colors = {
    // Central entity - Blue
    central: {
      bg: isDark ? '#3b82f6' : '#2563eb',
      border: isDark ? '#60a5fa' : '#1d4ed8',
    },
    // Corporate - Slate blue
    corporate: {
      bg: isDark ? '#6b8cae' : '#4a6a8a',
      border: isDark ? '#8ba8c6' : '#3d5570',
    },
    // Political - Lavender
    political: {
      bg: isDark ? '#9b8ac2' : '#7b6aa2',
      border: isDark ? '#b5a6d4' : '#5f5082',
    },
    // Associates - Sage green
    associates: {
      bg: isDark ? '#6b9a8a' : '#4d7a6a',
      border: isDark ? '#8ab6a6' : '#3a6050',
    },
    // Edge colors
    edge: {
      line: isDark ? '#4a5568' : '#a0aec0',
    },
    edgeCorporate: isDark ? '#6b8cae' : '#4a6a8a',
    edgePolitical: isDark ? '#9b8ac2' : '#7b6aa2',
    edgeAssociates: isDark ? '#6b9a8a' : '#4d7a6a',
  };

  return [
    // Core container
    {
      selector: 'core',
      style: {
        'active-bg-color': isDark ? '#1e293b' : '#e2e8f0',
        'active-bg-opacity': 0.5,
      }
    },
    // Node defaults
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
        'background-opacity': 0.92,
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
    // Central entity node
    {
      selector: 'node[type="central"]',
      style: {
        'background-color': colors.central.bg,
        'border-color': colors.central.border,
        'border-width': 3,
        'font-weight': '600',
      }
    },
    // Corporate nodes
    {
      selector: 'node[type="corporate"]',
      style: {
        'background-color': colors.corporate.bg,
        'border-color': colors.corporate.border,
        'shape': 'round-rectangle',
      }
    },
    // Political nodes
    {
      selector: 'node[type="political"]',
      style: {
        'background-color': colors.political.bg,
        'border-color': colors.political.border,
        'shape': 'round-rectangle',
      }
    },
    // Associate nodes
    {
      selector: 'node[type="associates"]',
      style: {
        'background-color': colors.associates.bg,
        'border-color': colors.associates.border,
        'shape': 'round-rectangle',
      }
    },
    // Sanctioned entity overlay - add warning indicator
    {
      selector: 'node[is_sanctioned]',
      style: {
        'border-width': 3,
        'border-color': isDark ? '#d4a574' : '#b8864c',
      }
    },
    // Edge defaults
    {
      selector: 'edge',
      style: {
        'width': 2,
        'line-color': colors.edge.line,
        'target-arrow-color': colors.edge.line,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.8,
        'curve-style': 'bezier',
        'label': 'data(label)',
        'font-size': '9px',
        'font-family': 'Inter, system-ui, sans-serif',
        'color': isDark ? '#8892a6' : '#5a6678',
        'text-rotation': 'autorotate',
        'text-margin-y': -8,
        'text-background-color': bgColor,
        'text-background-opacity': 0.85,
        'text-background-padding': '2px',
        'opacity': 0.7,
      }
    },
    // Corporate edges
    {
      selector: 'edge[type="corporate"]',
      style: {
        'line-color': colors.edgeCorporate,
        'target-arrow-color': colors.edgeCorporate,
      }
    },
    // Political edges
    {
      selector: 'edge[type="political"]',
      style: {
        'line-color': colors.edgePolitical,
        'target-arrow-color': colors.edgePolitical,
      }
    },
    // Associate edges
    {
      selector: 'edge[type="associates"]',
      style: {
        'line-color': colors.edgeAssociates,
        'target-arrow-color': colors.edgeAssociates,
      }
    },
    // Hover states
    {
      selector: 'node:active',
      style: {
        'overlay-opacity': 0.08,
        'overlay-color': isDark ? '#fff' : '#000'
      }
    },
    {
      selector: 'edge:active',
      style: {
        'opacity': 1,
        'width': 3
      }
    },
  ];
}

// Selected node panel
function SelectedNodePanel({ node, onClose }: { node: any; onClose: () => void }) {
  const typeLabels: Record<string, string> = {
    central: 'Main Entity',
    corporate: 'Corporate Connection',
    political: 'Political Position',
    associates: 'Associate',
  };

  const typeColors: Record<string, string> = {
    central: 'bg-blue-500',
    corporate: 'bg-slate-500',
    political: 'bg-purple-500',
    associates: 'bg-green-600',
  };

  return (
    <div className="mb-3 p-4 bg-muted/50 dark:bg-muted/20 rounded-lg border border-border animate-in slide-in-from-top-2 duration-200">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-sm font-semibold">{node.label}</h4>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-xs px-2 py-0.5 rounded ${typeColors[node.type] || 'bg-gray-500'} text-white`}>
              {typeLabels[node.type] || node.type}
            </span>
            {node.is_sanctioned && (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-500 text-white">
                ⚠️ Sanctioned
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
        >
          <span className="text-lg">×</span>
        </button>
      </div>

      <div className="space-y-2 text-sm">
        {node.role && (
          <div>
            <span className="text-muted-foreground">Role:</span>{' '}
            <span className="font-medium">{node.role}</span>
          </div>
        )}
        {node.start && (
          <div>
            <span className="text-muted-foreground">Period:</span>{' '}
            <span className="font-medium">
              {node.start}{node.end ? ` - ${node.end}` : ' - present'}
            </span>
          </div>
        )}
        {node.share && (
          <div>
            <span className="text-muted-foreground">Share:</span>{' '}
            <span className="font-medium">{node.share}</span>
          </div>
        )}
        {node.relation && (
          <div>
            <span className="text-muted-foreground">Relation:</span>{' '}
            <span className="font-medium">{node.relation}</span>
          </div>
        )}
        {node.entity_id && (
          <div>
            <span className="text-muted-foreground">Wikidata:</span>{' '}
            <a
              href={`https://www.wikidata.org/wiki/${node.entity_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              {node.entity_id}
            </a>
          </div>
        )}
        {node.opensanctions_id && (
          <div>
            <span className="text-muted-foreground">OpenSanctions:</span>{' '}
            <a
              href={`https://www.opensanctions.org/entities/${node.opensanctions_id}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-500 hover:underline"
            >
              {node.opensanctions_id}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export function EntityRelationshipGraph({
  source,
  entityId,
  entityName,
}: EntityRelationshipGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<any>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isBrowser, setIsBrowser] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [selectedNode, setSelectedNode] = useState<any>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [refreshing, setRefreshing] = useState(false);
  const { theme, resolvedTheme } = useTheme();

  // Fetch relationship data
  const {
    data,
    isLoading,
    error,
    refresh,
    totalRelationships,
    hasRelationships,
    needsEnrichment,
  } = useEntityRelationships(source, entityId);

  // Wait for theme to be resolved
  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted ? resolvedTheme === 'dark' : false;

  // Ensure we're in browser environment
  useEffect(() => {
    setIsBrowser(true);
  }, []);

  // Handle refresh button
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
      // Force re-initialization of the graph
      setIsInitialized(false);
    } finally {
      setRefreshing(false);
    }
  };

  // Update styles when theme changes
  useEffect(() => {
    if (cyRef.current && isInitialized && mounted) {
      cyRef.current.style(getRelationshipStyles(isDark));
      if (containerRef.current) {
        containerRef.current.style.backgroundColor = isDark ? '#0f172a' : '#f8fafc';
      }
    }
  }, [isDark, isInitialized, mounted]);

  // Rebuild graph when filter changes
  useEffect(() => {
    if (cyRef.current && data && isInitialized) {
      const elements = buildGraphElements(data, entityName, filter, isDark);
      cyRef.current.elements().remove();
      cyRef.current.add(elements);

      // Re-run layout
      const layout = cyRef.current.layout({
        name: 'cose',
        animate: true,
        animationDuration: 500,
        fit: true,
        padding: 50,
        nodeRepulsion: 300000,
        idealEdgeLength: 120,
        gravity: 50,
      });
      layout.run();
    }
  }, [filter, data, entityName, isDark, isInitialized]);

  // Initialize Cytoscape
  useEffect(() => {
    if (!isBrowser || !containerRef.current || !data || !hasRelationships) return;
    if (isInitialized) return;

    let componentMounted = true;

    const initCytoscape = async () => {
      try {
        const cytoscape = (await import('cytoscape')).default;

        if (!componentMounted || !containerRef.current) return;

        const elements = buildGraphElements(data, entityName, filter, isDark);

        const cy = cytoscape({
          container: containerRef.current,
          elements,
          style: getRelationshipStyles(isDark),
          minZoom: 0.3,
          maxZoom: 2.5,
          wheelSensitivity: 0.2,
        });

        // Make canvas transparent
        if (containerRef.current) {
          const canvasElements = containerRef.current.querySelectorAll('canvas');
          canvasElements.forEach((canvas: HTMLCanvasElement) => {
            canvas.style.backgroundColor = 'transparent';
          });
        }

        // Node click handler
        cy.on('tap', 'node', (evt: any) => {
          const node = evt.target;
          const nodeData = node.data();
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

        // Hover effects
        cy.on('mouseover', 'node', (evt: any) => {
          evt.target.style('border-width', '4px');
        });
        cy.on('mouseout', 'node', (evt: any) => {
          evt.target.style('border-width', evt.target.data('type') === 'central' ? '3px' : '2px');
        });

        cyRef.current = cy;

        // Run concentric layout (central entity in middle)
        const layout = cy.layout({
          name: 'cose',
          animate: true,
          animationDuration: 1000,
          fit: true,
          padding: 50,
          nodeRepulsion: 300000,
          idealEdgeLength: 120,
          gravity: 50,
          numIter: 1000,
        });

        layout.on('layoutstop', () => {
          setTimeout(() => cy.fit(undefined, 50), 100);
        });

        layout.run();

        if (componentMounted) {
          setIsInitialized(true);
        }
      } catch (err) {
        console.error('Failed to initialize Cytoscape:', err);
      }
    };

    initCytoscape();

    return () => {
      componentMounted = false;
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [data, isBrowser, hasRelationships, entityName]);

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
    }
  };

  const handleExport = () => {
    if (!cyRef.current) return;
    const png = cyRef.current.png({ scale: 2, bg: isDark ? '#0f172a' : '#f8fafc' });
    const link = document.createElement('a');
    link.href = png;
    link.download = `relationships-${entityId}.png`;
    link.click();
  };

  // Loading state
  if (isLoading || !isBrowser) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Loading relationships...
        </span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-destructive">Failed to load relationships</p>
        <p className="text-xs text-muted-foreground mt-1">{error.message}</p>
      </div>
    );
  }

  // No relationships or needs enrichment
  if (!hasRelationships || needsEnrichment) {
    return (
      <div className="text-center py-12 space-y-4">
        <Network className="h-12 w-12 mx-auto text-muted-foreground/20" />
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            {needsEnrichment ? 'Relationships Not Yet Loaded' : 'No Relationships Found'}
          </p>
          <p className="text-xs text-muted-foreground max-w-md mx-auto mt-2">
            {needsEnrichment
              ? 'Click the button below to fetch relationship data from Wikidata and OpenSanctions.'
              : 'No corporate, political, or associate relationships were found for this entity.'
            }
          </p>
        </div>
        {needsEnrichment && (
          <Button
            onClick={handleRefresh}
            disabled={refreshing}
            className="mt-4"
          >
            {refreshing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Fetching Relationships...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Fetch Relationships
              </>
            )}
          </Button>
        )}
        {data && (
          <p className="text-xs text-muted-foreground">
            Sources: {data.sources?.join(', ') || 'None'}
          </p>
        )}
      </div>
    );
  }

  // Count by category
  const corporateCount = data?.corporate?.length || 0;
  const politicalCount = data?.political?.length || 0;
  const associatesCount = data?.associates?.length || 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Network className="h-4 w-4" />
            Relationship Graph
          </h3>
          {data?.cached && data?.fetched_at && (
            <Badge variant="outline" className="text-xs">
              Updated: {new Date(data.fetched_at).toLocaleDateString()}
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="text-xs">
            {totalRelationships} connections
          </Badge>
        </div>
      </div>

      {/* Filter buttons */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted-foreground">Filter:</span>
        <Button
          size="sm"
          variant={filter === 'all' ? 'default' : 'outline'}
          onClick={() => setFilter('all')}
        >
          All ({totalRelationships})
        </Button>
        <Button
          size="sm"
          variant={filter === 'corporate' ? 'default' : 'outline'}
          onClick={() => setFilter('corporate')}
          className="gap-1"
        >
          <span className="w-2 h-2 rounded-full bg-slate-500"></span>
          Corporate ({corporateCount})
        </Button>
        <Button
          size="sm"
          variant={filter === 'political' ? 'default' : 'outline'}
          onClick={() => setFilter('political')}
          className="gap-1"
        >
          <span className="w-2 h-2 rounded-full bg-purple-500"></span>
          Political ({politicalCount})
        </Button>
        <Button
          size="sm"
          variant={filter === 'associates' ? 'default' : 'outline'}
          onClick={() => setFilter('associates')}
          className="gap-1"
        >
          <span className="w-2 h-2 rounded-full bg-green-600"></span>
          Associates ({associatesCount})
        </Button>

        <div className="h-6 w-px bg-border ml-2" />

        {/* View controls */}
        <Button size="sm" variant="outline" onClick={handleZoomIn} title="Zoom In">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={handleZoomOut} title="Zoom Out">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="outline" onClick={handleReset} title="Reset View">
          Reset
        </Button>
        <Button size="sm" variant="outline" onClick={handleExport} title="Export PNG">
          <Download className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh from Wikidata"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Selected node panel */}
      {selectedNode && (
        <SelectedNodePanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      )}

      {/* Cytoscape container */}
      <div
        ref={containerRef}
        className="rounded-lg border border-gray-200 dark:border-gray-700"
        style={{
          width: '100%',
          height: '500px',
          minHeight: '500px',
          backgroundColor: isDark ? '#0f172a' : '#f8fafc',
          position: 'relative'
        }}
      />

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-blue-500"></span>
          <span>{entityName}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-slate-500"></span>
          <span>Corporate ({corporateCount})</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-purple-500"></span>
          <span>Political ({politicalCount})</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-green-600"></span>
          <span>Associates ({associatesCount})</span>
        </div>
        {data?.sources && data.sources.length > 0 && (
          <div className="ml-auto">
            Sources: {data.sources.join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}
