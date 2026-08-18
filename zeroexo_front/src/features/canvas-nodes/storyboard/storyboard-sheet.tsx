/**
 * StoryboardSheet - 画布"分镜节点"独立页面壳
 *
 * 布局：状态栏 → 分镜表格 → 底部工具栏；全屏沉浸式编辑覆盖层。
 * 数据处理逻辑已抽离至 storyboard-utils。
 */
import { memo, useState, useCallback, useEffect, useMemo, useRef, ReactElement } from 'react';import { createPortal } from 'react-dom';
import { Link2, ListVideo, Columns3, Table } from 'lucide-react';
import { Button, App, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { useReactGraphStore, useGraph } from '@zeroexo/plugin-render-react';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import type { StoryboardNodeData, Shot, StoryboardEntity } from './storyboard-types';
import { createNewShot, normalizeUpdate, buildStepRecords } from './storyboard-utils';
import { ShotSizePickerModal } from './components/ShotSizePickerModal';
import { StoryboardAssociateModal } from './storyboard-associate-modal';
import { FullscreenDropdown, fullToolBtnStyle } from './components/FullscreenDropdown';
import { StoryboardTable } from './components/StoryboardTable';
import { StepView } from './components/StepView';
import { StepNavigator } from './components/StepNavigator';
import {
  FullscreenToolbar,
  DeleteConfirmModal,
  RegenModal,
  fullscreenOverlayStyle,
} from './components/StoryboardToolbar';

export interface StoryboardSheetProps {
  nodeId: string;
  data: StoryboardNodeData;
  onDataChange: (data: StoryboardNodeData) => void;
}

export const StoryboardSheet = memo(function StoryboardSheet({ nodeId, data, onDataChange }: StoryboardSheetProps): ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message } = App.useApp();
  const isDark = theme.mode === 'dark';
  const store = useReactGraphStore();
  const graph = useGraph(store);

  // 画布图数据
  const linkedScript = useMemo(() => {
    const edges = graph.edges.filter((e) => e.target?.nodeId === nodeId && e.source?.pinId === 'output');
    if (edges.length === 0) return undefined;
    const sd = data as StoryboardNodeData;
    const preferred = edges.find((e) => e.source?.nodeId === sd.sourceScriptId) ?? edges[0]!;
    return graph.nodes.find((n) => n.id === preferred.source?.nodeId && n.type === 'script');
  }, [graph, nodeId, data]);
  const scriptNodes = useMemo(() => graph.nodes.filter((n) => n.type === 'script'), [graph]);
  const scriptOptionLabel = useCallback((n: { id: string; title?: string }) => {
    const scriptDefault = t('storyboard.script');
    const title = n.title || scriptDefault;
    const sameCount = scriptNodes.reduce((acc, x) => acc + ((x.title || scriptDefault) === title ? 1 : 0), 0);
    return sameCount > 1 ? `${title} #${n.id.replace(/[^0-9a-zA-Z]/gi, '').slice(-4)}` : title;
  }, [scriptNodes, t]);
  const scriptEpisodes = useMemo(() => {
    if (!linkedScript) return [];
    return ((linkedScript.data ?? {}) as { episodes?: unknown[] }).episodes ?? [];
  }, [linkedScript]) as Array<{ id: string; title?: string; content?: string }>;
  const episodeLabel = useCallback((ep: { title?: string }, idx: number) => {
    const defaultTitle = t('storyboard.episodeLabel', { number: idx + 1 });
    return ep.title && ep.title !== defaultTitle ? `${defaultTitle} · ${ep.title}` : defaultTitle;
  }, [t]);

  // 当前集
  const activeEpisodeId = useMemo(() => {
    const stored = data.activeEpisodeId;
    if (stored && scriptEpisodes.some((e) => e.id === stored)) return stored;
    return scriptEpisodes[0]?.id ?? stored ?? '_legacy';
  }, [data.activeEpisodeId, scriptEpisodes]);
  const hasByEpisode = useMemo(() => Object.keys(data.shotsByEpisode ?? {}).length > 0, [data.shotsByEpisode]);
  const shots = data.shotsByEpisode?.[activeEpisodeId] ?? (hasByEpisode ? [] : (data.shots ?? []));
  const status = data.statusByEpisode?.[activeEpisodeId] ?? (hasByEpisode ? 'idle' : (data.status ?? 'idle'));
  const entities = data.entities ?? [];
  const activeEpisode = scriptEpisodes.find((e) => e.id === activeEpisodeId) ?? scriptEpisodes[0];
  const activeEpisodeIndex = Math.max(0, scriptEpisodes.findIndex((e) => e.id === activeEpisodeId));

  // 分页
  const PAGE_SIZE = 8;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(shots.length / PAGE_SIZE));
  const paginatedShots = shots.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // UI 状态
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<null | { type: 'single'; shotId: string } | { type: 'batch' }>(null);
  const [selectedShotIds, setSelectedShotIds] = useState<Set<string>>(new Set());
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerShotId, setPickerShotId] = useState<string | null>(null);
  const [cameraOpenId, setCameraOpenId] = useState<string | null>(null);
  const [cameraRect, setCameraRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionShotId, setMentionShotId] = useState<string | null>(null);
  const [, setMentionSearch] = useState('');
  const [associateOpen, setAssociateOpen] = useState(false);
  const [associateScriptId, setAssociateScriptId] = useState<string | null>(null);
  const [regenMeta, setRegenMeta] = useState<null | { episodeId: string; episodeTitle?: string }>(null);
  const [regenStep, setRegenStep] = useState(0);
  const [regenOption, setRegenOption] = useState<'overwrite' | 'compare'>('overwrite');

  // Step 视图
  const [viewMode, setViewMode] = useState<'table' | 'step'>('table');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const stepRecords = useMemo(() => buildStepRecords(shots, entities, data.conflicts ?? []), [shots, entities, data.conflicts]);

  const associateScript = useMemo(() => scriptNodes.find((n) => n.id === associateScriptId) ?? null, [scriptNodes, associateScriptId]);
  const associateEpisodes = useMemo(() => {
    if (!associateScript) return [];
    return ((associateScript.data ?? {}) as { episodes?: unknown[] }).episodes ?? [];
  }, [associateScript]) as Array<{ id: string; title?: string; content?: string }>;

  // 主题色
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const cardBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const bgPage = isDark ? '#0e0e0e' : '#f8f8f8';
  const bgCanvas = isDark ? '#171717' : '#ffffff';
  const borderMuted = isDark ? '#2e2e2e' : '#e5e5e5';

  // 数据变更
  const updateData = useCallback((updater: (prev: StoryboardNodeData) => StoryboardNodeData) => {
    const next = normalizeUpdate(data, activeEpisodeId, updater);
    store.updateNodeData(nodeId, { ...next });
    onDataChange(next);
  }, [data, activeEpisodeId, nodeId, store, onDataChange]);

  // 导航
  const handleEpisodeChange = useCallback((epId: string) => {
    if (epId === activeEpisodeId) return;
    updateData((prev) => ({ ...prev, activeEpisodeId: epId }));
    setCurrentPage(1);
  }, [activeEpisodeId, updateData]);
  const openAssociateModal = useCallback((scriptId: string) => { setAssociateScriptId(scriptId); setAssociateOpen(true); }, []);
  const handleOverwriteRegen = useCallback(() => { if (regenMeta) { nodeActionBus.emit('storyboard:regenerateEpisode', { nodeId, episodeId: regenMeta.episodeId }); setRegenMeta(null); } }, [nodeId, regenMeta]);
  const handleNewCompareRegen = useCallback(() => {
    if (!regenMeta || !linkedScript) return;
    nodeActionBus.emit('storyboard:associate' as any, { scriptNodeId: linkedScript.id, episodeIds: [regenMeta.episodeId], autoGenerate: true } as any);
    setRegenMeta(null);
  }, [linkedScript, regenMeta]);

  // Shot CRUD
  const handleAddShot = useCallback(() => {
    const newShot = createNewShot(shots);
    updateData((prev) => ({ ...prev, shots: [...prev.shots, newShot] }));
    setCurrentPage(Math.ceil((shots.length + 1) / PAGE_SIZE));
  }, [updateData, shots.length]);
  const handleDeleteShot = useCallback((shotId: string) => setDeleteConfirm({ type: 'single', shotId }), []);
  const handleBatchDelete = useCallback(() => { if (selectedShotIds.size > 0) setDeleteConfirm({ type: 'batch' }); }, [selectedShotIds.size]);
  const confirmDelete = useCallback(() => {
    if (deleteConfirm?.type === 'single') {
      const shotId = deleteConfirm.shotId;
      updateData((prev) => {
        const filtered = prev.shots.filter((s) => s.id !== shotId);
        return { ...prev, shots: filtered.map((s, i) => ({ ...s, number: i + 1 })) };
      });
      setSelectedShotIds((prev) => { const n = new Set(prev); n.delete(shotId); return n; });
      message.success(t('storyboardRow.deleteShotSuccess'));
    } else if (deleteConfirm?.type === 'batch') {
      const count = selectedShotIds.size;
      updateData((prev) => {
        const filtered = prev.shots.filter((s) => !selectedShotIds.has(s.id));
        return { ...prev, shots: filtered.map((s, i) => ({ ...s, number: i + 1 })) };
      });
      setSelectedShotIds(new Set());
      message.success(t('storyboardRow.deleteShotsSuccess', { count }));
    }
    setDeleteConfirm(null);
  }, [deleteConfirm, selectedShotIds, updateData, message, t]);
  const handleToggleSelectAll = useCallback(() => {
    setSelectedShotIds((prev) => prev.size === shots.length ? new Set() : new Set(shots.map((s) => s.id)));
  }, [shots]);
  const handleToggleSelect = useCallback((shotId: string) => {
    setSelectedShotIds((prev) => { const n = new Set(prev); n.has(shotId) ? n.delete(shotId) : n.add(shotId); return n; });
  }, []);
  const updateShot = useCallback((shotId: string, patch: Partial<Shot>) => {
    updateData((prev) => ({ ...prev, shots: prev.shots.map((s) => (s.id === shotId ? { ...s, ...patch } : s)) }));
  }, [updateData]);

  // @ 提及
  const handleMentionSelect = useCallback((entity: StoryboardEntity) => {
    if (!mentionShotId) return;
    const desc = shots.find((s) => s.id === mentionShotId)?.description ?? '';
    updateShot(mentionShotId, { description: `${desc}@${entity.name}` });
    setMentionOpen(false); setMentionShotId(null); setMentionSearch('');
  }, [shots, updateShot, mentionShotId]);
  const handleMentionOpen = useCallback((shotId: string) => { setMentionShotId(shotId); setMentionOpen(true); setMentionSearch(''); }, []);

  // 事件订阅(使用 ref 稳定回调引用,避免因 data 变化导致 useEffect 反复重订阅)
  const handleAddShotRef = useRef(handleAddShot);
  handleAddShotRef.current = handleAddShot;
  useEffect(() => {
    const unsubs = [
      nodeActionBus.on('storyboard:addShot', (e) => { if (e.nodeId === nodeId) handleAddShotRef.current(); }),
      nodeActionBus.on('storyboard:generate', (e) => { if (e.nodeId === nodeId) message.info(t('storyboard.aiGenerateComingSoon')); }),
      nodeActionBus.on('storyboard:fullscreen', (e) => { if (e.nodeId === nodeId) setFullscreenOpen(true); }),
    ];
    return () => unsubs.forEach((u) => u?.());
  }, [nodeId, message, t]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', cursor: 'default' }}>
      {/* 状态栏 */}
      <div style={{ padding: '6px 12px', borderBottom: `1px solid ${cardBorder}`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: isDark ? '#1b1b1b' : '#fafaf7', flexShrink: 0, position: 'relative' }}>
        {/* 关联剧本/切换关联(合并为下拉按钮,关联后直接显示剧本名) */}
        <FullscreenDropdown
          onSelect={(key) => {
            if (key === '__none') return;
            openAssociateModal(key);
          }}
          options={linkedScript
            ? (scriptNodes.filter((n) => n.id !== linkedScript.id).length > 0
              ? scriptNodes.filter((n) => n.id !== linkedScript.id).map((n) => ({ key: n.id, label: scriptOptionLabel(n) }))
              : [{ key: '__none', label: t('storyboard.noOtherScriptNodes'), disabled: true }])
            : (scriptNodes.length > 0
              ? scriptNodes.map((n) => ({ key: n.id, label: scriptOptionLabel(n) }))
              : [{ key: '__none', label: t('storyboard.noScriptNodesHint'), disabled: true }])}
        >
          <Button size="small" type="text" icon={<Link2 size={14} />} style={{ ...fullToolBtnStyle, color: textColor }}>
            {linkedScript ? scriptOptionLabel(linkedScript) : t('storyboard.associateScript')}
          </Button>
        </FullscreenDropdown>
        <div style={{ flex: 1 }} />
        {linkedScript && scriptEpisodes.length > 0 ? (
          <FullscreenDropdown onSelect={handleEpisodeChange} options={scriptEpisodes.map((ep, idx) => ({ key: ep.id, label: episodeLabel(ep, idx), active: ep.id === activeEpisodeId }))}>
            <Button size="small" type="text" icon={<ListVideo size={14} />} style={{ ...fullToolBtnStyle, color: textColor }}>{episodeLabel(scriptEpisodes[activeEpisodeIndex] ?? { title: undefined }, activeEpisodeIndex)}</Button>
          </FullscreenDropdown>
        ) : (
          <span style={{ fontSize: 11, color: mutedColor, display: 'inline-flex', alignItems: 'center', gap: 4 }}><ListVideo size={14} />{activeEpisode ? activeEpisode.title || t('storyboardTable.currentEpisode') : t('storyboardTable.currentEpisode')}</span>
        )}
        <div style={{ flex: 1 }} />
        {data.isSample && <span style={{ display: 'inline-flex', alignItems: 'center', padding: '1px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, letterSpacing: 1, color: isDark ? '#fbbf24' : '#b45309', background: isDark ? 'rgba(251,191,36,0.14)' : 'rgba(180,83,9,0.12)', border: `1px solid ${isDark ? 'rgba(251,191,36,0.35)' : 'rgba(180,83,9,0.3)'}`, userSelect: 'none', pointerEvents: 'none' }}>{t('storyboard.sampleBadge')}</span>}
        {/* 切换视图按钮(移到「共N个镜头」前面) */}
        <Tooltip title={viewMode === 'step' ? t('storyboard.switchToTableView') : t('storyboard.switchToStepView')}>
          <Button
            size="small"
            type="text"
            icon={viewMode === 'step' ? <Table size={14} /> : <Columns3 size={14} />}
            style={{ color: textColor, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28 }}
            onClick={() => { setViewMode(viewMode === 'table' ? 'step' : 'table'); setCurrentStepIndex(0); }}
          />
        </Tooltip>
        <span style={{ fontSize: 11, color: mutedColor }}>{t('storyboard.shotCountSummary', { count: shots.length })}</span>
      </div>

      {/* 内容区域 */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {viewMode === 'step' && stepRecords.length > 0 ? (
          <>
            <StepNavigator currentIndex={currentStepIndex} totalSteps={stepRecords.length} onPrev={() => setCurrentStepIndex(Math.max(0, currentStepIndex - 1))} onNext={() => setCurrentStepIndex(Math.min(stepRecords.length - 1, currentStepIndex + 1))} onBackToList={() => setViewMode('table')} />
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
              <StepView step={stepRecords[currentStepIndex]!} entities={entities} conflicts={data.conflicts ?? []} allShots={shots} />
            </div>
          </>
        ) : (
          <StoryboardTable readOnly shots={shots} paginatedShots={paginatedShots} selectedRowId={selectedRowId} onRowSelect={setSelectedRowId} selectedShotIds={selectedShotIds} onToggleSelect={handleToggleSelect} onDeleteShot={handleDeleteShot} onUpdateShot={updateShot} cameraOpenId={cameraOpenId} cameraRect={cameraRect} onCameraOpen={(id, r) => { setCameraOpenId(id); setCameraRect(r); }} onCameraClose={() => { setCameraOpenId(null); setCameraRect(null); }} entities={entities} mentionOpen={mentionOpen} mentionShotId={mentionShotId} onMentionSelect={handleMentionSelect} onMentionOpen={handleMentionOpen} onShotTypeClick={(id) => { setPickerShotId(id); setPickerOpen(true); }} status={status} nodeId={nodeId} linkedScript={linkedScript} activeEpisode={activeEpisode} activeEpisodeId={activeEpisodeId} />
        )}
      </div>

      {/* 底部工具栏 — 已注释,功能移至胶囊菜单和顶部状态栏 */}
      {/*
      <StoryboardToolbar
        linkedScript={linkedScript}
        scriptNodes={scriptNodes}
        scriptOptionLabel={scriptOptionLabel}
        openFullscreen={openFullscreen}
        openRegenModal={openRegenModal}
        openAssociateModal={openAssociateModal}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        shotCount={shots.length}
        hasGenerated={shots.length > 0}
        onGenerateEpisode={handleGenerateEpisode}
        episodeStatus={status}
        viewMode={viewMode}
        onViewModeChange={(mode) => { setViewMode(mode); setCurrentStepIndex(0); }}
      />
      */}

      {/* 全屏覆盖层 */}
      {fullscreenOpen && createPortal(
        <div style={fullscreenOverlayStyle(bgPage)}>
          <FullscreenToolbar linkedScript={linkedScript} scriptNodes={scriptNodes} scriptOptionLabel={scriptOptionLabel} scriptEpisodes={scriptEpisodes} activeEpisodeId={activeEpisodeId} activeEpisodeIndex={activeEpisodeIndex} episodeLabel={episodeLabel} handleEpisodeChange={handleEpisodeChange} openAssociateModal={openAssociateModal} handleAddShot={handleAddShot} handleToggleSelectAll={handleToggleSelectAll} selectedShotIds={selectedShotIds} shotCount={shots.length} handleBatchDelete={handleBatchDelete} isSample={data.isSample} currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} onCloseFullscreen={() => setFullscreenOpen(false)} viewMode={viewMode} onViewModeChange={(mode) => { setViewMode(mode); setCurrentStepIndex(0); }} />
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', padding: '0.5rem 1.5rem 1rem', background: bgPage }}>
            <div style={{ width: '100%', height: '100%', border: `1px solid ${borderMuted}`, borderRadius: 8, background: bgCanvas, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {viewMode === 'step' && stepRecords.length > 0 ? (
                <>
                  <StepNavigator currentIndex={currentStepIndex} totalSteps={stepRecords.length} onPrev={() => setCurrentStepIndex(Math.max(0, currentStepIndex - 1))} onNext={() => setCurrentStepIndex(Math.min(stepRecords.length - 1, currentStepIndex + 1))} onBackToList={() => setViewMode('table')} />
                  <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
                    <StepView step={stepRecords[currentStepIndex]!} entities={entities} conflicts={data.conflicts ?? []} allShots={shots} />
                  </div>
                </>
              ) : (
                <StoryboardTable readOnly={false} shots={shots} paginatedShots={paginatedShots} selectedRowId={selectedRowId} onRowSelect={setSelectedRowId} selectedShotIds={selectedShotIds} onToggleSelect={handleToggleSelect} onDeleteShot={handleDeleteShot} onUpdateShot={updateShot} cameraOpenId={cameraOpenId} cameraRect={cameraRect} onCameraOpen={(id, r) => { setCameraOpenId(id); setCameraRect(r); }} onCameraClose={() => { setCameraOpenId(null); setCameraRect(null); }} entities={entities} mentionOpen={mentionOpen} mentionShotId={mentionShotId} onMentionSelect={handleMentionSelect} onMentionOpen={handleMentionOpen} onShotTypeClick={(id) => { setPickerShotId(id); setPickerOpen(true); }} status={status} nodeId={nodeId} linkedScript={linkedScript} activeEpisode={activeEpisode} activeEpisodeId={activeEpisodeId} />
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* 弹窗 */}
      <ShotSizePickerModal open={pickerOpen} currentValue={pickerShotId ? shots.find((s) => s.id === pickerShotId)?.shotType ?? '中景' : '中景'} onClose={() => { setPickerOpen(false); setPickerShotId(null); }} onConfirm={(value) => { if (pickerShotId) updateShot(pickerShotId, { shotType: value as any }); setPickerOpen(false); setPickerShotId(null); }} />
      {associateScript && <StoryboardAssociateModal open={associateOpen} onClose={() => { setAssociateOpen(false); setAssociateScriptId(null); }} scriptNodeId={associateScript.id} scriptTitle={associateScript.title} episodes={associateEpisodes.map((ep, idx) => ({ id: ep.id, number: idx + 1, title: ep.title }))} defaultGenerate={false} targetNodeId={nodeId} />}
      <DeleteConfirmModal deleteConfirm={deleteConfirm} onCancel={() => setDeleteConfirm(null)} onOk={confirmDelete} shots={shots} selectedShotIds={selectedShotIds} />
      <RegenModal regenMeta={regenMeta} regenStep={regenStep} regenOption={regenOption} onStepChange={setRegenStep} onOptionChange={setRegenOption} onCancel={() => setRegenMeta(null)} onOverwriteRegen={handleOverwriteRegen} onNewCompareRegen={handleNewCompareRegen} linkedScript={linkedScript} />
    </div>
  );
});