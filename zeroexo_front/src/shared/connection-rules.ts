/**
 * 统一连线约束规则
 *
 * 一个方向性兼容矩阵,覆盖两个查询入口:
 * - 正向(源→目标): 源节点 output 能连到哪些目标节点 input
 * - 反向(目标←源): 目标节点 input 能接受哪些源节点 output
 *
 * 使用方:
 * - ConnectionController.validate(): 手动拖拽连线时验证
 * - ConnectionDropMenu: 菜单项禁用过滤(引用该节点生成)
 * - NodeCreateMenu: 无约束(空白创建)
 */

import type { AddNodeType } from './components/node-create-menu.js';

/** 所有节点类型 */
const ALL_NODE_TYPES: AddNodeType[] = [
  'text', 'image', 'video', 'audio', 'generator', 'stacked-media', 'script', 'storyboard', 'workbench', 'production-manager',
];

/**
 * 兼容性矩阵 (output → input 方向)
 * key = 源节点类型, value = 允许连接的目标节点类型列表
 */
const COMPATIBILITY_MATRIX: Record<string, AddNodeType[]> = {
  // 生成:可输出到所有节点(含自身,支持链式生成)
  generator: ['text', 'image', 'video', 'audio', 'stacked-media', 'generator', 'script', 'storyboard', 'workbench', 'production-manager'],
  // 文本:文生文/文生图/文生视频/文生音频/文生剧本/生成/堆叠
  text: ['text', 'image', 'video', 'audio', 'stacked-media', 'script', 'generator'],
  // 图片:图生图/图生视频/图生音频/生成/堆叠
  image: ['image', 'video', 'audio', 'stacked-media', 'generator'],
  // 视频:视频生视频/视频生音频/生成/堆叠
  video: ['video', 'audio', 'stacked-media', 'generator'],
  // 音频:音频生视频(多模态)/生成/堆叠
  audio: ['video', 'stacked-media', 'generator'],
  // 剧本:可连分镜(2026-08-22 架构修正: 剧管=分镜后置工序, 数据链为 剧本→分镜→剧管, 剧本禁止直连剧管——历史遗留 script→production-manager 已移除)
  script: ['storyboard'],
  // 分镜:可连工作台 + 统筹(资产关联)
  storyboard: ['workbench', 'production-manager'],
  // 工作台:终端节点,不接下游
  workbench: [],
  // 统筹节点:剧级资产管理器,可连入工作台(Plan#29)
  'production-manager': ['workbench'],
  // 堆叠是当前 item 的切换器：可进入生成链路，也可连入另一个 StackNode 触发合并。
  'stacked-media': ['image', 'video', 'audio', 'generator', 'stacked-media'],
};

/**
 * 判断 source→target 是否允许连接 (统一规则)
 *
 * 正向和反向共用此函数:
 * - 正向: canConnect(sourceType, targetType)
 * - 反向: canConnect(actualSourceType, targetType)
 *
 * 未知类型默认允许(向后兼容未注册的节点类型)
 */
export function canConnect(sourceType: string, targetType: string): boolean {
  const allowed = COMPATIBILITY_MATRIX[sourceType];
  if (!allowed) return true; // 未知类型默认允许
  return allowed.includes(targetType as AddNodeType);
}

/**
 * 获取源节点允许连接的所有目标类型 (用于菜单禁用过滤)
 *
 * 未知类型返回全部(向后兼容)
 */
export function getAllowedTargetTypes(sourceType: string): AddNodeType[] {
  const allowed = COMPATIBILITY_MATRIX[sourceType];
  return allowed ?? ALL_NODE_TYPES;
}

/**
 * 获取目标节点能接受的所有源类型 (用于反向查询)
 *
 * 遍历矩阵,找出 value 中包含 targetType 的所有 key
 */
export function getAllowedSourceTypes(targetType: string): AddNodeType[] {
  const result: AddNodeType[] = [];
  for (const [sourceType, allowedTargets] of Object.entries(COMPATIBILITY_MATRIX)) {
    if (allowedTargets.includes(targetType as AddNodeType)) {
      result.push(sourceType as AddNodeType);
    }
  }
  return result;
}
