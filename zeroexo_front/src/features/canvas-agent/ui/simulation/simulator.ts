/**
 * simulation/simulator.ts — Agent 流程模拟引擎
 *
 * @deprecated 已由 session/agent-session.ts 真连后端替代（ComposerInput 不再调用 getSimulator）。
 * 保留仅作历史参考。
 *
 * 模拟后端 AgentRuntime 的 SSE 事件流，驱动 AgentDock UI 渲染。
 * 新 UI 使用消息流而非 ThinkStream，每个 step 直接添加消息。
 *
 * 使用方式：
 *   const sim = new AgentSimulator(store);
 *   sim.run("生成一段15秒的tvc广告");
 *   sim.stop();
 */

import { useCanvasAgentStore } from '../store.js';
import { setSimulationResume } from '../store.js';
import { matchFlow, type SimFlow } from './flows.js';

type StoreActions = ReturnType<typeof useCanvasAgentStore.getState>;

export class AgentSimulator {
  private store: StoreActions;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private _running = false;

  constructor(store: StoreActions) {
    this.store = store;
  }

  get running(): boolean {
    return this._running;
  }

  /** 停止所有定时器 */
  stop(): void {
    this._running = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.store.setIsGenerating(false);
    setSimulationResume(null);
  }

  /** 根据用户输入匹配并运行流程 */
  run(input: string): boolean {
    const flow = matchFlow(input);
    if (!flow) return false;
    this.runFlow(flow);
    return true;
  }

  /** 执行指定流程 */
  runFlow(flow: SimFlow): void {
    this.stop();
    this._running = true;

    // 重置 store
    this.store.reset();
    this.store.setDockOpen(true);
    this.store.setIsGenerating(true);
    this.store.clearMessages();

    // 添加用户消息
    this.store.addMessage({
      id: `msg_user_${Date.now()}`,
      role: 'user',
      type: 'text',
      text: `生成一段${flow.label}`,
      timestamp: Date.now(),
    });

    // 按顺序执行步骤
    this._executeSteps(flow);
  }

  /** 执行步骤序列 */
  private _executeSteps(flow: SimFlow): void {
    let cumulativeDelay = 300; // 初始延迟

    // 1. 开场思考消息
    this._schedule(cumulativeDelay, () => {
      if (!this._running) return;
      this.store.addMessage({
        id: `msg_think_${Date.now()}`,
        role: 'agent',
        type: 'text',
        text: '开始分析你的需求…',
        timestamp: Date.now(),
      });
    });
    cumulativeDelay += 400;

    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      if (!step) continue;

      // 1. 思考文本消息
      this._schedule(cumulativeDelay, () => {
        if (!this._running) return;
        this.store.addMessage({
          id: `msg_think_${Date.now()}_${i}`,
          role: 'agent',
          type: 'text',
          text: step.thinkText,
          timestamp: Date.now(),
        });
      });

      cumulativeDelay += step.dur * 0.5;

      // 2. clarify_request（如果有）
      if (step.clarify) {
        this._schedule(cumulativeDelay, () => {
          if (!this._running) return;
          // 添加 ClarifyBlock 消息
          this.store.addMessage({
            id: `msg_clarify_${Date.now()}`,
            role: 'agent',
            type: 'clarify',
            text: '开始前需要确认几件事',
            clarifyItems: step.clarify!,
            timestamp: Date.now(),
          });
        });

        // 挂起，设置 resume 回调，等待用户提交 clarify
        this._schedule(cumulativeDelay + 100, () => {
          this.store.setIsGenerating(false);
          setSimulationResume(() => {
            this.resume(flow, i);
          });
        });
        return; // 等待 clarify 提交后恢复
      }

      // 3. plan（如果有）
      if (step.plan) {
        this._schedule(cumulativeDelay, () => {
          if (!this._running) return;
          // 添加 PlanBlock 消息
          this.store.addMessage({
            id: `msg_plan_${Date.now()}`,
            role: 'agent',
            type: 'plan',
            text: '执行计划',
            plan: step.plan!,
            timestamp: Date.now(),
          });
        });

        // 挂起，等待用户确认 plan
        this._schedule(cumulativeDelay + 100, () => {
          this.store.setIsGenerating(false);
          setSimulationResume(() => {
            this.resume(flow, i);
          });
        });
        return;
      }

      // 4. canvas_op（如果有）
      if (step.canvasOp) {
        this._schedule(cumulativeDelay, () => {
          if (!this._running) return;
          this.store.addMessage({
            id: `msg_op_${Date.now()}`,
            role: 'agent',
            type: 'text',
            text: step.canvasOp!,
            timestamp: Date.now(),
          });
        });
        cumulativeDelay += 300;
      }

      // 5. 进度更新（如果有）
      if (step.progress !== undefined) {
        this._schedule(cumulativeDelay, () => {
          if (!this._running) return;
          const progressMsg = {
            id: `msg_progress_${Date.now()}`,
            role: 'agent' as const,
            type: 'progress' as const,
            progress: {
              steps: [
                ...flow.steps.slice(0, i + 1).map((s, idx) => ({
                  key: `step_${idx}`,
                  label: s.label,
                  status: idx < i ? ('completed' as const) : idx === i ? ('running' as const) : ('queued' as const),
                  progress: idx === i ? step.progress : idx < i ? 100 : 0,
                  cost: s.skillName === 'media_generate' ? 0.08 : 0.02,
                  duration: s.dur,
                })),
                ...flow.steps.slice(i + 1).map((s, idx) => ({
                  key: `step_${i + 1 + idx}`,
                  label: s.label,
                  status: 'queued' as const,
                  progress: 0,
                })),
              ],
              totalProgress: step.progress ?? 0,
              totalCost: 0.32,
              currentStep: step.progressLabel ?? step.label,
            },
            timestamp: Date.now(),
          };
          this.store.addMessage(progressMsg);
        });
        cumulativeDelay += 400;
      }

      // 步骤间间隔
      cumulativeDelay += 200;
    }

