/**
 * prompt-card - 提示词卡片组件
 *
 * 包装 shared/components 中的 PromptCard，注册到卡片注册表。
 * 使用与公共提示词同款的卡片风格（16:9缩略图 + 标题叠加层 + 标签行）。
 */

import { PromptCard as SharedPromptCard } from '@/shared/components/prompt-card.js';
import type { Prompt } from '../prompts-api.js';
import { registerCard, type GridCardRendererProps, type ListCardRendererProps } from './card-registry.js';

// ===== 网格渲染 =====

function PromptCardGrid({
  item: prompt,
  multiSelectEnabled,
  onToggleSelect,
  onOpen,
  onDelete,
  onContextMenu,
  theme,
  t,
}: GridCardRendererProps<Prompt>): React.ReactElement {
  const categoryLabel = t(`promptCreate.category${prompt.category.charAt(0).toUpperCase() + prompt.category.slice(1)}`);
  return (
    <div
      onContextMenu={onContextMenu}
      draggable
      onDragStart={(e) => {
        // 验收轮二十一:payload 携带完整数据 → 画布 drop 直接建 text 节点(内容即提示词正文)
        e.dataTransfer.setData('application/x-testlib-item', JSON.stringify({
          type: 'prompt',
          id: prompt.id,
          name: prompt.title,
          data: prompt,
        }));
      }}
    >
      <SharedPromptCard
        title={prompt.title}
        category={prompt.category}
        categoryLabel={categoryLabel}
        tags={prompt.tags}
        imageKeys={prompt.imageKeys}
        mode="asset"
        borderRadius={12}
        thumbnailAspectRatio="239.2/135.4"
        disableHoverScale
        onDelete={onDelete}
        onClick={multiSelectEnabled ? () => onToggleSelect(prompt.id) : onOpen}
        theme={theme}
      />
    </div>
  );
}

// ===== 列表渲染 =====

function PromptCardList({
  item: prompt,
  onClick,
  theme,
}: ListCardRendererProps<Prompt>): React.ReactElement {
  return (
    <>
      <span
        style={{ width: '40%', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        onClick={onClick}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {prompt.title}
        </span>
      </span>
      <span style={{ width: '20%' }}>
        <span style={{ fontSize: 10, padding: '0 6px', borderRadius: 4, border: `1px solid ${theme.toolbar.border}`, color: theme.toolbar.textMuted }}>
          prompt
        </span>
      </span>
      <span style={{ width: '20%', color: theme.toolbar.textMuted, fontSize: 11 }}>-</span>
      <span style={{ width: '20%', color: theme.toolbar.textMuted, fontSize: 11 }}>
        {prompt.createdAt ? new Date(prompt.createdAt).toLocaleDateString() : '-'}
      </span>
    </>
  );
}

// ===== 注册 =====

registerCard('prompt', {
  renderGrid: PromptCardGrid,
  renderList: PromptCardList,
});