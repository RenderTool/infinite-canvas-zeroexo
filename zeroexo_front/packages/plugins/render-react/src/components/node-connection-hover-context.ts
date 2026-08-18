/**
 * NodeConnectionHoverContext - 连线拖拽悬停上下文
 *
 * NodeItem(node-layer)在连线拖拽悬停到目标节点时置 true,
 * NodeShell 消费此 context 渲染蓝色 outline(与选中红色 outline 互斥,
 * 消除蓝/红叠加态)。用 context 透传避免侵入 NodeRendererProps 类型链。
 */
import React from 'react';

export const NodeConnectionHoverContext = React.createContext<boolean>(false);
