/**
 * @zeroexo/plugin-image-editor
 *
 * 图片编辑器插件(Phase A.1)
 * 提供: 5 对话框(裁剪/切分/放大/蒙版/多角度) + 11 工具 + 工具栏自定义
 *
 * 零 antd 依赖,自研 Modal/Button
 * 纯客户端处理(crop/split/upscale),AI 调用由外部注入(maskEdit/angle)
 */

// ===== 类型 =====
export type {
  CropRect,
  SplitParams,
  UpscaleAlgorithm,
  UpscaleParams,
  MaskEditPayload,
  AngleParams,
  ImageMeta,
  ImageQuickToolsConfig,
  ImageQuickToolId,
  ImageBaseToolId,
  ImageActionToolId,
} from './types.js';

export {
  DEFAULT_TOOLS_CONFIG,
  TOOLS_STORAGE_KEY,
  UPSCALE_TARGETS,
  UPSCALE_ALGORITHMS,
  MAX_UPSCALE_LONG_EDGE,
  BASE_TOOL_IDS,
  DEFAULT_VISIBLE_ACTION_IDS,
} from './types.js';

// ===== 纯函数(图片操作) =====
export {
  cropDataUrl,
  splitDataUrl,
  upscaleDataUrl,
  resolveUpscaleSize,
} from './utils/image-ops.js';

export { readImageMeta, loadImage } from './utils/image-meta.js';

// ===== UI 组件 =====
export { Modal, Button } from './dialogs/modal.js';
export type { ModalProps, ButtonProps } from './dialogs/modal.js';

export { CropDialog } from './dialogs/crop-dialog.js';
export type { CropDialogProps } from './dialogs/crop-dialog.js';

export { SplitDialog } from './dialogs/split-dialog.js';
export type { SplitDialogProps } from './dialogs/split-dialog.js';

export { UpscaleDialog } from './dialogs/upscale-dialog.js';
export type { UpscaleDialogProps } from './dialogs/upscale-dialog.js';

export { MaskEditDialog } from './dialogs/mask-edit-dialog.js';
export type { MaskEditDialogProps } from './dialogs/mask-edit-dialog.js';

export { AngleDialog } from './dialogs/angle-dialog.js';
export type { AngleDialogProps } from './dialogs/angle-dialog.js';

// ===== 工具定义(11 个可定制工具) =====
export {
  imageToolDefinitions,
  ACTION_TOOL_IDS,
  DEFAULT_TOOL_IDS,
  buildImageToolbarTools,
  normalizeImageQuickToolIds,
  readImageQuickToolsConfig,
  loadImageQuickToolsConfig,
  saveImageQuickToolsConfig,
} from './tools.js';
export type {
  ToolHandlers,
  ToolQueries,
  ToolDefinition,
  ToolInstance,
} from './tools.js';

// ===== 后续 Phase A.1 补充 =====
// export { SplitDialog } from './dialogs/split-dialog.js';
// export { UpscaleDialog } from './dialogs/upscale-dialog.js';
// export { MaskEditDialog } from './dialogs/mask-edit-dialog.js';
// export { AngleDialog } from './dialogs/angle-dialog.js';
// export { ImageToolSettingsModal } from './settings/tool-settings-modal.js';
// export { ImageSettingsPopover } from './settings/image-settings-popover.js';
