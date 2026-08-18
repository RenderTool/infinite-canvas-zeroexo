/**
 * ImageDialogRenderer - 图片编辑对话框独立渲染器
 *
 * 每个图片编辑功能独立打开对应对话框,而非聚合页面(符合 memory 约束)。
 *
 * 支持的 type:
 * - crop: 裁剪对话框(CropDialog)
 * - split: 切图对话框(SplitDialog)
 * - upscale: 放大对话框(UpscaleDialog)
 * - maskEdit: 蒙版编辑对话框(MaskEditDialog)
 * - angle: 多角度对话框(AngleDialog)
 * - superResolve: AI 超分(暂未实现,显示提示)
 * - view: 查看大图(大图预览 Modal)
 * - info: 节点信息(显示节点元数据 Modal)
 * - edit: 节点详情(同 info,显示节点数据)
 *
 * 非对话框动作(saveAsset/reversePrompt/replace)由 editor-page 的 openImageDialog 直接处理,
 * 不经过此组件。
 */

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import type { NodeRecord, CommandQueue } from '@zeroexo/core';
import { UpdateNodeDataCommand, AddNodeCommand, AddEdgeCommand, ResizeNodeCommand } from '@zeroexo/core';
import { uploadImage } from '@zeroexo/plugin-persistence';
import { useHydratedContent } from '@zeroexo/plugin-nodes';
import {
  CropDialog,
  SplitDialog,
  UpscaleDialog,
  MaskEditDialog,
  AngleDialog,
  cropDataUrl,
  splitDataUrl,
  upscaleDataUrl,
} from '@zeroexo/plugin-image-editor';
import type {
  CropRect,
  SplitParams,
  UpscaleParams,
  MaskEditPayload,
  AngleParams,
} from '@zeroexo/plugin-image-editor';
import { Modal } from '@/shared/components/index.js';
import { ImageViewerStage, ZoomToolbar, useImagePanZoom } from '@/shared/components/image-viewer.js';

export interface ImageDialogState {
  node: NodeRecord;
  type: string;
}

export interface ImageDialogRendererProps {
  state: ImageDialogState;
  commandQueue: CommandQueue;
  theme: ThemeConfig;
  onClose: () => void;
  /** 节点创建后回调(用于切图后自动成组) */
  onNodesCreated?: (nodeIds: string[]) => void;
  /** 获取节点标题(图片1/图片2..., 由父组件根据画布中同类型节点数量自增编号) */
  onGetNodeTitle?: (type: string, batchIndex?: number, baseCount?: number) => string;
}

