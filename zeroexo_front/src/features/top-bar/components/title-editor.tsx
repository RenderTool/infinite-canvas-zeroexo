/**
 * TitleEditor - 可编辑标题
 *
 * 双击进入编辑;Enter 确认 / Escape 取消;点击外部自动关闭。
 * 编辑态与草稿由父组件受控(isTitleEditing + titleDraft)。
 */

import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';

export interface TitleEditorProps {
  theme: ThemeConfig;
  title: string;
  titleDraft: string;
  isTitleEditing: boolean;
  onTitleDraftChange: (value: string) => void;
  onStartTitleEditing: () => void;
  onFinishTitleEditing: () => void;
  onCancelTitleEditing: () => void;
  /** 是否允许编辑(参与者标题归房主,false 时只读展示,无双击/hover/提示) */
  editable?: boolean;
}

export function TitleEditor({
  theme,
  title,
  titleDraft,
  isTitleEditing,
  onTitleDraftChange,
  onStartTitleEditing,
  onFinishTitleEditing,
  onCancelTitleEditing,
  editable = true,
}: TitleEditorProps): React.ReactElement {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isTitleEditing) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        onFinishTitleEditing();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [isTitleEditing, onFinishTitleEditing]);

  const wrapperStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 };

  if (isTitleEditing) {
    const inputStyle: CSSProperties = {
      maxWidth: 280,
      background: 'transparent',
      border: 'none',
      outline: 'none',
      padding: 0,
      fontSize: 18,
      fontWeight: 600,
      color: theme.toolbar.text,
    };
    return (
      <div ref={containerRef} style={wrapperStyle}>
        <input
          autoFocus
          value={titleDraft}
          onChange={(event) => onTitleDraftChange(event.target.value)}
          onBlur={onFinishTitleEditing}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onFinishTitleEditing();
            if (event.key === 'Escape') onCancelTitleEditing();
          }}
          style={inputStyle}
        />
      </div>
    );
  }

  const displayStyle: CSSProperties = {
    maxWidth: 280,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    border: 'none',
    borderBottom: '1px dashed transparent',
    background: 'transparent',
    padding: 0,
    fontSize: 18,
    fontWeight: 600,
    color: theme.toolbar.text,
    cursor: editable ? 'pointer' : 'default',
    transition: 'border-color 0.15s',
  };

  const titleButton = (
    <button
      type="button"
      onDoubleClick={editable ? onStartTitleEditing : undefined}
      onMouseEnter={editable ? (event) => {
        event.currentTarget.style.borderBottomColor = theme.toolbar.text;
      } : undefined}
      onMouseLeave={editable ? (event) => {
        event.currentTarget.style.borderBottomColor = 'transparent';
      } : undefined}
      style={displayStyle}
    >
      {title}
    </button>
  );

  return (
    <div style={wrapperStyle}>
      {editable ? <Tooltip title={t('topbar.renameHint')}>{titleButton}</Tooltip> : titleButton}
    </div>
  );
}
