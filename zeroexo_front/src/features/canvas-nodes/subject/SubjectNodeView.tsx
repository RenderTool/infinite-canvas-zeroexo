/**
 * SubjectNodeView - 主体节点视图（Plan#20 主体系统重设计 T7r + 堆叠同框架返工）
 *
 * 与 StackNode 同一套框架的不同布局（用户拍板契约，禁止自由发挥）：
 * - 堆叠 = 上下布局（内容区在上 + 水平导航在下）
 * - 主体 = 左右布局（垂直导航在左 + 内容区在右）
 * 导航行为完全一致（共用 ThumbNav）：
 * - 圆形缩略图最多 5 个 + 滑动窗口 + 1/N 页码
 * - 容器长度自适应降档 5→3→1（±10px 滞回）
 * - 等比缩放（lockAspectRatio，16:9 = 620×348）
 *
 * 右区：封面舞台（当前状态首图 contain，对齐堆叠图片卡）+ 信息条（名字/kind/摘要/音频）
 * 详情编辑走胶囊菜单「详情」→ nodeActionBus 'subject:openEditor' → 打开 SubjectEditorModal。
 * 图片默认 draggable=false（AuthorizedImage 根治），拖拽节点不再误触发素材投放上传。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import { UserRound, MapPin, Package, Volume2 } from 'lucide-react';
import type { NodeRendererProps } from '@zeroexo/core';
import { useTheme } from '@zeroexo/plugin-theme';
import { BaseNodeView, nodeActionBus, ThumbNav, useHydratedContent, resolveAnyThumbUrl } from '@zeroexo/plugin-nodes';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import type { SubjectCardData, SubjectState, EntityKind } from '../storyboard/storyboard-types';
import { ENTITY_KIND_META } from '../storyboard/storyboard-utils';
import { SubjectEditorModal } from './SubjectEditorModal';
import { useSubjectFilterStore } from './subject-filter-store.js';
import { useGraphSafe, detectSubjectRisks, collectSubjectStateRefsByEpisode, RISK_KIND_META } from './subject-risks.js';

export interface SubjectNodeViewProps extends NodeRendererProps {
  connectionController: any;
  store?: any;
}

/** kind 图标（lucide，模块级 icons.ts 语义键 subject=UserRound） */
const KIND_ICON: Record<EntityKind, React.ComponentType<{ size?: number | string }>> = {
  character: UserRound,
  scene: MapPin,
  prop: Package,
};

const DEFAULT_STATE: SubjectState = { id: 'state-default', name: '默认', images: [], note: '' };

/** 默认主体数据（新建节点时使用） */
export function createSubjectDefaultData(kind: string = 'character'): SubjectCardData {
  return {
    name: '',
    kind: kind as SubjectCardData['kind'],
    consistency: '',
    aliases: [],
    coverKey: null,
    states: [{ ...DEFAULT_STATE }],
    activeStateId: 'state-default',
    audio: [],
    episodeIds: [],
    assetSubjectId: null,
  };
}

/** 解析 SubjectCardData（兼容旧数据 imageKeys → images） */
export function parseSubjectData(data: Record<string, unknown> | undefined): SubjectCardData {
  if (!data) return createSubjectDefaultData();
  const rawStates = (data.states as Array<Record<string, unknown>>) ?? [];
  const states: SubjectState[] = rawStates.length > 0
    ? rawStates.map((s) => ({
        id: (s.id as string) ?? `state-${Math.random().toString(36).slice(2, 8)}`,
        name: (s.name as string) ?? '',
        // 新契约 images；旧契约 imageKeys 迁移
        images: (s.images as SubjectState['images']) ?? ((s.imageKeys as string[]) ?? []).map((k) => ({ storageKey: k })),
        note: (s.note as string) ?? '',
        voice: s.voice as SubjectState['voice'],
      }))
    : [{ ...DEFAULT_STATE }];
  return {
    name: (data.name as string) ?? '',
    kind: (data.kind as SubjectCardData['kind']) ?? 'character',
    consistency: (data.consistency as string) ?? '',
    aliases: (data.aliases as string[]) ?? [],
    coverKey: (data.coverKey as string) ?? null,
    states,
    activeStateId: (data.activeStateId as string) ?? states[0]!.id,
    audio: (data.audio as SubjectCardData['audio']) ?? [],
    episodeIds: (data.episodeIds as string[]) ?? [],
    assetSubjectId: (data.assetSubjectId as string) ?? null,
    placeholder: data.placeholder === true,
  };
}

