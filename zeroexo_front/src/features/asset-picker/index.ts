/**
 * asset-picker feature - 资源选择器
 *
 * 受控模式: 父组件传入 assets 数组 + onInsert + onClose。
 * 容器内部只管理 keyword / kindFilter / page 状态。
 *
 * Phase D2: 扩展 audio 类型支持,接入真实数据(AssetStore)。
 */

/**
 * 资产类型
 * - script 为剧本资产（content 存 episodes JSON，资产库按剧本分组展示）
 * - plan 为制作计划资产（Plan#51，content 存 PlanDoc JSON，页签打开 PlanWorkbench）
 */
export type AssetKind = 'text' | 'image' | 'video' | 'audio' | 'script' | 'plan';

export interface Asset {
  id: string;
  title: string;
  kind: AssetKind;
  /** 缩略图 URL(图片用 dataUrl,视频取首帧,音频留空) */
  coverUrl?: string;
  tags?: string[];
  /** 创建时间(ISO 字符串,用于排序) */
  createdAt: string;
  /** 字节数(图片/视频/音频,文本为 0) */
  bytes: number;
  /** MIME 类型(如 image/png、video/mp4、audio/mpeg) */
  mimeType?: string;
  /** 星标收藏 */
  favorite?: boolean;
  data:
    | { kind: 'text'; content: string }
    | { kind: 'script'; content: string; storageKey?: string }
    /**
     * Plan#51：制作计划（content 存 PlanDoc JSON）
     * 注：下方媒体字段对 plan 无业务含义，仅为兼容既有代码对 Asset['data'] 联合类型的
     * 统一访问（storageKey/dataUrl/…）；plan 分支这些字段恒为空。
     */
    | {
        kind: 'plan';
        content: string;
        storageKey?: string;
        dataUrl?: string;
        url?: string;
        width?: number;
        height?: number;
        durationMs?: number;
      }
    | { kind: 'image'; dataUrl: string; storageKey?: string; width?: number; height?: number }
    | { kind: 'video'; url: string; storageKey?: string; width?: number; height?: number; durationMs?: number }
    | { kind: 'audio'; url: string; storageKey?: string; durationMs?: number };
  /** 所属文件夹 ID(资产库/测试模块合并后,素材可归入文件夹) */
  folderId?: string | null;
  /** 云端 ID(同步后设置,本地创建时为 undefined) */
  cloudId?: string;
  /** 云端版本号(用于冲突检测) */
  version?: number;
  /** 最后同步时间(ISO 字符串,null 表示从未同步) */
  lastSyncedAt?: string | null;
}

export type InsertAssetPayload =
  | { kind: 'text'; content: string; title: string }
  | { kind: 'image'; dataUrl: string; title: string; storageKey?: string; width?: number; height?: number }
  | { kind: 'video'; url: string; title: string; storageKey?: string; width?: number; height?: number; durationMs?: number }
  | { kind: 'audio'; url: string; title: string; storageKey?: string; durationMs?: number };

export interface AssetPickerProps {
  open: boolean;
  assets: Asset[];
  onInsert: (payload: InsertAssetPayload) => void;
  onClose: () => void;
  /** 批量删除素材回调(传入选中素材 id 数组) */
  onDelete?: (ids: string[]) => void;
}

export { AssetPicker } from './components/asset-picker.js';
export { useAssets } from './use-assets.js';
export {
  listAssets,
  addAsset,
  updateAsset,
  removeAsset,
  clearAllAssets,
  upsertAsset,
  markAssetSynced,
} from './asset-store.js';
export type { CreateAssetInput, UpdateAssetInput } from './asset-store.js';
export { downloadAsset } from './services/download-asset.js';
