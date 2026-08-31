/**
 * StoryboardMergedTab - 分镜生产台五区容器（Plan#53 T4）
 *
 * OpenCut 风格布局（左栏可折叠侧边栏 + 主区分屏）：
 *   ┌─ 主体侧边栏 (可折叠) ──┆─── 主区 ───────────────────────────────┐
 *   │ [▶ 折叠]              │ ┌──────────────────┬──────────────────┐│
 *   │ [全类 ▼] [上传]       │ │ 主视频 (16:9)     │ 备选视频 (2列)   ││
 *   │ Tab: 参考/特效/角色/运镜 │ │                   │                  ││
 *   │ 卡片列表 (AssetCard同款)│ ├─ 竖直分隔线 ─────┴──────────────────┤│
 *   │                        │ │ 时间轴（单轨）                      ││
 *   │                        │ ├─ 提示词区（NodeGenerateDock 同款）───┤│
 *   └────────────────────────┴──┴────────────────────────────────────┘
 *
 * 数据源为只读 props（由 fullscreen-editor 接线），本组件管理纯 UI 状态
 * （侧边栏折叠、选中镜头、拖拽分隔线、时间轴缩放等），一切业务写入回调给上层。
 */
import { memo, useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronsUpDown, ChevronRight, ChevronLeft } from 'lucide-react';
import { StoryboardAssetPanel, type StoryboardAssetPanelProps } from './storyboard-asset-panel';
import { StoryboardVideoStage, type StoryboardVideoStageProps } from './storyboard-video-stage';
import { StoryboardAlternativeVideos, type StoryboardAlternativeVideosProps } from './storyboard-alternative-videos';
import { StoryboardTimeline, type StoryboardTimelineProps } from './storyboard-timeline';
import { NodeGenerateDock, type NodeGenerateDockProps } from '@/features/tools-dock/node-generate-dock.js';
import type { StoryboardEntity } from './storyboard-types';

// ===== 布局常量 =====
const SIDEBAR_EXPANDED_WIDTH = 240;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_FOLD_BTN_WIDTH = 24;
/**
 * 2026-08-31 用户拍板（第六次迭代，覆写第五次）：
 * 1. **提示词区固定底部**（PROMPT_FIXED_HEIGHT），不参与任何缩放/拖拽；
 * 2. 水平分割线拖拽调整的是**导轨区**高度（timelineHeight）；
 * 3. 提示词 dock 内部：参考素材区 + 底栏（模型输入/参数/生成）**固定可见**，仅文本输入区可压缩滚动；
 * 4. 提示词 dock 直接作为底部区域 flex 子项，不包额外 div。
 */
/** 提示词区固定高度（上一版 285 减 50，用户拍板） */
const PROMPT_FIXED_HEIGHT = 235;
/** 导轨默认高度（参考 AI Video Studio.html 的 .timeline height:215px） */
const TIMELINE_DEFAULT_HEIGHT = 215;
/** 导轨最小高度（保证标尺 + 单轨 clip 可读，组件内部固定骨架 ≈ 132px） */
const TIMELINE_MIN_HEIGHT = 140;
/** 导轨最大高度（防止把视频预览区挤没） */
const TIMELINE_MAX_HEIGHT = 360;
/** 顶部行内 主视频 : 备选视频 = 3 : 1（同一套拍板） */
const VIDEO_FLEX = 3;
const ALT_FLEX = 1;
/** 备选视频拖拽宽度边界（手动拖拽后生效，替代比例） */
const MIN_ALT_WIDTH = 132;
const MAX_ALT_WIDTH = 420;

export interface StoryboardMergedTabProps {
  // 数据（只读，来自上层接线）
  entities: StoryboardEntity[];
  /**
   * 是否渲染左侧资产侧边栏（默认 true）
   * 出片工作台无"主体资产"语义 → 传 false，整条 sidebar（含拖拽分隔条）不渲染
   */
  showAssetSidebar?: boolean;
  // 子组件事件透传
  assetPanelProps?: Omit<StoryboardAssetPanelProps, 'theme' | 'isDark'>;
  videoStageProps?: Omit<StoryboardVideoStageProps, 'theme' | 'isDark'>;
  alternativeVideosProps?: Omit<StoryboardAlternativeVideosProps, 'theme' | 'isDark'>;
  timelineProps?: Omit<StoryboardTimelineProps, 'theme' | 'isDark' | 't'>;
  /**
   * 底部提示词栏：直接复用视频节点下方同款 NodeGenerateDock(征集 #115 / 2026-08-31 用户拍板)
   * 内联渲染 + radius 0(不要圆角) + 默认展开,故这三项由本容器锁定,不接受外部传入
   */
  promptDockProps?: Omit<NodeGenerateDockProps, 'inline' | 'radius' | 'defaultCollapsed'>;
  /**
   * 提示词区上方展示的引用主体胶囊（出片工作台：当前镜头 @提及 匹配主体库）。
   * 让用户一眼看到本镜关联了哪些主体。
   */
  promptSubjectChips?: Array<{ id: string; name: string; kind: string }>;
  /** 提示词区上方的附加操作按钮（出片工作台：跨镜衔接取帧等，2026-08-31 T3） */
  promptExtraActions?: Array<{ key: string; label: string; onClick: () => void }>;
  theme: any;
  isDark: boolean;
}

