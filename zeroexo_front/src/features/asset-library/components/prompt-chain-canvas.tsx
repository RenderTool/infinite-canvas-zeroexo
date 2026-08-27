/**
 * PromptChainCanvas - 提示词录入专用只读画布（Plan#47 T3，征集 #79）
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
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Image as ImageIcon, Sparkles, ImagePlus, Star, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { usePreviewImage } from '@zeroexo/plugin-nodes';
import { useImagePanZoom, ZoomToolbar } from '@/shared/components/image-viewer.js';

// ===== 世界布局常量（节点不可移动 → 布局完全确定，连线纯计算） =====
const CARD_W = 240;
const TITLE_H = 30;
const IMG_H = 170;
const IMG_NODE_H = TITLE_H + IMG_H;
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

export interface PromptChainImage {
  storageKey: string;
  role: string;
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
  /** 点击节点右上角详情按钮（调起统一资源浏览器，征集 #78 验收） */
  onOpenDetail?: (storageKey: string) => void;
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

/** 图片节点卡（三档契约自适应档；右上角详情按钮调起资源浏览器） */
function ChainImageCard({ storageKey, label, isDark, x, y, localPreview, isCover, onOpenDetail }: {
  storageKey: string; label: string; isDark: boolean; x: number; y: number; localPreview?: string;
  isCover?: boolean; onOpenDetail?: (storageKey: string) => void;
}): React.ReactElement {
  const src = usePreviewImage(storageKey, localPreview ?? '');
  return (
    <div style={{
      position: 'absolute', left: x, top: y, width: CARD_W, height: IMG_NODE_H,
      borderRadius: 10, overflow: 'hidden',
      background: isDark ? '#161616' : '#ffffff',
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'}`,
      boxShadow: isDark ? '0 8px 24px rgba(0,0,0,0.45)' : '0 8px 20px rgba(28,25,23,0.12)',
      display: 'flex', flexDirection: 'column', pointerEvents: 'none',
    }}>
      <div style={{
        height: TITLE_H, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
        fontSize: 11, fontWeight: 600, flexShrink: 0,
        color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(28,25,23,0.75)',
        borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
      }}>
        <ImageIcon size={12} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{label}</span>
        {isCover && <Star size={11} fill="currentColor" style={{ flexShrink: 0 }} />}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)' }}>
        {src ? (
          <img src={src} alt={label} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        ) : (
          <ImageIcon size={22} color={isDark ? 'rgba(255,255,255,0.25)' : 'rgba(15,23,42,0.25)'} />
        )}
      </div>
      {/* 右上角详情按钮：调起统一资源浏览器(征集 #78 验收) */}
      {onOpenDetail && (
        <button
          type="button"
          title="查看详情"
          onClick={(e) => { e.stopPropagation(); onOpenDetail(storageKey); }}
          style={{
            position: 'absolute', top: 5, right: 5, width: 20, height: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 6, border: 'none', cursor: 'pointer', pointerEvents: 'auto',
            background: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
            color: isDark ? 'rgba(255,255,255,0.8)' : 'rgba(28,25,23,0.7)',
          }}
        >
          <Info size={12} />
        </button>
      )}
    </div>
  );
}

/** 虚线占位节点（无参考图/无生成图时提示链路缺口） */
function PlaceholderCard({ label, isDark, x, y }: { label: string; isDark: boolean; x: number; y: number }): React.ReactElement {
  return (
    <div style={{
      position: 'absolute', left: x, top: y, width: CARD_W, height: IMG_NODE_H,
      borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8,
      border: `1.5px dashed ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}`,
      color: isDark ? 'rgba(255,255,255,0.35)' : 'rgba(28,25,23,0.35)',
      fontSize: 11, pointerEvents: 'none',
    }}>
      <ImagePlus size={20} strokeWidth={1.5} />
      <span>{label}</span>
    </div>
  );
}

