/**
 * AssetDetailViewer - 全项目统一资产/节点详情查看器（Modal）
 *
 * 支持 image / video / audio / text / script 五种类型预览。
 * 图片支持缩放、拖拽、触摸双指缩放。
 * 可接收 asset 对象或 node 记录，统一展示。
 * 沉浸模式：全出血 + 深色剧场背景 + 悬浮工具栏。
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download, X, Check, Copy,
  Music as MusicIcon, FileText, Trash2, Pencil, ImagePlus,
} from 'lucide-react';
import { Modal, Tag } from 'antd';
import Editor from '@monaco-editor/react';
import type { NodeRecord } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';
import { useHydratedContent, usePreviewImage } from '@zeroexo/plugin-nodes';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { ConfirmDialog } from '@/shared/components/confirm-dialog.js';
import { ImageViewerStage, ZoomToolbar, useImagePanZoom } from '@/shared/components/image-viewer.js';

// ===== 类型定义 =====

export interface AssetDetailData {
  id: string;
  title: string;
  /** prompt：提示词资产（用提示词链路画布展示，与图片/文档同属一套查看器框架的变体） */
  kind: 'text' | 'image' | 'video' | 'audio' | 'script' | 'prompt';
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
  /** 发送到画布(征集 #87 验收轮:层级面板资产模式点击资源后由此发送;不传则不显示按钮) */
  onSendToCanvas?: () => void;
  /**
   * 提示词资产的舞台内容（kind='prompt' 时渲染）。
   * 由调用方注入而非本文件 import —— shared 组件不能反向依赖 features/asset-library
   * （asset-library-modals 会从 shared/components 取组件，直接 import 会成环）。
   */
  renderPromptStage?: (ctx: { editing: boolean }) => React.ReactNode;
  /** 是否可编辑（文本/提示词）：显示底部出血栏的「编辑」按钮 */
  editable?: boolean;
  /** 编辑态（受控；不传则内部自管） */
  editing?: boolean;
  /** 编辑态变更（点击编辑/取消时回调） */
  onEditingChange?: (editing: boolean) => void;
  /** 编辑态下的保存（底部出血栏「保存」按钮） */
  onSave?: () => void | Promise<void>;
  /** 保存中（禁用保存按钮） */
  saving?: boolean;
  /** 副本（提示词：创建副本；不传则不显示按钮） */
  onDuplicate?: () => void;
  /** 文本内容编辑回调（文本类型在编辑态下可直编） */
  onContentChange?: (content: string) => void;
  /** 弹窗层级——默认不传!项目全局 zIndexPopupBase=20000 且 antd 嵌套弹窗自动升层,
   *  手动传小值(如 1000/2000)会被外层 Modal 压住(征集 #80 实测教训);仅特殊场景显式传大值 */
  zIndex?: number;
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
  onSendToCanvas,
  renderPromptStage,
  editable,
  editing,
  onEditingChange,
  onSave,
  saving,
  onDuplicate,
  onContentChange,
  zIndex,
}: AssetDetailViewerProps): React.ReactElement | null {
  const asset: AssetDetailData | null = assetProp ?? (node ? nodeToAssetDetail(node) : null);
  if (!asset) return null;
  return (
    <AssetDetailViewerInner
      asset={asset}
      onClose={onClose}
      onDelete={onDelete}
      onRename={onRename}
      onSendToCanvas={onSendToCanvas}
      renderPromptStage={renderPromptStage}
      editable={editable}
      editing={editing}
      onEditingChange={onEditingChange}
      onSave={onSave}
      saving={saving}
      onDuplicate={onDuplicate}
      onContentChange={onContentChange}
      zIndex={zIndex}
    />
  );
}

// ===== 内部实现 =====

interface InnerProps {
  asset: AssetDetailData;
  onClose: () => void;
  onDelete?: () => void;
  onRename?: (title: string) => void;
  onSendToCanvas?: () => void;
  renderPromptStage?: (ctx: { editing: boolean }) => React.ReactNode;
  editable?: boolean;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onSave?: () => void | Promise<void>;
  saving?: boolean;
  onDuplicate?: () => void;
  onContentChange?: (content: string) => void;
  zIndex?: number;
}

