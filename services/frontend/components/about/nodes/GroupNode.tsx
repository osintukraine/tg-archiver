// services/frontend-nextjs/components/about/nodes/GroupNode.tsx

import { memo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';

interface GroupNodeData {
  label: string;
  description?: string;
  color?: string;
}

function GroupNode({ data }: NodeProps<GroupNodeData>) {
  return (
    <div
      className="relative rounded-lg border-2 border-dashed bg-white/50 dark:bg-gray-800/50 backdrop-blur-sm"
      style={{
        borderColor: data.color || '#d1d5db',
        minWidth: '300px',
        minHeight: '200px',
        padding: '48px 16px 16px 16px',
      }}
    >
      {/* Group Label */}
      <div
        className="absolute top-0 left-0 right-0 rounded-t-lg px-4 py-2 font-semibold text-sm"
        style={{
          backgroundColor: data.color || '#e5e7eb',
          color: '#1f2937',
        }}
      >
        {data.label}
      </div>

      {/* Description */}
      {data.description && (
        <div className="absolute top-10 left-4 right-4 text-xs text-gray-600 dark:text-gray-400">
          {data.description}
        </div>
      )}

      {/* Handles for connections */}
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

export default memo(GroupNode);
