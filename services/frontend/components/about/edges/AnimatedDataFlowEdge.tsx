// services/frontend-nextjs/components/about/edges/AnimatedDataFlowEdge.tsx
//
// Custom animated edge with gradient and particle effects for data flow visualization

'use client';

import { memo } from 'react';
import { EdgeProps, getBezierPath, EdgeLabelRenderer } from 'reactflow';

interface AnimatedDataFlowEdgeProps extends EdgeProps {
  data?: {
    speed?: 'fast' | 'medium' | 'slow';
    gradient?: boolean;
  };
}

function AnimatedDataFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  label,
  data,
}: AnimatedDataFlowEdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Animation speed configuration
  const animationDuration = data?.speed === 'fast' ? '1s' : data?.speed === 'slow' ? '3s' : '2s';

  // Edge color (from style or default)
  const edgeColor = (style.stroke as string) || '#64748b';

  // Gradient colors based on edge color
  const gradientId = `gradient-${id}`;
  const glowId = `glow-${id}`;

  return (
    <>
      <defs>
        {/* Gradient for data flow direction */}
        {data?.gradient !== false && (
          <linearGradient id={gradientId} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={edgeColor} stopOpacity="0.3" />
            <stop offset="50%" stopColor={edgeColor} stopOpacity="0.8" />
            <stop offset="100%" stopColor={edgeColor} stopOpacity="1" />
          </linearGradient>
        )}

        {/* Glow filter for visual emphasis */}
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Background glow path (wider, softer) */}
      <path
        id={`${id}-glow`}
        d={edgePath}
        fill="none"
        stroke={edgeColor}
        strokeWidth={6}
        strokeOpacity={0.2}
        filter={`url(#${glowId})`}
        className="react-flow__edge-path"
      />

      {/* Main edge path */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={data?.gradient !== false ? `url(#${gradientId})` : edgeColor}
        strokeWidth={2.5}
        strokeOpacity={0.8}
        className="react-flow__edge-path"
        markerEnd={markerEnd}
        style={{
          ...style,
          filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1))',
        }}
      />

      {/* Animated particle effect */}
      <circle r="4" fill={edgeColor} opacity="0.8">
        <animateMotion dur={animationDuration} repeatCount="indefinite" path={edgePath} />
        <animate
          attributeName="opacity"
          values="0;1;1;0"
          dur={animationDuration}
          repeatCount="indefinite"
        />
      </circle>

      {/* Second particle for richer effect (offset timing) */}
      <circle r="3" fill={edgeColor} opacity="0.6">
        <animateMotion dur={animationDuration} repeatCount="indefinite" path={edgePath} begin="0.5s" />
        <animate
          attributeName="opacity"
          values="0;0.8;0.8;0"
          dur={animationDuration}
          repeatCount="indefinite"
          begin="0.5s"
        />
      </circle>

      {/* Edge label */}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <div className="px-2 py-1 bg-white dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-300 rounded shadow-md border border-gray-200 dark:border-gray-700">
              {label}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(AnimatedDataFlowEdge);
