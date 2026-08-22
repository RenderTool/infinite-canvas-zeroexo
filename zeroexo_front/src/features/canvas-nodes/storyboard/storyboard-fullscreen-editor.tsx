/**
 * StoryboardFullscreenEditor - 分镜全屏编辑（Req5b：表格为基础壳 + 步骤视图承载图册/提示词/镜头信息）
 *
 * 全屏以 StoryboardTable 编辑态为基础壳（readOnly=false，EDIT 11 列行内编辑）：
 * - 顶部：共享 header（分镜切换器 + 集切换 + 视图切换 表格↔步骤 + 增删 + 关闭），表格与步骤视图共用
 * - 表格视图：StoryboardTable 编辑态（主体列/操作列展开，分页 + 全选 + 批量删除）
 * - 步骤视图：图册/网格模块 + 提示词（SelectedImageDetail）+ 右侧镜头信息（行表单化），配色沿用无边线分层
 * 步骤视图 = 升级版单镜视图（节点与全屏均不再出现单镜），header 分镜切换器驱动当前镜头
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip, App as AntdApp, ConfigProvider, Select, Empty, Button } from 'antd';
import {
  ChevronLeft, ChevronRight, Plus, Trash2, X, ListVideo, Loader2, LayoutGrid, Image as ImageIcon, AtSign, Table, Columns3, CheckSquare, Link2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { Z_INDEX } from '@/shared/constants/z-index.js';
import { FullscreenDropdown } from './components/FullscreenDropdown';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import { useAuth } from '@/features/auth/auth-store.js';
import { useImagePanZoom } from '@/shared/components/image-viewer.js';
import { ItemImageCard, AlbumPanel, SelectedImageDetail } from '../production-manager/production-manager-panels';
import {
  modalHeaderStyle, modalIconBtnStyle, ghostHoverHandlers, modalEditBtnStyle,
  formSectionStyle, formLabelStyle, noteInputStyle, tagInputStyle, cardCoverStyle, viewSwitchBtnStyle,
} from '../production-manager/production-editor-styles';
import type { ProductionItemImage } from '../production-manager/production-manager-types';
import { KIND_COLOR } from '../production-manager/production-manager-types';
import type { Shot, StoryboardEntity, EntityKind, AiSubject, EpisodeStatus } from './storyboard-types';
import { formatLighting, formatEnvironment, entityDisplayName } from './storyboard-utils';
import { StoryboardTable } from './components/StoryboardTable';
import { ShotSizePickerModal } from './components/ShotSizePickerModal';

/** 剧管条目引用源（C3 @ 引用：搜索栏数据源） */
export interface PmRefItem {
  id: string;
  name: string;
  kind: EntityKind;
  aliases?: string[];
}

export interface StoryboardFullscreenEditorProps {
  open: boolean;
  onClose: () => void;
  /** 当前集分镜列表 */
  shots: Shot[];
  onUpdateShot: (shotId: string, patch: Partial<Shot>) => void;
  onAddShot: () => void;
  /** 直接删除（内部已确认） */
  onDeleteShot: (shotId: string) => void;
  /** 集数切换（未关联剧本时为 undefined） */
  episodes?: Array<{ id: string; title?: string }>;
  activeEpisodeId?: string;
  onEpisodeChange?: (epId: string) => void;
  /** 剧管条目（@ 引用连入剧管，Plan#33 C3） */
  pmItems?: PmRefItem[];

  // ===== 表格基础壳所需（readOnly=false 编辑态） =====
  entities: StoryboardEntity[];
  aiSubjects?: AiSubject[];
  subjectStatesByEntity?: Record<string, Array<{ id: string; name: string }>>;
  pmItemsByEntity?: Record<string, Array<{ id: string; name: string; kind: string }>>;
  status: EpisodeStatus;
  progress?: number;
  nodeId: string;
  linkedScript: { id: string; title?: string } | undefined;
  activeEpisode: { id: string; title?: string } | undefined;
  /** 剧本节点列表（关联剧本/切换关联下拉数据源，全屏内可直接关联） */
  scriptNodes?: Array<{ id: string; title?: string }>;
  scriptOptionLabel?: (n: { id: string; title?: string }) => string;
  /** 打开关联剧本向导弹窗 */
  onAssociateScript?: (scriptId: string) => void;
}

