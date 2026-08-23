/**
 * 音频节点视图 - 使用 wavesurfer.js 渲染波形
 * 高性能 Canvas 波形渲染，支持播放进度、拖拽跳转
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Pause } from 'lucide-react';
import WaveSurfer from 'wavesurfer.js';
import type { WaveSurferOptions } from 'wavesurfer.js';
import type { NodeRendererProps, Pin } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import type { AudioNodeData } from '@zeroexo/plugin-ai-provider';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { BaseNodeView, AIStateView, useHasIncomingEdges, nodeActionBus } from '../base-node-view.js';
import { replaceNodeAudio, stripFileExtension } from '../utils/media-replace-model.js';
import { useHydratedContent } from '../utils/hydrate.js';

export function getAudioNodePins(): Pin[] {
  return [
    { id: 'prompt', name: 'Prompt', direction: 'input' },
    { id: 'audio', name: 'Audio', direction: 'output' },
  ];
}

// ===== 气泡外观常量(参考 VoiceMessageBubble.tailwind.jsx) =====
/** 气泡外壳圆角:右下角收为小角,形成对话气泡的"尾巴" */
export const AUDIO_BUBBLE_RADIUS = '18px 18px 4px 18px';
/** 波形高度(px) */
const WAVE_HEIGHT = 36;
/** 播放按钮直径(px) */
const PLAY_BTN_SIZE = 34;

// ===== 空状态图标构建函数(需 theme 以使用主题色) =====
function audioEmptyIcon(titleColor: string): React.ReactNode {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={titleColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 10v3"/>
      <path d="M6 6v11"/>
      <path d="M10 3v18"/>
      <path d="M14 8v7"/>
      <path d="M18 5v13"/>
      <path d="M22 10v3"/>
    </svg>
  );
}

/** 时间格式化 m:ss */
function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export interface AudioNodeViewProps extends NodeRendererProps {
  connectionController: ConnectionController | null;
  /** 画布图 store(用于上一个/下一个导航) */
  store?: ReactGraphStore | null;
  /** contentOnly 模式:跳过 BaseNodeView 外壳,仅渲染媒体内容(用于 StackNode 等容器) */
  contentOnly?: boolean;
}