export function ImageDialogRenderer({
  state,
  commandQueue,
  theme,
  onClose,
  onNodesCreated,
  onGetNodeTitle,
}: ImageDialogRendererProps): React.ReactElement | null {
  const { t } = useTranslation();
  const { node, type } = state;
  const rawDataUrl = (node.data as { content?: string } | undefined)?.content ?? '';
  const storageKey = (node.data as { storageKey?: string } | undefined)?.storageKey;

  // 使用 useHydratedContent 确保获取正确的图片 URL(修复刷新后 blob URL 失效)
  const dataUrl = useHydratedContent(storageKey, rawDataUrl);

  if (!dataUrl) {
    return (
      <Modal open title={t('imageEditor.title')} theme={theme} onClose={onClose} width={400}>
        <div style={{ padding: 32, textAlign: 'center', color: theme.toolbar.textMuted, fontSize: 13 }}>
          {t('imageEditor.noContent')}
        </div>
      </Modal>
    );
  }

  switch (type) {
    case 'crop':
      return (
        <CropDialog
          dataUrl={dataUrl}
          open
          theme={theme}
          onClose={onClose}
          onConfirm={async (rect: CropRect) => {
            onClose();
            try {
              const cropped = await cropDataUrl(dataUrl, rect);
              // 上传裁剪后的图片到存储,获取 storageKey + 元数据
              const img = await uploadImage(cropped);
              // 创建新节点(裁剪生成子节点 + 连线)
              const childId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              const origWidth = node.size?.width ?? 340;
              const newWidth = Math.min(origWidth, Math.max(220, img.width));
              const newHeight = Math.round(newWidth * (img.height / img.width));
              commandQueue.execute(
                new AddNodeCommand({
                  id: childId,
                  type: 'image',
                  title: onGetNodeTitle?.('image') ?? '',
                  position: { x: node.position.x + origWidth + 96, y: node.position.y },
                  size: { width: newWidth, height: newHeight },
                  data: {
                    prompt: (node.data as { prompt?: string } | null)?.prompt ?? '',
                    content: img.url,
                    storageKey: img.storageKey,
                    status: 'success',
                    naturalWidth: img.width,
                    naturalHeight: img.height,
                    mimeType: img.mimeType,
                    bytes: img.bytes,
                  },
                }),
              );
              // 连线:原节点 → 裁剪节点
              commandQueue.execute(
                new AddEdgeCommand({
                  id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  source: { nodeId: node.id, pinId: 'image' },
                  target: { nodeId: childId, pinId: 'prompt' },
                }),
              );
            } catch (err) {
              console.error('Crop failed:', err);
            }
          }}
        />
      );

    case 'split':
      return (
        <SplitDialog
          dataUrl={dataUrl}
          open
          theme={theme}
          onClose={onClose}
          onConfirm={async (params: SplitParams) => {
            onClose();
            try {
              const pieces = await splitDataUrl(dataUrl, params);
              // 上传每个切片获取 storageKey + 真实尺寸
              const uploaded = await Promise.all(pieces.map((p) => uploadImage(p)));
              const baseX = node.position.x + (node.size?.width ?? 340) + 40;
              const prompt = (node.data as { prompt?: string } | null)?.prompt ?? '';
              // 计算切图前的同类型节点数量,确保标题编号不跳号
              const existingCount = commandQueue.getState().nodes.filter((n) => n.type === 'image').length;
              const childIds: string[] = [];
              // 非均匀切分时各片高度不一:行高取该行最大片,逐行累加 y 偏移避免重叠
              const cellW = 200;
              const cellHeights: number[] = uploaded.map((img: { width: number; height: number; url: string; storageKey: string; mimeType: string; bytes: number }) => Math.round(cellW * (img.height / img.width)));
              const rowHeights: number[] = [];
              cellHeights.forEach((h: number, i: number) => {
                const row = Math.floor(i / params.columns);
                rowHeights[row] = Math.max(rowHeights[row] ?? 0, h);
              });
              const rowTop: number[] = [];
              let accY = 0;
              rowHeights.forEach((h: number, r: number) => {
                rowTop[r] = accY;
                accY += h + 20;
              });
              uploaded.forEach((img: { width: number; height: number; url: string; storageKey: string; mimeType: string; bytes: number }, i: number) => {
                const row = Math.floor(i / params.columns);
                const col = i % params.columns;
                const childId = `node-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
                childIds.push(childId);
                // 按图片比例计算节点尺寸(完全无边框)
                const cellH = cellHeights[i] ?? 200;
                commandQueue.execute(
                  new AddNodeCommand({
                    id: childId,
                    type: 'image',
                    title: onGetNodeTitle?.('image', i, existingCount) ?? '',
                    position: { x: baseX + col * (cellW + 20), y: node.position.y + (rowTop[row] ?? 0) },
                    size: { width: cellW, height: cellH },
                    // 切片节点去圆角:避免圆角裁掉图片四角导致拼合时角点空洞
                    borderRadius: 0,
                    data: {
                      prompt,
                      content: img.url,
                      storageKey: img.storageKey,
                      status: 'success',
                      naturalWidth: img.width,
                      naturalHeight: img.height,
                      mimeType: img.mimeType,
                      bytes: img.bytes,
                    },
                  }),
                );
                // 连线:原节点 → 切图节点
                commandQueue.execute(
                  new AddEdgeCommand({
                    id: `edge-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
                    source: { nodeId: node.id, pinId: 'image' },
                    target: { nodeId: childId, pinId: 'prompt' },
                  }),
                );
              });
              // 切图后自动成组(选中切图节点 → 触发预览 → 确认成组)
              if (childIds.length >= 2 && onNodesCreated) {
                onNodesCreated(childIds);
              }
            } catch (err) {
              console.error('Split failed:', err);
            }
          }}
        />
      );

    case 'upscale':
      return (
        <UpscaleDialog
          dataUrl={dataUrl}
          open
          onClose={onClose}
          onConfirm={async (params: UpscaleParams) => {
            onClose();
            try {
              const upscaled = await upscaleDataUrl(dataUrl, params);
              // 上传放大后的图片,获取 storageKey + 真实尺寸
              const img = await uploadImage(upscaled);
              commandQueue.execute(
                new UpdateNodeDataCommand(node.id, {
                  content: img.url,
                  storageKey: img.storageKey,
                  naturalWidth: img.width,
                  naturalHeight: img.height,
                  mimeType: img.mimeType,
                  bytes: img.bytes,
                }),
              );
              // 同步调整节点尺寸为放大后图片比例(完全无边框)
              const currentWidth = node.size?.width ?? 340;
              const ratio = img.height / img.width;
              const newHeight = Math.round(currentWidth * ratio);
              commandQueue.execute(
                new ResizeNodeCommand(node.id, {
                  x: node.position.x,
                  y: node.position.y,
                  width: node.size?.width ?? 340,
                  height: node.size?.height ?? 240,
                }, {
                  x: node.position.x,
                  y: node.position.y,
                  width: currentWidth,
                  height: newHeight,
                }),
              );
            } catch (err) {
              console.error('Upscale failed:', err);
            }
          }}
        />
      );

    case 'maskEdit':
      return (
        <MaskEditDialog
          dataUrl={dataUrl}
          open
          theme={theme}
          onClose={onClose}
          onConfirm={(_payload: MaskEditPayload) => {
            onClose();
            // maskEdit 需要 AI 后端,暂不处理
          }}
        />
      );

    case 'angle':
      return (
        <AngleDialog
          dataUrl={dataUrl}
          open
          onClose={onClose}
          onConfirm={(_params: AngleParams) => {
            onClose();
            // angle 需要 AI 后端,暂不处理
          }}
        />
      );

    case 'superResolve':
      // AI 超分暂未实现(显示"暂未实现"提示)
      return (
        <Modal open title={t('imageEditor.superResolve')} theme={theme} onClose={onClose} width={400}>
          <div style={{ padding: 32, textAlign: 'center', color: theme.toolbar.textMuted, fontSize: 14 }}>
            {t('common.notImplemented')}
          </div>
        </Modal>
      );

    case 'view':
      // 查看大图:全屏可缩放/平移的图片浏览器
      return (
        <Modal open title={t('imageEditor.viewTitle')} theme={theme} onClose={onClose} width={Math.min(window.innerWidth - 48, 1400)}>
          <ZoomableImageView src={dataUrl} theme={theme} />
        </Modal>
      );

    case 'info':
    case 'edit':
      // 节点信息/详情:显示节点元数据
      return (
        <NodeInfoModal node={node} theme={theme} onClose={onClose} />
      );

    default:
      return null;
  }
}

