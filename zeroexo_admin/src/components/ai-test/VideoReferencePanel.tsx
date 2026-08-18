/**
 * VideoReferencePanel - 视频参考素材面板（统一上传组件）
 *
 * 无论首尾帧模式还是多模态模式，都使用同一个上传区域。
 * 上传后根据实际文件类型显示各自的预览图：
 *   - 图片 → 缩略图预览
 *   - 视频 → Film 图标
 *   - 音频 → Music 图标
 *
 * 模式区别：
 *   首尾帧模式：仅接受图片，最多 2 张，按上传顺序确定首帧/尾帧
 *   多模态模式：接受图片/视频/音频，按各自上限计数
 */
import { useRef, useMemo } from 'react';
import { Typography, message, Tag } from 'antd';
import { Trash2, Plus, Film, Music, AlertCircle } from 'lucide-react';
import type { ReferenceImage, ReferenceVideo, ReferenceAudio } from './types';
import { getReferenceConfigByMode } from './video-workbench-utils';

const { Text } = Typography;

/** 文件大小限制 */
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

export interface VideoReferencePanelProps {
  /** 当前视频生成模式 */
  mode: string;
  /** 参考素材数量限制 */
  bounds: {
    maxReferenceImages?: number;
    maxReferenceVideos?: number;
    maxReferenceAudios?: number;
  };
  // ─── 所有参考素材（统一列表） ───
  /** 参考图列表 */
  referenceImages: ReferenceImage[];
  /** 参考视频列表 */
  referenceVideos: ReferenceVideo[];
  /** 参考音频列表 */
  referenceAudio: ReferenceAudio[];
  /** 首帧图片（首尾帧模式用） */
  firstFrameImage?: ReferenceImage | null;
  /** 尾帧图片（首尾帧模式用） */
  lastFrameImage?: ReferenceImage | null;
  /** 新增参考图 */
  onAddImages?: (images: ReferenceImage[]) => void;
  /** 删除参考图 */
  onRemoveImage?: (id: string) => void;
  /** 拖拽排序参考图 */
  onReorderImages?: (from: number, to: number) => void;
  /** 新增参考视频 */
  onAddVideos?: (videos: ReferenceVideo[]) => void;
  /** 删除参考视频 */
  onRemoveVideo?: (id: string) => void;
  /** 新增参考音频 */
  onAddAudio?: (audio: ReferenceAudio[]) => void;
  /** 删除参考音频 */
  onRemoveAudio?: (id: string) => void;
  /** 设置首帧图片（首尾帧模式） */
  onSetFirstFrame?: (image: ReferenceImage | null) => void;
  /** 设置尾帧图片（首尾帧模式） */
  onSetLastFrame?: (image: ReferenceImage | null) => void;
}

// ─── 渲染单个缩略图 ──────────────────────────────────────────────

function ReferenceThumbnail({
  type,
  url,
  name,
  onRemove,
}: {
  type: 'image' | 'video' | 'audio';
  url: string;
  name: string;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        position: 'relative',
        width: 56,
        height: 56,
        flexShrink: 0,
        borderRadius: 4,
        overflow: 'hidden',
        border: '1px solid #e8e8e8',
        background: '#fafafa',
      }}
    >
      {type === 'image' ? (
        <img
          src={url}
          alt={name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : type === 'video' ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f0f0f0',
          }}
        >
          <Film size={20} color="#8c8c8c" />
        </div>
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f0f0f0',
          }}
        >
          <Music size={20} color="#8c8c8c" />
        </div>
      )}
      <span
        style={{
          position: 'absolute',
          left: 2,
          bottom: 2,
          background: 'rgba(0,0,0,0.6)',
          color: 'white',
          fontSize: 10,
          padding: '1px 4px',
          borderRadius: 2,
          lineHeight: 1.4,
          maxWidth: 50,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      <div
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        style={{
          position: 'absolute',
          right: 2,
          top: 2,
          width: 18,
          height: 18,
          borderRadius: 3,
          background: 'rgba(0,0,0,0.6)',
          color: '#ff4d4f',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
        title="删除"
      >
        <Trash2 size={10} />
      </div>
    </div>
  );
}

// ─── 槽位按钮 ────────────────────────────────────────────────────

/** 单个槽位按钮（首帧/尾帧/上传），无额外包裹 div，直接渲染 */
function SlotButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: 56,
        height: 56,
        flexShrink: 0,
        borderRadius: 4,
        border: '1px dashed #d9d9d9',
        background: '#fafafa',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: '#bfbfbf',
        transition: 'all 0.2s',
        gap: 2,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#1677ff';
        e.currentTarget.style.color = '#1677ff';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#d9d9d9';
        e.currentTarget.style.color = '#bfbfbf';
      }}
      title={label}
    >
      <Plus size={20} strokeWidth={1.5} />
      <span style={{ fontSize: 9, lineHeight: 1 }}>{label}</span>
    </div>
  );
}

