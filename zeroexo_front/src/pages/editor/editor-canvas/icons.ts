/**
 * 画布模块图标映射（分而治之：本模块图标在此单点维护，快速迭代）
 *
 * 语义键遵循拍板语义表（.project-rules/zeroexo_front/rules/interaction-metadata-mapping.md）：
 * stack=GalleryThumbnails / group=Group / ungroup=Ungroup / resetView=SquareDashed
 * 新增/更换本模块图标只改此文件，模块内所有按钮自动跟随。
 */
import {
  GalleryThumbnails, Group, SquareDashed, Ungroup,
  Trash2, Copy, Pencil, Palette, Maximize2, FolderOpen, Download, Crosshair, RefreshCw, History,
} from 'lucide-react';

/** 画布模块（右键菜单/画布操作菜单/组工具）图标映射 */
export const EDITOR_ICONS = {
  stack: GalleryThumbnails,
  group: Group,
  ungroup: Ungroup,
  resetView: SquareDashed,
  /** 删除（删边/删除节点） */
  delete: Trash2,
  /** 复制节点 */
  copy: Copy,
  /** 编辑/重命名（节点重命名 + 编辑内容 + 组重命名） */
  edit: Pencil,
  /** 样式（组样式弹窗） */
  style: Palette,
  /** 还原基线尺寸 */
  restoreBaseline: Maximize2,
  /** 保存到资产库 */
  saveAsset: FolderOpen,
  /** 下载 */
  download: Download,
  /** 聚焦此节点 */
  focus: Crosshair,
  /** 替换内容 */
  replace: RefreshCw,
  /** 一键同款(复原生成链路,征集#43) */
  replay: History,
} as const;
