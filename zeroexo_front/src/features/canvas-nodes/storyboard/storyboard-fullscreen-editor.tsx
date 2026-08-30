/**
 * StoryboardFullscreenEditor - 分镜全屏编辑（Req5b：表格为基础壳 + 步骤视图承载图册/提示词/镜头信息）
 *
 * 全屏以 StoryboardTable 编辑态为基础壳（readOnly=false，EDIT 11 列行内编辑）：
 * - 顶部：共享 header（分镜切换器 + 集切换 + 视图切换 表格↔步骤 + 增删 + 关闭），表格与步骤视图共用
 * - 表格视图：StoryboardTable 编辑态（主体列/操作列展开，分页 + 全选 + 批量删除）
 * - 步骤视图：图册/网格模块 + 提示词（SelectedImageDetail）+ 右侧镜头信息（行表单化），配色沿用无边线分层
 * 步骤视图 = 升级版单镜视图（节点与全屏均不再出现单镜），header 分镜切换器驱动当前镜头
 */
import { memo, useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip, App as AntdApp, ConfigProvider, Select, Button } from 'antd';
import { Plus, Trash2, X, ListVideo, Table, FileText, CheckSquare, Link2, RotateCcw } from 'lucide-react';
import { StoryboardMergedTab } from './storyboard-merged-tab';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { Z_INDEX } from '@/shared/constants/z-index.js';
import { FullscreenDropdown } from './components/FullscreenDropdown';
import type { Shot, StoryboardEntity, EntityKind, AiSubject, EpisodeStatus } from './storyboard-types';
import { StoryboardTable } from './components/StoryboardTable';
import { ShotSizePickerModal } from './components/ShotSizePickerModal';
import {
  modalHeaderStyle, modalIconBtnStyle, ghostHoverHandlers, viewSwitchBtnStyle,
} from '../production-manager/production-editor-styles';

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
  /** Plan#50:内嵌模式(画布顶部页签内显示)——容器 absolute 填满父级、不 createPortal;关闭按钮隐藏 */
  embedded?: boolean;
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
  /** 剧管条目（@ 引用连入剧管，Plan#33 C3）——2026-08-30 移除：不再需要，已弃用 */

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
  /** 重新生成当前集（2026-08-29 全屏模式入口；由节点侧触发 RegenModal 流程） */
  onRequestRegenerate?: () => void;
}

/** 全屏表格分页尺寸（编辑态行高较大，略小于节点内 8） */
const PAGE_SIZE = 10;