function AssetDetailViewerInner({
  asset,
  onClose,
  onDelete,
  onRename,
  onSendToCanvas,
  renderPromptStage,
  editable,
  editing: editingProp,
  onEditingChange,
  onSave,
  saving,
  onDuplicate,
  onContentChange,
  zIndex,
}: InnerProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const data = asset.data;
  const isImage = data.kind === 'image';
  const isVideo = data.kind === 'video';
  const isAudio = data.kind === 'audio';
  const isText = data.kind === 'text' || data.kind === 'script';
  const isPrompt = data.kind === 'prompt';

  // ===== 状态 =====
  const [textMode, setTextMode] = useState<TextRenderMode>(() => detectTextMode(data.content ?? '', asset.mimeType));
  // 黑屏修复(征集 #84):full 原图 onLoad(已解码)后才淡出 blur-up 占位层
  const [fullReady, setFullReady] = useState(false);
  // 始终使用 plaintext 避免语法着色（黄色高亮），模式仅用于下载文件扩展名
  const monacoLanguage = 'plaintext';

  // ===== 图片缩放/平移(统一图片查看框架) =====
  const panZoom = useImagePanZoom();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [hovering, setHovering] = useState(false); // 沉浸：控制 overlay 显隐

  // ===== 编辑态（文本/提示词）：外部受控优先，否则内部自管 =====
  const [editingSelf, setEditingSelf] = useState(false);
  const isEditing = editingProp ?? editingSelf;
  const setEditing = useCallback((v: boolean) => {
    if (editingProp === undefined) setEditingSelf(v);
    onEditingChange?.(v);
  }, [editingProp, onEditingChange]);
  /** 可编辑的类型：文本（含剧本）与提示词 */
  const canEdit = editable === true;

  const cover = isImage ? data.dataUrl : isVideo ? data.url : undefined;
  const storageKeyForHydrate = data.kind === 'text' ? undefined : data.storageKey;
  // 图片查看器一律使用原图(征集 #75 用户拍板;#77 三档图片契约重申:原图只在图片浏览器)。
  // 三档契约(征集 #77):画布节点/堆叠详情 → 自适应档(thumb/preview,永不拉原图);
  // 图片浏览器(本组件) → 高清原图档。
  // 历史背景(2026-08-27 改回):曾为避免拖拽时父组件重渲染触发重新 fetch+解码卡顿,
  // 用 useProgressiveImage(invK=2) 降为 preview 级;现优先清晰度,卡顿问题另从渲染层优化。
  // 非图片类型(video/audio)行为不变,均由 useHydratedContent 重建全量内容。
  // mediaPriority(征集 #84):full 原图 fetch 插队,避免被画布节点批量拉取饿死导致长时间黑屏。
  const hydrated = useHydratedContent(storageKeyForHydrate, cover ?? '', { mediaPriority: true });
  // blur-up 占位(征集 #84):full 原图 fetch+解码期间先展示 preview 档,不再整块黑屏;
  // 旧图无变体时 usePreviewImage 内部兜底链自动回退,失败静默(占位层缺席不影响主图)。
  const placeholder = usePreviewImage(storageKeyForHydrate, cover ?? '', { mediaPriority: true });
  // 切换资产时重置占位层状态
  useEffect(() => { setFullReady(false); }, [data.storageKey]);
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
              // 编辑态切换时重挂载：退出编辑需丢弃未保存改动（Monaco 是非受控的，
              // value 不变时不会回退到 data.content，必须靠 key 强制重建）
              key={isEditing ? 'edit' : 'view'}
              height="100%"
              language={monacoLanguage}
              value={data.content ?? ''}
              theme="vs-dark"
              // 编辑态下把正文变更回传调用方保存（与提示词画布同一套「编辑→保存」语义）
              onChange={(value) => { if (isEditing) onContentChange?.(value ?? ''); }}
              onMount={(editor) => requestAnimationFrame(() => editor.layout())}
              options={{
                readOnly: !isEditing,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineNumbers: 'on',
                wordWrap: 'on',
                padding: { top: 8, bottom: 16 },
                scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
                overviewRulerLanes: 0,
                renderLineHighlight: isEditing ? 'all' : 'none',
                // 编辑态放开右键菜单（复制/粘贴），查看态保持精简
                contextmenu: isEditing,
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
    // 2026-08-29：与提示词页面统一尺寸 —— Modal body 高 calc(100vh - 140px)，
    // 舞台撑满 body，图片/文档/提示词三种资产打开后尺寸完全一致。
    height: '100%',
    display: 'flex',
    alignItems: 'stretch',      // ✅ 修复高度塌陷
    justifyContent: 'flex-start',
    background: '#0a0a0a',      // ✅ 深色沉浸
    position: 'relative',
    overflow: 'hidden',
    isolation: 'isolate',       // blur-up 占位层 zIndex:-1 需要独立堆叠上下文,避免被背景色盖住(征集 #84)
  };

  // blur-up 占位层:绝对定位 + zIndex -1,垫在主图下方;full 原图解码完成后淡出
  const placeholderLayer = isImage && placeholder ? (
    <div aria-hidden style={{
      position: 'absolute', inset: 0, zIndex: -1,
      backgroundImage: `url("${placeholder}")`,
      backgroundSize: 'cover', backgroundPosition: 'center',
      filter: 'blur(24px)', transform: 'scale(1.08)',
      opacity: fullReady ? 0 : 1, transition: 'opacity 0.3s',
      pointerEvents: 'none',
    }} />
  ) : null;

  // 主图加载完成:恢复错误态降掉的透明度;仅当完成的 src 就是 full 原图(hydrated)时才淡出占位层
  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    e.currentTarget.style.opacity = '';
    if (hydrated && e.currentTarget.getAttribute('src') === hydrated) setFullReady(true);
  };
  // 加载失败隐藏主图层,blur-up 占位层兜底,不再永久黑屏(征集 #84)
  const handleImgError = (e: React.SyntheticEvent<HTMLImageElement>): void => {
    e.currentTarget.style.opacity = '0';
  };

  // 底部出血栏按钮统一样式（图片/文档/提示词共用一套，保证视觉同框架）
  const actionBtn = (color: string, enabled = true): React.CSSProperties => ({
    width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 6, border: 'none', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)',
    color, cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.4,
  });

  // 右侧操作按钮浮层(图片/文档/提示词分支共用)
  // 编辑态常显（保存/取消必须随时可点），查看态沿用沉浸 hover 显隐。
  const actionsOverlay = (
    <div style={{
      position: 'absolute', bottom: 10, right: 10, display: 'flex', alignItems: 'center', gap: 4,
      opacity: isEditing ? 1 : overlayOpacity, transition: 'opacity 0.2s',
    }}>
      {isEditing ? (
        <>
          {/* 编辑按钮作为切换开关：编辑态高亮常驻，再点一次即退出编辑（放弃未保存改动） */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setEditing(false); }}
            style={{ ...actionBtn(theme.toolbar.accent), background: 'rgba(0,0,0,0.72)' }}
            title={t('common.exitEdit') || '退出编辑'}
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void onSave?.(); }}
            disabled={saving}
            style={actionBtn(theme.toolbar.accent, !saving)}
            title={t('common.save') || '保存'}
          >
            <Check size={13} />
          </button>
        </>
      ) : (
        <>
          {/* 编辑：文本（含剧本）与提示词 —— 与提示词画布同一套编辑语义 */}
          {canEdit && (
            <button type="button" onClick={(e) => { e.stopPropagation(); setEditing(true); }} style={actionBtn('rgba(255,255,255,0.9)')} title={t('common.edit') || '编辑'}>
              <Pencil size={13} />
            </button>
          )}
          {/* 副本：提示词资产创建副本 */}
          {onDuplicate && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onDuplicate(); }} style={actionBtn('rgba(255,255,255,0.9)')} title={t('promptCreate.generateSimilar') || '副本'}>
              <Copy size={13} />
            </button>
          )}
          {onSendToCanvas && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onSendToCanvas(); }} style={actionBtn(theme.toolbar.accent)} title={t('assetLibrary.sendToCanvas')}>
              <ImagePlus size={13} />
            </button>
          )}
          {onDelete && (
            <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDeleteOpen(true); }} style={actionBtn('#ff6b6b')} title={t('common.delete')}>
              <Trash2 size={13} />
            </button>
          )}
          {(isImage || isVideo || isAudio || isText) && (
            <button type="button" onClick={(e) => { e.stopPropagation(); handleDownload(); }} disabled={!isText && !hydrated && !cover} style={actionBtn('rgba(255,255,255,0.9)', isText || !!hydrated || !!cover)} title={t('common.download') || '下载'}>
              <Download size={13} />
            </button>
          )}
        </>
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
        style={{ maxWidth: 1400 }}
        centered
        destroyOnHidden
        {...(zIndex !== undefined ? { zIndex } : {})}
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
          // ✅ 全出血；高度与提示词页面一致（calc(100vh - 140px)），两种资产打开后尺寸相同
          body: { padding: 0, height: 'calc(100vh - 140px)', overflow: 'hidden' },
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
            onImgLoad={handleImgLoad}
            onImgError={handleImgError}
          >
            {/* blur-up 占位层(zIndex:-1 垫底,full 原图就绪后淡出) */}
            {placeholderLayer}
            {/* 缩放工具栏 — 悬浮半透明 */}
            <ZoomToolbar
              panZoom={panZoom}
              style={{ position: 'absolute', top: 10, left: 10, opacity: overlayOpacity, transition: 'opacity 0.2s' }}
            />
            {actionsOverlay}
            {metaOverlay}
          </ImageViewerStage>
        ) : isPrompt ? (
          /* ===== 提示词资产：同一套查看器框架，只是展示区换成提示词链路画布 ===== */
          <div
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            style={{ ...stageContainerStyle, touchAction: 'auto' }}
          >
            {renderPromptStage?.({ editing: isEditing }) ?? (
              <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, opacity: 0.5 }}>
                <FileText size={40} />
                <span style={{ fontSize: 13 }}>{t('resourceViewer.noContent')}</span>
              </div>
            )}
            {actionsOverlay}
            {/* 提示词不渲染底部渐变元信息栏：链路画布已承载全部信息，
                渐变层会盖住画布内的编辑浮层（标题/分类/备注） */}
          </div>
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