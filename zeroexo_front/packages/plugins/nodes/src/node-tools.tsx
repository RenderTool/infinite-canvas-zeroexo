/**
 * 节点工具定义 — 为业务节点类型提供 ToolDefinition 数组
 *
 * 架构: 数据驱动 + 策略模式
 * - 每个工具是纯数据 + 函数对象(id/label/icon/run)
 * - run 通过 ToolContext 访问业务能力(commandQueue/eventBus/openImageDialog)
 * - 图标用 lucide-react(符合项目约定:禁止 emoji)
 *
 * 统一工具栏顺序:
 * - 固定操作(基础): 复制(duplicate) → 删除(delete) → 重命名(rename) → 存素材(saveAsset) → 替换(replace) → 下载(download)
 * - 分割线
 * - 节点特定操作: AI相关(复制提示词) → 编辑相关(更多:局部遮罩/裁剪/分割) → 查看(详情)
 */

import {
  Settings2,
  Brush, Scissors,
  Grid2x2, Camera, AlertCircle, Bold, Italic, Underline, Palette, Highlighter, RemoveFormatting,
  Heading1, History,
} from 'lucide-react';
import { NODE_ICONS } from './icons.js';
import type { NodeRecord, EdgeRecord, ToolContext, ToolDefinition, ToolMenuItem } from '@zeroexo/core';
import { AddNodeCommand, AddEdgeCommand, BatchCommand, resolveNodeSize } from '@zeroexo/core';
import { setImageBlob } from '@zeroexo/plugin-persistence';
import { collectCard } from './nodes/stacked-media-model.js';
import { parseStackedMediaData } from './nodes/stacked-media-types.js';
import { STACKED_MEDIA_DEFAULT_SIZE, IMAGE_DEFAULT_SIZE } from './utils/node-contracts.js';
import { nodeActionBus } from './base-node-view.js';

// ===== 通用工具(所有节点共用) =====

/** 基础固定工具集 */
function createBasicTools(
  options: {
    hasDetail?: boolean;
  } = {},
): ToolDefinition[] {
  const { hasDetail = false } = options;
  const tools: ToolDefinition[] = [];
  if (hasDetail) tools.push(createDetailTool());
  return tools;
}

/**
 * 一键同款工具(征集#43):仅对 AI 生成型资源显示(节点带 generationId 烙印)。
 * 点击经 nodeActionBus 交由 editor 层 handleReplayGeneration 复原完整生成链路。
 */
function createReplayTool(): ToolDefinition {
  return {
    id: 'replayGeneration',
    label: '一键同款',
    title: '一键同款：复原提示词/参数/引用的完整生成链路',
    icon: <History size={14} />,
    group: 'basic',
    visible: (node: NodeRecord) => !!((node.data as Record<string, unknown> | null | undefined)?.generationId),
    run: (node: NodeRecord) => {
      nodeActionBus.emit('replayGeneration', { nodeId: node.id });
    },
  };
}

// ===== 各节点类型工具集 =====

// ===== 文本格式化预设 =====

