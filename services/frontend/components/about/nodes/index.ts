// services/frontend-nextjs/components/about/nodes/index.ts

import BaseNode from './BaseNode';
import GroupNode from './GroupNode';

export const nodeTypes = {
  custom: BaseNode,
  group: GroupNode,
};

export { BaseNode, GroupNode };
