/**
 * UploadQueueStore - 批量上传队列状态管理
 *
 * 管理上传队列的进度、状态，供 UploadQueueOverlay 和 useDropHandler 共享。
 *
 * 状态流:
 *   useDropHandler 收集文件 → uploadQueueStore.addFiles(files)
 *   → overlay 显示进度 → 文件逐批上传 → 完成 → overlay 自动关闭
 *   → useDropHandler 收到回调,批量创建节点 + 自动排布
 */
import { create } from 'zustand';

export interface UploadFileItem {
  /** 文件唯一标识(文件名+大小+时间戳) */
  id: string;
  /** 原始 File 对象 */
  file: File;
  /** 文件名 */
  name: string;
  /** 文件大小(bytes) */
  size: number;
  /** 检测到的类型: image/video/audio/text */
  kind: string;
  /** 上传状态 */
  status: 'pending' | 'uploading' | 'done' | 'error';
  /** 错误信息 */
  error?: string;
  /** 缩略图 URL(blob URL,用于悬停预览) */
  thumbnailUrl?: string;
}

export interface UploadQueueState {
  /** 队列中的文件列表 */
  items: UploadFileItem[];
  /** 是否正在处理中 */
  processing: boolean;
  /** 已完成数量 */
  completed: number;
  /** 总数 */
  total: number;
  /** 是否显示覆盖层 */
  visible: boolean;

  /** 添加文件到队列(重置旧状态) */
  addFiles: (files: File[]) => void;
  /** 更新某个文件项的状态 */
  updateItem: (id: string, patch: Partial<UploadFileItem>) => void;
  /** 开始处理 */
  startProcessing: () => void;
  /** 完成一个文件 */
  completeOne: (id: string) => void;
  /** 标记一个文件失败 */
  failOne: (id: string, error: string) => void;
  /** 重置队列 */
  reset: () => void;
  /** 隐藏覆盖层 */
  hide: () => void;
}

export const useUploadQueueStore = create<UploadQueueState>((set, get) => ({
  items: [],
  processing: false,
  completed: 0,
  total: 0,
  visible: false,

  addFiles: (files: File[]) => {
    const items: UploadFileItem[] = files.map((f) => {
      // 推断类型
      let kind = 'image';
      if (f.type.startsWith('video/')) kind = 'video';
      else if (f.type.startsWith('audio/')) kind = 'audio';
      else if (f.type.startsWith('text/')) kind = 'text';

      // 图片直接生成 blob URL 作为缩略图
      let thumbnailUrl: string | undefined;
      if (kind === 'image') {
        try {
          thumbnailUrl = URL.createObjectURL(f);
        } catch {
          // 忽略生成失败
        }
      }

      return {
        id: `${f.name}_${f.size}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        file: f,
        name: f.name,
        size: f.size,
        kind,
        status: 'pending' as const,
        thumbnailUrl,
      };
    });

    // 异步生成视频缩略图(捕获首帧)
    for (const item of items) {
      if (item.kind === 'video') {
        generateVideoThumbnail(item.file).then((url) => {
          if (url) {
            set((s) => ({
              items: s.items.map((it) =>
                it.id === item.id ? { ...it, thumbnailUrl: url } : it,
              ),
            }));
          }
        });
      }
    }

    set({
      items,
      processing: false,
      completed: 0,
      total: items.length,
      visible: true,
    });
  },

  updateItem: (id: string, patch: Partial<UploadFileItem>) => {
    set((s) => ({
      items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    }));
  },

  startProcessing: () => {
    set({ processing: true });
  },

  completeOne: (id: string) => {
    set((s) => ({
      items: s.items.map((it) =>
        it.id === id ? { ...it, status: 'done' as const } : it,
      ),
      completed: s.completed + 1,
    }));
  },

  failOne: (id: string, error: string) => {
    set((s) => ({
      items: s.items.map((it) =>
        it.id === id ? { ...it, status: 'error' as const, error } : it,
      ),
      completed: s.completed + 1,
    }));
  },

  reset: () => {
    // 清理所有 blob URL
    const current = get().items;
    for (const item of current) {
      if (item.thumbnailUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(item.thumbnailUrl);
      }
    }
    set({
      items: [],
      processing: false,
      completed: 0,
      total: 0,
      visible: false,
    });
  },

  hide: () => {
    // 清理所有 blob URL
    const current = get().items;
    for (const item of current) {
      if (item.thumbnailUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(item.thumbnailUrl);
      }
    }
    set({ visible: false });
  },
}));

/**
 * 从视频文件捕获首帧作为缩略图
 * 使用 offscreen <video> 元素解码并绘制到 canvas
 */
async function generateVideoThumbnail(file: File): Promise<string | undefined> {
  try {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'metadata';

    // 等待元数据加载(获取首帧)
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => {
        // 跳转到 0.5 秒处(有些视频首帧黑屏)
        if (video.duration > 0.5) {
          video.currentTime = 0.5;
        }
        resolve();
      };
      video.onerror = () => reject(new Error('视频加载失败'));
      video.src = url;
      video.load();
    });

    // 等待 seek 完成
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      // 如果 duration 很短,可能直接 ready
      if (!video.seeking) resolve();
    });

    // 绘制到 canvas
    const canvas = document.createElement('canvas');
    const w = Math.min(video.videoWidth || 320, 320);
    const h = video.videoHeight
      ? (w / video.videoWidth) * video.videoHeight
      : 180;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 canvas context');
    ctx.drawImage(video, 0, 0, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

    // 清理
    URL.revokeObjectURL(url);
    video.remove();
    canvas.remove();

    return dataUrl;
  } catch (err) {
    console.warn('[upload-queue] 视频缩略图生成失败:', err);
    return undefined;
  }
}