/** 全屏表格分页尺寸（编辑态行高较大，略小于节点内 8） */
const PAGE_SIZE = 10;

export const StoryboardFullscreenEditor = memo(function StoryboardFullscreenEditor({
  open, onClose, shots, onUpdateShot, onAddShot, onDeleteShot, episodes, activeEpisodeId, onEpisodeChange, pmItems,
  entities, aiSubjects, subjectStatesByEntity, pmItemsByEntity, status, progress, nodeId, linkedScript, activeEpisode,
  scriptNodes = [], scriptOptionLabel, onAssociateScript,
}: StoryboardFullscreenEditorProps): ReactElement | null {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message: antdMessage, modal: antdModal } = AntdApp.useApp();
  const { isAuthenticated } = useAuth();

  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const pageBg = theme.canvas.background;
  const surfaceBg = theme.node.fill;
  const cardBorder = theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  // ===== 视图两态（步骤视图 = 升级版单镜；全屏以表格为默认壳） =====
  const [viewMode, setViewMode] = useState<'table' | 'step'>('table');

  // ===== 当前分镜（纯视图态 activeIndex，不落 node.data；header 切换器驱动） =====
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    if (activeIndex >= shots.length) setActiveIndex(shots.length > 0 ? shots.length - 1 : 0);
  }, [shots.length, activeIndex]);
  const shot = shots[Math.min(activeIndex, shots.length - 1)] ?? null;

  // ===== 图库视图（图册为首选，与剧管一致；步骤视图内容） =====
  const [galleryView, setGalleryView] = useState<'grid' | 'album'>('album');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const idCounter = useRef(0);
  const panZoom = useImagePanZoom();

  const images: ProductionItemImage[] = useMemo(
    () => (shot?.images ?? []).map((i) => ({ storageKey: i.storageKey, prompt: i.prompt, note: i.note, tags: i.tags ?? [] })),
    [shot],
  );
  const selectedImage = useMemo(
    () => images.find((img) => img.storageKey === selectedKey) ?? null,
    [images, selectedKey],
  );

  // 切换分镜时重置选中图（首张为默认封面）
  useEffect(() => {
    if (!shot) { setSelectedKey(null); return; }
    setSelectedKey(images[0]?.storageKey ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot?.id]);

  // ===== 表格基础壳分页 / 选择（与步骤视图隔离的本地态） =====
  const totalPages = Math.max(1, Math.ceil(shots.length / PAGE_SIZE));
  const [currentPage, setCurrentPage] = useState(1);
  const paginatedShots = shots.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [selectedShotIds, setSelectedShotIds] = useState<Set<string>>(new Set());
  const [cameraOpenId, setCameraOpenId] = useState<string | null>(null);
  const [cameraRect, setCameraRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionShotId, setMentionShotId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerShotId, setPickerShotId] = useState<string | null>(null);

  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);
  useEffect(() => { setCurrentPage(1); }, [activeEpisodeId]);

  const handleToggleSelect = useCallback((shotId: string) => {
    setSelectedShotIds((prev) => { const n = new Set(prev); n.has(shotId) ? n.delete(shotId) : n.add(shotId); return n; });
  }, []);
  const handleToggleSelectAll = useCallback(() => {
    setSelectedShotIds((prev) => (prev.size === shots.length ? new Set() : new Set(shots.map((s) => s.id))));
  }, [shots]);
  const handleTableDelete = useCallback((shotId: string) => {
    const num = shots.find((s) => s.id === shotId)?.number;
    antdModal.confirm({
      centered: true,
      okType: 'danger',
      zIndex: Z_INDEX.FULLSCREEN_MODAL,
      title: t('storyboardFullscreenEditor.deleteShot'),
      content: t('storyboardFullscreenEditor.confirmDeleteShot', { number: num }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      onOk: () => onDeleteShot(shotId),
    });
  }, [shots, antdModal, t, onDeleteShot]);
  const handleBatchDelete = useCallback(() => {
    const count = selectedShotIds.size;
    if (count === 0) return;
    antdModal.confirm({
      centered: true,
      okType: 'danger',
      zIndex: Z_INDEX.FULLSCREEN_MODAL,
      title: t('storyboard.batchDeleteShots'),
      content: t('storyboard.confirmDeleteShots', { count }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      onOk: () => {
        selectedShotIds.forEach((id) => onDeleteShot(id));
        setSelectedShotIds(new Set());
      },
    });
  }, [selectedShotIds, antdModal, t, onDeleteShot]);
  const handleTableMentionSelect = useCallback((entity: StoryboardEntity) => {
    if (!mentionShotId) return;
    const desc = shots.find((s) => s.id === mentionShotId)?.description ?? '';
    onUpdateShot(mentionShotId, { description: `${desc}@${entity.name}` });
    setMentionOpen(false); setMentionShotId(null);
  }, [shots, onUpdateShot, mentionShotId]);

  // 表格 → 步骤：把当前选中行同步为步骤视图当前镜头
  const handleSwitchView = useCallback(() => {
    if (viewMode === 'table') {
      if (selectedRowId) {
        const idx = shots.findIndex((s) => s.id === selectedRowId);
        if (idx >= 0) setActiveIndex(idx);
      }
      setViewMode('step');
    } else {
      setViewMode('table');
    }
  }, [viewMode, selectedRowId, shots]);

  // ===== 分镜补丁（实时回写 node.data，无保存按钮） =====
  const patchShot = useCallback((patch: Partial<Shot>) => {
    if (shot) onUpdateShot(shot.id, patch);
  }, [shot, onUpdateShot]);

  const patchImage = useCallback((storageKey: string, patch: Partial<ProductionItemImage>) => {
    if (!shot) return;
    const imgs = shot.images ?? [];
    patchShot({ images: imgs.map((i) => (i.storageKey === storageKey ? { ...i, ...patch } : i)) });
  }, [shot, patchShot]);

  // ===== 图片导入（剧管同款：上传进度 + 本地预览回显） =====
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
        const imgs = shot?.images ?? [];
        patchShot({ images: [...imgs, { storageKey, tags: [] }] });
        setSelectedKey(storageKey);
      }
    } catch (err) {
      antdMessage.error(err instanceof Error ? err.message : t('subjectCreate.saveFailed'));
    } finally {
      setUploading((prev) => { const n = { ...prev }; delete n[localId]; return n; });
    }
  }, [isAuthenticated, antdMessage, t, shot, patchShot]);

  const handleRemoveImage = useCallback((storageKey: string) => {
    if (!shot) return;
    const imgs = shot.images ?? [];
    const next = imgs.filter((i) => i.storageKey !== storageKey);
    patchShot({ images: next });
    if (selectedKey === storageKey) setSelectedKey(next[0]?.storageKey ?? null);
  }, [shot, patchShot, selectedKey]);

  /** 设封面（剧管语义）：移至首位 = 单镜默认图 */
  const handleSetCover = useCallback((storageKey: string) => {
    if (!shot) return;
    const imgs = shot.images ?? [];
    const idx = imgs.findIndex((i) => i.storageKey === storageKey);
    if (idx <= 0) return;
    patchShot({ images: [imgs[idx]!, ...imgs.filter((i) => i.storageKey !== storageKey)] });
  }, [shot, patchShot]);

  const handleSelectPreview = useCallback((key: string) => {
    setSelectedKey(key);
    panZoom.reset();
  }, [panZoom]);

  const handleCopy = useCallback(async (text: string) => {
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    antdMessage.success(t('subject.copied'));
  }, [antdMessage, t]);

  // ===== 分镜切换 / 增删 =====
  const handlePrev = useCallback(() => setActiveIndex((a) => Math.max(0, a - 1)), []);
  const handleNext = useCallback(() => setActiveIndex((a) => Math.min(shots.length - 1, a + 1)), [shots.length]);
  const handleAdd = useCallback(() => {
    const before = shots.length;
    onAddShot();
    setActiveIndex(before);
    setCurrentPage(Math.max(1, Math.ceil((before + 1) / PAGE_SIZE)));
  }, [shots.length, onAddShot]);
  const handleDelete = useCallback(() => {
    if (!shot) return;
    antdModal.confirm({
      centered: true,
      okType: 'danger',
      zIndex: Z_INDEX.FULLSCREEN_MODAL,
      title: t('storyboardFullscreenEditor.deleteShot'),
      content: t('storyboardFullscreenEditor.confirmDeleteShot', { number: shot.number }),
      okText: t('common.delete'),
      cancelText: t('common.cancel'),
      onOk: () => onDeleteShot(shot.id),
    });
  }, [shot, antdModal, t, onDeleteShot]);

  // ===== 分镜行表单辅助（双兼容字段字符串化展示/编辑） =====
  const envText = shot ? formatEnvironment(shot.environment) : '';
  const lightText = shot ? formatLighting(shot.lighting) : '';

  // ===== C3 @ 引用剧管（搜索栏 + 分组平铺列表） =====
  const [refOpen, setRefOpen] = useState(false);
  const [refSearch, setRefSearch] = useState('');
  const refs = useMemo(() => (shot?.entities ?? []).filter(Boolean), [shot]);
  const linkedCardIds = useMemo(
    () => new Set(refs.map((e) => (typeof e === 'string' ? '' : e.cardId)).filter(Boolean) as string[]),
    [refs],
  );
  const refGroups = useMemo(() => {
    const q = refSearch.trim().toLowerCase();
    const list = (pmItems ?? []).filter((it) => !q || it.name.toLowerCase().includes(q) || (it.aliases ?? []).some((a) => a.toLowerCase().includes(q)));
    const order: EntityKind[] = ['character', 'scene', 'prop'];
    return order.map((kind) => ({ kind, items: list.filter((it) => it.kind === kind) })).filter((g) => g.items.length > 0);
  }, [pmItems, refSearch]);
  const handleRefSelect = useCallback((item: PmRefItem) => {
    if (!shot) return;
    const cur = shot.entities ?? [];
    if (cur.some((e) => typeof e !== 'string' && e.cardId === item.id)) { setRefOpen(false); return; }
    patchShot({ entities: [...cur, { entityId: item.id, mention: item.name, cardId: item.id }] });
    setRefOpen(false); setRefSearch('');
  }, [shot, patchShot]);
  const handleRefRemove = useCallback((index: number) => {
    if (!shot) return;
    patchShot({ entities: (shot.entities ?? []).filter((_, i) => i !== index) });
  }, [shot, patchShot]);

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={formSectionStyle()}>
      <label style={formLabelStyle(theme)}>{label}</label>
      {children}
    </div>
  );
  const sectionTitle = (text: string) => (
    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: accent, marginTop: 4 }}>{text}</span>
  );

  if (!open) return null;

  return createPortal(
    // 真全屏覆盖层:自制 fixed overlay(Z_INDEX.FULLSCREEN=30000),antd 弹层(Dropdown/Tooltip/Modal)
    // 由 ConfigProvider 提升到 40000,保证景别取景器等弹层显示在全屏之上
    <ConfigProvider theme={{ token: { zIndexPopupBase: 40000 } }}>
    <div style={overlayStyle(pageBg)}>
      {/* 事件阻断：全屏挂载于 body，不阻断则事件冒泡至画布平移/缩放 */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        {/* ===== 标题栏（表格/步骤共享）：分镜切换器 + 集切换 + 视图切换 + 增删 + 关闭 ===== */}
        <div style={modalHeaderStyle(theme)}>
          <ListVideo size={15} style={{ color: accent, flexShrink: 0 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <Tooltip title={t('storyboardFullscreenEditor.prevShot')}>
              <button type="button" onClick={handlePrev} disabled={shots.length <= 1}
                style={{ ...modalIconBtnStyle(theme, false), opacity: shots.length <= 1 ? 0.35 : 1 }}>
                <ChevronLeft size={14} />
              </button>
            </Tooltip>
            <span style={{ fontSize: 12, color: textMuted, minWidth: 84, textAlign: 'center', whiteSpace: 'nowrap' }}>
              {shot ? t('storyboardFullscreenEditor.shotCount', { current: activeIndex + 1, total: shots.length }) : t('storyboardFullscreenEditor.noShots')}
            </span>
            <Tooltip title={t('storyboardFullscreenEditor.nextShot')}>
              <button type="button" onClick={handleNext} disabled={shots.length <= 1}
                style={{ ...modalIconBtnStyle(theme, false), opacity: shots.length <= 1 ? 0.35 : 1 }}>
                <ChevronRight size={14} />
              </button>
            </Tooltip>
          </div>
          {episodes && episodes.length > 0 && activeEpisodeId && onEpisodeChange && (
            <Select
              size="small"
              value={activeEpisodeId}
              onChange={onEpisodeChange}
              style={{ width: 180, flexShrink: 0 }}
              options={episodes.map((ep, idx) => ({
                value: ep.id,
                label: ep.title || t('storyboard.episodeLabel', { number: idx + 1 }),
              }))}
            />
          )}
          {/* 关联剧本/切换关联（全屏内直接可关联，无需退出全屏） */}
          <FullscreenDropdown
            onSelect={(key) => {
              if (key === '__none') return;
              onAssociateScript?.(key);
            }}
            options={linkedScript
              ? (scriptNodes.filter((n) => n.id !== linkedScript.id).length > 0
                ? scriptNodes.filter((n) => n.id !== linkedScript.id).map((n) => ({ key: n.id, label: scriptOptionLabel ? scriptOptionLabel(n) : (n.title ?? n.id) }))
                : [{ key: '__none', label: t('storyboard.noOtherScriptNodes'), disabled: true }])
              : (scriptNodes.length > 0
                ? scriptNodes.map((n) => ({ key: n.id, label: scriptOptionLabel ? scriptOptionLabel(n) : (n.title ?? n.id) }))
                : [{ key: '__none', label: t('storyboard.noScriptNodesHint'), disabled: true }])}
          >
            <Button size="small" type="text" icon={<Link2 size={14} />} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, flexShrink: 0, color: textPrimary }}>
              {linkedScript ? (scriptOptionLabel ? scriptOptionLabel(linkedScript) : (linkedScript.title ?? '')) : t('storyboard.associateScript')}
            </Button>
          </FullscreenDropdown>
          {/* 视图切换：表格 ↔ 步骤（步骤视图 = 升级版单镜） */}
          <Tooltip title={viewMode === 'table' ? t('storyboard.switchToStepView') : t('storyboard.switchToTableView')}>
            <button type="button" onClick={handleSwitchView}
              style={{ ...modalIconBtnStyle(theme, false), flexShrink: 0 }}>
              {viewMode === 'table' ? <Table size={15} /> : <Columns3 size={15} />}
            </button>
          </Tooltip>
          <span style={{ flex: 1 }} />
          <button type="button" {...ghostHoverHandlers(theme)} onClick={handleAdd}
            style={{ ...modalEditBtnStyle(theme), display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <Plus size={13} />
            {t('storyboardFullscreenEditor.addShot')}
          </button>
          <button type="button" {...ghostHoverHandlers(theme)} onClick={handleDelete} disabled={!shot}
            style={{ ...modalEditBtnStyle(theme), display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, color: theme.toolbar.danger, opacity: shot ? 1 : 0.35 }}>
            <Trash2 size={13} />
            {t('storyboardFullscreenEditor.deleteShot')}
          </button>
          <Tooltip title={t('common.close')}>
            <button type="button" {...ghostHoverHandlers(theme)} onClick={onClose} style={modalIconBtnStyle(theme, false)}>
              <X size={15} />
            </button>
          </Tooltip>
        </div>

        {viewMode === 'table' ? (
          /* ===== 表格视图（基础壳）：StoryboardTable 编辑态 + 底部全选/批量删除/分页 ===== */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0, color: textPrimary }}>
              <StoryboardTable
                readOnly={false}
                shots={shots}
                paginatedShots={paginatedShots}
                selectedRowId={selectedRowId}
                onRowSelect={setSelectedRowId}
                selectedShotIds={selectedShotIds}
                onToggleSelect={handleToggleSelect}
                onDeleteShot={handleTableDelete}
                onUpdateShot={onUpdateShot}
                cameraOpenId={cameraOpenId}
                cameraRect={cameraRect}
                onCameraOpen={(id, r) => { setCameraOpenId(id); setCameraRect(r); }}
                onCameraClose={() => { setCameraOpenId(null); setCameraRect(null); }}
                entities={entities}
                aiSubjects={aiSubjects}
                subjectStatesByEntity={subjectStatesByEntity}
                pmItemsByEntity={pmItemsByEntity}
                mentionOpen={mentionOpen}
                mentionShotId={mentionShotId}
                onMentionSelect={handleTableMentionSelect}
                onMentionOpen={(id) => { setMentionShotId(id); setMentionOpen(true); }}
                onShotTypeClick={(id) => { setPickerShotId(id); setPickerOpen(true); }}
                status={status}
                progress={progress}
                nodeId={nodeId}
                linkedScript={linkedScript}
                activeEpisode={activeEpisode}
                activeEpisodeId={activeEpisodeId ?? ''}
              />
            </div>
            {/* 底栏：镜头计数 + 全选/批量删除 + 分页 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderTop: `1px solid ${cardBorder}`, flexShrink: 0 }}>
              <Button
                size="small"
                type="text"
                icon={selectedShotIds.size === shots.length && shots.length > 0 ? <X size={13} /> : <CheckSquare size={13} />}
                onClick={handleToggleSelectAll}
                style={{ fontSize: 12, color: selectedShotIds.size > 0 ? accent : textMuted }}
              >
                {selectedShotIds.size === shots.length && shots.length > 0 ? t('storyboard.deselectAll') : t('storyboard.selectAll')}
              </Button>
              <span style={{ fontSize: 11, color: textMuted }}>
                {t('storyboard.shotCountSummary', { count: shots.length })}
                {selectedShotIds.size > 0 ? ` · ${t('storyboard.selectedShots', { count: selectedShotIds.size })}` : ''}
              </span>
              {selectedShotIds.size > 0 && (
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<Trash2 size={13} />}
                  onClick={handleBatchDelete}
                  style={{ fontSize: 12, color: '#ff4d4f' }}
                >
                  {t('storyboard.batchDeleteShotsCount', { count: selectedShotIds.size })}
                </Button>
              )}
              <span style={{ flex: 1 }} />
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Button size="small" type="text" disabled={currentPage <= 1}
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    style={{ fontSize: 11, padding: '0 4px', minWidth: 24, height: 22, color: textMuted }}>
                    ‹
                  </Button>
                  <span style={{ fontSize: 11, color: textMuted, whiteSpace: 'nowrap', padding: '0 4px' }}>
                    {currentPage} / {totalPages}
                  </span>
                  <Button size="small" type="text" disabled={currentPage >= totalPages}
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    style={{ fontSize: 11, padding: '0 4px', minWidth: 24, height: 22, color: textMuted }}>
                    ›
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ===== 步骤视图（升级版单镜）：图册/网格模块 + 提示词 + 右侧镜头信息 ===== */
          <div style={{ flex: 1, display: 'flex', minHeight: 0, color: textPrimary }}>
            {/* ① 中栏：单镜图册/图库（一镜对多图） */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, padding: '16px 16px 16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12, flexShrink: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: textPrimary, flex: 1, minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {shot ? `${t('storyboardShotView.shot')} ${shot.number}` : t('storyboardFullscreenEditor.noShots')}
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
                  <ImageIcon size={13} />
                  {t('subject.importImage')}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                  onChange={(e) => { const fs = e.target.files; if (fs) Array.from(fs).forEach((f) => void handleImportImage(f)); e.target.value = ''; }} />
              </div>

              {!shot ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={<span style={{ color: textMuted, fontSize: 12 }}>{t('storyboardFullscreenEditor.noShots')}</span>} />
                </div>
              ) : galleryView === 'grid' ? (
                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0 }} className="zx-thin-scroll">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20, alignContent: 'start' }}>
                    {images.map((img, i) => (
                      <ItemImageCard
                        key={img.storageKey}
                        storageKey={img.storageKey}
                        localPreview={localPreviews[img.storageKey]}
                        ordinal={i + 1}
                        isCover={i === 0}
                        tags={img.tags ?? []}
                        theme={theme}
                        onClick={() => handleSelectPreview(img.storageKey)}
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
                  coverKey={images[0]?.storageKey ?? null}
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

            {/* ② 右栏：单图详情（一图一提示词，SelectedImageDetail 复用） */}
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

            {/* ③ 最右栏：分镜行表单（storyboardTable 列字段表单化） */}
            <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14, padding: '16px 20px 16px 8px', overflowY: 'auto', minHeight: 0 }} className="zx-thin-scroll">
              {!shot ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: textMuted, fontSize: 12 }}>
                  {t('storyboardFullscreenEditor.noShots')}
                </div>
              ) : (
                <>
                  {sectionTitle(t('storyboardFullscreenEditor.sectionShot'))}
                  <Field label={t('storyboardTable.shotNumber')}>
                    <input value={String(shot.number)} readOnly style={tagInputStyle(theme)} />
                  </Field>
                  <Field label={t('storyboardTable.dayNight')}>
                    <input value={shot.dayNight} onChange={(e) => patchShot({ dayNight: e.target.value })} style={tagInputStyle(theme)} />
                  </Field>
                  <Field label={t('storyboardTable.duration')}>
                    <input type="number" value={String(shot.duration)} min={0}
                      onChange={(e) => patchShot({ duration: Number(e.target.value) || 0 })} style={tagInputStyle(theme)} />
                  </Field>
                  <Field label={t('storyboardTable.shotType')}>
                    <input value={shot.shotType} onChange={(e) => patchShot({ shotType: e.target.value })} style={tagInputStyle(theme)} />
                  </Field>
                  <Field label={t('storyboardTable.cameraMovement')}>
                    <input value={shot.cameraMovement} onChange={(e) => patchShot({ cameraMovement: e.target.value })} style={tagInputStyle(theme)} />
                  </Field>

                  {sectionTitle(t('storyboardFullscreenEditor.sectionPicture'))}
                  <Field label={t('storyboardTable.description')}>
                    <textarea value={shot.description} rows={4}
                      onChange={(e) => patchShot({ description: e.target.value })}
                      placeholder={t('storyboardRow.placeholderDescription')} style={noteInputStyle(theme)} />
                  </Field>
                  <Field label={t('storyboardRow.environment')}>
                    <textarea value={envText} rows={2}
                      onChange={(e) => patchShot({ environment: e.target.value })} style={noteInputStyle(theme)} />
                  </Field>
                  <Field label={t('storyboardTable.lighting')}>
                    <textarea value={lightText} rows={2}
                      onChange={(e) => patchShot({ lighting: e.target.value })}
                      placeholder={t('storyboardRow.placeholderLighting')} style={noteInputStyle(theme)} />
                  </Field>
                  <Field label={t('storyboardTable.entities')}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      {refs.map((e, i) => (
                        <span key={i} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          background: surfaceBg, borderRadius: 6, padding: '3px 8px',
                          fontSize: 12, color: textPrimary, maxWidth: '100%',
                        }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entityDisplayName(e)}</span>
                          <button type="button" title={t('storyboardFullscreenEditor.refRemove')} onClick={() => handleRefRemove(i)}
                            style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', color: textMuted, display: 'inline-flex', flexShrink: 0 }}>
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                      <button type="button" onClick={() => setRefOpen((v) => !v)}
                        style={{ ...modalEditBtnStyle(theme), display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                        <AtSign size={12} />
                        {t('storyboardFullscreenEditor.refAdd')}
                      </button>
                    </div>
                    {refOpen && (
                      <div style={{
                        marginTop: 6, border: `1px solid ${cardBorder}`, borderRadius: 8,
                        background: surfaceBg, overflow: 'hidden',
                      }}>
                        <div style={{ padding: 8, borderBottom: `1px solid ${cardBorder}` }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: textMuted, marginBottom: 6 }}>
                            <AtSign size={11} />
                            {t('storyboardFullscreenEditor.refTitle')}
                          </div>
                          <input
                            value={refSearch}
                            onChange={(e) => setRefSearch(e.target.value)}
                            placeholder={t('storyboardFullscreenEditor.refSearchPlaceholder')}
                            autoFocus
                            style={{ ...tagInputStyle(theme), width: '100%' }}
                          />
                        </div>
                        <div style={{ maxHeight: 240, overflowY: 'auto', padding: 4 }} className="zx-thin-scroll">
                          {(pmItems ?? []).length === 0 ? (
                            <div style={{ padding: '14px 10px', color: textMuted, fontSize: 12 }}>{t('storyboardFullscreenEditor.refNoPm')}</div>
                          ) : refGroups.length === 0 ? (
                            <div style={{ padding: '14px 10px', color: textMuted, fontSize: 12 }}>{t('storyboardFullscreenEditor.refEmpty')}</div>
                          ) : (
                            refGroups.map((g) => (
                              <div key={g.kind}>
                                <div style={{ padding: '6px 10px 2px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: KIND_COLOR[g.kind] }}>
                                  {t(`entity.${g.kind}`)}
                                </div>
                                {g.items.map((it) => (
                                  <button key={it.id} type="button" onClick={() => handleRefSelect(it)}
                                    {...ghostHoverHandlers(theme)}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                                      padding: '5px 10px', fontSize: 12, color: textPrimary,
                                      border: 'none', background: 'none', cursor: 'pointer', borderRadius: 6,
                                    }}>
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: KIND_COLOR[g.kind], flexShrink: 0 }} />
                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                                    {linkedCardIds.has(it.id) && (
                                      <span style={{ fontSize: 10, color: accent, flexShrink: 0 }}>{t('storyboardFullscreenEditor.refLinked')}</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </Field>

                  {sectionTitle(t('storyboardFullscreenEditor.sectionSound'))}
                  <Field label={t('storyboardTable.dialogue')}>
                    <textarea value={shot.dialogue} rows={2}
                      onChange={(e) => patchShot({ dialogue: e.target.value })}
                      placeholder={t('storyboardRow.placeholderDialogue')} style={noteInputStyle(theme)} />
                  </Field>
                  <Field label={t('storyboardRow.voiceoverText')}>
                    <textarea value={shot.voiceoverText} rows={2}
                      onChange={(e) => patchShot({ voiceoverText: e.target.value })} style={noteInputStyle(theme)} />
                  </Field>
                  <Field label={t('storyboardRow.monologue')}>
                    <textarea value={shot.monologue} rows={2}
                      onChange={(e) => patchShot({ monologue: e.target.value })} style={noteInputStyle(theme)} />
                  </Field>
                  <Field label={t('storyboardTable.sfx')}>
                    <input value={(shot.sfx ?? []).join(', ')}
                      onChange={(e) => patchShot({ sfx: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                      placeholder={t('storyboardRow.placeholderSfx')} style={tagInputStyle(theme)} />
                  </Field>
                  <Field label={t('storyboardRow.emotion')}>
                    <input value={shot.emotion} onChange={(e) => patchShot({ emotion: e.target.value })} style={tagInputStyle(theme)} />
                  </Field>

                  {sectionTitle(t('storyboardFullscreenEditor.sectionPrompt'))}
                  <Field label={t('storyboardRow.prompt')}>
                    <textarea value={shot.prompt} rows={4}
                      onChange={(e) => patchShot({ prompt: e.target.value })} style={noteInputStyle(theme)} />
                  </Field>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 景别取景器（表格编辑态：点击景别列弹出） */}
      <ShotSizePickerModal
        open={pickerOpen}
        currentValue={pickerShotId ? shots.find((s) => s.id === pickerShotId)?.shotType ?? '中景' : '中景'}
        onClose={() => { setPickerOpen(false); setPickerShotId(null); }}
        onConfirm={(value) => { if (pickerShotId) onUpdateShot(pickerShotId, { shotType: value as any }); setPickerOpen(false); setPickerShotId(null); }}
      />
    </div>
    </ConfigProvider>,
    document.body,
  );
});

/** 全屏覆盖层样式:铺满视口 + 顶部层级 */
const overlayStyle = (background: string): React.CSSProperties => ({
  position: 'fixed',
  inset: 0,
  zIndex: Z_INDEX.FULLSCREEN,
  display: 'flex',
  flexDirection: 'column',
  background,
});
