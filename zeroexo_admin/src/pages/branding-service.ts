import { apiGet, apiPut, apiDelete, showApiError, getAccessToken } from '@/services/api-client';
import type { BrandingConfig } from './branding-types';
import { DEFAULT_BRANDING_CONFIG } from './branding-types';

export async function fetchBrandingConfig(): Promise<BrandingConfig> {
  try {
    const data = await apiGet<Partial<BrandingConfig> | null>('/admin/branding');
    return { ...DEFAULT_BRANDING_CONFIG, ...(data ?? {}) };
  } catch (err) {
    if (err instanceof Error && err.message.includes('404')) {
      return { ...DEFAULT_BRANDING_CONFIG };
    }
    throw err;
  }
}

export async function saveBrandingConfig(config: BrandingConfig): Promise<void> {
  await apiPut('/admin/branding', config);
}

export type UploadCategory = 'hero' | 'fallback' | 'images';

export interface UploadResult {
  url: string;
  storageKey: string;
  originalName: string;
  size: number;
  mimeType: string;
  type: 'video' | 'image';
}

const VIDEO_EXTS = ['.mp4', '.webm', '.ogg', '.mkv', '.mov'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.bmp'];

export async function uploadBrandingFile(
  file: File,
  category: UploadCategory = 'hero',
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  const isVideo = VIDEO_EXTS.includes(ext);
  const isImage = IMAGE_EXTS.includes(ext);

  if (!isVideo && !isImage) {
    throw new Error('不支持的格式。视频: mp4/webm/ogg/mkv/mov。图片: jpg/png/webp/gif/svg');
  }
  if (isVideo && file.size > 500 * 1024 * 1024) {
    throw new Error('视频过大,最大 500MB');
  }
  if (isImage && file.size > 20 * 1024 * 1024) {
    throw new Error('图片过大,最大 20MB');
  }

  const formData = new FormData();
  formData.append('file', file);

  const xhr = new XMLHttpRequest();
  return new Promise((resolve, reject) => {
    xhr.open('POST', `/api/admin/branding/upload?category=${encodeURIComponent(category)}`);
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          const body = data.data ?? data;
          resolve({
            url: body.url || '',
            storageKey: body.storageKey || '',
            originalName: body.originalName || file.name,
            size: body.size || file.size,
            mimeType: body.mimeType || file.type,
            type: body.type || (isVideo ? 'video' : 'image'),
          });
        } catch {
          reject(new Error('上传响应解析失败'));
        }
      } else {
        try {
          const errData = JSON.parse(xhr.responseText);
          reject(new Error(errData?.message || `上传失败: HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`上传失败: HTTP ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.send(formData);
  });
}

export async function deleteBrandingFile(storageKey: string): Promise<void> {
  await apiDelete(`/admin/branding/file?key=${encodeURIComponent(storageKey)}`);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export function validateBrandingConfig(config: BrandingConfig): string[] {
  const errors: string[] = [];
  config.heroVideos.forEach((video, idx) => {
    if (!video.url) errors.push(`第 ${idx + 1} 个视频缺少 URL`);
  });
  return errors;
}

export function handleBrandingError(err: unknown, fallback: string): void {
  showApiError(err, fallback);
}