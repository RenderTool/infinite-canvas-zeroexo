/**
 * ConfigNodeView - 生成配置节点视图(派生自 BaseNodeView)
 *
 * Bug6: 重新设计为推导型配置节点,统计具体引用类型(文本/图片/视频/音频)。
 * - 区域 1: Segmented 模式切换(图标+文字胶囊)— 选择生成模式
 * - 区域 2: 引用类型芯片(4 类计数:文本/图片/视频/音频)— 推导已有生成
 * - 区域 3: 模型 + 参数摘要(只读)
 *
 * 生成配置的主要作用:聚合已连接的引用节点,推导生成参数。
 * 模型选择和参数配置由选中节点时弹出的 PromptPanel 提供。
 * 事件隔离: onMouseDown stopPropagation 防拖拽 + onWheel stopPropagation 防画布缩放。
 */

import React, { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image as ImageIcon,
  MessageSquare,
  Settings2,
} from 'lucide-react';
import type { NodeRendererProps, Pin } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { ConfigNodeData } from '@zeroexo/plugin-ai-provider';
import { useTheme } from '@zeroexo/plugin-theme';
import { BaseNodeView } from '../base-node-view.js';

export interface ConfigNodeViewProps extends NodeRendererProps {
  connectionController: ConnectionController | null;
  /** Bug9: store 引用(用于订阅 graph 变化自动刷新引用计数) */
  store: ReactGraphStore | null;
}

type GenerationMode = 'image' | 'video' | 'audio' | 'text';

/**
 * Bug6: MODE_DEFAULTS 仅保留参数默认值,不硬编码模型名。
 * 模型由 PromptPanel 的 ModelPicker 从后端渠道中选择。
 */
const MODE_DEFAULTS: Record<GenerationMode, Partial<ConfigNodeData>> = {
  image: { model: '', size: '1024x1024', quality: 'standard', count: 1 },
  video: { model: '', seconds: 5, vquality: 'medium', generateAudio: true, watermark: false },
  audio: { model: '', voice: 'alloy', audioFormat: 'mp3', audioSpeed: 1 },
  text: { model: '' },
};

const MODE_ORDER: GenerationMode[] = ['image', 'text', 'video', 'audio'];

function ModeIcon({ mode, size = 14 }: { mode: GenerationMode; size?: number }): React.ReactElement | null {
  switch (mode) {
    case 'image':
      return <ImageIcon size={size} />;
    case 'text':
      return <MessageSquare size={size} />;
    case 'video':
      return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 7.75a.75.75 0 0 1 1.142-.638l3.664 2.249a.75.75 0 0 1 0 1.278l-3.664 2.25a.75.75 0 0 1-1.142-.64z"/><path d="M7 21h10"/><rect width="20" height="14" x="2" y="3" rx="2"/></svg>;
    case 'audio':
      return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg>;
    default:
      return null;
  }
}

function modeLabelKey(mode: GenerationMode): string {
  switch (mode) {
    case 'image':
      return 'nodes.configModeImage';
    case 'video':
      return 'nodes.configModeVideo';
    case 'audio':
      return 'nodes.configModeAudio';
    case 'text':
      return 'nodes.configModeText';
    default:
      return 'nodes.configModeImage';
  }
}

/** 从 "channelId::model" 编码中提取模型名 */
function decodeModelName(modelValue: string): string {
  if (!modelValue) return '';
  const parts = modelValue.split('::');
  if (parts.length <= 1) return modelValue;
  const last = parts[parts.length - 1];
  return last ?? modelValue;
}

/** Bug6: 引用类型统计 */
interface ReferenceSummary {
  text: number;
  image: number;
  video: number;
  audio: number;
}

export function getConfigNodePins(): Pin[] {
  // config 节点仅有 input 引脚(右 source 隐藏),符合源项目规范
  return [{ id: 'input', name: 'Input', direction: 'input' }];
}

/**
 * Bug9: 安全版 useGraph — store 为 null 时跳过订阅(不违反 hooks 规则)
 * 用空订阅 + 恒等 getSnapshot 保证 hooks 调用顺序稳定。
 */
const noopSubscribe = (): (() => void) => () => {};
const noopGetSnapshot = (): number => 0;
function useGraphSafe(store: ReactGraphStore | null): void {
  useSyncExternalStore(
    store ? store.subscribeGraph : noopSubscribe,
    store ? (() => store.getGraph().edges.length) : noopGetSnapshot,
  );
}

