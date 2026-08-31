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
  /**
   * 全局视频池（2026-08-31 语义重定义：备选区显示【所有】生成的/拖入使用的视频，
   * 不再是一对一绑定当前镜头的 videos）。
   * 元素来源：全部 shots[].videos + mediaAssets（删除片段后仍保留）。
   */
  videos: ShotVideo[];
  /** 当前镜头激活视频的 storageKey（用于标记激活态，不再用 index） */
  activeStorageKey?: string;
  onActivate: (storageKey: string) => void;
  /** 外部视频拖入（T5,2026-08-31）：资产库成品视频 → 追加为该镜头备选（source=external） */
  onExternalVideoDrop?: (payload: { storageKey: string; url: string; title?: string }) => void;
  /**
   * 从全局池移除某视频（2026-08-31 语义重定义）。
   * 由宿主负责确认 + 从所有镜头 videos + mediaAssets 移除引用 + activeVideoIndex 校正。
   */
  onDeleteVideo?: (storageKey: string) => void;
  theme: any;
  isDark: boolean;
}

export const StoryboardAlternativeVideos = memo(function StoryboardAlternativeVideos({
  videos, activeStorageKey, onActivate, onExternalVideoDrop, onDeleteVideo, theme,
}: StoryboardAlternativeVideosProps): ReactElement {
  const { t } = useTranslation();
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;

  // ShotVideo → PickerCard 接受的 Asset 形态（2026-08-31 用户拍板：备选视频必须用与资产抽屉同款卡片）
  // ⚠️ title 一律用【原始素材名】（用户上传时的"拳打 1.mp4"等），不再硬编码 V0/V1（2026-08-31 修复"素材名被改"）
  // 兜底顺序：v.title → 截断 storageKey 末段 → "V{idx}" 兜底
  const toCardAsset = useCallback((v: ShotVideo, idx: number): Asset => {
    const rawName = v.title?.trim();
    const fallbackName = v.storageKey ? v.storageKey.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '' : '';
    const displayName = rawName || fallbackName || `V${idx}`;
    return {
      id: `alt-${idx}-${v.storageKey ?? idx}`,
      title: displayName,
      kind: 'video',
      coverUrl: undefined,
      bytes: 0,
      createdAt: v.createdAt ?? new Date().toISOString(),
      // url 填 storageKey：AssetCardGrid 的 cover 取 data.url，usePreviewImage 内部按 storageKey 走授权解析，保证封面显示
      data: { kind: 'video', url: v.storageKey ?? '', storageKey: v.storageKey ?? '', durationMs: v.duration ? v.duration * 1000 : undefined },
    };
  }, []);

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
      {/* 卡片网格：与主页资产库 AssetCardGrid 卡片尺寸一致——auto-fill 按容器宽度自动填列，每列最小 120px。
         ⚠️ 备选区容器通常较窄（出片页签 1/4 主宽），卡片最小宽度收到 120 后高度按 16:9 自适应，
         视频帧不再被压扁（2026-08-31 修复"视频被挤压"）。 */}
      <div style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gridAutoRows: 'max-content', gap: 10, alignContent: 'start', paddingBottom: 4 }}>
        {videos.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, height: 100, color: textMuted, fontSize: 11, opacity: 0.7, gridColumn: '1 / -1' }}>
            <CANVAS_NODE_ICONS.videoEmpty size={22} strokeWidth={1.5} />
            <span>{t('storyboard.noVideos', '暂无生成产物')}</span>
          </div>
        )}
        {videos.map((v, idx) => {
          const isActive = !!v.storageKey && v.storageKey === activeStorageKey;
          return (
            // 2026-08-31 用户拍板：备选视频必须与「资产抽屉」同款 AssetCardGrid（视觉/封面/悬停播放一致）。
            // 不要任何自定义激活态描边——AssetCardGrid 自身已带 hover/click 视觉反馈。
            <div
              key={`${v.storageKey ?? idx}-${idx}`}
              data-active={isActive ? '1' : '0'}
              title={isActive ? t('storyboard.activeAlt', '当前备选') : undefined}
              style={{ display: 'flex' }}
            >
              <AssetCardGrid
                item={toCardAsset(v, idx)}
                selected={false}
                multiSelectEnabled={false}
                onToggleSelect={() => undefined}
                onOpen={() => v.status === 'done' && v.storageKey && onActivate(v.storageKey)}
                onRename={() => undefined}
                // 2026-08-31 修复：此前传空函数导致「删除备选」无反应。删除只移除引用，
                // 云上素材文件不动（与主视频/时间轴删除语义一致）。
                onDelete={() => v.storageKey && onDeleteVideo?.(v.storageKey)}
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