export const StoryboardMergedTab = memo(function StoryboardMergedTab({
  entities, showAssetSidebar = true, assetPanelProps, videoStageProps, alternativeVideosProps, timelineProps, promptDockProps, promptSubjectChips, promptExtraActions,
  theme, isDark,
}: StoryboardMergedTabProps): ReactElement {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_EXPANDED_WIDTH);
  /** 导轨区高度，水平分割线拖拽调整（提示词区固定高度不参与缩放） */
  const [timelineHeight, setTimelineHeight] = useState(TIMELINE_DEFAULT_HEIGHT);
  /** 备选视频区容器（拖拽起点取其实测宽度：默认态是按 3:1 比例渲染的） */
  const altWrapRef = useRef<HTMLDivElement>(null);
  /** 备选视频宽度（null=按 3:1 比例；number=用户手动拖过后的定宽） */
  const [altWidth, setAltWidth] = useState<number | null>(null);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [sidebarAnimating, setSidebarAnimating] = useState(false);

  // OpenCut 暗色专业剪辑风配色（Plan#53 §2 布局契约）
  // 2026-08-31：全站统一画布背景色；次级表面用中性微亮 #151517（无棕）
  const OPENCUT_BG = isDark ? theme.canvas.background : '#fafaf7';
  const OPENCUT_CARD = isDark ? '#151517' : 'rgba(0,0,0,0.02)';
  const OPENCUT_ACCENT = '#3b82f6';
  const textMuted = theme.toolbar.textMuted;
  const panelBg = isDark ? OPENCUT_CARD : 'rgba(0,0,0,0.02)';
  const dividerColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
  const dividerHover = OPENCUT_ACCENT;

  // ===== 侧边栏折叠 =====
  const toggleSidebar = useCallback(() => {
    setSidebarAnimating(true);
    setSidebarCollapsed((prev) => !prev);
    setTimeout(() => setSidebarAnimating(false), 180);
  }, []);

  const currentSidebarWidth = useMemo(() => {
    if (sidebarCollapsed) return SIDEBAR_FOLD_BTN_WIDTH;
    return sidebarWidth;
  }, [sidebarCollapsed, sidebarWidth]);

  // ===== 分隔线拖拽 =====
  /* 侧边栏拖拽
   * ⚠️ 必须用 window + capture 阶段监听（2026-08-31 修复：分割条拖不动）
   * 本组件被 CanvasTabContentBoundary 包裹，边界在冒泡阶段调用
   * `e.stopPropagation()`（React 合成事件会透传到原生事件 nativeEvent.stopPropagation）。
   * React 18 把监听器挂在 root container 上，原生事件冒泡到 root 时即被掐断，
   * 挂在 document/window 上的**冒泡阶段**监听永远收不到 pointermove/pointerup
   * → 拖拽无响应且 isDraggingSidebar 卡死在 true。
   * capture 阶段监听在事件下行时（window 为最外层）就已执行，不受冒泡阻断影响。 */
  const startDragSidebar = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (sidebarCollapsed) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setIsDraggingSidebar(true);
    const onMove = (ev: PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const widthPx = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, ev.clientX - rect.left));
      setSidebarWidth(widthPx);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      setIsDraggingSidebar(false);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  }, [sidebarCollapsed]);

  /* 导轨区高度拖拽（2026-08-31 第六次拍板：提示词区固定底部，分隔线只调导轨高度）
   * ⚠️ 必须用「起始高度 + 位移增量」+ window + capture（规避页签边界的冒泡阻断）。
   * 导轨 min/max 保证标尺可读且不把视频预览区挤没（提示词固定高度不参与缩放）。 */
  const startDragTimeline = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const startY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      // 分割线上移(clientY 减小) → 导轨变高
      const h = timelineHeight + (startY - ev.clientY);
      // 动态上限：导轨 + 固定提示词不得把视频预览区挤没（留 96px 最小余量）
      const containerH = containerRef.current?.clientHeight ?? 0;
      const maxByContainer = containerH > 0 ? containerH - PROMPT_FIXED_HEIGHT - 96 : TIMELINE_MAX_HEIGHT;
      const max = Math.min(TIMELINE_MAX_HEIGHT, maxByContainer);
      setTimelineHeight(Math.max(TIMELINE_MIN_HEIGHT, Math.min(max, h)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  }, [timelineHeight]);

  /* 备选视频宽度拖拽（2026-08-31 新增：主视频 : 备选 = 3 : 1，可手动调宽）
   * 与时间轴同理：起点取实测 DOM 宽度 + 位移增量，window + capture 规避页签边界阻断。 */
  const startDragAlt = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const startX = e.clientX;
    const startW = altWrapRef.current?.clientWidth ?? MIN_ALT_WIDTH;
    const onMove = (ev: PointerEvent) => {
      // 备选在左（T9,2026-08-31）：分割线右移(clientX 增大) → 备选变宽
      const w = startW + (ev.clientX - startX);
      setAltWidth(Math.max(MIN_ALT_WIDTH, Math.min(MAX_ALT_WIDTH, w)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  }, []);

  // ===== 渲染 =====
  const sidebarTransition = sidebarAnimating || sidebarCollapsed ? `width 180ms ease, min-width 180ms ease, max-width 180ms ease` : 'none';

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        height: '100%',
        minHeight: 0,
        background: isDark ? OPENCUT_BG : '#fafaf7',
        overflow: 'hidden',
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      {/* ===== 左侧边栏（出片工作台 showAssetSidebar=false 时整条不渲染） ===== */}
      {showAssetSidebar && (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: currentSidebarWidth,
          minWidth: sidebarCollapsed ? SIDEBAR_FOLD_BTN_WIDTH : SIDEBAR_MIN_WIDTH,
          maxWidth: sidebarCollapsed ? SIDEBAR_FOLD_BTN_WIDTH : SIDEBAR_MAX_WIDTH,
          height: '100%',
          overflow: 'hidden',
          transition: sidebarTransition,
          borderRight: `1px solid ${dividerColor}`,
          background: isDark ? OPENCUT_CARD : panelBg,
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {/* 折叠按钮 */}
        <div
          onClick={toggleSidebar}
          style={{
            position: 'absolute',
            top: 8,
            right: sidebarCollapsed ? 4 : -10,
            zIndex: 10,
            width: 20,
            height: 20,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: textMuted,
            background: isDark ? OPENCUT_CARD : '#fff',
            border: `1px solid ${dividerColor}`,
            transition: 'right 180ms ease',
          }}
          title={sidebarCollapsed ? t('storyboard.expandSidebar', '展开侧边栏') : t('storyboard.collapseSidebar', '折叠侧边栏')}
        >
          {sidebarCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </div>

        {!sidebarCollapsed && (
          <StoryboardAssetPanel
            entities={entities}
            selectedEntityId={selectedEntityId}
            onSelectEntity={setSelectedEntityId}
            theme={theme}
            isDark={isDark}
            {...assetPanelProps}
            collapsed={false}
          />
        )}

        {/* 折叠态简化提示 */}
        {sidebarCollapsed && (
          <div
            onClick={toggleSidebar}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: textMuted,
              fontSize: 10,
              writingMode: 'vertical-rl',
              letterSpacing: '0.15em',
              opacity: 0.5,
            }}
          >
            {t('storyboard.sidebar', '资产')}
          </div>
        )}
      </div>
      )}

      {/* 侧边栏分隔线 */}
      {showAssetSidebar && !sidebarCollapsed && (
        <div
          onPointerDown={startDragSidebar}
          style={{
            width: 4,
            cursor: 'col-resize',
            background: isDraggingSidebar ? dividerHover : 'transparent',
            borderRadius: 2,
            transition: 'background 0.1s',
            zIndex: 2,
            flexShrink: 0,
            margin: '0 -2px',
          }}
          title={t('storyboard.dragResize', '拖拽调整宽度')}
        />
      )}

      {/* ===== 主区：上中下布局 ===== */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, padding: 0, gap: 0, overflow: 'hidden' }}>
        {/* 顶部行（备选视频 + 主视频）＝「视频预览区」，吃满剩余空间；T9:候选区左移贴合资产抽屉 */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 0, padding: '8px 8px 0 8px', overflow: 'hidden' }}>
          {/* 左区：备选视频（默认占 1 份 / 手动拖拽后定宽；可拖入外部成品视频 T5） */}
          <div
            ref={altWrapRef}
            style={{
              ...(altWidth === null
                ? { flex: ALT_FLEX, minWidth: MIN_ALT_WIDTH, maxWidth: MAX_ALT_WIDTH, minHeight: 0 }
                : { width: altWidth, minWidth: MIN_ALT_WIDTH, maxWidth: MAX_ALT_WIDTH, flexShrink: 0, minHeight: 0 }),
              marginRight: 4,
            }}
          >
            <StoryboardAlternativeVideos
              theme={theme}
              isDark={isDark}
              {...alternativeVideosProps}
              videos={alternativeVideosProps?.videos ?? []}
              activeVideoIndex={alternativeVideosProps?.activeVideoIndex ?? 0}
              onActivate={alternativeVideosProps?.onActivate ?? (() => {})}
            />
          </div>
          {/* 竖直分割线（2026-08-31：备选(左)与主视频(右)之间可拖拽，默认 1:3） */}
          <div
            onPointerDown={startDragAlt}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 8,
              cursor: 'col-resize',
              color: textMuted,
              flexShrink: 0,
            }}
            title={t('storyboard.dragResize', '拖拽调整宽度')}
          >
            <div style={{ width: 2, height: '100%', background: dividerColor, borderRadius: 1 }} />
          </div>
          {/* 右区：主视频（默认占 3 份；手动拖过备选宽度后吃掉剩余空间） */}
          <div style={{ flex: altWidth === null ? VIDEO_FLEX : 1, minWidth: 0, minHeight: 0 }}>
            <StoryboardVideoStage theme={theme} isDark={isDark} {...videoStageProps} />
          </div>
        </div>

        {/* 水平分隔线（拖拽调整「导轨区」高度；提示词区固定底部不参与缩放） */}
        <div
          onPointerDown={startDragTimeline}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            height: 8,
            cursor: 'row-resize',
            color: textMuted,
            padding: '0 8px',
            flexShrink: 0,
          }}
          title={t('storyboard.dragResize', '拖拽调整导轨高度')}
        >
          <div style={{ flex: 1, height: 2, background: dividerColor, borderRadius: 1 }} />
          <ChevronsUpDown size={10} />
          <div style={{ flex: 1, height: 2, background: dividerColor, borderRadius: 1 }} />
        </div>

        {/* 底部区域：导轨（可拖高度）+ 提示词（固定高度，始终贴底） */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          overflow: 'hidden',
        }}>
          {/* 导轨：高度由上方水平分割线拖拽调整 */}
          <div style={{ height: timelineHeight, flexShrink: 0, overflow: 'hidden' }}>
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

          {/* 引用主体胶囊 + 附加操作（跨镜衔接取帧）：提示词区上方（2026-08-31 T3） */}
          {((promptSubjectChips && promptSubjectChips.length > 0) || (promptExtraActions && promptExtraActions.length > 0)) && (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                padding: '6px 12px', flexShrink: 0,
                borderTop: `1px solid ${dividerColor}`,
                background: isDark ? OPENCUT_BG : panelBg,
              }}
            >
              {promptSubjectChips && promptSubjectChips.length > 0 && (
                <>
                  <span style={{ fontSize: 10, color: textMuted, flexShrink: 0 }}>
                    {t('storyboard.referencedSubjects', '引用主体')}
                  </span>
                  {promptSubjectChips.map((s) => (
                    <span
                      key={s.id}
                      title={t('storyboard.subjectKind', { kind: s.kind })}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '1px 8px', borderRadius: 10, fontSize: 11,
                        background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                        color: theme.toolbar.text, border: `1px solid ${dividerColor}`,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.name}
                    </span>
                  ))}
                </>
              )}
              {/* 跨镜衔接取帧等附加操作（右对齐） */}
              {promptExtraActions && promptExtraActions.length > 0 && (
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {promptExtraActions.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      onClick={a.onClick}
                      style={{
                        fontSize: 10, color: theme.toolbar.accent, background: 'transparent',
                        border: 'none', cursor: 'pointer', padding: '1px 6px', borderRadius: 8,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 提示词区 = 视频节点正下方同款 NodeGenerateDock(征集 #115,2026-08-31 用户拍板)：
              固定高度直接作为 flex 子项（不包额外 div）；fitToHeight 保证
              参考素材区 + 底栏(模型输入/参数/生成)始终可见，仅文本输入区可压缩滚动 */}
          {promptDockProps && (
            <NodeGenerateDock
              inline
              radius={0}
              defaultCollapsed={false}
              fitToHeight
              style={{ height: PROMPT_FIXED_HEIGHT, flexShrink: 0 }}
              {...promptDockProps}
            />
          )}
        </div>
      </div>

    </div>
  );
});