export const StoryboardFullscreenEditor = memo(function StoryboardFullscreenEditor({
  open, onClose, shots, onUpdateShot, onAddShot, onDeleteShot, episodes, activeEpisodeId, onEpisodeChange,
  entities, aiSubjects, subjectStatesByEntity, pmItemsByEntity, status, progress, nodeId, linkedScript, activeEpisode,
  scriptNodes = [], scriptOptionLabel, onAssociateScript, onRequestRegenerate,
  embedded = false,
}: StoryboardFullscreenEditorProps): ReactElement | null {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { modal: antdModal } = AntdApp.useApp();

  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const pageBg = theme.canvas.background;
  const surfaceBg = theme.node.fill;
  const cardBorder = theme.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  // ===== 2026-08-30 收敛:两页签(表格 / 提示词与主体清单);步骤视图已移除 =====
  const [tabKey, setTabKey] = useState<'table' | 'merged'>('table');

  // ===== 当前分镜（纯视图态 activeIndex，不落 node.data；header 切换器驱动） =====
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    if (activeIndex >= shots.length) setActiveIndex(shots.length > 0 ? shots.length - 1 : 0);
  }, [shots.length, activeIndex]);

  // 2026-08-30 主体清单数据源 = entities + aiSubjects 合并去重（Plan#53 已由 storyboard-asset-panel 接管，此处不再消费）

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

  // ===== Plan#53 T10: merged 视图本地状态（时间轴排序/缩放/播放头；业务写入走 onUpdateShot） =====
  const [timelineOrder, setTimelineOrder] = useState<string[] | null>(null);
  const [pps, setPps] = useState(60);
  const [playhead, setPlayhead] = useState(0);
  useEffect(() => { setTimelineOrder(null); }, [activeEpisodeId]);
  const orderedShots = useMemo(() => {
    if (!timelineOrder || timelineOrder.length === 0) return shots;
    const idx = new Map(shots.map((s, i) => [s.id, i]));
    return [...timelineOrder].map((id) => shots[idx.get(id) ?? -1]).filter((s): s is Shot => s != null);
  }, [shots, timelineOrder]);
  const currentShot = orderedShots[activeIndex];
  const activeVideoIndex = currentShot?.activeVideoIndex ?? 0;
  const activeVideo = currentShot?.videos?.[activeVideoIndex];
  const timelineData = useMemo(() => orderedShots.map((s) => ({
    id: s.id,
    number: s.number,
    duration: s.duration,
    status: (s.generated ? 'done' : (s.videos?.some((v) => v.status === 'generating') ? 'generating' : (s.videos?.some((v) => v.status === 'failed') ? 'failed' : 'idle'))) as any,
    label: s.description || s.promptText || `#${s.number}`,
    hasAudio: !!s.audioPreview?.storageKey,
  })), [orderedShots]);
  const bibleRefs = currentShot?.bibleRefs;
  const currentEntities = useMemo(() => {
    const ids = new Set([
      ...(bibleRefs?.characters ?? []),
      ...(bibleRefs?.scenes ?? []),
      ...(bibleRefs?.props ?? []),
    ]);
    if (ids.size === 0) return entities;
    return entities.filter((e) => ids.has(e.id) || ids.has(e.name));
  }, [entities, bibleRefs]);

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

  // ===== 新增镜头（2026-08-29 移入表格底栏；删除在表格行内/批量删除） =====
  const handleAdd = useCallback(() => {
    const before = shots.length;
    onAddShot();
    setActiveIndex(before);
    setCurrentPage(Math.max(1, Math.ceil((before + 1) / PAGE_SIZE)));
  }, [shots.length, onAddShot]);

  if (!open) return null;

  // Plan#50:embedded(页签内嵌)——不 createPortal、容器 absolute 填满父级(页签内容层),
  // 由调用方(分镜节点)自行 portal 到页签挂载点;非 embedded 保持原全屏覆盖形态。
  const overlay = (
    // 真全屏覆盖层:自制 overlay(Z_INDEX.FULLSCREEN=30000),antd 弹层(Dropdown/Tooltip/Modal)
    // 由 ConfigProvider 提升到 40000,保证景别取景器等弹层显示在全屏之上
    <ConfigProvider theme={{ token: { zIndexPopupBase: 40000 } }}>
    <div style={overlayStyle(pageBg, embedded)}>
      {/* 事件阻断：全屏挂载于 body，不阻断则事件冒泡至画布平移/缩放 */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        {/* ===== 标题栏：集切换 + 关联剧本 + 三页签 + 关闭（新增/删除镜头在表格底栏）===== */}
        <div style={modalHeaderStyle(theme)}>
          <ListVideo size={15} style={{ color: accent, flexShrink: 0 }} />
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
          {onRequestRegenerate && (
            <Tooltip title={t('storyboard.requestRegenerate', '重新生成该集')}>
              <button
                type="button"
                onClick={onRequestRegenerate}
                style={{ ...modalIconBtnStyle(theme, false), flexShrink: 0 }}
              >
                <RotateCcw size={15} />
              </button>
            </Tooltip>
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
          {/* 页签切换：表格 / 提示词与主体清单（2026-08-30 合并） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: surfaceBg, borderRadius: 8, padding: 2, flexShrink: 0 }}>
            {([
              { key: 'table' as const, label: t('storyboard.tabTable', '表格'), Icon: Table },
              { key: 'merged' as const, label: t('storyboard.tabMerged', '提示词与主体'), Icon: FileText },
            ]).map(({ key, label, Icon }) => (
              <Tooltip key={key} title={label}>
                <button
                  type="button"
                  onClick={() => setTabKey(key)}
                  style={{ ...viewSwitchBtnStyle(tabKey === key, accent, textMuted), width: 30, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon size={14} />
                </button>
              </Tooltip>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          {/* Plan#50:embedded(页签)模式隐藏自带关闭按钮——统一由页签 X 关闭 */}
          {!embedded && (
            <Tooltip title={t('common.close')}>
              <button type="button" {...ghostHoverHandlers(theme)} onClick={onClose} style={modalIconBtnStyle(theme, false)}>
                <X size={15} />
              </button>
            </Tooltip>
          )}
        </div>

        {tabKey === 'table' ? (
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
            {/* 底栏：新增镜头 + 镜头计数 + 全选/批量删除 + 分页 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderTop: `1px solid ${cardBorder}`, flexShrink: 0 }}>
              <Button
                size="small"
                type="text"
                icon={<Plus size={13} />}
                onClick={handleAdd}
                style={{ fontSize: 12, color: accent }}
              >
                {t('storyboardFullscreenEditor.addShot')}
              </Button>
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
          /* ===== Plan#53 T10: 分镜生产台（五区容器） ===== */
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <StoryboardMergedTab
              theme={theme}
              isDark={theme.mode === 'dark'}
              entities={currentEntities}
              shot={currentShot}
              assetPanelProps={{ entities: currentEntities }}
              videoStageProps={{
                videoStorageKey: activeVideo?.status === 'done' ? activeVideo?.storageKey : undefined,
                videoStatus: currentShot?.generated ? 'done' : (activeVideo?.status ?? 'idle'),
                videoProgress: activeVideo?.progress ?? 0,
                videoError: activeVideo?.error,
                audioStorageKey: currentShot?.audioPreview?.storageKey,
                audioDuration: currentShot?.audioPreview?.duration,
                audioName: currentShot?.audioPreview?.name,
                onRemoveAudio: () => currentShot && onUpdateShot(currentShot.id, { audioPreview: undefined }),
                onRecordAudio: () => {
                  antdModal.info({
                    centered: true,
                    zIndex: Z_INDEX.FULLSCREEN_MODAL,
                    title: t('storyboard.recordVoice', '配音/上传'),
                    content: t('storyboard.recordVoiceHint', '配音录制与音频上传将在 Phase 2 接入；当前可直接在镜头上填写音频地址（audioPreview.storageKey）后试听。'),
                    okText: t('common.ok', '知道了'),
                  });
                },
                emptyLabel: t('storyboard.videoEmpty', '本镜尚无视频，点击底部「生成视频」'),
              }}
              alternativeVideosProps={{
                videos: currentShot?.videos ?? [],
                activeVideoIndex,
                onActivate: (idx) => currentShot && onUpdateShot(currentShot.id, { activeVideoIndex: idx }),
                onRetry: (idx) => {
                  const list = [...(currentShot?.videos ?? [])];
                  if (list[idx]) { list[idx] = { ...list[idx], status: 'pending', error: undefined, diagnosis: undefined }; currentShot && onUpdateShot(currentShot.id, { videos: list }); }
                },
                onRemove: (idx) => {
                  const list = [...(currentShot?.videos ?? [])];
                  list.splice(idx, 1);
                  currentShot && onUpdateShot(currentShot.id, { videos: list, activeVideoIndex: Math.max(0, (currentShot.activeVideoIndex ?? 0) - (idx < (currentShot.activeVideoIndex ?? 0) ? 1 : 0)) });
                },
              }}
              timelineProps={{
                shots: timelineData,
                activeShotId: currentShot?.id,
                pixelsPerSecond: pps,
                onPixelsPerSecondChange: setPps,
                onSelectShot: (id) => setActiveIndex(Math.max(0, orderedShots.findIndex((s) => s.id === id))),
                onReorder: (orderedIds) => setTimelineOrder(orderedIds),
                onTrim: (shotId, newDuration) => onUpdateShot(shotId, { duration: newDuration }),
                playheadTime: playhead,
                onPlayheadTimeChange: setPlayhead,
                onClipDoubleClick: (id) => setActiveIndex(Math.max(0, orderedShots.findIndex((s) => s.id === id))),
              }}
              promptEditorProps={{
                imagePrompt: currentShot?.imagePrompt ?? currentShot?.prompt ?? '',
                videoPrompt: currentShot?.videoPrompt ?? '',
                negativePrompt: currentShot?.negativePrompt ?? '',
                quality: currentShot?.quality,
                model: activeVideo?.model,
                duration: currentShot?.duration,
                aspectRatio: currentShot?.promptAssembly?.aspectRatio,
                onImagePromptChange: (v) => currentShot && onUpdateShot(currentShot.id, { imagePrompt: v }),
                onVideoPromptChange: (v) => currentShot && onUpdateShot(currentShot.id, { videoPrompt: v }),
                onNegativePromptChange: (v) => currentShot && onUpdateShot(currentShot.id, { negativePrompt: v }),
                onModelChange: (v) => { const list = [...(currentShot?.videos ?? [])]; if (list[activeVideoIndex]) { list[activeVideoIndex] = { ...list[activeVideoIndex], model: v }; currentShot && onUpdateShot(currentShot.id, { videos: list }); } },
                onDurationChange: (v) => currentShot && onUpdateShot(currentShot.id, { duration: v }),
                onAspectRatioChange: (v) => currentShot && onUpdateShot(currentShot.id, { promptAssembly: { ...(currentShot?.promptAssembly ?? { form: 'S1', anchorSentences: [], motionBudget: { subject: 40, camera: 30, environment: 30 }, aspectRatio: '16:9', assembledAt: '' }), aspectRatio: v } }),
                onGenerate: () => {
                  if (!currentShot) return;
                  if ((currentShot.quality?.score ?? 10) < 7) {
                    antdModal.warning({ centered: true, zIndex: Z_INDEX.FULLSCREEN_MODAL, title: t('storyboard.qualityBelowGate', '质量门未通过，禁止生成'), content: t('storyboard.qualityGateHint', '请先修复提示词质量问题或调低质量门阈值后再生成。'), okText: t('common.ok', '知道了') });
                    return;
                  }
                  const list = [...(currentShot.videos ?? [])];
                  list.push({ storageKey: '', status: 'pending', model: activeVideo?.model });
                  onUpdateShot(currentShot.id, { videos: list, generated: true, manualEdit: false });
                  antdModal.info({ centered: true, zIndex: Z_INDEX.FULLSCREEN_MODAL, title: t('storyboard.generateQueued', '已排队生成'), content: t('storyboard.generateQueuedHint', '生成任务已入队；真实视频生成链路将在 Phase 2 接入（当前为占位状态）。'), okText: t('common.ok', '知道了') });
                },
                onAssembleFromBible: () => {
                  if (!currentShot) return;
                  const anchors = currentEntities.filter((e) => e.anchorSentence).map((e) => `${e.name}:${e.anchorSentence}`).join('；');
                  onUpdateShot(currentShot.id, { imagePrompt: anchors ? `${currentShot.imagePrompt ?? ''}\n[圣经] ${anchors}` : (currentShot.imagePrompt ?? ''), promptAssembly: { ...(currentShot.promptAssembly ?? { form: 'S1', anchorSentences: [], motionBudget: { subject: 40, camera: 30, environment: 30 }, aspectRatio: '16:9', assembledAt: '' }), anchorSentences: currentEntities.filter((e) => e.anchorSentence).map((e) => e.anchorSentence!), assembledAt: new Date().toISOString() }, manualEdit: false });
                  antdModal.success({ centered: true, zIndex: Z_INDEX.FULLSCREEN_MODAL, title: t('storyboard.assembledFromBible', '已从圣经组装'), content: t('storyboard.assembledFromBibleHint', '已将本镜引用主体的锚点句组装进 Image Prompt。'), okText: t('common.ok', '知道了') });
                },
                generating: activeVideo?.status === 'generating',
                disabled: !currentShot,
              }}
              onWizardAction={(action) => {
                if (action === 'prompt') {
                  antdModal.info({ centered: true, zIndex: Z_INDEX.FULLSCREEN_MODAL, title: t('storyboard.wizard.promptTitle', '补全提示词'), content: t('storyboard.wizard.promptHint', '请在底部提示词区填写 Image/Video Prompt，或点击「从圣经组装」。'), okText: t('common.ok', '知道了') });
                } else if (action === 'generate') {
                  antdModal.info({ centered: true, zIndex: Z_INDEX.FULLSCREEN_MODAL, title: t('storyboard.wizard.generateTitle', '生成视频'), content: t('storyboard.wizard.generateHint', '填写提示词并通过质量门后，点击「生成视频」。'), okText: t('common.ok', '知道了') });
                } else if (action === 'voice') {
                  antdModal.info({ centered: true, zIndex: Z_INDEX.FULLSCREEN_MODAL, title: t('storyboard.wizard.voiceTitle', '配音预览'), content: t('storyboard.recordVoiceHint', '配音录制与音频上传将在 Phase 2 接入；当前可直接在镜头上填写音频地址（audioPreview.storageKey）后试听。'), okText: t('common.ok', '知道了') });
                }
              }}
            />
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
    </ConfigProvider>
  );

  if (embedded) return overlay;
  return createPortal(overlay, document.body);
});

/** 全屏覆盖层样式:铺满视口 + 顶部层级 */
const overlayStyle = (background: string, embedded = false): React.CSSProperties => ({
  // Plan#50:embedded(页签内嵌)用 absolute 填满父容器;否则原全屏 fixed 覆盖
  position: embedded ? 'absolute' : 'fixed',
  inset: 0,
  zIndex: embedded ? undefined : Z_INDEX.FULLSCREEN,
  display: 'flex',
  flexDirection: 'column',
  background,
});
