/**
 * plan — 制作计划模块（Plan#51）
 *
 * Plan 是与「剧本」同级的一等对象：Agent 读取剧本后生成「主体清单 + 视频提示词」，
 * 用户在可视化页面里审核、补齐素材、发送到画布生成。
 */

export { PlanWorkbench, isPlanAsset } from './components/plan-workbench.js';
export type { PlanWorkbenchProps } from './components/plan-workbench.js';

export { applyPlanOp, applyPlanOps } from './agent/plan-op-executor.js';
export type { PlanOp, PlanOpResult } from './agent/plan-op-executor.js';

export * from './types.js';
export { resolveSlots, extractSlotNumbers, validateShotSlots } from './resolve-slots.js';
export type { ResolveResult, ResolvedSlot } from './resolve-slots.js';
