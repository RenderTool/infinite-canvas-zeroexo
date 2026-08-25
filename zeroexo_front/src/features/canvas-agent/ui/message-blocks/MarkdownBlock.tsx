/**
 * MarkdownBlock - MD 展示契约 UI（Plan#33 D1/D2）
 *
 * 复用 react-markdown 渲染 Agent 输出的结构化内容(分镜表/方案对比/清单等)。
 * 样式与既有暗色主题一致，支持标题/列表/表格/代码块/引用。
 */

import ReactMarkdown from 'react-markdown';
import type { CanvasAgentMessage } from '../types.js';
import { isNodeRefHref, nodeIdFromHref, NodeRefChip, linkifyNodeIds } from './node-ref.js';

const mdStyle: React.CSSProperties = {
  width: '100%',
  margin: '6px 0',
  padding: '10px 14px',
  background: 'var(--agent-surface)',
  border: '1px solid var(--agent-border)',
  borderRadius: 10,
  fontSize: 13,
  lineHeight: 1.7,
  color: 'var(--agent-text)',
  animation: 'agentFadeUp 0.35s ease',
  wordBreak: 'break-word',
};

/** Markdown 元素样式映射（R2 共享：MarkdownBlock 卡片与 TextBlock 正文复用，避免格式回退纯文本） */
export const mdComponents = {
  h1: (p: Record<string, unknown>) => <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--agent-text)', margin: '8px 0 6px' }} {...p} />,
  h2: (p: Record<string, unknown>) => <h2 style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--agent-text)', margin: '8px 0 6px' }} {...p} />,
  h3: (p: Record<string, unknown>) => <h3 style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--agent-text)', margin: '6px 0 4px' }} {...p} />,
  p: (p: Record<string, unknown>) => <p style={{ margin: '6px 0' }} {...p} />,
  ul: (p: Record<string, unknown>) => <ul style={{ margin: '6px 0', paddingLeft: 18 }} {...p} />,
  ol: (p: Record<string, unknown>) => <ol style={{ margin: '6px 0', paddingLeft: 18 }} {...p} />,
  li: (p: Record<string, unknown>) => <li style={{ margin: '2px 0' }} {...p} />,
  strong: (p: Record<string, unknown>) => <strong style={{ color: 'var(--agent-text)', fontWeight: 700 }} {...p} />,
  em: (p: Record<string, unknown>) => <em style={{ color: 'var(--agent-muted)' }} {...p} />,
  code: (p: Record<string, unknown>) => (
    <code
      style={{
        background: 'var(--agent-accent-soft)',
        color: 'var(--agent-accent)',
        padding: '1px 5px',
        borderRadius: 4,
        fontSize: 12,
        fontFamily: 'Consolas, monospace',
      }}
      {...p}
    />
  ),
  pre: (p: Record<string, unknown>) => (
    <pre
      style={{
        background: 'var(--agent-surface-2)',
        border: '1px solid var(--agent-border)',
        borderRadius: 8,
        padding: 10,
        overflowX: 'auto',
        fontSize: 12,
        lineHeight: 1.6,
      }}
      {...p}
    />
  ),
  table: (p: Record<string, unknown>) => (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        margin: '8px 0',
        fontSize: 12.5,
      }}
      {...p}
    />
  ),
  thead: (p: Record<string, unknown>) => <thead {...p} />,
  th: (p: Record<string, unknown>) => (
    <th
      style={{
        border: '1px solid var(--agent-border)',
        padding: '6px 10px',
        background: 'var(--agent-accent-soft)',
        color: 'var(--agent-text)',
        fontWeight: 600,
        textAlign: 'left',
      }}
      {...p}
    />
  ),
  td: (p: Record<string, unknown>) => (
    <td
      style={{ border: '1px solid var(--agent-border)', padding: '6px 10px', color: 'var(--agent-text)' }}
      {...p}
    />
  ),
  blockquote: (p: Record<string, unknown>) => (
    <blockquote
      style={{
        margin: '6px 0',
        padding: '4px 12px',
        borderLeft: '3px solid var(--agent-accent)',
        background: 'var(--agent-accent-soft)',
        color: 'var(--agent-muted)',
      }}
      {...p}
    />
  ),
  a: (p: Record<string, unknown>) => {
    // Plan#42 0.5：canvas-node: 协议链接 → @节点引用芯片（点击选中+聚焦定位）
    const href = typeof p.href === 'string' ? p.href : undefined;
    if (isNodeRefHref(href)) {
      const children = Array.isArray(p.children) ? p.children : [p.children];
      const raw = children.filter((c) => typeof c === 'string').join('');
      const label = raw.replace(/^@/, '') || nodeIdFromHref(href).slice(-6);
      return <NodeRefChip nodeId={nodeIdFromHref(href)} label={label} />;
    }
    return <a style={{ color: 'var(--agent-accent)' }} {...p} />;
  },
  hr: (p: Record<string, unknown>) => <hr style={{ border: 'none', borderTop: '1px solid var(--agent-border)', margin: '8px 0' }} {...p} />,
};

export function MarkdownBlock(props: { message: CanvasAgentMessage }): React.ReactElement {
  const { message } = props;
  const content = linkifyNodeIds(message.text ?? '');
  if (!content) return <></>;

  return (
    <div style={mdStyle}>
      <ReactMarkdown components={mdComponents as never}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