// ===== 节点信息 Modal =====

interface NodeInfoModalProps {
  node: NodeRecord;
  theme: ThemeConfig;
  onClose: () => void;
}

function NodeInfoModal({ node, theme, onClose }: NodeInfoModalProps): React.ReactElement {
  const { t } = useTranslation();
  const [view, setView] = useState<'info' | 'json'>('info');

  const data = node.data as Record<string, unknown> | null;
  const infoItems: Array<{ label: string; value: string }> = [
    { label: 'ID', value: node.id },
    { label: t('imageEditor.nodeType'), value: node.type },
    ...(node.size ? [{ label: t('imageEditor.nodeSize'), value: `${node.size.width} × ${node.size.height}` }] : []),
    ...(node.position ? [{ label: t('imageEditor.nodePosition'), value: `(${Math.round(node.position.x)}, ${Math.round(node.position.y)})` }] : []),
    ...(data?.['prompt'] ? [{ label: t('imageEditor.prompt'), value: String(data['prompt']) }] : []),
    ...(data?.['model'] ? [{ label: t('imageEditor.model'), value: String(data['model']) }] : []),
    ...(data?.['status'] ? [{ label: t('imageEditor.status'), value: String(data['status']) }] : []),
    ...(data?.['naturalWidth'] && data?.['naturalHeight']
      ? [{ label: t('imageEditor.dimensions'), value: `${data['naturalWidth']} × ${data['naturalHeight']}` }]
      : []),
    ...(data?.['mimeType'] ? [{ label: t('imageEditor.mimeType'), value: String(data['mimeType']) }] : []),
    ...(data?.['bytes'] ? [{ label: t('imageEditor.fileSize'), value: formatBytes(Number(data['bytes'])) }] : []),
  ];

  const labelStyle: CSSProperties = {
    fontSize: 11, color: theme.toolbar.textMuted, fontWeight: 500, minWidth: 80, flexShrink: 0,
  };
  const valueStyle: CSSProperties = {
    fontSize: 12, color: theme.toolbar.text, wordBreak: 'break-all',
  };
  const rowStyle: CSSProperties = {
    display: 'flex', gap: 12, padding: '8px 0',
    borderBottom: `1px solid ${theme.toolbar.border}`,
  };

  return (
    <Modal
      open
      title={t('imageEditor.nodeInfo')}
      theme={theme}
      onClose={onClose}
      width={520}
      footer={
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            style={view === 'info' ? tabActiveStyle(theme) : tabStyle(theme)}
            onClick={() => setView('info')}
          >
            {t('imageEditor.infoTab')}
          </button>
          <button
            type="button"
            style={view === 'json' ? tabActiveStyle(theme) : tabStyle(theme)}
            onClick={() => setView('json')}
          >
            JSON
          </button>
        </div>
      }
    >
      {view === 'info' ? (
        <div style={{ padding: '4px 0', minHeight: 300, maxHeight: 400, overflow: 'auto' }}>
          {infoItems.map((item) => (
            <div key={item.label} style={rowStyle}>
              <span style={labelStyle}>{item.label}</span>
              <span style={valueStyle}>{item.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <pre style={{
          fontSize: 11, lineHeight: 1.6, color: theme.toolbar.text,
          background: theme.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
          padding: 12, borderRadius: 8, overflow: 'auto', minHeight: 300, maxHeight: 400,
          border: `1px solid ${theme.toolbar.border}`, margin: 0, boxSizing: 'border-box',
        }}>
          {JSON.stringify(node, null, 2)}
        </pre>
      )}
    </Modal>
  );
}

// ===== 辅助样式 =====

function tabStyle(theme: ThemeConfig): CSSProperties {
  return {
    padding: '6px 14px', fontSize: 12, fontWeight: 500,
    border: `1px solid ${theme.toolbar.border}`, borderRadius: 6,
    background: 'transparent', color: theme.toolbar.textMuted,
    cursor: 'pointer', transition: 'all 0.12s',
  };
}

function tabActiveStyle(theme: ThemeConfig): CSSProperties {
  return {
    ...tabStyle(theme),
    background: theme.toolbar.accent, color: '#fff', borderColor: theme.toolbar.accent,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ===== 可缩放图片浏览器(查看大图) — 统一图片查看框架 =====

interface ZoomableImageViewProps {
  src: string;
  theme: ThemeConfig;
}

function ZoomableImageView({ src, theme }: ZoomableImageViewProps): React.ReactElement {
  const panZoom = useImagePanZoom();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%' }}>
      {/* 工具栏 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        borderBottom: `1px solid ${theme.toolbar.border}`,
        flexShrink: 0,
      }}>
        <ZoomToolbar panZoom={panZoom} style={{ background: 'transparent', padding: 0 }} />
      </div>
      {/* 图片舞台 */}
      <ImageViewerStage
        src={src}
        alt="preview"
        panZoom={panZoom}
        resetOnDoubleClick
        containerStyle={{
          flex: 1,
          minHeight: 0,
          background: theme.mode === 'dark' ? '#0a0a12' : '#f0f0f4',
        }}
      />
    </div>
  );
}
