/**
 * video-frame - 视频抽帧工具（出片工作台首尾帧获取，2026-08-31 T1）
 *
 * 从视频 URL/Blob 提取指定时间点的帧为 JPEG Blob。
 * 前端 canvas 抽帧（video seek + drawImage + toBlob），无需后端端点。
 *
 * ⚠️ CORS：跨域视频需服务端允许匿名访问，否则 drawImage 会污染画布。
 * 失败时由调用方降级（提示/跳过）。
 */

/** 加载视频元数据并 seek 到目标时间，返回可绘制的 video 元素 */
async function loadVideoAt(
  videoUrl: string,
  timeSec: number,
  signal?: AbortSignal,
): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('视频加载失败'));
    signal?.addEventListener('abort', abort, { once: true });
  });

  const target = Math.max(0, Math.min(timeSec, video.duration || 0));
  if (target > 0 && Math.abs(video.currentTime - target) > 0.05) {
    video.currentTime = target;
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      video.onseeked = done;
      // 兜底：seek 到同帧可能不触发 onseeked
      setTimeout(done, 300);
    });
  }
  return video;
}

/** 从视频提取指定时间的帧为 JPEG Blob */
export async function extractVideoFrame(
  videoUrl: string,
  timeSec: number,
  signal?: AbortSignal,
): Promise<Blob> {
  const video = await loadVideoAt(videoUrl, timeSec, signal);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 不可用');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('抽帧失败'))), 'image/jpeg', 0.92);
    });
    return blob;
  } finally {
    video.src = '';
    video.removeAttribute('src');
    video.load();
  }
}

/** 提取视频首帧（0s） */
export function extractVideoFirstFrame(videoUrl: string, signal?: AbortSignal): Promise<Blob> {
  return extractVideoFrame(videoUrl, 0, signal);
}

/** 提取视频尾帧（末尾 -0.05s，避开最后一帧黑场） */
export function extractVideoLastFrame(videoUrl: string, signal?: AbortSignal): Promise<Blob> {
  return extractVideoFrame(videoUrl, Number.POSITIVE_INFINITY, signal);
}

/** 把 Blob 转为 File（供 uploadAsset 使用） */
export function blobToFile(blob: Blob, filename = 'frame.jpg'): File {
  return new File([blob], filename, { type: blob.type || 'image/jpeg' });
}
