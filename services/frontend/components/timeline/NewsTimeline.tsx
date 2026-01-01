'use client';

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  NodeMouseHandler,
  useReactFlow,
  ReactFlowProvider,
  PanOnScrollMode,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { RSSNode } from './RSSNode';
import { TelegramNode } from './TelegramNode';
import { TimeRangeSlider } from './TimeRangeSlider';
import { TimelineDetailPanel } from './TimelineDetailPanel';
import {
  transformToReactFlow,
  TimelineRSSArticle,
  TimelineCorrelation,
  TimelineData,
} from '@/lib/timeline-utils';
import { Loader2, Newspaper, HelpCircle, Mouse, ZoomIn } from 'lucide-react';
import { API_URL } from '@/lib/api';

// Register custom node types
const nodeTypes = {
  rss: RSSNode,
  telegram: TelegramNode,
};

interface NewsTimelineProps {
  className?: string;
}

// API fetch function
async function fetchTimelineData(hours: number): Promise<TimelineData> {
  const response = await fetch(
    `${API_URL}/api/timeline?hours=${hours}&include_correlations=true`
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch timeline data: ${response.status}`);
  }

  return response.json();
}

// Inner component that has access to ReactFlow hooks
function NewsTimelineInner({ className = '' }: NewsTimelineProps) {
  // State - default to 72h to include articles with correlations (pipeline lag)
  const [timeRange, setTimeRange] = useState(72); // hours
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawData, setRawData] = useState<TimelineData | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const dataVersion = useRef(0);

  // ReactFlow hooks
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Fetch data when time range changes
  useEffect(() => {
    let cancelled = false;
    const currentVersion = ++dataVersion.current;

    async function loadData() {
      setLoading(true);
      setError(null);

      try {
        const data = await fetchTimelineData(timeRange);
        if (cancelled || currentVersion !== dataVersion.current) return;

        setRawData(data);

        // Transform to ReactFlow format
        const { nodes: newNodes, edges: newEdges, firstWithCorrelations } =
          transformToReactFlow(data);

        setNodes(newNodes);
        setEdges(newEdges);

        // Auto-select first item with correlations
        if (firstWithCorrelations) {
          setSelectedNodeId(firstWithCorrelations);
        } else if (newNodes.length > 0) {
          setSelectedNodeId(newNodes[0].id);
        } else {
          setSelectedNodeId(null);
        }

        // Set initial view to top of timeline at readable zoom
        // Don't fitView (too zoomed out) - instead position at top
        setTimeout(() => {
          if (!cancelled && currentVersion === dataVersion.current) {
            // If few nodes, fit them. Otherwise start at top zoomed in
            if (newNodes.length <= 5) {
              fitView({ padding: 0.2, duration: 300 });
            } else {
              // Start at top-left with readable zoom level
              fitView({
                padding: 0.1,
                duration: 300,
                maxZoom: 0.85,  // Don't zoom in too much
                minZoom: 0.85,  // Keep at readable level
                nodes: newNodes.slice(0, 3)  // Fit just the first few nodes
              });
            }
          }
        }, 100);
      } catch (err) {
        if (cancelled || currentVersion !== dataVersion.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load timeline');
      } finally {
        if (!cancelled && currentVersion === dataVersion.current) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [timeRange, setNodes, setEdges, fitView]);

  // Update node selection state
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          selected: node.id === selectedNodeId,
        },
      }))
    );
  }, [selectedNodeId, setNodes]);

  // Handle node click
  const onNodeClick: NodeMouseHandler = useCallback((event, node) => {
    setSelectedNodeId(node.id);
  }, []);

  // Get selected node data for detail panel
  const selectedNodeData = useMemo(() => {
    if (!selectedNodeId || !rawData) return null;

    // Check if it's an RSS node
    if (selectedNodeId.startsWith('rss-')) {
      const articleId = parseInt(selectedNodeId.replace('rss-', ''), 10);
      const article = rawData.articles.find((a) => a.id === articleId);
      if (article) {
        return { type: 'rss' as const, data: article };
      }
    }

    // Check if it's a Telegram node
    if (selectedNodeId.startsWith('tg-')) {
      const messageId = parseInt(selectedNodeId.replace('tg-', ''), 10);
      // Find the message and its parent article
      for (const article of rawData.articles) {
        const correlation = article.correlations?.find(
          (c) => c.message_id === messageId
        );
        if (correlation) {
          return {
            type: 'telegram' as const,
            data: correlation.message,
            article: article,
            similarityScore: correlation.similarity_score,
          };
        }
      }
    }

    return null;
  }, [selectedNodeId, rawData]);

  // Handle time range change
  const handleTimeRangeChange = useCallback((hours: number) => {
    setTimeRange(hours);
    setSelectedNodeId(null);
  }, []);

  // Handle detail panel close
  const handleCloseDetail = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Article count for display
  const articleCount = rawData?.articles?.length ?? 0;
  const correlationCount = rawData?.articles?.reduce(
    (sum, a) => sum + (a.correlations?.length ?? 0),
    0
  ) ?? 0;

  // Loading state (only show full loader on initial load)
  if (loading && nodes.length === 0) {
    return (
      <div className={`h-full flex items-center justify-center bg-gray-900 ${className}`}>
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500 mx-auto mb-3" />
          <p className="text-gray-400">Loading timeline...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`h-full flex items-center justify-center bg-gray-900 ${className}`}>
        <div className="text-center text-red-400">
          <p className="font-medium">Error loading timeline</p>
          <p className="text-sm mt-1">{error}</p>
          <button
            onClick={() => setTimeRange(timeRange)}
            className="mt-3 px-4 py-2 bg-red-900 text-red-300 rounded hover:bg-red-800 text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (nodes.length === 0) {
    return (
      <div className={`h-full flex flex-col bg-gray-900 ${className}`}>
        {/* Header with time filter */}
        <div className="px-6 py-4 border-b border-gray-700 bg-gray-800">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-white">
              News Timeline
            </h1>
            <TimeRangeSlider value={timeRange} onChange={handleTimeRangeChange} />
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-gray-500">
            <Newspaper className="w-16 h-16 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">No articles found</p>
            <p className="text-sm mt-1">Try expanding the time range</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col bg-gray-900 ${className}`}>
      {/* Header with time filter */}
      <div className="px-6 py-4 border-b border-gray-700 bg-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-white">
              News Timeline
            </h1>
            <span className="text-sm text-gray-400">
              {articleCount} articles • {correlationCount} correlations
            </span>
            {loading && (
              <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
            )}
          </div>
          <TimeRangeSlider value={timeRange} onChange={handleTimeRangeChange} />
        </div>
      </div>

      {/* Main content: Timeline + Detail Panel */}
      <div className="flex-1 flex min-h-0">
        {/* ReactFlow Canvas */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.1 }}
            minZoom={0.1}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
            panOnScroll={true}
            panOnScrollMode={PanOnScrollMode.Vertical}
            zoomOnScroll={false}
            zoomOnPinch={true}
            zoomOnDoubleClick={true}
            preventScrolling={false}
            zoomActivationKeyCode="Control"
          >
            <Background color="#374151" gap={20} />
            <Controls showInteractive={false} className="!bg-gray-800 !border-gray-700" />
            <MiniMap
              nodeColor={(node) =>
                node.type === 'rss' ? '#3b82f6' : '#8b5cf6'
              }
              maskColor="rgba(0, 0, 0, 0.3)"
              className="!bg-gray-800 !border-gray-700"
            />
          </ReactFlow>

          {/* Time indicator overlay */}
          <div className="absolute top-4 left-4 bg-gray-800 px-3 py-1.5 rounded-lg shadow-md text-xs text-gray-300 border border-gray-700">
            <span className="font-medium text-green-400">NOW</span> ↓ scroll down for older
          </div>

          {/* Controls help overlay */}
          <div className="absolute top-4 right-4 bg-gray-800/95 backdrop-blur-sm px-3 py-2 rounded-lg shadow-md text-xs text-gray-400 border border-gray-700">
            <div className="flex items-center gap-2 mb-1.5 text-gray-300 font-medium">
              <HelpCircle className="w-3.5 h-3.5" />
              Controls
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Mouse className="w-3 h-3" />
                <span>Scroll to pan</span>
              </div>
              <div className="flex items-center gap-2">
                <ZoomIn className="w-3 h-3" />
                <span>Ctrl + scroll to zoom</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 text-center">⎇</span>
                <span>Double-click to zoom in</span>
              </div>
            </div>
          </div>
        </div>

        {/* Detail Panel */}
        <div className="w-[400px] border-l border-gray-700 bg-gray-800 overflow-hidden">
          <TimelineDetailPanel
            selectedNode={selectedNodeData}
            onClose={handleCloseDetail}
          />
        </div>
      </div>
    </div>
  );
}

// Wrapper component that provides ReactFlow context
export function NewsTimeline({ className = '' }: NewsTimelineProps) {
  return (
    <ReactFlowProvider>
      <NewsTimelineInner className={className} />
    </ReactFlowProvider>
  );
}