/** 状态切换动画:垂直方向滑动 + 淡入淡出(与堆叠同机制,方向转 90°) */
const SUBJECT_SWITCH_CSS = `
@keyframes ze-subject-card-in {
  from { transform: translateY(var(--ze-slide-from, 12%)) scale(0.985); opacity: 0.25; }
  to { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes ze-subject-card-out {
  from { transform: translateY(0) scale(1); opacity: 1; }
  to { transform: translateY(var(--ze-slide-to, -10%)) scale(0.97); opacity: 0; }
}
`;

/** 切换动画时长(与堆叠一致) */
const SWITCH_ANIM_MS = 340;

/** prefers-reduced-motion：减少动画用户不参与切换动效（降级为直接切换） */
const IS_REDUCED_MOTION =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;

export const SubjectNodeView = memo(function SubjectNodeView({
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
  store,
}: SubjectNodeViewProps) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const data = useMemo(() => parseSubjectData(node.data as Record<string, unknown> | undefined), [node.data]);
  const kindMeta = ENTITY_KIND_META[data.kind];
  const KindIcon = KIND_ICON[data.kind];
  // Plan#20 T9b: 画布按集过滤——未关联当前过滤集的主体卡视觉降噪
  const filterEpisode = useSubjectFilterStore((s) => s.episodeId);
  const filteredOut = !!filterEpisode && !data.episodeIds.includes(filterEpisode);

  // 编辑器 Modal 开关
  const [editorOpen, setEditorOpen] = useState(false);

  // 订阅胶囊菜单「详情」事件 → 打开编辑器
  useEffect(() => {
    const unsub = nodeActionBus.on('subject:openEditor', (event) => {
      if (event.nodeId === node.id) setEditorOpen(true);
    });
    return unsub;
  }, [node.id]);

  // 用户任何编辑 → 清除 AI 占位标记(占位未转正风险消失)
  const handleDataChange = useCallback((next: SubjectCardData) => {
    updateNode({ data: { ...(node.data as Record<string, unknown>), ...next, placeholder: false } });
  }, [updateNode, node.data]);

  // 当前活跃状态
  const activeState = useMemo(
    () => data.states.find((s) => s.id === data.activeStateId) ?? data.states[0] ?? null,
    [data.states, data.activeStateId],
  );
  const activeStateIndex = useMemo(
    () => Math.max(0, data.states.findIndex((s) => s.id === (activeState?.id ?? ''))),
    [data.states, activeState],
  );

  // ===== 切换动画(与堆叠同机制:方向感知滑动 + 淡入淡出,仅 transform/opacity) =====
  const [isAnimating, setIsAnimating] = useState(false);
  const [switchDir, setSwitchDir] = useState<1 | -1>(1);
  const [switchEpoch, setSwitchEpoch] = useState(0);
  const [previousState, setPreviousState] = useState<SubjectState | null>(null);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    };
  }, []);

  const beginSwitchAnimation = useCallback((dir: 1 | -1) => {
    if (IS_REDUCED_MOTION) return;
    setPreviousState(activeState);
    setSwitchDir(dir);
    setSwitchEpoch((e) => e + 1);
    setIsAnimating(true);
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    animTimerRef.current = setTimeout(() => setIsAnimating(false), SWITCH_ANIM_MS);
  }, [activeState]);

  // 状态切换(数据落 activeStateId + 动画,切卡语义对齐堆叠)
  const handleStateChange = useCallback((stateId: string, dir: 1 | -1) => {
    if (stateId === activeState?.id) return;
    beginSwitchAnimation(dir);
    updateNode({ data: { ...(node.data as Record<string, unknown>), activeStateId: stateId } });
  }, [activeState, beginSwitchAnimation, updateNode, node.data]);

  const handlePrevState = useCallback(() => {
    if (data.states.length <= 1) return;
    handleStateChange(data.states[Math.max(0, activeStateIndex - 1)]!.id, -1);
  }, [data.states, activeStateIndex, handleStateChange]);

  const handleNextState = useCallback(() => {
    if (data.states.length <= 1) return;
    handleStateChange(data.states[Math.min(data.states.length - 1, activeStateIndex + 1)]!.id, 1);
  }, [data.states, activeStateIndex, handleStateChange]);

  const handleJumpState = useCallback((index: number) => {
    if (index === activeStateIndex) return;
    handleStateChange(data.states[index]!.id, index > activeStateIndex ? 1 : -1);
  }, [data.states, activeStateIndex, handleStateChange]);

  // 状态导航条目(缩略图 = 状态首图,thumb 级资源优先,对齐堆叠 ImageCardThumb 回退链)
  const stateNavItems = useMemo(() => data.states.map((s) => ({
    id: s.id,
    title: s.name || undefined,
    thumb: <StateThumb state={s} kind={data.kind} dark={isDark} />,
  })), [data.states, data.kind, isDark]);

  // 主题色
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const infoBg = theme.node.fill;

  const title = node.title ?? (data.name || t('canvasNodes.stage.subject'));
  const hasAudio = data.audio.length > 0;
  const showStateNav = data.states.length > 1;
  // Plan#20 T10a: 风险检测——缺形象图 + 同名不同人(与画布其他主体卡 name/aliases 撞车)
  const graph = useGraphSafe(store);
  const otherSubjects = useMemo(
    () => graph.nodes.filter((n) => {
      const x = n as { id?: string; type?: string };
      return x.type === 'subject' && x.id !== node.id;
    }),
    [graph.nodes, node.id],
  );
  const risks = useMemo(() => detectSubjectRisks(data, otherSubjects), [data, otherSubjects]);
  const riskTooltip = risks.map((r) => {
    switch (r.kind) {
      case 'sameName': return t('subject.riskSameName', { name: r.clashWith ?? '' });
      case 'samePerson': return t('subject.riskSamePerson', { name: r.clashWith ?? '' });
      case 'placeholderPending': return t('subject.riskPlaceholderPending');
      default: return t('subject.riskNoImage');
    }
  }).join(' / ');
  const hasRedRisk = risks.some((r) => RISK_KIND_META[r.kind].tone === 'red');
  // Plan#20 T12c: 被引用状态集合(停用保护——被引用状态禁删只可停用)
  const referencedStateIds = useMemo(() => {
    const m = new Map<string, number>();
    for (const [sid, info] of collectSubjectStateRefsByEpisode(graph.nodes as ReadonlyArray<unknown>, data.name, data.aliases, data.states)) {
      m.set(sid, info.count);
    }
    return m;
  }, [graph.nodes, data.name, data.aliases, data.states]);
  // 内容区表面(对齐堆叠 contentSurface:明暗主题分支取中性表面色)
  const contentSurface = isDark ? '#161616' : '#ffffff';

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'row', width: '100%', height: '100%', minWidth: 0, minHeight: 0, opacity: filteredOut ? 0.15 : 1, filter: filteredOut ? 'grayscale(0.7)' : undefined, transition: 'opacity 200ms ease, filter 200ms ease', pointerEvents: filteredOut ? 'none' : undefined }}>
        {/* 左侧垂直状态导航(与堆叠底部导航同一套框架:上限5 + 1/N + 自适应降档) */}
        {showStateNav && (
          <ThumbNav
            orientation="vertical"
            items={stateNavItems}
            activeIndex={activeStateIndex}
            total={data.states.length}
            onPrev={handlePrevState}
            onNext={handleNextState}
            onJump={handleJumpState}
          />
        )}

        {/* 右侧主区:封面舞台 + 信息条 */}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          <BaseNodeView
            node={node}
            pins={pins}
            isSelected={isSelected}
            isHovered={isHovered}
            title={title}
            color={kindMeta.color}
            connectionController={connectionController}
            forceShowPins={forceShowPins}
            invK={invK}
            titleIcon={<KindIcon size={Math.max(10, 13 * (invK ?? 1))} />}
            updateNode={updateNode}
            externalRenaming={externalRenaming}
            onRenameFinish={onRenameFinish}
            contentPadding="0"
            store={store}
          >
            <div style={cardRootStyle}>
              {/* 封面舞台(contain 自适应,对齐堆叠图片卡;切换状态播动画) */}
              <div style={coverAreaStyle(contentSurface)}>
                <style>{SUBJECT_SWITCH_CSS}</style>
                {activeState && (
                  <div
                    key={`active-${activeState.id}-${switchEpoch}`}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      zIndex: 2,
                      animation: switchEpoch > 0
                        ? `ze-subject-card-in ${SWITCH_ANIM_MS}ms cubic-bezier(0.22,1,0.36,1)`
                        : undefined,
                      ['--ze-slide-from' as string]: `${switchDir * 14}%`,
                    } as React.CSSProperties}
                  >
                    <StateCover state={activeState} kind={data.kind} dark={isDark} />
                  </div>
                )}
                {isAnimating && previousState && (
                  <div
                    aria-hidden="true"
                    key={`ghost-${previousState.id}-${switchEpoch}`}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      zIndex: 1,
                      pointerEvents: 'none',
                      animation: `ze-subject-card-out ${SWITCH_ANIM_MS}ms cubic-bezier(0.22,1,0.36,1) forwards`,
                      ['--ze-slide-to' as string]: `${-switchDir * 10}%`,
                    } as React.CSSProperties}
                  >
                    <StateCover state={previousState} kind={data.kind} dark={isDark} />
                  </div>
                )}
                {/* Plan#20 T10a: 风险角标——缺形象图(琥珀) / 同名不同人(红,优先) */}
                {risks.length > 0 && (
                  <div style={{ position: 'absolute', top: 6, right: 6, zIndex: 5 }}>
                    <Tooltip title={riskTooltip}>
                      <span style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 18, height: 18, borderRadius: '50%', cursor: 'help',
                        background: hasRedRisk ? 'rgba(239,68,68,0.92)' : 'rgba(245,158,11,0.9)',
                        color: '#fff',
                        fontSize: 11, fontWeight: 700, boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                      }}>!</span>
                    </Tooltip>
                  </div>
                )}
              </div>

              {/* 信息条 */}
              <div style={infoBarStyle(infoBg)}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {data.name || t('subject.untitled')}
                    </span>
                    <span style={kindBadgeStyle(kindMeta.color)}>
                      {t(kindMeta.labelKey)}
                    </span>
                  </div>
                  {/* 状态摘要 */}
                  <div style={{ fontSize: 10, color: textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {activeState && activeState.name !== '默认'
                      ? activeState.name
                      : (data.consistency || t('subject.stateCount', { count: data.states.length }))}
                  </div>
                </div>

                {/* 音频按钮（有音频才显示） */}
                {hasAudio && (
                  <button type="button" style={audioBtnStyle(textMuted)} title={t('subject.audioLabel')}>
                    <Volume2 size={13} />
                  </button>
                )}
              </div>
            </div>
          </BaseNodeView>
        </div>
      </div>

      {/* 主体编辑器 Modal */}
      {editorOpen && (
        <SubjectEditorModal
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          data={data}
          onDataChange={handleDataChange}
          nodeId={node.id}
          referencedStateIds={referencedStateIds}
        />
      )}
    </>
  );
});

