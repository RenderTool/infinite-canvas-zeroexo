/**
 * config-preview 配置专用节点(Plan#13)
 *
 * 用途:配置面板(ConfigDialog)的"配置专用节点"——用真实节点渲染链展示
 * CanvasConfig 调参效果,替代手动构造的预览 DIV,所见即所得。
 *
 * 契约隔离(hidden=true):
 * - 画布任何入口不可见:创建菜单 / 层级面板 / AI 生成 / 连线 / 序列化 / 快捷键
 * - 零实例约束:不得通过任何命令创建其实例,仅 ConfigPreviewHost 静态挂载
 * - 视图只消费 NodeDefaults / PinDefaults Context,与画布真实节点同源管线
 *   (圆角 / 轮廓 / 填充 / 引脚样式全部由宿主注入的 Provider 驱动)
 */

import React from 'react';
import type { NodeRecord, Pin, NodeTypeExtension } from '@zeroexo/core';
import { NodeShell } from '@zeroexo/plugin-render-react';

/** 配置专用节点类型标识(注册表契约;零实例约束,不出现在任何用户入口) */
export const CONFIG_PREVIEW_TYPE = 'config-preview';

/** 静态预览节点 id(仅用于 NodeShell 渲染占位,不进入任何 graph) */
const CONFIG_PREVIEW_NODE_ID = '__config_preview__';

export interface ConfigPreviewNodeViewProps {
  /** 节点标题(不传则不渲染标题栏) */
  title?: string;
  /** 是否渲染输入/输出引脚(默认 true) */
  showPins?: boolean;
  /** 内容区内边距(默认 '0 20px',与 NodeShell 一致) */
  contentPadding?: React.CSSProperties['padding'];
  /** 内容区占位(默认居中文本;由宿主 ConfigPreviewHost 传入真实文案) */
  children?: React.ReactNode;
}

/**
 * 配置专用节点视图。
 * 静态渲染(pointer-events 全关由宿主容器控制),仅消费 Context,
 * 不持有任何 store / 命令 / 回调依赖,可安全嵌入配置面板。
 */
export function ConfigPreviewNodeView({
  title,
  showPins = true,
  contentPadding = '0 20px',
  children,
}: ConfigPreviewNodeViewProps): React.ReactElement {
  // 静态节点对象:size 仅作 NodeShell 布局占位,实际视觉尺寸由宿主容器决定
  const node: NodeRecord = {
    id: CONFIG_PREVIEW_NODE_ID,
    type: CONFIG_PREVIEW_TYPE,
    position: { x: 0, y: 0 },
    size: { width: 280, height: 96 },
    data: {},
  };
  const pins: Pin[] = showPins
    ? [
        { id: 'in', name: 'in', direction: 'input', dataType: 'any' },
        { id: 'out', name: 'out', direction: 'output', dataType: 'any' },
      ]
    : [];
  return (
    <NodeShell
      node={node}
      pins={pins}
      title={title}
      invK={1}
      forceShowPins={showPins}
      contentPadding={contentPadding}
    >
      {children ?? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            fontSize: 12,
            opacity: 0.55,
          }}
        >
          配置预览
        </div>
      )}
    </NodeShell>
  );
}

/**
 * 配置专用节点扩展工厂。
 * hidden=true:内部专用类型,仅供配置面板静态挂载,不出现在任何用户入口。
 * 注册进注册表仅为契约完整(类型/默认尺寸/引脚声明),零实例约束。
 */
export function createConfigPreviewExtension(): NodeTypeExtension {
  return {
    type: CONFIG_PREVIEW_TYPE,
    displayName: '配置预览',
    category: 'internal',
    color: '#6b7280',
    hidden: true,
    defaultSize: { width: 280, height: 96 },
    resizable: false,
    getPins: () => [
      { id: 'in', name: 'in', direction: 'input', dataType: 'any' },
      { id: 'out', name: 'out', direction: 'output', dataType: 'any' },
    ],
    createDefaultData: () => ({}),
    renderNode: () => <ConfigPreviewNodeView />,
  };
}
