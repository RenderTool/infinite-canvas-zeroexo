/**
 * StackDetailsModal - 堆叠节点详情面板（Plan#20 验收反馈 #2：>5 卡断层兜底）
 *
 * 与主体编辑器同一套 Modal 框架（antd Modal 壳 + 背景分层 + 无边线 + theme token）：
 * - 网格展示全部卡片（含底部导航放不下的第 6+ 张，消除断层）
 * - 每格 = 16:9 缩略图 + 类型徽章 + 标题，激活卡主色高亮（仅作状态指示）
 * - 点击卡片 → 打开统一资产查看器 AssetDetailViewer 浏览对应媒体（征集 #75：
 *   不再退出面板切换堆叠；关闭查看器回到网格继续浏览）
 *
 * 普通媒体堆叠与主体堆叠共用（StackCard 通用契约，未来主体卡入堆叠即自然生效）。
 */
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Empty } from 'antd';
import { FileText, Image as ImageIcon, Video } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import type { StackCard } from './stacked-media-types.js';
import { Thumbnail } from './stacked-media-presentation.js';
import { AssetDetailViewer, type AssetDetailData } from '@/shared/components/asset-detail-viewer.js';

export interface StackDetailsModalProps {
  open: boolean;
  onClose: () => void;
  cards: StackCard[];
  activeIndex: number;
  /** @deprecated 征集 #75 后点击不再切换堆叠，仅保留兼容调用方（未使用） */
  onJump?: (index: number) => void;
}

/** 堆叠卡片 → 统一资产查看器数据（字段形态与 nodeToAssetDetail 对齐） */
function cardToAssetDetail(card: StackCard): AssetDetailData {
  const d = card.data ?? {};
  const content = ((d.content as string) ?? '') || '';
  const kind: AssetDetailData['kind'] =
    card.sourceType === 'image' ? 'image'
      : card.sourceType === 'video' ? 'video'
        : card.sourceType === 'audio' ? 'audio'
          : 'text';
  return {
    id: card.id,
    title: card.title ?? card.sourceType,
    kind,
    bytes: (d.bytes as number) ?? 0,
    mimeType: (d.mimeType as string) ?? undefined,
    createdAt: (d.createdAt as number) ?? undefined,
    data: {
      kind,
      content,
      dataUrl: kind === 'image' ? content : undefined,
      url: kind === 'video' || kind === 'audio' ? content : undefined,
      storageKey: (d.storageKey as string) ?? undefined,
      width: (d.width as number) ?? undefined,
      height: (d.height as number) ?? undefined,
      prompt: (d.prompt as string) ?? undefined,
      durationMs: (d.durationMs as number) ?? undefined,
    },
  };
}

/** 卡片类型徽章图标（与导航缩略图同源 icon 语汇） */
function TypeBadge({ card, dark }: { card: StackCard; dark: boolean }): React.ReactElement {
  const Icon = card.sourceType === 'video' ? Video : card.sourceType === 'image' ? ImageIcon : FileText;
  return (
    <div style={{
      position: 'absolute',
      top: 8,
      left: 8,
      width: 24,
      height: 24,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 6,
      background: dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.85)',
      color: dark ? 'rgba(255,255,255,0.8)' : 'rgba(15,23,42,0.65)',
      boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
      pointerEvents: 'none',
    }}>
      <Icon size={14} strokeWidth={2} />
    </div>
  );
}

export const StackDetailsModal = memo(function StackDetailsModal({
  open,
  onClose,
  cards,
  activeIndex,
}: StackDetailsModalProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  // 征集 #75：点击卡片打开资产查看器（嵌套 Modal），不再跳转切换堆叠；关闭后回到网格
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

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
      width="min(1280px, calc(100vw - 64px))"
      centered
      destroyOnHidden
      title={null}
      styles={{ body: { padding: 0, height: 'min(80vh, 820px)', overflow: 'hidden', background: pageBg, borderRadius: 12 } }}
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
              padding: '4px 24px 24px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 16,
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
                  onClick={() => setViewerIndex(index)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    padding: 0,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    minWidth: 0,
                  }}
                >
                  {/* 封面区 16:9(与节点展示区同比例);详情面板大格子走预览图级(quality='preview',
                      三档契约征集 #77:展示层自适应不拉原图,原图只在图片浏览器) */}
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
                    <Thumbnail card={card} dark={isDark} quality="preview" />
                    <TypeBadge card={card} dark={isDark} />
                  </div>
                  {/* 标题行(单行省略) */}
                  <span style={{
                    fontSize: 13,
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

      {/* 征集 #75：卡片点击后的资产查看器（嵌套在本面板之上，关闭回到网格） */}
      {viewerIndex !== null && cards[viewerIndex] && (
        <AssetDetailViewer
          asset={cardToAssetDetail(cards[viewerIndex])}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </Modal>
  );
});