// ===== 封面舞台(状态首图 contain,对齐堆叠图片卡) =====

function StateCover({ state, kind, dark }: { state: SubjectState; kind: EntityKind; dark: boolean }): React.ReactElement {
  const KindIcon = KIND_ICON[kind];
  const firstKey = state.images[0]?.storageKey;
  const fallback = firstKey ? getResourceUrl(firstKey, 'preview') : undefined;
  const hydrated = useHydratedContent(firstKey ?? '', fallback ?? '');
  if (!hydrated) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.3)' }}>
        <KindIcon size={40} />
        <span style={{ fontSize: 11, opacity: 0.75 }}>{state.name || '—'}</span>
      </div>
    );
  }
  return <img src={hydrated} alt={state.name} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />;
}

// ===== 导航缩略图(状态首图,thumb 级资源优先,回退 preview;无图 → kind 图标骨架) =====

function StateThumb({ state, kind, dark }: { state: SubjectState; kind: EntityKind; dark: boolean }): React.ReactElement {
  const KindIcon = KIND_ICON[kind];
  const firstKey = state.images[0]?.storageKey;
  const fallback = firstKey ? getResourceUrl(firstKey, 'preview') : undefined;
  const hydrated = useHydratedContent(firstKey ?? '', fallback ?? '');
  // 34px 槽位优先 thumb 级资源(对齐堆叠 ImageCardThumb 回退链)
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    if (!firstKey) return;
    let cancelled = false;
    resolveAnyThumbUrl(firstKey).then((u) => { if (!cancelled) setThumb(u); });
    return () => { cancelled = true; };
  }, [firstKey]);
  const final = thumb || hydrated;
  if (!final) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)', color: dark ? 'rgba(255,255,255,0.45)' : 'rgba(15,23,42,0.35)' }}>
        <KindIcon size={14} />
      </div>
    );
  }
  return <img src={final} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />;
}

// ===== 样式（无边线风格：背景分层替代硬边线，遵循 DESIGN.md） =====

const cardRootStyle: CSSProperties = {
  width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
  overflow: 'hidden', minHeight: 0,
};

function coverAreaStyle(contentSurface: string): CSSProperties {
  return {
    flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden',
    background: contentSurface,
  };
}

function infoBarStyle(bg: string): CSSProperties {
  return {
    flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 12px', background: bg,
  };
}

function kindBadgeStyle(color: string): CSSProperties {
  return {
    fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
    background: `${color}20`, color, flexShrink: 0,
  };
}

function audioBtnStyle(color: string): CSSProperties {
  return {
    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
    border: 'none', background: 'rgba(128,128,128,0.12)',
    color, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}
