/**
 * HierarchyPanelSidebar - 画布结构/资产库合一抽屉（征集 #87 验收轮九重设计）
 *
 * 布局：宽 450px，内容 = 主页资产库同款页面（forceMobile 移动端同款卡片布局 + 固定 2 格网格）。
 * 视图由分组决定（征集 #87 验收轮十用户拍板）：
 * - 层级分组 = 原树形列表（HierarchyListView，层级专属；虚拟滚动/键盘导航/批量选择/ZIP 全保留）
 * - 素材/提示词/剧本分组 = 网格卡片（主页同款，上传/删除/重命名/收藏/右键发送到画布）
 *
 * 抽屉式动画：外层 width+opacity（控制 flex 占位），内层 translate3d（GPU 加速滑入滑出）。
 * 打开性能（Plan#48-T6 重带）：动画期间延迟挂载资产库页，避免与滑入动画同帧竞争。
 */

import { useState, useLayoutEffect, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useHierarchyPanelProps } from '@zeroexo/plugin-group';
import type { GroupPlugin } from '@zeroexo/plugin-group';
import type { ThemeConfig } from '@zeroexo/shared';
// 2026-08-30 用户拍板:画布资产抽屉与主页资产库拆为两套独立架构(抽屉用 CanvasAssetsPanel)
import { CanvasAssetsPanel } from '@/features/canvas-assets/index.js';
import { EDITOR_ICONS } from '@/pages/editor/editor-canvas/icons.js';
import { Z_INDEX } from '@/shared/constants/z-index.js';

export interface HierarchyPanelSidebarProps {
  closing: boolean;
  store: ReactGraphStore;
  groupPlugin: GroupPlugin;
  theme: ThemeConfig;
  /** 移动端弹窗模式:禁用宽度动画,宽度 100%,无右边框 */
  modal?: boolean;
  /** 覆盖模式(征集 #95):绝对定位于画布左缘之上覆盖拉开(不推开布局),移动端复用 PC 同款抽屉 */
  overlay?: boolean;
  /** 关闭按钮回调 */
  onClose?: () => void;
  /** 点击节点时聚焦(层级分组卡片点击回调) */
  onFocusNode?: (nodeId: string) => void;
  /** 资产库发送到画布(接编辑器 handleAssetInsert) */
  onSendToCanvas?: (item: { type: 'asset' | 'prompt' | 'script'; id: string; data: unknown }) => void;
}

// 征集 #87 验收轮七:抽屉加宽至 450(容纳主页资产库同款卡片布局)
// 2026-08-30 用户拍板:PC 端抽屉尺寸减少 50px(450 → 400)
// 2026-08-31 用户拍板:PC 端抽屉支持右侧分割线拖拽调宽
const PANEL_WIDTH = 400;
const PANEL_MIN_WIDTH = 280;
const PANEL_MAX_WIDTH = 640;
// 抽屉式动画:统一 0.35s cubic-bezier(0.22, 1, 0.36, 1),展开收起同节奏
const DRAWER_TRANSITION = '0.35s cubic-bezier(0.22, 1, 0.36, 1)';

