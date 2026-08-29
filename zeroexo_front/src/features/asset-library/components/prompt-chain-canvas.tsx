/**
 * PromptChainCanvas - 提示词录入专用只读画布（Plan#47 T3，征集 #79 / #87 优化）
 *
 * 把提示词的「输入 → 输出」忠实还原为仿主画布节点链：
 *   参考图列（仅图生图）→ 提示词节点 → 生成图列
 *
 * 契约（用户拍板）：
 * - 节点不可移动（无拖拽处理器），视口可缩放 + 平移（复用 useImagePanZoom，
 *   内容容器直接挂 panZoom.imgRef —— 它只是 transform 目标元素）
 * - 右下角竖排 ZoomToolbar 沿用图片查看器同款
 * - 图片走三档契约（征集 #77）：usePreviewImage 自适应档，不拉原图
 * - 只读可视化：数据录入仍走 PromptCreatePage 既有上传区
 *
 * 征集 #87 优化（本轮）：
 * - 不再支持详情查看（节点可放大）→ 图片节点去掉详情按钮，改双击聚焦
 * - 双击节点聚焦：复用 useImagePanZoom.focusOnWorldRect，缩放基准对齐主画布（占视口约 82%）
 * - 图片节点去边框，标题改为图片顶部渐变条标签（提示词文本节点仍保留边框）
 * - 提示词节点新增复制按钮（仅复制正文）
 * - 标签从侧边表单迁入画布左上角（紧邻文生图徽章），编辑态可增删
 *
 * 征集 #89 优化：
 * - 调用方 Modal 右侧详情面板整体移除，画布占满全宽
 * - 提示词节点编辑态正文 textarea 直编（editable/onContentChange，事件隔离防画布平移）
 *
 * 征集 #90 优化（本轮）：
 * - 图片录入画布化：编辑态 hover 提示词节点，左右显现 Pin（对齐主画布 pin-view 契约：
 *   14px 圆环 + 2px 边框 + 内嵌十字 + 外发光 + 主题色）；左 Pin=添加输入图 / 右 Pin=添加输出图，
 *   点击触发文件选择（上传由调用方接管；本画布无连线目标端，拖拽连线语义不成立）
 * - 图片节点右上角编辑态常显按钮组：设封面 / 输入输出切换 / 删除（封面节点隐藏前两者；
 *   role 变更后调用方数据驱动，节点自动移列）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Image as ImageIcon, ImagePlus, Star, Copy, ChevronDown, ChevronUp, X, ArrowLeft, ArrowRight } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { usePreviewImage } from '@zeroexo/plugin-nodes';
import { useImagePanZoom, ZoomToolbar } from '@/shared/components/image-viewer.js';

// ===== 世界布局常量（节点不可移动 → 布局完全确定，连线纯计算） =====
const CARD_W = 240;
const IMG_NODE_H = 200;
const PROMPT_W = 280;
const PROMPT_H = 200;
/** 收起态高度(标题栏 + 单行摘要):默认收起不挡视线,点击展开(用户验收反馈) */
const PROMPT_COLLAPSED_H = 62;
const COL_GAP = 140;
const ROW_GAP = 36;
/** 三列各自垂直居中的基准线 */
const CENTER_Y = 320;
const REFS_X = 0;
const PROMPT_X = CARD_W + COL_GAP;
const OUTS_X = PROMPT_X + PROMPT_W + COL_GAP;
const WORLD_W = OUTS_X + CARD_W;
/** 世界高度按最大列估算（占位节点也占一格） */
const WORLD_H = CENTER_Y * 2;
/** 双击聚焦缩放基准：对齐主画布 computeFocusTarget 默认 paddingRatio（节点占视口约 82%） */
const FOCUS_PADDING = 0.82;

export interface PromptChainImage {
  storageKey: string;
  role: string;
  /** 封面标记(独立布尔,2026-08-29:不改角色,仅星标填充) */
  isCover?: boolean;
  title?: string;
}

