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
import { Type as TypeIcon } from 'lucide-react';
import type { NodeRendererProps, Pin } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import type { TextNodeData } from '@zeroexo/plugin-ai-provider';
import { useTheme } from '@zeroexo/plugin-theme';

import { BaseNodeView } from '../base-node-view.js';
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
  const [isEditing, setIsEditing] = useState(false);
  const { t } = useTranslation();
  const { theme } = useTheme();

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
              placeholder={t('nodes.doubleClickToEdit')}
              isDark={theme.mode === 'dark'}
              hideToolbar
              onEscape={exitEditing}
            />
          </div>
        ) : (
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
                __html: content || t('nodes.doubleClickToEdit'),
              }}
            />
          </div>
        )}
      </div>
    </BaseNodeView>
    </>
  );
}