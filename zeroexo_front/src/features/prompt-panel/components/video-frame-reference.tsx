/**
 * VideoFrameReference - 视频首尾帧参考图上传组件
 *
 * G15: 在视频节点的 Seedance 面板中,当模式为首尾帧(first-last-frame)
 * 或图生视频(image-to-video)时,显示首帧/尾帧参考图上传区域。
 */

import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { Tooltip } from 'antd';
import { ImageIcon, X } from 'lucide-react';import type { ThemeConfig } from '@zeroexo/plugin-theme';

export interface VideoFrameReferenceProps {
  mode: string;
  firstFrame?: string;
  lastFrame?: string;
  theme: ThemeConfig;
  t: (key: string) => string;
  onChange: (patch: {
    firstFrame?: string;
    lastFrame?: string;
  }) => void;
}

export function FrameReferenceSection({
  mode,
  firstFrame,
  lastFrame,
  theme,
  t,
  onChange,
}: VideoFrameReferenceProps): React.ReactElement {
  const firstInputRef = useRef<HTMLInputElement>(null);
  const lastInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (frame: 'first' | 'last') => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (frame === 'first') {
        onChange({ firstFrame: dataUrl });
      } else {
        onChange({ lastFrame: dataUrl });
      }
    };
    reader.readAsDataURL(file);
    // 重置 input 以便重复选择同一文件
    e.target.value = '';
  };

  const handleRemove = (frame: 'first' | 'last') => () => {
    if (frame === 'first') {
      onChange({ firstFrame: undefined });
    } else {
      onChange({ lastFrame: undefined });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 首帧 */}
      <FrameUploadItem
        label={t('prompt.videoFirstFrame')}
        dataUrl={firstFrame}
        visible={mode === 'first-last-frame' || mode === 'image-to-video'}
        theme={theme}
        inputRef={firstInputRef}
        onSelect={handleFileSelect('first')}
        onRemove={handleRemove('first')}
        onClickUpload={() => firstInputRef.current?.click()}
      />
      {/* 尾帧 (仅首尾帧模式显示) */}
      {mode === 'first-last-frame' ? (
        <FrameUploadItem
          label={t('prompt.videoLastFrame')}
          dataUrl={lastFrame}
          visible={true}
          theme={theme}
          inputRef={lastInputRef}
          onSelect={handleFileSelect('last')}
          onRemove={handleRemove('last')}
          onClickUpload={() => lastInputRef.current?.click()}
        />
      ) : null}
    </div>
  );
}

function FrameUploadItem({
  label,
  dataUrl,
  visible,
  theme,
  inputRef,
  onSelect,
  onRemove,
  onClickUpload,
}: {
  label: string;
  dataUrl?: string;
  visible: boolean;
  theme: ThemeConfig;
  inputRef: React.RefObject<HTMLInputElement>;
  onSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  onClickUpload: () => void;
}): React.ReactElement | null {
  if (!visible) return null;

  const hasImage = !!dataUrl;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={onSelect}
        style={{ display: 'none' }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      />
      <Tooltip title={label}>
      <button
        type="button"
        onClick={onClickUpload}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: 48,
          height: 48,
          borderRadius: 8,
          border: `1px solid ${theme.toolbar.border}`,
          background: hasImage ? 'transparent' : theme.toolbar.panel,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {hasImage ? (
          <>
            <img
              src={dataUrl}
              alt={label}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <span
              onClick={(event) => {
                event.stopPropagation();
                onRemove();
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              style={{
                position: 'absolute',
                top: 2,
                right: 2,
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.6)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: 10,
                lineHeight: 1,
              }}
            >
              <X size={10} />
            </span>
          </>
        ) : (
          <ImageIcon size={18} style={{ opacity: 0.4, color: theme.toolbar.text }} />
        )}
      </button>
      </Tooltip>
      <span style={{ fontSize: 11, color: theme.toolbar.textMuted, lineHeight: 1.3 }}>
        {label}
      </span>
    </div>
  );
}