export function ConfigNodeView({
  node,
  pins,
  isSelected,
  isHovered,
  forceShowPins,
  updateNode,
  invK,
  connectionController,
  store,
  externalRenaming,
  onRenameFinish,
}: ConfigNodeViewProps): React.ReactElement {
  const data = (node.data ?? {}) as Partial<ConfigNodeData>;
  const mode = data.generationMode ?? 'image';
  const { t } = useTranslation();
  const { theme } = useTheme();

  // Bug9: 订阅 graph 变化,连线增删时自动刷新引用计数(无需手动切换模式)
  // 使用 useGraph 订阅 store 变化(Edges 增删时自动重渲染)
  useGraphSafe(store);

  const updateData = useCallback(
    (patch: Partial<ConfigNodeData>): void => {
      updateNode({ data: { ...data, ...patch } });
    },
    [data, updateNode],
  );

  const handleModeChange = useCallback(
    (newMode: GenerationMode): void => {
      updateData({ generationMode: newMode, ...MODE_DEFAULTS[newMode] });
    },
    [updateData],
  );

  // 事件隔离: 阻止拖拽节点
  const stopPointerDown = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
  }, []);

  // 事件隔离: 阻止滚轮缩放画布
  const stopWheel = useCallback((e: React.WheelEvent): void => {
    e.stopPropagation();
  }, []);

  // 节点颜色使用 theme.node.fill(所有类型共用)
  const nodeColor = theme.node.fill;

  // 主题 token
  const surfaceColor = theme.node.contentBackground;
  const borderColor = theme.toolbar.border;
  const textColor = theme.toolbar.text;
  const textMutedColor = theme.toolbar.textMuted;
  const accentColor = theme.toolbar.accent;

  // Segmented 胶囊按钮样式
  const segBtnStyle = useCallback(
    (active: boolean): React.CSSProperties => ({
      flex: 1,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      padding: '5px 0',
      fontSize: 11,
      color: active ? textColor : textMutedColor,
      background: active ? `${accentColor}22` : 'transparent',
      border: 'none',
      borderRadius: 6,
      cursor: 'pointer',
      transition: 'all 0.15s ease',
      fontFamily: 'inherit',
    }),
    [accentColor, textColor, textMutedColor],
  );

  // Bug6: 引用类型芯片样式
  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 8px',
    fontSize: 11,
    background: surfaceColor,
    border: `1px solid ${borderColor}`,
    borderRadius: 6,
    color: textColor,
    boxSizing: 'border-box',
    whiteSpace: 'nowrap',
  };

  const chipLabelStyle: React.CSSProperties = {
    color: textMutedColor,
    fontSize: 10,
  };

  const chipCountStyle: React.CSSProperties = {
    color: textColor,
    fontWeight: 600,
    fontSize: 11,
    minWidth: 12,
    textAlign: 'center' as const,
  };

  // Bug6: 模型/参数行样式
  const statRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    fontSize: 11,
    background: surfaceColor,
    border: `1px solid ${borderColor}`,
    borderRadius: 6,
    color: textColor,
    boxSizing: 'border-box',
    minWidth: 0,
  };

  const statLabelStyle: React.CSSProperties = {
    color: textMutedColor,
    flexShrink: 0,
    fontSize: 10,
    fontWeight: 500,
  };

  const statValueStyle: React.CSSProperties = {
    color: textColor,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
    flex: 1,
    fontSize: 11,
  };

  // Bug6/Bug9: 按引用类型分类统计(文本/图片/视频/音频)
  // Bug9: 不用 useMemo,每次渲染都重新计算(useGraphSafe 触发的重渲染会自动刷新)
  const referenceSummary: ReferenceSummary = (() => {
    if (!connectionController) return { text: 0, image: 0, video: 0, audio: 0 };
    const infos = connectionController.getIncomingNodeTypes(node.id);
    return {
      text: infos.filter((i) => i.type === 'text').length,
      image: infos.filter((i) => i.type === 'image').length,
      video: infos.filter((i) => i.type === 'video').length,
      audio: infos.filter((i) => i.type === 'audio').length,
    };
  })();

  // Bug6: 引用类型配置(图标 + 标签键)
  const refTypes: { key: 'text' | 'image' | 'video' | 'audio'; labelKey: string; icon: React.ReactElement }[] = [
    { key: 'text', labelKey: 'nodes.configRefText', icon: <MessageSquare size={11} /> },
    { key: 'image', labelKey: 'nodes.configRefImage', icon: <ImageIcon size={11} /> },
    { key: 'video', labelKey: 'nodes.configRefVideo', icon: <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 7.75a.75.75 0 0 1 1.142-.638l3.664 2.249a.75.75 0 0 1 0 1.278l-3.664 2.25a.75.75 0 0 1-1.142-.64z"/><path d="M7 21h10"/><rect width="20" height="14" x="2" y="3" rx="2"/></svg> },
    { key: 'audio', labelKey: 'nodes.configRefAudio', icon: <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/></svg> },
  ];

  // Bug6: 构建参数摘要文本
  const paramsSummary = React.useMemo(() => {
    if (mode === 'image') {
      const size = data.size ?? '1024x1024';
      const quality = data.quality ?? 'standard';
      const count = data.count ?? 1;
      return `${size} · ${quality} · ${count}${t('prompt.imageCountUnit')}`;
    }
    if (mode === 'video') {
      const vquality = data.vquality ?? 'medium';
      const seconds = data.seconds ?? 5;
      const parts = [vquality, `${seconds}s`];
      if (data.generateAudio !== false) parts.push(t('nodes.configVoiceover'));
      return parts.join(' · ');
    }
    if (mode === 'audio') {
      const voice = data.voice ?? 'alloy';
      const format = data.audioFormat ?? 'mp3';
      const speed = data.audioSpeed ?? 1;
      return `${voice} · ${format} · ${speed}x`;
    }
    // text 模式无参数
    return t('common.notImplemented');
  }, [mode, data.size, data.quality, data.count, data.vquality, data.seconds, data.generateAudio,
    data.voice, data.audioFormat, data.audioSpeed, t]);

  // Bug6: 模型显示名
  const modelDisplay = React.useMemo(() => {
    const raw = data.model ?? '';
    const decoded = decodeModelName(raw);
    return decoded || t('nodes.configNoModel');
  }, [data.model, t]);

  const titleIconSize = Math.max(9, Math.min(13 * (invK ?? 1), 16));
  const titleIconEl = <Settings2 size={titleIconSize} />;

  return (
    <BaseNodeView
      node={node}
      pins={pins}
      isSelected={isSelected}
      isHovered={isHovered}
      title={node.title ?? data.title ?? t('nodes.configTitle')}
      color={nodeColor}
      connectionController={connectionController}
      forceShowPins={forceShowPins}
      contentPadding="12px"
      invK={invK}
      titleIcon={titleIconEl}
      updateNode={updateNode}
      externalRenaming={externalRenaming}
      onRenameFinish={onRenameFinish}
      store={store}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          color: textColor,
        }}
        onWheel={stopWheel}
      >
        {/* 区域 1: Segmented 模式切换 */}
        <div
          style={{
            display: 'flex',
            gap: 2,
            padding: 2,
            background: surfaceColor,
            border: `1px solid ${borderColor}`,
            borderRadius: 8,
          }}
          onMouseDown={stopPointerDown}
        >
          {MODE_ORDER.map((m) => (
            <button
              key={m}
              type="button"
              style={segBtnStyle(mode === m)}
              onClick={() => handleModeChange(m)}
            >
              <ModeIcon mode={m} size={14} />
              <span>{t(modeLabelKey(m))}</span>
            </button>
          ))}
        </div>

        {/* Bug6/Bug9: 区域 2 — 引用类型芯片(始终显示所有类型,即使计数为 0) */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
          }}
          onMouseDown={stopPointerDown}
        >
          {refTypes.map((rt) => {
            const count = referenceSummary[rt.key];
            return (
              <div key={rt.key} style={{
                ...chipStyle,
                opacity: count === 0 ? 0.5 : 1,
              }}>
                {rt.icon}
                <span style={chipLabelStyle}>{t(rt.labelKey)}</span>
                <span style={chipCountStyle}>{count}</span>
              </div>
            );
          })}
        </div>

        {/* Bug6: 区域 3 — 模型 + 参数摘要 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
          onMouseDown={stopPointerDown}
        >
          {/* 模型 */}
          <div style={statRowStyle}>
            <Settings2 size={12} color={textMutedColor} />
            <span style={statLabelStyle}>{t('nodes.configModel')}</span>
            <span style={statValueStyle}>{modelDisplay}</span>
          </div>

          {/* 参数 */}
          <div style={statRowStyle}>
            <Settings2 size={12} color={textMutedColor} />
            <span style={statLabelStyle}>{t('nodes.configParams')}</span>
            <span style={statValueStyle}>{paramsSummary}</span>
          </div>
        </div>
      </div>
    </BaseNodeView>
  );
}