const HEADER_PRESETS = [
  { key: 'div', label: '正文' },
  { key: 'h1', label: 'H1' },
  { key: 'h2', label: 'H2' },
  { key: 'h3', label: 'H3' },
  { key: 'h4', label: 'H4' },
  { key: 'h5', label: 'H5' },
  { key: 'h6', label: 'H6' },
];
const TEXT_COLORS = ['#1f2937', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777', '#ffffff'];
const HIGHLIGHT_COLORS = ['#ffd54f', '#a5d6a7', '#90caf9', '#ef9a9a', '#ce93d8', '#ffab91'];

/** 恢复焦点到编辑器并保存选区(工具栏按钮点击后编辑器失焦,重新聚焦确保 execCommand 生效) */
function restoreEditorFocus(): void {
  const editor = document.querySelector('.zxe-content-editable');
  if (editor instanceof HTMLElement) {
    // 保存当前选区(如果存在)
    const sel = window.getSelection();
    const savedRange = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    editor.focus();
    // 恢复选区:如果之前有选区且锚点在编辑器内,恢复之;否则 select all
    if (savedRange && editor.contains(savedRange.startContainer)) {
      const newSel = window.getSelection();
      if (newSel) {
        newSel.removeAllRanges();
        newSel.addRange(savedRange);
      }
    } else {
      // 无选区 → 全选编辑器内容
      const range = document.createRange();
      range.selectNodeContents(editor);
      const newSel = window.getSelection();
      if (newSel) {
        newSel.removeAllRanges();
        newSel.addRange(range);
      }
    }
  }
}

/** 文本节点工具 */
export function getTextTools(): ToolDefinition[] {
  return [
    ...createBasicTools({ hasDetail: false }),
    // 一键同款(征集#43):AI 生成型资源复原生成链路(仅带 generationId 时显示)
    createReplayTool(),
    // 标题下拉(H1-H6+正文)
    {
      id: 'header',
      label: '标题',
      title: '标题',
      icon: <Heading1 size={14} />,
      group: 'format',
      menu: (): ToolMenuItem[] => HEADER_PRESETS.map((h) => ({
        key: h.key,
        label: h.label,
        run: (_node: NodeRecord, _ctx: ToolContext) => {
          restoreEditorFocus();
          document.execCommand('formatBlock', false, h.key);
        },
      })),
      run: () => {},
    },
    // 加粗
    {
      id: 'bold',
      label: '加粗',
      title: '加粗',
      icon: <Bold size={14} />,
      group: 'format',
      active: () => {
        try { return document.queryCommandState('bold'); } catch { return false; }
      },
      run: () => {
        restoreEditorFocus();
        document.execCommand('bold');
      },
    },
    // 斜体
    {
      id: 'italic',
      label: '斜体',
      title: '斜体',
      icon: <Italic size={14} />,
      group: 'format',
      active: () => {
        try { return document.queryCommandState('italic'); } catch { return false; }
      },
      run: () => {
        restoreEditorFocus();
        document.execCommand('italic');
      },
    },
    // 下划线
    {
      id: 'underline',
      label: '下划线',
      title: '下划线',
      icon: <Underline size={14} />,
      group: 'format',
      active: () => {
        try { return document.queryCommandState('underline'); } catch { return false; }
      },
      run: () => {
        restoreEditorFocus();
        document.execCommand('underline');
      },
    },
    // 文字颜色
    {
      id: 'textColor',
      label: '颜色',
      title: '文字颜色',
      icon: <Palette size={14} />,
      group: 'color',
      menu: (): ToolMenuItem[] => [
        ...TEXT_COLORS.map((c) => ({
          key: `color-${c}`,
          label: c,
          icon: <span style={{ display: 'inline-block', width: 14, height: 14, background: c, border: '1px solid rgba(128,128,128,0.3)' }} />,
          run: () => {
            restoreEditorFocus();
            document.execCommand('foreColor', false, c);
          },
        })),
        { key: 'div-c', divider: true },
        {
          key: 'clear-color',
          label: '清除颜色',
          run: () => {
            restoreEditorFocus();
            document.execCommand('foreColor', false, '#1f2937');
          },
        },
      ],
      run: () => {},
    },
    // 背景颜色
    {
      id: 'highlight',
      label: '高亮',
      title: '背景颜色',
      icon: <Highlighter size={14} />,
      group: 'color',
      menu: (): ToolMenuItem[] => [
        ...HIGHLIGHT_COLORS.map((c) => ({
          key: `hl-${c}`,
          label: c,
          icon: <span style={{ display: 'inline-block', width: 14, height: 14, background: c, border: '1px solid rgba(128,128,128,0.3)' }} />,
          run: () => {
            restoreEditorFocus();
            document.execCommand('hiliteColor', false, c);
          },
        })),
        { key: 'div-h', divider: true },
        {
          key: 'clear-hl',
          label: '清除高亮',
          run: () => {
            restoreEditorFocus();
            document.execCommand('hiliteColor', false, 'transparent');
          },
        },
      ],
      run: () => {},
    },
    // 清除格式:恢复焦点 + removeFormat
    {
      id: 'clearFormat',
      label: '清除',
      title: '清除格式',
      icon: <RemoveFormatting size={14} />,
      group: 'font',
      danger: true,
      run: (_node: NodeRecord, _ctx: ToolContext) => {
        restoreEditorFocus();
        // 多次尝试清除格式,确保生效
        try {
          document.execCommand('removeFormat');
          document.execCommand('formatBlock', false, 'div');
          // 清除选区内所有内联样式
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            const ancestor = range.commonAncestorContainer;
            if (ancestor.nodeType === Node.ELEMENT_NODE) {
              (ancestor as HTMLElement).querySelectorAll('[style]').forEach((el) => {
                (el as HTMLElement).removeAttribute('style');
              });
            }
          }
        } catch { /* 静默处理 */ }
      },
    },
  ];
}

