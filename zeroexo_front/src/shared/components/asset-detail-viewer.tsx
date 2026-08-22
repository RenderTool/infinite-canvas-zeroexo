/**
 * AssetDetailViewer - 全项目统一资产/节点详情查看器（Modal）
 *
 * 支持 image / video / audio / text / script 五种类型预览。
 * 图片支持缩放、拖拽、触摸双指缩放。
 * 可接收 asset 对象或 node 记录，统一展示。
 * 沉浸模式：全出血 + 深色剧场背景 + 悬浮工具栏。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download, X,
  Music as MusicIcon, FileText, Trash2, Pencil,
} from 'lucide-react';
import { Modal, Tag } from 'antd';
import Editor from '@monaco-editor/react';
import type { NodeRecord } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';
import { useHydratedContent, useProgressiveImage } from '@zeroexo/plugin-nodes';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { ConfirmDialog } from '@/shared/components/confirm-dialog.js';
import { ImageViewerStage, ZoomToolbar, useImagePanZoom } from '@/shared/components/image-viewer.js';

// ===== 类型定义 =====

export interface AssetDetailData {
  id: string;
  title: string;
  kind: 'text' | 'image' | 'video' | 'audio' | 'script';
  bytes: number;
  mimeType?: string;
  tags?: string[];
  createdAt?: number;
  data: {
    kind: string;
    dataUrl?: string;
    url?: string;
    storageKey?: string;
    content?: string;
    width?: number;
    height?: number;
    prompt?: string;
    durationMs?: number;
  };
}

export interface AssetDetailViewerProps {
  asset?: AssetDetailData;
  node?: NodeRecord | null;
  onClose: () => void;
  onDelete?: () => void;
  onRename?: (title: string) => void;
}

// ===== 辅助函数 =====

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// ===== 文本渲染模式 =====

export type TextRenderMode = 'auto' | 'plain' | 'markdown' | 'html';

function detectTextMode(content: string, mimeType?: string): TextRenderMode {
  if (mimeType === 'text/html' || mimeType === 'application/xhtml+xml') return 'html';
  if (mimeType === 'text/markdown') return 'markdown';
  if (/^<(?:html|!DOCTYPE|div|p|h[1-6]|section|article|table|ul|ol|blockquote)\b/i.test(content.trimStart())) return 'html';
  return 'plain';
}

export function nodeToAssetDetail(node: NodeRecord): AssetDetailData {
  const d = (node.data ?? {}) as Record<string, unknown>;
  const content = ((d.content as string) ?? '') || '';
  const nodeType = node.type;
  let kind: AssetDetailData['kind'] = 'text';
  if (nodeType === 'image') kind = 'image';
  else if (nodeType === 'video') kind = 'video';
  else if (nodeType === 'audio') kind = 'audio';
  else if (nodeType === 'script') kind = 'script';

  return {
    id: node.id,
    title: (d.title as string) ?? node.title ?? '',
    kind,
    bytes: (d.bytes as number) ?? 0,
    mimeType: (d.mimeType as string) ?? undefined,
    createdAt: (d.createdAt as number) ?? undefined,
    data: {
      kind,
      content,
      dataUrl: kind === 'image' ? content : undefined,
      url: (kind === 'video' || kind === 'audio') ? content : undefined,
      storageKey: (d.storageKey as string) ?? undefined,
      width: (d.width as number) ?? undefined,
      height: (d.height as number) ?? undefined,
      prompt: (d.prompt as string) ?? undefined,
      durationMs: (d.durationMs as number) ?? undefined,
    },
  };
}

// ===== 主组件 =====

export function AssetDetailViewer({
  asset: assetProp,
  node,
  onClose,
  onDelete,
  onRename,
}: AssetDetailViewerProps): React.ReactElement | null {
  const asset: AssetDetailData | null = assetProp ?? (node ? nodeToAssetDetail(node) : null);
  if (!asset) return null;
  return <AssetDetailViewerInner asset={asset} onClose={onClose} onDelete={onDelete} onRename={onRename} />;
}

// ===== 内部实现 =====

interface InnerProps {
  asset: AssetDetailData;
  onClose: () => void;
  onDelete?: () => void;
  onRename?: (title: string) => void;
}

function AssetDetailViewerInner({ asset, onClose, onDelete, onRename }: InnerProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const data = asset.data;
  const isImage = data.kind === 'image';
  const isVideo = data.kind === 'video';
  const isAudio = data.kind === 'audio';
  const isText = data.kind === 'text' || data.kind === 'script';

  // ===== 状态 =====
  const [textMode, setTextMode] = useState<TextRenderMode>(() => detectTextMode(data.content ?? '', asset.mimeType));
  // 始终使用 plaintext 避免语法着色（黄色高亮），模式仅用于下载文件扩展名
  const monacoLanguage = 'plaintext';

  // ===== 图片缩放/平移(统一图片查看框架) =====
  const panZoom = useImagePanZoom();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [hovering, setHovering] = useState(false); // 沉浸：控制 overlay 显隐

  const cover = isImage ? data.dataUrl : isVideo ? data.url : undefined;
  const storageKeyForHydrate = data.kind === 'text' ? undefined : data.storageKey;
  // 图片查看器使用预览图(preview)而非原图(full):原图在拖拽时父组件重渲染会触发
  // useHydratedContent 重新 fetch+解码,主线程被长任务阻塞导致严重卡顿。
  // invK=2 使 useProgressiveImage 返回 preview 尺寸(远小于原图,解码快、内存小)。
  // 非图片类型(video/audio)由 useProgressiveImage 内部回退到 useHydratedContent,行为不变。
  const hydrated = isImage
    ? useProgressiveImage(storageKeyForHydrate, cover ?? '', 2)
    : useHydratedContent(storageKeyForHydrate, cover ?? '');
  const kindLabel = t(`asset.kind${asset.kind.charAt(0).toUpperCase()}${asset.kind.slice(1)}`);
  const dim = (isImage || isVideo) && data.width ? { width: data.width, height: data.height } : null;

  // ===== 下载 =====
  const handleDownload = (): void => {
    if (isText) {
      const content = data.content ?? '';
      const ext = textMode === 'html' ? 'html' : textMode === 'markdown' ? 'md' : 'txt';
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${asset.title}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      return;
    }
    const url = hydrated || getResourceUrl(storageKeyForHydrate, 'full') || cover;
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = asset.title;
    a.target = '_blank';
    a.click();
  };

  // ===== 渲染预览区(图片分支已交由 ImageViewerStage 渲染) =====
  const renderPreview = () => {
    if (isVideo) {
      return (
        <video
          src={hydrated || cover}
          controls
          autoPlay={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          playsInline
        />
      );
    }
    if (isAudio) {
      return (
        <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: 32 }}>
          <MusicIcon size={48} color={theme.toolbar.accent} />
          <div style={{ fontSize: 14, color: '#ccc', fontWeight: 600 }}>{asset.title}</div>
          <audio src={hydrated} controls style={{ width: '100%', maxWidth: 400 }} />
        </div>
      );
    }
    if (isText) {
      return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#1e1e1e' }}>
          {/* 语言切换 — 极简 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 8px', flexShrink: 0 }}>
            {(['plain', 'markdown', 'html'] as TextRenderMode[]).map((m) => (
              <button key={m} type="button" onClick={() => setTextMode(m)} style={{
                padding: '2px 8px', borderRadius: 4, border: 'none', fontSize: 10,
                fontWeight: (textMode === 'auto' ? detectTextMode(data.content ?? '', asset.mimeType) : textMode) === m ? 600 : 400,
                color: (textMode === 'auto' ? detectTextMode(data.content ?? '', asset.mimeType) : textMode) === m ? '#fff' : '#888',
                background: (textMode === 'auto' ? detectTextMode(data.content ?? '', asset.mimeType) : textMode) === m ? theme.toolbar.accent : 'transparent',
                cursor: 'pointer', opacity: 0.8,
              }}>
                {m === 'plain' ? t('resourceViewer.plainText') : m === 'markdown' ? 'MD' : 'HTML'}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Editor
              height="100%"
              language={monacoLanguage}
              value={data.content ?? ''}
              theme="vs-dark"
              onMount={(editor) => requestAnimationFrame(() => editor.layout())}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineNumbers: 'on',
                wordWrap: 'on',
                padding: { top: 8, bottom: 16 },
                scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
                overviewRulerLanes: 0,
                renderLineHighlight: 'none',
                contextmenu: false,
                folding: false,
                glyphMargin: false,
                lineDecorationsWidth: 0,
                lineNumbersMinChars: 3,
                largeFileOptimizations: true,
                maxTokenizationLineLength: 5000,
                stopRenderingLineAfter: 5000,
                // 关闭 unicode 模糊字符告警：中文剧本内容属误报，只读文档预览无需防混淆字符检测（修复 "ambiguous unicode characters" 警告）
                unicodeHighlight: {
                  ambiguousCharacters: false,
                  invisibleCharacters: false,
                  nonBasicASCII: false,
                },
              }}
            />
          </div>
        </div>
      );
    }
    return (
      <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, opacity: 0.5 }}>
        <FileText size={40} />
        <span style={{ fontSize: 13 }}>{t('resourceViewer.noContent')}</span>
      </div>
    );
  };

  // ===== 元信息 =====
  const metaRows = [
    { label: t('assetLibrary.fileSize'), value: asset.bytes > 0 ? formatBytes(asset.bytes) : undefined },
    { label: t('assetLibrary.mimeType'), value: asset.mimeType },
    { label: t('resourceViewer.dimensions'), value: dim && dim.width ? `${dim.width} × ${dim.height}` : undefined },
    { label: t('resourceViewer.duration'), value: formatDuration(data.durationMs) },
    { label: t('assetLibrary.createdAt'), value: asset.createdAt ? new Date(asset.createdAt).toLocaleString() : undefined },
    { label: t('resourceViewer.prompt'), value: data.prompt },
  ].filter(r => !!r.value);

  const overlayOpacity = hovering ? 1 : 0;

  const stageContainerStyle: React.CSSProperties = {
    width: '100%',
    height: '75vh',
    display: 'flex',
    alignItems: 'stretch',      // ✅ 修复高度塌陷
    justifyContent: 'flex-start',
    background: '#0a0a0a',      // ✅ 深色沉浸
    position: 'relative',
    overflow: 'hidden',
  };

  // 右侧操作按钮浮层(图片/非图片分支共用)
  const actionsOverlay = (
    <div style={{
      position: 'absolute', bottom: 10, right: 10, display: 'flex', alignItems: 'center', gap: 4,
      opacity: overlayOpacity, transition: 'opacity 0.2s',
    }}>
      {onDelete && (
        <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDeleteOpen(true); }} style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: 'none', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', color: '#ff6b6b', cursor: 'pointer' }} title={t('common.delete')}>
          <Trash2 size={13} />
        </button>
      )}
      {(isImage || isVideo || isAudio || isText) && (
        <button type="button" onClick={(e) => { e.stopPropagation(); handleDownload(); }} disabled={!isText && !hydrated && !cover} style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, border: 'none', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', color: 'rgba(255,255,255,0.9)', cursor: (isText || hydrated || cover) ? 'pointer' : 'not-allowed', opacity: (isText || hydrated || cover) ? 1 : 0.4 }} title={t('common.download') || '下载'}>
          <Download size={13} />
        </button>
      )}
    </div>
  );

  // 底部元信息浮层 — 渐变 overlay(图片/非图片分支共用)
  const metaOverlay = metaRows.length > 0 ? (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      padding: '24px 12px 8px',
      background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
      opacity: overlayOpacity, transition: 'opacity 0.2s',
      pointerEvents: 'none', // 不挡鼠标
    }}>
      {metaRows.map((row) => (
        <span key={row.label} style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>
          <span style={{ opacity: 0.5 }}>{row.label}:</span> {row.value}
        </span>
      ))}
      {asset.tags && asset.tags.length > 0 && (
        <span style={{ display: 'flex', gap: 3 }}>
          {asset.tags.map((tag) => (
            <Tag key={tag} style={{ fontSize: 9, margin: 0, background: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.8)', border: 'none', lineHeight: '15px' }}>#{tag}</Tag>
          ))}
        </span>
      )}
    </div>
  ) : null;

  return (
    <>
      <Modal
        open={true}
        onCancel={onClose}
        footer={null}
        width="calc(100vw - 32px)"
        style={{ maxWidth: 1600 }}
        centered
        destroyOnHidden
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 9999,
              background: `${theme.toolbar.accent}20`, color: theme.toolbar.accent, fontWeight: 600, flexShrink: 0,
            }}>
              {kindLabel}
            </span>
            <span style={{ fontSize: 12, color: theme.toolbar.text, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => { onRename?.(titleDraft); setEditingTitle(false); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { onRename?.(titleDraft); setEditingTitle(false); }
                    if (e.key === 'Escape') setEditingTitle(false);
                  }}
                  style={{ fontSize: 12, background: 'transparent', border: `1px solid ${theme.toolbar.border}`, borderRadius: 4, color: theme.toolbar.text, padding: '1px 4px', outline: 'none', width: 160 }}
                />
              ) : (
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.title || kindLabel}</span>
              )}
              {onRename && !editingTitle && (
                <button type="button" onClick={() => { setTitleDraft(asset.title || kindLabel); setEditingTitle(true); }} style={{ display: 'inline-flex', border: 'none', background: 'transparent', color: theme.toolbar.textMuted, cursor: 'pointer', padding: 2, borderRadius: 4 }}>
                  <Pencil size={11} />
                </button>
              )}
            </span>
          </div>
        }
        closeIcon={<X size={14} style={{ cursor: 'pointer', color: 'inherit' }} onClick={onClose} />}
        styles={{
          mask: { background: 'transparent' },
          header: { marginBottom: 0, paddingBottom: 0, borderBottom: 'none' },
          body: { padding: 0 }, // ✅ 全出血
          container: { borderRadius: 12, overflow: 'hidden' },
        }}
      >
        {/* 预览区 — 深色剧场背景 */}
        {isImage ? (
          <ImageViewerStage
            src={hydrated || cover || ''}
            alt={asset.title}
            panZoom={panZoom}
            containerStyle={stageContainerStyle}
            containerProps={{
              onMouseEnter: () => setHovering(true),
              onMouseLeave: () => setHovering(false),
            }}
            onImgError={(e) => {
              // 加载失败降透明度兑底(与提示词预览台同款)
              e.currentTarget.style.opacity = '0.3';
            }}
          >
            {/* 缩放工具栏 — 悬浮半透明 */}
            <ZoomToolbar
              panZoom={panZoom}
              style={{ position: 'absolute', top: 10, left: 10, opacity: overlayOpacity, transition: 'opacity 0.2s' }}
            />
            {actionsOverlay}
            {metaOverlay}
          </ImageViewerStage>
        ) : (
          <div
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            style={{ ...stageContainerStyle, touchAction: 'auto' }}
          >
            {renderPreview()}
            {actionsOverlay}
            {metaOverlay}
          </div>
        )}
      </Modal>

      {/* 删除确认 */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t('confirm.deleteAssetTitle')}
        confirmLabel={t('home.delete')}
        cancelLabel={t('common.cancel')}
        danger
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => { setConfirmDeleteOpen(false); onDelete?.(); }}
      >
        {t('confirm.deleteAssetMessage', { count: 1 })}
      </ConfirmDialog>
    </>
  );
}