// ─── 工具函数 ─────────────────────────────────────────────────────

/** 合并后的统一展示项 */
interface UnifiedItem {
  id: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  name: string;
}

// ─── 主组件 ───────────────────────────────────────────────────────

export default function VideoReferencePanel(props: VideoReferencePanelProps) {
  const {
    mode,
    bounds,
    firstFrameImage,
    lastFrameImage,
    referenceImages,
    referenceVideos,
    referenceAudio,
    onAddImages,
    onRemoveImage,
    onAddVideos,
    onRemoveVideo,
    onAddAudio,
    onRemoveAudio,
    onSetFirstFrame,
    onSetLastFrame,
  } = props;

  const config = getReferenceConfigByMode(mode, bounds);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 没有需要显示的参考素材
  if (!config.isFirstLastFrameMode && !config.showImages && !config.showVideos && !config.showAudio) {
    return null;
  }

  // ─── 构建统一展示列表 ──────────────────────────────────────────

  const unifiedItems = useMemo<UnifiedItem[]>(() => {
    if (config.isFirstLastFrameMode) {
      const items: UnifiedItem[] = [];
      if (firstFrameImage) {
        items.push({
          id: firstFrameImage.id,
          type: 'image',
          url: firstFrameImage.url,
          name: '首帧',
        });
      }
      if (lastFrameImage) {
        items.push({
          id: lastFrameImage.id,
          type: 'image',
          url: lastFrameImage.url,
          name: '尾帧',
        });
      }
      return items;
    }
    // 多模态模式
    const items: UnifiedItem[] = [
      ...referenceImages.map((img) => ({
        id: img.id,
        type: 'image' as const,
        url: img.url,
        name: img.name || '参考图',
      })),
      ...referenceVideos.map((vid) => ({
        id: vid.id,
        type: 'video' as const,
        url: vid.url,
        name: vid.name || '参考视频',
      })),
      ...referenceAudio.map((aud) => ({
        id: aud.id,
        type: 'audio' as const,
        url: aud.url,
        name: aud.name || '参考音频',
      })),
    ];
    return items;
  }, [config.isFirstLastFrameMode, firstFrameImage, lastFrameImage, referenceImages, referenceVideos, referenceAudio]);

  /** 总最大数量 */
  const totalMax = useMemo(() => {
    if (config.isFirstLastFrameMode) return 2;
    return config.imageMaxCount + config.videoMaxCount + config.audioMaxCount;
  }, [config, config.isFirstLastFrameMode]);

  /** 是否还能继续上传 */
  const canUpload = unifiedItems.length < totalMax;

  /** 每类还剩多少空间 */
  const remaining = useMemo(() => {
    if (config.isFirstLastFrameMode) {
      return { images: 2 - unifiedItems.length, videos: 0, audios: 0 };
    }
    return {
      images: config.imageMaxCount - referenceImages.length,
      videos: config.videoMaxCount - referenceVideos.length,
      audios: config.audioMaxCount - referenceAudio.length,
    };
  }, [config, unifiedItems.length, referenceImages.length, referenceVideos.length, referenceAudio.length]);

  // ─── 文件上传处理 ──────────────────────────────────────────────

  const handleFileUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    if (config.isFirstLastFrameMode) {
      // 首尾帧模式：只接受图片
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) {
        message.warning('首尾帧模式仅支持上传图片');
        return;
      }
      const remainingSlots = 2 - unifiedItems.length;
      if (remainingSlots <= 0) {
        message.warning('最多上传 2 张图片（首帧 + 尾帧）');
        return;
      }
      const oversized: string[] = [];
      const valid: File[] = [];
      for (const f of imageFiles.slice(0, remainingSlots)) {
        if (f.size > MAX_IMAGE_SIZE) {
          oversized.push(f.name);
        } else {
          valid.push(f);
        }
      }
      if (oversized.length > 0) {
        message.warning(`${oversized.slice(0, 3).join('、')} 超过 10MB，已自动跳过`);
      }
      if (valid.length === 0) return;

      // 按顺序填入首帧/尾帧
      for (const file of valid) {
        const ref: ReferenceImage = {
          id: `frame-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url: URL.createObjectURL(file),
          name: file.name,
        };
        if (!firstFrameImage) {
          onSetFirstFrame?.(ref);
        } else if (!lastFrameImage) {
          onSetLastFrame?.(ref);
        }
      }
    } else {
      // 多模态模式：按文件类型分发
      const fileArray = Array.from(files);
      const toAddImages: File[] = [];
      const toAddVideos: File[] = [];
      const toAddAudios: File[] = [];
      const oversizedFiles: string[] = [];

      for (const file of fileArray) {
        if (file.type.startsWith('image/')) {
          if (remaining.images <= 0) continue;
          if (file.size > MAX_IMAGE_SIZE) {
            oversizedFiles.push(file.name);
          } else {
            toAddImages.push(file);
          }
        } else if (file.type.startsWith('video/')) {
          if (remaining.videos <= 0) continue;
          if (file.size > MAX_FILE_SIZE) {
            oversizedFiles.push(file.name);
          } else {
            toAddVideos.push(file);
          }
        } else if (file.type.startsWith('audio/')) {
          if (remaining.audios <= 0) continue;
          if (file.size > MAX_FILE_SIZE) {
            oversizedFiles.push(file.name);
          } else {
            toAddAudios.push(file);
          }
        }
      }

      if (oversizedFiles.length > 0) {
        message.warning(
          `${oversizedFiles.slice(0, 3).join('、')}${oversizedFiles.length > 3 ? ` 等${oversizedFiles.length}个文件` : ''} 超出大小限制，已自动跳过`,
        );
      }

      // 处理图片
      if (toAddImages.length > 0) {
        const startIdx = referenceImages.length;
        const newRefs = toAddImages.slice(0, remaining.images).map((file, i) => ({
          id: `ref-img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url: URL.createObjectURL(file),
          name: `图${startIdx + i + 1}`,
        }));
        onAddImages?.(newRefs);
      }
      // 处理视频
      if (toAddVideos.length > 0) {
        const startIdx = referenceVideos.length;
        const newRefs = toAddVideos.slice(0, remaining.videos).map((file, i) => ({
          id: `ref-vid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url: URL.createObjectURL(file),
          name: `视频${startIdx + i + 1}`,
        }));
        onAddVideos?.(newRefs);
      }
      // 处理音频
      if (toAddAudios.length > 0) {
        const startIdx = referenceAudio.length;
        const newRefs = toAddAudios.slice(0, remaining.audios).map((file, i) => ({
          id: `ref-aud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url: URL.createObjectURL(file),
          name: `音频${startIdx + i + 1}`,
        }));
        onAddAudio?.(newRefs);
      }
    }
  };

  /** 删除统一列表中的项 */
  const handleRemoveItem = (item: UnifiedItem) => {
    if (config.isFirstLastFrameMode) {
      // 首尾帧模式：判断删除的是首帧还是尾帧
      if (firstFrameImage && item.id === firstFrameImage.id) {
        if (firstFrameImage.url?.startsWith('blob:')) URL.revokeObjectURL(firstFrameImage.url);
        onSetFirstFrame?.(null);
      } else if (lastFrameImage && item.id === lastFrameImage.id) {
        if (lastFrameImage.url?.startsWith('blob:')) URL.revokeObjectURL(lastFrameImage.url);
        onSetLastFrame?.(null);
      }
      return;
    }
    // 多模态模式
    if (item.type === 'image') {
      const removed = referenceImages.find((r) => r.id === item.id);
      if (removed?.url?.startsWith('blob:')) URL.revokeObjectURL(removed.url);
      onRemoveImage?.(item.id);
    } else if (item.type === 'video') {
      const removed = referenceVideos.find((r) => r.id === item.id);
      if (removed?.url?.startsWith('blob:')) URL.revokeObjectURL(removed.url);
      onRemoveVideo?.(item.id);
    } else if (item.type === 'audio') {
      const removed = referenceAudio.find((r) => r.id === item.id);
      if (removed?.url?.startsWith('blob:')) URL.revokeObjectURL(removed.url);
      onRemoveAudio?.(item.id);
    }
  };

  /** 获取上传 accept 属性 */
  const acceptType = useMemo(() => {
    if (config.isFirstLastFrameMode) return 'image/*';
    const types: string[] = [];
    if (remaining.images > 0) types.push('image/*');
    if (remaining.videos > 0) types.push('video/*');
    if (remaining.audios > 0) types.push('audio/*');
    return types.join(',');
  }, [config.isFirstLastFrameMode, remaining]);

  // ─── 标题文字 ──────────────────────────────────────────────────

  const title = config.isFirstLastFrameMode ? '首尾帧图片' : '参考素材';
  const acceptLabel = config.isFirstLastFrameMode
    ? '支持 JPG/PNG/WebP，最多 2 张（首帧 + 尾帧）'
    : `图片(${remaining.images}) 视频(${remaining.videos}) 音频(${remaining.audios})`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>{title}</Text>
        {unifiedItems.length > 0 && (
          <Tag color="blue" style={{ marginLeft: 2, fontSize: 10 }}>
            {unifiedItems.length}/{totalMax}
          </Tag>
        )}
      </div>

      {/* ─── 上传区域 ─── */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          minHeight: 60,
          padding: 4,
          border: '1px dashed #d9d9d9',
          borderRadius: 4,
          overflowX: 'auto',
          background: '#fafafa',
        }}
      >
        {config.isFirstLastFrameMode ? (
          <>
            {/* 首帧槽位：按钮或缩略图（无额外包裹 div） */}
            {firstFrameImage ? (
              <ReferenceThumbnail
                type="image"
                url={firstFrameImage.url}
                name="首帧"
                onRemove={() => {
                  if (firstFrameImage.url?.startsWith('blob:')) URL.revokeObjectURL(firstFrameImage.url);
                  onSetFirstFrame?.(null);
                }}
              />
            ) : (
              <SlotButton label="首帧" onClick={() => fileInputRef.current?.click()} />
            )}
            {/* 尾帧槽位：按钮或缩略图（无额外包裹 div） */}
            {lastFrameImage ? (
              <ReferenceThumbnail
                type="image"
                url={lastFrameImage.url}
                name="尾帧"
                onRemove={() => {
                  if (lastFrameImage.url?.startsWith('blob:')) URL.revokeObjectURL(lastFrameImage.url);
                  onSetLastFrame?.(null);
                }}
              />
            ) : (
              <SlotButton label="尾帧" onClick={() => fileInputRef.current?.click()} />
            )}
          </>
        ) : (
          <>
            {/* 多模态模式：统一列表 */}
            {unifiedItems.map((item) => (
              <ReferenceThumbnail
                key={item.id}
                type={item.type}
                url={item.url}
                name={item.name}
                onRemove={() => handleRemoveItem(item)}
              />
            ))}
            {canUpload && (
              <SlotButton label="上传" onClick={() => fileInputRef.current?.click()} />
            )}
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptType}
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            handleFileUpload(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* 提示文字 */}
      <div style={{ fontSize: 11, color: '#bfbfbf', lineHeight: 1.4 }}>
        {config.isFirstLastFrameMode ? (
          <>
            {!firstFrameImage && !lastFrameImage ? (
              <span style={{ color: '#fa8c16', display: 'flex', alignItems: 'center', gap: 4 }}>
                <AlertCircle size={12} /> 至少需上传首帧或尾帧中的一张图片
              </span>
            ) : (
              <span>首帧 + 尾帧，至少需提供一张图片</span>
            )}
          </>
        ) : (
          <span>{acceptLabel}</span>
        )}
      </div>
    </div>
  );
}