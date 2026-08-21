/**
 * ProductionManagerModal - 统筹条目编辑器（Plan#29 V3，用户敲定布局）
 *
 * 布局 = 提示词 Modal 同款骨架（小图标 + 标题，无大图标块）+ 四栏：
 * ① 左栏 = 实体 List（演员/场景/道具分组导航 + 新增）
 * ② 中栏 content = 图册（网格/图册切换 + 胶卷条 + 封面）
 * ③ 右栏 = 单图详情（提示词页面同款，prompt 字段 = 自由标签）
 * ④ 最右栏 = 实体详情（名称 → 类型 → 别名 → 一致性 → 出场集 → 音色 → 备注 → 提炼提示词）
 * 主题色与基线一致（pageBg=canvas.background / surfaceBg=node.fill），无边线：背景分层 + 阴影。
 * 音色 = 基线双入口（从资产选择 + 本地上传）；实时回写，无保存按钮。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Select, Tooltip, Empty, Input, App as AntdApp } from 'antd';
import { Virtuoso } from 'react-virtuoso';
import {
  Mic, Play, Pause, ListMusic, Upload as UploadIcon,
  Plus, X, LayoutGrid, Image as ImageIcon, Loader2, Send, Rabbit, Search,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { listAssets } from '@/features/asset-picker/asset-store.js';
import type { Asset } from '@/features/asset-picker/index.js';
import { createPrompt } from '@/features/asset-library/prompts-api.js';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { useImagePanZoom } from '@/shared/components/image-viewer.js';
import { useAuth } from '@/features/auth/auth-store.js';
import {
  createProductionItem,
  type ProductionItem, type ProductionItemImage, type ProductionItemKind, type ProductionManagerData,
} from './production-manager-types.js';
import {
  modalHeaderStyle, modalTitleInputStyle, modalIconBtnStyle,
  ghostHoverHandlers, modalEditBtnStyle,
  formSectionStyle, formLabelStyle, formLabelRowStyle,
  noteInputStyle, tagInputStyle, cardCoverStyle, viewSwitchBtnStyle, voiceCardStyle, pickerPanelStyle,
} from './production-editor-styles.js';
import { ItemImageCard, AlbumPanel, SelectedImageDetail, ItemNavItem, KIND_ICON } from './production-manager-panels.js';

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

  // 主题色（基线同源，禁止自造色值）
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const pageBg = theme.canvas.background;
  const surfaceBg = theme.node.fill;

  // ===== 当前活跃条目 =====
  const activeItem = useMemo(
    () => data.items.find((i) => i.id === data.activeItemId) ?? data.items[0] ?? null,
    [data.items, data.activeItemId],
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
  const [searchText, setSearchText] = useState('');

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
    // 主动递增命名：同类型计数 +1（演员 1 / 场景 2 / 道具 3）
    const sameKindCount = data.items.filter((i) => i.kind === kind).length;
    item.name = `${t(`entity.${kind}`)} ${sameKindCount + 1}`;
    onDataChange({ ...data, items: [...data.items, item], activeItemId: item.id });
  }, [data, onDataChange, t]);

  const handleDeleteItem = useCallback((itemId: string) => {
    const nextItems = data.items.filter((i) => i.id !== itemId);
    const nextActive = data.activeItemId === itemId ? (nextItems[0]?.id ?? null) : data.activeItemId;
    onDataChange({ ...data, items: nextItems, activeItemId: nextActive ?? undefined });
  }, [data, onDataChange]);

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
        const nextImages = [...images, { storageKey, tags: [] as string[] }];
        patchActiveItem(activeItem?.coverKey ? { images: nextImages } : { images: nextImages, coverKey: storageKey });
        setSelectedKey(storageKey);
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed'));
    } finally {
      setUploading((prev) => { const n = { ...prev }; delete n[localId]; return n; });
    }
  }, [isAuthenticated, antdMessage, t, images, patchActiveItem, activeItem]);

  // ===== 发送到资产 → 提示词条目（主动选用当前选中剧照的提示词，无需手动提炼） =====
  const handleSendToAsset = useCallback(async () => {
    if (!isAuthenticated) { antdMessage.warning(t('subjectCreate.loginRequired')); return; }
    if (!activeItem) return;
    const content = (selectedImage?.prompt || activeItem.consistency || '').trim();
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
  }, [isAuthenticated, antdMessage, t, sending, activeItem, selectedImage]);

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

  // 分组 + 搜索筛选（名称/别名匹配；flatRows 供 Virtuoso 虚拟化）
  const groups = useMemo(() => {
    const kw = searchText.trim().toLowerCase();
    const match = (it: ProductionItem) => !kw
      || it.name.toLowerCase().includes(kw)
      || it.aliases.some((a) => a.toLowerCase().includes(kw));
    const order: ProductionItemKind[] = ['character', 'scene', 'prop'];
    return order.map((kind) => ({ kind, items: data.items.filter((i) => i.kind === kind && match(i)) }));
  }, [data.items, searchText]);

  type NavRow = { type: 'header'; kind: ProductionItemKind; count: number } | { type: 'item'; item: ProductionItem; index: number };
  const flatRows = useMemo<NavRow[]>(() => {
    const rows: NavRow[] = [];
    for (const g of groups) {
      if (g.items.length === 0) continue;
      rows.push({ type: 'header', kind: g.kind, count: g.items.length });
      g.items.forEach((item, i) => rows.push({ type: 'item', item, index: i }));
    }
    return rows;
  }, [groups]);

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
      {/* 铁律（Modal 不得透传画布）：React portal 的合成事件沿 React 虚拟树（而非 DOM 树）冒泡——
          本 Modal 挂载在节点视图内，不阻断则 pointer/wheel 会冒泡至节点/画布处理器，
          误触发画布平移/缩放。在内容根阻断冒泡，Modal 内部交互不受影响。 */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        {/* ===== 标题栏（提示词 Modal 同款：小图标 + 标题，无大图标块） ===== */}
        <div style={modalHeaderStyle(theme)}>
          <Rabbit size={15} style={{ color: accent, flexShrink: 0 }} />
          <input
            value={data.title}
            onChange={handleTitleChange}
            placeholder={t('productionManager.editorTitle')}
            style={modalTitleInputStyle(theme)}
          />
          <span style={{ fontSize: 11, color: textMuted, flexShrink: 0 }}>
            {t('productionManager.itemTotal', { count: data.items.length })}
          </span>
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

        {/* ===== 四栏主体（无边线：背景分层，栏间仅用留白分隔） ===== */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0, color: textPrimary }}>
          {/* ① 左栏：实体 List（搜索框 + 虚拟化列表 + 添加按钮固定底部，不被列表顶出） */}
          <div style={{ width: 230, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: '16px 12px 16px 20px', minHeight: 0 }}>
            <Input
              size="small"
              prefix={<Search size={13} style={{ opacity: 0.5 }} />}
              placeholder={t('productionManager.searchPlaceholder')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
            />
            {flatRows.length > 0 ? (
              <Virtuoso
                data={flatRows}
                style={{ flex: 1, minHeight: 0 }}
                itemContent={(_, row) => row.type === 'header' ? (
                  <label style={{ ...formLabelStyle(theme), marginBottom: 2, marginTop: 6 }}>
                    {(() => { const GroupIcon = KIND_ICON[row.kind]; return <GroupIcon size={11} style={{ opacity: 0.6 }} />; })()}
                    {t(`entity.${row.kind}`)} · {row.count}
                  </label>
                ) : (
                  <ItemNavItem
                    index={row.index}
                    name={row.item.name}
                    count={row.item.images.length}
                    isActive={activeItem?.id === row.item.id}
                    accent={accent}
                    surfaceBg={surfaceBg}
                    textMuted={textMuted}
                    deletable
                    tDelete={t('common.delete')}
                    onClick={() => onDataChange({ ...data, activeItemId: row.item.id })}
                    onDelete={() => handleDeleteItem(row.item.id)}
                  />
                )}
              />
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: textMuted, fontSize: 12 }}>
                {t('productionManager.emptyItems')}
              </div>
            )}
            {/* 添加按钮：固定底部（flexShrink 0），条目再多也不会顶出视口 */}
            <div style={{ display: 'flex', gap: 4, flexShrink: 0, paddingTop: 4 }}>
              {(['character', 'scene', 'prop'] as ProductionItemKind[]).map((kind) => {
                const Icon = KIND_ICON[kind];
                return (
                  <Tooltip key={kind} title={t(`productionManager.add_${kind}`)}>
                    <button
                      type="button"
                      onClick={() => handleAddItem(kind)}
                      {...ghostHoverHandlers(theme)}
                      style={{ ...modalEditBtnStyle(theme), flex: 1, justifyContent: 'center', gap: 4, padding: '0 6px' }}
                    >
                      <Plus size={12} /><Icon size={12} />
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </div>

          {/* ② 中栏 content：图册 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, padding: '16px 16px 16px 8px' }}>
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

            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {galleryView === 'grid' ? (
                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }} className="zx-thin-scroll">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20, alignContent: 'start' }}>
                    {images.map((img, i) => (
                      <ItemImageCard
                        key={img.storageKey}
                        storageKey={img.storageKey}
                        localPreview={localPreviews[img.storageKey]}
                        ordinal={i + 1}
                        isCover={activeItem?.coverKey === img.storageKey}
                        tags={img.tags}
                        theme={theme}
                        onClick={() => handleOpenAlbum(img.storageKey)}
                        onDelete={() => handleRemoveImage(img.storageKey)}
                      />
                    ))}
                    {Object.entries(uploading).map(([id, pct]) => (
                      <div key={id} style={{ ...cardCoverStyle(theme), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <Loader2 size={20} style={{ color: accent, animation: 'zeroexo-spin 1s linear infinite' }} />
                        <span style={{ fontSize: 11, color: textMuted }}>{pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
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

          {/* ③ 右栏：单图详情（提示词页面同款） */}
          <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 18, padding: '16px 12px 16px 8px', overflowY: 'auto', minHeight: 0 }} className="zx-thin-scroll">
            {selectedImage ? (
              <SelectedImageDetail
                image={selectedImage}
                ordinal={images.findIndex((i) => i.storageKey === selectedImage.storageKey) + 1}
                theme={theme}
                t={t}
                onPromptChange={(v) => patchImage(selectedImage.storageKey, { prompt: v })}
                onNoteChange={(v) => patchImage(selectedImage.storageKey, { note: v })}
                onTagsChange={(tags) => patchImage(selectedImage.storageKey, { tags })}
                onCopy={() => void handleCopy(selectedImage.prompt ?? '')}
              />
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={<span style={{ color: textMuted, fontSize: 12 }}>{t('subject.noImageSelected')}</span>} />
              </div>
            )}
          </div>

          {/* ④ 最右栏：实体详情（顺序按社区习惯：名称→类型→别名→一致性→出场集→音色→备注→提炼提示词） */}
          <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px 16px 8px', overflowY: 'auto', minHeight: 0 }} className="zx-thin-scroll">
            {!activeItem ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: textMuted, fontSize: 12 }}>
                {t('productionManager.selectToEdit')}
              </div>
            ) : (
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
                <div style={formSectionStyle()}>
                  <label style={formLabelStyle(theme)}>{t('subject.consistencyLabel')}</label>
                  <textarea
                    value={activeItem.consistency}
                    onChange={(e) => patchActiveItem({ consistency: e.target.value })}
                    placeholder={t('subject.consistencyPlaceholder')}
                    style={noteInputStyle(theme)}
                    rows={4}
                  />
                </div>
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
                {/* 音色（基线同款双入口） */}
                <div style={formSectionStyle()}>
                  <div style={formLabelRowStyle()}>
                    <label style={formLabelStyle(theme)}>
                      <Mic size={12} style={{ opacity: 0.6 }} />
                      {t('subject.voiceLabel')}
                      <span style={{ fontSize: 10, opacity: 0.6, textTransform: 'none' }}>({t('subject.voiceOptional')})</span>
                    </label>
                  </div>
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
                <div style={formSectionStyle()}>
                  <label style={formLabelStyle(theme)}>{t('productionManager.note')}</label>
                  <input value={activeItem.note} onChange={(e) => patchActiveItem({ note: e.target.value })} style={tagInputStyle(theme)} />
                </div>
              </>
            )}
          </div>
        </div>

        {/* 音色资产选择器（基线同款：固定浮层 + pickerPanelStyle；置于隔离层内防透传） */}
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
      </div>
    </Modal>
  );
});
