/**
 * CreationNodeView - 剧创节点(剧本/分镜/出片)共享视图
 *
 * 包裹 BaseNodeView,children 渲染对应独立页面壳(ScriptSheet/StoryboardSheet/WorkbenchSheet)。
 * 数据模型(独立页面壳版本):
 * - 节点不依赖任何创作项目,内容直接写入 node.data,随画布 Yjs 同步。
 * - 剧本节点:episodes/activeEpisodeId 持久化到 node.data,随画布 Yjs 同步。
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import { Clapperboard, Film, FileText, TriangleAlert } from 'lucide-react';
import type { NodeRendererProps } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import { useTheme } from '@zeroexo/plugin-theme';
import { BaseNodeView } from '@zeroexo/plugin-nodes';
import type { StoryboardNodeData } from './storyboard/storyboard-types.js';
import type { CreationNodeType } from './creation-node-types.js';
import type { Episode } from '@/features/canvas-nodes/storyboard/script-types.js';
import { serializeScriptLines, buildSampleLines, createScriptLine } from '@/features/canvas-nodes/script-editor/script-lines.js';
import { ScriptEditorSheet } from './storyboard/script-editor-sheet.js';
import { StoryboardSheet } from './storyboard/storyboard-sheet.js';
import { WorkbenchSheet } from './storyboard/workbench-sheet.js';
import { useGraphSafe, subjectRiskInputOf, detectSubjectRisks, detectBrokenRefs, detectCrossEpisodeStateConflicts, RISK_KIND_META } from './subject/subject-risks.js';

export interface CreationNodeViewProps extends NodeRendererProps {
  connectionController: ConnectionController | null;
  kind: CreationNodeType;
  /** 画布图 store(用于上一个/下一个导航) */
  store?: any;
}

/** 各剧创节点头部图标(尺寸乘 invK 反缩放,与 text/image/video 等节点标题图标保持一致) */
const KIND_ICON = (invK: number): Record<CreationNodeType, React.ReactNode> => {
  const size = Math.max(9, Math.min(13 * invK, 16));
  return {
    script: <FileText size={size} />,
    storyboard: <Clapperboard size={size} />,
    workbench: <Film size={size} />,
  };
};

