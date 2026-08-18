/**
 * NodeViewContractContext - 节点视图契约上下文
 *
 * NodeItem(node-layer)从 NodeTypeExtension.viewContract 提供该 context,
 * NodeShell 消费以决定状态视觉(选中/连线悬停/hover)与标题栏铬件的渲染归属:
 * - 未提供或 'default' → NodeShell 统一渲染(存量节点零改动)
 * - 'custom' → NodeShell 跳过,由节点视图自绘
 */
import React from 'react';
import type { NodeViewContract } from '@zeroexo/core';

export const NodeViewContractContext = React.createContext<NodeViewContract | undefined>(undefined);
