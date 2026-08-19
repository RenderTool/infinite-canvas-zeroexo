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
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  };

  return (
    <div style={wrapperStyle}>
      <Tooltip title={t('topbar.renameHint')}>
        <button
          type="button"
          onDoubleClick={onStartTitleEditing}
          onMouseEnter={(event) => {
            event.currentTarget.style.borderBottomColor = theme.toolbar.text;
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.borderBottomColor = 'transparent';
          }}
          style={displayStyle}
        >
          {title}
        </button>
      </Tooltip>
    </div>
  );
}