export function AudioNodeView({
  node,
  pins,
  isSelected,
  isHovered,
  forceShowPins,
  updateNode,
  commandQueue,
  invK,
  connectionController,
  externalRenaming,
  onRenameFinish,
  store,
  contentOnly = false,
}: AudioNodeViewProps): React.ReactElement {
  const data = (node.data ?? {}) as Partial<AudioNodeData>;
  const status = data.status ?? 'idle';
  const { t } = useTranslation();
  const { theme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const isReadyRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(data.durationMs ? data.durationMs / 1000 : 0);

  const hydratedContent = useHydratedContent(data.storageKey, data.content ?? '');
  const hasContent = !!hydratedContent;
  // 生成器态判定:空节点(无内容)连入上游支持节点 → 生成器态(隐藏节点内上传按钮,避免"既是生成器又是资源器"二义态)
  const hasIncoming = useHasIncomingEdges(store, node.id, isSelected);
  const isGeneratorState = !hasContent && hasIncoming;

  const updateData = (patch: Partial<AudioNodeData>): void => {
    updateNode({ data: { ...data, ...patch } });
  };

  const nodeColor = theme.node.fill;
  const accent = theme.toolbar.accent;
  const isDark = theme.mode === 'dark';
  // 未播放柱颜色:主题感知(深色底用亮灰,浅色底用暗灰)
  const unplayedColor = isDark ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.18)';

  // ===== 初始化 Wavesurfer =====
  useEffect(() => {
    if (!containerRef.current || !hasContent || !hydratedContent) {
      return;
    }

    const options: WaveSurferOptions = {
      container: containerRef.current,
      url: hydratedContent,
      height: WAVE_HEIGHT,
      waveColor: unplayedColor,
      progressColor: accent,
      cursorColor: 'transparent',
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      normalize: true,
      interact: true,
      dragToSeek: true,
      hideScrollbar: true,
      fillParent: true,
      minPxPerSec: 0,
    };

    const ws = WaveSurfer.create(options);
    wavesurferRef.current = ws;

    // 事件监听
    ws.on('ready', () => {
      isReadyRef.current = true;
      const dur = ws.getDuration();
      setDuration(dur);
      if (!data.durationMs) {
        updateData({ durationMs: Math.round(dur * 1000) });
      }
    });

    ws.on('audioprocess', (time) => {
      setCurrentTime(time);
    });

    ws.on('seeking', (time) => {
      setCurrentTime(time);
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => {
      setIsPlaying(false);
      setCurrentTime(0);
    });

    ws.on('error', (err) => {
      console.warn('WaveSurfer error:', err);
      updateData({ status: 'error', errorDetails: String(err) });
    });

    return () => {
      ws.destroy();
      wavesurferRef.current = null;
      isReadyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydratedContent, hasContent]);

  const handleReplaceClick = (): void => {
    fileInputRef.current?.click();
  };

  // Plan#11 C2: 替换收敛到 replaceNodeAudio(命令队列,支持撤销);wavesurfer 销毁重建是视图副作用
  const handleFileReplace = async (file: File): Promise<void> => {
    if (!file.type.startsWith('audio/')) return;
    updateData({ status: 'loading', errorDetails: undefined });
    updateNode({ title: stripFileExtension(file.name) });
    await replaceNodeAudio(commandQueue, node, file, {
      onStatusChange: (s) => {
        if (s === 'error') {
          updateData({ status: 'error' });
        }
        if (s === 'success') {
          // 如果 wavesurfer 已存在，销毁重建
          if (wavesurferRef.current) {
            wavesurferRef.current.destroy();
            wavesurferRef.current = null;
            isReadyRef.current = false;
          }
          setIsPlaying(false);
          setCurrentTime(0);
        }
      },
    });
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) void handleFileReplace(file);
    e.target.value = '';
  };

  const togglePlay = useCallback(() => {
    const ws = wavesurferRef.current;
    if (!ws || !isReadyRef.current) return;
    if (isPlaying) {
      ws.pause();
    } else {
      ws.play();
    }
  }, [isPlaying]);

  // 防止选中节点时拖动波形触发节点拖动
  const handleContainerPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };

  // 时间标签:播放中显示剩余,未播放显示已播(未开始则总时长)
  const timeLabel = formatTime(isPlaying ? Math.max(0, duration - currentTime) : (currentTime || duration));

  // T10: 图标尺寸 CSS 连续化(与标题 fontSize 同源 --zx-invk),消除量化跨桶跳变
  const TITLE_ICON_CLAMP = 'clamp(9px, calc(13px * var(--zx-invk, 1)), 16px)';
  const titleIconEl = (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: TITLE_ICON_CLAMP, height: TITLE_ICON_CLAMP }}>
      <path d="M2 10v3"/>
      <path d="M6 6v11"/>
      <path d="M10 3v18"/>
      <path d="M14 8v7"/>
      <path d="M18 5v13"/>
      <path d="M22 10v3"/>
    </svg>
  );

  // ===== 气泡内容(播放钮 + 波形 + 时间),contentOnly 与常规模式共用 =====
  const bubbleContent = (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      padding: '10px 14px',
      overflow: 'hidden',
    }}>
      {/* 播放按钮 */}
      <button
        type="button"
        onClick={togglePlay}
        aria-label="Play audio"
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          width: PLAY_BTN_SIZE,
          height: PLAY_BTN_SIZE,
          borderRadius: '50%',
          background: accent,
          border: 'none',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'transform 0.1s ease, filter 0.15s ease',
          boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.35)' : '0 2px 8px rgba(0,0,0,0.15)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; e.currentTarget.style.transform = 'scale(1)'; }}
        onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.94)'; }}
        onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
      >
        {isPlaying ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}
      </button>

      {/* 波形容器 - wavesurfer.js 插入 canvas */}
      <div
        ref={containerRef}
        onPointerDown={handleContainerPointerDown}
        style={{
          position: 'relative',
          height: WAVE_HEIGHT,
          flex: 1,
          minWidth: 0,
          cursor: 'pointer',
          userSelect: 'none',
          touchAction: 'none',
        }}
      />

      {/* 时间标签(置于节点内) */}
      <div style={{
        fontSize: 11,
        color: theme.toolbar.textMuted,
        fontVariantNumeric: 'tabular-nums',
        flexShrink: 0,
        minWidth: 34,
        textAlign: 'right',
        fontFamily: 'monospace',
      }}>
        {timeLabel}
      </div>
    </div>
  );

  // 隐藏的文件选择器(两种模式共用)
  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="audio/*"
      style={{ display: 'none' }}
      onChange={handleFileInputChange}
    />
  );

  // contentOnly 模式:跳过 BaseNodeView 外壳,仅渲染气泡内容
  if (contentOnly) {
    return (
      <>
        <AIStateView
          status={status}
          errorDetails={data.errorDetails}
          errorType={data.errorType}
          accentColor={nodeColor}
          emptyIcon={audioEmptyIcon(theme.toolbar.textMuted)}
          hasContent={hasContent}
          onReplace={handleReplaceClick}
          // contentOnly 内嵌卡:替换入口归容器(StackNode MainReplaceButton)管理
          isSelected={false}
          backgroundColor={nodeColor}
          taskLabel={(data.taskLabel as string) ?? undefined}
          replaceBtnPosition="left"
          skeleton="media" skeletonKind="audio"
        >
          {bubbleContent}
        </AIStateView>
        {fileInput}
      </>
    );
  }

  return (
    <BaseNodeView
      node={node}
      pins={pins}
      isSelected={isSelected}
      isHovered={isHovered}
      title={node.title ?? data.title ?? t('nodes.audioTitle')}
      color={nodeColor}
      connectionController={connectionController}
      forceShowPins={forceShowPins}
      contentPadding={0}
      invK={invK}
      titleIcon={titleIconEl}
      updateNode={updateNode}
      externalRenaming={externalRenaming}
      onRenameFinish={onRenameFinish}
      store={store}
      borderRadiusOverride={AUDIO_BUBBLE_RADIUS}
    >
      <AIStateView
        status={status}
        errorDetails={data.errorDetails}
        errorType={data.errorType}
        accentColor={nodeColor}
        emptyIcon={audioEmptyIcon(theme.toolbar.textMuted)}
        hasContent={hasContent}
        onReplace={handleReplaceClick}
        isSelected={isSelected}
        showReplaceButton={isSelected && !isGeneratorState}
        backgroundColor={nodeColor}
        taskLabel={(data.taskLabel as string) ?? undefined}
        replaceBtnPosition="left"
        skeleton="media" skeletonKind="audio"
        onRetry={() => nodeActionBus.emit('retry', { nodeId: node.id })}
        onCancel={() => nodeActionBus.emit('cancel', { nodeId: node.id })}
      >
        {bubbleContent}
      </AIStateView>
      {fileInput}
    </BaseNodeView>
  );
}
