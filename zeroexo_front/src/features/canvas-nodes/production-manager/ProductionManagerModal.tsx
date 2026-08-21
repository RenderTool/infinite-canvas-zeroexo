/**
 * ProductionManagerModal - 统筹条目编辑器（Plan#29 V3）
 *
 * 严格复刻 SubjectEditorModal 基线设计（用户强约束，禁止自由发挥）：
 * - Modal 壳/主题色 = 原版：width calc(100vw-32px)、body height calc(100vh-130px)、pageBg=theme.canvas.background
 * - 三栏布局 = 原版：左栏(条目信息+导航+音色) / 中栏(剧照图库 网格/图册) / 右栏(单图详情表单)
 * - 无边线风格：背景分层(surfaceBg=theme.node.fill) + 阴影，栏间不用边框
 * - 音色 = 原版双入口：「从资产选择」(listAssets audio picker) + 本地上传；音色卡片播放/删除
 * - 实时回写：无保存按钮（与原主体编辑器一致）
 * 「状态」已废弃：条目=原状态位；剧照 prompt 字段=自由标签；条目「发送到资产」=创建提示词条目。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Select, Tooltip, Empty, App as AntdApp } from 'antd';
import {
  UserRound, MapPin, Package, Mic, Play, Pause, ListMusic, Upload as UploadIcon,
  Plus, Trash2, X, Copy, Star, LayoutGrid, Image as ImageIcon, Loader2, Send, Clapperboard,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { useHydratedContent } from '@zeroexo/plugin-nodes';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { listAssets } from '@/features/asset-picker/asset-store.js';
import type { Asset } from '@/features/asset-picker/index.js';
import { actionBtnStyle } from '@/features/asset-library/asset-library-styles.js';
import { createPrompt } from '@/features/asset-library/prompts-api.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { ImageViewerStage, ZoomToolbar, useImagePanZoom } from '@/shared/components/image-viewer.js';
import { AuthorizedImage } from '@/shared/components/authorized-media.js';
import { useAuth } from '@/features/auth/auth-store.js';
import {
  createProductionItem,
  type ProductionItem, type ProductionItemKind, type ProductionItemImage, type ProductionManagerData,
} from './production-manager-types.js';
import {
  modalHeaderStyle, modalHeaderIconStyle, modalTitleInputStyle, modalIconBtnStyle,
  ghostHoverHandlers, modalEditBtnStyle,
  previewStageStyle, previewImageStyle, coverBadgeStyle, imageCounterStyle, emptyPreviewStyle,
  filmstripStyle, thumbItemStyle, thumbImageStyle, thumbCoverBadgeStyle, thumbHoverOverlayStyle, thumbActionBtnStyle, uploadTileStyle,
  formSectionStyle, formLabelStyle, formLabelRowStyle, copyBtnStyle,
  noteInputStyle, promptBlockStyle, promptTextareaStyle, tagInputStyle,
  cardCoverStyle, stateNavItemStyle, viewSwitchBtnStyle, voiceCardStyle, pickerPanelStyle,
} from './production-editor-styles.js';

const KIND_ICON: Record<ProductionItemKind, React.ComponentType<{ size?: number | string }>> = {
  character: UserRound,
  scene: MapPin,
  prop: Package,
};

const KIND_COLOR: Record<ProductionItemKind, string> = {
  character: '#5DDCFF',
  scene: '#4ade80',
  prop: '#fbbf24',
};

export interface ProductionManagerModalProps {
  open: boolean;
  onClose: () => void;
  data: ProductionManagerData;
  onDataChange: (next: ProductionManagerData) => void;
}

export const ProductionManagerModal = memo(function ProductionManagerModal({
  open, onClose, data, onDataChange,
}: ProductionManagerModalProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message: antdMessage } = AntdApp.useApp();
  const { isAuthenticated } = useAuth();

  // 主题色（与基线一致：页面底=画布背景，表面=节点填充，禁止自造色值）
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const pageBg = theme.canvas.background;
  const surfaceBg = theme.node.fill;

  // ===== 当前活跃条目 =====
  const [activeItemId, setActiveItemId] = useState<string | null>(data.items[0]?.id ?? null);
  const activeItem = useMemo(
    () => data.items.find((i) => i.id === activeItemId) ?? data.items[0] ?? null,
    [data.items, activeItemId],
  );

  // ===== 图库视图模式 =====
  const [galleryView, setGalleryView] = useState<'grid' | 'album'>('grid');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idCounter = useRef(0);
  const panZoom = useImagePanZoom();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [voicePlaying, setVoicePlaying] = useState(false);
  const [audioAssets, setAudioAssets] = useState<Asset[]>([]);
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const voiceFileInputRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);

  // ===== 音色播放生命周期（基线同款：切换条目/关闭时停播 + 重置） =====
  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setVoicePlaying(false);
  }, [activeItem?.id]);
  useEffect(() => {
    if (!open) {
      audioRef.current?.pause();
      audioRef.current = null;
      setVoicePlaying(false);
    }
  }, [open]);
  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  const images = activeItem?.images ?? [];
  const selectedImage = useMemo(
    () => images.find((img) => img.storageKey === selectedKey) ?? null,
    [images, selectedKey],
  );

  // 切换条目时重置选中图（封面优先，否则首图）
  useEffect(() => {
    if (!activeItem) { setSelectedKey(null); return; }
    if (images.length === 0) { setSelectedKey(null); return; }
    const coverImg = activeItem.coverKey ? images.find((i) => i.storageKey === activeItem.coverKey) : undefined;
    setSelectedKey((coverImg ?? images[0]!).storageKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem?.id]);

  // 打开音色选择器时加载音频资产
  useEffect(() => {
    if (!voicePickerOpen) return;
    let cancelled = false;
    void listAssets().then((all) => {
      if (!cancelled) setAudioAssets(all.filter((a) => a.kind === 'audio'));
    }).catch(() => { /* 静默 */ });
    return () => { cancelled = true; };
  }, [voicePickerOpen]);

  // ===== 复制 =====
  const handleCopy = useCallback(async (text: string) => {
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    antdMessage.success(t('subject.copied'));
  }, [antdMessage, t]);

  // ===== 剧级字段 =====
  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onDataChange({ ...data, title: e.target.value });
  }, [data, onDataChange]);

  // ===== 条目管理 =====
  const patchActiveItem = useCallback((patch: Partial<ProductionItem>) => {
    if (!activeItem) return;
    const nextItems = data.items.map((i) => (i.id === activeItem.id ? { ...i, ...patch } : i));
    onDataChange({ ...data, items: nextItems });
  }, [data, activeItem, onDataChange]);

  const handleAddItem = useCallback((kind: ProductionItemKind) => {
    const item = createProductionItem(kind);
    onDataChange({ ...data, items: [...data.items, item] });
    setActiveItemId(item.id);
  }, [data, onDataChange]);

  const handleDeleteItem = useCallback((itemId: string) => {
    const nextItems = data.items.filter((i) => i.id !== itemId);
    onDataChange({ ...data, items: nextItems });
    if (activeItemId === itemId) setActiveItemId(nextItems[0]?.id ?? null);
  }, [data, onDataChange, activeItemId]);

  // ===== 图片导入 =====
  const handleImportImage = useCallback(async (file: File) => {
    if (!isAuthenticated) { antdMessage.warning(t('subjectCreate.loginRequired')); return; }
    const localId = `up_${++idCounter.current}`;
    setUploading((prev) => ({ ...prev, [localId]: 0 }));
    try {
      const uploaded = await uploadAsset(file, (loaded, total) => {
        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
        setUploading((prev) => ({ ...prev, [localId]: pct }));
      });
      const d = uploaded.data as { kind?: string; storageKey?: string; dataUrl?: string };
      const storageKey = d.storageKey ?? '';
      if (storageKey) {
        if (d.kind === 'image' && d.dataUrl) setLocalPreviews((prev) => ({ ...prev, [storageKey]: d.dataUrl! }));
        patchActiveItem({ images: [...images, { storageKey }] });
        setSelectedKey(storageKey);
        if (!activeItem?.coverKey) patchActiveItem({ images: [...images, { storageKey }], coverKey: storageKey });
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed'));
    } finally {
      setUploading((prev) => { const n = { ...prev }; delete n[localId]; return n; });
    }
  }, [isAuthenticated, antdMessage, t, images, patchActiveItem, activeItem]);

  // ===== 发送到资产 → 提示词条目（Plan#29 T10 资产提炼） =====
  const handleSendToAsset = useCallback(async () => {
    if (!isAuthenticated) { antdMessage.warning(t('subjectCreate.loginRequired')); return; }
    if (!activeItem) return;
    const content = (activeItem.prompt || activeItem.consistency || '').trim();
    if (!content) { antdMessage.warning(t('productionManager.noPromptToSend')); return; }
    if (!activeItem.name?.trim()) { antdMessage.warning(t('subject.aiGenerateEmptyName')); return; }
    if (sending) return;
    setSending(true);
    try {
      await createPrompt({
        title: activeItem.name.trim(),
        content,
        category: activeItem.kind === 'character' ? 'role' : activeItem.kind,
        tags: [...activeItem.aliases],
        imageKeys: activeItem.images.map((i) => i.storageKey),
      });
      antdMessage.success(t('productionManager.sentToAsset'));
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('productionManager.sendFailed'));
    } finally {
      setSending(false);
    }
  }, [isAuthenticated, antdMessage, t, sending, activeItem]);

  // ===== 单图操作 =====
  const patchImage = useCallback((storageKey: string, patch: Partial<ProductionItemImage>) => {
    patchActiveItem({ images: images.map((i) => (i.storageKey === storageKey ? { ...i, ...patch } : i)) });
  }, [images, patchActiveItem]);

  const handleRemoveImage = useCallback((storageKey: string) => {
    patchActiveItem({ images: images.filter((i) => i.storageKey !== storageKey) });
    if (activeItem?.coverKey === storageKey) patchActiveItem({ coverKey: null });
    if (selectedKey === storageKey) setSelectedKey(images.find((i) => i.storageKey !== storageKey)?.storageKey ?? null);
  }, [images, patchActiveItem, activeItem, selectedKey]);

  const handleSelectPreview = useCallback((key: string) => {
    setSelectedKey(key);
    panZoom.reset();
  }, [panZoom]);

  /** 网格卡片点击 → 进入图册模式细看 */
  const handleOpenAlbum = useCallback((key: string) => {
    setSelectedKey(key);
    panZoom.reset();
    setGalleryView('album');
  }, [panZoom]);

  const handleSetCover = useCallback((storageKey: string) => {
    patchActiveItem({ coverKey: storageKey });
  }, [patchActiveItem]);

  // ===== 音色（基线同款：资产选择 + 上传双入口） =====
  const handlePickVoiceAsset = useCallback((asset: Asset) => {
    const storageKey = asset.data.kind === 'audio' ? asset.data.storageKey ?? '' : '';
    patchActiveItem({ voice: { key: storageKey || asset.id, name: asset.title } });
    setVoicePickerOpen(false);
  }, [patchActiveItem]);

  const handleUploadVoice = useCallback(async (file: File) => {
    if (!isAuthenticated) { antdMessage.warning(t('subjectCreate.loginRequired')); return; }
    try {
      const uploaded = await uploadAsset(file);
      const d = uploaded.data as { kind?: string; storageKey?: string };
      if (d.storageKey) {
        patchActiveItem({ voice: { key: d.storageKey, name: file.name.replace(/\.[^.]+$/, '') } });
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed'));
    }
  }, [isAuthenticated, antdMessage, t, patchActiveItem]);

  const handleToggleVoicePlay = useCallback(() => {
    const voice = activeItem?.voice;
    if (!voice) return;
    const url = getResourceUrl(voice.key, 'full');
    if (!url) return;
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setVoicePlaying(false);
    }
    if (!audioRef.current.src.endsWith(url)) audioRef.current.src = url;
    if (voicePlaying) { audioRef.current.pause(); setVoicePlaying(false); }
    else { void audioRef.current.play(); setVoicePlaying(true); }
  }, [activeItem, voicePlaying]);

  // 分组（左栏导航按 演员/场景/道具 分组展示）
  const groups = useMemo(() => {
    const order: ProductionItemKind[] = ['character', 'scene', 'prop'];
    return order.map((kind) => ({ kind, items: data.items.filter((i) => i.kind === kind) }));
  }, [data.items]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="calc(100vw - 32px)"
      centered
      destroyOnHidden
      styles={{ body: { padding: 0, height: 'calc(100vh - 130px)', overflow: 'hidden', background: pageBg } }}
    >
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* ===== 标题栏（提示词页面同款 modalHeaderStyle） ===== */}
        <div style={modalHeaderStyle(theme)}>
          <span style={modalHeaderIconStyle(theme)}>
            <Clapperboard size={16} />
          </span>
          <input
            value={data.title}
            onChange={handleTitleChange}
            placeholder={t('productionManager.editorTitle')}
            style={modalTitleInputStyle(theme)}
          />
          <span style={{ fontSize: 11, color: textMuted, flexShrink: 0 }}>
            {t('productionManager.itemTotal', { count: data.items.length })}
          </span>
          {/* Plan#29 T10: 发送到资产 → 提示词条目（当前选中条目） */}
          <button
            type="button"
            {...ghostHoverHandlers(theme)}
            style={{ ...modalEditBtnStyle(theme), flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, color: accent }}
            onClick={() => void handleSendToAsset()}
            title={t('productionManager.sendToAsset')}
          >
            {sending ? <Loader2 size={13} style={{ animation: 'zeroexo-spin 1s linear infinite' }} /> : <Send size={13} />}
            {t('productionManager.sendToAsset')}
          </button>
        </div>

        {/* ===== 三栏主体（无边线：背景分层，栏间不用边框） ===== */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, color: textPrimary }}>
          {/* 左栏：条目信息 + 导航 + 音色 */}
          <div style={{ width: 232, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16, padding: '16px 12px 16px 20px', overflowY: 'auto', minHeight: 0 }} className="zx-thin-scroll">
            {/* 条目基础信息（名称/类型/别名） */}
            {activeItem && (
              <>
                <div style={formSectionStyle()}>
                  <label style={formLabelStyle(theme)}>{t('productionManager.name')}</label>
                  <input value={activeItem.name} onChange={(e) => patchActiveItem({ name: e.target.value })} style={tagInputStyle(theme)} />
                </div>
                <div style={formSectionStyle()}>
                  <label style={formLabelStyle(theme)}>{t('productionManager.kind')}</label>
                  <Select
                    value={activeItem.kind}
                    onChange={(v) => patchActiveItem({ kind: v })}
                    size="small"
                    style={{ width: '100%' }}
                    options={[
                      { value: 'character', label: t('entity.character') },
                      { value: 'scene', label: t('entity.scene') },
                      { value: 'prop', label: t('entity.prop') },
                    ]}
                  />
                </div>
                <div style={formSectionStyle()}>
                  <label style={formLabelStyle(theme)}>{t('productionManager.aliases')}</label>
                  <input
                    value={activeItem.aliases.join(', ')}
                    onChange={(e) => patchActiveItem({ aliases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    placeholder={t('productionManager.aliasesPlaceholder')}
                    style={tagInputStyle(theme)}
                  />
                </div>
                {/* 一致性（提示词页面同款表单） */}
                <div style={formSectionStyle()}>
                  <label style={formLabelStyle(theme)}>
                    <Mic size={12} style={{ opacity: 0.6 }} />
                    {t('subject.consistencyLabel')}
                  </label>
                  <textarea
                    value={activeItem.consistency}
                    onChange={(e) => patchActiveItem({ consistency: e.target.value })}
                    placeholder={t('subject.consistencyPlaceholder')}
                    style={noteInputStyle(theme)}
                    rows={4}
                  />
                </div>
                {/* 出场集 chips（展示标记） */}
                {activeItem.episodeIds.length > 0 && (
                  <div style={formSectionStyle()}>
                    <label style={formLabelStyle(theme)}>{t('subject.episodesLabel')}</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {activeItem.episodeIds.map((ep) => (
                        <span
                          key={ep}
                          title={ep}
                          style={{ fontSize: 11, color: textMuted, background: surfaceBg, borderRadius: 999, padding: '2px 10px', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        >
                          {ep}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* 条目导航（分组，无边线：背景分层 + 色块指示） */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
              {groups.map((g) => {
                const GroupIcon = KIND_ICON[g.kind];
                if (g.items.length === 0) return null;
                return (
                  <div key={g.kind} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ ...formLabelStyle(theme), color: KIND_COLOR[g.kind], marginBottom: 2 }}>
                      <GroupIcon size={11} />
                      {t(`entity.${g.kind}`)} · {g.items.length}
                    </label>
                    {g.items.map((item, i) => (
                      <ItemNavItem
                        key={item.id}
                        index={i}
                        name={item.name}
                        count={item.images.length}
                        isActive={activeItem?.id === item.id}
                        accent={accent}
                        surfaceBg={surfaceBg}
                        textMuted={textMuted}
                        deletable
                        onClick={() => setActiveItemId(item.id)}
                        onDelete={() => handleDeleteItem(item.id)}
                      />
                    ))}
                  </div>
                );
              })}
              <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                {(['character', 'scene', 'prop'] as ProductionItemKind[]).map((kind) => {
                  const Icon = KIND_ICON[kind];
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => handleAddItem(kind)}
                      {...ghostHoverHandlers(theme)}
                      title={t(`productionManager.add_${kind}`)}
                      style={{ ...modalEditBtnStyle(theme), flex: 1, justifyContent: 'center', gap: 4, padding: '0 6px' }}
                    >
                      <Plus size={12} /><Icon size={12} />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 音色（音频资产引用，基线同款双入口） */}
            {activeItem && (
              <div style={formSectionStyle()}>
                <label style={formLabelStyle(theme)}>
                  <Mic size={12} style={{ opacity: 0.6 }} />
                  {t('subject.voiceLabel')}
                  <span style={{ fontSize: 10, opacity: 0.6, textTransform: 'none' }}>({t('subject.voiceOptional')})</span>
                </label>
                {activeItem.voice ? (
                  <div style={voiceCardStyle(surfaceBg)}>
                    <button
                      type="button"
                      {...ghostHoverHandlers(theme)}
                      style={{ ...modalIconBtnStyle(theme, true), width: 28, height: 28, borderRadius: '50%', flexShrink: 0 }}
                      onClick={handleToggleVoicePlay}
                      title={voicePlaying ? t('common.cancel') : t('subject.playVoice')}
                    >
                      {voicePlaying ? <Pause size={12} /> : <Play size={12} />}
                    </button>
                    <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {activeItem.voice.name}
                    </span>
                    <Tooltip title={t('common.delete')}>
                      <button
                        type="button"
                        {...ghostHoverHandlers(theme)}
                        style={modalIconBtnStyle(theme, false)}
                        onClick={() => patchActiveItem({ voice: undefined })}
                      >
                        <X size={13} />
                      </button>
                    </Tooltip>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setVoicePickerOpen(true)}
                      {...ghostHoverHandlers(theme)}
                      style={{ ...modalEditBtnStyle(theme), flex: 1, justifyContent: 'center' }}
                    >
                      <ListMusic size={13} />
                      {t('subject.voiceFromAsset')}
                    </button>
                    <Tooltip title={t('subject.voiceUpload')}>
                      <button
                        type="button"
                        onClick={() => voiceFileInputRef.current?.click()}
                        {...ghostHoverHandlers(theme)}
                        style={modalEditBtnStyle(theme)}
                      >
                        <UploadIcon size={13} />
                      </button>
                    </Tooltip>
                    <input ref={voiceFileInputRef} type="file" accept="audio/*" style={{ display: 'none' }}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUploadVoice(f); e.target.value = ''; }} />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 中栏：剧照图库区 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, padding: '16px 16px 16px 8px' }}>
            {/* 图库工具栏 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12, flexShrink: 0 }}>
              <span style={{ ...modalTitleInputStyle(theme), flex: 1, minWidth: 80, fontSize: 15, display: 'flex', alignItems: 'center' }}>
                {activeItem ? (activeItem.name || t('productionManager.unnamed')) : t('productionManager.selectToEdit')}
              </span>
              <span style={{ fontSize: 12, color: textMuted, flexShrink: 0 }}>
                {t('subject.imagesCount', { count: images.length })}
              </span>
              <div style={{ display: 'flex', gap: 2, background: surfaceBg, borderRadius: 10, padding: 3, flexShrink: 0 }}>
                <Tooltip title={t('subject.gridView')}>
                  <button type="button" style={viewSwitchBtnStyle(galleryView === 'grid', accent, textMuted)} onClick={() => setGalleryView('grid')}>
                    <LayoutGrid size={15} />
                  </button>
                </Tooltip>
                <Tooltip title={t('subject.albumView')}>
                  <button type="button" style={viewSwitchBtnStyle(galleryView === 'album', accent, textMuted)} onClick={() => setGalleryView('album')}>
                    <ImageIcon size={15} />
                  </button>
                </Tooltip>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                {...ghostHoverHandlers(theme)}
                style={modalEditBtnStyle(theme)}
              >
                <UploadIcon size={13} />
                {t('subject.importImage')}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                onChange={(e) => { const fs = e.target.files; if (fs) Array.from(fs).forEach((f) => void handleImportImage(f)); e.target.value = ''; }} />
            </div>

            {/* 图库内容 */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {galleryView === 'grid' ? (
                /* 网格模式：资产浏览器同款卡片（asset-card.tsx 1:1） */
                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }} className="zx-thin-scroll">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20, alignContent: 'start' }}>
                    {images.map((img, i) => (
                      <ItemImageCard
                        key={img.storageKey}
                        storageKey={img.storageKey}
                        localPreview={localPreviews[img.storageKey]}
                        ordinal={i + 1}
                        isCover={activeItem?.coverKey === img.storageKey}
                        hasTag={!!img.prompt}
                        theme={theme}
                        onClick={() => handleOpenAlbum(img.storageKey)}
                        onDelete={() => handleRemoveImage(img.storageKey)}
                      />
                    ))}
                    {/* 上传中占位 */}
                    {Object.entries(uploading).map(([id, pct]) => (
                      <div key={id} style={{ ...cardCoverStyle(theme), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <Loader2 size={20} style={{ color: accent, animation: 'zeroexo-spin 1s linear infinite' }} />
                        <span style={{ fontSize: 11, color: textMuted }}>{pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* 图册模式：提示词页面同款预览区（prompt-create-page.tsx 1:1） */
                <AlbumPanel
                  images={images}
                  selectedKey={selectedKey}
                  coverKey={activeItem?.coverKey ?? null}
                  localPreviews={localPreviews}
                  theme={theme}
                  panZoom={panZoom}
                  t={t}
                  uploading={Object.keys(uploading).length > 0}
                  onSelect={handleSelectPreview}
                  onSetCover={handleSetCover}
                  onRemove={handleRemoveImage}
                  onAddFiles={(files) => Array.from(files).forEach((f) => void handleImportImage(f))}
                />
              )}
            </div>
          </div>

          {/* 右栏：条目提示词 + 单图详情（提示词页面同款表单） */}
          <div style={{ width: 380, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18, padding: '16px 20px 16px 8px', overflowY: 'auto', minHeight: 0 }} className="zx-thin-scroll">
            {activeItem && (
              <>
                {/* 条目提炼提示词（发送到资产的内容源） */}
                <div style={formSectionStyle()}>
                  <div style={formLabelRowStyle()}>
                    <label style={formLabelStyle(theme)}>
                      <Send size={11} style={{ opacity: 0.6 }} />
                      {t('productionManager.prompt')}
                    </label>
                    <button type="button" onClick={() => void handleCopy(activeItem.prompt || activeItem.consistency)} style={copyBtnStyle(theme)} title={t('subject.copyPrompt')}>
                      <Copy size={12} />
                      {t('subject.copyPrompt')}
                    </button>
                  </div>
                  <textarea
                    value={activeItem.prompt}
                    onChange={(e) => patchActiveItem({ prompt: e.target.value })}
                    placeholder={t('productionManager.promptPlaceholder')}
                    style={{ ...noteInputStyle(theme), minHeight: 72 }}
                  />
                </div>
                {/* 备注 */}
                <div style={formSectionStyle()}>
                  <label style={formLabelStyle(theme)}>{t('productionManager.note')}</label>
                  <input value={activeItem.note} onChange={(e) => patchActiveItem({ note: e.target.value })} style={tagInputStyle(theme)} />
                </div>
              </>
            )}
            {/* 单图详情（自由标签 = 原 prompt 表单） */}
            {selectedImage ? (
              <SelectedImageDetail
                image={selectedImage}
                ordinal={images.findIndex((i) => i.storageKey === selectedImage.storageKey) + 1}
                theme={theme}
                t={t}
                onPromptChange={(v) => patchImage(selectedImage.storageKey, { prompt: v })}
                onCopy={() => void handleCopy(selectedImage.prompt ?? '')}
              />
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={<span style={{ color: textMuted, fontSize: 12 }}>{t('subject.noImageSelected')}</span>} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 音色资产选择器（基线同款：固定浮层 + pickerPanelStyle） */}
      {voicePickerOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 40000, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setVoicePickerOpen(false)}>
          <div style={pickerPanelStyle(theme.toolbar.background)} onClick={(e) => e.stopPropagation()}>
            <div style={modalHeaderStyle(theme)}>
              <span style={{ fontSize: 13, fontWeight: 600, color: textPrimary }}>{t('subject.voiceFromAsset')}</span>
              <button
                type="button"
                {...ghostHoverHandlers(theme)}
                style={{ ...modalIconBtnStyle(theme, false), marginLeft: 'auto' }}
                onClick={() => setVoicePickerOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0 12px 12px' }} className="zx-thin-scroll">
              {audioAssets.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: textMuted }}>{t('subject.noVoiceAssets')}</div>
              ) : (
                audioAssets.map((a) => (
                  <div key={a.id} onClick={() => handlePickVoiceAsset(a)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', transition: 'background 0.12s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = surfaceBg; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <ListMusic size={14} style={{ color: accent, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
});

// ===== 网格图片卡片（资产浏览器 asset-card.tsx AssetCardGrid 1:1） =====

interface ItemImageCardProps {
  storageKey: string;
  localPreview?: string;
  ordinal: number;
  isCover: boolean;
  hasTag: boolean;
  theme: ReturnType<typeof useTheme>['theme'];
  onClick: () => void;
  onDelete: () => void;
}

const ItemImageCard = memo(function ItemImageCard({
  storageKey, localPreview, ordinal, isCover, hasTag, theme, onClick, onDelete,
}: ItemImageCardProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const fallback = localPreview ?? getResourceUrl(storageKey, 'preview') ?? '';
  const hydrated = useHydratedContent(storageKey, fallback);
  const [imgError, setImgError] = useState(false);

  return (
    <div
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, width: '100%', cursor: 'pointer' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {/* 封面区域（资产浏览器同款：239.2/135.4 + 底色 + 边框） */}
      <div style={cardCoverStyle(theme)}>
        {hydrated && !imgError ? (
          <img
            src={hydrated}
            alt=""
            loading="lazy"
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={() => setImgError(true)}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ImageIcon size={40} color={theme.toolbar.textMuted} />
          </div>
        )}
        {/* Hover 遮罩（资产浏览器同款） */}
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.05)',
          opacity: hovered ? 1 : 0, transition: 'opacity 0.3s', pointerEvents: 'none',
        }} />
        {/* 封面角标（提示词页面胶卷条同款 16px 圆点） */}
        {isCover && (
          <div style={{ ...thumbCoverBadgeStyle, zIndex: 2 }}>
            <Star size={8} fill="currentColor" />
          </div>
        )}
      </div>

      {/* 底部信息（资产浏览器同款两行） */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, paddingLeft: 4, paddingRight: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', height: 24 }}>
          <span style={{
            fontSize: 14, lineHeight: '22px', fontWeight: 500, color: theme.toolbar.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
          }}>
            {t('subject.imageOrdinal', { n: ordinal })}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: theme.toolbar.textMuted, fontWeight: 500 }}>
            {hasTag ? t('subject.promptReady') : t('subject.promptEmpty')}
          </span>
        </div>
      </div>

      {/* Hover 操作浮条（资产浏览器同款：删除） */}
      {hovered && (
        <div style={{
          position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4,
          background: theme.toolbar.background, border: `1px solid ${theme.toolbar.border}`,
          borderRadius: 8, padding: '2px 4px', boxShadow: '0 2px 8px rgba(0,0,0,0.12)', zIndex: 10,
        }} onClick={(e) => e.stopPropagation()}>
          <Tooltip title={t('common.delete')}>
            <button type="button" onClick={onDelete} style={{ ...actionBtnStyle(), color: theme.toolbar.danger }}>
              <Trash2 size={13} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
});

// ===== 图册模式（提示词页面 prompt-create-page.tsx 预览区 1:1） =====

function AlbumPanel({ images, selectedKey, coverKey, localPreviews, theme, panZoom, t, uploading, onSelect, onSetCover, onRemove, onAddFiles }: {
  images: ProductionItemImage[];
  selectedKey: string | null;
  coverKey: string | null;
  localPreviews: Record<string, string>;
  theme: ReturnType<typeof useTheme>['theme'];
  panZoom: ReturnType<typeof useImagePanZoom>;
  t: ReturnType<typeof useTranslation>['t'];
  uploading: boolean;
  onSelect: (key: string) => void;
  onSetCover: (key: string) => void;
  onRemove: (key: string) => void;
  onAddFiles: (files: FileList) => void;
}) {
  const idx = images.findIndex((i) => i.storageKey === selectedKey);
  const current = idx >= 0 ? images[idx] : undefined;
  const rawSrc = current
    ? (localPreviews[current.storageKey] || getResourceUrl(current.storageKey, 'full') || '')
    : '';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      {current ? (
        <ImageViewerStage
          src={rawSrc}
          alt=""
          panZoom={panZoom}
          containerStyle={previewStageStyle(theme)}
          imgStyle={previewImageStyle}
          onImgError={(e) => { e.currentTarget.style.opacity = '0.3'; }}
        >
          {coverKey === current.storageKey && (
            <div style={coverBadgeStyle}>
              <Star size={11} fill="currentColor" />
              {t('subject.coverImage')}
            </div>
          )}
          <div style={imageCounterStyle}>
            {idx + 1} / {images.length}
          </div>
          <ZoomToolbar panZoom={panZoom} orientation="vertical" style={{ position: 'absolute', bottom: 10, right: 10 }} />
        </ImageViewerStage>
      ) : (
        <div style={previewStageStyle(theme)}>
          <div style={emptyPreviewStyle}>
            <span style={{ fontSize: 12, opacity: 0.5 }}>{t('subject.noImages')}</span>
          </div>
        </div>
      )}

      {/* 缩略图胶卷条（提示词页面同款 76×76，hover 设封面/删除，设封面唯一入口） */}
      <div style={filmstripStyle()}>
        {images.map((img) => {
          const thumbSrc = localPreviews[img.storageKey] || getResourceUrl(img.storageKey, 'preview') || '';
          const isActive = img.storageKey === selectedKey;
          const isCover = coverKey === img.storageKey;
          return (
            <div
              key={img.storageKey}
              style={thumbItemStyle(theme, isActive, isCover)}
              onClick={() => onSelect(img.storageKey)}
            >
              <AuthorizedImage
                src={thumbSrc}
                alt=""
                style={thumbImageStyle}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              {isCover && (
                <div style={thumbCoverBadgeStyle}>
                  <Star size={8} fill="currentColor" />
                </div>
              )}
              <div
                style={thumbHoverOverlayStyle}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; }}
              >
                {!isCover && (
                  <button
                    type="button"
                    style={thumbActionBtnStyle}
                    onClick={(e) => { e.stopPropagation(); onSetCover(img.storageKey); }}
                    title={t('subject.setAsCover')}
                  >
                    <ImageIcon size={11} />
                  </button>
                )}
                <Tooltip title={t('promptCreate.remove')}>
                  <button
                    type="button"
                    style={thumbActionBtnStyle}
                    onClick={(e) => { e.stopPropagation(); onRemove(img.storageKey); }}
                  >
                    <X size={11} />
                  </button>
                </Tooltip>
              </div>
            </div>
          );
        })}
        {/* 上传按钮（提示词页面同款加号 tile） */}
        <label style={uploadTileStyle(theme)}>
          <input
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files && e.target.files.length > 0) onAddFiles(e.target.files); e.target.value = ''; }}
          />
          {uploading ? <Loader2 size={20} style={{ animation: 'zeroexo-spin 1s linear infinite' }} /> : <Plus size={22} />}
        </label>
      </div>
    </div>
  );
}

// ===== 右栏单图详情（提示词页面同款表单；prompt 字段 = 自由标签） =====

function SelectedImageDetail({ image, ordinal, theme, t, onPromptChange, onCopy }: {
  image: ProductionItemImage;
  ordinal: number;
  theme: ReturnType<typeof useTheme>['theme'];
  t: ReturnType<typeof useTranslation>['t'];
  onPromptChange: (v: string) => void;
  onCopy: () => void;
}) {
  return (
    <div style={{ ...formSectionStyle(), flex: 1, minHeight: 0 }}>
      <div style={formLabelRowStyle()}>
        <label style={formLabelStyle(theme)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
          {t('productionManager.stills')}
        </label>
        <button
          type="button"
          onClick={onCopy}
          style={copyBtnStyle(theme)}
          title={t('subject.copyPrompt')}
        >
          <Copy size={12} />
          {t('subject.copyPrompt')}
        </button>
      </div>
      <div style={{ ...promptBlockStyle(theme), flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <textarea
          value={image.prompt ?? ''}
          onChange={(e) => onPromptChange(e.target.value)}
          placeholder={t('productionManager.tagPlaceholder')}
          style={{ ...promptTextareaStyle(theme), flex: 1 }}
        />
      </div>
      <span style={{ fontSize: 11, color: theme.toolbar.textMuted, marginTop: 10 }}>
        {t('subject.imageOrdinal', { n: ordinal })}
      </span>
    </div>
  );
}

// ===== 条目导航条目（无边线：背景分层，删除按钮在条目上 hover 显示） =====

interface ItemNavItemProps {
  index: number;
  name: string;
  count: number;
  isActive: boolean;
  accent: string;
  surfaceBg: string;
  textMuted: string;
  deletable: boolean;
  onClick: () => void;
  onDelete: () => void;
}

function ItemNavItem({ index, name, count, isActive, accent, surfaceBg, textMuted, deletable, onClick, onDelete }: ItemNavItemProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={stateNavItemStyle(isActive, accent, surfaceBg)}
    >
      <span style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, background: isActive ? accent : 'rgba(128,128,128,0.2)', color: isActive ? '#fff' : 'inherit',
      }}>
        {index + 1}
      </span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, fontWeight: isActive ? 600 : 400 }}>{name}</span>
      <span style={{ fontSize: 10, color: textMuted, flexShrink: 0 }}>{count}</span>
      {deletable && hovered && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', color: textMuted, flexShrink: 0 }}>
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}