export function CreationNodeView({
  node,
  pins,
  isSelected,
  isHovered,
  forceShowPins,
  updateNode,
  invK,
  externalRenaming,
  onRenameFinish,
  connectionController,
  kind,
  store,
}: CreationNodeViewProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();

  const data = (node.data ?? {}) as Record<string, unknown>;
  // Plan#20 T10a: 分镜聚合风险角标——下游主体卡(edge 关联)风险总数
  const graph = useGraphSafe(store);
  const subjectRiskSummary = useMemo(() => {
    if (kind !== 'storyboard') return null;
    const nodes = graph.nodes as Array<{ id: string; type: string }>;
    const edges = graph.edges as Array<{ source?: { nodeId: string }; target?: { nodeId: string } }>;
    const subjectIds = new Set(nodes.filter((n) => n.type === 'subject').map((n) => n.id));
    const subjectCards = nodes.filter((n) => n.type === 'subject');
    const downstreamIds = new Set(
      edges.filter((e) => e.source?.nodeId === node.id && e.target?.nodeId && subjectIds.has(e.target.nodeId))
        .map((e) => e.target!.nodeId!),
    );
    if (downstreamIds.size === 0 && subjectCards.length === 0) return null;
    // Plan#20 T12d: 引用断裂——本分镜 shots 中引用名在画布主体卡集合找不到(有卡时才检测,避免旧数据全量误报)
    const brokenRefs = subjectCards.length > 0 ? detectBrokenRefs([node], subjectCards) : [];
    const list: Array<{ name: string; risks: ReturnType<typeof detectSubjectRisks> }> = [];
    if (brokenRefs.length > 0) {
      list.push({
        name: t('canvasNodes.stage.storyboard'),
        risks: brokenRefs.map((b) => ({ kind: 'brokenRef' as const, subjectName: b.mention })),
      });
    }
    for (const n of graph.nodes) {
      const x = n as { id: string; type: string };
      if (x.type !== 'subject' || !downstreamIds.has(x.id)) continue;
      const input = subjectRiskInputOf(n);
      const others = graph.nodes.filter((o) => {
        const y = o as { id: string; type: string };
        return y.type === 'subject' && y.id !== x.id;
      });
      const risks = detectSubjectRisks(input, others);
      // Plan#20 T12d: 跨集形象冲突——该卡被多集引用且引用到不同有图状态
      const rawStates = ((n as { data?: Record<string, unknown> }).data?.states as Array<{ id?: string; images?: unknown[] }> | undefined) ?? [];
      const cross = detectCrossEpisodeStateConflicts(
        graph.nodes,
        input.name,
        input.aliases,
        rawStates.filter((s) => typeof s.id === 'string').map((s) => ({ id: s.id as string, images: Array.isArray(s.images) ? s.images : [] })),
      );
      for (const c of cross) risks.push({ kind: 'crossEpisodeState', subjectName: c.subjectName });
      if (risks.length > 0) list.push({ name: input.name || t('canvasNodes.stage.subject'), risks });
    }
    if (list.length === 0) return null;
    // Plan#20 T12d: 六类风险 short 文案映射(与 SubjectNodeView 角标一致)
    const shortOf = (kind: string) => {
      const keys: Record<string, string> = {
        noImage: 'subject.riskNoImageShort',
        placeholderPending: 'subject.riskPlaceholderPendingShort',
        sameName: 'subject.riskSameNameShort',
        samePerson: 'subject.riskSamePersonShort',
        brokenRef: 'subject.riskBrokenRefShort',
        crossEpisodeState: 'subject.riskCrossEpisodeStateShort',
      };
      return t(keys[kind] ?? 'subject.riskNoImageShort');
    };
    return {
      count: list.length,
      hasClash: list.some((x) => x.risks.some((r) => RISK_KIND_META[r.kind]?.tone === 'red')),
      detail: list
        .map((x) => `${x.name}(${x.risks.map((r) => shortOf(r.kind)).join(',')})`)
        .join('; '),
    };
  }, [kind, graph, node.id, t]);
  // 剧本剧集(持久化到 node.data.episodes) + 当前选中集
  // 向后兼容:旧节点仅有 data.content(单集 HTML)而无 episodes,则从 content 迁移出首集
  const episodes = useMemo<Episode[]>(() => {
    const eps = (data.episodes as Episode[] | undefined) ?? [];
    if (eps.length > 0) return eps;
    const legacyContent = (data.content as string | undefined) ?? '';
    if (!legacyContent) return [];
    return [{ id: 'ep-1', number: 1, title: '第1集', content: legacyContent }];
  }, [data.episodes, data.content]);
  const activeEpisodeId = (data.activeEpisodeId as string | undefined) ?? episodes[0]?.id ?? '';
  // 分镜数据（useMemo 稳定引用，避免 StoryboardSheet 不必要的重渲染）
  const storyboardData: StoryboardNodeData = useMemo(() => ({
    shots: (data.shots as StoryboardNodeData['shots']) ?? [],
    entities: (data.entities as StoryboardNodeData['entities']) ?? [],
    status: (data.status as StoryboardNodeData['status']) ?? 'idle',
    isSample: Boolean(data.isSample),
    sourceScriptId: (data.sourceScriptId as string | undefined),
    activeEpisodeId: (data.activeEpisodeId as string | undefined),
    shotsByEpisode: (data.shotsByEpisode as StoryboardNodeData['shotsByEpisode']),
    statusByEpisode: (data.statusByEpisode as StoryboardNodeData['statusByEpisode']),
    progressByEpisode: (data.progressByEpisode as StoryboardNodeData['progressByEpisode']),
  }), [data.shots, data.entities, data.status, data.isSample, data.sourceScriptId, data.activeEpisodeId, data.shotsByEpisode, data.statusByEpisode, data.progressByEpisode]);
  // 场景编号开关持久化到 node.data(全屏编辑使用)
  const sceneNumbers = Boolean(data.sceneNumbers);
  // 标签显隐开关持久化到 node.data(全屏编辑使用)
  const showLabels = data.showLabels !== false;

  const nodeColor = theme.node.fill;
  const title = node.title ?? (data.title as string) ?? t(`canvasNodes.stage.${kind}`);

  // 稳定化 data 引用：避免 handleXxx 闭包捕获过时数据
  const dataRef = useRef(data);
  dataRef.current = data;
  const episodesRef = useRef(episodes);
  episodesRef.current = episodes;
  const activeEpisodeIdRef = useRef(activeEpisodeId);
  activeEpisodeIdRef.current = activeEpisodeId;

  // 剧本剧集变更 → 回写 node.data.episodes(随画布 Yjs 同步)
  const handleEpisodesChange = useCallback(
    (nextEpisodes: Episode[]) => {
      const currentData = dataRef.current;
      console.log('[CreationNodeView] handleEpisodesChange called, episodes count:', nextEpisodes.length, 'first episode content length:', nextEpisodes[0]?.content?.length ?? 0);
      updateNode({ data: { ...currentData, episodes: nextEpisodes, status: 'ready' } });
    },
    [updateNode],
  );

  // 当前剧集变更 → 回写 node.data.activeEpisodeId
  const handleActiveEpisodeChange = useCallback(
    (id: string) => {
      const currentActiveId = activeEpisodeIdRef.current;
      if (id === currentActiveId) return;
      const currentData = dataRef.current;
      updateNode({ data: { ...currentData, activeEpisodeId: id } });
    },
    [updateNode],
  );

  // 复合更新(同时写入 episodes + activeEpisodeId,避免 stale closure)
  const handleEpisodesAndActiveChange = useCallback(
    (nextEpisodes: Episode[], nextActiveId?: string) => {
      const currentData = dataRef.current;
      const patch: Record<string, unknown> = { episodes: nextEpisodes, status: 'ready' };
      if (nextActiveId !== undefined) {
        patch.activeEpisodeId = nextActiveId;
      }
      updateNode({ data: { ...currentData, ...patch } });
    },
    [updateNode],
  );

  // 新增剧集:根据当前最大编号生成新集,并自动创建一个空段落
  const handleAddEpisode = useCallback(() => {
    const currentEpisodes = episodesRef.current;
    const currentData = dataRef.current;
    const maxNumber = currentEpisodes.reduce((max, ep) => Math.max(max, ep.number), 0);
    const newEp: Episode = {
      id: `ep-${Date.now()}`,
      number: maxNumber + 1,
      title: `第${maxNumber + 1}集`,
      content: serializeScriptLines([createScriptLine('action', '')]),
    };
    const nextEpisodes = [...currentEpisodes, newEp];
    updateNode({ data: { ...currentData, episodes: nextEpisodes, activeEpisodeId: newEp.id, status: 'ready' } });
  }, [updateNode]);

  // 场景编号开关变更 → 回写 node.data.sceneNumbers
  const handleSceneNumbersChange = useCallback(
    (next: boolean) => {
      if (next === sceneNumbers) return;
      updateNode({ data: { ...data, sceneNumbers: next } });
    },
    [updateNode, data, sceneNumbers],
  );

  // 标签显隐开关变更 → 回写 node.data.showLabels
  const handleShowLabelsChange = useCallback(
    (next: boolean) => {
      if (next === showLabels) return;
      updateNode({ data: { ...data, showLabels: next } });
    },
    [updateNode, data, showLabels],
  );

  // 范文态开关变更 → 回写 node.data.isSample(用户真实编辑后清除范文标记)
  const handleIsSampleChange = useCallback(
    (next: boolean) => {
      if (Boolean(data.isSample) === next) return;
      updateNode({ data: { ...data, isSample: next } });
    },
    [updateNode, data],
  );

  // 分镜数据变更 → 回写 node.data
  const handleStoryboardDataChange = useCallback(
    (next: StoryboardNodeData) => {
      updateNode({ data: { ...data, ...next } });
    },
    [updateNode, data],
  );

  // 首次进入剧本节点:无剧集时自动填充"第1集"范文并标记 isSample,
  // 使其行为与真实剧本一致(显示集数/可编辑);用 sampleInitialized 避免重复初始化。
  useEffect(() => {
    if (kind !== 'script') return;
    if (episodes.length > 0) return;
    if (Boolean(data.sampleInitialized)) return;
    const sampleEp: Episode = {
      id: `ep-sample-${Date.now()}`,
      number: 1,
      title: '第1集',
      content: serializeScriptLines(buildSampleLines()),
    };
    updateNode({
      data: { ...data, episodes: [sampleEp], activeEpisodeId: sampleEp.id, isSample: true, sampleInitialized: true },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, episodes.length, data.sampleInitialized, updateNode]);

  return (
    <BaseNodeView
      node={node}
      pins={pins}
      isSelected={isSelected}
      isHovered={isHovered}
      title={title}
      color={nodeColor}
      connectionController={connectionController}
      forceShowPins={forceShowPins}
      invK={invK}
      titleIcon={KIND_ICON(invK ?? 1)[kind]}
      updateNode={updateNode}
      externalRenaming={externalRenaming}
      onRenameFinish={onRenameFinish}
      contentPadding="0"
      store={store}
    >
      <div style={contentShellStyle}>
        {/* Plan#20 T10a/T12d: 聚合风险角标——下游主体卡存在缺图/占位/重名/断引用/跨集冲突风险 */}
        {subjectRiskSummary && (
          <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 5 }}>
            <Tooltip title={`${t('subject.riskAggregateDesc')} ${subjectRiskSummary.detail}`}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                padding: '0 7px', height: 20, borderRadius: 999, cursor: 'help',
                background: subjectRiskSummary.hasClash ? 'rgba(239,68,68,0.92)' : 'rgba(245,158,11,0.9)',
                color: '#fff', fontSize: 11, fontWeight: 700,
                boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
              }}>
                <TriangleAlert size={12} />
                {subjectRiskSummary.count}
              </span>
            </Tooltip>
          </div>
        )}
        {kind === 'script' ? (
          <ScriptEditorSheet
            nodeId={node.id}
            title={title}
            episodes={episodes}
            activeEpisodeId={activeEpisodeId}
            onEpisodesChange={handleEpisodesChange}
            onActiveEpisodeChange={handleActiveEpisodeChange}
            onEpisodesAndActiveChange={handleEpisodesAndActiveChange}
            onAddEpisode={handleAddEpisode}
            sceneNumbers={sceneNumbers}
            onSceneNumbersChange={handleSceneNumbersChange}
            showLabels={showLabels}
            onShowLabelsChange={handleShowLabelsChange}
            isSample={Boolean(data.isSample)}
            onIsSampleChange={handleIsSampleChange}
          />
        ) : kind === 'storyboard' ? (
          <StoryboardSheet nodeId={node.id} data={storyboardData} onDataChange={handleStoryboardDataChange} />
        ) : (
          <WorkbenchSheet nodeId={node.id} />
        )}
      </div>
    </BaseNodeView>
  );
}

const contentShellStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxSizing: 'border-box',
  position: 'relative',
};