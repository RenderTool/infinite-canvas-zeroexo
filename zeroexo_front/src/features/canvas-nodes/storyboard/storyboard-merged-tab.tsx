/**
 * StoryboardMergedTab - 分镜生产台五区容器（Plan#53 T4）
 *
 * 布局（自上而下）：
 *   ┌─────────────┬──────────────┬─────────────┐
 *   │ 左：资产面板 │ 中：视频舞台   │ 右：备选视频  │
 *   │ (24%)       │ (52%)        │ (24%)       │
 *   ├─────────────┴──────────────┴─────────────┤
 *   │ 时间轴（高度可拖拽）                        │
 *   ├──────────────────────────────────────────┤
 *   │ 底部：提示词编辑器                          │
 *   └──────────────────────────────────────────┘
 *
 * 数据源为只读 props（由 fullscreen-editor 接线），本组件管理纯 UI 状态
 * （选中镜头、拖拽分隔线、时间轴缩放等），一切业务写入回调给上层。
 */
import { memo, useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsUpDown, Film, Music2, Sparkles, ArrowRight } from 'lucide-react';
import { StoryboardAssetPanel, type StoryboardAssetPanelProps } from './storyboard-asset-panel';
import { StoryboardVideoStage, type StoryboardVideoStageProps } from './storyboard-video-stage';
import { StoryboardAlternativeVideos, type StoryboardAlternativeVideosProps } from './storyboard-alternative-videos';
import { StoryboardTimeline, type StoryboardTimelineProps } from './storyboard-timeline';
import { StoryboardPromptEditor, type StoryboardPromptEditorProps } from './storyboard-prompt-editor';
import type { StoryboardEntity } from './storyboard-types';

// ===== 布局常量 =====
const MIN_LEFT_WIDTH = 180;
const MAX_LEFT_WIDTH = 420;
const DEFAULT_LEFT_WIDTH = 0.24;
const MIN_RIGHT_WIDTH = 180;
const MAX_RIGHT_WIDTH = 420;
const DEFAULT_RIGHT_WIDTH = 0.24;
const MIN_TIMELINE_HEIGHT = 60;
const MAX_TIMELINE_HEIGHT = 320;
const DEFAULT_TIMELINE_HEIGHT = 190;

export interface StoryboardMergedTabProps {
  // 数据（只读，来自上层接线）
  entities: StoryboardEntity[];
  shot: any; // Shot 类型
  // 子组件事件透传
  assetPanelProps?: Omit<StoryboardAssetPanelProps, 'theme' | 'isDark'>;
  videoStageProps?: Omit<StoryboardVideoStageProps, 'theme' | 'isDark'>;
  alternativeVideosProps?: Omit<StoryboardAlternativeVideosProps, 'theme' | 'isDark'>;
  timelineProps?: Omit<StoryboardTimelineProps, 'theme' | 'isDark' | 't'>;
  promptEditorProps?: Omit<StoryboardPromptEditorProps, 'theme'>;
  // 空态向导回调
  onWizardAction?: (action: string) => void;
  theme: any;
  isDark: boolean;
}

