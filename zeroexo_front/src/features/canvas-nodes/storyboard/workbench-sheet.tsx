/**
 * WorkbenchSheet - 画布"出片(workbench)节点"独立页面壳
 *
 * 节点内紧凑视图：根据 status 显示不同状态内容（场记板视觉）。
 * 全屏编辑器：portal 到 document.body，左侧镜头列表 + 右侧空白占位（轨道区由 T4 实现）。
 * 数据写入 node.data，随画布 Yjs 同步。
 */

import { memo, useState, useCallback, useMemo, useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Film, Clapperboard, Play } from 'lucide-react';
import { Button, Progress, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { useReactGraphStore } from '@zeroexo/plugin-render-react';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { buildTabKey, useCanvasTabStore } from '@/features/canvas-tabs/canvas-tab-store.js';
import { CanvasTabContentBoundary } from '@/features/canvas-tabs/CanvasTabContentBoundary.js';
import { loadModelDurationBounds } from '@/features/generator-settings/dynamic-param-form.js';
import { uploadAsset } from '@/features/asset-picker/services/upload-asset.js';
import type { WorkbenchNodeData, WorkbenchShot, WorkbenchShotReference } from './workbench-types';
import type { StoryboardEntity } from './storyboard-types';
import { extractSubjectMentions } from './storyboard-utils';
import { generateVideo } from './workbench-frame-api';
import { useCanvasAgentStore } from '@/features/canvas-agent/ui/store.js';
import { extractVideoFirstFrame, extractVideoLastFrame, blobToFile } from '@/shared/utils/video-frame.js';

import { StoryboardMergedTab } from './storyboard-merged-tab';

// OpenCut 暗色专业剪辑风配色常量（模块级，供组件内外使用）
const OPENCUT_ACCENT = '#3b82f6';

export interface WorkbenchSheetProps {
  nodeId: string;
  data: WorkbenchNodeData;
  onDataChange: (data: WorkbenchNodeData) => void;
}

export const WorkbenchSheet = memo(function WorkbenchSheet({
  nodeId,
  data,
  onDataChange,
}: WorkbenchSheetProps): ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  // 底部 NodeGenerateDock 依赖真实 graph store(useViewport 会用 store.subscribeViewport)。
  // 2026-08-31 修复:store 不能靠父级透传——extensions.tsx 渲染 CreationNodeView 时并不传 store
  // (NodeRendererProps 无此字段),透传即 undefined → dock 报 "Cannot read properties of undefined"。
  // 一律走 CanvasView context 取,与 StoryboardSheet 同款。
  const store = useReactGraphStore();

  // Plan#50:工作台全屏改为顶部页签承载——本地不再持有 fullscreenOpen,显示与否由 tab store 决定
  const myTabKey = buildTabKey('workbench', nodeId);
  const tabActive = useCanvasTabStore((s) => s.activeTabKey === myTabKey);
  const tabHost = useCanvasTabStore((s) => s.contentHost);
  const openTab = useCanvasTabStore((s) => s.openTab);
  const openWorkbenchTab = useCallback(() => {
    openTab({ kind: 'workbench', id: nodeId, title: t('canvasNodes.stage.workbench') });
  }, [openTab, nodeId, t]);
  const [pps, setPps] = useState(60);

  // 智能感知(2026-08-31):出片工作台激活 → Agent 自动切换为出片 Agent(production_agent);
  // 关闭/切换其他页签 → 恢复画布 Agent
  useEffect(() => {
    useCanvasAgentStore.getState().setAgentTaskType(tabActive ? 'production_agent' : 'canvas_agent');
  }, [tabActive]);

  // OpenCut 暗色专业剪辑风配色（Plan#53 §2 布局契约）
  // 2026-08-31：全站统一画布背景色
  const OPENCUT_BG = isDark ? theme.canvas.background : '#f8f8f8';
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const bgPage = isDark ? OPENCUT_BG : '#f8f8f8';

  // 进度
  const progressPercent = useMemo(() => {
    if (data.shots.length === 0) return 0;
    return Math.round((data.completedCount / data.shots.length) * 100);
  }, [data.shots.length, data.completedCount]);

  // 事件订阅
  useEffect(() => {
    const unsub = nodeActionBus.on('workbench:fullscreen', (e: { nodeId: string }) => {
      if (e.nodeId === nodeId) openWorkbenchTab();
    });
    return () => unsub?.();
  }, [nodeId, openWorkbenchTab]);

  // 打开工作台页签(幂等)
  const openFullscreen = useCallback(() => {
    openWorkbenchTab();
  }, [openWorkbenchTab]);

  // ===== 生产台状态 =====
  const [activeIndex, setActiveIndex] = useState(0);
  const [timelineOrder, _setTimelineOrder] = useState<string[] | null>(null);
  const [playhead, setPlayhead] = useState(0);

  // 按时间轴顺序排列的 shots
  const orderedShots = useMemo<WorkbenchShot[]>(() => {
    if (!timelineOrder || timelineOrder.length === 0) return data.shots;
    const shotMap = new Map(data.shots.map((s) => [s.id, s]));
    return timelineOrder.map((id) => shotMap.get(id)).filter(Boolean) as WorkbenchShot[];
  }, [data.shots, timelineOrder]);

  // 当前选中镜头
  const currentShot = useMemo<WorkbenchShot | undefined>(() => {
    return orderedShots[activeIndex] ?? orderedShots[0];
  }, [orderedShots, activeIndex]);

  // 当前镜头引用主体(从描述 @主体-状态 提及匹配主体库) → 展示在提示词区上方
  // 携带 anchorSentence/description/stateName,生成视频时展开进提示词(主体本质是提示词,2026-08-31)
  const shotSubjects = useMemo(() => {
    if (!currentShot) return [];
    const mentions = extractSubjectMentions(currentShot.description ?? '');
    return (data.entities ?? []).flatMap((e) => {
      const m = mentions.find((x) => x.name === e.name);
      if (!m) return [];
      const state = m.state ? e.states?.find((s) => s.name === m.state) : undefined;
      return [{
        id: e.id,
        name: e.name,
        kind: e.kind,
        anchorSentence: e.anchorSentence,
        description: e.description,
        // 状态细分:优先匹配主体已定义状态,容忍提及未收录的状态名
        stateName: state?.name ?? m.state,
      }];
    });
  }, [currentShot, data.entities]);

  // T6:参考模式切换提示(2026-08-31)——多模态→首尾帧时,无 slot 的多余图片参考不可见,提示用户
  const prevRefModeRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const mode = (currentShot?.paramValues?.mode as string) ?? 'multi-modal-reference';
    const prev = prevRefModeRef.current;
    prevRefModeRef.current = mode;
    if (!prev || prev === mode) return;
    const hiddenImages = (currentShot?.references ?? []).filter(
      (r) => r.kind === 'image' && !r.slot,
    ).length;
    if (mode === 'image-to-video-first-last-frame' && hiddenImages > 0) {
      message.info(`${hiddenImages} 张参考图在当前首尾帧模式下不可见，切回多模态即恢复`);
    }
  }, [currentShot]);

  // 智能感知(2026-08-31):当前镜头摘要注入 Agent 会话——点击时间轴片段后 Agent 自动感知镜头上下文
  useEffect(() => {
    if (!currentShot) {
      useCanvasAgentStore.getState().setWorkbenchShotContext(null);
      return;
    }
    const refs = (currentShot.references ?? [])
      .map((r) => (r.slot ? `@${r.slot}` : '@图片') + `: ${r.title ?? r.kind}`)
      .join(', ');
    const subjects = shotSubjects
      .map((s) => (s.stateName ? `${s.name}(状态: ${s.stateName})` : s.name))
      .join(', ');
    useCanvasAgentStore.getState().setWorkbenchShotContext(
      [
        `【当前镜头 #${currentShot.number}】`,
        `描述: ${currentShot.description ?? ''}`,
        `景别/时长: ${currentShot.shotType ?? ''} / ${currentShot.duration}s`,
        `imagePrompt: ${currentShot.imagePrompt ?? ''}`,
        `videoPrompt: ${currentShot.videoPrompt ?? ''}`,
        refs ? `参考素材: ${refs}` : '',
        subjects ? `引用主体: ${subjects}` : '',
      ].filter(Boolean).join('\n'),
    );
  }, [currentShot, shotSubjects]);

  // 当前生效视频
  const activeVideo = useMemo(() => {
    const idx = currentShot?.activeVideoIndex ?? 0;
    return currentShot?.videos?.[idx];
  }, [currentShot]);

  // 时间轴数据映射
  const timelineData = useMemo(() => {
    return orderedShots.map((s) => ({
      id: s.id,
      number: s.number,
      duration: s.duration,
      status: s.status === 'pending' ? 'idle' as const : s.status,
      thumbnailUrl: s.firstFrameKey,
      label: `#${s.number} ${s.description || s.shotType}`,
      hasAudio: !!s.audioPreview,
    }));
  }, [orderedShots]);

  // 更新单个镜头字段
  const onUpdateShot = useCallback((shotId: string, updates: Partial<WorkbenchShot>) => {
    const updatedShots = data.shots.map((s) =>
      s.id === shotId ? { ...s, ...updates } : s,
    );
    onDataChange({ ...data, shots: updatedShots });
  }, [data, onDataChange]);

  // 从视频抽帧 → 上传 → 写入当前镜头 references.slot（T2 本镜取帧 / T3 跨镜衔接共用）
  const extractFrameIntoShot = useCallback(async (
    videoKey: string,
    slot: 'first' | 'last',
    title: string,
  ): Promise<void> => {
    if (!currentShot) return;
    try {
      const blob =
        slot === 'first'
          ? await extractVideoFirstFrame(videoKey)
          : await extractVideoLastFrame(videoKey);
      const uploaded = await uploadAsset(blobToFile(blob, `shot-${currentShot.number}-${slot}.jpg`));
      const d = uploaded.data;
      // 类型收窄:image 分支取 storageKey/dataUrl
      let storageKey: string | undefined;
      let url: string | undefined;
      if (d.kind === 'image') {
        storageKey = d.storageKey;
        url = d.dataUrl;
      }
      const ref: WorkbenchShotReference = {
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'image',
        title,
        storageKey,
        url,
        slot,
      };
      const existing = currentShot.references ?? [];
      onUpdateShot(currentShot.id, { references: [...existing.filter((r) => r.slot !== slot), ref] });
    } catch {
      // 抽帧失败静默(mock 视频/跨域受限)
    }
  }, [currentShot, onUpdateShot]);

  // 上游主体参考图导入（T8,2026-08-31）：当前镜头引用主体的 referenceImages → 拷贝进 references（快照语义）
  const importSubjectImages = useCallback(async () => {
    if (!currentShot) return;
    const existing = currentShot.references ?? [];
    const newRefs = shotSubjects.flatMap((s) => {
      const entity = (data.entities ?? []).find((e) => e.id === s.id);
      return (entity?.referenceImages ?? []).map((img) => ({
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: 'image' as const,
        title: `${entity?.name ?? s.name}-参考`,
        storageKey: img.storageKey,
      }));
    });
    if (newRefs.length > 0) {
      onUpdateShot(currentShot.id, { references: [...existing, ...newRefs] });
    }
  }, [currentShot, shotSubjects, data.entities, onUpdateShot]);

  // 跨镜衔接按钮（T3）：前镜尾帧→首帧 / 后镜首帧→尾帧（相邻镜头已生成视频时显示）
  const promptExtraActions = useMemo(() => {
    if (!currentShot) return [];
    const actions: Array<{ key: string; label: string; onClick: () => void }> = [];
    const prevShot = activeIndex > 0 ? orderedShots[activeIndex - 1] : undefined;
    const nextShot = activeIndex < orderedShots.length - 1 ? orderedShots[activeIndex + 1] : undefined;
    if (prevShot) {
      const done = prevShot.videos?.find((v) => v.status === 'done');
      if (done?.storageKey) {
        actions.push({
          key: 'prev-tail',
          label: `取#${prevShot.number}尾帧作首帧`,
          onClick: () => void extractFrameIntoShot(done.storageKey!, 'first', `前镜#${prevShot.number}尾帧`),
        });
      }
    }
    if (nextShot) {
      const done = nextShot.videos?.find((v) => v.status === 'done');
      if (done?.storageKey) {
        actions.push({
          key: 'next-head',
          label: `取#${nextShot.number}首帧作尾帧`,
          onClick: () => void extractFrameIntoShot(done.storageKey!, 'last', `后镜#${nextShot.number}首帧`),
        });
      }
    }
    // T8:当前镜头引用主体携带 referenceImages 时,提供「导入主体参考图」(快照语义,断开上游保留)
    const hasSubjectImages = shotSubjects.some(
      (s) => (data.entities ?? []).find((e) => e.id === s.id)?.referenceImages?.length,
    );
    if (hasSubjectImages) {
      actions.push({
        key: 'import-subjects',
        label: '导入主体参考图',
        onClick: () => void importSubjectImages(),
      });
    }
    return actions;
  }, [currentShot, activeIndex, orderedShots, extractFrameIntoShot, shotSubjects, data.entities, importSubjectImages]);

  // 上传文件 → 追加到当前镜头 references（拖拽导入 / 外部调用共用；随 node.data 云同步）
  const uploadFileToCurrentShot = useCallback(async (file: File) => {
    if (!currentShot) return;
    try {
      const uploaded = await uploadAsset(file);
      const d = uploaded.data;
      let refKind: WorkbenchShotReference['kind'] = 'text';
      let storageKey: string | undefined;
      let url: string | undefined;
      let width: number | undefined;
      let height: number | undefined;
      if (d.kind === 'image') {
        refKind = 'image';
        storageKey = d.storageKey;
        url = d.dataUrl;
        width = d.width;
        height = d.height;
      } else if (d.kind === 'video') {
        refKind = 'video';
        storageKey = d.storageKey;
        url = d.url;
        width = d.width;
        height = d.height;
      } else if (d.kind === 'audio') {
        refKind = 'audio';
        storageKey = d.storageKey;
        url = d.url;
      }
      const ref: WorkbenchShotReference = {
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: refKind,
        title: uploaded.title.replace(/\.[^.]+$/, ''),
        storageKey,
        url,
        width,
        height,
      };
      onUpdateShot(currentShot.id, { references: [...(currentShot.references ?? []), ref] });
    } catch {
      // 上传失败静默（不打断当前编辑）
    }
  }, [currentShot, onUpdateShot]);

  // ===== 模型时长上下限（真实模型参数，非前端硬编码） =====
  // 出片轨道 clip 的最大/最小长度由所选模型的模板 duration 参数决定：
  // 优先 channelConstraints.bounds.minDuration/maxDuration，回落 duration 参数 min/max。
  const [durationBounds, setDurationBounds] = useState<{ min: number; max: number } | null>(null);
  const activeModel = currentShot?.model ?? '';
  useEffect(() => {
    if (!activeModel) {
      setDurationBounds(null);
      return;
    }
    let cancelled = false;
    void loadModelDurationBounds('video', activeModel).then((bounds) => {
      if (!cancelled) setDurationBounds(bounds);
    });
    return () => { cancelled = true; };
  }, [activeModel]);

  // 边界就绪后把超出模型能力范围的存量时长一次性拉回合法区间（幂等：拉回后不再触发）
  useEffect(() => {
    if (!durationBounds) return;
    const { min, max } = durationBounds;
    const clamp = (d: number) => Math.round(Math.min(Math.max(d, min), max) * 10) / 10;
    if (!data.shots.some((s) => clamp(s.duration) !== s.duration)) return;
    const clampedShots = data.shots.map((s) => {
      const d = clamp(s.duration);
      if (d === s.duration) return s;
      return { ...s, duration: d, paramValues: { ...(s.paramValues ?? {}), duration: d } };
    });
    onDataChange({ ...data, shots: clampedShots });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationBounds, data.shots, onDataChange]);

  // 底部生成参数栏（NodeGenerateDock）配置回写：模型 + 参数值 → 镜头数据
  // duration 双向同步的关键：参数面板改时长 → 写回 shot.duration → 轨道 clip 立即变长
  const handleDockConfigChange = useCallback((_id: string, patch: Record<string, unknown>) => {
    if (!currentShot) return;
    const updates: Partial<WorkbenchShot> = {};
    if (typeof patch.model === 'string') updates.model = patch.model;
    if (patch.paramValues && typeof patch.paramValues === 'object') {
      const merged = { ...(currentShot.paramValues ?? {}), ...(patch.paramValues as Record<string, unknown>) };
      updates.paramValues = merged;
      const d = merged.duration;
      if (typeof d === 'number' && Number.isFinite(d) && d !== currentShot.duration) {
        updates.duration = d;
      }
    }
    if (Object.keys(updates).length > 0) onUpdateShot(currentShot.id, updates);
  }, [currentShot, onUpdateShot]);

  // 时间轴拖拽排序
  const onReorder = useCallback((orderedIds: string[]) => {
    const shotMap = new Map(data.shots.map((s) => [s.id, s]));
    const reordered = orderedIds
      .map((id, i) => {
        const shot = shotMap.get(id);
        return shot ? { ...shot, number: i + 1 } : null;
      })
      .filter(Boolean) as WorkbenchShot[];
    onDataChange({ ...data, shots: reordered });
  }, [data, onDataChange]);

  // 插入补拍镜头（T4,2026-08-31）：指定 shot 之后插入空镜头 + number 重编号
  // 2026-08-31 扩展：insert 来自「资产拖入轨道」，用素材标题/时长初始化镜头
  const onInsertAt = useCallback((afterShotId: string | null, insert?: { title?: string; durationSec?: number }) => {
    const dur = insert?.durationSec
      ? Math.max(0.5, Math.min(30, insert.durationSec))
      : 5;
    const newShot: WorkbenchShot = {
      id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      number: 0,
      description: insert?.title ?? '',
      shotType: '中景',
      duration: Math.round(dur * 10) / 10,
      status: 'pending',
    };
    const idx = afterShotId ? data.shots.findIndex((s) => s.id === afterShotId) + 1 : data.shots.length;
    const next = [...data.shots.slice(0, idx), newShot, ...data.shots.slice(idx)].map((s, i) => ({
      ...s,
      number: i + 1,
    }));
    onDataChange({ ...data, shots: next });
  }, [data, onDataChange]);

  return (
    <div style={shellStyle}>
      {data.status === 'idle' ? (
        <IdleState mutedColor={mutedColor} t={t} />
      ) : data.status === 'ready' ? (
        <ReadyState
          data={data}
          progressPercent={progressPercent}
          textColor={textColor}
          mutedColor={mutedColor}
          isDark={isDark}
          onOpenFullscreen={openFullscreen}
          t={t}
        />
      ) : data.status === 'generating' ? (
        <GeneratingState
          data={data}
          progressPercent={progressPercent}
          textColor={textColor}
          mutedColor={mutedColor}
          isDark={isDark}
          t={t}
        />
      ) : (
        <DoneState
          data={data}
          textColor={textColor}
          mutedColor={mutedColor}
          isDark={isDark}
          onOpenFullscreen={openFullscreen}
          t={t}
        />
      )}

      {/* Plan#50:工作台全屏改为画布顶部页签承载(幂等 key = workbench:<nodeId>)——embedded 用
          absolute 填满页签内容层(覆盖画布),数据(data.shots)与回调仍留在节点组件内 */}
      {tabActive && tabHost ? createPortal(
        <CanvasTabContentBoundary>
        {/* 2026-08-31：出片页签整体拦截拖拽——资产拖入导入当前镜头 references，不穿透落画布 */}
        <div
          style={tabEmbeddedStyle(bgPage, isDark, OPENCUT_BG)}
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length > 0) {
              void (async () => {
                for (const f of files) await uploadFileToCurrentShot(f);
              })();
            }
          }}
        >
          {/* 2026-08-31 用户拍板：首帧/尾帧按钮及其所在 div 整块移除——
              标题栏此前已删，页签自带标题，顶部不再渲染任何栏 */}

          {/* 全屏主体：OpenCut 五区生产台布局 */}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <StoryboardMergedTab
              theme={theme}
              isDark={isDark}
              // 出片工作台无"主体资产"语义 → 不渲染左侧资产 sidebar（含拖拽分隔条）
              showAssetSidebar={false}
              entities={(data.entities ?? []) as StoryboardEntity[]}
              // 当前镜头引用主体 → 提示词区上方占位展示(2026-08-31 用户需求)
              promptSubjectChips={shotSubjects}
              // 跨镜衔接取帧按钮(2026-08-31 T3)
              promptExtraActions={promptExtraActions}
              assetPanelProps={{
                entities: (data.entities ?? []) as StoryboardEntity[],
              }}
              videoStageProps={{
                videoStorageKey: activeVideo?.status === 'done' ? activeVideo?.storageKey : undefined,
                videoStatus: currentShot?.generated ? 'done' : (activeVideo?.status ?? 'idle'),
                videoProgress: activeVideo?.progress ?? 0,
                videoError: activeVideo?.error,
                emptyLabel: t('storyboard.videoEmpty', '本镜尚无视频，点击底部「生成视频」'),
              }}
              alternativeVideosProps={{
                videos: (currentShot?.videos ?? []) as any,
                activeVideoIndex: currentShot?.activeVideoIndex ?? 0,
                onActivate: (idx) => currentShot && onUpdateShot(currentShot.id, { activeVideoIndex: idx }),
                // 外部成品视频拖入候选区（T5,2026-08-31）：追加为该镜头备选（source=external）
                onExternalVideoDrop: (payload) => {
                  if (!currentShot || !payload.storageKey) return;
                  onUpdateShot(currentShot.id, {
                    videos: [
                      ...(currentShot.videos ?? []),
                      { storageKey: payload.storageKey, status: 'done', source: 'external', createdAt: new Date().toISOString() },
                    ],
                    activeVideoIndex: (currentShot.videos?.length ?? 0),
                  });
                },
                onRetry: () => {},
                onRemove: (idx) => {
                  if (!currentShot?.videos) return;
                  const newVideos = currentShot.videos.filter((_, i) => i !== idx);
                  onUpdateShot(currentShot.id, { videos: newVideos });
                },
              }}
              timelineProps={{
                shots: timelineData,
                activeShotId: currentShot?.id,
                pixelsPerSecond: pps,
                onPixelsPerSecondChange: setPps,
                onSelectShot: (id) => setActiveIndex(Math.max(0, orderedShots.findIndex((s) => s.id === id))),
                onReorder,
                // clip 长度上限直接取模型模板真实值（无模板时组件内走内置兜底）
                minClipDuration: durationBounds?.min,
                maxClipDuration: durationBounds?.max,
                onTrim: (shotId, newDuration) => {
                  const shot = data.shots.find((s) => s.id === shotId);
                  if (!shot) return;
                  // 反向同步：拖动 clip → 回写 paramValues.duration，参数面板同步刷新
                  onUpdateShot(shotId, {
                    duration: newDuration,
                    paramValues: { ...(shot.paramValues ?? {}), duration: newDuration },
                  });
                },
                playheadTime: playhead,
                onPlayheadTimeChange: setPlayhead,
                onClipDoubleClick: (id) => setActiveIndex(Math.max(0, orderedShots.findIndex((s) => s.id === id))),
                onInsertAt,
              }}
              // 征集 #115:底部提示词栏 = 视频节点正下方同款 NodeGenerateDock(inline + 无圆角 + 常驻展开)
              promptDockProps={{
                nodeId: currentShot ? `${nodeId}:${currentShot.id}` : nodeId,
                nodeType: 'video',
                store,
                // 模型与参数值受控于 shot 数据 → 参数面板与轨道 clip 双向同步
                initialPrompt: currentShot?.imagePrompt ?? '',
                isRunning: activeVideo?.status === 'generating',
                model: currentShot?.model,
                paramValues: (currentShot?.paramValues ?? {}) as Record<string, any>,
                onPromptChange: (_id, prompt) => currentShot && onUpdateShot(currentShot.id, { imagePrompt: prompt }),
                // 契约参数/模型:patch 增量合并后落在当前镜头;
                // duration 双向同步关键点——参数面板改时长 → 回写 shot.duration → 轨道 clip 立即变长
                onConfigChange: handleDockConfigChange,
                // 参考素材受控模式:数据存 WorkbenchShot.references(随 node.data 云同步,协作可见)
                controlledReferences: currentShot ? {
                  items: currentShot.references ?? [],
                  onChange: (items) => onUpdateShot(currentShot.id, { references: items }),
                } : undefined,
                // 单镜视频生成(2026-08-31 接线):referenceImages 按模式筛选 + 提示词自动 @图片N 占位
                onGenerate: () => {
                  if (!currentShot) return;
                  const refs = currentShot.references ?? [];
                  const isFirstLast = (currentShot.paramValues?.mode as string) === 'image-to-video-first-last-frame';
                  const referenceImages = refs
                    .filter((r) => r.kind === 'image' && r.storageKey)
                    .filter((r) => (isFirstLast ? r.slot === 'first' || r.slot === 'last' : true))
                    .map((r) => r.storageKey!) as string[];
                  // 主体展开关联(2026-08-31):锚点句/描述逐字展开进提示词,引用状态时追加(状态形态)
                  const subjectText = shotSubjects
                    .map((s) => {
                      const base = s.anchorSentence?.trim() || s.description?.trim() || s.name;
                      return s.stateName ? `${base}(${s.stateName}状态)` : base;
                    })
                    .filter(Boolean)
                    .join(', ');
                  const promptShot = subjectText
                    ? { ...currentShot, videoPrompt: `${currentShot.videoPrompt || ''} ${subjectText}`.trim() }
                    : currentShot;
                  const baseVideos = currentShot.videos ?? [];
                  const idx = baseVideos.length;
                  void (async () => {
                    // 生成中：先落 generating 占位
                    onUpdateShot(currentShot.id, {
                      videos: [...baseVideos, { storageKey: '', status: 'generating', source: 'generated', progress: 10, createdAt: new Date().toISOString() }],
                    });
                    try {
                      const { storageKey } = await generateVideo({ shot: promptShot, referenceImages });
                      onUpdateShot(currentShot.id, {
                        videos: [
                          ...baseVideos.slice(0, idx),
                          { storageKey, status: 'done', source: 'generated', prompt: currentShot.videoPrompt, model: currentShot.model, createdAt: new Date().toISOString() },
                          ...baseVideos.slice(idx),
                        ],
                        activeVideoIndex: idx,
                        generated: true,
                      });
                    } catch (err) {
                      onUpdateShot(currentShot.id, {
                        videos: [
                          ...baseVideos.slice(0, idx),
                          { storageKey: '', status: 'failed', error: (err as Error)?.message, source: 'generated', createdAt: new Date().toISOString() },
                          ...baseVideos.slice(idx),
                        ],
                      });
                    }
                  })();
                },
                // 首尾帧从视频取帧(2026-08-31 T2):复用 extractFrameIntoShot(抽帧→上传→写入 slot)
                onExtractFrame: (slot) => {
                  if (!currentShot || !activeVideo?.storageKey) return;
                  void extractFrameIntoShot(
                    activeVideo.storageKey,
                    slot,
                    `镜头${currentShot.number}${slot === 'first' ? '首帧' : '尾帧'}`,
                  );
                },
                onStop: () => {},
              }}
            />
          </div>
        </div>
        </CanvasTabContentBoundary>,
        tabHost,
        ) : null}
    </div>
  );
});

