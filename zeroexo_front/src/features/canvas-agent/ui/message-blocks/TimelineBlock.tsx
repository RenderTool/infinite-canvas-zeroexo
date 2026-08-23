/**
 * TimelineBlock - 执行轨迹（R2 返工：去「执行时间线」包裹卡）
 *
 * 复用 StepCapsule 轨道样式（圆形图标 + 竖线 + 语义名 + 展开详情），
 * 与实时思考流同一视觉体系；不再渲染带标题的盒状卡片。
 * 步骤详情（读取清单/失败原因）随 input/result 保留，历史轨迹可展开回看。
 */

import type { CanvasAgentMessage, ThinkingStep } from '../types.js';
import { StepCapsuleList } from '../think-stream/StepCapsule.js';

export function TimelineBlock({ message }: { message: CanvasAgentMessage }): React.ReactElement {
  const data = message.timeline;
  if (!data || data.steps.length === 0) return <></>;

  const steps: ThinkingStep[] = data.steps.map((st) => ({
    icon: st.kind === 'canvas' ? 'tool' : 'search',
    name: st.name,
    status: st.status, // R2：failed 原样保留，红色 X 兜底展示
    input: st.input,
    result: st.result,
  }));

  return <StepCapsuleList steps={steps} />;
}
