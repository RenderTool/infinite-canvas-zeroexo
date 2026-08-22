/**
 * MarkdownBlock - MD 展示契约 UI（Plan#33 D1/D2）
 *
 * 复用 react-markdown 渲染 Agent 输出的结构化内容(分镜表/方案对比/清单等)。
 * 样式与既有暗色主题一致，支持标题/列表/表格/代码块/引用。
 */

import ReactMarkdown from 'react-markdown';
import type { CanvasAgentMessage } from '../types.js';

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

export function MarkdownBlock(props: { message: CanvasAgentMessage }): React.ReactElement {
  const { message } = props;
  const content = message.text ?? '';
  if (!content) return <></>;

  return (
    <div style={mdStyle}>
      <ReactMarkdown
        components={{
          h1: (p) => <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--agent-text)', margin: '8px 0 6px' }} {...p} />,
          h2: (p) => <h2 style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--agent-text)', margin: '8px 0 6px' }} {...p} />,
          h3: (p) => <h3 style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--agent-text)', margin: '6px 0 4px' }} {...p} />,
          p: (p) => <p style={{ margin: '6px 0' }} {...p} />,
          ul: (p) => <ul style={{ margin: '6px 0', paddingLeft: 18 }} {...p} />,
          ol: (p) => <ol style={{ margin: '6px 0', paddingLeft: 18 }} {...p} />,
          li: (p) => <li style={{ margin: '2px 0' }} {...p} />,
          strong: (p) => <strong style={{ color: 'var(--agent-text)', fontWeight: 700 }} {...p} />,
          em: (p) => <em style={{ color: 'var(--agent-muted)' }} {...p} />,
          code: (p) => (
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
          pre: (p) => (
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
          table: (p) => (
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
          thead: (p) => <thead {...p} />,
          th: (p) => (
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
          td: (p) => (
            <td
              style={{ border: '1px solid var(--agent-border)', padding: '6px 10px', color: 'var(--agent-text)' }}
              {...p}
            />
          ),
          blockquote: (p) => (
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
          a: (p) => <a style={{ color: 'var(--agent-accent)' }} {...p} />,
          hr: (p) => <hr style={{ border: 'none', borderTop: '1px solid var(--agent-border)', margin: '8px 0' }} {...p} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