// ===== 图片节点工具 =====

/**
 * 媒体内容判定(统一供工具 visible 使用)
 *
 * 内容存在两种形态: content(blob/data URL)或 storageKey(持久化 key)。
 * 后端上传通道(replace-node-image)content 可能为空字符串,仅 storageKey 有值,
 * 故必须以两者并存判定,否则上传/替换后的节点会丢失信息/编辑等胶囊工具。
 */
function hasMediaContent(data: Record<string, unknown> | null | undefined): boolean {
  return Boolean(data?.['content'] || data?.['storageKey']);
}

/** 图片节点编辑工具(征集#45 H2:从「更多」子菜单拍平为胶囊独立按钮) */
function buildImageEditTools(): ToolDefinition[] {
  const visibleWithContent = (node: NodeRecord): boolean =>
    hasMediaContent(node.data as Record<string, unknown> | null | undefined);
  return [
    {
      id: 'maskEdit',
      label: '局部遮罩',
      title: '局部遮罩',
      icon: <Brush size={14} />,
      group: 'edit',
      visible: visibleWithContent,
      run: (node: NodeRecord, ctx: ToolContext) => {
        ctx.openImageDialog?.(node, 'maskEdit');
      },
    },
    {
      id: 'crop',
      label: '裁剪',
      title: '裁剪',
      icon: <Scissors size={14} />,
      group: 'edit',
      visible: visibleWithContent,
      run: (node: NodeRecord, ctx: ToolContext) => {
        ctx.openImageDialog?.(node, 'crop');
      },
    },
    {
      id: 'split',
      label: '分割',
      title: '分割',
      icon: <Grid2x2 size={14} />,
      group: 'edit',
      visible: visibleWithContent,
      run: (node: NodeRecord, ctx: ToolContext) => {
        ctx.openImageDialog?.(node, 'split');
      },
    },
  ];
}

/** 创建详情工具(替换原来的大图功能) */
function createDetailTool(): ToolDefinition {
  return {
    id: 'detail',
    label: '详情',
    title: '详情',
    icon: <AlertCircle size={14} />,
    group: 'basic',
    visible: (node: NodeRecord) => {
      return hasMediaContent(node.data as Record<string, unknown> | null | undefined);
    },
    run: (node: NodeRecord, ctx: ToolContext) => {
      ctx.eventBus.emit('node:detail', { node });
    },
  };
}

/**
 * 图片节点工具(完整工具集)
 *
 * 工具顺序:
 * - 基础固定操作: 详情(detail)
 * - AI相关: 复制提示词(copyPrompt) → 反推(reversePrompt) → 放大(upscale) → 多角度(angle)
 * - 编辑相关: 锁比例(resize) → 局部编辑(maskEdit) → 裁剪(crop) → 切图(split)
 *
 * 注: 复制/删除/重命名/存素材/替换/下载 已移至右键菜单
 */
export function getImageTools(): ToolDefinition[] {
  return [
    ...createBasicTools({ hasDetail: true }),
    // 一键同款(征集#43):AI 生成型资源复原生成链路(仅带 generationId 时显示)
    createReplayTool(),
    ...buildImageEditTools(),
    // 堆叠置末(征集#45 H3):与胶囊导航按钮紧邻成一组(堆叠+导航同组)
    {
      id: 'createStackNode',
      label: '堆叠',
      title: '',
      icon: <NODE_ICONS.stack size={14} />,
      group: 'edit',
      run: (node: NodeRecord, ctx: ToolContext) => {
        convertToStack(node, ctx);
      },
    },
  ];
}

