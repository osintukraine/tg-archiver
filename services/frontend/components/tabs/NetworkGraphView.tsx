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
import { Loader2, Network } from 'lucide-react';
import { useNetworkGraph } from '@/hooks/useNetworkGraph';
import type { Message } from '@/lib/types';

interface NetworkGraphViewProps {
  message: Message;
}

export function NetworkGraphView({ message }: NetworkGraphViewProps) {
  const { data, isLoading, error } = useNetworkGraph(message.id, {
    includeSimilar: true,
    similarityThreshold: 0.8
  });

  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [], edges: [] };

    const nodes: Node[] = data.nodes.map((node) => ({
      id: node.id,
      type: getNodeType(node.type),
      position: node.position || { x: 0, y: 0 },
      data: {
        label: node.label,
        ...node.data
      },
      style: getNodeStyle(node.type)
    }));

    const edges: Edge[] = data.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      type: edge.type === 'similar' ? 'bezier' : 'smoothstep',
      animated: edge.type === 'similar',
      style: getEdgeStyle(edge.type)
    }));

    return { nodes, edges };
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Building entity network graph...
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

  if (!data || nodes.length === 0) {
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Network className="h-4 w-4" />
          Entity Relationship Network
        </h3>
        <div className="flex gap-2">
          <Badge variant="outline" className="text-xs">
            {nodes.length} nodes
          </Badge>
          <Badge variant="outline" className="text-xs">
            {edges.length} connections
          </Badge>
        </div>
      </div>

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

      {/* Legend */}
      <div className="space-y-3">
        <div className="text-xs font-medium text-gray-600 dark:text-gray-400">Regex-Based Entities (extracted from text)</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500 border-2 border-blue-200" />
            <span>Message (current)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-green-200" />
            <span>Location</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-purple-500 border-2 border-purple-200" />
            <span>Person</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-orange-500 border-2 border-orange-200" />
            <span>Organization</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500 border-2 border-red-200" />
            <span>Military Unit</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-slate-400 border-2 border-slate-200" />
            <span>Related Message</span>
          </div>
        </div>

        <div className="text-xs font-medium text-gray-600 dark:text-gray-400 pt-2">Curated Entities (from knowledge graph)</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-600 border-2 border-red-200" />
            <span>Military Vehicle</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-orange-600 border-2 border-orange-200" />
            <span>Military Weapon</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-sky-600 border-2 border-sky-200" />
            <span>Aircraft</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-violet-600 border-2 border-violet-200" />
            <span>Electronic Warfare</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-slate-500 border-2 border-slate-200" />
            <span>Component/Part</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-cyan-500 border-2 border-cyan-200" />
            <span>Naval Vessel</span>
          </div>
        </div>

        <div className="text-xs font-medium text-gray-600 dark:text-gray-400 pt-2">AI-Generated Tags (from LLM analysis)</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-violet-500 border-2 border-violet-200" />
            <span>Keywords</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-indigo-500 border-2 border-indigo-200" />
            <span>Topics</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-pink-500 border-2 border-pink-200" />
            <span>LLM Entities</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500 border-2 border-amber-200" />
            <span>Emotions</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500 border-2 border-red-200" />
            <span>Urgency</span>
          </div>
        </div>
      </div>

      <div className="text-xs text-gray-700 dark:text-gray-300 bg-slate-50 dark:bg-slate-800 p-3 rounded">
        <p className="font-medium mb-1">Network Graph Features:</p>
        <ul className="space-y-1 ml-4 list-disc">
          <li>Zoom and pan to explore the network</li>
          <li>Animated edges show semantic similarity (via pgvector)</li>
          <li>Node size represents keyword relevance (more matches = larger nodes)</li>
          <li>Click nodes to navigate to entities or messages</li>
        </ul>
      </div>
    </div>
  );
}

function getNodeType(type: string): string {
  // Map entity types to React Flow node types
  // For now, use default type (can be customized later)
  return 'default';
}

function getNodeStyle(type: string): React.CSSProperties {
  const colors: Record<string, string> = {
    // Core message types
    message: '#3b82f6',       // blue
    related_message: '#94a3b8', // slate

    // Regex-based entities (from message content)
    location: '#10b981',      // green
    person: '#a855f7',        // purple
    organization: '#f97316',  // orange
    military_unit: '#ef4444', // red

    // Curated entity types (from knowledge graph - November 2025 recategorization)
    curated_military_vehicle: '#dc2626',  // red-600 (tanks, APCs)
    curated_military_weapon: '#ea580c',   // orange-600 (missiles, artillery)
    curated_aircraft: '#0284c7',          // sky-600 (planes, helicopters)
    curated_electronic_warfare: '#7c3aed', // violet-600 (radar, jamming)
    curated_component: '#64748b',         // slate-500 (parts, components)
    curated_organization: '#f97316',      // orange-500 (same as org)
    curated_location: '#10b981',          // green-500 (same as location)
    curated_event: '#eab308',             // yellow-500 (events)
    curated_military_unit: '#ef4444',     // red-500 (same as military_unit)
    curated_ship: '#06b6d4',              // cyan-500 (naval vessels)

    // Legacy types (deprecated)
    curated_individual: '#9333ea',        // purple-600 (legacy)
    curated_equipment: '#64748b',         // slate-500 (legacy)

    // AI-generated tags (from message_tags table)
    ai_tag_keyword: '#8b5cf6',           // violet-500 (keywords)
    ai_tag_topic: '#6366f1',             // indigo-500 (topics)
    ai_tag_entity: '#ec4899',            // pink-500 (entities)
    ai_tag_emotion: '#f59e0b',           // amber-500 (emotions)
    ai_tag_urgency: '#ef4444',           // red-500 (urgency)
  };

  // AI tags get a different style (rounded pill)
  const isAiTag = type.startsWith('ai_tag_');

  return {
    background: colors[type] || '#6b7280',
    color: 'white',
    border: `2px solid ${colors[type]}${isAiTag ? '80' : '30'}`,
    borderRadius: isAiTag ? '16px' : '8px',
    padding: isAiTag ? '6px 12px' : '10px',
    fontSize: '11px',
    fontWeight: isAiTag ? 600 : 500,
    boxShadow: isAiTag ? '0 2px 4px rgba(0,0,0,0.1)' : 'none'
  };
}

function getEdgeStyle(type: string): React.CSSProperties {
  if (type === 'similar') {
    return {
      stroke: '#10b981',
      strokeWidth: 2,
      strokeDasharray: '5 5'
    };
  }

  return {
    stroke: '#94a3b8',
    strokeWidth: 1.5
  };
}