export const StoryboardMergedTab = memo(function StoryboardMergedTab({
  entities, shot, assetPanelProps, videoStageProps, alternativeVideosProps, timelineProps, promptEditorProps,
  onWizardAction, theme, isDark,
}: StoryboardMergedTabProps): ReactElement {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState<number>(DEFAULT_LEFT_WIDTH);
  const [rightWidth, setRightWidth] = useState<number>(DEFAULT_RIGHT_WIDTH);
  const [timelineHeight, setTimelineHeight] = useState<number>(DEFAULT_TIMELINE_HEIGHT);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);
  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const [isDraggingTimeline, setIsDraggingTimeline] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const cardBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const panelBg = isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.02)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
  const dividerHover = theme.toolbar.accent ?? '#e94560';

  // ===== 分隔线拖拽 =====
  const startDrag = useCallback((e: React.PointerEvent<HTMLDivElement>, kind: 'left' | 'right' | 'timeline') => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (kind === 'left') setIsDraggingLeft(true);
    else if (kind === 'right') setIsDraggingRight(true);
    else setIsDraggingTimeline(true);
  }, []);

  const onDragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const ratio = (e.clientX - rect.left) / rect.width;
    if (isDraggingLeft) {
      const widthPx = Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, ratio * rect.width));
      setLeftWidth(widthPx / rect.width);
    } else if (isDraggingRight) {
      const fromRight = 1 - ratio;
      const widthPx = Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, fromRight * rect.width));
      setRightWidth(widthPx / rect.width);
    }
  }, [isDraggingLeft, isDraggingRight]);

  const onDragEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setIsDraggingLeft(false);
    setIsDraggingRight(false);
  }, []);

  const onTimelineDragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingTimeline) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const bottom = rect.bottom;
    const h = bottom - e.clientY;
    setTimelineHeight(Math.max(MIN_TIMELINE_HEIGHT, Math.min(MAX_TIMELINE_HEIGHT, h)));
  }, [isDraggingTimeline]);

  const onTimelineDragEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setIsDraggingTimeline(false);
  }, []);

  // ===== 空态判定 =====
  const isEmptyState = useMemo(() => {
    return !shot || (shot && !shot.description && (!shot.prompt || !shot.promptText) && (shot.videos?.length ?? 0) === 0);
  }, [shot]);

  // ===== 渲染 =====
  const leftPct = `${(leftWidth * 100).toFixed(1)}%`;
  const rightPct = `${(rightWidth * 100).toFixed(1)}%`;

  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, padding: 8, gap: 8, background: isDark ? '#141210' : '#fafaf7', overflow: 'hidden', boxSizing: 'border-box' }}
    >
      {/* 顶部三区 */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 8, position: 'relative' }}>
        {/* 左区 */}
        <div style={{ width: leftPct, minWidth: MIN_LEFT_WIDTH, maxWidth: MAX_LEFT_WIDTH, minHeight: 0 }}>
          <StoryboardAssetPanel
            entities={entities}
            selectedEntityId={selectedEntityId}
            onSelectEntity={setSelectedEntityId}
            theme={theme}
            isDark={isDark}
            {...assetPanelProps}
          />
        </div>
        {/* 左分隔线 */}
        <div
          onPointerDown={(e) => startDrag(e, 'left')}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          style={{ width: 4, margin: '0 -2px', cursor: 'col-resize', background: isDraggingLeft ? dividerHover : 'transparent', borderRadius: 2, transition: 'background 0.1s', zIndex: 2 }}
          title={t('storyboard.dragResize', '拖拽调整宽度')}
        />
        {/* 中区 */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <StoryboardVideoStage theme={theme} isDark={isDark} {...videoStageProps} />
        </div>
        {/* 右分隔线 */}
        <div
          onPointerDown={(e) => startDrag(e, 'right')}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          style={{ width: 4, margin: '0 -2px', cursor: 'col-resize', background: isDraggingRight ? dividerHover : 'transparent', borderRadius: 2, transition: 'background 0.1s', zIndex: 2 }}
          title={t('storyboard.dragResize', '拖拽调整宽度')}
        />
        {/* 右区 */}
        <div style={{ width: rightPct, minWidth: MIN_RIGHT_WIDTH, maxWidth: MAX_RIGHT_WIDTH, minHeight: 0 }}>
          <StoryboardAlternativeVideos
            theme={theme}
            isDark={isDark}
            {...alternativeVideosProps}
            videos={alternativeVideosProps?.videos ?? []}
            activeVideoIndex={alternativeVideosProps?.activeVideoIndex ?? 0}
            onActivate={alternativeVideosProps?.onActivate ?? (() => {})}
          />
        </div>
      </div>

      {/* 时间轴分隔线 + 时间轴 */}
      <div
        onPointerDown={(e) => startDrag(e, 'timeline')}
        onPointerMove={onTimelineDragMove}
        onPointerUp={onTimelineDragEnd}
        onPointerCancel={onTimelineDragEnd}
        style={{ display: 'flex', alignItems: 'center', gap: 6, height: 6, cursor: 'row-resize', color: textMuted, margin: '-2px 0' }}
      >
        <div style={{ flex: 1, height: 2, background: dividerColor, borderRadius: 1 }} />
        <ChevronsUpDown size={10} />
        <div style={{ flex: 1, height: 2, background: dividerColor, borderRadius: 1 }} />
      </div>
      <div style={{ height: timelineHeight, minHeight: MIN_TIMELINE_HEIGHT, maxHeight: MAX_TIMELINE_HEIGHT, flexShrink: 0 }}>
        <StoryboardTimeline
          theme={theme}
          isDark={isDark}
          t={t}
          {...timelineProps}
          shots={timelineProps?.shots ?? []}
          pixelsPerSecond={timelineProps?.pixelsPerSecond ?? 40}
          onPixelsPerSecondChange={timelineProps?.onPixelsPerSecondChange ?? (() => {})}
          onSelectShot={timelineProps?.onSelectShot ?? (() => {})}
        />
      </div>

      {/* 底部：提示词编辑器 */}
      <StoryboardPromptEditor
        theme={theme}
        {...promptEditorProps}
        imagePrompt={promptEditorProps?.imagePrompt ?? ''}
        videoPrompt={promptEditorProps?.videoPrompt ?? ''}
        negativePrompt={promptEditorProps?.negativePrompt ?? ''}
        onImagePromptChange={promptEditorProps?.onImagePromptChange ?? (() => {})}
        onVideoPromptChange={promptEditorProps?.onVideoPromptChange ?? (() => {})}
        onNegativePromptChange={promptEditorProps?.onNegativePromptChange ?? (() => {})}
      />

      {/* ===== 空态向导（T11） ===== */}
      {isEmptyState && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: isDark ? 'rgba(20,18,16,0.92)' : 'rgba(250,250,247,0.94)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ maxWidth: 460, padding: 32, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 32 }}>🎬</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: textPrimary }}>{t('storyboard.wizard.title', '分镜生产台')}</div>
            <div style={{ fontSize: 12, color: textMuted, lineHeight: 1.6 }}>
              {t('storyboard.wizard.subtitle', '本镜头尚未有内容。三步快速开始：')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
              <button
                type="button"
                onClick={() => onWizardAction?.('prompt')}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, background: panelBg, border: `1px solid ${cardBorder}`, cursor: 'pointer', fontSize: 12, color: textPrimary, textAlign: 'left' }}
              >
                <Sparkles size={16} color={theme.toolbar.accent ?? '#e94560'} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{t('storyboard.wizard.promptTitle', '补全提示词')}</div>
                  <div style={{ color: textMuted, fontSize: 11 }}>{t('storyboard.wizard.promptDesc', '从圣经组装或 AI 补全本镜提示词')}</div>
                </div>
                <ArrowRight size={14} color={textMuted} />
              </button>
              <button
                type="button"
                onClick={() => onWizardAction?.('generate')}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, background: panelBg, border: `1px solid ${cardBorder}`, cursor: 'pointer', fontSize: 12, color: textPrimary, textAlign: 'left' }}
              >
                <Film size={16} color={theme.toolbar.accent ?? '#e94560'} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{t('storyboard.wizard.generateTitle', '生成视频')}</div>
                  <div style={{ color: textMuted, fontSize: 11 }}>{t('storyboard.wizard.generateDesc', '质量门通过后一键生成主视频')}</div>
                </div>
                <ArrowRight size={14} color={textMuted} />
              </button>
              <button
                type="button"
                onClick={() => onWizardAction?.('voice')}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, background: panelBg, border: `1px solid ${cardBorder}`, cursor: 'pointer', fontSize: 12, color: textPrimary, textAlign: 'left' }}
              >
                <Music2 size={16} color={theme.toolbar.accent ?? '#e94560'} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{t('storyboard.wizard.voiceTitle', '配音预览')}</div>
                  <div style={{ color: textMuted, fontSize: 11 }}>{t('storyboard.wizard.voiceDesc', '自己配音上传，试听本镜音频')}</div>
                </div>
                <ArrowRight size={14} color={textMuted} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
