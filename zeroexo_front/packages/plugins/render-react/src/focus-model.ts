/**
 * FocusModel - 视口聚焦行为模型
 *
 * 聚焦 = 纯意图 + 模型决策:
 * UI 只发意图(focusOnBounds),本模型根据场景(节点规模)决策「怎么动」——
 * 动画时长、帧率节流、或直接跳转。避免大量节点时全帧动画的昂贵重渲染:
 * NodeLayer 每帧 setViewport 触发 N 节点 map + memo 比较 + culling,
 * 节点越多,单帧成本越高,必须按规模降级动画成本。
 *
 * 档位设计(经验值):
 *   ≤120 节点  全帧 60fps(肉眼最佳平滑度)
 *   ≤400 节点  30fps 节流(33ms/帧,动画帧数减半)
 *   ≤800 节点  15fps 节流(66ms/帧,帧数减到 ~1/4)
 *   >800 节点  直接跳转(动画成本不可接受,聚焦结果立即可见)
 */

export interface FocusAnimationStrategy {
  /** 动画总时长(ms);0 = 直接跳转无动画 */
  durationMs: number;
  /** 帧间隔(ms);0 = 不节流(60fps),33 = 30fps,66 = 15fps */
  frameIntervalMs: number;
}

/** 按节点规模解析聚焦动画策略 */
export function resolveFocusAnimation(
  nodeCount: number,
  durationMs = 400,
): FocusAnimationStrategy {
  if (nodeCount > 800) return { durationMs: 0, frameIntervalMs: 0 };
  if (nodeCount > 400) return { durationMs, frameIntervalMs: 66 };
  if (nodeCount > 120) return { durationMs, frameIntervalMs: 33 };
  return { durationMs, frameIntervalMs: 0 };
}
