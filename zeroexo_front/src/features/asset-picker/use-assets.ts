/**
 * useAssets - 素材库状态管理(Phase D2.1)
 *
 * 封装 asset-store 的 API 为 React Hook,
 * 提供加载/新增/删除/重命名等操作,自动同步本地状态。
 *
 * 设计参考: useProjects hook(同一套模式)
 */

import { useCallback, useEffect, useState } from 'react';
import {
  listAssets,
  addAsset as storeAdd,
  removeAssets as storeRemove,
  updateAsset as storeUpdate,
} from './asset-store.js';
import type { CreateAssetInput, UpdateAssetInput } from './asset-store.js';
import type { Asset } from './index.js';
import {
  onAssetCreated,
  onAssetUpdated,
  onAssetDeleted,
} from '@/services/sync/sync-service.js';

export interface UseAssetsResult {
  assets: Asset[];
  loading: boolean;
  error: string | null;
  addAsset: (input: CreateAssetInput) => Promise<Asset | null>;
  removeAssets: (ids: string[]) => Promise<void>;
  updateAsset: (id: string, patch: UpdateAssetInput) => Promise<void>;
  refresh: () => Promise<void>;
  /** 检查指定素材是否被画布节点引用(引用计数 > 0) */
  
}

export function useAssets(): UseAssetsResult {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const list = await listAssets();
      setAssets(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assets');
    } finally {
      setLoading(false);
    }
  }, []);

  const addAsset = useCallback(async (input: CreateAssetInput): Promise<Asset | null> => {
    try {
      const asset = await storeAdd(input);
      setAssets((prev) => [asset, ...prev]);
      // 触发云同步推送(异步,不阻塞 UI)
      onAssetCreated(asset.id);
      return asset;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add asset');
      return null;
    }
  }, []);

  const removeAssets = useCallback(async (ids: string[]): Promise<void> => {
    try {
      const toDelete = assets.filter((a) => ids.includes(a.id));
      // 仅删除素材记录,不删除底层存储文件
      // 资源生命周期由后端引用计数管理,前端只负责发起删除请求
      await storeRemove(ids);
      setAssets((prev) => prev.filter((a) => !ids.includes(a.id)));
      for (const a of toDelete) {
        onAssetDeleted(a.id, a.cloudId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove assets');
    }
  }, [assets]);

  const updateAsset = useCallback(async (id: string, patch: UpdateAssetInput): Promise<void> => {
    try {
      // 更新本地 IndexedDB 缓存
      const updated = await storeUpdate(id, patch);
      if (updated) {
        setAssets((prev) => {
          // 移除旧的,把 updated 放到最前(因为 createdAt 已更新)
          const filtered = prev.filter((a) => a.id !== id);
          return [updated, ...filtered];
        });
        // 触发云同步推送(onAssetUpdated → pushAssetToCloud 负责后端同步)
        onAssetUpdated(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update asset');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 页面可见时强制刷新(解决多浏览器/多标签页缓存不同步)
  useEffect(() => {
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [refresh]);

  // 跨标签页同步:监听 localStorage 变化(其他标签页修改素材时触发刷新)
  useEffect(() => {
    const onStorageChange = (e: StorageEvent): void => {
      if (e.key && e.key.startsWith('zeroexo:asset')) {
        void refresh();
      }
    };
    window.addEventListener('storage', onStorageChange);
    return () => window.removeEventListener('storage', onStorageChange);
  }, [refresh]);

  return { assets, loading, error, addAsset, removeAssets, updateAsset, refresh };
}
