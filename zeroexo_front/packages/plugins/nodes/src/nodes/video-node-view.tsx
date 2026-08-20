/**
 * 视频载体节点视图 - 派生自 BaseNodeView + AIStateView
 *
 * 4 状态机(idle→loading→success/error),仅展示视频,不含生成逻辑。
 * 播放器:原生 <video controls> + 反向缩放,确保在 Canvas 缩放容器中正常工作。
 * 帧控制:显示帧计数器(位于视频右上角浮层)。
 */

import { useHydratedContent } from '../utils/hydrate.js';

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { NodeRendererProps, Pin } from '@zeroexo/core';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import type { VideoNodeData } from '@zeroexo/plugin-ai-provider';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { storeVideoThumbnail, resolveVideoThumbnail } from '@zeroexo/plugin-persistence';
import { resolveAnyThumbUrl } from '../utils/hydrate.js';
import { replaceNodeVideo, stripFileExtension } from '../utils/media-replace-model.js';
import { VIDEO_DEFAULT_SIZE } from '../utils/node-contracts.js';
import { useTheme } from '@zeroexo/plugin-theme';
import { BaseNodeView, AIStateView } from '../base-node-view.js';

// ===== requestVideoFrameCallback 元数据类型(TS DOM lib 未内置) =====
interface VideoFrameMetadata {
  expectedDisplayFps?: number;
  presentationTime?: number;
}

// ===== 引脚定义 =====
export function getVideoNodePins(): Pin[] {
  return [
    { id: 'prompt', name: 'Prompt', direction: 'input' },
    { id: 'video', name: 'Video', direction: 'output' },
  ];
}

// ===== 空状态图标构建函数(需 theme 以使用主题色) =====
function videoEmptyIcon(titleColor: string): React.ReactNode {
  return <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={titleColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 7.75a.75.75 0 0 1 1.142-.638l3.664 2.249a.75.75 0 0 1 0 1.278l-3.664 2.25a.75.75 0 0 1-1.142-.64z"/><path d="M7 21h10"/><rect width="20" height="14" x="2" y="3" rx="2"/></svg>;
}

// ===== 媒体容器样式 =====
// 视频容器直接使用 100% 宽高,让原生 <video controls> 在画布缩放中正确渲染。
// 移除 transform scale 反向缩放,因为浏览器原生视频控件 Shadow DOM 不受 CSS transform 影响,
// 使用 transform 会导致控件布局尺寸与实际渲染尺寸不一致。
const mediaContainerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  position: 'relative',
  boxSizing: 'border-box',
};

// ===== VideoNodeView =====

export interface VideoNodeViewProps extends NodeRendererProps {
  connectionController: ConnectionController | null;
  /** 画布图 store(用于上一个/下一个导航) */
  store?: ReactGraphStore | null;
  /** contentOnly 模式:跳过 BaseNodeView 外壳,仅渲染媒体内容(用于 StackNode 等容器) */
  contentOnly?: boolean;
  /** 堆叠舞台中保持原生播放器可见,不以失焦缩略图覆盖。 */
  forcePlayback?: boolean;
  /** 空态底色覆写(StackNode 内统一为 contentSurface,与空文本卡一致) */
  emptyBackground?: string;
}