/** 视频节点工具 */
export function getVideoTools(): ToolDefinition[] {
  return [
    ...createBasicTools({ hasDetail: true }),
    // 一键同款(征集#43):AI 生成型资源复原生成链路(仅带 generationId 时显示)
    createReplayTool(),
    // 截帧:截取视频首帧/尾帧/当前帧,并在画布上生成新图片节点
    {
      id: 'captureFrame',
      label: '截帧',
      title: '截帧',
      icon: <Camera size={14} />,
      group: 'edit',
      visible: (node: NodeRecord) => {
        return hasMediaContent(node.data as Record<string, unknown> | null | undefined);
      },
      menu: () => [
        { key: 'first', label: '截首帧', run: (node, ctx) => { void captureAndCreateImageNode(node, ctx, 'first'); } },
        { key: 'last', label: '截尾帧', run: (node, ctx) => { void captureAndCreateImageNode(node, ctx, 'last'); } },
        { key: 'current', label: '截取当前帧', run: (node, ctx) => { void captureAndCreateImageNode(node, ctx, 'current'); } },
        // 征集 #81:截帧直接下载成图片(不建节点)
        { key: 'download-first', label: '下载首帧图片', run: (node) => { void captureAndDownloadFrame(node, 'first'); } },
        { key: 'download-last', label: '下载尾帧图片', run: (node) => { void captureAndDownloadFrame(node, 'last'); } },
        { key: 'download-current', label: '下载当前帧图片', run: (node) => { void captureAndDownloadFrame(node, 'current'); } },
      ],
      run: () => {},
    },
    // 堆叠置末(征集#45 H3):与胶囊导航按钮紧邻成一组(堆叠+导航同组)
    {
      id: 'createStackNode',
      label: '堆叠',
      title: '',
      icon: <NODE_ICONS.stack size={14} />,
      group: 'edit',
      run: (node: NodeRecord, ctx: ToolContext) => {
        convertToStack(node, ctx);
      },
    },
  ];
}

// ===== StackNode 转入堆叠 =====