export interface PromptChainCanvasProps {
  /** 提示词文本 */
  content: string;
  /** 生成模式（存量默认文生图）：布局恒按图生图式展示（征集 #78 验收拍板），仅影响模式徽章 */
  mode: 'txt2img' | 'img2img';
  /** 关联图片（含 role：reference 输入 / output 输出 / cover 封面归入输出列） */
  images: PromptChainImage[];
  /** 本地预览 URL（上传后即时显示优先） */
  localPreviews?: Record<string, string>;
  /** 标签列表（征集 #87：从侧边表单迁入画布左上角展示/编辑） */
  tags?: string[];
  /** 复制提示词正文（征集 #87：提示词节点复制按钮，仅正文） */
  onCopyPrompt?: () => void;
  /** 编辑态：提示词节点展开后正文可直接编辑（征集 #89：右侧详情面板移除，内容编辑迁入画布） */
  editable?: boolean;
  /** 编辑回调：正文变更（调用方按当前语言路由到 zh/en/ja 字段） */
  onContentChange?: (value: string) => void;
  /** 正文最大长度（与录入表单 MAX_CONTENT_LENGTH 同源） */
  contentMaxLength?: number;
  /** 编辑态：点击左右 Pin 追加图片（征集 #90；left=输入图 / right=输出图，调用方触发文件选择） */
  onAddImage?: (role: 'reference' | 'output') => void;
  /** 编辑态：设为封面（封面自动归入输出列带星标） */
  onSetCover?: (storageKey: string) => void;
  /** 编辑态：输入 ↔ 输出 互换（节点自动移列） */
  onToggleImageRole?: (storageKey: string) => void;
  /** 编辑态：移除图片 */
  onRemoveImage?: (storageKey: string) => void;
  /**
   * 编辑态控件（标题/分类/备注）以浮层形式嵌入画布底部（2026-08-29）。
   * 不占布局高度 —— 浏览器高度变化时画布独占全部空间并自适应缩放，
   * 编辑条不再挤压画布、也不会被容器裁剪。事件已隔离，不会触发画布平移。
   */
  editOverlay?: ReactNode;
  style?: CSSProperties;
}

/** 列内垂直居中排布的 y 序列 */
function columnYs(count: number, nodeH: number): number[] {
  if (count <= 0) return [];
  const total = count * nodeH + (count - 1) * ROW_GAP;
  const start = CENTER_Y - total / 2;
  return Array.from({ length: count }, (_, i) => start + i * (nodeH + ROW_GAP));
}

/** 仿主画布连线：源右边缘中点 → 目标左边缘中点（三次贝塞尔） */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/**
 * 图片节点卡（征集 #87 / #90）：
 * - 去边框，图片占满整个节点；标题改为顶部渐变条标签（白色文字，跨主题可读）
 * - 三档契约自适应档；双击聚焦（不再提供详情按钮，节点可放大查看）
 * - 编辑态右上角常显操作钮组：设封面 / 输入输出切换 / 删除（封面节点隐藏前两者，与原胶片条逻辑一致）
 */
