/**
 * node-ref — 消息文本内节点 id 引用渲染（Plan#42 0.5）
 *
 * 问题：Agent 输出常带裸节点 id（如 node-1787637987262-auur58），用户看不懂且无法操作。
 * 方案：渲染前把裸 id 转成 Markdown 链接（canvas-node: 协议），mdComponents 的 a 覆写
 * 拦截后渲染成 @引用样式芯片——显示节点标题（画布实时查）、点击选中+聚焦定位（走既有
 * executeCanvasOp 队列，自带 AI 光标动效）。
 */

import type { CSSProperties } from 'react';
import { LocateFixed } from 'lucide-react';
import { executeCanvasOp, getCanvasOpBridge } from '../canvas-op-bridge.js';

/** 裸节点 id 模式：node-<时间戳>-<后缀>（编辑器默认 id 格式） */
const NODE_ID_RE = /\bnode-\d+-[a-zA-Z0-9]+\b/g;
/** 转 Markdown 链接时防括号注入 */
function safeForMd(s: string): string {
  return s.replace(/[[\]()]/g, '');
}

/** 查节点友好标题（画布桥接实时读取；查不到用尾部短码降级） */
function nodeDisplayLabel(id: string): string {
  const node = getCanvasOpBridge()?.getStore()?.getNode(id);
  const data = (node?.data ?? {}) as Record<string, unknown>;
  if (typeof data.title === 'string' && data.title.trim()) return data.title.trim();
  if (typeof node?.type === 'string') return `${node.type} 节点`;
  return `节点…${id.slice(-6)}`;
}

/**
 * 消息文本预处理：裸节点 id → Markdown 链接。
 * 幂等：已含 canvas-node: 协议链接的文本不再处理（防流式增量二次转换）。
 */
export function linkifyNodeIds(text: string): string {
  if (!text || text.includes('canvas-node:')) return text;
  if (!NODE_ID_RE.test(text)) return text;
  NODE_ID_RE.lastIndex = 0;
  return text.replace(NODE_ID_RE, (id) => `[@${safeForMd(nodeDisplayLabel(id))}](canvas-node:${id})`);
}

const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 8px',
  margin: '0 2px',
  borderRadius: 6,
  border: '1px solid var(--agent-border)',
  background: 'var(--agent-surface)',
  color: 'var(--agent-text)',
  fontSize: 12,
  lineHeight: '18px',
  cursor: 'pointer',
  userSelect: 'none',
  verticalAlign: 'baseline',
  transition: 'border-color 0.12s, background 0.12s',
};

/** @节点引用芯片：点击 = 选中 + 聚焦定位（AI 光标动效随 focus op 自动呈现） */
export function NodeRefChip(props: { nodeId: string; label: string }): React.ReactElement {
  const handleClick = () => {
    void executeCanvasOp({ op: 'set_selection', args: { nodeIds: [props.nodeId] } });
    void executeCanvasOp({ op: 'focus', args: { id: props.nodeId } });
  };
  return (
    <span
      onClick={handleClick}
      style={chipStyle}
      title={`定位到画布节点：${props.label}`}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--agent-accent)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--agent-border)'; }}
    >
      <LocateFixed size={11} style={{ flexShrink: 0, opacity: 0.75 }} />
      <span
        style={{
          maxWidth: 120,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {props.label}
      </span>
    </span>
  );
}

/** 判断 href 是否为节点引用协议 */
export function isNodeRefHref(href: string | undefined): href is string {
  return typeof href === 'string' && href.startsWith('canvas-node:');
}

/** 从协议 href 提取节点 id */
export function nodeIdFromHref(href: string): string {
  return href.slice('canvas-node:'.length);
}
