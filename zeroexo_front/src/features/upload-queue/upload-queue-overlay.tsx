/**
 * UploadQueueOverlay - 批量上传覆盖层(antd 重构版)
 *
 * 渲染在画布/素材库之上,显示文件上传进度队列:
 * - 进度条(总进度)
 * - 文件列表(文件名 + 状态)
 * - 鼠标悬停文件时显示缩略图预览
 * - 完成后可关闭
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { Modal, Progress, Button, Typography, Space, theme as antTheme } from 'antd';
import { Image, Video, FileText, Music, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useUploadQueueStore } from './upload-queue-store.js';
import type { UploadFileItem } from './upload-queue-store.js';

export function UploadQueueOverlay({ onRetryFailed }: { onRetryFailed?: (failedFiles: File[]) => void }): React.ReactElement | null {
  const { visible, items, processing, completed, total, reset } = useUploadQueueStore();
  const [hoveredItem, setHoveredItem] = useState<UploadFileItem | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const { token } = antTheme.useToken();
  const { theme } = useTheme();

  const handleMouseEnter = useCallback(
    (item: UploadFileItem, e: React.MouseEvent) => {
      if (!item.thumbnailUrl && item.kind !== 'image' && item.kind !== 'video') return;
      setHoveredItem(item);
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setHoverPos({ x: rect.right + 12, y: rect.top });
    },
    [],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredItem(null);
  }, []);

  if (!visible) return null;

  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const allDone = completed >= total && total > 0;
  const failedCount = items.filter((it) => it.status === 'error').length;
  const showThumbnail = hoveredItem?.thumbnailUrl;

  const handleRetry = (): void => {
    const failedFiles = items
      .filter((it) => it.status === 'error')
      .map((it) => it.file);
    reset();
    onRetryFailed?.(failedFiles);
  };

  const handleDone = (): void => {
    const store = useUploadQueueStore.getState();
    store.hide();
    store.reset();
  };

  return (
    <>
      <Modal
        open={visible}
        centered
        onCancel={handleDone}
        closable={true}
        mask={{ closable: false }}
        destroyOnHidden
        footer={null}
        width={520}
        styles={{ body: { padding: '20px 24px 16px' } }}
      >
        {/* 标题 */}
        <Typography.Title level={5} style={{ margin: 0, color: theme.toolbar.accent }}>
          {allDone ? '上传完成' : processing ? '正在上传...' : '准备上传'}
        </Typography.Title>
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 13 }}>
          共 {total} 个文件
          {allDone ? '，全部处理完毕' : `，已完成 ${completed}`}
        </Typography.Text>

        {/* 进度条 */}
        <Progress
          percent={pct}
          showInfo={false}
          strokeColor={theme.toolbar.accent}
          railColor={token.colorBorderSecondary}
          size="small"
          style={{ marginBottom: 16 }}
        />

        {/* 文件列表 */}
        <div style={{ maxHeight: 320, overflowY: 'auto', marginBottom: 16 }}>
          {items.map((item) => {
            const isError = item.status === 'error';
            const isDone = item.status === 'done';
            const isUploading = item.status === 'uploading';
            const hasThumbnail = !!(item.thumbnailUrl || item.kind === 'image' || item.kind === 'video');

            return (
              <div
                key={item.id}
                onMouseEnter={(e) => handleMouseEnter(item, e)}
                onMouseLeave={handleMouseLeave}
                style={{
                  borderRadius: 6,
                  padding: '6px 8px',
                  background: isDone
                    ? `${token.colorSuccess}0d`
                    : isError
                      ? `${theme.toolbar.accent}12`
                      : hoveredItem?.id === item.id
                        ? token.controlItemBgHover
                        : 'transparent',
                  cursor: hasThumbnail ? 'pointer' : 'default',
                  transition: 'background 0.15s ease',
                }}
              >
                <Space size={8} align="center" style={{ width: '100%', overflow: 'hidden' }}>
                  {/* 类型图标 */}
                  <FileTypeIcon kind={item.kind} />

                  {/* 状态图标 */}
                  {isDone ? (
                    <CheckCircle size={14} color={token.colorSuccess} />
                  ) : isError ? (
                    <XCircle size={14} color={theme.toolbar.accent} />
                  ) : isUploading ? (
                    <Loader2 size={14} color={theme.toolbar.accent} style={{ animation: 'zeroexo-pulse 1.2s ease-in-out infinite' }} />
                  ) : (
                    <span style={{ width: 14, display: 'inline-block' }} />
                  )}

                  {/* 文件名 */}
                  <Typography.Text
                    ellipsis
                    style={{
                      flex: 1,
                      color: isDone ? token.colorTextTertiary : isError ? theme.toolbar.accent : token.colorText,
                      fontSize: 13,
                    }}
                  >
                    {item.name}
                  </Typography.Text>

                  {/* 文件大小 */}
                  <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                    {(item.size / 1024).toFixed(0)}KB
                  </Typography.Text>
                </Space>
              </div>
            );
          })}
        </div>

        {/* 底部按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {failedCount > 0 && !allDone && !processing ? (
            <Button
              size="small"
              style={{
                color: theme.toolbar.accent,
                borderColor: theme.toolbar.accent,
              }}
              onClick={handleRetry}
            >
              重试失败项 ({failedCount})
            </Button>
          ) : null}
          {allDone ? (
            <Button
              size="small"
              type="primary"
              style={{ background: theme.toolbar.accent, borderColor: theme.toolbar.accent }}
              onClick={handleDone}
            >
              完成
            </Button>
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {pct}%
            </Typography.Text>
          )}
        </div>
      </Modal>

      {/* 悬停缩略图弹出层 */}
      {hoveredItem && showThumbnail && (
        <ThumbnailPopup
          thumbnailUrl={showThumbnail}
          name={hoveredItem.name}
          kind={hoveredItem.kind}
          x={hoverPos.x}
          y={hoverPos.y}
        />
      )}
    </>
  );
}

