/**
 * ArticleListRenderer - 文章条目渲染器（内置 'article-list' 类型）
 *
 * 数据驱动：message.articles（AgentArticleItem[]）按垂直可点击条目排版。
 * 每条目：图标 + 标题 + 描述 + 徽章 + 动作文案 + 右箭头。
 * 点击条目触发 callbacks.onArticleClick(article)，由业务层解释 action/meta。
 * 适合剧本大纲、搜索结果、资料列表等"按可点击条垂直排版"的场景。
 */

import { type CSSProperties } from 'react';
import { ChevronRight } from 'lucide-react';
import type { MessageRendererProps } from '../types.js';

export function ArticleListRenderer({ message, theme, callbacks }: MessageRendererProps): React.ReactElement {
  const articles = message.articles ?? [];

  return (
    <div>
      {/* 引导语气泡 */}
      {message.guideText && (
        <div style={{
          ...guideBubbleStyle(theme),
          marginBottom: 10,
        }}>
          {message.guideText}
        </div>
      )}

      {/* 文章条目垂直列表 */}
      <div style={listStyle}>
        {articles.map((article, idx) => (
          <div
            key={article.id ?? idx}
            onClick={() => callbacks.onArticleClick?.(article)}
            style={rowStyle(theme)}
          >
            {/* 图标 */}
            {article.icon && (
              <div style={iconBoxStyle(theme)}>
                <span style={{ fontSize: 18 }}>{article.icon}</span>
              </div>
            )}

            {/* 内容 */}
            <div style={contentStyle}>
              <div style={titleRowStyle}>
                <span style={titleStyle(theme)}>{article.title}</span>
                {article.badges?.map((b) => (
                  <span key={b} style={badgeStyle(theme)}>{b}</span>
                ))}
              </div>
              {article.desc && <div style={descStyle(theme)}>{article.desc}</div>}
            </div>

            {/* 动作文案 + 箭头 */}
            <div style={actionStyle(theme)}>
              {article.action && <span>{article.action}</span>}
              <ChevronRight size={15} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ===== 样式 =====

const guideBubbleStyle = (theme: MessageRendererProps['theme']): CSSProperties => ({
  padding: '9px 13px',
  fontSize: 13,
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: theme.cardBg,
  border: `1px solid ${theme.cardBorder}`,
  color: theme.labelColor,
  borderRadius: '4px 12px 12px 12px',
});

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '4px 0 8px',
};

const rowStyle = (theme: MessageRendererProps['theme']): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 10,
  background: theme.cardBg,
  border: `1px solid ${theme.cardBorder}`,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
});

const iconBoxStyle = (theme: MessageRendererProps['theme']): CSSProperties => ({
  width: 38,
  height: 38,
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  background: theme.isDark ? `${theme.accent}18` : `${theme.accent}0d`,
  border: `1px solid ${theme.isDark ? `${theme.accent}40` : `${theme.accent}2e`}`,
});

const contentStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const titleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const titleStyle = (theme: MessageRendererProps['theme']): CSSProperties => ({
  fontSize: 13,
  fontWeight: 600,
  color: theme.labelColor,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const badgeStyle = (theme: MessageRendererProps['theme']): CSSProperties => ({
  fontSize: 10,
  fontWeight: 600,
  padding: '1px 6px',
  borderRadius: 4,
  color: theme.accent,
  background: theme.isDark ? `${theme.accent}1a` : `${theme.accent}0f`,
  border: `1px solid ${theme.accent}30`,
  lineHeight: '16px',
});

const descStyle = (theme: MessageRendererProps['theme']): CSSProperties => ({
  fontSize: 11,
  color: theme.mutedColor,
  lineHeight: 1.5,
  marginTop: 2,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

const actionStyle = (theme: MessageRendererProps['theme']): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  fontSize: 11,
  color: theme.mutedColor,
  flexShrink: 0,
});
