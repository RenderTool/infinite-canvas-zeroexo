/**
 * useCoverUpload - 可复用封面上传 hook
 *
 * 封装封面上传的通用流程：File → blob → CAS 上传云端 → 回调持久化。
 * CanvasPage 和 HomePage 共用此 hook，确保后续逻辑变更自动同步。
 */

import { useState, useCallback } from 'react';
import type { message as MessageApi } from 'antd';
import { uploadBlobContentToCloud } from '@/services/sync/sync-resources.js';
import i18n from '@/i18n/config';

export interface CoverUploadState {
  modalOpen: boolean;
  target: { id: string; thumbnailUrl: string | null } | null;
}

export interface UseCoverUploadResult {
  coverState: CoverUploadState;
  openCoverUpload: (id: string, thumbnailUrl: string | null) => void;
  closeCoverUpload: () => void;
  confirmCoverUpload: (file: File, message?: typeof MessageApi) => Promise<string | null>;
}

export function useCoverUpload(): UseCoverUploadResult {
  const [coverState, setCoverState] = useState<CoverUploadState>({
    modalOpen: false,
    target: null,
  });

  const openCoverUpload = useCallback((id: string, thumbnailUrl: string | null) => {
    setCoverState({ modalOpen: true, target: { id, thumbnailUrl } });
  }, []);

  const closeCoverUpload = useCallback(() => {
    setCoverState({ modalOpen: false, target: null });
  }, []);

  /**
   * 确认上传封面
   * @param file - 来自 CoverUploadModal 的 File 对象
   * @returns 云端封面 URL，上传失败返回 null
   */
  const confirmCoverUpload = useCallback(async (file: File, msg?: typeof MessageApi): Promise<string | null> => {
    const showError = (text: string) => {
      if (msg) msg.error(text);
      else console.error(text);
    };

    try {
      const ext = file.type === 'image/png' ? 'png' : 'jpg';
      const filename = `cover_${Date.now()}.${ext}`;
      const result = await uploadBlobContentToCloud(file, filename, file.type, {
        cover: 'true',
      });

      if (!result) {
        showError(i18n.t('coverUploadHook.coverUploadFailed'));
        return null;
      }

      // 返回存储 key 而非完整 URL，由调用方通过 getResourceUrl 在渲染时加上 token
      return result.storageKey;
    } catch (err) {
      showError(i18n.t('coverUploadHook.setCoverFailed'));
      return null;
    }
  }, []);

  return { coverState, openCoverUpload, closeCoverUpload, confirmCoverUpload };
}