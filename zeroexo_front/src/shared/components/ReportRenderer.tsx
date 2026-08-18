/**
 * ReportRenderer - 综合报告文章化渲染器
 *
 * 接收 AI 生成的长文报告内容，渲染为类似网络文章的美观排版。
 * - 支持 Markdown 标题（#, ##, ###）
 * - 支持列表（-, *, 1.）
 * - 支持粗体（**text**）
 * - 支持引用（>）
 * - 自动分段、段间距、引用块高亮
 */
import { type CSSProperties } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';

export interface ReportRendererProps {
  content: string;
  /** 标题（显示在顶部） */
  title?: string;
  /** 副标题/摘要 */
  subtitle?: string;
}

interface ParsedBlock {
  type: 'heading-1' | 'heading-2' | 'heading-3' | 'paragraph' | 'list' | 'quote' | 'divider' | 'table';
  content: string;
  items?: string[];
  /** 表格数据：headers 表头行，rows 数据行 */
  tableData?: { headers: string[]; rows: string[][] };
}

function parseMarkdown(content: string): ParsedBlock[] {
  const lines = content.split('\n');
  const blocks: ParsedBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // 分隔线
    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: 'divider', content: '' });
      i++;
      continue;
    }

    // 表格：以 | 开头，第二行为分隔行（|---|）
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\|[-:| ]+\|$/.test(lines[i + 1]!.trim())) {
      const headers = line.split('|').map((c) => c.trim()).filter(Boolean);
      const rows: string[][] = [];
      i += 2; // 跳过表头行和分隔行
      while (i < lines.length) {
        const rowLine = lines[i] ?? '';
        if (!rowLine.trim().startsWith('|')) break;
        const cells = rowLine.split('|').map((c) => c.trim()).filter(Boolean);
        if (cells.length > 0) rows.push(cells);
        i++;
      }
      blocks.push({
        type: 'table',
        content: '',
        tableData: { headers, rows },
      });
      continue;
    }

    // 标题
    if (line.startsWith('### ')) {
      blocks.push({ type: 'heading-3', content: line.slice(4).trim() });
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({ type: 'heading-2', content: line.slice(3).trim() });
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      blocks.push({ type: 'heading-1', content: line.slice(2).trim() });
      i++;
      continue;
    }

    // 引用
    if (line.startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const qLine = lines[i] ?? '';
        if (!qLine.startsWith('> ')) break;
        quoteLines.push(qLine.slice(2));
        i++;
      }
      blocks.push({ type: 'quote', content: quoteLines.join('\n') });
      continue;
    }

    // 列表
    if (/^[-*] /.test(line.trim()) || /^\d+\. /.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length) {
        const lLine = lines[i] ?? '';
        if (!/^[-*] /.test(lLine.trim()) && !/^\d+\. /.test(lLine.trim())) break;
        items.push(lLine.trim().replace(/^[-*] /, '').replace(/^\d+\. /, ''));
        i++;
      }
      blocks.push({ type: 'list', content: '', items });
      continue;
    }

    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 段落（累积到下一个空行/标题/列表/引用）
    const paraLines: string[] = [line];
    i++;
    while (i < lines.length) {
      const nextLine = lines[i] ?? '';
      if (nextLine.trim() === '') break;
      if (nextLine.startsWith('#') || nextLine.startsWith('>')) break;
      if (/^[-*] /.test(nextLine.trim()) || /^\d+\. /.test(nextLine.trim())) break;
      paraLines.push(nextLine);
      i++;
    }
    blocks.push({ type: 'paragraph', content: paraLines.join('\n') });
  }

  return blocks;
}

function renderInline(text: string, accent: string): React.ReactNode {
  // 简单处理 **bold**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx} style={{ color: accent, fontWeight: 600 }}>{part.slice(2, -2)}</strong>;
    }
    return <span key={idx}>{part}</span>;
  });
}