/** 生成唯一 id */
function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 新建堆叠节点落点(征集#9 E1 拍板):优先用户视觉中心(视口中心)。
 *
 * 与已有节点包围盒重叠时向右偏移 140px 试探(至多 2 次),仍冲突则直落中心保证必见;
 * ctx 未注入视口信息(无 getViewport/getContainerSize)时返回 null,调用方回退原右侧 120px 逻辑。
 */
export function resolveStackSpawnPosition(
  ctx: ToolContext,
  opts?: { ignoreNodeIds?: Set<string> },
): { x: number; y: number } | null {
  const vp = ctx.getViewport?.();
  const size = ctx.getContainerSize?.();
  if (!vp || !size) return null;
  const cx = (size.width / 2 - vp.x) / vp.k;
  const cy = (size.height / 2 - vp.y) / vp.k;
  const graph = ctx.commandQueue.getState();
  const occupied = (p: { x: number; y: number }): boolean =>
    (graph?.nodes ?? []).some((n) => {
      if (opts?.ignoreNodeIds?.has(n.id)) return false;
      const { width: w, height: h } = resolveNodeSize(n);
      // ±16 间隙容忍:中心点贴近节点边缘不视为冲突
      return (
        p.x >= (n.position?.x ?? 0) - 16 &&
        p.x <= (n.position?.x ?? 0) + w + 16 &&
        p.y >= (n.position?.y ?? 0) - 16 &&
        p.y <= (n.position?.y ?? 0) + h + 16
      );
    });
  const candidates = [
    { x: cx, y: cy },
    { x: cx + 140, y: cy },
    { x: cx + 280, y: cy },
  ];
  return candidates.find((p) => !occupied(p)) ?? { x: cx, y: cy };
}

/**
 * 将当前节点转入 StackNode
 *
 * 逻辑:
 * 1. 检查当前节点 output 是否有连线到 StackNode 的 prompt pin
 * 2. 如果有 → 直接执行收纳(删边+删源节点+追加卡片)
 * 3. 如果没有 → 一个原子 Batch 内创建 StackNode、建立临时边并立即收纳
 */
export function convertToStack(node: NodeRecord, ctx: ToolContext): void {
  const graph = ctx.commandQueue.getState();
  if (!graph) return;

  // 确定 output pin id
  const outputPinId = node.type === 'video' ? 'video' : 'image';

  // 查找已连线的 StackNode
  const existingEdge = graph.edges.find((e: EdgeRecord) =>
    e.source.nodeId === node.id &&
    e.source.pinId === outputPinId &&
    graph.nodes.find((n: NodeRecord) => n.id === e.target.nodeId && n.type === 'stacked-media')
  );

  if (existingEdge) {
    // 已有 StackNode → 直接收纳
    const stackNode = graph.nodes.find((n: NodeRecord) => n.id === existingEdge.target.nodeId);
    if (!stackNode) return;
    const collected = collectCard(
      stackNode.id,
      parseStackedMediaData(stackNode.data as Record<string, unknown> | undefined),
      node,
      existingEdge,
    );
    ctx.commandQueue.execute(collected.command);
  } else {
    // 无 StackNode → 一个原子命令完成创建与收纳，避免 setTimeout 和 View effect 竞争。
    // 落点优先用户视觉中心(征集#9 E1),无视口信息回退节点右侧 120px
    const nodePos = node.position ?? { x: 0, y: 0 };
    const nodeWidth = node.size?.width ?? IMAGE_DEFAULT_SIZE.width;
    const spawn = resolveStackSpawnPosition(ctx, { ignoreNodeIds: new Set([node.id]) });
    const stackNodeId = genId('stack-node');
    const stackNode: NodeRecord = {
      id: stackNodeId,
      type: 'stacked-media',
      position: spawn ?? { x: nodePos.x + nodeWidth + 120, y: nodePos.y },
      size: { ...STACKED_MEDIA_DEFAULT_SIZE },
      title: '堆叠媒体',
      data: { cards: [], activeIndex: 0 },
    };
    const edgeId = genId('edge-stack');
    const newEdge: EdgeRecord = {
      id: edgeId,
      source: { nodeId: node.id, pinId: outputPinId },
      target: { nodeId: stackNodeId, pinId: 'prompt' },
    };

    const collect = collectCard(stackNodeId, { cards: [], activeIndex: 0 }, node, newEdge);
    ctx.commandQueue.execute(new BatchCommand([
      new AddNodeCommand(stackNode),
      new AddEdgeCommand(newEdge),
      collect.command,
    ], 'stacked-media-create-and-collect'));
  }
}

/**
 * 在当前节点右侧创建一个空的 StackNode。
 *
 * 逻辑:
 * 1. 确定 output pin id(image → 'image', video → 'video')
 * 2. 在节点右侧偏移位置创建空 StackNode
 */
export function createStackNode(node: NodeRecord, ctx: ToolContext): void {
  const nodePos = node.position ?? { x: 0, y: 0 };
  const nodeWidth = node.size?.width ?? IMAGE_DEFAULT_SIZE.width;
  // 落点优先用户视觉中心(征集#9 E1),无视觉信息回退节点右侧 120px
  const spawn = resolveStackSpawnPosition(ctx, { ignoreNodeIds: new Set([node.id]) });
  const stackNodeId = genId('stack-node');
  const stackNode: NodeRecord = {
    id: stackNodeId,
    type: 'stacked-media',
    position: spawn ?? { x: nodePos.x + nodeWidth + 120, y: nodePos.y },
    size: { ...STACKED_MEDIA_DEFAULT_SIZE },
    title: '堆叠媒体',
    data: { cards: [], activeIndex: 0 },
  };
  ctx.commandQueue.execute(new AddNodeCommand(stackNode));
}

/** 截帧公共管线(征集 #81 抽取):seek + drawImage + toBlob + 帧号标签,建节点与下载共用 */
async function captureVideoFrame(
  node: NodeRecord,
  frameType: 'first' | 'last' | 'current',
): Promise<{ blob: Blob; width: number; height: number; frameLabel: string } | null> {
  const data = (node.data ?? {}) as Record<string, unknown>;
  const content = data.content as string | undefined;
  if (!content) return null;

  // 优先用 data-node-id 找到页面上已渲染的 video 元素
  const existingVid = document.querySelector<HTMLVideoElement>(
    `video[data-node-id="${node.id}"]`
  );

  let frameSrc: HTMLVideoElement;

  if (frameType === 'current' && existingVid) {
    // 截取当前帧:直接使用页面上正在播放的 video 元素,保证 currentTime 准确
    frameSrc = existingVid;
    // 确保暂停,避免 drawImage 时帧正在更新
    existingVid.pause();
  } else {
    // 截首帧/尾帧:需要创建新 video 元素并 seek 到目标位置
    const videoSrc = existingVid?.currentSrc || existingVid?.src || content;
    const vid = document.createElement('video');
    vid.muted = true;
    vid.preload = 'auto';
    vid.src = videoSrc;

    try {
      await new Promise<void>((resolve, reject) => {
        vid.onloadedmetadata = () => {
          if (frameType === 'first') {
            vid.currentTime = 0;
          } else if (frameType === 'last') {
            vid.currentTime = Math.max(0, (vid.duration || 0) - 0.1);
          }
          vid.onseeked = () => resolve();
        };
        vid.onerror = () => reject(new Error('Failed to load video'));
        setTimeout(() => reject(new Error('Timeout')), 10000);
      });
      frameSrc = vid;
    } catch {
      vid.remove();
      return null;
    }
  }

  const canvas = document.createElement('canvas');
  const w = frameSrc.videoWidth || 640;
  const h = frameSrc.videoHeight || 480;
  canvas.width = w;
  canvas.height = h;
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) return null;
  ctx2d.drawImage(frameSrc, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;

  // 从页面上已渲染的视频元素读取帧信息(帧号/总帧/fps)
  const srcVid = existingVid;
  const playingFps = parseInt(srcVid?.dataset.fps ?? '0', 10) || 30;
  const playingTotal = parseInt(srcVid?.dataset.totalFrames ?? '0', 10) || Math.round((frameSrc.duration || 0) * playingFps);
  const playingCurrent = parseInt(srcVid?.dataset.currentFrame ?? '0', 10) || 0;

  // 计算帧号
  let frameNumber: number;
  if (frameType === 'first') {
    frameNumber = 0;
  } else if (frameType === 'last') {
    frameNumber = playingTotal - 1;
  } else {
    frameNumber = playingCurrent;
  }

  return { blob, width: w, height: h, frameLabel: `帧${frameNumber}_${playingTotal}` };
}

/** 截取视频帧并直接下载成图片(征集 #81:不建节点,文件名 = 节点标题_帧标签) */
async function captureAndDownloadFrame(
  node: NodeRecord,
  frameType: 'first' | 'last' | 'current',
): Promise<void> {
  const frame = await captureVideoFrame(node, frameType);
  if (!frame) return;
  const url = URL.createObjectURL(frame.blob);
  const baseName = (node.title ?? '').trim() || '截帧';
  const a = document.createElement('a');
  a.href = url;
  a.download = `${baseName}_${frame.frameLabel}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟释放:确保浏览器已开始读取 blob(立即 revoke 部分浏览器会下载失败)
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** 截取视频帧并创建新图片节点 */
async function captureAndCreateImageNode(
  node: NodeRecord,
  ctx: ToolContext,
  frameType: 'first' | 'last' | 'current',
): Promise<void> {
  const frame = await captureVideoFrame(node, frameType);
  if (!frame) return;
  const { blob, width: w, height: h, frameLabel } = frame;

  const storageKey = `image:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const blobUrl = await setImageBlob(storageKey, blob);

  // 创建新图片节点,偏移到视频节点右下方
  const nodePos = node.position ?? { x: 0, y: 0 };
  const nodeSize = node.size ?? { width: 420, height: 236 };
  const aspect = h / w;
  const imgWidth = 340;
  const imgHeight = Math.round(imgWidth * aspect);
  const nodeTitle = node.title ? `${node.title}_${frameLabel}` : `截帧_${frameLabel}`;
  const newNodeId = `captured-frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const newNode: NodeRecord = {
    id: newNodeId,
    type: 'image',
    position: { x: nodePos.x + nodeSize.width + 40, y: nodePos.y },
    size: { width: imgWidth, height: imgHeight },
    title: nodeTitle,
    data: {
      content: blobUrl,
      storageKey,
      status: 'success',
      naturalWidth: w,
      naturalHeight: h,
      prompt: '',
    },
  };
  ctx.commandQueue.execute(new AddNodeCommand(newNode));

  // 从视频节点 output(video) 连线到新图片节点 input(prompt),类似图片裁剪
  const edgeId = `edge-${node.id}-${newNodeId}`;
  ctx.commandQueue.execute(new AddEdgeCommand({
    id: edgeId,
    source: { nodeId: node.id, pinId: 'video' },
    target: { nodeId: newNodeId, pinId: 'prompt' },
  }));
}

/** 音频节点工具 */
export function getAudioTools(): ToolDefinition[] {
  return [
    ...createBasicTools({ hasDetail: true }),
    // 一键同款(征集#43):AI 生成型资源复原生成链路(仅带 generationId 时显示)
    createReplayTool(),
  ];
}

/** 生成器节点工具 */
export function getGeneratorTools(): ToolDefinition[] {
  return [
    ...createBasicTools(),
    {
      id: 'editGenerator',
      label: '编辑',
      title: '编辑配置',
      icon: <Settings2 size={14} />,
      group: 'edit',
      run: (node: NodeRecord, ctx: ToolContext) => {
        ctx.openEditor?.(node);
      },
    },
  ];
}
