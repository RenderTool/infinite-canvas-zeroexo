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
  background: '#0d1220',
  border: '1px solid #1e293b',
  borderRadius: 10,
  fontSize: 13,
  lineHeight: 1.7,
  color: '#cbd5e1',
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
          h1: (p) => <h1 style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', margin: '8px 0 6px' }} {...p} />,
          h2: (p) => <h2 style={{ fontSize: 14.5, fontWeight: 700, color: '#e2e8f0', margin: '8px 0 6px' }} {...p} />,
          h3: (p) => <h3 style={{ fontSize: 13.5, fontWeight: 600, color: '#e2e8f0', margin: '6px 0 4px' }} {...p} />,
          p: (p) => <p style={{ margin: '6px 0' }} {...p} />,
          ul: (p) => <ul style={{ margin: '6px 0', paddingLeft: 18 }} {...p} />,
          ol: (p) => <ol style={{ margin: '6px 0', paddingLeft: 18 }} {...p} />,
          li: (p) => <li style={{ margin: '2px 0' }} {...p} />,
          strong: (p) => <strong style={{ color: '#e2e8f0', fontWeight: 700 }} {...p} />,
          em: (p) => <em style={{ color: '#94a3b8' }} {...p} />,
          code: (p) => (
            <code
              style={{
                background: 'rgba(99,102,241,0.08)',
                color: '#a5b4fc',
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
                background: '#0b0f1a',
                border: '1px solid #1e293b',
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
                border: '1px solid #1e293b',
                padding: '6px 10px',
                background: 'rgba(99,102,241,0.06)',
                color: '#e2e8f0',
                fontWeight: 600,
                textAlign: 'left',
              }}
              {...p}
            />
          ),
          td: (p) => (
            <td
              style={{ border: '1px solid #1e293b', padding: '6px 10px', color: '#cbd5e1' }}
              {...p}
            />
          ),
          blockquote: (p) => (
            <blockquote
              style={{
                margin: '6px 0',
                padding: '4px 12px',
                borderLeft: '3px solid #6366f1',
                background: 'rgba(99,102,241,0.05)',
                color: '#94a3b8',
              }}
              {...p}
            />
          ),
          a: (p) => <a style={{ color: '#818cf8' }} {...p} />,
          hr: (p) => <hr style={{ border: 'none', borderTop: '1px solid #1e293b', margin: '8px 0' }} {...p} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
