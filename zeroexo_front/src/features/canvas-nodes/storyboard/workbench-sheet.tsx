/**
 * WorkbenchSheet - 画布"出片(workbench)节点"独立页面壳
 *
 * 节点内紧凑视图：根据 status 显示不同状态内容（场记板视觉）。
 * 全屏编辑器：portal 到 document.body，左侧镜头列表 + 右侧空白占位（轨道区由 T4 实现）。
 * 数据写入 node.data，随画布 Yjs 同步。
 */

import { memo, useState, useCallback, useMemo, useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Film, Clapperboard, Play, List, ImageIcon } from 'lucide-react';
import { Button, Progress, Tag, Spin, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import { fullscreenOverlayStyle } from './components/StoryboardToolbar';
import type { WorkbenchNodeData, WorkbenchShot } from './workbench-types';
import { generateFrame } from './workbench-frame-api';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { WorkbenchTrack } from './workbench-track';

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

  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [timeScale, setTimeScale] = useState(80);

  // 主题色
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const cardBorder = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const bgPage = isDark ? '#0e0e0e' : '#f8f8f8';
  const bgCanvas = isDark ? '#171717' : '#ffffff';
  const borderMuted = isDark ? '#2e2e2e' : '#e5e5e5';

  // 进度
  const progressPercent = useMemo(() => {
    if (data.shots.length === 0) return 0;
    return Math.round((data.completedCount / data.shots.length) * 100);
  }, [data.shots.length, data.completedCount]);

  // 事件订阅
  useEffect(() => {
    const unsub = nodeActionBus.on('workbench:fullscreen', (e: { nodeId: string }) => {
      if (e.nodeId === nodeId) setFullscreenOpen(true);
    });
    return () => unsub?.();
  }, [nodeId]);

  // 打开全屏编辑器
  const openFullscreen = useCallback(() => {
    setFullscreenOpen(true);
  }, []);

  // ===== 首帧/尾帧生成 =====

  /** 当前正在生成中的帧标识集合，格式 "shotId:firstFrame" 或 "shotId:lastFrame" */
  const [generatingFrames, setGeneratingFrames] = useState<Set<string>>(new Set());

  /** 批量生成进度 */
  const [batchInfo, setBatchInfo] = useState<{
    active: boolean;
    type: 'firstFrame' | 'lastFrame';
    total: number;
    completed: number;
  } | null>(null);

  /** AbortController 引用，用于取消正在进行的生成 */
  const abortRef = useRef<AbortController | null>(null);

  /** 标记某个帧为生成中 */
  const markGenerating = useCallback(
    (shotId: string, frameType: 'firstFrame' | 'lastFrame', generating: boolean) => {
      setGeneratingFrames((prev) => {
        const next = new Set(prev);
        const key = `${shotId}:${frameType}`;
        if (generating) {
          next.add(key);
        } else {
          next.delete(key);
        }
        return next;
      });
    },
    [],
  );

  /** 判断某个帧是否正在生成 */
  const isGenerating = useCallback(
    (shotId: string, frameType: 'firstFrame' | 'lastFrame'): boolean => {
      return generatingFrames.has(`${shotId}:${frameType}`);
    },
    [generatingFrames],
  );

  /** 单个镜头首帧/尾帧生成 */
  const handleGenerateFrame = useCallback(
    async (shotId: string, frameType: 'firstFrame' | 'lastFrame') => {
      if (isGenerating(shotId, frameType)) return;

      const shot = data.shots.find((s) => s.id === shotId);
      if (!shot) return;

      markGenerating(shotId, frameType, true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const { storageKey } = await generateFrame(shot, frameType, controller.signal);
        // 更新节点数据
        const updatedShots = data.shots.map((s) => {
          if (s.id !== shotId) return s;
          return {
            ...s,
            [frameType === 'firstFrame' ? 'firstFrameKey' : 'lastFrameKey']: storageKey,
          };
        });
        onDataChange({ ...data, shots: updatedShots });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error(`[WorkbenchSheet] 生成 ${frameType} 失败:`, err);
      } finally {
        markGenerating(shotId, frameType, false);
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [data, onDataChange, isGenerating, markGenerating],
  );

  /** 批量生成首帧/尾帧 */
  const handleBatchGenerate = useCallback(
    async (frameType: 'firstFrame' | 'lastFrame') => {
      const targetShots = data.shots.filter(
        (s) => !s[frameType === 'firstFrame' ? 'firstFrameKey' : 'lastFrameKey'],
      );
      if (targetShots.length === 0) return;

      setBatchInfo({ active: true, type: frameType, total: targetShots.length, completed: 0 });

      let completed = 0;
      for (const shot of targetShots) {
        if (abortRef.current?.signal.aborted) break;

        try {
          const { storageKey } = await generateFrame(shot, frameType, abortRef.current?.signal);
          // 逐个更新节点数据
          const updatedShots = data.shots.map((s) => {
            if (s.id !== shot.id) return s;
            return {
              ...s,
              [frameType === 'firstFrame' ? 'firstFrameKey' : 'lastFrameKey']: storageKey,
            };
          });
          onDataChange({ ...data, shots: updatedShots });
          completed += 1;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') break;
          console.error(`[WorkbenchSheet] 批量生成 ${frameType} 失败 (shot #${shot.number}):`, err);
        }

        setBatchInfo((prev) =>
          prev ? { ...prev, completed } : null,
        );
      }

      setBatchInfo((prev) => (prev ? { ...prev, active: false } : null));
    },
    [data, onDataChange],
  );

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
          cardBorder={cardBorder}
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
          cardBorder={cardBorder}
          isDark={isDark}
          t={t}
        />
      ) : (
        <DoneState
          data={data}
          progressPercent={progressPercent}
          textColor={textColor}
          mutedColor={mutedColor}
          cardBorder={cardBorder}
          isDark={isDark}
          onOpenFullscreen={openFullscreen}
          t={t}
        />
      )}

      {/* 全屏覆盖层 */}
      {fullscreenOpen && createPortal(
        <div style={fullscreenOverlayStyle(bgPage)}>
          {/* 全屏顶部栏 */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '8px 16px',
              borderBottom: `1px solid ${borderMuted}`,
              background: isDark ? '#1b1b1b' : '#fafaf7',
              gap: 8,
            }}>
              <Clapperboard size={18} color={textColor} />
              <span style={{ fontSize: 14, fontWeight: 600, color: textColor }}>
                {t('canvasNodes.stage.workbench')}
              </span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: mutedColor }}>
                {t('canvasNodes.workbenchShotCount', { count: data.shots.length })}
                {data.totalDuration > 0 && ` · ${t('canvasNodes.workbenchTotalDuration', { duration: data.totalDuration })}`}
              </span>
              {/* 批量生成按钮 */}
              <Tooltip title={t('canvasNodes.workbenchBatchFirstFrame')}>
                <Button
                  size="small"
                  icon={<ImageIcon size={12} />}
                  disabled={batchInfo?.active === true}
                  loading={batchInfo?.active === true && batchInfo?.type === 'firstFrame'}
                  onClick={() => handleBatchGenerate('firstFrame')}
                >
                  {t('canvasNodes.workbenchFirstFrame')}
                </Button>
              </Tooltip>
              <Tooltip title={t('canvasNodes.workbenchBatchLastFrame')}>
                <Button
                  size="small"
                  icon={<ImageIcon size={12} />}
                  disabled={batchInfo?.active === true}
                  loading={batchInfo?.active === true && batchInfo?.type === 'lastFrame'}
                  onClick={() => handleBatchGenerate('lastFrame')}
                >
                  {t('canvasNodes.workbenchLastFrame')}
                </Button>
              </Tooltip>
              <Button size="small" onClick={() => setFullscreenOpen(false)}>
                {t('common.close')}
              </Button>
            </div>
            {/* 批量生成进度条 */}
            {batchInfo?.active === true && (
              <div style={{
                padding: '4px 16px',
                borderBottom: `1px solid ${borderMuted}`,
                background: isDark ? '#1b1b1b' : '#fafaf7',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}>
                <span style={{ fontSize: 11, color: mutedColor, whiteSpace: 'nowrap' }}>
                  {t('canvasNodes.workbenchFrameProgress', {
                    type: t(batchInfo.type === 'firstFrame' ? 'canvasNodes.workbenchFirstFrame' : 'canvasNodes.workbenchLastFrame'),
                    completed: batchInfo.completed,
                    total: batchInfo.total,
                  })}
                </span>
                <Progress
                  percent={batchInfo.total > 0 ? Math.round((batchInfo.completed / batchInfo.total) * 100) : 0}
                  size="small"
                  style={{ flex: 1, margin: 0, minWidth: 80 }}
                  strokeColor={isDark ? '#60a5fa' : '#3b82f6'}
                  trailColor={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}
                />
              </div>
            )}
          </div>

          {/* 全屏主体：左侧镜头列表 + 右侧轨道区占位 */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
            {/* 左侧镜头列表 */}
            <div style={{
              width: 220,
              flexShrink: 0,
              borderRight: `1px solid ${borderMuted}`,
              background: bgCanvas,
              overflow: 'auto',
              padding: '8px 0',
            }}>
              <div style={{ padding: '4px 12px 8px', fontSize: 11, fontWeight: 600, color: mutedColor, display: 'flex', alignItems: 'center', gap: 4 }}>
                <List size={12} />
                {t('canvasNodes.workbenchShotCount', { count: data.shots.length })}
              </div>
              {data.shots.map((shot) => (
                <div
                  key={shot.id}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    color: textColor,
                    borderBottom: `1px solid ${cardBorder}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    cursor: 'default',
                  }}
                >
                  {/* 第一行：编号 + 描述 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tag
                      style={{ margin: 0, fontSize: 10, lineHeight: '16px', padding: '0 4px', flexShrink: 0 }}
                      color={shot.status === 'done' ? 'green' : shot.status === 'failed' ? 'red' : 'default'}
                    >
                      #{shot.number}
                    </Tag>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>
                      {shot.description || shot.shotType}
                    </span>
                  </div>
                  {/* 第二行：首帧/尾帧缩略图 + 生成按钮 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 2 }}>
                    {/* 首帧 */}
                    <FrameThumb
                      shot={shot}
                      frameType="firstFrame"
                      textColor={textColor}
                      mutedColor={mutedColor}
                      cardBorder={cardBorder}
                      isDark={isDark}
                      isGenerating={isGenerating(shot.id, 'firstFrame')}
                      onGenerate={() => handleGenerateFrame(shot.id, 'firstFrame')}
                      t={t}
                    />
                    {/* 尾帧 */}
                    <FrameThumb
                      shot={shot}
                      frameType="lastFrame"
                      textColor={textColor}
                      mutedColor={mutedColor}
                      cardBorder={cardBorder}
                      isDark={isDark}
                      isGenerating={isGenerating(shot.id, 'lastFrame')}
                      onGenerate={() => handleGenerateFrame(shot.id, 'lastFrame')}
                      t={t}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* 右侧轨道区 */}
            <WorkbenchTrack
              shots={data.shots}
              timeScale={timeScale}
              onTimeScaleChange={setTimeScale}
              theme={theme}
              isDark={isDark}
              t={t}
            />
          </div>
        </div>,
        document.body,
      )}
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

/** ready 态：摘要卡片 + 进度条 + 进入工作台按钮 */
function ReadyState({
  data,
  progressPercent,
  textColor,
  mutedColor,
  cardBorder,
  isDark,
  onOpenFullscreen,
  t,
}: {
  data: WorkbenchNodeData;
  progressPercent: number;
  textColor: string;
  mutedColor: string;
  cardBorder: string;
  isDark: boolean;
  onOpenFullscreen: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): ReactElement {
  return (
    <div style={centerStyle}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: 20,
        borderRadius: 8,
        border: `1px solid ${cardBorder}`,
        background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
        minWidth: 200,
      }}>
        <Clapperboard size={28} color={textColor} strokeWidth={1.5} />
        <span style={{ fontSize: 13, fontWeight: 600, color: textColor }}>{t('canvasNodes.workbenchReady')}</span>
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: mutedColor }}>
          <span>{t('canvasNodes.workbenchShotCount', { count: data.shots.length })}</span>
          {data.totalDuration > 0 && (
            <span>{t('canvasNodes.workbenchTotalDuration', { duration: data.totalDuration })}</span>
          )}
        </div>
        <Progress
          percent={progressPercent}
          size="small"
          style={{ width: '100%', margin: 0 }}
          strokeColor={isDark ? '#60a5fa' : '#3b82f6'}
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

/** generating 态：进度条 + 生成中文案 */
function GeneratingState({
  data,
  progressPercent,
  textColor,
  mutedColor,
  cardBorder,
  isDark,
  t,
}: {
  data: WorkbenchNodeData;
  progressPercent: number;
  textColor: string;
  mutedColor: string;
  cardBorder: string;
  isDark: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): ReactElement {
  return (
    <div style={centerStyle}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: 20,
        borderRadius: 8,
        border: `1px solid ${cardBorder}`,
        background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
        minWidth: 200,
      }}>
        <Clapperboard size={28} color={textColor} strokeWidth={1.5} />
        <span style={{ fontSize: 13, fontWeight: 600, color: textColor }}>{t('canvasNodes.workbenchGenerating')}</span>
        <Progress
          percent={progressPercent}
          size="small"
          style={{ width: '100%', margin: 0 }}
          strokeColor={isDark ? '#60a5fa' : '#3b82f6'}
          trailColor={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}
        />
        <span style={{ fontSize: 11, color: mutedColor }}>
          {t('canvasNodes.workbenchShotCount', { count: data.shots.length })} · {t('canvasNodes.workbenchCompletedCount', { count: data.completedCount })}
        </span>
      </div>
    </div>
  );
}

/** done 态：完成摘要 + 播放按钮 */
function DoneState({
  data,
  textColor,
  mutedColor,
  cardBorder,
  isDark,
  onOpenFullscreen,
  t,
}: {
  data: WorkbenchNodeData;
  progressPercent: number;
  textColor: string;
  mutedColor: string;
  cardBorder: string;
  isDark: boolean;
  onOpenFullscreen: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}): ReactElement {
  return (
    <div style={centerStyle}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: 20,
        borderRadius: 8,
        border: `1px solid ${cardBorder}`,
        background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
        minWidth: 200,
      }}>
        <Clapperboard size={28} color={textColor} strokeWidth={1.5} />
        <span style={{ fontSize: 13, fontWeight: 600, color: textColor }}>{t('canvasNodes.workbenchDone')}</span>
        <Progress
          percent={100}
          size="small"
          style={{ width: '100%', margin: 0 }}
          strokeColor={isDark ? '#22c55e' : '#16a34a'}
          trailColor={isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}
        />
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: mutedColor }}>
          <span>{t('canvasNodes.workbenchShotCount', { count: data.shots.length })}</span>
          {data.totalDuration > 0 && (
            <span>{t('canvasNodes.workbenchTotalDuration', { duration: data.totalDuration })}</span>
          )}
        </div>
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

// ===== 首帧/尾帧缩略图组件 =====

interface FrameThumbProps {
  shot: WorkbenchShot;
  frameType: 'firstFrame' | 'lastFrame';
  textColor: string;
  mutedColor: string;
  cardBorder: string;
  isDark: boolean;
  isGenerating: boolean;
  onGenerate: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

/** 单个帧的缩略图 + 生成按钮（小方块） */
function FrameThumb({
  shot,
  frameType,
  textColor,
  mutedColor,
  cardBorder,
  isDark,
  isGenerating: generating,
  onGenerate,
  t,
}: FrameThumbProps): ReactElement {
  const storageKey = frameType === 'firstFrame' ? shot.firstFrameKey : shot.lastFrameKey;
  const label = frameType === 'firstFrame' ? t('canvasNodes.workbenchFirstFrame') : t('canvasNodes.workbenchLastFrame');
  const thumbSrc = storageKey ? getResourceUrl(storageKey, 'preview') : undefined;

  const thumbSize = 28;

  if (generating) {
    return (
      <Tooltip title={`${label} ${t('canvasNodes.workbenchFrameGenerating')}`}>
        <div
          style={{
            width: thumbSize,
            height: thumbSize,
            borderRadius: 4,
            border: `1px solid ${cardBorder}`,
            background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'wait',
          }}
        >
          <Spin size="small" />
        </div>
      </Tooltip>
    );
  }

  if (thumbSrc) {
    return (
      <Tooltip title={label}>
        <div
          style={{
            width: thumbSize,
            height: thumbSize,
            borderRadius: 4,
            border: `1px solid ${cardBorder}`,
            overflow: 'hidden',
            flexShrink: 0,
            background: isDark ? '#000' : '#fff',
          }}
        >
          <img
            src={thumbSrc}
            alt={label}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      </Tooltip>
    );
  }

  // 无图片：显示生成按钮
  return (
    <Tooltip title={label}>
      <button
        type="button"
        onClick={onGenerate}
        style={{
          width: thumbSize,
          height: thumbSize,
          borderRadius: 4,
          border: `1px dashed ${mutedColor}`,
          background: 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          color: mutedColor,
          opacity: 0.6,
          transition: 'opacity 0.15s, border-color 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '1';
          e.currentTarget.style.borderColor = textColor;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = '0.6';
          e.currentTarget.style.borderColor = mutedColor;
        }}
      >
        <ImageIcon size={12} />
      </button>
    </Tooltip>
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