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

import { useState, useLayoutEffect, useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useHierarchyPanelProps } from '@zeroexo/plugin-group';
import type { GroupPlugin } from '@zeroexo/plugin-group';
import type { ThemeConfig } from '@zeroexo/shared';
import { AssetLibraryPage } from '@/features/asset-library/asset-library-page.js';
import type { HierarchyLibraryItem } from '@/features/asset-library/types.js';

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
const PANEL_WIDTH = 450;
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

  // 征集 #87 验收轮九:画布节点 → 层级分组条目(平铺;含媒体节点封面所需的 storageKey/content)
  const hierarchyItems = useMemo<HierarchyLibraryItem[]>(() => props.tree.map((item) => {
    const n = item.node;
    const full = store.getNode(n.id);
    const d = full?.data as Record<string, unknown> | undefined;
    const title = n.title?.trim()
      || t(`nodeTypes.${n.type.replace('ai.', '')}`, { defaultValue: n.type });
    return {
      id: n.id,
      title,
      nodeType: n.type,
      storageKey: typeof d?.storageKey === 'string' ? d.storageKey : undefined,
      content: typeof d?.content === 'string' ? d.content : undefined,
    };
  }), [props.tree, store, t]);

  const width = closing ? 0 : expanded ? PANEL_WIDTH : 0;
  const opacity = closing ? 0 : expanded ? 1 : 0;
  // translate3d 触发 GPU 合成层,生产环境动画更流畅
  const translate3d = closing ? `translate3d(${-PANEL_WIDTH}px, 0, 0)` : expanded ? 'translate3d(0, 0, 0)' : `translate3d(${-PANEL_WIDTH}px, 0, 0)`;

  // 抽屉式动画:展开收起统一节奏。
  // 外层不加 will-change:width 非合成属性,无效提示反而诱发多余分层(征集 #85/Plan#48-T6 教训)。
  const outerStyle: CSSProperties = overlay
    ? {
        // 征集 #95:覆盖模式——绝对定位于画布左缘之上(不占布局、不推开内容),移动端与 PC 同款组件
        position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 60,
        width: PANEL_WIDTH, maxWidth: '92vw',
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
        transition: `width ${DRAWER_TRANSITION}, opacity ${DRAWER_TRANSITION}`,
      };
  // 抽屉底色与画布主题色一致(征集 #92 拍板)→ 必须靠边缘与画布区分。
  // 2026-08-29 用户反馈「PC 上根本看不到阴影」：抽屉推开画布后紧贴画布，
  // box-shadow 是画在元素外部的投影，右侧投影全部落进不透明画布区域，被盖住。
  // 故 PC 端改用 border-right（边框绘制在元素内部，永远可见）。
  const drawerBorder = theme.mode === 'dark'
    ? 'rgba(255,255,255,0.12)'
    : 'rgba(0,0,0,0.16)';
  const innerStyle: CSSProperties = (modal || overlay)
    ? {
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden', backgroundColor: theme.canvas.background,
        color: theme.toolbar.text,
        transform: translate3d,
        transition: `transform ${DRAWER_TRANSITION}, box-shadow ${DRAWER_TRANSITION}`,
        // 覆盖模式(移动端):仅柔和投影,不加边线(边线是 PC 端语义,2026-08-29 用户拍板)
        boxShadow: expanded ? '3px 0 16px rgba(0,0,0,0.35)' : 'none',
        willChange: 'transform',
      }
    : {
        width: PANEL_WIDTH, height: '100%', display: 'flex', flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden', backgroundColor: theme.canvas.background,
        color: theme.toolbar.text,
        transform: translate3d,
        transition: `transform ${DRAWER_TRANSITION}`,
        // PC 端:右边框与画布区分(内部边框不受画布遮挡),暗色用亮边、亮色用暗边
        borderRight: expanded ? `1px solid ${drawerBorder}` : 'none',
        willChange: 'transform',
      };

  return (
    <div style={outerStyle}>
      <div style={innerStyle}>
        {/* 关闭按钮(桌面端/覆盖模式悬浮右上角;modal 模式由外部外壳提供关闭入口) */}
        {(!modal || overlay) && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t('hierarchy.close')}
            title={t('hierarchy.close')}
            style={{
              position: 'absolute', top: 8, right: 8, zIndex: 20,
              width: 24, height: 24, border: 'none', background: 'transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: theme.toolbar.text, opacity: 0.5,
              padding: 0, borderRadius: 4, transition: 'opacity 0.15s, background 0.15s',
            }}
          >
            <X size={14} />
          </button>
        )}
        {/* 征集 #87 验收轮九/十:内嵌主页资产库同款页面;层级分组置顶且默认激活;
            层级分组 = 原树形列表(层级专属),其余分组 = 网格卡片 */}
        {contentReady ? (
          <AssetLibraryPage
            forceMobile
            gridColumns={2}
            embeddedInCanvas
            defaultGroup="hierarchy"
            hierarchyItems={hierarchyItems}
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
      </div>
    </div>
  );
}
