/**
 * AiPlaceholderNodeView - AI 生成占位节点视图
 *
 * 当 AI 任务(图片/视频/剧本/分镜)正在生成时,在画布上显示占位节点。
 * 生成中骨架契约：与分镜 StoryboardGeneratingLoader 同款（脉冲点+阶段文案+shimmer 行），
 * 禁用四宫格/网格涟漪形态（用户多次强调，2026-08-23 废止 StaggerGridRipple）。
 * 该节点不显示在节点菜单中,仅为 AI 生成任务占位。
 * 固定尺寸,禁止 resize。
 *
 * 状态:
 * - generating: 分镜同款骨架 + 类型文案/任务信息/停止按钮
 * - completed: 完成文案 → 自动移除(由外部逻辑处理)
 * - error: 错误信息 + 重试/移除按钮
 */
import { AlertCircle, RefreshCw, X, Square, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NodeRecord, Pin } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { BaseNodeView, AISkeleton, type GenLoaderKind } from '../base-node-view.js';
import { nodeActionBus } from '../base-node-view.js';

export interface AiPlaceholderNodeData {
  /** 生成状态 */
  status: 'generating' | 'completed' | 'error' | 'removed';
  /** 生成类型: image/video/script/storyboard */
  generationType: 'image' | 'video' | 'script' | 'storyboard';
  /** 生成完成后要替换成的目标节点 type */
  targetNodeType: string;
  /** 错误信息 */
  error?: string;
  /** 任务信息(渠道 · 模型) */
  taskLabel?: string;
  /** 生成任务的 prompt */
  prompt?: string;
  /** 原始节点 ID(用于重新生成时恢复) */
  targetNodeId?: string;
}

export interface AiPlaceholderNodeViewProps {
  node: NodeRecord;
  pins: Pin[];
  isSelected: boolean;
  isHovered: boolean;
  updateNode: (patch: Partial<NodeRecord>) => void;
  connectionController: ConnectionController | null;
  invK?: number;
  forceShowPins?: boolean;
  /** 画布图 store(用于上一个/下一个导航) */
  store?: ReactGraphStore | null;
}

const NODE_COLOR = '#8b5cf6';

/** 生成类型 → 显示文本 */
function typeLabel(t: string): string {
  const map: Record<string, string> = {
    image: '图片',
    video: '视频',
    script: '剧本',
    storyboard: '分镜',
  };
  return map[t] || t;
}

/** 生成类型 → 骨架文案类型（script 走文本段，其余同名） */
const GEN_LOADER_KIND: Record<string, GenLoaderKind> = {
  image: 'image',
  video: 'video',
  script: 'text',
  storyboard: 'storyboard',
};

export function AiPlaceholderNodeView({
  node,
  pins,
  isSelected,
  isHovered,
  updateNode,
  connectionController,
  invK,
  forceShowPins,
  store,
}: AiPlaceholderNodeViewProps): React.ReactElement {
  const { t } = useTranslation();
  const data = (node.data ?? {}) as Partial<AiPlaceholderNodeData>;
  const status = data.status ?? 'generating';
  const generationType = data.generationType ?? 'image';
  const taskLabel = data.taskLabel ?? '';
  const errorMsg = data.error ?? '';

  const handleRetry = () => {
    nodeActionBus.emit('ai:placeholder:retry', { nodeId: node.id });
  };

  const handleRemove = () => {
    nodeActionBus.emit('ai:placeholder:remove', { nodeId: node.id });
  };

  const handleStop = () => {
    // 停止生成:对于分镜重新生成,触发恢复逻辑;其他类型仅停止
    const origNodeId = data.targetNodeId;
    if (origNodeId && data.generationType === 'storyboard') {
      // 分镜重新生成:触发取消事件,由后端捕获恢复旧节点
      nodeActionBus.emit('ai:placeholder:stop-regen', { nodeId: node.id, origNodeId });
    }
    nodeActionBus.emit('cancel', { nodeId: node.id });
  };

  return (
    <BaseNodeView
      node={node}
      pins={pins}
      isSelected={isSelected}
      isHovered={isHovered}
      title={t('nodes.aiPlaceholderTitle', `AI ${typeLabel(generationType)}`)}
      color={NODE_COLOR}
      connectionController={connectionController}
      forceShowPins={forceShowPins}
      invK={invK}
      updateNode={updateNode}
      contentPadding="8px"
      store={store}
    >
      {/* 生成中：分镜同款骨架（AISkeleton）；错误/完成：简洁状态层 */}
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {status === 'generating' && (
          <>
            <AISkeleton type="media" accentColor={NODE_COLOR} kind={GEN_LOADER_KIND[generationType] ?? 'image'} />
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>
              {t('nodes.aiPlaceholderGenerating', `正在生成${typeLabel(generationType)}`)}
            </div>
            {taskLabel && (
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', maxWidth: '90%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {taskLabel}
              </div>
            )}
            {/* 停止按钮:分镜重新生成时显示 */}
            {data.targetNodeId && generationType === 'storyboard' && (
              <button
                type="button"
                onClick={handleStop}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 5,
                  border: '1px solid rgba(239,68,68,0.35)',
                  background: 'rgba(0,0,0,0.4)',
                  backdropFilter: 'blur(4px)',
                  color: '#f87171', fontSize: 10, fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.4)'; }}
              >
                <Square size={9} />
                停止
              </button>
            )}
          </>
        )}
        {status === 'error' && (
          <>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#fca5a5', display: 'flex', alignItems: 'center', gap: 5, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
              <AlertCircle size={13} />
              {errorMsg || t('nodes.aiPlaceholderError', '生成失败')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <button
                type="button"
                onClick={handleRetry}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '5px 12px', borderRadius: 6,
                  border: '1px solid rgba(139,92,246,0.4)',
                  background: 'rgba(0,0,0,0.45)',
                  backdropFilter: 'blur(4px)',
                  color: '#a78bfa', fontSize: 11, fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(139,92,246,0.25)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.45)'; }}
              >
                <RefreshCw size={11} />
                重试
              </button>
              <button
                type="button"
                onClick={handleRemove}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '5px 12px', borderRadius: 6,
                  border: '1px solid rgba(239,68,68,0.4)',
                  background: 'rgba(0,0,0,0.45)',
                  backdropFilter: 'blur(4px)',
                  color: '#f87171', fontSize: 11, fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.25)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.45)'; }}
              >
                <X size={11} />
                取消
              </button>
            </div>
          </>
        )}
        {status === 'completed' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#10b981' }}>
            <Check size={14} />
            {t('nodes.aiPlaceholderCompleted', '生成完成')}
          </div>
        )}
      </div>
    </BaseNodeView>
  );
}