export function ReportRenderer({ content, title, subtitle }: ReportRendererProps): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const textMuted = theme.toolbar.textMuted;
  const border = theme.toolbar.border;

  const blocks = parseMarkdown(content);

  const h1Style: CSSProperties = {
    fontFamily: "'Sora', system-ui, sans-serif",
    fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em',
    color: 'inherit', margin: '24px 0 12px',
  };
  const h2Style: CSSProperties = {
    fontFamily: "'Sora', system-ui, sans-serif",
    fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em',
    color: 'inherit', margin: '20px 0 10px',
    paddingLeft: 10, borderLeft: `3px solid ${accent}`,
  };
  const h3Style: CSSProperties = {
    fontFamily: "'Sora', system-ui, sans-serif",
    fontSize: 14, fontWeight: 600, color: accent,
    margin: '16px 0 8px', textTransform: 'uppercase', letterSpacing: '0.04em',
  };
  const pStyle: CSSProperties = {
    fontSize: 13, lineHeight: 1.85, color: 'inherit',
    margin: '0 0 12px', wordBreak: 'break-word',
  };
  const listItemStyle: CSSProperties = {
    fontSize: 13, lineHeight: 1.85, color: 'inherit',
    margin: '0 0 6px', paddingLeft: 20, position: 'relative',
  };
  const quoteStyle: CSSProperties = {
    margin: '12px 0', padding: '12px 16px',
    borderLeft: `3px solid ${accent}`,
    background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
    borderRadius: '0 8px 8px 0',
    fontSize: 13, lineHeight: 1.7, color: textMuted, fontStyle: 'italic',
  };
  const dividerStyle: CSSProperties = {
    height: 1, background: border, margin: '20px 0', border: 'none',
  };
  const tableStyle: CSSProperties = {
    width: '100%', borderCollapse: 'collapse', margin: '12px 0',
    fontSize: 12, lineHeight: 1.7,
    background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
    borderRadius: 8, overflow: 'hidden',
  };
  const thStyle: CSSProperties = {
    padding: '10px 14px', textAlign: 'left', fontWeight: 600,
    borderBottom: `2px solid ${accent}40`,
    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
    color: 'inherit',
  };
  const tdStyle: CSSProperties = {
    padding: '9px 14px', textAlign: 'left',
    borderBottom: `1px solid ${border}`,
    color: 'inherit',
  };

  return (
    <article style={{
      fontFamily: "'DM Sans', system-ui, sans-serif",
      maxWidth: 760, margin: '0 auto', padding: '4px 0',
    }}>
      {title && (
        <h1 style={{ ...h1Style, marginTop: 0, fontSize: 24 }}>{title}</h1>
      )}
      {subtitle && (
        <p style={{ ...pStyle, color: textMuted, fontSize: 12, fontStyle: 'italic', marginBottom: 20 }}>
          {subtitle}
        </p>
      )}
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'heading-1':
            return <h1 key={idx} style={h1Style}>{block.content}</h1>;
          case 'heading-2':
            return <h2 key={idx} style={h2Style}>{block.content}</h2>;
          case 'heading-3':
            return <h3 key={idx} style={h3Style}>{block.content}</h3>;
          case 'paragraph':
            return <p key={idx} style={pStyle}>{renderInline(block.content, accent)}</p>;
          case 'list':
            return (
              <ul key={idx} style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
                {block.items?.map((item, i) => (
                  <li key={i} style={listItemStyle}>
                    <span style={{
                      position: 'absolute', left: 4, top: 9,
                      width: 4, height: 4, borderRadius: '50%',
                      background: accent,
                    }} />
                    {renderInline(item, accent)}
                  </li>
                ))}
              </ul>
            );
          case 'quote':
            return <blockquote key={idx} style={quoteStyle}>{renderInline(block.content, accent)}</blockquote>;
          case 'divider':
            return <hr key={idx} style={dividerStyle} />;
          case 'table':
            return block.tableData ? (
              <table key={idx} style={tableStyle}>
                <thead>
                  <tr>
                    {block.tableData.headers.map((h, hi) => (
                      <th key={hi} style={thStyle}>{renderInline(h, accent)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.tableData.rows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci} style={tdStyle}>{renderInline(cell, accent)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null;
          default:
            return null;
        }
      })}
    </article>
  );
}