export function VideoNodeView({
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
  forcePlayback = false,
  emptyBackground,
}: VideoNodeViewProps): React.ReactElement {
  const data = (node.data ?? {}) as Partial<VideoNodeData>;
  const status = data.status ?? 'idle';
  const { t } = useTranslation();
  const { theme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Phase D2.6: 通过 storageKey 重建 blob URL(刷新后 content 可能失效)
  const hydratedContent = useHydratedContent(data.storageKey, data.content ?? '');
  // 使用 hydratedContent 判断是否有内容,避免异步解析期间渲染 <video src=""> 导致浏览器跳转
  const hasContent = !!hydratedContent;

  // === 帧控制状态(仅用于显示帧计数) ===
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const currentFrameRef = useRef(0);
  const fpsRef = useRef(30);
  const fpsDetectedRef = useRef(false);
  // 失焦缩略图:不选中时用首帧缩略图替代视频播放器
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const thumbnailGeneratedRef = useRef(false);

  // ===== 截帧功能(移至 node-tools.tsx,工具直接捕获并创建新图片节点) =====

  const updateData = (patch: Partial<VideoNodeData>): void => {
    updateNode({ data: { ...data, ...patch } });
  };

  // 节点颜色使用 theme.node.fill(所有类型共用)
  const nodeColor = theme.node.fill;

  // Bug3: 点击空状态触发文件选择器
  const handleReplaceClick = (): void => {
    fileInputRef.current?.click();
  };

  // Bug4: 替换后调整节点尺寸比例 + 刷新标题为文件名
  // Plan#11 C2: 上传/尺寸/数据落盘收敛到 replaceNodeVideo(命令队列,支持撤销),视图只消费命令
  const handleFileReplace = async (file: File): Promise<void> => {
    if (!file.type.startsWith('video/')) return;
    updateData({ status: 'loading', errorDetails: undefined });
    updateNode({ title: stripFileExtension(file.name) });
    await replaceNodeVideo(commandQueue, node, file, {
      onStatusChange: (s) => {
        if (s === 'error') updateData({ status: 'error' });
      },
    });
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (file) void handleFileReplace(file);
    e.target.value = '';
  };

  // Phase D2.8: 拖拽外部文件到节点上替换内容
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>): Promise<void> => {
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('video/')) return;
    e.preventDefault();
    e.stopPropagation();
    void handleFileReplace(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // 生成首帧缩略图(截帧 → 持久化到 localforage + 设置 state)
  const generateThumbnail = useCallback((vid: HTMLVideoElement) => {
    if (thumbnailGeneratedRef.current) return;
    thumbnailGeneratedRef.current = true;
    try {
      const canvas = document.createElement('canvas');
      // 最大宽度320px,保持比例
      const maxW = 320;
      const w = Math.min(vid.videoWidth || 640, maxW);
      const h = Math.round(w * ((vid.videoHeight || 480) / (vid.videoWidth || 640)));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(vid, 0, 0, w, h);
      const url = canvas.toDataURL('image/jpeg', 0.5);
      setThumbnailUrl(url);

      // 持久化到 localforage(异步,不阻塞 UI)
      if (data.storageKey) {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              void storeVideoThumbnail(data.storageKey!, blob).catch((err) => {
                console.warn('[video-node] thumbnail persist failed:', err);
              });
            }
          },
          'image/jpeg',
          0.5,
        );
      }
    } catch { /* 静默失败,不影响视频播放 */ }
  }, [data.storageKey]);

  // === 原生视频事件处理 ===

  // 视频元数据加载完成:检测 FPS + 设置总帧数 + 生成缩略图
  const handleLoadedMetadata = useCallback(() => {
    const vid = videoRef.current;
    if (!vid || fpsDetectedRef.current) return;
    fpsDetectedRef.current = true;

    // 自动检测视频帧率:使用 requestVideoFrameCallback API(Chrome/Edge)
    const detectFps = (): void => {
      try {
        if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
          vid.requestVideoFrameCallback((_now: number, metadata: VideoFrameMetadata) => {
            const detected = Math.round(metadata.expectedDisplayFps ?? 0) || 30;
            fpsRef.current = detected;
            if (vid.duration > 0) {
              setTotalFrames(Math.round(vid.duration * detected));
            }
            // 使用 requestVideoFrameCallback 回调后的帧来生成缩略图
            generateThumbnail(vid);
          });
        } else {
          // 回退:通过 timeupdate 事件估算
          let frames = 0;
          const startTime = performance.now();
          const handler = (): void => {
            frames++;
            const elapsed = performance.now() - startTime;
            if (elapsed >= 500) {
              vid.removeEventListener('timeupdate', handler);
              const detected = Math.round(frames / (elapsed / 1000)) || 30;
              fpsRef.current = detected;
              if (vid.duration > 0) {
                setTotalFrames(Math.round(vid.duration * detected));
              }
              generateThumbnail(vid);
            }
          };
          vid.addEventListener('timeupdate', handler);
        }
      } catch {
        fpsRef.current = 30;
        if (vid.duration > 0) {
          setTotalFrames(Math.round(vid.duration * 30));
        }
        generateThumbnail(vid);
      }
    };
    detectFps();
  }, [generateThumbnail]);

  // hydratedContent 变化时(视频替换/首次加载)重置 FPS 检测状态 + 缩略图
  useEffect(() => {
    fpsDetectedRef.current = false;
    thumbnailGeneratedRef.current = false;
    setTotalFrames(0);
    setCurrentFrame(0);
    currentFrameRef.current = 0;
    setThumbnailUrl(null);

    // 缩略图回退链:持久化缩略图 → 后端 thumb 级资源(确保同一视频的不同节点都能显示缩略图)
    if (data.storageKey) {
      let cancelled = false;
      (async () => {
        // 1. 持久化缩略图(video-node-view 上传/播放时经 storeVideoThumbnail 存入)
        try {
          const persisted = await resolveVideoThumbnail(data.storageKey);
          if (persisted && !cancelled) { setThumbnailUrl(persisted); return; }
        } catch { /* 继续下一级 */ }
        // 2. 后端 thumb 级资源(resources/ 后端 size=thumb 认证链路)
        const thumb = await resolveAnyThumbUrl(data.storageKey);
        if (!cancelled && thumb) setThumbnailUrl(thumb);
      })();
      return () => { cancelled = true; };
    }
  }, [hydratedContent, data.storageKey]);

  // 时间更新:同步当前帧
  const handleTimeUpdate = useCallback(() => {
    const vid = videoRef.current;
    if (!vid || totalFrames <= 0) return;
    const frame = Math.round(vid.currentTime * fpsRef.current);
    currentFrameRef.current = frame;
    setCurrentFrame(frame);
    // 将帧信息存到 dataset 供截帧工具读取
    vid.dataset.currentFrame = String(frame);
    vid.dataset.totalFrames = String(totalFrames);
    vid.dataset.fps = String(fpsRef.current);
  }, [totalFrames]);

  // === 原生事件监听:用 addEventListener 替代 React 合成事件 ===
  // 原因:React 合成事件在处理 <video controls> Shadow DOM 交互时不可靠,
  // seeking/seeked/play 等媒体事件的触发时序在合成事件中可能与原生事件不一致
  const handleSeekedRef = useRef<() => void>(() => {});
  // 用 ref 保持最新值,避免 useEffect 依赖变化导致反复绑定/解绑
  handleSeekedRef.current = () => {
    const vid = videoRef.current;
    if (!vid || totalFrames <= 0) return;
    vid.dataset.isSeeking = '0';
    const frame = Math.round(vid.currentTime * fpsRef.current);
    currentFrameRef.current = frame;
    setCurrentFrame(frame);
    vid.dataset.currentFrame = String(frame);
    vid.dataset.totalFrames = String(totalFrames);
    vid.dataset.fps = String(fpsRef.current);
    // 延迟暂停:覆盖浏览器在 seek 完成后的自动 play
    // 使用多个 setTimeout 确保在浏览器 play() 之后执行 pause()
    setTimeout(() => vid.pause(), 0);
    setTimeout(() => vid.pause(), 50);
    setTimeout(() => vid.pause(), 150);
  };

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    // seeking:标记正在 seek,不调用 pause()避免干扰浏览器 seek 操作
    const onSeeking = () => {
      vid.dataset.isSeeking = '1';
    };
    // seeked:更新帧计数 + 延迟暂停
    const onSeeked = () => handleSeekedRef.current();
    // play:如果正在 seek 或刚 seek 完,立即暂停
    const onPlay = () => {
      if (vid.dataset.isSeeking === '1') {
        vid.pause();
        setTimeout(() => vid.pause(), 50);
      }
    };

    vid.addEventListener('seeking', onSeeking);
    vid.addEventListener('seeked', onSeeked);
    vid.addEventListener('play', onPlay);

    return () => {
      vid.removeEventListener('seeking', onSeeking);
      vid.removeEventListener('seeked', onSeeked);
      vid.removeEventListener('play', onPlay);
    };
  }, [hydratedContent]); // hydratedContent 变化时(video src 加载完成)重新绑定

  // === 阻止双击全屏(click 事件防抖接管单击/双击行为) ===
  // 问题:Chrome 双击视频全屏行为无法通过 fullscreenchange 事件拦截
  // 解决:使用 click 事件防抖,手动区分单击(播放/暂停)和双击(不做任何事),阻止浏览器默认双击全屏
  // 注意:禁止在此视图挂 onDoubleClick/onPointerDown 拦截——它们对浏览器原生全屏检测无效,
  // 但会掐断 dblclick 冒泡,导致画布 NodeItem 的 onDoubleClick 收不到事件(双击聚焦失效)。
  // 真正拦截全屏的是下方原生 click 捕获监听,dblclick 事件保持冒泡给画布层。
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    let clickTimer: ReturnType<typeof setTimeout> | null = null;

    // 原生 click 事件监听器(捕获阶段),完全接管单击/双击行为
    const onClick = (e: MouseEvent) => {
      // 阻止默认行为(防止浏览器内部的双击全屏检测)
      e.preventDefault();
      e.stopPropagation();

      if (clickTimer) {
        // 第二次点击(双击):清除定时器,不触发任何操作
        clearTimeout(clickTimer);
        clickTimer = null;
      } else {
        // 第一次点击:延迟处理播放/暂停(等待可能的第二次点击)
        clickTimer = setTimeout(() => {
          clickTimer = null;
          // 手动触发播放/暂停
          if (vid.paused) {
            void vid.play().catch(() => {});
          } else {
            vid.pause();
          }
        }, 300); // 300ms 内第二次点击视为双击
      }
    };

    // 捕获阶段拦截,确保在浏览器默认行为之前执行
    vid.addEventListener('click', onClick, { capture: true });

    return () => {
      vid.removeEventListener('click', onClick, { capture: true });
      if (clickTimer) clearTimeout(clickTimer);
    };
  }, [hydratedContent]); // hydratedContent 变化时重新绑定(video 元素可能重新渲染)

  // 问题5: 标题栏尺寸规格(尺寸缺失时读 video 契约,禁止裸数字)
  const titleSizeText = data.naturalWidth && data.naturalHeight
    ? `${data.naturalWidth} × ${data.naturalHeight}`
    : `${node.size?.width ?? VIDEO_DEFAULT_SIZE.width} × ${node.size?.height ?? VIDEO_DEFAULT_SIZE.height}`;
  // T10: 图标尺寸 CSS 连续化(与标题 fontSize 同源 --zx-invk),消除量化跨桶跳变
  const TITLE_ICON_CLAMP = 'clamp(9px, calc(13px * var(--zx-invk, 1)), 16px)';
  const titleIconEl = <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: TITLE_ICON_CLAMP, height: TITLE_ICON_CLAMP }}><path d="M10 7.75a.75.75 0 0 1 1.142-.638l3.664 2.249a.75.75 0 0 1 0 1.278l-3.664 2.25a.75.75 0 0 1-1.142-.64z"/><path d="M7 21h10"/><rect width="20" height="14" x="2" y="3" rx="2"/></svg>;

  // 失焦(未选中且未悬停)时暂停视频,聚焦时自动恢复播放
  // 注意:不清除 src,避免重新请求下载
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (!forcePlayback && !isSelected && !isHovered) {
      vid.pause();
    }
  }, [forcePlayback, isSelected, isHovered]);

  // === 有内容时的渲染逻辑:原生 <video controls> + 反向缩放 ===
  // 渐进式加载: invK >= 4(画布缩小)时不渲染 <video>,仅显示缩略图
  // 避免同时存在大量 <video> 元素导致内存爆炸
  const wantLazyThumb = (invK ?? 1) >= 4;
  const renderContent = (): React.ReactNode => {
    // 有原始内容(storageKey/content)时才渲染,否则返回 null 让 AIStateView 显示空状态
    const hasRawContent = !!(data.content || data.storageKey);
    if (!hasRawContent) return null;

    // hydration 期间(hasContent=false 但 hasRawContent=true):显示加载占位
    if (!hasContent) {
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              border: '2px solid rgba(255,255,255,0.3)',
              borderTopColor: '#fff',
              borderRadius: '50%',
              animation: 'ze-video-hydrate-spin 0.6s linear infinite',
            }}
          />
        </div>
      );
    }

    // 画布缩小时:只渲染缩略图,不创建 video 元素
    if (wantLazyThumb && thumbnailUrl) {
      return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <div style={{ ...mediaContainerStyle, background: '#000' }}>
            <img
              src={thumbnailUrl}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: 'block',
                background: '#000',
              }}
            />
          </div>
        </div>
      );
    }

    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <div
          style={{ ...mediaContainerStyle, background: '#000' }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          <video
            ref={videoRef}
            // contentOnly(堆叠舞台)下不挂 data-node-id:card.id 非画布节点,
            // 连线拖拽 elementFromPoint→closest('[data-node-id]') 会命中无效 id 导致连入失败
            data-node-id={contentOnly ? undefined : node.id}
            src={hydratedContent}
            controls
            controlsList="nodownload noplaybackrate"
            preload="metadata"
            playsInline
            disablePictureInPicture
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
              background: '#000',
            }}
          />
        </div>
        {/* 失焦时缩略图覆盖层:video 仍在后台暂停,但用户看到的是缩略图 */}
        {!forcePlayback && !isSelected && !isHovered && thumbnailUrl && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 5,
              pointerEvents: 'none',
            }}
          >
            <img
              src={thumbnailUrl}
              alt=""
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: 'block',
              }}
            />
          </div>
        )}
        {/* 帧计数器浮层 */}
        {totalFrames > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'rgba(0,0,0,0.65)',
              color: '#fff',
              fontSize: 10,
              fontFamily: "'Courier New', monospace",
              fontVariantNumeric: 'tabular-nums',
              lineHeight: '18px',
              pointerEvents: 'none',
              zIndex: 10,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {`帧 ${currentFrame} / ${totalFrames}`}
          </div>
        )}
      </div>
    );
  };

  // hydration 加载动画 keyframes
  const spinKeyframes = `@keyframes ze-video-hydrate-spin { to { transform: rotate(360deg); } }`;

  // contentOnly 模式:跳过 BaseNodeView 外壳,仅渲染媒体内容
  if (contentOnly) {
    return (
      <>
        <AIStateView
          status={status}
          errorDetails={data.errorDetails}
          errorType={data.errorType}
          accentColor={nodeColor}
          emptyIcon={videoEmptyIcon(theme.toolbar.textMuted)}
          emptyText={t('nodes.videoEmpty')}
          emptyTextColor={theme.toolbar.textMuted}
          hasContent={hasContent}
          onReplace={handleReplaceClick}
          replaceBtnPosition="left"
          backgroundColor={emptyBackground ?? nodeColor}
          taskLabel={(data.taskLabel as string) ?? undefined}
        >
          {renderContent()}
        </AIStateView>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />
        <style>{spinKeyframes}</style>
      </>
    );
  }

  return (
    <BaseNodeView
      node={node}
      pins={pins}
      isSelected={isSelected}
      isHovered={isHovered}
      title={node.title ?? data.title ?? t('nodes.videoTitle')}
      color={nodeColor}
      connectionController={connectionController}
      forceShowPins={forceShowPins}
      contentPadding={0}
      invK={invK}
      titleIcon={titleIconEl}
      titleSize={titleSizeText}
      updateNode={updateNode}
      externalRenaming={externalRenaming}
      onRenameFinish={onRenameFinish}
      store={store}
    >
      <AIStateView
        status={status}
        errorDetails={data.errorDetails}
        errorType={data.errorType}
        accentColor={nodeColor}
        emptyIcon={videoEmptyIcon(theme.toolbar.textMuted)}
        emptyText={t('nodes.videoEmpty')}
        emptyTextColor={theme.toolbar.textMuted}
        hasContent={hasContent}
        onReplace={handleReplaceClick}
        replaceBtnPosition="left"
        backgroundColor={nodeColor}
        taskLabel={(data.taskLabel as string) ?? undefined}
      >
        {renderContent()}
      </AIStateView>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />
      <style>{spinKeyframes}</style>
    </BaseNodeView>
  );
}