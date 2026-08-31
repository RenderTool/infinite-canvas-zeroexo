/**
 * StoryboardAlternativeVideos - 分镜生产台右区：备选视频（Plan#53 T7）
 *
 * 一镜多视频，首个为主视频，其余为备选；点击切换 activeVideoIndex。
 * 每项显示缩略/时长/状态/诊断（F 码）+ 设置为主 + 重试。
 */
import { memo, useCallback, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { AssetCardGrid } from '@/features/asset-library/cards/asset-card.js';
import type { Asset } from '@/features/asset-picker/index.js';
import type { ShotVideo } from './storyboard-types';
// 铁律：图标一律 lucide + 模块级 icons.ts Map，禁止 emoji 字符（2026-08-31）
import { CANVAS_NODE_ICONS } from '../icons.js';

/** 资产库卡片拖拽 MIME（与 drop-handler LIB_DRAG_MIME 一致） */
const LIB_DRAG_MIME = 'application/x-testlib-item';

export interface StoryboardAlternativeVideosProps {
  videos: ShotVideo[];
  activeVideoIndex: number;
  onActivate: (index: number) => void;
  /** 外部视频拖入（T5,2026-08-31）：资产库成品视频 → 追加为该镜头备选（source=external） */
  onExternalVideoDrop?: (payload: { storageKey: string; url: string; title?: string }) => void;
  theme: any;
  isDark: boolean;
}

export const StoryboardAlternativeVideos = memo(function StoryboardAlternativeVideos({
  videos, activeVideoIndex, onActivate, onExternalVideoDrop, theme,
}: StoryboardAlternativeVideosProps): ReactElement {
  const { t } = useTranslation();
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;

  // ShotVideo → PickerCard 接受的 Asset 形态（2026-08-31 用户拍板：备选视频必须用与资产抽屉同款卡片）
  const toCardAsset = useCallback((v: ShotVideo, idx: number): Asset => ({
    id: `alt-${idx}-${v.storageKey ?? idx}`,
    title: v.model ? `${idx === 0 ? 'V0' : `V${idx}`} · ${v.model}` : (idx === 0 ? 'V0' : `V${idx}`),
    kind: 'video',
    coverUrl: undefined,
    bytes: 0,
    createdAt: v.createdAt ?? new Date().toISOString(),
    // url 填 storageKey：AssetCardGrid 的 cover 取 data.url，usePreviewImage 内部按 storageKey 走授权解析，保证封面显示
    data: { kind: 'video', url: v.storageKey ?? '', storageKey: v.storageKey ?? '', durationMs: v.duration ? v.duration * 1000 : undefined },
  }), []);

  return (
    <div
      data-drop-zone="alternative"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const libData = e.dataTransfer.getData(LIB_DRAG_MIME);
        if (!libData || !onExternalVideoDrop) return;
        try {
          const item = JSON.parse(libData) as { type: string; name?: string; data: Asset };
          const d = item.data?.data;
          if (item.type === 'asset' && item.data?.kind === 'video' && d?.kind === 'video') {
            onExternalVideoDrop({ storageKey: d.storageKey ?? '', url: d.url ?? '', title: item.name });
          }
        } catch { /* 拖拽数据解析失败忽略 */ }
      }}
    >
      {/* 标题栏：去 border/background/padding，只保留文字（2026-08-31 用户拍板：不要任何样式） */}
      <div style={{ fontSize: 12, fontWeight: 600, color: textPrimary, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0 8px' }}>
        <span>{t('storyboard.alternativeVideos', '备选视频')}</span>
        <span style={{ fontSize: 10, color: textMuted, fontWeight: 400 }}>{videos.length - 1} {t('storyboard.alternatives', '备选')}</span>
      </div>
      {/* 卡片网格：与主页资产库 AssetCardGrid 卡片尺寸一致——auto-fill 按容器宽度自动填列，每列 150-200px，
         卡片最小 150px 不被挤压（容器 < 150px 时横向滚动而非压扁卡片）。 */}
      <div style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, alignContent: 'start' }}>
        {videos.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, height: 100, color: textMuted, fontSize: 11, opacity: 0.7, gridColumn: '1 / -1' }}>
            <CANVAS_NODE_ICONS.videoEmpty size={22} strokeWidth={1.5} />
            <span>{t('storyboard.noVideos', '暂无生成产物')}</span>
          </div>
        )}
        {videos.map((v, idx) => {
          const isActive = idx === activeVideoIndex;
          return (
            <div
              key={`${v.storageKey ?? idx}-${idx}`}
              style={{
                position: 'relative',
                borderRadius: 12,
                // 用 outline 不占布局空间，保证激活态不挤压卡片尺寸（与资产抽屉卡片视觉一致）
                outline: isActive ? `2px solid ${theme.toolbar.accent ?? '#e94560'}` : 'none',
                outlineOffset: -1,
              }}
            >
              {/* 2026-08-31 用户拍板：备选视频必须与「资产抽屉」同款 AssetCardGrid（视觉/封面/悬停播放一致） */}
              <AssetCardGrid
                item={toCardAsset(v, idx)}
                selected={isActive}
                multiSelectEnabled={false}
                onToggleSelect={() => undefined}
                onOpen={() => v.status === 'done' && onActivate(idx)}
                onRename={() => undefined}
                onDelete={() => undefined}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                theme={theme}
                t={t}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});
