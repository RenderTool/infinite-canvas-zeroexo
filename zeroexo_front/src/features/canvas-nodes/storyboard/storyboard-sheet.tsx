/**
 * StoryboardSheet - 画布"分镜节点"独立页面壳
 *
 * 布局：状态栏 → 分镜表格 → 底部工具栏；全屏沉浸式编辑覆盖层。
 * 数据处理逻辑已抽离至 storyboard-utils。
 */
import { memo, useState, useCallback, useEffect, useMemo, useRef, ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Link2, ListVideo, Aperture, Table } from 'lucide-react';
import { buildTabKey, useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { CanvasTabContentBoundary } from '@/features/canvas-tabs/CanvasTabContentBoundary.js';
import { Button, App, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { useReactGraphStore, useGraph } from '@zeroexo/plugin-render-react';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import type { StoryboardNodeData, Shot, EntityRef } from './storyboard-types';
import type { ProductionItem, ProductionItemKind } from '../production-manager/production-manager-types';
import { createProductionItem } from '../production-manager/production-manager-types';
import {
  createNewShot, normalizeUpdate, SAMPLE_SUBJECTS, entityDisplayName,
  collectSubjectSources, extractSubjectMentions, type SubjectMatchSource,
} from './storyboard-utils';
import { ShotSizePickerModal } from './components/ShotSizePickerModal';
import { StoryboardAssociateModal } from './storyboard-associate-modal';
import { FullscreenDropdown, fullToolBtnStyle } from './components/FullscreenDropdown';
import { StoryboardTable } from './components/StoryboardTable';
import { StoryboardSubjectManager } from './StoryboardSubjectManager';
import { StoryboardFullscreenEditor } from './storyboard-fullscreen-editor';
import { Z_INDEX } from '@/shared/constants/z-index.js';
import {
  DeleteConfirmModal,
  RegenModal,
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

  // 2026-08-30 剧管并入分镜：主体映射从本节点 productionItems 索引（原从独立剧管节点收集）
  const pmItemsByEntity = useMemo(() => {
    const map: Record<string, Array<{ id: string; name: string; kind: string }>> = {};
    const items = (data.productionItems ?? []) as Array<{ id: string; name: string; kind: string; aliases?: string[] }>;
    for (const it of items) {
      const keys = new Set([it.name, ...(it.aliases ?? [])].filter((k): k is string => !!k));
      for (const k of keys) {
        if (!map[k]) map[k] = [];
        map[k].push({ id: it.id, name: it.name, kind: it.kind });
      }
    }
    return map;
  }, [data.productionItems]);
  const scriptOptionLabel = useCallback((n: { id?: string; title?: string }) => {
    const scriptDefault = t('storyboard.script');
    const title = n.title || scriptDefault;
    const sameCount = scriptNodes.reduce((acc, x) => acc + ((x.title || scriptDefault) === title ? 1 : 0), 0);
    const shortId = n.id ? n.id.replace(/[^0-9a-zA-Z]/gi, '').slice(-4) : '';
    return sameCount > 1 ? `${title} #${shortId}` : title;
  }, [scriptNodes, t]);
  const scriptEpisodes = useMemo(() => {
    if (!linkedScript) return [];
    return ((linkedScript.data ?? {}) as { episodes?: unknown[] }).episodes ?? [];
  }, [linkedScript]) as Array<{ id: string; title?: string; content?: string }>;
  const episodeLabel = useCallback((ep: { title?: string }, idx: number) => {
    const defaultTitle = t('storyboard.episodeLabel', { number: idx + 1 });
    // 与程序生成的默认标题(第N集,无空格)比较:i18n 插值带空格("第 1 集")会误判为自定义标题导致重复显示
    const hasCustomTitle = !!ep.title && ep.title !== `第${idx + 1}集`;
    return hasCustomTitle ? `${defaultTitle} · ${ep.title}` : defaultTitle;
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
  const progress = data.progressByEpisode?.[activeEpisodeId] ?? data.progress ?? 0;
  const entities = data.entities ?? [];
  // 2026-08-30 剧管并入分镜：主体字典并集 = 本节点 AI 字典 ∪ 本节点主体库条目；范文节点无字典时用 SAMPLE_SUBJECTS 兑底
  const aiSubjects = useMemo(() => {
    const pmItems = (data.productionItems ?? [])
      .map((it: { name?: string; kind?: string; aliases?: string[]; consistency?: string }) => ({
        name: it.name ?? '',
        kind: (it.kind ?? 'character') as 'character' | 'scene' | 'prop',
        aliases: Array.isArray(it.aliases) ? it.aliases : [],
        description: it.consistency ?? '',
      }))
      .filter((s) => s.name.trim());
    const base = data.aiSubjects?.length ? data.aiSubjects : (data.isSample ? SAMPLE_SUBJECTS : undefined);
    if (!base || base.length === 0) return pmItems.length > 0 ? pmItems : undefined;
    return [...base, ...pmItems];
  }, [data.productionItems, data.aiSubjects, data.isSample]);
  // Plan#29: 「状态」概念废弃(改为剧照集 + 自由标签),stateId 选择选项停用
  const subjectStatesByEntity = useMemo(() => ({} as Record<string, Array<{ id: string; name: string }>>), []);
  const activeEpisode = scriptEpisodes.find((e) => e.id === activeEpisodeId) ?? scriptEpisodes[0];
  const activeEpisodeIndex = Math.max(0, scriptEpisodes.findIndex((e) => e.id === activeEpisodeId));

  // 分页
  const PAGE_SIZE = 8;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(shots.length / PAGE_SIZE));
  const paginatedShots = shots.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // UI 状态
  // Plan#50:分镜全屏编辑改为顶部页签承载——本地不再持有 fullscreenOpen,显示与否由 tab store 决定
  const myTabKey = buildTabKey('storyboard', nodeId);
  const tabActive = useCanvasTabStore((s) => s.activeTabKey === myTabKey);
  const tabHost = useCanvasTabStore((s) => s.contentHost);
  const openTab = useCanvasTabStore((s) => s.openTab);
  const closeTab = useCanvasTabStore((s) => s.closeTab);
  const openStoryboardTab = useCallback(() => {
    openTab({ kind: 'storyboard', id: nodeId, title: '分镜' });
  }, [openTab, nodeId]);
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

  // 2026-08-30 征集 #110: 视图两态 = 主体库(剧管, Aperture) ↔ 表格; 原步骤视图语义改为主体库
  const [viewMode, setViewMode] = useState<'subject' | 'table'>('subject');

  const associateScript = useMemo(() => scriptNodes.find((n) => n.id === associateScriptId) ?? null, [scriptNodes, associateScriptId]);
  const associateEpisodes = useMemo(() => {
    if (!associateScript) return [];
    return ((associateScript.data ?? {}) as { episodes?: unknown[] }).episodes ?? [];
  }, [associateScript]) as Array<{ id: string; title?: string; content?: string }>;

  // 主题色
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const cardBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  // 数据变更
  const updateData = useCallback((updater: (prev: StoryboardNodeData) => StoryboardNodeData) => {
    const next = normalizeUpdate(data, activeEpisodeId, updater);
    // 用户真实编辑(增删主体/分镜等)后清除范文标记,与剧本节点行为一致
    const realized = data.isSample ? { ...next, isSample: false } : next;
    store.updateNodeData(nodeId, { ...realized });
    onDataChange(realized);
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
  /** 全屏编辑器内删除（内部已确认，直接删除 + 重排镜号） */
  const handleDeleteShotDirect = useCallback((shotId: string) => {
    updateData((prev) => {
      const filtered = prev.shots.filter((s) => s.id !== shotId);
      return { ...prev, shots: filtered.map((s, i) => ({ ...s, number: i + 1 })) };
    });
    setSelectedShotIds((prev) => { const n = new Set(prev); n.delete(shotId); return n; });
    message.success(t('storyboardRow.deleteShotSuccess'));
  }, [updateData, message, t]);
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
  const handleToggleSelect = useCallback((shotId: string) => {
    setSelectedShotIds((prev) => { const n = new Set(prev); n.has(shotId) ? n.delete(shotId) : n.add(shotId); return n; });
  }, []);
  const updateShot = useCallback((shotId: string, patch: Partial<Shot>) => {
    updateData((prev) => ({ ...prev, shots: prev.shots.map((s) => (s.id === shotId ? { ...s, ...patch } : s)) }));
  }, [updateData]);

  // @ 提及（2026-08-30 征集 #110：选择主体 → 写入 shot.entities 关联 + 描述追加 @主体）
  const handleMentionSelect = useCallback((source: SubjectMatchSource) => {
    if (!mentionShotId) return;
    const shot = shots.find((s) => s.id === mentionShotId);
    const desc = shot?.description ?? '';
    // @主体-状态（2026-08-31）：popover 状态 chip 选中后写入 `@主体-状态`
    const mentionText = source.state ? `${source.name}-${source.state}` : source.name;
    const mentioned = extractSubjectMentions(desc);
    const already = mentioned.some(
      (m) => m.name === source.name && (source.state ? m.state === source.state : true),
    );
    const nextDesc = already ? desc : `${desc}@${mentionText}`;
    // 写入 shot.entities 关联（与全屏编辑器同款；@ 用来关联主体，不只追加文本）
    const current = Array.isArray(shot?.entities) ? shot.entities : [];
    const existing = new Set((current as any[]).map((e) => (typeof e === 'string' ? e : (e?.mention ?? ''))));
    if (!existing.has(mentionText)) {
      updateShot(mentionShotId, {
        description: nextDesc,
        entities: [...current, { entityId: source.id, mention: mentionText, cardId: source.id }],
      });
    } else {
      updateShot(mentionShotId, { description: nextDesc });
    }
    setMentionOpen(false); setMentionShotId(null); setMentionSearch('');
  }, [shots, updateShot, mentionShotId]);
  const handleMentionOpen = useCallback((shotId: string) => { setMentionShotId(shotId); setMentionOpen(true); setMentionSearch(''); }, []);

  // ===== 2026-08-30 主体库条目 CRUD（与节点主体库 StoryboardSubjectManager 同一数据源 productionItems） =====
  const handleAddProductionItem = useCallback((kind: ProductionItemKind) => {
    const item = createProductionItem(kind);
    const sameKindCount = (data.productionItems ?? []).filter((i) => i.kind === kind).length;
    const kindLabel = kind === 'character' ? t('entity.character') : kind === 'scene' ? t('entity.scene') : t('entity.prop');
    item.name = `${kindLabel} ${sameKindCount + 1}`;
    updateData((prev) => ({ ...prev, productionItems: [...(prev.productionItems ?? []), item] }));
  }, [data.productionItems, updateData, t]);

  const handleUpdateProductionItem = useCallback((itemId: string, patch: Partial<ProductionItem>) => {
    updateData((prev) => ({
      ...prev,
      productionItems: (prev.productionItems ?? []).map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
    }));
  }, [updateData]);

  const handleDeleteProductionItem = useCallback((itemId: string) => {
    updateData((prev) => ({
      ...prev,
      productionItems: (prev.productionItems ?? []).filter((it) => it.id !== itemId),
    }));
  }, [updateData]);

  // 2026-08-30 征集 #110：描述文本回车/失焦自动匹配（整段扫描裸词，跳过已 @ 词；命中写 shot.entities 关联）
  const handleAutoMatchMentions = useCallback((shotId: string, text: string) => {
    const target = shots.find((s) => s.id === shotId);
    if (!target) return;
    const sources = collectSubjectSources(entities, aiSubjects, data.productionItems);
    const explicit = new Set(extractSubjectMentions(text).map((m) => m.name));
    // 扫描裸词：按主体名长度降序匹配（长名优先避免短名吞长名），已 @ 词跳过
    const sorted = [...sources].sort((a, b) => b.name.length - a.name.length);
    const matchedNames = new Set<string>();
    let rest = text.replace(/@[\w\u4e00-\u9fa5]+(?:-[\w\u4e00-\u9fa5]+)?/g, ' ');
    for (const src of sorted) {
      if (explicit.has(src.name)) continue;
      if (rest.includes(src.name)) { matchedNames.add(src.name); rest = rest.split(src.name).join(' '); }
    }
    if (matchedNames.size === 0) return;
    const current = Array.isArray(target.entities) ? target.entities : [];
    const existing = new Set(current.map((e) => entityDisplayName(e)));
    const toAdd: EntityRef[] = [];
    for (const name of matchedNames) {
      if (existing.has(name)) continue;
      const src = sources.find((s) => s.name === name);
      toAdd.push({ entityId: src?.id ?? name, mention: name, cardId: src?.id });
      existing.add(name);
    }
    if (toAdd.length === 0) return;
    updateShot(shotId, { entities: [...current, ...toAdd] });
    message.success(t('storyboard.autoMatchedSubjects', { count: toAdd.length }));
  }, [shots, entities, aiSubjects, data.productionItems, updateShot, message, t]);

  // 事件订阅(使用 ref 稳定回调引用,避免因 data 变化导致 useEffect 反复重订阅)
  const handleAddShotRef = useRef(handleAddShot);
  handleAddShotRef.current = handleAddShot;
  const scriptEpisodesRef = useRef(scriptEpisodes);
  scriptEpisodesRef.current = scriptEpisodes;
  useEffect(() => {
    const unsubs = [
      nodeActionBus.on('storyboard:addShot', (e) => { if (e.nodeId === nodeId) handleAddShotRef.current(); }),
      nodeActionBus.on('storyboard:fullscreen', (e) => { if (e.nodeId === nodeId) openStoryboardTab(); }),
      // 2026-08-21 BUG 修复: capsule 菜单"重新生成"有分镜内容时弹出确认弹窗
      nodeActionBus.on('storyboard:requestRegenerate', (e: { nodeId: string; episodeId?: string }) => {
        if (e.nodeId !== nodeId) return;
        const ep = (scriptEpisodesRef.current as Array<{ id: string; title?: string }>).find((ep) => ep.id === e.episodeId);
        setRegenMeta({ episodeId: e.episodeId ?? '', episodeTitle: ep?.title });
        setRegenStep(0);
        setRegenOption('overwrite');
      }),
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
        {/* 2026-08-30 征集 #110: 视图切换 = 主体库(剧管) ↔ 表格；图标保留 Aperture */}
        <Tooltip title={viewMode === 'table' ? t('storyboard.switchToSubjectView', '主体库') : t('storyboard.switchToTableView')}>
          <Button
            size="small"
            type="text"
            icon={viewMode === 'table' ? <Aperture size={14} /> : <Table size={14} />}
            style={{ color: textColor, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28 }}
            onClick={() => { setViewMode(viewMode === 'table' ? 'subject' : 'table'); }}
          />
        </Tooltip>
        <span style={{ fontSize: 11, color: mutedColor }}>{t('storyboard.shotCountSummary', { count: shots.length })}</span>
      </div>

      {/* 内容区域 */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {viewMode === 'subject' ? (
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
            <StoryboardSubjectManager
              items={data.productionItems ?? []}
              onChange={(items) => updateData((prev) => ({ ...prev, productionItems: items }))}
              store={store}
              nodeId={nodeId}
            />
          </div>
        ) : (
          <StoryboardTable readOnly shots={shots} paginatedShots={paginatedShots} selectedRowId={selectedRowId} onRowSelect={setSelectedRowId} selectedShotIds={selectedShotIds} onToggleSelect={handleToggleSelect} onDeleteShot={handleDeleteShot} onUpdateShot={updateShot} cameraOpenId={cameraOpenId} cameraRect={cameraRect} onCameraOpen={(id, r) => { setCameraOpenId(id); setCameraRect(r); }} onCameraClose={() => { setCameraOpenId(null); setCameraRect(null); }} entities={entities} aiSubjects={aiSubjects} subjectStatesByEntity={subjectStatesByEntity} pmItemsByEntity={pmItemsByEntity} mentionOpen={mentionOpen} mentionShotId={mentionShotId} onMentionSelect={handleMentionSelect} onMentionOpen={handleMentionOpen} onMentionClose={() => { setMentionOpen(false); setMentionShotId(null); setMentionSearch(''); }} onShotTypeClick={(id) => { setPickerShotId(id); setPickerOpen(true); }} subjectSources={collectSubjectSources(entities, aiSubjects, data.productionItems)} onAutoMatchMentions={handleAutoMatchMentions} status={status} progress={progress} nodeId={nodeId} linkedScript={linkedScript} activeEpisode={activeEpisode} activeEpisodeId={activeEpisodeId} />
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

      {/* Plan#50:分镜编辑器改为画布顶部页签内嵌呈现(不再全屏覆盖)——幂等 key = storyboard:<nodeId>;
          数据(shots)与回调仍留在节点组件内,关闭统一走页签 X(closeTab) */}
      {tabActive && tabHost ? createPortal(
        <CanvasTabContentBoundary>
        <StoryboardFullscreenEditor
          open
          embedded
          onClose={() => closeTab(myTabKey)}
          shots={shots}
          onUpdateShot={updateShot}
          onAddShot={handleAddShot}
          onDeleteShot={handleDeleteShotDirect}
          episodes={scriptEpisodes}
          activeEpisodeId={activeEpisodeId}
          onEpisodeChange={handleEpisodeChange}
          entities={entities}
          aiSubjects={aiSubjects}
          subjectStatesByEntity={subjectStatesByEntity}
          pmItemsByEntity={pmItemsByEntity}
          productionItems={data.productionItems ?? []}
          onAutoMatchMentions={handleAutoMatchMentions}
          onAddItem={handleAddProductionItem}
          onUpdateItem={handleUpdateProductionItem}
          onDeleteItem={handleDeleteProductionItem}
          status={status}
          progress={progress}
          nodeId={nodeId}
          linkedScript={linkedScript}
          activeEpisode={activeEpisode}
          scriptNodes={scriptNodes}
          scriptOptionLabel={scriptOptionLabel}
          onAssociateScript={openAssociateModal}
        />
        </CanvasTabContentBoundary>,
        tabHost,
        ) : null}

      {/* 弹窗 */}
      <ShotSizePickerModal open={pickerOpen} currentValue={pickerShotId ? shots.find((s) => s.id === pickerShotId)?.shotType ?? '中景' : '中景'} onClose={() => { setPickerOpen(false); setPickerShotId(null); }} onConfirm={(value) => { if (pickerShotId) updateShot(pickerShotId, { shotType: value as any }); setPickerOpen(false); setPickerShotId(null); }} />
      {associateScript && <StoryboardAssociateModal open={associateOpen} onClose={() => { setAssociateOpen(false); setAssociateScriptId(null); }} scriptNodeId={associateScript.id} scriptTitle={associateScript.title} episodes={associateEpisodes.map((ep, idx) => ({ id: ep.id, number: idx + 1, title: ep.title }))} defaultGenerate={false} targetNodeId={nodeId} zIndex={Z_INDEX.FULLSCREEN_MODAL} />}
      <DeleteConfirmModal deleteConfirm={deleteConfirm} onCancel={() => setDeleteConfirm(null)} onOk={confirmDelete} shots={shots} selectedShotIds={selectedShotIds} />
      <RegenModal regenMeta={regenMeta} regenStep={regenStep} regenOption={regenOption} onStepChange={setRegenStep} onOptionChange={setRegenOption} onCancel={() => setRegenMeta(null)} onOverwriteRegen={handleOverwriteRegen} onNewCompareRegen={handleNewCompareRegen} linkedScript={linkedScript} />
    </div>
  );
});