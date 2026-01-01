// services/frontend-nextjs/components/about/ArchitectureDiagram.tsx

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
} from 'reactflow';
import 'reactflow/dist/style.css';

import { ViewMode, SystemHealth, AboutStats } from '@/types/about';
import { nodeTypes } from './nodes';
import { getNodesAndEdges } from '@/lib/about/graphLoader';
import { enrichNodeWithLiveData } from '@/lib/about/dataMappers';
import { getLayoutedElements } from '@/lib/about/layoutUtils';
import ServiceDetailPanel from './ServiceDetailPanel';

interface ArchitectureDiagramProps {
  viewMode: ViewMode;
  systemHealth?: SystemHealth | null;
  aboutStats?: AboutStats | null;
}

// Internal component that has access to ReactFlow context
function ArchitectureDiagramInner({
  viewMode,
  systemHealth,
  aboutStats,
}: ArchitectureDiagramProps) {
  const { nodes: initialNodes, edges: initialEdges } = getNodesAndEdges(viewMode);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedService, setSelectedService] = useState<Node | null>(null);
  const { fitView, getViewport } = useReactFlow();
  const prevViewModeRef = useRef<ViewMode>(viewMode);

  // Get layout direction based on view mode
  // Pipeline: TB (top-to-bottom) - data flows down through tiers
  // Infrastructure: TB (top-to-bottom) - cleaner vertical layout
  const getLayoutDirection = useCallback((_mode: ViewMode): 'TB' | 'LR' => {
    return 'TB'; // Both use TB for vertical flow
  }, []);

  // Apply layout to nodes
  const applyLayout = useCallback((nodesToLayout: Node[], edgesToLayout: Edge[], mode: ViewMode) => {
    const direction = getLayoutDirection(mode);
    return getLayoutedElements(nodesToLayout, edgesToLayout, direction, mode);
  }, [getLayoutDirection]);

  // Update nodes and edges when view mode changes
  const updateView = useCallback((mode: ViewMode) => {
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

        // Always show required services (even if down), hide optional services if not running
        return isRequired || isRunning || node.id === 'telegram';
      });

      // Filter edges - only show edges between active nodes
      const activeNodeIds = new Set(filteredNodes.map(n => n.id));
      filteredEdges = newEdges.filter(edge =>
        activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target)
      );
    }

    // Apply layout (auto-selects direction based on view mode)
    const layoutedNodes = applyLayout(filteredNodes, filteredEdges, mode);

    // Enrich nodes with live data and apply visual styling for service status
    const enrichedNodes = systemHealth
      ? layoutedNodes.map(node => {
          const enrichedNode = enrichNodeWithLiveData(node, systemHealth, aboutStats ?? null);

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

    setNodes(enrichedNodes);
    setEdges(filteredEdges);
  }, [systemHealth, aboutStats, applyLayout, setNodes, setEdges]);

  // Update view when viewMode changes and trigger fitView
  useEffect(() => {
    const viewModeChanged = prevViewModeRef.current !== viewMode;

    updateView(viewMode);

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
  }, [viewMode, updateView, fitView]);

  // Update node data when live data changes (without changing positions)
  useEffect(() => {
    if (systemHealth) {
      setNodes(currentNodes =>
        currentNodes.map(node =>
          enrichNodeWithLiveData(node, systemHealth, aboutStats ?? null)
        )
      );
    }
  }, [systemHealth, aboutStats, setNodes]);

  const isLoadingData = !systemHealth;

  // Calculate dynamic height based on view mode
  const canvasHeight = viewMode === 'pipeline' ? 'h-[1400px]' : 'h-[900px]';

  return (
    <>
      <div className={`w-full ${canvasHeight} bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 relative`}>
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
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
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
            type: 'smoothstep',
          }}
        >
          <Background />
          <Controls showInteractive={false} />

          {/* Info Panel */}
          <Panel position="top-left" className="bg-white dark:bg-gray-800 rounded-lg shadow-lg px-3 py-2 border border-gray-200 dark:border-gray-700">
            <div className="text-xs text-gray-600 dark:text-gray-400">
              <div className="font-semibold mb-1">{viewMode === 'pipeline' ? 'Pipeline View' : 'Infrastructure View'}</div>
              <div>{nodes.length} services • {edges.length} connections</div>
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
export default function ArchitectureDiagram(props: ArchitectureDiagramProps) {
  return (
    <ReactFlowProvider>
      <ArchitectureDiagramInner {...props} />
    </ReactFlowProvider>
  );
}