function ChainImageCard({ storageKey, label, isDark, x, y, localPreview, isCover, columnRole, editable, onSetCover, onToggleRole, onRemove, onFocus }: {
  storageKey: string; label: string; isDark: boolean; x: number; y: number; localPreview?: string;
  isCover?: boolean; columnRole: 'reference' | 'output'; editable?: boolean;
  onSetCover?: () => void; onToggleRole?: () => void; onRemove?: () => void; onFocus?: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const src = usePreviewImage(storageKey, localPreview ?? '');
  const actionBtnStyle: CSSProperties = {
    width: 18, height: 18, borderRadius: 5, border: 'none', cursor: 'pointer', padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(0,0,0,0.66)', color: '#ffffff', backdropFilter: 'blur(4px)',
  };
  return (
    <div
      onDoubleClick={(e) => { e.stopPropagation(); onFocus?.(); }}
      title={label}
      style={{
        position: 'absolute', left: x, top: y, width: CARD_W, height: IMG_NODE_H,
        borderRadius: 10, overflow: 'hidden', cursor: 'zoom-in',
        background: isDark ? '#161616' : '#ffffff',
        boxShadow: isDark ? '0 8px 24px rgba(0,0,0,0.45)' : '0 8px 20px rgba(28,25,23,0.12)',
        pointerEvents: 'auto',
      }}
    >
      {/* 图片铺满节点（三档契约自适应档） */}
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)' }}>
        {src ? (
          <img src={src} alt={label} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        ) : (
          <ImageIcon size={22} color={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(15,23,42,0.25)'} />
        )}
      </div>
      {/* 顶部渐变条标签（征集 #87：标题内置到画布节点，替代原独立标题栏） */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.28) 62%, rgba(0,0,0,0) 100%)',
        color: '#ffffff', fontSize: 11, fontWeight: 600, pointerEvents: 'none',
      }}>
        <ImageIcon size={12} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{label}</span>
        {isCover && <Star size={11} fill="currentColor" style={{ flexShrink: 0 }} />}
      </div>
      {/* 右上角操作钮组（征集 #90：编辑态固定常显；事件全隔离防触发画布平移/节点聚焦）
          2026-08-29 修正:封面节点按钮与其他节点一致(设封面/切角色/删除都显示),
          封面仅是星标填充(isCover),不隐藏任何按钮 */}
      {editable && (
        <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 3, zIndex: 2 }}>
          {onSetCover && (
            <button
              type="button"
              title={isCover ? t('promptCreate.setCover', '设为封面') : t('promptCreate.setCover', '设为封面')}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onSetCover(); }}
              style={{ ...actionBtnStyle, color: isCover ? '#ffd166' : '#ffffff' }}
            >
              <Star size={10} fill={isCover ? 'currentColor' : 'none'} />
            </button>
          )}
          {onToggleRole && (
            <button
              type="button"
              title={columnRole === 'reference' ? t('promptCreate.markOutput', '标记为输出（生成图）') : t('promptCreate.markInput', '标记为输入（参考图）')}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onToggleRole(); }}
              style={actionBtnStyle}
            >
              {columnRole === 'reference' ? <ArrowRight size={10} /> : <ArrowLeft size={10} />}
            </button>
          )}
          {onRemove && (
            <button
              type="button"
              title={t('promptCreate.remove', '移除')}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              style={{ ...actionBtnStyle, color: '#ff7b7b' }}
            >
              <X size={10} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// 2026-08-29：链路 Pin（ChainPin）已移除 —— 加图入口改为列末尾显式的「添加xx图」卡片，
// Pin 太隐蔽，用户普遍不知道可以点击加图。

/**
 * 占位 / 添加节点（2026-08-29 改造）
 * - 查看态：虚线灰卡，文案「暂无参考图 / 暂未录入生成图」，不可交互（忠实呈现链路缺口）
 * - 编辑态：可点击的「添加参考图 / 添加生成图」，点击即录入素材并追加到列末尾，
 *   占位格随之后移，用户可连续点击继续追加 —— 很多用户不知道旧版 Pin 能加图，
 *   改为显式的「添加」卡片后入口不再隐藏。
 */
function PlaceholderCard({ label, isDark, x, y, clickable, onClick }: {
  label: string; isDark: boolean; x: number; y: number;
  clickable?: boolean; onClick?: () => void;
}): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const active = clickable && hovered;
  return (
    <div
      onMouseEnter={() => { if (clickable) setHovered(true); }}
      onMouseLeave={() => { if (clickable) setHovered(false); }}
      onClick={(e) => { if (!clickable) return; e.stopPropagation(); onClick?.(); }}
      style={{
        position: 'absolute', left: x, top: y, width: CARD_W, height: IMG_NODE_H,
        borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
        border: `1.5px dashed ${active
          ? (isDark ? 'rgba(255,255,255,0.55)' : 'rgba(28,25,23,0.55)')
          : (isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)')}`,
        background: active ? (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)') : 'transparent',
        color: active
          ? (isDark ? 'rgba(255,255,255,0.85)' : 'rgba(28,25,23,0.8)')
          : (isDark ? 'rgba(255,255,255,0.35)' : 'rgba(28,25,23,0.35)'),
        fontSize: 11,
        pointerEvents: clickable ? 'auto' : 'none',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'all 0.15s',
      }}
    >
      <ImagePlus size={20} strokeWidth={1.5} />
      <span>{label}</span>
    </div>
  );
}

/**
 * 标签徽章组件（征集 #87 / 2026-08-29 改造）
 * 对外导出：编辑浮层用它做标签编辑，画布左上角用它做纯展示（readOnly）。
 */
export function TagsOverlay({ tags, readOnly, isDark, onAddTag, onRemoveTag }: {
  tags: string[]; readOnly: boolean; isDark: boolean;
  onAddTag?: (tag: string) => void; onRemoveTag?: (tag: string) => void;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  if (readOnly && tags.length === 0) return null;
  const chipStyle: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 3,
    padding: '2px 8px', borderRadius: 9999, fontSize: 10.5, fontWeight: 500,
    background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
    color: isDark ? 'rgba(255,255,255,0.78)' : 'rgba(28,25,23,0.72)',
    backdropFilter: 'blur(6px)',
  };
  const commit = () => {
    const v = draft.trim();
    if (v && onAddTag) onAddTag(v);
    setDraft('');
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, pointerEvents: 'none' }}>
      {tags.map((tag) => (
        <span key={tag} style={{ ...chipStyle, pointerEvents: 'auto' }}>
          {tag}
          {!readOnly && onRemoveTag && (
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onRemoveTag(tag); }}
              style={{ display: 'inline-flex', alignItems: 'center', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0, opacity: 0.7 }}
              title={t('promptCreate.remove')}
            >
              <X size={9} />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } }}
          onBlur={commit}
          placeholder={t('promptChain.addTag', '+ 标签')}
          style={{
            ...chipStyle, pointerEvents: 'auto', border: 'none', outline: 'none',
            // 标签区占比提升后，输入框同步加宽，便于输入较长标签
            width: 88, color: isDark ? 'rgba(255,255,255,0.78)' : 'rgba(28,25,23,0.72)',
          }}
        />
      )}
    </div>
  );
}

