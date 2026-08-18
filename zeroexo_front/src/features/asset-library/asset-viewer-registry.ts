/**
 * asset-viewer-registry - 资产查看器注册表
 *
 * 根据资产类型自动匹配对应的预览器/编辑器组件。
 * 注册表使用单例模式，外部通过 `assetViewerRegistry` 访问。
 *
 * 使用方式：
 * ```ts
 * const viewer = assetViewerRegistry.getViewer(asset.type);
 * if (viewer) {
 *   // <viewer.component asset={asset} onClose={() => ...} />
 * } else {
 *   const defaultViewer = assetViewerRegistry.getDefaultViewer();
 * }
 * ```
 */

import type React from 'react';

export interface AssetViewerDefinition {
  type: 'image' | 'video' | 'audio';
  label: string;
  icon: string; // lucide-react 图标名称
  component: React.ComponentType<any>;
}

class AssetViewerRegistry {
  private viewers: Map<string, AssetViewerDefinition> = new Map();

  register(def: AssetViewerDefinition): void {
    this.viewers.set(def.type, def);
  }

  getViewer(type: string): AssetViewerDefinition | undefined {
    return this.viewers.get(type);
  }

  getDefaultViewer(): AssetViewerDefinition | undefined {
    return this.viewers.get('__default__');
  }
}

// 默认查看器组件 - 显示"此类型暂不支持预览"
const DefaultViewerComponent: React.ComponentType<{
  asset: { id: string; name: string; type: string; storageKey: string; createdAt: number };
  onClose: () => void;
}> = function DefaultViewer({ asset, onClose }) {
  // 由于是 .ts 文件，使用 alert 展示提示信息
  setTimeout(() => {
    alert(`资产类型 "${asset.type}" 暂不支持预览`);
    onClose();
  }, 0);
  return null;
};

// 占位查看器组件 - 显示"此类型预览器正在开发中"
const PlaceholderViewer: React.ComponentType<{
  asset: { id: string; name: string; type: string; storageKey: string; createdAt: number };
  onClose: () => void;
}> = function PlaceholderViewer({ asset, onClose }) {
  setTimeout(() => {
    alert(`"${asset.name}" 此类型预览器正在开发中`);
    onClose();
  }, 0);
  return null;
};

// 单例
export const assetViewerRegistry = new AssetViewerRegistry();

// 注册默认查看器
assetViewerRegistry.register({
  type: '__default__' as AssetViewerDefinition['type'],
  label: '默认查看器',
  icon: 'EyeOff',
  component: DefaultViewerComponent,
});

// 初始注册所有资产类型
// 实际使用时应从外部注册具体的查看器组件，避免循环依赖
assetViewerRegistry.register({
  type: 'image',
  label: '图片查看器',
  icon: 'Image',
  component: PlaceholderViewer,  // 使用占位查看器，后续替换为真实实现
});

assetViewerRegistry.register({
  type: 'video',
  label: '视频播放器',
  icon: 'Video',
  component: PlaceholderViewer,
});

assetViewerRegistry.register({
  type: 'audio',
  label: '音频播放器',
  icon: 'Headphones',
  component: PlaceholderViewer,
});

