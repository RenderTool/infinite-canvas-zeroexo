/**
 * group 层级系统常量
 *
 * 沿用源项目设计,统一来源(源项目存在重复定义,迁移时已去重)。
 */

/** group 尺寸因子(1.1 倍所选组件合并包围盒) */
export const GROUP_SIZE_FACTOR = 1.1;

/** group 最小内边距(包围盒计算时, padX = max(width * 0.1 / 2, 40)) */
export const GROUP_MIN_PADDING = 40;

/** group 内边距(布局排列用) */
export const GROUP_PADDING = 20;

/** group 标题栏高度(渲染用) */
export const GROUP_TITLE_HEIGHT = 28;

/** 排列间距(布局排列用) */
export const ARRANGE_GAP = 24;

/** 预览组 id(未确认的组,选中 ≥2 节点时自动生成) */
export const PREVIEW_GROUP_ID = '__preview__';

/** group 聚合输入 pin id(左侧,聚合组内所有 input pin) */
export const GROUP_INPUT_PIN_ID = '__group_in__';

/** group 聚合输出 pin id(右侧,聚合组内所有 output pin) */
export const GROUP_OUTPUT_PIN_ID = '__group_out__';

/** group z-index(固定 -10,渲染于普通节点之下) */
export const GROUP_Z_INDEX = -10;

/** 组数超过该阈值时关闭 backdropFilter(磨砂玻璃合成层上限,对齐边层 GLOW_LIMIT 降级模式) */
export const GROUP_BLUR_LIMIT = 80;

// ===== Version Folder 常量 =====

/** 版本文件夹标记:group.data 上检测此字段 */
export const VERSION_FOLDER_KEY = 'versionFolder';

/** 版本文件夹预览模式:叠卡 */
export const PREVIEW_MODE_STACKED = 'stacked';
/** 版本文件夹预览模式:网格展开 */
export const PREVIEW_MODE_GRID = 'grid';

/** 叠卡模式下固定预览宽度 */
export const VF_PREVIEW_WIDTH = 340;
/** 叠卡模式下固定预览高度 */
export const VF_PREVIEW_HEIGHT = 240;