    // 最终结果
    this._schedule(cumulativeDelay, () => {
      if (!this._running) return;
      this.store.setIsGenerating(false);

      this.store.addMessage({
        id: `msg_result_${Date.now()}`,
        role: 'agent',
        type: 'text',
        text: flow.finalResult,
        timestamp: Date.now(),
      });
    });
  }

  /** 继续执行（clarify 或 confirm 后） */
  resume(flow: SimFlow, fromStepIndex: number): void {
    this.store.setIsGenerating(true);
    this.store.setPendingClarify([]);
    this.store.setPendingConfirm(null);
    setSimulationResume(null);

    // 从挂起步骤的下一个步骤继续
    if (fromStepIndex + 1 < flow.steps.length) {
      this._executeStepsFrom(flow, fromStepIndex + 1);
    }
  }

  /** 从指定索引开始执行剩余步骤 */
  private _executeStepsFrom(flow: SimFlow, startIndex: number): void {
    let cumulativeDelay = 500;

    // 继续消息
    this._schedule(cumulativeDelay, () => {
      if (!this._running) return;
      this.store.addMessage({
        id: `msg_continue_${Date.now()}`,
        role: 'agent',
        type: 'text',
        text: '好的，继续执行剩余步骤…',
        timestamp: Date.now(),
      });
    });
    cumulativeDelay += 400;

    for (let i = startIndex; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      if (!step) continue;

      // 1. 思考文本
      this._schedule(cumulativeDelay, () => {
        if (!this._running) return;
        this.store.addMessage({
          id: `msg_think_${Date.now()}_${i}`,
          role: 'agent',
          type: 'text',
          text: step.thinkText,
          timestamp: Date.now(),
        });
      });
      cumulativeDelay += step.dur * 0.5;

      // 2. plan（二次确认应跳过）
      if (step.plan) {
        this._schedule(cumulativeDelay, () => {
          if (!this._running) return;
          this.store.addMessage({
            id: `msg_skip_plan_${Date.now()}`,
            role: 'agent',
            type: 'text',
            text: '（已确认，跳过计划阶段）',
            timestamp: Date.now(),
          });
        });
        cumulativeDelay += 200;
        continue;
      }

      // 3. canvas_op
      if (step.canvasOp) {
        this._schedule(cumulativeDelay, () => {
          if (!this._running) return;
          this.store.addMessage({
            id: `msg_op_${Date.now()}`,
            role: 'agent',
            type: 'text',
            text: step.canvasOp!,
            timestamp: Date.now(),
          });
        });
        cumulativeDelay += 300;
      }

      // 4. 进度
      if (step.progress !== undefined) {
        this._schedule(cumulativeDelay, () => {
          if (!this._running) return;
          this.store.addMessage({
            id: `msg_progress_${Date.now()}`,
            role: 'agent',
            type: 'progress',
            progress: {
              steps: flow.steps.map((s, idx) => ({
                key: `step_${idx}`,
                label: s.label,
                status: idx < i ? 'completed' : idx === i ? 'running' : 'queued',
                progress: idx === i ? step.progress : idx < i ? 100 : 0,
                cost: s.skillName === 'media_generate' ? 0.08 : 0.02,
                duration: s.dur,
              })),
              totalProgress: step.progress ?? 0,
              totalCost: 0.32,
              currentStep: step.progressLabel ?? step.label,
            },
            timestamp: Date.now(),
          });
        });
        cumulativeDelay += 400;
      }

      cumulativeDelay += 200;
    }

    // 最终结果
    this._schedule(cumulativeDelay, () => {
      if (!this._running) return;
      this.store.setIsGenerating(false);
      this.store.addMessage({
        id: `msg_result_${Date.now()}`,
        role: 'agent',
        type: 'text',
        text: flow.finalResult,
        timestamp: Date.now(),
      });
    });
  }

  /** 安全调度定时器 */
  private _schedule(ms: number, fn: () => void): void {
    const id = setTimeout(fn, ms);
    this.timers.push(id);
  }
}

/** 单例 */
let instance: AgentSimulator | null = null;

export function getSimulator(): AgentSimulator {
  if (!instance) {
    instance = new AgentSimulator(useCanvasAgentStore.getState());
  }
  return instance;
}

export function resetSimulator(): void {
  instance?.stop();
  instance = null;
}