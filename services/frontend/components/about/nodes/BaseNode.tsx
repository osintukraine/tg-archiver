// services/frontend-nextjs/components/about/nodes/BaseNode.tsx

'use client';

import { useState } from 'react';
import { Handle, Position } from 'reactflow';
import { LucideIcon, ChevronRight } from 'lucide-react';
import { NodeData } from '@/types/about';
import { statusColors, badgeColors } from '@/lib/theme';

// Map status to background colors (theme exports text colors by default)
const statusBgColors: Record<string, string> = {
  healthy: statusColors.healthyBg,
  degraded: statusColors.degradedBg,
  down: statusColors.downBg,
  unknown: statusColors.unknownBg,
};

interface BaseNodeProps {
  data: NodeData;
}

export default function BaseNode({ data }: BaseNodeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const Icon = data.icon;

  // Determine border style (dashed for optional services)
  const borderStyle = data.required === false
    ? 'border-dashed'
    : 'border-solid';

  // Add cursor pointer if expandable
  const cursorStyle = data.expandable ? 'cursor-pointer' : '';

  // Determine opacity based on status
  const opacity = data.status === 'down' ? 0.5 : 1;

  // Apply z-index to ReactFlow parent node on hover
  const handleMouseEnter = (e: React.MouseEvent) => {
    setIsHovered(true);
    // Find the ReactFlow node wrapper (parent of our component)
    const reactFlowNode = (e.currentTarget as HTMLElement).closest('.react-flow__node');
    if (reactFlowNode) {
      (reactFlowNode as HTMLElement).style.zIndex = '9999';
    }
  };

  const handleMouseLeave = (e: React.MouseEvent) => {
    setIsHovered(false);
    // Reset z-index on ReactFlow node wrapper
    const reactFlowNode = (e.currentTarget as HTMLElement).closest('.react-flow__node');
    if (reactFlowNode) {
      (reactFlowNode as HTMLElement).style.zIndex = '';
    }
  };

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'relative',
      }}
    >
      <div
        className={`px-4 py-3 rounded-xl border-2 bg-white dark:bg-gray-800 min-w-[180px] ${borderStyle} ${cursorStyle} transition-all duration-300 ease-out`}
        style={{
          position: 'relative',
          borderColor: data.color,
          opacity,
          transform: isHovered && data.description ? 'scale(1.08) translateY(-2px)' : 'scale(1)',
          boxShadow: isHovered && data.description
            ? `0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.08), 0 0 0 3px ${data.color}40, 0 0 20px ${data.color}20`
            : `0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06), 0 0 0 1px ${data.color}20`,
        }}
        onClick={data.expandable && data.onExpand ? data.onExpand : undefined}
        role={data.expandable ? 'button' : undefined}
        tabIndex={data.expandable ? 0 : undefined}
        aria-label={data.expandable ? `Expand details for ${data.label}` : undefined}
      >
        <Handle type="target" position={Position.Left} />

        <div className="flex items-center gap-2 mb-2">
          <Icon className="w-5 h-5" style={{ color: data.color }} />
          <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">{data.label}</span>
          {data.status && (
            <div
              className={`w-2 h-2 rounded-full ${statusBgColors[data.status]}`}
              title={data.status}
              aria-label={`Status: ${data.status}`}
            />
          )}
          {data.expandable && (
            <ChevronRight className="w-4 h-4 text-gray-400 ml-auto" aria-hidden="true" />
          )}
        </div>

        {data.badges && data.badges.length > 0 && (
          <div className="flex flex-col gap-1">
            {data.badges.map((badge, idx) => (
              <span
                key={idx}
                className={`text-xs px-2 py-0.5 rounded border ${badgeColors[badge.color]}`}
              >
                {badge.label}
              </span>
            ))}
          </div>
        )}

        {/* Show description on hover */}
        {isHovered && data.description && (
          <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              {data.description}
            </p>
          </div>
        )}

        {data.audience && (
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400" title={data.audienceDescription}>
            {data.audience}
          </div>
        )}

        <Handle type="source" position={Position.Right} />
      </div>
    </div>
  );
}
