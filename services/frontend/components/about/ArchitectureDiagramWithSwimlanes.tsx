// services/frontend-nextjs/components/about/ArchitectureDiagramWithSwimlanes.tsx
//
// Enhanced version with optional swimlane grouping

'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  Panel,
  MiniMap,
  MarkerType,
  getNodesBounds,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { toPng } from 'html-to-image';

import { ViewMode, SystemHealth, AboutStats, PipelineMetrics } from '@/types/about';
import { nodeTypes } from './nodes';
import { edgeTypes } from './edges';
import { getNodesAndEdges } from '@/lib/about/graphLoader';
import { enrichNodeWithLiveData } from '@/lib/about/dataMappers';
import { getLayoutedElements } from '@/lib/about/layoutUtils';
import { createGroupNodes } from '@/lib/about/swimlanes';
import ServiceDetailPanel from './ServiceDetailPanel';

interface ArchitectureDiagramProps {
  viewMode: ViewMode;
  systemHealth?: SystemHealth | null;
  aboutStats?: AboutStats | null;
  pipelineMetrics?: PipelineMetrics | null;
  showSwimlanes?: boolean; // Toggle swimlanes on/off
}

// Internal component that has access to ReactFlow context
function ArchitectureDiagramInner({
  viewMode,
  systemHealth,
  aboutStats,
  pipelineMetrics,
  showSwimlanes = false,
}: ArchitectureDiagramProps) {
  const { nodes: initialNodes, edges: initialEdges } = getNodesAndEdges(viewMode);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedService, setSelectedService] = useState<Node | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const { fitView, getNodes } = useReactFlow();
  const prevViewModeRef = useRef<ViewMode>(viewMode);
  const [swimlanesEnabled, setSwimlanesEnabled] = useState(showSwimlanes);

  // High-resolution PNG export function
  const exportToPng = useCallback(async () => {
    setIsExporting(true);

    try {
      // Get all nodes to calculate bounds
      const allNodes = getNodes();
      if (allNodes.length === 0) {
        alert('No nodes to export');
        setIsExporting(false);
        return;
      }

      // Calculate the bounds of all nodes
      const nodesBounds = getNodesBounds(allNodes);
      const padding = 80;

      // Calculate image dimensions based on actual graph size
      const width = nodesBounds.width + padding * 2;
      const height = nodesBounds.height + padding * 2;

      // Get elements
      const reactFlowEl = document.querySelector('.react-flow') as HTMLElement;
      const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement;

      if (!reactFlowEl || !viewportEl) {
        alert('Could not find ReactFlow elements');
        setIsExporting(false);
        return;
      }

      // Save original transform
      const originalTransform = viewportEl.style.transform;
      const originalWidth = reactFlowEl.style.width;
      const originalHeight = reactFlowEl.style.height;

      // Temporarily set viewport transform to show all nodes
      viewportEl.style.transform = `translate(${-nodesBounds.x + padding}px, ${-nodesBounds.y + padding}px) scale(1)`;
      reactFlowEl.style.width = `${width}px`;
      reactFlowEl.style.height = `${height}px`;

      // Detect dark mode
      const isDarkMode = document.documentElement.classList.contains('dark');
      const backgroundColor = isDarkMode ? '#1f2937' : '#ffffff';

      // Small delay to allow DOM to update
      await new Promise(resolve => setTimeout(resolve, 100));

      // Generate high-resolution PNG
      const dataUrl = await toPng(reactFlowEl, {
        backgroundColor: backgroundColor,
        width: width,
        height: height,
        pixelRatio: 2,
        cacheBust: true,
        // Filter out UI controls but keep everything else
        filter: (node) => {
          if (!node.classList) return true;
          const excludeClasses = [
            'react-flow__minimap',
            'react-flow__controls',
            'react-flow__panel',
            'react-flow__attribution'
          ];
          return !excludeClasses.some(cls => node.classList.contains(cls));
        },
      });

      // Restore original transform and dimensions
      viewportEl.style.transform = originalTransform;
      reactFlowEl.style.width = originalWidth;
      reactFlowEl.style.height = originalHeight;

      // Create download link
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().slice(0, 10);
      link.download = `osint-${viewMode}-architecture-${timestamp}.png`;
      link.href = dataUrl;
      link.click();

    } catch (error) {
      console.error('Error exporting PNG:', error);
      alert('Failed to export PNG. See console for details.');
    } finally {
      setIsExporting(false);
    }
  }, [getNodes, viewMode]);

  // Get layout direction based on view mode
  // Both use TB (top-to-bottom) for horizontal tier bands
  const getLayoutDirection = useCallback((_mode: ViewMode): 'TB' | 'LR' => {
    return 'TB'; // Both views use TB for consistent horizontal bands
  }, []);

  // Apply layout to nodes
  const applyLayout = useCallback((nodesToLayout: Node[], edgesToLayout: Edge[], mode: ViewMode) => {
    const direction = getLayoutDirection(mode);
    return getLayoutedElements(nodesToLayout, edgesToLayout, direction, mode);
  }, [getLayoutDirection]);

  // Update nodes and edges when view mode changes
  const updateView = useCallback((mode: ViewMode, withSwimlanes: boolean) => {
    const { nodes: newNodes, edges: newEdges } = getNodesAndEdges(mode);

    // Filter nodes based on running services if systemHealth is available
    let filteredNodes = newNodes;
    let filteredEdges = newEdges;

    if (systemHealth) {
      const runningServiceNames = new Set(systemHealth.services.map(s => s.name));

      // Filter nodes - show if service is running OR if it's a required core service
      filteredNodes = newNodes.filter(node => {
        const serviceName = node.data.service_name || node.id;
        const isRunning = runningServiceNames.has(serviceName);
        const isRequired = node.data.required === true;
        const isExternal = node.data.type === 'external';

        // Always show: required services (even if down), running services, external sources
        return isRequired || isRunning || isExternal;
      });

      // Filter edges - only show edges between active nodes
      const activeNodeIds = new Set(filteredNodes.map(n => n.id));
      filteredEdges = newEdges.filter(edge =>
        activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target)
      );
    }

    // Apply layout (auto-selects direction based on view mode)
    let layoutedNodes = applyLayout(filteredNodes, filteredEdges, mode);

    // Enrich nodes with live data and apply visual styling for service status
    const enrichedNodes = systemHealth
      ? layoutedNodes.map(node => {
          const enrichedNode = enrichNodeWithLiveData(node, systemHealth, aboutStats ?? null, pipelineMetrics);

          // Add onExpand handler for expandable nodes
          if (enrichedNode.data.expandable) {
            enrichedNode.data.onExpand = () => setSelectedService(enrichedNode);
          }

          // Apply visual styling based on service status
          const serviceName = node.data.service_name || node.id;
          const service = systemHealth.services.find(s => s.name === serviceName);

          if (service) {
            // Service found - apply status-based styling
            if (service.status === 'down') {
              enrichedNode.data = {
                ...enrichedNode.data,
                color: '#6b7280', // Gray for down services
                opacity: 0.5,
              };
            } else if (service.status === 'degraded') {
              enrichedNode.data = {
                ...enrichedNode.data,
                color: '#f59e0b', // Orange for degraded services
              };
            }
          } else if (node.data.required) {
            // Required service but not found in health check - assume down
            enrichedNode.data = {
              ...enrichedNode.data,
              color: '#6b7280',
              opacity: 0.5,
            };
          }

          return enrichedNode;
        })
      : layoutedNodes.map(node => {
          // Add onExpand handler even without live data
          if (node.data.expandable) {
            node.data.onExpand = () => setSelectedService(node);
          }
          return node;
        });

    // Add swimlanes if enabled
    let finalNodes = enrichedNodes;
    if (withSwimlanes) {
      const { nodes: serviceNodes, groupNodes } = createGroupNodes(enrichedNodes, mode);
      finalNodes = [...groupNodes, ...serviceNodes];
    }

    setNodes(finalNodes);
    setEdges(filteredEdges);
  }, [systemHealth, aboutStats, pipelineMetrics, applyLayout, setNodes, setEdges]);

  // Update view when viewMode or swimlanes change and trigger fitView
  useEffect(() => {
    const viewModeChanged = prevViewModeRef.current !== viewMode;

    updateView(viewMode, swimlanesEnabled);

    // Use requestAnimationFrame to ensure layout has been applied before fitting view
    if (viewModeChanged) {
      requestAnimationFrame(() => {
        // Wait for next frame to ensure nodes are rendered
        requestAnimationFrame(() => {
          fitView({
            padding: 0.15,
            maxZoom: 0.8,
            duration: 400, // Smooth animation
          });
        });
      });

      prevViewModeRef.current = viewMode;
    }
  }, [viewMode, swimlanesEnabled, updateView, fitView]);

  // Update node data when live data changes (without changing positions)
  useEffect(() => {
    if (systemHealth) {
      setNodes(currentNodes =>
        currentNodes.map(node => {
          // Skip group nodes
          if (node.type === 'group') return node;
          return enrichNodeWithLiveData(node, systemHealth, aboutStats ?? null, pipelineMetrics);
        })
      );
    }
  }, [systemHealth, aboutStats, pipelineMetrics, setNodes]);

  const isLoadingData = !systemHealth;

  // Calculate dynamic height based on view mode
  const canvasHeight = viewMode === 'pipeline' ? 'h-[1400px]' : 'h-[900px]';

  // Enhance edges with animation metadata
  const enhancedEdges = edges.map(edge => {
    const labelText = typeof edge.label === 'string' ? edge.label : '';
    const isRedis = labelText.includes('Redis') || labelText.includes('Consumer');
    const isLLM = labelText.includes('LLM');
    const isAPI = labelText.includes('API');

    const edgeColor = isRedis ? '#ef4444' :
                      isLLM ? '#f97316' :
                      isAPI ? '#6366f1' :
                      edge.animated ? '#3b82f6' : '#94a3b8';

    return {
      ...edge,
      type: edge.animated ? 'animated' : 'default',
      data: {
        speed: isRedis ? 'fast' : 'medium',
        gradient: edge.animated,
      },
      style: {
        ...edge.style,
        stroke: edgeColor,
        strokeWidth: edge.animated ? 2.5 : 2,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: edgeColor,
        width: 20,
        height: 20,
      },
    };
  });

  return (
    <>
      <div className={`w-full ${canvasHeight} bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 relative shadow-lg`}>
        {isLoadingData && (
          <div className="absolute top-4 right-4 z-10 bg-white dark:bg-gray-800 rounded-lg shadow-lg px-3 py-2 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span className="text-sm text-gray-600 dark:text-gray-400">Loading live data...</span>
            </div>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={enhancedEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 0.8 }}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={true}
          zoomOnScroll={true}
          panOnScroll={false}
          panOnDrag={true}
          minZoom={0.05}
          maxZoom={1.5}
          defaultEdgeOptions={{
            animated: viewMode === 'pipeline',
            type: 'animated',
          }}
        >
          <Background
            gap={16}
            size={1}
            color="#94a3b8"
            className="opacity-30 dark:opacity-20"
          />
          <Controls
            showInteractive={false}
            className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg"
          />
          <MiniMap
            nodeStrokeWidth={3}
            zoomable
            pannable
            className="bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 rounded-lg shadow-lg"
            maskColor="rgba(0, 0, 0, 0.05)"
          />

          {/* Info Panel */}
          <Panel position="top-left" className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-xl px-4 py-3 border-2 border-gray-200 dark:border-gray-700">
            <div className="text-xs text-gray-600 dark:text-gray-400">
              <div className="font-bold mb-1.5 text-gray-900 dark:text-gray-100">
                {viewMode === 'pipeline' ? 'Pipeline View' : 'Infrastructure View'}
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  {nodes.filter(n => n.type !== 'group').length} services
                </span>
                <span className="text-gray-400">•</span>
                <span className="inline-flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                  {edges.length} connections
                </span>
              </div>
            </div>
          </Panel>

          {/* Controls Panel */}
          <Panel position="top-right" className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-xl px-4 py-3 border-2 border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSwimlanesEnabled(!swimlanesEnabled)}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all duration-200 ${
                  swimlanesEnabled
                    ? 'bg-blue-500 text-white shadow-md hover:bg-blue-600'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {swimlanesEnabled ? 'Hide Groups' : 'Show Groups'}
              </button>
              <button
                onClick={() => {
                  // Export current layout to JSON for debugging
                  const exportData = {
                    viewMode,
                    swimlanesEnabled,
                    timestamp: new Date().toISOString(),
                    summary: {
                      totalNodes: nodes.filter(n => n.type !== 'group').length,
                      totalGroups: nodes.filter(n => n.type === 'group').length,
                      totalEdges: edges.length,
                    },
                    // Calculate bounding box
                    boundingBox: (() => {
                      const serviceNodes = nodes.filter(n => n.type !== 'group');
                      if (serviceNodes.length === 0) return null;
                      const xs = serviceNodes.map(n => n.position.x);
                      const ys = serviceNodes.map(n => n.position.y);
                      return {
                        minX: Math.min(...xs),
                        maxX: Math.max(...xs) + 200,
                        minY: Math.min(...ys),
                        maxY: Math.max(...ys) + 80,
                        width: Math.max(...xs) - Math.min(...xs) + 200,
                        height: Math.max(...ys) - Math.min(...ys) + 80,
                      };
                    })(),
                    // Group nodes with their positions and sizes
                    groups: nodes
                      .filter(n => n.type === 'group')
                      .map(g => ({
                        id: g.id,
                        label: g.data.label,
                        position: g.position,
                        size: { width: g.style?.width, height: g.style?.height },
                        color: g.data.color,
                        description: g.data.description,
                      }))
                      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y),
                    // Service nodes with positions
                    nodes: nodes
                      .filter(n => n.type !== 'group')
                      .map(n => ({
                        id: n.id,
                        label: n.data.label,
                        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
                        color: n.data.color,
                        required: n.data.required,
                      }))
                      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x),
                    // Edges
                    edges: edges.map(e => ({
                      source: e.source,
                      target: e.target,
                    })),
                  };

                  // Copy to clipboard
                  navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
                  alert('Layout exported to clipboard!');
                }}
                className="text-xs px-3 py-1.5 rounded-lg font-medium bg-green-500 text-white hover:bg-green-600 shadow-md transition-all duration-200"
              >
                Export JSON
              </button>
              <button
                onClick={exportToPng}
                disabled={isExporting}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium shadow-md transition-all duration-200 ${
                  isExporting
                    ? 'bg-gray-400 text-white cursor-wait'
                    : 'bg-purple-500 text-white hover:bg-purple-600'
                }`}
              >
                {isExporting ? 'Exporting...' : 'Export PNG'}
              </button>
            </div>
          </Panel>
        </ReactFlow>
      </div>

      {/* Service Detail Panel */}
      {selectedService && (
        <ServiceDetailPanel
          serviceName={selectedService.data.label}
          description={selectedService.data.description || 'No description available'}
          details={selectedService.data.details || {}}
          onClose={() => setSelectedService(null)}
        />
      )}
    </>
  );
}

// Wrapper component that provides ReactFlow context
export default function ArchitectureDiagramWithSwimlanes(props: ArchitectureDiagramProps) {
  return (
    <ReactFlowProvider>
      <ArchitectureDiagramInner {...props} />
    </ReactFlowProvider>
  );
}