// 2026-08-29：标签编辑入口下沉到画布底部编辑浮层（editOverlay），
// 画布左上角标签改为纯展示，故 readOnly / onAddTag / onRemoveTag 不再需要。
export function PromptChainCanvas({ content, images, localPreviews, tags, onCopyPrompt, editable = false, onContentChange, contentMaxLength, onAddImage, onSetCover, onToggleImageRole, onRemoveImage, editOverlay, style }: PromptChainCanvasProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  // 征集 #78 验收拍板:无论缩小还是放大,视口都支持拖拽平移(节点本身锁定不可动)
  const panZoom = useImagePanZoom({ panAlways: true });
  const containerElRef = useRef<HTMLDivElement | null>(null);
  const editOverlayRef = useRef<HTMLDivElement | null>(null);

  // 布局恒按图生图式展示(征集 #78 验收拍板):参考图列始终在位,无图时占位提示;
  // mode 字段仅影响徽章文案(存量/公共提示词默认文生图)
  // 2026-08-29 模型修正:封面是独立 isCover 标记,不改变角色——参考/生成列只按 role 过滤,
  // 封面图留在原列带星标(不再因设封面而跳到输出列)
  const references = useMemo(() => images.filter((i) => i.role === 'reference'), [images]);
  const outputs = useMemo(() => images.filter((i) => i.role === 'output'), [images]);

  // 列排布（2026-08-29 改造）：
  // - 查看态：空列放一个占位格（忠实呈现链路缺口）
  // - 编辑态：列末尾恒留一个「添加」格（可点击连续追加素材），有图时也保留
  const refCount = editable ? references.length + 1 : Math.max(references.length, 1);
  const outCount = editable ? outputs.length + 1 : Math.max(outputs.length, 1);
  const refYs = columnYs(refCount, IMG_NODE_H);
  const outYs = columnYs(outCount, IMG_NODE_H);
  // 提示词节点默认收起(用户验收反馈:展开的大文本块碍眼),点击卡片展开/点标题栏收起;
  // 连线锚点恒为 CENTER_Y,收起/展开不改变链路几何(仅卡片自身垂直居中)
  const [promptExpanded, setPromptExpanded] = useState(false);
  const promptH = promptExpanded ? PROMPT_H : PROMPT_COLLAPSED_H;
  const promptY = CENTER_Y - promptH / 2;
  const promptText = content.trim();

  // 连线（纯几何计算，节点位置恒定）
  // 2026-08-29 修复「无参考图时链路断开」：原实现按 references 实际条数遍历，
  // 空列时一条线都不画 → 占位节点与提示词节点之间没有连线。
  // 改为按列槽位（含占位/添加格）遍历，保证占位节点同样接入链路。
  const edges = useMemo(() => {
    const list: Array<{ d: string; key: string }> = [];
    for (let i = 0; i < refCount; i++) {
      const y = refYs[i];
      if (y === undefined) continue;
      list.push({ key: `ref-${i}`, d: edgePath(REFS_X + CARD_W, y + IMG_NODE_H / 2, PROMPT_X, CENTER_Y) });
    }
    for (let i = 0; i < outCount; i++) {
      const y = outYs[i];
      if (y === undefined) continue;
      list.push({ key: `out-${i}`, d: edgePath(PROMPT_X + PROMPT_W, CENTER_Y, OUTS_X, y + IMG_NODE_H / 2) });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refCount, outCount]);

  const hasEditOverlay = !!editOverlay;

  // 适配容器：内容超容器时按 0.25 步进缩到放得下（复用工具条同款缩放通道）
  // 2026-08-29 修复「改变高度后编辑模式内容看不到」：原实现仅在挂载时执行一次，
  // 容器尺寸变化(窗口 resize/modal 高度调整)后缩放与偏移不再匹配新视口，内容被挤出画布。
  // 改为通过 ResizeObserver 监听容器尺寸，变化即先复位再重新适配居中。
  // 编辑态额外为底部浮层预留高度，避免链路节点被浮层遮挡。
  const fitToContainer = useCallback(() => {
    const el = containerElRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (cw <= 0 || ch <= 0) return;
    panZoom.reset();
    const bottomInset = hasEditOverlay ? 56 : 0;
    const needed = Math.min((cw - 48) / WORLD_W, (ch - 48 - bottomInset) / WORLD_H);
    if (needed >= 1) return;
    const target = Math.max(needed, 0.25);
    const steps = Math.min(Math.ceil((1 - target) / 0.25), 4);
    for (let i = 0; i < steps; i++) panZoom.zoomOut();
    // 缩放后重新居中：世界层在容器 flex 居中，缩放原点为中心，无需额外偏移
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasEditOverlay]);

  useEffect(() => {
    const el = containerElRef.current;
    if (!el) return;
    fitToContainer();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => fitToContainer());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToContainer]);

  // 编辑浮层内的滚轮必须拦在原生阶段：画布的 wheel 监听是容器上的原生监听，
  // React 合成事件 stopPropagation 拦不住它，会导致在备注/标题上滚动时误缩放画布。
  useEffect(() => {
    if (!hasEditOverlay) return;
    const el = editOverlayRef.current;
    if (!el) return;
    const stopWheel = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', stopWheel);
    return () => el.removeEventListener('wheel', stopWheel);
  }, [hasEditOverlay]);

  // 2026-08-29:模式徽章(文生图/图生图)已移除,仅保留标签
  return (
    <div
      ref={(el) => {
        containerElRef.current = el;
        panZoom.containerRef(el);
      }}
      {...panZoom.containerHandlers}
      style={{
        position: 'relative', width: '100%', height: '100%', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: isDark ? '#0d0d0d' : '#f5f5f4',
        touchAction: 'none', userSelect: 'none',
        ...style,
      }}
    >
      {/* ===== 世界层：缩放/平移目标（挂 panZoom.imgRef；节点无拖拽 → 不可移动） ===== */}
      <div
        ref={panZoom.imgRef as unknown as React.Ref<HTMLDivElement>}
        style={{ position: 'relative', width: WORLD_W, height: WORLD_H, flexShrink: 0, pointerEvents: 'none', ...panZoom.imgTransformStyle, transition: 'none' }}
      >
        {/* 连线层 */}
        <svg width={WORLD_W} height={WORLD_H} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          {edges.map((e) => (
            <path key={e.key} d={e.d} fill="none" strokeWidth={1.5}
              stroke={isDark ? 'rgba(255,255,255,0.28)' : 'rgba(28,25,23,0.30)'} />
          ))}
        </svg>

        {/* 参考图列：真实图在前，末尾追加「添加参考图」格（编辑态可点击连续追加） */}
        {references.map((img, i) => (
          <ChainImageCard key={img.storageKey + i} storageKey={img.storageKey}
            label={`${t('promptChain.reference', '参考图')} ${i + 1}`}
            isDark={isDark} x={REFS_X} y={refYs[i] ?? 0} localPreview={localPreviews?.[img.storageKey]}
            isCover={!!img.isCover}
            columnRole="reference"
            editable={editable}
            onSetCover={onSetCover ? () => onSetCover(img.storageKey) : undefined}
            onToggleRole={onToggleImageRole ? () => onToggleImageRole(img.storageKey) : undefined}
            onRemove={onRemoveImage ? () => onRemoveImage(img.storageKey) : undefined}
            onFocus={() => panZoom.focusOnWorldRect({ x: REFS_X, y: refYs[i] ?? 0, width: CARD_W, height: IMG_NODE_H }, FOCUS_PADDING)} />
        ))}
        {Array.from({ length: refCount - references.length }, (_, k) => {
          const idx = references.length + k;
          const y = refYs[idx];
          if (y === undefined) return null;
          return (
            <PlaceholderCard
              key={`ref-add-${idx}`}
              label={editable ? t('promptChain.addReference', '添加参考图') : t('promptChain.noReference', '暂无参考图')}
              isDark={isDark}
              x={REFS_X}
              y={y}
              clickable={editable && !!onAddImage}
              onClick={editable && onAddImage ? () => onAddImage('reference') : undefined}
            />
          );
        })}

        {/* 提示词节点（仿文本节点卡；保留边框；默认收起小卡,点击展开；新增复制按钮 + 双击聚焦） */}
        {/* 2026-08-29：原 hover 包装层是为「Pin 同组防闪失」服务的，Pin 移除后不再需要 hover 状态 */}
        <div
          style={{ position: 'absolute', left: PROMPT_X, top: promptY, width: PROMPT_W, height: promptH, pointerEvents: 'none' }}
        >
        <div
          onDoubleClick={(e) => { e.stopPropagation(); setPromptExpanded(true); panZoom.focusOnWorldRect({ x: PROMPT_X, y: promptY, width: PROMPT_W, height: promptH }, FOCUS_PADDING); }}
          style={{
            position: 'absolute', inset: 0,
            borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column',
            background: isDark ? '#161616' : '#ffffff',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'}`,
            boxShadow: isDark ? '0 8px 24px rgba(0,0,0,0.45)' : '0 8px 20px rgba(28,25,23,0.12)',
            cursor: promptExpanded ? 'default' : 'zoom-in',
            pointerEvents: promptExpanded ? 'none' : 'auto',
            transition: 'height 0.18s ease-out',
          }}
          onClick={() => { if (!promptExpanded) setPromptExpanded(true); }}
        >
          {/* 标题栏:展开态点击收起;收起态随整卡点击展开；右侧复制按钮 */}
          <div
            onClick={(e) => { if (promptExpanded) { e.stopPropagation(); setPromptExpanded(false); } }}
            style={{
              height: 30, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', flexShrink: 0,
              fontSize: 11, fontWeight: 600,
              color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(28,25,23,0.75)',
              borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
              cursor: promptExpanded ? 'pointer' : 'inherit', pointerEvents: promptExpanded ? 'auto' : 'inherit',
            }}>
            <FileText size={12} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t('promptChain.promptNode', '提示词')}{promptText ? ` · ${promptText.length} 字` : ''}
            </span>
            {/* 复制提示词正文（征集 #87） */}
            {onCopyPrompt && (
              <button
                type="button"
                title={t('subjectCreate.copyPrompt', '复制提示词')}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onCopyPrompt(); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 20, height: 20, borderRadius: 6, border: 'none', cursor: 'pointer', pointerEvents: 'auto',
                  background: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                  color: isDark ? 'rgba(255,255,255,0.8)' : 'rgba(28,25,23,0.7)',
                }}
              >
                <Copy size={12} />
              </button>
            )}
            {promptExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </div>
          {promptExpanded ? (
            editable && onContentChange ? (
              /* 编辑态（征集 #89）：正文 textarea 直编；pointer/wheel 全隔离防触发画布平移/缩放（参照 node-editable-drag-intercept 契约） */
              <textarea
                value={promptText}
                onChange={(e) => onContentChange(e.target.value)}
                maxLength={contentMaxLength}
                placeholder={t('promptCreate.contentPlaceholder', '请输入提示词内容')}
                spellCheck={false}
                autoFocus
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onWheel={(e) => e.stopPropagation()}
                style={{
                  flex: 1, minHeight: 0, margin: 0, padding: '10px 12px',
                  background: 'transparent', border: 'none', outline: 'none', resize: 'none',
                  fontFamily: 'inherit', fontSize: 11.5, lineHeight: 1.6,
                  color: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(28,25,23,0.68)',
                  overflowY: 'auto', overscrollBehavior: 'contain',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  pointerEvents: 'auto',
                }}
              />
            ) : (
              <div style={{
                flex: 1, minHeight: 0, padding: '10px 12px', fontSize: 11.5, lineHeight: 1.6,
                color: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(28,25,23,0.68)',
                // 征集 #78 验收:长提示词支持滚动查看(去掉行数截断);滚轮优先滚动文本不干扰画布缩放
                overflowY: 'auto', pointerEvents: 'auto', overscrollBehavior: 'contain',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {promptText || t('promptChain.emptyPrompt', '（提示词内容为空）')}
              </div>
            )
          ) : (
            /* 收起态:单行摘要 + 展开提示 */
            <div style={{
              flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
              fontSize: 10.5,
              color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(28,25,23,0.45)',
            }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {promptText || t('promptChain.emptyPrompt', '（提示词内容为空）')}
              </span>
              <span style={{ flexShrink: 0, opacity: 0.8 }}>{t('promptChain.tapToExpand', '点击展开')}</span>
            </div>
          )}
        </div>
        {/* 2026-08-29：提示词节点旁的左右 Pin 已移除 —— 加图入口改为列末尾显式的
            「添加参考图 / 添加生成图」卡片（Pin 太隐蔽，用户不知道能点） */}
        </div>

        {/* 生成图列：真实图在前，末尾追加「添加生成图」格（编辑态可点击连续追加） */}
        {outputs.map((img, i) => (
          <ChainImageCard key={img.storageKey + i} storageKey={img.storageKey}
            label={`${t('promptChain.output', '生成图')} ${i + 1}`}
            isDark={isDark} x={OUTS_X} y={outYs[i] ?? 0} localPreview={localPreviews?.[img.storageKey]}
            isCover={!!img.isCover}
            columnRole="output"
            editable={editable}
            onSetCover={onSetCover ? () => onSetCover(img.storageKey) : undefined}
            onToggleRole={onToggleImageRole ? () => onToggleImageRole(img.storageKey) : undefined}
            onRemove={onRemoveImage ? () => onRemoveImage(img.storageKey) : undefined}
            onFocus={() => panZoom.focusOnWorldRect({ x: OUTS_X, y: outYs[i] ?? 0, width: CARD_W, height: IMG_NODE_H }, FOCUS_PADDING)} />
        ))}
        {Array.from({ length: outCount - outputs.length }, (_, k) => {
          const idx = outputs.length + k;
          const y = outYs[idx];
          if (y === undefined) return null;
          return (
            <PlaceholderCard
              key={`out-add-${idx}`}
              label={editable ? t('promptChain.addOutput', '添加生成图') : t('promptChain.noOutput', '暂未录入生成图')}
              isDark={isDark}
              x={OUTS_X}
              y={y}
              clickable={editable && !!onAddImage}
              onClick={editable && onAddImage ? () => onAddImage('output') : undefined}
            />
          );
        })}
      </div>

      {/* ===== 左上角：标签（2026-08-29：改为纯展示 —— 标签编辑下沉到底部编辑浮层，
           避免画布上的浮层又展示又编辑、与底部编辑条职责重叠） ===== */}
      <div style={{
        position: 'absolute', top: 10, left: 10, right: 60,
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, pointerEvents: 'none', zIndex: 2,
      }}>
        <TagsOverlay tags={tags ?? []} readOnly isDark={isDark} />
      </div>

      {/* ===== 竖排缩放工具条（2026-08-29：从右下角移至右上角，让出底部给编辑浮层） ===== */}
      <ZoomToolbar panZoom={panZoom} orientation="vertical" style={{ position: 'absolute', top: 10, right: 10, zIndex: 3 }} />

      {/* ===== 编辑态浮层（征集 #90 后续：编辑控件嵌入画布，不占布局高度） =====
          绝对定位于画布底部，随画布尺寸自适应，不参与外层 flex 计算，
          因此改变浏览器高度时既不会挤压画布、也不会被容器裁剪。 */}
      {editOverlay && (
        <div
          ref={editOverlayRef}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            // right 留出右下角操作按钮（资产浏览器底部出血栏：取消/保存或编辑/副本/删除）的空间，
            // 避免编辑条压在按钮上。编辑态按钮最多 2 个（约 74px），留 96px 安全。
            position: 'absolute', left: 10, right: 96, bottom: 10, zIndex: 3,
            pointerEvents: 'auto',
          }}
        >
          {editOverlay}
        </div>
      )}
    </div>
  );
}
