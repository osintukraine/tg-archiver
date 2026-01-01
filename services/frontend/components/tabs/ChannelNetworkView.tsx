'use client';

import React, { useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Badge } from '@/components/ui/badge';
import { Loader2, Network, TrendingUp } from 'lucide-react';
import { useChannelNetwork } from '@/hooks/useChannelNetwork';

interface ChannelNetworkViewProps {
  channelId: number;
  channelName?: string;
}

export function ChannelNetworkView({ channelId, channelName }: ChannelNetworkViewProps) {
  const [timeWindow, setTimeWindow] = React.useState('30d');
  const [similarityThreshold, setSimilarityThreshold] = React.useState(0.7);

  const { data, isLoading, error } = useChannelNetwork(channelId, {
    timeWindow,
    similarityThreshold,
    maxMessages: 100,
    includeClusters: true
  });

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [], edges: [] };

    const nodes: Node[] = data.nodes.map((node) => ({
      id: node.id,
      type: 'default',
      position: node.position || { x: 0, y: 0 },
      data: {
        label: node.label,
        ...node.data
      },
      style: getNodeStyle(node.type, node.data)
    }));

    const edges: Edge[] = data.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: edge.type === 'similar' ? 'bezier' : 'smoothstep',
      animated: edge.type === 'similar' && (edge.weight || 0) > 0.9,
      style: getEdgeStyle(edge.type, edge.weight)
    }));

    return { nodes, edges };
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Building channel network graph...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-destructive">Failed to load channel network</p>
        <p className="text-xs text-muted-foreground mt-1">{(error as Error).message}</p>
      </div>
    );
  }

  if (!data || nodes.length === 0) {
    return (
      <div className="text-center py-12">
        <Network className="h-12 w-12 mx-auto text-muted-foreground/20 mb-3" />
        <p className="text-sm text-muted-foreground">No network data available</p>
        <p className="text-xs text-muted-foreground mt-1">
          This channel may not have enough messages or semantic embeddings yet
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Network className="h-4 w-4" />
          {channelName || 'Channel'} Content Network
        </h3>
        <div className="flex gap-2">
          <select
            value={timeWindow}
            onChange={(e) => setTimeWindow(e.target.value)}
            className="text-xs border rounded px-2 py-1"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
          <Badge variant="outline" className="text-xs">
            {nodes.length} nodes
          </Badge>
          <Badge variant="outline" className="text-xs">
            {edges.length} connections
          </Badge>
        </div>
      </div>

      {/* Graph */}
      <div className="border rounded-lg overflow-hidden h-[600px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          attributionPosition="bottom-left"
          minZoom={0.1}
          maxZoom={2}
        >
          <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
          <Controls />
          <MiniMap
            nodeStrokeWidth={3}
            zoomable
            pannable
            className="bg-slate-50"
          />
        </ReactFlow>
      </div>

      {/* Statistics */}
      {data.metadata && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="border rounded p-3">
            <div className="text-xs text-muted-foreground mb-1">Total Messages</div>
            <div className="text-2xl font-bold">{data.metadata.total_messages}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-xs text-muted-foreground mb-1">Network Nodes</div>
            <div className="text-2xl font-bold">{data.metadata.total_nodes}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-xs text-muted-foreground mb-1">Connections</div>
            <div className="text-2xl font-bold">{data.metadata.total_edges}</div>
          </div>
          <div className="border rounded p-3">
            <div className="text-xs text-muted-foreground mb-1">Time Span</div>
            <div className="text-2xl font-bold">{data.metadata.time_span_days}d</div>
          </div>
        </div>
      )}

      {/* Topic Clusters */}
      {data.clusters && data.clusters.length > 0 && (
        <div className="border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4" />
            <h4 className="text-sm font-medium">Topic Clusters</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.clusters.map((cluster) => (
              <div key={cluster.id} className="border rounded p-3">
                <div className="font-medium text-sm mb-1">{cluster.label}</div>
                <div className="text-xs text-muted-foreground mb-2">
                  {cluster.message_count} messages
                </div>
                <div className="flex flex-wrap gap-1">
                  {cluster.top_keywords.slice(0, 5).map((keyword, idx) => (
                    <Badge key={idx} variant="secondary" className="text-xs">
                      {keyword}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="text-xs text-muted-foreground bg-slate-50 p-3 rounded">
        <p className="font-medium mb-1">Channel Network Graph:</p>
        <ul className="space-y-1 ml-4 list-disc">
          <li>Each node represents a message in this channel</li>
          <li>Connections show semantic similarity (via pgvector embeddings)</li>
          <li>Node clusters reveal sub-topics and narrative threads</li>
          <li>Node size indicates keyword relevance (larger = more keyword matches)</li>
          <li>Node color shows importance level (red=high, amber=medium, gray=low) or topic</li>
        </ul>
      </div>
    </div>
  );
}

function getNodeStyle(type: string, data: any): React.CSSProperties {
  const baseSize = 40;
  const keywordCount = data.keyword_match_count || 0;
  const size = baseSize + (keywordCount * 3); // 40px base, +3px per keyword (0-10 keywords = 40-70px)

  // Color by importance level or topic
  const getNodeColor = (): string => {
    // Priority 1: Color by importance level
    if (data.importance_level === 'high') return '#ef4444';  // red
    if (data.importance_level === 'medium') return '#f59e0b'; // amber
    if (data.importance_level === 'low') return '#6b7280';   // gray

    // Priority 2: Color by topic (if no importance level)
    const topicColors: Record<string, string> = {
      combat: '#ef4444',      // red
      equipment: '#f97316',   // orange
      civilian: '#3b82f6',    // blue
      diplomatic: '#8b5cf6',  // purple
      general: '#6b7280',     // gray
    };
    if (data.osint_topic && topicColors[data.osint_topic]) {
      return topicColors[data.osint_topic];
    }

    // Priority 3: Default colors by node type
    const typeColors: Record<string, string> = {
      message: '#3b82f6',        // blue
      topic_cluster: '#10b981',  // green
      time_period: '#f59e0b',    // amber
    };
    return typeColors[type] || '#6b7280';
  };

  const color = getNodeColor();

  return {
    width: size,
    height: size,
    background: color,
    color: 'white',
    border: `2px solid ${color}40`,
    borderRadius: '50%',
    padding: '8px',
    fontSize: '10px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
  };
}

function getEdgeStyle(type: string, weight?: number): React.CSSProperties {
  if (type === 'similar') {
    const thickness = (weight || 0.7) * 3; // 0.7-3px
    return {
      stroke: weight && weight > 0.85 ? '#ef4444' : '#10b981',
      strokeWidth: thickness,
      strokeDasharray: weight && weight > 0.9 ? undefined : '5 5',
    };
  }

  if (type === 'temporal') {
    return {
      stroke: '#94a3b8',
      strokeWidth: 1,
      strokeDasharray: '2 2',
    };
  }

  return {
    stroke: '#cbd5e1',
    strokeWidth: 1,
  };
}