/** 文件类型图标 */
function FileTypeIcon({ kind }: { kind: string }): React.ReactElement {
  const { token } = antTheme.useToken();
  const size = 14;
  const color = token.colorTextQuaternary;

  switch (kind) {
    case 'image':
      return <Image size={size} color={color} />;
    case 'video':
      return <Video size={size} color={color} />;
    case 'audio':
      return <Music size={size} color={color} />;
    default:
      return <FileText size={size} color={color} />;
  }
}

/** 缩略图弹出层组件 */
function ThumbnailPopup({
  thumbnailUrl,
  name,
  kind,
  x,
  y,
}: {
  thumbnailUrl: string;
  name: string;
  kind: string;
  x: number;
  y: number;
}): React.ReactElement {
  const popupRef = useRef<HTMLDivElement>(null);
  const [adjustedX, setAdjustedX] = useState(x);

  useEffect(() => {
    if (popupRef.current) {
      const rect = popupRef.current.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        setAdjustedX(x - rect.width - 180);
      }
    }
  }, [x]);

  const { token } = antTheme.useToken();

  return (
    <div
      ref={popupRef}
      style={{
        position: 'fixed',
        left: adjustedX,
        top: y,
        zIndex: 100000,
        background: token.colorBgElevated,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 10,
        padding: 8,
        boxShadow: token.boxShadowSecondary,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        maxWidth: 220,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: 200,
          height: 150,
          borderRadius: 6,
          overflow: 'hidden',
          background: token.colorBgContainerDisabled,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {kind === 'image' ? (
          <img src={thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : kind === 'video' ? (
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <img src={thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: 'rgba(0,0,0,0.6)',
                  border: '2px solid rgba(255,255,255,0.7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                  <polygon points="8,5 19,12 8,19" />
                </svg>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <Typography.Text
        type="secondary"
        ellipsis
        style={{ fontSize: 11, marginTop: 6, maxWidth: 200, textAlign: 'center' }}
      >
        {name}
      </Typography.Text>
    </div>
  );
}
