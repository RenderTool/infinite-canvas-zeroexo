/**
 * Markdown 工具函数
 *
 * 提供简易的 markdown 渲染和转纯文本功能。
 * 不依赖第三方库，仅处理常用语法。
 */

/**
 * 将 markdown 文本渲染为 HTML（简易版）
 * 支持: 标题、粗体、斜体、行内代码、代码块、链接、无序列表、有序列表、水平线、段落
 */
export function renderMarkdownToHtml(md: string): string {
  let html = md
    // 转义 HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 代码块(```) - 必须在其他处理之前
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, _lang, code) => {
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<pre style="background:rgba(0,0,0,0.06);border-radius:6px;padding:12px;overflow-x:auto;font-size:12px;line-height:1.5;margin:8px 0"><code>${escaped}</code></pre>`;
  });

  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,0.06);border-radius:3px;padding:1px 4px;font-size:12px">$1</code>');

  // 水平线
  html = html.replace(/^---$/gm, '<hr style="margin:12px 0;border:none;border-top:1px solid rgba(0,0,0,0.1)">');

  // 标题 (h1-h6)
  html = html.replace(/^######\s+(.+)$/gm, '<h6 style="font-size:12px;font-weight:600;margin:8px 0 4px">$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5 style="font-size:13px;font-weight:600;margin:8px 0 4px">$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4 style="font-size:14px;font-weight:600;margin:10px 0 4px">$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3 style="font-size:15px;font-weight:600;margin:10px 0 4px">$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2 style="font-size:16px;font-weight:600;margin:12px 0 6px">$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1 style="font-size:18px;font-weight:700;margin:12px 0 6px">$1</h1>');

  // 粗体和斜体
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--accent, #e94560);text-decoration:underline">$1</a>');

  // 无序列表
  html = html.replace(/^[\s]*[-*+]\s+(.+)$/gm, '<li style="margin:2px 0">$1</li>');
  // 有序列表
  html = html.replace(/^[\s]*\d+\.\s+(.+)$/gm, '<li style="margin:2px 0">$1</li>');

  // 将连续的 li 包裹在 ul/ol 中
  html = html.replace(/((?:<li[^>]*>.*?<\/li>\s*)+)/g, '<ul style="padding-left:20px;margin:6px 0">$1</ul>');

  // 段落(双换行分隔)
  html = html.replace(/\n\n/g, '</p><p style="margin:6px 0">');

  // 换行
  html = html.replace(/\n/g, '<br>');

  return `<p style="margin:6px 0">${html}</p>`;
}

/**
 * 将 markdown 文本转换为纯文本（去除格式）
 * 用于发送到画布时还原为 txt
 */
export function stripMarkdown(md: string): string {
  return md
    // 移除代码块
    .replace(/```[\s\S]*?```/g, '')
    // 移除行内代码
    .replace(/`([^`]+)`/g, '$1')
    // 移除标题标记
    .replace(/^#{1,6}\s+/gm, '')
    // 移除粗体和斜体
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    // 移除链接保留文本
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 移除列表标记
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // 移除水平线
    .replace(/^---$/gm, '')
    // 合并多余空白
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}