// ===== 子组件 =====

/** idle 态：场记板图标 + 未开拍文案 */
function IdleState({ mutedColor, t }: { mutedColor: string; t: (key: string, opts?: Record<string, unknown>) => string }): ReactElement {
  return (
    <div style={centerStyle}>
      <Film size={48} color={mutedColor} strokeWidth={1.5} />
      <span style={{ marginTop: 12, fontSize: 13, color: mutedColor }}>{t('canvasNodes.workbenchIdle')}</span>
    </div>
  );
}

/** ready 态：摘要 + 进度条 + 进入工作台按钮（无卡片外壳，纯居中堆叠） */
function ReadyState({
  data,
  progressPercent,
  textColor,
  mutedColor,
  isDark,
  onOpenFullscreen,
  t,
}: {
  data: WorkbenchNodeData;
  progressPercent: number;
  textColor: string;
  mutedColor: string;
  isDark: boolean;
  onOpenFullscreen: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): ReactElement {
  return (
    <div style={centerStyle}>
      <div style={stackStyle}>
        <Clapperboard size={24} color={textColor} strokeWidth={1.5} />
        <span style={{ fontSize: 13, fontWeight: 600, color: textColor }}>{t('canvasNodes.workbenchReady')}</span>
        <span style={{ fontSize: 11, color: mutedColor }}>
          {t('canvasNodes.workbenchShotCount', { count: data.shots.length })}
          {data.totalDuration > 0 && ` · ${t('canvasNodes.workbenchTotalDuration', { duration: data.totalDuration })}`}
        </span>
        <Progress
          percent={progressPercent}
          size="small"
          style={{ width: '100%', maxWidth: 160, margin: 0 }}
          strokeColor={OPENCUT_ACCENT}
          trailColor={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}
        />
        <Button
          type="primary"
          size="small"
          icon={<Play size={12} />}
          onClick={onOpenFullscreen}
        >
          {t('canvasNodes.workbenchEnter')}
        </Button>
      </div>
    </div>
  );
}

/** generating 态：进度条 + 生成中文案（无卡片外壳） */
function GeneratingState({
  data,
  progressPercent,
  textColor,
  mutedColor,
  isDark,
  t,
}: {
  data: WorkbenchNodeData;
  progressPercent: number;
  textColor: string;
  mutedColor: string;
  isDark: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): ReactElement {
  return (
    <div style={centerStyle}>
      <div style={stackStyle}>
        <Clapperboard size={24} color={textColor} strokeWidth={1.5} />
        <span style={{ fontSize: 13, fontWeight: 600, color: textColor }}>{t('canvasNodes.workbenchGenerating')}</span>
        <Progress
          percent={progressPercent}
          size="small"
          style={{ width: '100%', maxWidth: 160, margin: 0 }}
          strokeColor={OPENCUT_ACCENT}
          trailColor={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}
        />
        <span style={{ fontSize: 11, color: mutedColor }}>
          {t('canvasNodes.workbenchShotCount', { count: data.shots.length })} · {t('canvasNodes.workbenchCompletedCount', { count: data.completedCount })}
        </span>
      </div>
    </div>
  );
}

/** done 态：完成摘要 + 进入工作台按钮（无卡片外壳） */
function DoneState({
  data,
  textColor,
  mutedColor,
  isDark,
  onOpenFullscreen,
  t,
}: {
  data: WorkbenchNodeData;
  textColor: string;
  mutedColor: string;
  isDark: boolean;
  onOpenFullscreen: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): ReactElement {
  return (
    <div style={centerStyle}>
      <div style={stackStyle}>
        <Clapperboard size={24} color={textColor} strokeWidth={1.5} />
        <span style={{ fontSize: 13, fontWeight: 600, color: textColor }}>{t('canvasNodes.workbenchDone')}</span>
        <span style={{ fontSize: 11, color: mutedColor }}>
          {t('canvasNodes.workbenchShotCount', { count: data.shots.length })}
          {data.totalDuration > 0 && ` · ${t('canvasNodes.workbenchTotalDuration', { duration: data.totalDuration })}`}
        </span>
        <Progress
          percent={100}
          size="small"
          style={{ width: '100%', maxWidth: 160, margin: 0 }}
          strokeColor={isDark ? '#22c55e' : '#16a34a'}
          trailColor={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}
        />
        <Button
          type="primary"
          size="small"
          icon={<Play size={12} />}
          onClick={onOpenFullscreen}
        >
          {t('canvasNodes.workbenchEnter')}
        </Button>
      </div>
    </div>
  );
}



// ===== 样式 =====

const shellStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  boxSizing: 'border-box',
  padding: 16,
  overflow: 'hidden',
};

const centerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
};

/** 节点内联态内容堆叠（无卡片外壳：不画边框/底色/内边距） */
const stackStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  maxWidth: 200,
  padding: '0 12px',
  boxSizing: 'border-box',
};

/** Plan#50:页签内嵌容器(absolute 填满页签内容层,替代原 fixed 全屏 overlay) */
const tabEmbeddedStyle = (background: string, isDark: boolean, opencutBg: string): CSSProperties => ({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  background: isDark ? opencutBg : background,
});