export function PromptChainCanvas({ content, mode, images, localPreviews, onOpenDetail, style }: PromptChainCanvasProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  // 征集 #78 验收拍板:无论缩小还是放大,视口都支持拖拽平移(节点本身锁定不可动)
  const panZoom = useImagePanZoom({ panAlways: true });
  const containerElRef = useRef<HTMLDivElement | null>(null);

  // 布局恒按图生图式展示(征集 #78 验收拍板):参考图列始终在位,无图时占位提示;
  // mode 字段仅影响徽章文案(存量/公共提示词默认文生图)
  const references = useMemo(() => images.filter((i) => i.role === 'reference'), [images]);
  // 输出列 = output + 封面(封面本质是选中的生成图,归入输出列带星标 —— 修复"第一张封面图不上画布"验收 bug)
  const outputs = useMemo(() => images.filter((i) => i.role === 'output' || i.role === 'cover'), [images]);

  // 列排布：有数据按数据；无数据放一个占位格（忠实呈现链路缺口）
  const refCount = Math.max(references.length, 1);
  const outCount = Math.max(outputs.length, 1);
  const refYs = columnYs(refCount, IMG_NODE_H);
  const outYs = columnYs(outCount, IMG_NODE_H);
  // 提示词节点默认收起(用户验收反馈:展开的大文本块碍眼),点击卡片展开/点标题栏收起;
  // 连线锚点恒为 CENTER_Y,收起/展开不改变链路几何(仅卡片自身垂直居中)
  const [promptExpanded, setPromptExpanded] = useState(false);
  const promptH = promptExpanded ? PROMPT_H : PROMPT_COLLAPSED_H;
  const promptY = CENTER_Y - promptH / 2;
  const promptText = content.trim();

  // 连线（纯几何计算，节点位置恒定）
  const edges = useMemo(() => {
    const list: Array<{ d: string; key: string }> = [];
    references.forEach((_, i) => {
      const y = refYs[i];
      if (y === undefined) return;
      list.push({ key: `ref-${i}`, d: edgePath(REFS_X + CARD_W, y + IMG_NODE_H / 2, PROMPT_X, CENTER_Y) });
    });
    outYs.forEach((y) => {
      list.push({ key: `out-${y}`, d: edgePath(PROMPT_X + PROMPT_W, CENTER_Y, OUTS_X, y + IMG_NODE_H / 2) });
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [references.length, outCount]);

  // 初始适配：内容超容器时按 0.25 步进缩到放得下（复用工具条同款缩放通道）
  useEffect(() => {
    const el = containerElRef.current;
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    if (cw <= 0 || ch <= 0) return;
    const needed = Math.min((cw - 48) / WORLD_W, (ch - 48) / WORLD_H);
    if (needed >= 1) return;
    const target = Math.max(needed, 0.25);
    const steps = Math.min(Math.ceil((1 - target) / 0.25), 4);
    for (let i = 0; i < steps; i++) panZoom.zoomOut();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 模式徽章文案(仅展示用:布局恒为图生图式,存量/公共默认文生图)
  const modeLabel = mode === 'img2img'
    ? t('promptChain.modeImg2Img', '图生图')
    : t('promptChain.modeTxt2Img', '文生图');

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

        {/* 参考图列（恒显示；无图时占位提示） */}
        {references.length === 0
          ? <PlaceholderCard label={t('promptChain.noReference', '暂无参考图')} isDark={isDark} x={REFS_X} y={refYs[0] ?? CENTER_Y - IMG_NODE_H / 2} />
          : references.map((img, i) => (
            <ChainImageCard key={img.storageKey + i} storageKey={img.storageKey}
              label={`${t('promptChain.reference', '参考图')} ${i + 1}`}
              isDark={isDark} x={REFS_X} y={refYs[i] ?? 0} localPreview={localPreviews?.[img.storageKey]} onOpenDetail={onOpenDetail} />
          ))}

        {/* 提示词节点（仿文本节点卡；默认收起小卡,点击展开 —— 用户验收反馈） */}
        <div style={{
          position: 'absolute', left: PROMPT_X, top: promptY, width: PROMPT_W, height: promptH,
          borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column',
          background: isDark ? '#161616' : '#ffffff',
          border: `1px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'}`,
          boxShadow: isDark ? '0 8px 24px rgba(0,0,0,0.45)' : '0 8px 20px rgba(28,25,23,0.12)',
          cursor: promptExpanded ? 'default' : 'pointer',
          pointerEvents: promptExpanded ? 'none' : 'auto',
          transition: 'height 0.18s ease-out',
        }} onClick={() => { if (!promptExpanded) setPromptExpanded(true); }}>
          {/* 标题栏:展开态点击收起;收起态随整卡点击展开 */}
          <div
            onClick={(e) => { if (promptExpanded) { e.stopPropagation(); setPromptExpanded(false); } }}
            style={{
              height: TITLE_H, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', flexShrink: 0,
              fontSize: 11, fontWeight: 600,
              color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(28,25,23,0.75)',
              borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
              cursor: promptExpanded ? 'pointer' : 'inherit', pointerEvents: promptExpanded ? 'auto' : 'inherit',
            }}>
            <FileText size={12} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t('promptChain.promptNode', '提示词')}{promptText ? ` · ${promptText.length} 字` : ''}
            </span>
            {promptExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </div>
          {promptExpanded ? (
            <div style={{
              flex: 1, minHeight: 0, padding: '10px 12px', fontSize: 11.5, lineHeight: 1.6,
              color: isDark ? 'rgba(255,255,255,0.65)' : 'rgba(28,25,23,0.68)',
              // 征集 #78 验收:长提示词支持滚动查看(去掉行数截断);滚轮优先滚动文本不干扰画布缩放
              overflowY: 'auto', pointerEvents: 'auto', overscrollBehavior: 'contain',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {promptText || t('promptChain.emptyPrompt', '（提示词内容为空）')}
            </div>
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

        {/* 生成图列（无图时占位提示） */}
        {outputs.length === 0
          ? <PlaceholderCard label={t('promptChain.noOutput', '暂未录入生成图')} isDark={isDark} x={OUTS_X} y={outYs[0] ?? CENTER_Y - IMG_NODE_H / 2} />
          : outputs.map((img, i) => (
            <ChainImageCard key={img.storageKey + i} storageKey={img.storageKey}
              label={`${t('promptChain.output', '生成图')} ${i + 1}`}
              isDark={isDark} x={OUTS_X} y={outYs[i] ?? 0} localPreview={localPreviews?.[img.storageKey]}
              isCover={img.role === 'cover'} onOpenDetail={onOpenDetail} />
          ))}
      </div>

      {/* ===== 模式徽章（左上角浮层） ===== */}
      <div style={{
        position: 'absolute', top: 10, left: 10, display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 600,
        background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
        color: isDark ? 'rgba(255,255,255,0.75)' : 'rgba(28,25,23,0.7)',
        backdropFilter: 'blur(6px)', pointerEvents: 'none',
      }}>
        <Sparkles size={11} />
        {modeLabel}
      </div>

      {/* ===== 竖排缩放工具条（沿用图片查看器右下角同款） ===== */}
      <ZoomToolbar panZoom={panZoom} orientation="vertical" style={{ position: 'absolute', bottom: 10, right: 10 }} />
    </div>
  );
}
