/**
 * NodeCreateMenu - 通用节点创建菜单
 *
 * 作为空白右键菜单、引用该节点生成菜单、加号菜单的基础UI框架组件。
 * 视觉与 Logo 下拉(antd Dropdown)对齐:亮/暗色背景、边框、圆角 8、boxShadowSecondary、
 * antd slide-up 动画曲线;分组分隔线为短虚线;菜单内滚动用原生捕获隔离,不穿透画布。
 *
 * 使用方式:
 * - 接收 position 在任意位置弹出
 * - onSelect 回调返回所选节点类型
 * - onClose 关闭菜单
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Type, Image as ImageIcon, FileText, Aperture, Film } from 'lucide-react';
import { CREATE_MENU_ICONS } from './icons.js';
import type { ThemeConfig } from '@zeroexo/shared';

/** 节点类型（2026-08-30：production-manager 剧管已合并进分镜节点，创建菜单移除） */
export type AddNodeType = 'text' | 'image' | 'video' | 'audio' | 'generator' | 'stacked-media' | 'script' | 'storyboard' | 'workbench';

export interface NodeCreateMenuProps {
  /** 菜单位置(固定定位) */
  position: { x: number; y: number };
  /** 选中节点类型回调 */
  onSelect: (type: AddNodeType) => void;
  /** 关闭菜单回调 */
  onClose: () => void;
  /** 主题 */
  theme: ThemeConfig;
  /** 可选:菜单标题,默认使用 t('toolbar.createNode') */
  title?: string;
  /** 可选:菜单宽度,默认 200 */
  width?: number;
  /**
   * 可选:菜单顶部额外项(画布级操作,如重置视图/粘贴),渲染在节点分类前 + 分隔线。
   * 空白右键菜单与加号菜单共用本组件,通过此 prop 注入场景专属操作。
   */
  extraItems?: Array<{ key: string; label: string; icon?: React.ReactNode; onClick: () => void }>;
  /** 显式向上弹出(触发器在屏幕底部时,如底部工具栏;征集 #87 验收轮:侧边栏统一底部布局后 PC 也需向上弹) */
  alignUp?: boolean;
}

/** 节点类型定义 */
interface NodeTypeDef {
  type: AddNodeType;
  icon: React.ReactNode;
  labelKey: string;
  category: 'generate' | 'media' | 'creation';
}

/** 分类顺序（用于分割线分组，不显示标题） */
const CATEGORY_ORDER: Array<'generate' | 'media' | 'creation'> = ['generate', 'media', 'creation'];