export function HierarchyPanelSidebar({
  closing, store, groupPlugin, theme, modal, overlay, onClose, onFocusNode,
  onSendToCanvas,
}: HierarchyPanelSidebarProps): React.ReactElement {
  const props = useHierarchyPanelProps(store, groupPlugin.getController());
  const { t } = useTranslation();

  // 展开动画:useLayoutEffect 确保初始 DOM 状态提交后再触发过渡
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    if (closing) { setExpanded(false); return; }
    let rafId: number;
    const id = requestAnimationFrame(() => {
      rafId = requestAnimationFrame(() => setExpanded(true));
    });
    return () => { cancelAnimationFrame(id); cancelAnimationFrame(rafId); };
  }, [closing]);

  // Plan#48-T6 打开性能(重带):资产库页延迟挂载 —— 0.35s width 过渡期间不挂载重页面,
  // 420ms 后再挂;避免树/卡片数据加载 + antd 控件挂载与滑入动画同帧竞争。
  const [contentReady, setContentReady] = useState(false);
  useEffect(() => {
    if (closing || !expanded || contentReady) return;
    const timer = window.setTimeout(() => setContentReady(true), 420);
    return () => window.clearTimeout(timer);
  }, [closing, expanded, contentReady]);

  // 2026-08-31 用户拍板：PC 端资产抽屉右侧分割线拖拽调宽
  const [panelWidth, setPanelWidth] = useState(PANEL_WIDTH);
  const [draggingWidth, setDraggingWidth] = useState(false);
  const startDragWidth = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDraggingWidth(true);
    const startX = e.clientX;
    const startW = panelWidth;
    const onMove = (ev: PointerEvent) => {
      const w = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, startW + (ev.clientX - startX)));
      setPanelWidth(w);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      setDraggingWidth(false);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  }, [panelWidth]);

  const width = closing ? 0 : expanded ? panelWidth : 0;
  const opacity = closing ? 0 : expanded ? 1 : 0;
  // translate3d 触发 GPU 合成层,生产环境动画更流畅
  const translate3d = closing ? `translate3d(${-panelWidth}px, 0, 0)` : expanded ? 'translate3d(0, 0, 0)' : `translate3d(${-panelWidth}px, 0, 0)`;

  // 抽屉式动画:展开收起统一节奏。
  // 外层不加 will-change:width 非合成属性,无效提示反而诱发多余分层(征集 #85/Plan#48-T6 教训)。
  const outerStyle: CSSProperties = overlay
    ? {
        // 征集 #95:覆盖模式——绝对定位于画布左缘之上(不占布局、不推开内容),移动端与 PC 同款组件
        // 2026-08-31 修复:zIndex 提到 DRAWER_OVERLAY(31000),否则会被出片工作台全屏(30000)遮挡
        position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: Z_INDEX.DRAWER_OVERLAY,
        width: panelWidth, maxWidth: '92vw',
        opacity: closing ? 0 : (expanded ? 1 : 0),
        pointerEvents: closing || !expanded ? 'none' : 'auto',
        transition: `opacity ${DRAWER_TRANSITION}`,
      }
    : modal
    ? {
        width: '100%', height: '100%',
        opacity: closing ? 0 : (expanded ? 1 : 0),
        pointerEvents: closing || !expanded ? 'none' : 'auto',
        transition: `opacity ${DRAWER_TRANSITION}`,
      }
    : {
        // 2026-08-29 修复:PC 端去掉 overflow clip——innerStyle 的 box-shadow(1px 边线)
        // 会被父级 overflow 裁剪而不可见;innerStyle 自带 overflow hidden 已足够约束内容
        flexShrink: 0, width, opacity,
        pointerEvents: closing || !expanded ? 'none' : undefined,
        // 2026-08-31 拖拽调宽期间禁用宽度动画，保证分割线实时跟随
        transition: draggingWidth ? 'none' : `width ${DRAWER_TRANSITION}, opacity ${DRAWER_TRANSITION}`,
      };
  // 抽屉底色与画布主题色一致(征集 #92 拍板)。
  // 2026-08-31 用户拍板：PC 资产抽屉去掉 border-right，仅保留移动端同款阴影。
  const innerStyle: CSSProperties = (modal || overlay)
    ? {
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        position: 'relative',
        // 2026-08-31：全站统一画布背景色
        overflow: 'hidden', backgroundColor: theme.canvas.background,
        color: theme.toolbar.text,
        transform: translate3d,
        transition: `transform ${DRAWER_TRANSITION}, box-shadow ${DRAWER_TRANSITION}`,
        // 覆盖模式(移动端):仅柔和投影,不加边线(边线是 PC 端语义,2026-08-29 用户拍板)
        boxShadow: expanded ? '3px 0 16px rgba(0,0,0,0.35)' : 'none',
        willChange: 'transform',
      }
    : {
        width: panelWidth, height: '100%', display: 'flex', flexDirection: 'column',
        position: 'relative',
        // 2026-08-31：全站统一画布背景色
        overflow: 'hidden', backgroundColor: theme.canvas.background,
        color: theme.toolbar.text,
        transform: translate3d,
        transition: `transform ${DRAWER_TRANSITION}, box-shadow ${DRAWER_TRANSITION}`,
        // 2026-08-31 用户拍板：PC 资产抽屉去掉 border-right，仅保留移动端同款阴影
        boxShadow: expanded ? '3px 0 16px rgba(0,0,0,0.35)' : 'none',
        willChange: 'transform',
      };

  return (
    <div style={outerStyle}>
      <div style={innerStyle}>
        {/* 关闭按钮(2026-08-31 用户拍板:仅移动端抽屉(覆盖模式)显示;
            PC 端去掉——其开合由顶栏「资产库」开关控制;modal 模式由外部外壳提供关闭入口) */}
        {overlay && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('hierarchy.close')}
            title={t('hierarchy.close')}
            style={{
              position: 'absolute', top: 8, right: 8, zIndex: 20,
              width: 32, height: 32, border: 'none', background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: theme.toolbar.text,
              padding: 0, borderRadius: 6, transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              const isDark = theme.mode === 'dark';
              e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
            }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <X size={16} />
          </button>
        )}
        {/* 收起按钮(2026-08-31 用户拍板:PC 内联抽屉要「收起」入口,箭头而非叉号。
            此前 PC 端无任何收起控件——只能回顶栏「资产库」开关切换,用户在抽屉里收不回去) */}
        {!modal && !overlay && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('hierarchy.collapse', '收起')}
            title={t('hierarchy.collapse', '收起')}
            style={{
              position: 'absolute', top: 8, right: 8, zIndex: 20,
              width: 28, height: 28, border: 'none', background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: theme.toolbar.text,
              padding: 0, borderRadius: 6, transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              const isDark = theme.mode === 'dark';
              e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
            }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <EDITOR_ICONS.collapseLeft size={16} />
          </button>
        )}
        {/* 征集 #87 验收轮九/十:内嵌主页资产库同款页面;层级分组置顶且默认激活;
            层级分组 = 原树形列表(层级专属),其余分组 = 网格卡片 */}
        {contentReady ? (
          <CanvasAssetsPanel
            theme={theme}
            hierarchyListView={{
              store,
              data: props,
              onFocusNode,
            }}
            onSendToCanvas={onSendToCanvas as ((item: { type: 'asset' | 'prompt' | 'script'; id: string; data: any }) => void) | undefined}
          />
        ) : (
          // 过渡期间静态骨架(轻量)
          <div style={{ padding: 12 }}>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} style={{
                height: 120, marginBottom: 10, borderRadius: 12,
                background: 'rgba(128,128,128,0.08)',
              }} />
            ))}
          </div>
        )}
        {/* 右侧分割线拖拽（2026-08-31 用户拍板：PC 资产抽屉支持拖拽调宽） */}
        {!modal && !overlay && expanded && (
          <div
            onPointerDown={startDragWidth}
            title={t('hierarchy.resize', '拖拽调整宽度')}
            style={{
              position: 'absolute', top: 0, right: 0, bottom: 0, width: 5,
              cursor: 'col-resize', zIndex: 30, touchAction: 'none',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = (theme.toolbar.accent ?? '#3b82f6') + '88';
            }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          />
        )}
      </div>
    </div>
  );
}
