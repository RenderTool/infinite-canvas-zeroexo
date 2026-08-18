/**
 * CanvasCard - 画布项目卡片(antd Card 重构)
 *
 * 使用 antd Card 组件结构:
 * - Card.header: 标题 + 节点数 + 选择模式复选框
 * - Card.body: 创建/更新时间
 * - Card.actions: 导出/重命名/删除操作按钮
 *
 * 重命名流程:
 * - 点击重命名按钮进入内联重命名模式
 * - Enter 保存, Esc 取消
 */

import { memo, useState, useRef, useEffect, useCallback } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  Pencil,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import { Card, Typography, Input, Checkbox, Button, Tooltip } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';

const { Text } = Typography;

/** 通用项目卡片元数据（画布/神器共用） */
export interface ProjectCardMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** 画布项目特有：节点数（可选，神器不显示） */
  nodeCount?: number;
}

export interface CanvasCardProps {
  project: ProjectCardMeta;
  selected: boolean;
  selectMode: boolean;
  onOpen: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onExport?: (id: string) => void;
}

function CanvasCardImpl({
  project,
  selected,
  selectMode,
  onOpen,
  onToggleSelect,
  onRename,
  onDelete,
  onExport,
}: CanvasCardProps): React.ReactElement {
  const { theme } = useTheme();
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const isDark = theme.mode === 'dark';

  // 编辑模式时聚焦输入框
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleRenameConfirm = useCallback((): void => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== project.title) {
      onRename(project.id, trimmed);
    } else {
      setDraft(project.title);
    }
    setEditing(false);
  }, [draft, project.title, project.id, onRename]);

  const handleRenameCancel = useCallback((): void => {
    setDraft(project.title);
    setEditing(false);
  }, [project.title]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRenameConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleRenameCancel();
    }
  }, [handleRenameConfirm, handleRenameCancel]);

  const handleCardClick = useCallback((): void => {
    if (editing) return;
    if (selectMode) {
      onToggleSelect(project.id);
    } else {
      onOpen(project.id);
    }
  }, [editing, selectMode, onToggleSelect, project.id, onOpen]);

  const handleActionClick = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
  }, []);

  const relativeTime = formatDate(project.updatedAt, i18n.language);

  // 编辑模式 - 卡片内容(标题输入)
  const titleContent: ReactNode = editing ? (
    <Input
      ref={inputRef as React.Ref<any>}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleRenameConfirm}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      variant="borderless"
      style={editInputStyle}
      placeholder={t('home.untitled')}
    />
  ) : null;

  // 非编辑模式 - 标题 + 子标题
  const displayTitle: ReactNode = !editing ? (
    <>
      <Text
        strong
        style={{
          fontSize: 15,
          color: theme.toolbar.text,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          display: 'block',
        }}
      >
        {project.title}
      </Text>
      <Text
        type="secondary"
        style={{ fontSize: 12, display: 'block', marginTop: 2 }}
      >
        {project.nodeCount !== undefined ? t('home.nodeCount', { count: project.nodeCount }) : t('home.artifact')}
      </Text>
    </>
  ) : null;

  // 编辑模式下底部操作按钮(确认/取消)
  const editActions: ReactNode = editing ? (
    <span onClick={handleActionClick}>
      <Button type="text" size="small" icon={<Check size={14} />} onClick={handleRenameConfirm} />
      <Button type="text" size="small" icon={<X size={14} />} onClick={handleRenameCancel} />
    </span>
  ) : null;

  // 卡片主体内容(创建/更新时间)
  const bodyContent: ReactNode = (
    <div style={bodyInnerStyle}>
      <Text type="secondary" style={{ fontSize: 12, lineHeight: '20px', display: 'block' }}>
        {t('home.createdAt')} {formatDate(project.createdAt, i18n.language)}
      </Text>
      <Text type="secondary" style={{ fontSize: 12, lineHeight: '20px', display: 'block' }}>
        {t('home.updatedAt')} {relativeTime}
      </Text>
    </div>
  );

  return (
    // Card 头部的 title 参数控制左侧标题区域,extra 控制右侧额外区域
    <Card
      hoverable={!editing}
      size="small"
      styles={{
        body: {
          padding: '8px 16px',
        },
        header: {
          borderBottom: 'none',
          padding: '12px 16px 4px',
          minHeight: 0,
        },
        actions: {
          padding: '2px 0',
          background: 'transparent',
        },
      }}
      style={{
        ...cardBaseStyle,
        background: isDark
          ? selected ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.04)'
          : selected ? '#f5f5f4' : '#ffffff',
        borderColor: selected ? theme.toolbar.accent : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'),
        cursor: editing ? 'default' : 'pointer',
      }}
      title={
        <div style={headerRowStyle}>
          {selectMode && (
            <Checkbox
              checked={selected}
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleSelect(project.id)}
              style={{ marginRight: 8 }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0, minHeight: editing ? 44 : undefined }}>
            {editing ? titleContent : displayTitle}
          </div>
          {editActions}
        </div>
      }
      onClick={handleCardClick}
      actions={editing ? [] : [
        <span key="export" onClick={handleActionClick}>
          <Tooltip title={t('home.exportZip')}>
            <Button
              type="text"
              size="small"
              icon={<Download size={14} />}
              onClick={() => onExport?.(project.id)}
              disabled={!onExport}
              style={actionBtnStyle}
            />
            </Tooltip>
        </span>,
        <span key="rename" onClick={handleActionClick}>
          <Tooltip title={t('home.rename')}>
            <Button
              type="text"
              size="small"
              icon={<Pencil size={14} />}
              onClick={() => setEditing(true)}
              style={actionBtnStyle}
            />
            </Tooltip>
        </span>,
        <span key="delete" onClick={handleActionClick}>
          <Tooltip title={t('home.delete')}>
            <Button
              type="text"
              size="small"
              icon={<Trash2 size={14} />}
              onClick={() => onDelete(project.id)}
              danger
              style={actionBtnStyle}
            />
            </Tooltip>
        </span>,
      ]}
    >
      {editing ? (
        <div style={bodyInnerStyle}>
          {bodyContent}
          <div style={{ height: 36 }} />
        </div>
      ) : (
        bodyContent
      )}
    </Card>
  );
}

export const CanvasCard = memo(CanvasCardImpl);

// ===== 样式 =====

const cardBaseStyle: CSSProperties = {
  borderRadius: 14,
  transition: 'all 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
};

const headerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minHeight: 32,
};

const bodyInnerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
};

const editInputStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  padding: '2px 0',
  height: 28,
};

const actionBtnStyle: CSSProperties = {
  width: 28,
  height: 28,
};

// ===== 工具函数 =====

function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  try {
    return date.toLocaleString(locale, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