function createNodeTypeDefs(_t: (key: string) => string): NodeTypeDef[] {
  return [
    // [DEPRECATED] 生成器节点已废弃(画布冗余,2026-08-22 tA5):
    // 生成语义由「空 media 节点三态」承担(NodeGenerateDock 吸附面板),不再提供创建入口。
    // 旧项目数据中的 generator 节点仍可渲染(generator-node-view 保留兼容),仅禁止新建。
    { type: 'stacked-media', icon: <CREATE_MENU_ICONS.stack size={14} />, labelKey: 'toolbar.stackedMedia', category: 'generate' },
    { type: 'text', icon: <Type size={14} />, labelKey: 'toolbar.text', category: 'media' },
    { type: 'image', icon: <ImageIcon size={14} />, labelKey: 'toolbar.image', category: 'media' },
    { type: 'video', icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 7.75a.75.75 0 0 1 1.142-.638l3.664 2.249a.75.75 0 0 1 0 1.278l-3.664 2.25a.75.75 0 0 1-1.142-.64z"/><path d="M7 21h10"/><rect width="20" height="14" x="2" y="3" rx="2"/></svg>, labelKey: 'toolbar.video', category: 'media' },
    { type: 'audio', icon: <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>, labelKey: 'toolbar.audio', category: 'media' },
    { type: 'script', icon: <FileText size={14} />, labelKey: 'canvasNodes.stage.script', category: 'creation' },
    { type: 'storyboard', icon: <Aperture size={14} />, labelKey: 'canvasNodes.stage.storyboard', category: 'creation' },
    { type: 'workbench', icon: <Film size={14} />, labelKey: 'canvasNodes.stage.workbench', category: 'creation' },
  ];
}

export function NodeCreateMenu({
  position,
  onSelect,
  onClose,
  theme,
  width = 200,
  extraItems,
  alignUp,
}: NodeCreateMenuProps): React.ReactElement {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nodeTypes = createNodeTypeDefs(t);
  const [visible, setVisible] = useState(false);
  const [menuHeight, setMenuHeight] = useState(0);

  // 菜单内滚动隔离:原生捕获阶段拦截 wheel(React 合成 onWheel 在 root 派发,
  // 晚于画布元素上的原生监听,无法拦截);配合 overscroll-behavior:contain 防滚动链。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const stopWheel = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stopWheel, { capture: true, passive: true });
    return () => el.removeEventListener('wheel', stopWheel, { capture: true } as EventListenerOptions);
  }, []);

  // 检测移动端(菜单向上弹出);alignUp 显式指定时优先(底部工具栏场景,征集 #87 验收轮)
  const isMobile = alignUp ?? (typeof window !== 'undefined' && window.innerWidth <= 768);

  // 弹出动画:useLayoutEffect + 双 rAF 触发入场,生产模式更流畅
  useLayoutEffect(() => {
    let raf2: number;
    const raf1 = requestAnimationFrame(() => {
      if (menuRef.current) setMenuHeight(menuRef.current.offsetHeight);
      raf2 = requestAnimationFrame(() => setVisible(true));
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, []);

  // 点击外部关闭
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointer, true);
    return () => document.removeEventListener('pointerdown', onPointer, true);
  }, [onClose]);

  // Escape 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isDark = theme.mode === 'dark';
  const hoverBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)';
  // 与 AntdThemeProvider 映射一致:亮色下拉=#fff/#e7e5e4,暗色=toolbar.panel/border
  const panelBg = isDark ? theme.toolbar.panel : '#ffffff';
  const panelBorder = isDark ? theme.toolbar.border : '#e7e5e4';
  // antd Dropdown slide-up 动画曲线(平滑缓出,非弹性回弹)
  const motion = 'opacity 0.2s cubic-bezier(0.08, 0.82, 0.17, 1), transform 0.2s cubic-bezier(0.08, 0.82, 0.17, 1)';
  // 分组分隔线:短虚线(与右键菜单 ContextMenu 一致)
  const dividerStyle: React.CSSProperties = {
    height: 0,
    border: 'none',
    borderTop: `1px dashed ${theme.toolbar.border}`,
    margin: '4px 8px',
  };

  // 移动端:菜单向上弹出,transformOrigin 改为 bottom center
  const menuLeft = isMobile ? position.x : position.x;
  const menuTop = isMobile ? Math.max(8, position.y - menuHeight) : position.y;
  const transformOrigin = isMobile ? 'bottom center' : 'top center';

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: menuLeft,
        top: menuTop,
        zIndex: 1000,
        minWidth: width,
        maxWidth: width + 60,
        background: panelBg,
        border: `1px solid ${panelBorder}`,
        borderRadius: 8,
        boxShadow: '0 6px 16px 0 rgba(0,0,0,0.08), 0 3px 6px -4px rgba(0,0,0,0.12), 0 9px 28px 8px rgba(0,0,0,0.05)',
        padding: '4px 0',
        display: 'flex',
        flexDirection: 'column',
        color: theme.toolbar.text,
        transform: visible ? 'scaleY(1)' : 'scaleY(0.8)',
        opacity: visible ? 1 : 0,
        transformOrigin,
        transition: motion,
      }}
    >
      <div ref={scrollRef} style={{ overflowY: 'auto', flex: 1, maxHeight: 320, overscrollBehavior: 'contain' }}>
        {/* 画布级额外操作(重置视图/粘贴等):渲染在节点分类前 + 分隔线 */}
        {extraItems && extraItems.length > 0 ? (
          <div>
            {extraItems.map((item) => (
              <button
                key={item.key}
                type="button"
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '5px 12px', border: 'none', borderRadius: 0,
                  background: 'transparent',
                  color: theme.toolbar.text, fontSize: 13, textAlign: 'left',
                  cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.12s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                onClick={() => { item.onClick(); onClose(); }}
              >
                {item.icon ? (
                  <span style={{ width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {item.icon}
                  </span>
                ) : null}
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.label}
                </span>
              </button>
            ))}
            <div style={dividerStyle} />
          </div>
        ) : null}
        {CATEGORY_ORDER.map((cat, catIdx) => {
          const groupDefs = nodeTypes.filter((d) => d.category === cat);
          if (groupDefs.length === 0) return null;
          return (
            <div key={cat}>
              {catIdx > 0 && <div style={dividerStyle} />}
              {groupDefs.map((def) => (
                <button
                  key={def.type}
                  type="button"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                    padding: '5px 12px', border: 'none', borderRadius: 0,
                    background: 'transparent',
                    color: theme.toolbar.text, fontSize: 13, textAlign: 'left',
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.12s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  onClick={() => { onSelect(def.type); onClose(); }}
                >
                  <span style={{ width: 14, height: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {def.icon}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t(def.labelKey)}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}