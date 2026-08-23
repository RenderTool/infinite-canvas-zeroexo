/**
 * TextNodeView - 文本节点视图(派生自 BaseNodeView)
 *
 * 功能:
 * - 双击进入编辑模式,点击节点外部 / Escape 退出
 * - 编辑态使用 SelfRichTextEditor(自研富文本):正文可加粗/换色/标题/颜色/高亮
 * - 非编辑态直接渲染 HTML(保留富文本样式,如加粗/斜体/下划线)
 *
 * 注: SelfRichTextEditor 输出 HTML,data.content 存储为 HTML 格式。
 * 非编辑态通过 dangerouslySetInnerHTML 渲染,保留用户设置的富文本样式。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Type as TypeIcon, AlertTriangle, RefreshCw, Square } from 'lucide-react';
import { App as AntdApp } from 'antd';
import type { NodeRendererProps, Pin } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import type { TextNodeData } from '@zeroexo/plugin-ai-provider';
import { useTheme } from '@zeroexo/plugin-theme';
import { TEXT_MAX_LENGTH } from '@/shared/constants/text-limits.js';

import { BaseNodeView, AISkeleton, nodeActionBus } from '../base-node-view.js';
import { SelfRichTextEditor } from '../rich-text-editor/SelfRichTextEditor.js';
import { buildTextContentCommand } from '../utils/text-model.js';

export interface TextNodeViewProps extends NodeRendererProps {
  connectionController: ConnectionController | null;
  store?: import('@zeroexo/plugin-render-react').ReactGraphStore;
}

export function getTextNodePins(): Pin[] {
  return [
    { id: 'input', name: 'Input', direction: 'input' },
    { id: 'output', name: 'Output', direction: 'output' },
  ];
}

export function TextNodeView({
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
}: TextNodeViewProps): React.ReactElement {
  const data = (node.data ?? {}) as Partial<TextNodeData> & Record<string, unknown>;
  const content = data.content ?? '';
  // 生成状态机(loading/error 仅在无内容时占用内容区;有内容时始终展示内容)
  const status = data.status ?? 'idle';
  const errorDetails = typeof data.errorDetails === 'string' ? data.errorDetails : undefined;
  const taskLabel = typeof data.taskLabel === 'string' ? data.taskLabel : undefined;
  const generating = status === 'loading' && !content;
  const failed = status === 'error' && !content;
  const [isEditing, setIsEditing] = useState(false);
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message: antdMessage } = AntdApp.useApp();

  // Plan#12: 编辑期草稿本地化——onChange 只写 draft,退出编辑时一次性提交命令
  // (一次编辑 = 一个撤销点,避免高频输入撑爆撤销栈)
  const [draft, setDraft] = useState(content);
  const draftRef = useRef(content);
  const startContentRef = useRef(content);
  const contentRef = useRef(content);
  contentRef.current = content;

  // 非编辑态:直接渲染 HTML 保留富文本样式(加粗/斜体/下划线等)
  // 使用 content 作为 key 强制 React 重新挂载 div 以更新 innerHTML

  useEffect(() => {
    if (isEditing) {
      const el = editorWrapperRef.current;
      if (el) {
        const editable = el.querySelector('.zxe-content-editable');
        (editable as HTMLElement | null)?.focus();
      }
    }
  }, [isEditing]);

  // 双击进入编辑模式(初始化草稿快照,退出时以此判定是否产生命令)
  const handleDoubleClick = useCallback(() => {
    startContentRef.current = contentRef.current;
    draftRef.current = contentRef.current;
    setDraft(contentRef.current);
    setIsEditing(true);
  }, []);

  // 退出编辑模式:草稿与进入时快照不同才提交(无变化不产生命令)
  const exitEditing = useCallback(() => {
    setIsEditing(false);
    const next = draftRef.current;
    if (next === startContentRef.current) return;
    if (commandQueue) {
      commandQueue.execute(buildTextContentCommand(node.id, next));
    } else {
      updateNode({ data: { ...data, content: next } });
    }
  }, [commandQueue, node.id, updateNode, data]);

  // 编辑态:监听 document mousedown,检测点击是否在节点外,避免 onBlur 过早退出
  // 解决:点击节点标题栏/胶囊工具栏时不退出,仅点击节点外部才退出
  const editorWrapperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isEditing) return;
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // 点击在编辑器包装内 → 不退出
      if (editorWrapperRef.current?.contains(target)) return;
      // 点击在节点容器内(标题栏/胶囊工具栏/引脚) → 不退出,防止误失焦
      if (target.closest('[data-node-shell]')) return;
      // Issue5: 点击节点胶囊工具栏按钮 → 不退出,防止加粗等操作失焦
      if (target.closest('[data-capsule-toolbar]')) return;
      // 避免点击全屏编辑器时退出
      if (target.closest('.zxe-rt-wrap')) return;
      exitEditing();
    };
    // 使用 capture 确保在 React 事件系统之前处理
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => document.removeEventListener('mousedown', handleMouseDown, true);
  }, [isEditing, exitEditing]);

  // 节点颜色使用 theme.node.fill(所有类型共用)
  const nodeColor = theme.node.fill;

  const titleIconSize = Math.max(9, Math.min(13 * (invK ?? 1), 16));
  const titleIconEl = <TypeIcon size={titleIconSize} />;

  return (
    <>
    <BaseNodeView
      node={node}
      pins={pins}
      isSelected={isSelected}
      isHovered={isHovered}
      title={node.title ?? data.title ?? t('nodes.textTitle')}
      color={nodeColor}
      connectionController={connectionController}
      forceShowPins={forceShowPins}
      invK={invK}
      titleIcon={titleIconEl}
      updateNode={updateNode}
      externalRenaming={externalRenaming}
      onRenameFinish={onRenameFinish}
      store={store}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
          boxSizing: 'border-box',
        }}
      >
        {isEditing ? (
          <div
            ref={editorWrapperRef}
            style={{
              flex: 1,
              width: '100%',
              height: '100%',
              minHeight: 0,
              // 编辑态:阻止 pointer/mouse 事件冒泡,避免触发节点移动拖拽,保留文本选择能力
              // 仅拦截空白区,不拦截内部编辑器交互
            }}
            onPointerDown={(e) => {
              const target = e.target as HTMLElement;
              // 非编辑器内部元素(如工具栏)不拦截,防止节点拖拽
              if (!target.closest('.zxe-content-editable')) {
                e.stopPropagation();
              }
            }}
            onMouseDown={(e) => {
              const target = e.target as HTMLElement;
              if (!target.closest('.zxe-content-editable')) {
                e.stopPropagation();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                exitEditing();
              }
            }}
          >
            <SelfRichTextEditor
              value={draft}
              onChange={(html) => { draftRef.current = html; setDraft(html); }}
              onLimitExceeded={() => antdMessage.warning(t('nodes.textLimitExceeded', { max: TEXT_MAX_LENGTH }))}
              placeholder={t('nodes.doubleClickToEdit')}
              isDark={theme.mode === 'dark'}
              hideToolbar
              onEscape={exitEditing}
            />
          </div>
        ) : content ? (
          <div
            style={{
              flex: 1,
              width: '100%',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              key={content}
              style={{
                width: '100%',
                height: '100%',
                padding: '4px 8px',
                overflow: 'auto',
                boxSizing: 'border-box',
                fontSize: 14,
                lineHeight: 1.6,
                color: content ? theme.toolbar.text : theme.toolbar.textMuted,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                cursor: 'text',
                WebkitFontSmoothing: 'antialiased',
                MozOsxFontSmoothing: 'grayscale',
                backfaceVisibility: 'hidden',
              }}
              onDoubleClick={handleDoubleClick}
              dangerouslySetInnerHTML={{
                __html: content,
              }}
            />
          </div>
        ) : generating ? (
          // 生成中:行式 shimmer 骨架 + 任务信息 + 取消(与分镜同款扫光动画)
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '8px 12px',
              boxSizing: 'border-box',
            }}
          >
            <AISkeleton type="text" accentColor={nodeColor} />
            <span style={{ fontSize: 12, color: theme.toolbar.textMuted, fontWeight: 500 }}>
              {t('nodes.generating')}
            </span>
            {taskLabel ? (
              <span
                style={{
                  fontSize: 10,
                  color: theme.toolbar.textMuted,
                  maxWidth: '90%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={taskLabel}
              >
                {taskLabel}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => nodeActionBus.emit('cancel', { nodeId: node.id })}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 10px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.4)',
                background: 'rgba(255,255,255,0.12)',
                color: '#fff',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <Square size={11} fill="currentColor" />
              {t('nodes.cancelGeneration')}
            </button>
          </div>
        ) : failed ? (
          // 错误态:图标 + 详情 + 重试(重试复用统一 retry 事件,按节点类型推导生成模式)
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: 12,
              boxSizing: 'border-box',
            }}
          >
            <AlertTriangle size={18} color="#ef4444" />
            <span
              style={{
                fontSize: 12,
                color: '#ef4444',
                textAlign: 'center',
                lineHeight: 1.5,
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {errorDetails ?? t('nodes.generateFailed')}
            </span>
            <button
              type="button"
              onClick={() => nodeActionBus.emit('retry', { nodeId: node.id })}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 10px',
                borderRadius: 6,
                border: '1px solid rgba(239,68,68,0.5)',
                background: 'rgba(239,68,68,0.12)',
                color: '#ef4444',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={11} />
              {t('nodes.retry')}
            </button>
          </div>
        ) : (
          // 空态占位:提示双击编辑或使用下方面板生成
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 12,
              boxSizing: 'border-box',
              cursor: 'text',
            }}
            onDoubleClick={handleDoubleClick}
          >
            <span
              style={{
                fontSize: 12,
                color: theme.toolbar.textMuted,
                textAlign: 'center',
                lineHeight: 1.6,
              }}
            >
              {t('nodes.textEmptyHint')}
            </span>
          </div>
        )}
      </div>
    </BaseNodeView>
    </>
  );
}