/**
 * StackDetailsModal - 堆叠节点详情面板（Plan#20 验收反馈 #2：>5 卡断层兜底）
 *
 * 与主体编辑器同一套 Modal 框架（antd Modal 壳 + 背景分层 + 无边线 + theme token）：
 * - 网格展示全部卡片（含底部导航放不下的第 6+ 张，消除断层）
 * - 每格 = 16:9 缩略图 + 类型徽章 + 标题，激活卡主色高亮
 * - 点击卡片 → 跳转激活（commandQueue 可撤销）+ 关闭
 *
 * 普通媒体堆叠与主体堆叠共用（StackCard 通用契约，未来主体卡入堆叠即自然生效）。
 */
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Empty } from 'antd';
import { FileText, Image as ImageIcon, Video } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import type { StackCard } from './stacked-media-types.js';
import { Thumbnail } from './stacked-media-presentation.js';

export interface StackDetailsModalProps {
  open: boolean;
  onClose: () => void;
  cards: StackCard[];
  activeIndex: number;
  /** 跳转激活回调（视图侧已实现 commandQueue 可撤销 + 切换动画） */
  onJump: (index: number) => void;
}

/** 卡片类型徽章图标（与导航缩略图同源 icon 语汇） */
function TypeBadge({ card, dark }: { card: StackCard; dark: boolean }): React.ReactElement {
  const Icon = card.sourceType === 'video' ? Video : card.sourceType === 'image' ? ImageIcon : FileText;
  return (
    <div style={{
      position: 'absolute',
      top: 6,
      left: 6,
      width: 20,
      height: 20,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 6,
      background: dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.85)',
      color: dark ? 'rgba(255,255,255,0.8)' : 'rgba(15,23,42,0.65)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
      pointerEvents: 'none',
    }}>
      <Icon size={12} strokeWidth={2} />
    </div>
  );
}

export const StackDetailsModal = memo(function StackDetailsModal({
  open,
  onClose,
  cards,
  activeIndex,
  onJump,
}: StackDetailsModalProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';

  const pageBg = theme.canvas.background ?? (isDark ? '#131313' : '#f7f7f5');
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const tileBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)';

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={880}
      centered
      destroyOnHidden
      title={null}
      styles={{ body: { padding: 0, height: 'min(70vh, 640px)', overflow: 'hidden', background: pageBg, borderRadius: 12 } }}
    >
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* 头部:标题 + 计数(背景分层,无边线) */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: textPrimary }}>{t('nodes.stackDetails')}</span>
          <span style={{ fontSize: 12, color: textMuted, fontVariantNumeric: 'tabular-nums' }}>
            {t('nodes.stackDetailsCount', { count: cards.length })}
          </span>
        </div>

        {/* 卡片网格:全部卡片一览,>5 卡不再断层 */}
        {cards.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('nodes.stackDetailsEmpty')} />
          </div>
        ) : (
          <div
            className="zx-thin-scroll"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '4px 20px 20px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
              gap: 12,
              alignContent: 'start',
            }}
          >
            {cards.map((card, index) => {
              const active = index === activeIndex;
              return (
                <button
                  key={card.id}
                  type="button"
                  title={card.title ?? card.sourceType}
                  onClick={() => { onJump(index); onClose(); }}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: 0,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    minWidth: 0,
                  }}
                >
                  {/* 封面区 16:9(与节点展示区同比例) */}
                  <div style={{
                    position: 'relative',
                    aspectRatio: '16 / 9',
                    width: '100%',
                    borderRadius: 8,
                    overflow: 'hidden',
                    background: tileBg,
                    outline: active ? `2px solid ${accent}` : 'none',
                    outlineOffset: 2,
                  }}>
                    <Thumbnail card={card} dark={isDark} />
                    <TypeBadge card={card} dark={isDark} />
                  </div>
                  {/* 标题行(单行省略) */}
                  <span style={{
                    fontSize: 12,
                    color: active ? accent : textPrimary,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    padding: '0 2px',
                  }}>
                    {card.title ?? card.sourceType}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
});
