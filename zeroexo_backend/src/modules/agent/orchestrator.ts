/**
 * orchestrator - Agent 编排器
 *
 * 1. orchestrate(): 按顺序执行一系列 Agent 步骤(原有逻辑),每一步的输出作为下一步的上下文输入。
 * 2. orchestrateStoryboardGenerate(): 分镜生成分块编排(Plan#9)
 *    - 输入: 超长剧本文本 → 按段落切块(每块 ≤12k 字符 ≈ 8k tokens)
 *    - 每块独立 AgentTask(taskType: storyboard_assistant, input 带 parentTaskId)
 *    - 并发池执行(≤3),断点续跑(已有 completed 子任务直接复用 output)
 *    - 汇总: JSON shots 合并 → 全局序号重排 → sceneId 加块前缀去重 → 父任务 output
 *
 * 通过 AsyncGenerator 向上层推送所有中间事件。
 */

import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AgentEvent } from './dto/agent.dto';
import { AgentFactory } from './agent-factory';
import { AgentTaskService } from './agent-task.service';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface OrchestrationStep {
  agentType: string;
  input?: string;
}

/** 分镜分块编排输入(storyboard_generate 父任务 input) */
export interface StoryboardGenerateInput {
  scriptText: string;
  episodeId?: string;
  providerId?: string;
  model?: string;
  /** Plan#20 T11: 画布既有主体字典(跨集续写命名对齐) */
  subjects?: Array<{ name: string; kind?: string; aliases?: string[]; description?: string }>;
}

/** 单块子任务执行结果 */
export interface StoryboardChunkResult {
  index: number;
  taskId: string;
  shots: any[];
  error?: string;
}

/** 单块切分单元 */
interface StoryboardChunk {
  index: number;
  text: string;
}

/** 分块上限: 约 6k tokens(中文 1 token ≈ 1.5 字符, 取 9000 字符——Plan#20 P0: 12000 时单块镜头输出超 max_tokens 预算被截断) */
const CHUNK_MAX_CHARS = 9000;
/** 并发池上限 */
const CHUNK_CONCURRENCY = 3;

/**
 * 分块 schema 强指令兜底快照(Plan#20 T4 单源化):
 * 事实源为 skills/storyboard_assistant/SYSTEM_PROMPT.md 「分块模式豁免」段,
 * 仅当文件缺失/提取失败时使用本快照;修改字段契约只改文件,不改这里。
 */
const CHUNK_SCHEMA_DIRECTIVE_FALLBACK = [
  '4. 每个镜头对象必须包含以下字段(缺一不可):',
  '   id: 字符串唯一标识',
  '   number: 顺序号(从 1 递增)',
  '   sceneId: 场次编号(本块内从 1 开始, 如 1-1)',
  '   duration: 4-15 秒整数',
  '   shotType: 从[特写,近景,中景,中近景,中远景,远景,大全景,全景]选',
  '   cameraMovement: 从[固定,推,拉,摇,移,跟,升,降,推拉,环绕,航拍]选',
  '   description: 画面描述(主体位置+具体行为神态; 禁止"正要/准备/即将"等过渡态; 中景及以上必须含画面位置/朝向)',
  '   lighting: 光影(主光源方向+色温; 禁止"柔和光线"等抽象词)',
  '   dialogue: 台词原文(无则空字符串"")',
  '   voiceoverText: 旁白文本(无则空字符串"")',
  '   monologue: 内心独白(无则空字符串"")',
  '   sfx: 音效数组(如["江水声","风声"]; 无则空数组[])',
  '   promptText: 中文提示词(含[主体描述][场景与氛围][动作与情节][镜头语言]段落)',
  '   promptEn: 英文提示词(与 promptText 结构一致)',
  '   entities: 实体名数组(含角色、场景、道具，如["沈渔","江边","旧书"])',
  '   dayNight: 日/夜/黄昏/黎明',
  '   environment: 环境描述(地点+时间+纵深层次)',
].join('\n');

@Injectable()
export class AgentOrchestrator {
  private readonly logger = new Logger(AgentOrchestrator.name);

  constructor(
    private readonly agentFactory: AgentFactory,
    private readonly taskService: AgentTaskService,
    private readonly prisma: PrismaService,
  ) {}

  async *orchestrate(
    artifactId: string,
    steps: OrchestrationStep[],
    userId: string,
  ): AsyncGenerator<AgentEvent> {
    let context = '';

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      this.logger.log(`编排步骤 ${i + 1}/${steps.length}: ${step.agentType}`);

      const agent = await this.agentFactory.create(
        step.agentType,
        artifactId,
        userId,
      );

      // 如果当前步骤没有指定输入,使用上一步的输出作为上下文
      const input = step.input || context;

      const generator = agent.execute(input, artifactId, userId);

      for await (const event of generator) {
        yield event;
        if (event.type === 'agent:complete') {
          const eventData = event.data as { output?: string } | null;
          context = eventData?.output || context;
        }
      }

      // 每完成一步,推送进度事件
      yield {
        type: 'agent:progress',
        data: {
          step: i + 1,
          totalSteps: steps.length,
          agentType: step.agentType,
          status: 'completed',
        },
        timestamp: Date.now(),
      };
    }
  }

  // ===== Plan#9: 分镜生成分块编排 =====

  /**
   * 分镜生成分块编排(父任务 taskType: storyboard_generate)
   *
   * 流程:
   * 1. 按段落切分剧本(每块 ≤12k 字符)
   * 2. 断点续跑: 查询该父任务下已有子任务,completed 块直接复用 output
   * 3. 每块创建/复用独立 AgentTask(storyboard_assistant, input 带 mode:'chunk' + parentTaskId)
   * 4. 并发池执行(≤3),逐块推送进度事件
   * 5. 汇总合并: JSON shots 解析 → number 全局重排 → sceneId 加块前缀去重
   * 6. 部分失败不中断整体: 失败块标记进 output.blocks.failed,可重试; 全部失败则推送 agent:error
   */
  async *orchestrateStoryboardGenerate(
    taskId: string,
    projectId: string,
    userId: string,
    input: StoryboardGenerateInput,
  ): AsyncGenerator<AgentEvent> {
    const startTime = Date.now();
    const scriptText = (input.scriptText ?? '').trim();

    if (!scriptText) {
      yield {
        type: 'agent:error',
        data: { agentType: 'storyboard_generate', error: '剧本内容为空' },
        timestamp: Date.now(),
      };
      return;
    }

    // 0. 生成全局剧情摘要(Plan#9 防幻觉增强): 提取整部小说的世界观/核心人物/主线走向
    const globalContext = await this.generateGlobalContext(taskId, projectId, userId, scriptText);
    if (globalContext) {
      this.logger.log(`全局剧情摘要生成完成: ${taskId}, 长度 ${globalContext.length} 字符`);
    }

    // 1. 切块
    const rawChunks = this.splitIntoChunks(scriptText);
    const chunks: StoryboardChunk[] = rawChunks.map((text, index) => ({ index, text }));
    this.logger.log(`分镜分块: ${taskId} 切分为 ${chunks.length} 块`);

    // 2. 断点续跑: 查询该父任务下已有子任务
    const existingChildren = await this.findChildTasks(taskId);
    const existingByIndex = new Map<number, any>();
    for (const child of existingChildren) {
      const idx = (child.input as any)?.chunkIndex;
      if (typeof idx === 'number') existingByIndex.set(idx, child);
    }

    // 3. 为每块确定子任务(completed 复用 / 其余重建)
    // Plan#20 T11: 画布既有主体字典序列化为子任务注入段(跨集续写时 AI 沿用既有命名)
    const subjectDict = Array.isArray(input.subjects) && input.subjects.length > 0
      ? input.subjects
          .filter((s) => s && typeof s.name === 'string' && s.name.trim())
          .map((s) => {
            const parts = [s.name.trim()];
            if (s.kind) parts.push(`类型:${s.kind}`);
            if (Array.isArray(s.aliases) && s.aliases.length > 0) parts.push(`别名:${s.aliases.join('/')}`);
            if (s.description) parts.push(`描述:${String(s.description).slice(0, 80)}`);
            return parts.join(' | ');
          })
          .join('\n')
      : undefined;
    const plans: Array<{ chunk: StoryboardChunk; child: any; reuse: boolean }> = [];
    for (const chunk of chunks) {
      const existingChild = existingByIndex.get(chunk.index);
      if (existingChild && existingChild.status === 'completed' && existingChild.output) {
        // 断点续跑: 已完成块直接复用
        plans.push({ chunk, child: existingChild, reuse: true });
        continue;
      }
      const child = await this.taskService.createTask({
        userId,
        taskType: 'storyboard_assistant',
        projectId,
        input: {
          mode: 'chunk',
          chunkIndex: chunk.index,
          totalChunks: chunks.length,
          scriptChunk: chunk.text,
          parentTaskId: taskId,
          episodeId: input.episodeId,
          providerId: input.providerId,
          model: input.model,
          ...(subjectDict ? { subjectDict } : {}),
          ...(globalContext ? { globalContext } : {}),
        },
      });
      plans.push({ chunk, child, reuse: false });
    }

    // 4. 并发池执行(Plan#9 防幻觉增强: 滑动窗口——前一块摘要注入后一块)
    const results: StoryboardChunkResult[] = [];
    const executing = new Map<number, Promise<StoryboardChunkResult>>();
    let nextIndex = 0;
    // 滑动窗口: 存储每块的剧情摘要(供后一块注入)
    const chunkSummaries = new Map<number, string>();

    const runChunk = (plan: { chunk: StoryboardChunk; child: any; reuse: boolean }): Promise<StoryboardChunkResult> => (async () => {
      const { chunk, child, reuse } = plan;
      // 滑动窗口: 获取前一块摘要(最多回看 2 块)
      const prevSummaries: string[] = [];
      for (let prevIdx = chunk.index - 1; prevIdx >= Math.max(0, chunk.index - 2); prevIdx--) {
        const s = chunkSummaries.get(prevIdx);
        if (s) prevSummaries.unshift(s);
      }
      const prevContextStr = prevSummaries.length > 0
        ? `【前情提要(近 ${prevSummaries.length} 块剧情走向)】\n${prevSummaries.join('\n')}`
        : undefined;

      if (reuse) {
        try {
          const shots = this.parseShotsFromOutput((child.output as any)?.output ?? '');
          // 断点续跑也需要重建摘要
          const shotSummary = this.generateChunkSummary(shots, chunk.text.slice(0, 100));
          if (shotSummary) chunkSummaries.set(chunk.index, shotSummary);
          return { index: chunk.index, taskId: child.id, shots };
        } catch (err) {
          // 复用解析失败(旧输出格式不兼容): 降级为重新生成
          this.logger.warn(`子任务 ${child.id} 输出解析失败, 重新生成`, (err as Error).message);
        }
      }
      try {
        await this.taskService.updateTask(child.id, { status: 'running', progress: 0 });
        // 注入前情提要到子任务 input(Plan#9 防幻觉增强)
        if (prevContextStr) {
          child.input = { ...(child.input as any), prevContext: prevContextStr };
        }
        const output = await this.executeChildAgent(child, projectId, userId);
        const shots = this.parseShotsFromOutput(output);
        // 生成当前块摘要存入滑动窗口
        const shotSummary = this.generateChunkSummary(shots, chunk.text.slice(0, 100));
        if (shotSummary) chunkSummaries.set(chunk.index, shotSummary);
        await this.taskService.updateTask(child.id, {
          status: 'completed',
          output: { output, shots },
          progress: 100,
          completedAt: new Date(),
        });
        return { index: chunk.index, taskId: child.id, shots };
      } catch (err) {
        const errorMessage = (err as Error).message || '未知错误';
        await this.taskService.updateTask(child.id, {
          status: 'failed',
          error: errorMessage,
          completedAt: new Date(),
        });
        return { index: chunk.index, taskId: child.id, shots: [], error: errorMessage };
      }
    })();

    // 调度循环: 启动并发窗口, 每完成一块 yield 一次进度
    while (results.length < plans.length) {
      while (executing.size < CHUNK_CONCURRENCY && nextIndex < plans.length) {
        const plan = plans[nextIndex++];
        yield {
          type: 'agent:step',
          data: {
            agentType: 'storyboard_generate',
            status: 'thinking',
            message: `正在生成分镜块 ${plan.chunk.index + 1}/${plans.length}...`,
          },
          timestamp: Date.now(),
        };
        executing.set(plan.chunk.index, runChunk(plan));
      }

      const [doneIndex, result] = await Promise.race(
        [...executing.entries()].map(async ([idx, p]) => [idx, await p] as const),
      );
      executing.delete(doneIndex);
      results.push(result);

      const doneCount = results.length;
      const failedCount = results.filter((r) => r.error).length;
      yield {
        type: 'agent:progress',
        data: {
          progress: Math.min(95, Math.round((doneCount / plans.length) * 95)),
          message: `分镜分块 ${doneCount}/${plans.length} 完成${failedCount ? `, ${failedCount} 块失败` : ''}`,
        },
        timestamp: Date.now(),
      };
    }

    // 5. 汇总合并
    const failedBlocks = results
      .filter((r) => r.error)
      .map((r) => ({ index: r.index, taskId: r.taskId, error: r.error }));

    // 全部失败: 推送 error,不产出空结果
    if (failedBlocks.length === plans.length) {
      yield {
        type: 'agent:error',
        data: {
          agentType: 'storyboard_generate',
          error: `分镜生成失败: ${plans.length} 块全部失败(可重试)`,
        },
        timestamp: Date.now(),
      };
      return;
    }

    // 合并: number 全局重排; sceneId 加块前缀去重(第 1 块保持原样, 避免块间 sceneId 重复)
    const mergedShots: any[] = [];
    for (const r of results) {
      if (r.error) continue;
      for (const raw of r.shots) {
        const sceneId = String(raw.sceneId ?? `${r.index + 1}-1`);
        mergedShots.push({
          ...raw,
          ...this.normalizeShotFields(raw),
          id: `shot-${Date.now()}-${mergedShots.length + 1}`,
          number: mergedShots.length + 1,
          sceneId: r.index === 0 ? sceneId : `${r.index + 1}-${sceneId}`,
        });
      }
    }

    // Plan#20 T4: 汇总阶段生成主体字典(零额外 LLM 成本): 剧本文本提取角色/场景 + shots.entities 去重归类
    const subjects = this.buildSubjectsDictionary(scriptText, mergedShots);

    // 改进建议 #4: 汇总阶段场景一致性校验(检测 hallucinated sceneId)
    const sceneValidation = this.validateSceneConsistency(scriptText, mergedShots);
    if (sceneValidation.warnings.length > 0) {
      this.logger.warn(`场景一致性校验: ${taskId} 发现 ${sceneValidation.warnings.length} 个警告`);
      for (const w of sceneValidation.warnings) {
        this.logger.warn(`  [场景校验] ${w}`);
      }
    }

    this.logger.log(
      `分镜汇总: ${taskId} 共 ${mergedShots.length} 个镜头, 失败块 ${failedBlocks.length}/${plans.length}, 主体 ${subjects.length} 个${sceneValidation.warnings.length > 0 ? `, 场景警告 ${sceneValidation.warnings.length}` : ''}`,
    );

    yield {
      type: 'agent:complete',
      data: {
        agentType: 'storyboard_generate',
        output: {
          shots: mergedShots,
          subjects,
          blocks: {
            total: plans.length,
            done: plans.length - failedBlocks.length,
            failed: failedBlocks,
          },
        },
        iterations: plans.length,
        durationMs: Date.now() - startTime,
      },
      timestamp: Date.now(),
    };
  }

  /**
   * 镜头字段归一化(T7 质量评估发现契约漂移):
   * LLM 分块输出自创字段(action/subject/timeOfDay/scene/location/composition),
   * 与 save_shots 契约(description/dayNight/environment)不一致,
   * 导致前端(读 shot.description)大量空列。此处补齐契约字段, 保留原始字段不删。
   */
  private normalizeShotFields(raw: any): Record<string, any> {
    const patch: Record<string, any> = {};
    // 折叠换行: LLM 常把描述按句/按字分行输出, 前端 pre-wrap 原样渲染成竖排阅读, 统一折叠为空格(横排)
    const flatten = (v: string): string => v.replace(/\s*\n+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!raw.description) {
      const desc = [raw.subject, raw.action].filter((v) => typeof v === 'string' && v.trim()).join('，');
      if (desc) patch.description = flatten(desc);
    } else if (typeof raw.description === 'string') {
      patch.description = flatten(raw.description);
    }
    if (!raw.dayNight && raw.timeOfDay) patch.dayNight = raw.timeOfDay;
    if (!raw.environment) {
      const env = [raw.scene, raw.location, raw.composition]
        .filter((v) => typeof v === 'string' && v.trim())
        .join('，');
      if (env) patch.environment = flatten(env);
    }
    return patch;
  }

  // ===== 内部工具 =====

  /**
   * 按段落切分超长文本,每块 ≤ CHUNK_MAX_CHARS 字符
   * 段落优先(\n\n),超长段落按句子边界二次切分,兜底硬切
   */
  private splitIntoChunks(text: string): string[] {
    if (text.length <= CHUNK_MAX_CHARS) return [text];

    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const chunks: string[] = [];
    let current = '';

    for (const para of paragraphs) {
      if (para.length > CHUNK_MAX_CHARS) {
        if (current) {
          chunks.push(current);
          current = '';
        }
        let rest = para;
        while (rest.length > CHUNK_MAX_CHARS) {
          const cut = this.cutAtSentenceBoundary(rest, CHUNK_MAX_CHARS);
          chunks.push(cut);
          rest = rest.slice(cut.length).trim();
        }
        current = rest;
        continue;
      }
      if (current.length + para.length + 2 > CHUNK_MAX_CHARS) {
        chunks.push(current);
        current = para;
      } else {
        current = current ? `${current}\n\n${para}` : para;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  /** 在 max 长度内找最近的句子边界(。！？!?…\n),找不到则硬切 */
  private cutAtSentenceBoundary(text: string, max: number): string {
    const head = text.slice(0, max);
    const boundaryChars = '。！？!?…\n';
    const searchStart = Math.max(0, head.length - 300);
    for (let i = head.length - 1; i >= searchStart; i--) {
      if (boundaryChars.includes(head[i])) {
        return head.slice(0, i + 1);
      }
    }
    return head;
  }

  /** 查询某父任务下已创建的子任务(断点续跑用) */
  private async findChildTasks(parentTaskId: string): Promise<any[]> {
    try {
      return await this.prisma.agentTask.findMany({
        where: {
          taskType: 'storyboard_assistant',
          input: { path: ['parentTaskId'], equals: parentTaskId },
        },
      });
    } catch (err) {
      // PostgreSQL Json path 过滤失败时降级为全量查询
      this.logger.warn(`子任务 Json 过滤失败: ${parentTaskId}`, (err as Error).message);
      try {
        const all = await this.prisma.agentTask.findMany({
          where: { taskType: 'storyboard_assistant' },
        });
        return all.filter((t) => (t.input as any)?.parentTaskId === parentTaskId);
      } catch {
        return [];
      }
    }
  }

  /**
   * Plan#20 T4 单源化: 从 SYSTEM_PROMPT.md 「分块模式豁免」段提取 schema 强指令(事实源=文件),
   * 提取失败回退内置快照。字段契约变更只改文件即可生效,消除代码/文件双源漂移。
   */
  private loadChunkSchemaDirective(): string {
    try {
      const file = path.join(__dirname, 'skills', 'storyboard_assistant', 'SYSTEM_PROMPT.md');
      const md = fs.readFileSync(file, 'utf-8');
      const anchor = md.indexOf('## 分块模式豁免');
      if (anchor >= 0) {
        const section = md.slice(anchor).trim();
        if (section.includes('必填')) {
          return `4. 输出 schema 铁律(以下段来自 SYSTEM_PROMPT.md, 逐字遵守):\n${section}`;
        }
      }
    } catch (err) {
      this.logger.warn(`读取 SYSTEM_PROMPT.md 分块段失败,回退内置快照: ${(err as Error).message}`);
    }
    return CHUNK_SCHEMA_DIRECTIVE_FALLBACK;
  }

  /**
   * Plan#20 T4 + 2026-08-21 BUG 修复: 主体字典生成(三类型全覆盖)
   * - 角色: 剧本对白说话人(「名字: 对白」行首)提取, 支持 2-14 字中文名
   * - 场景: 【场景 N: 地点 - 时间】标题提取 + shots.environment 补全
   * - 道具: shots.entities 中非角色非场景的实体 + shots.description 中提取
   * - description: 首个含该名的 shot.description 截取
   */
  private buildSubjectsDictionary(
    scriptText: string,
    shots: any[],
  ): Array<{ name: string; kind: 'character' | 'scene' | 'prop'; aliases: string[]; description: string }> {
    // ── 角色: 对白行首「名字: 内容」(支持 2-14 字, 含全角冒号, 排除场景标题/括号开头) ──
    const characterSet = new Set<string>();
    const dialogueRe = /^([^\s:：、【】（）()\d]{2,14})[:：]\s*\S/gm;
    let m: RegExpExecArray | null;
    while ((m = dialogueRe.exec(scriptText)) !== null) {
      const name = m[1].trim();
      if (name && !/^(场景|转场|第|镜头|旁白|画外音|音效|字幕)/.test(name)) {
        characterSet.add(name);
      }
    }

    // ── 场景: 【场景 N: 地点 - 时间】提取地点 ──
    const sceneSet = new Set<string>();
    const sceneRe = /【场景\s*\d*\s*[:：]?\s*([^\-—】]{1,20}?)\s*[-—]/g;
    while ((m = sceneRe.exec(scriptText)) !== null) {
      const loc = m[1].trim();
      if (loc) sceneSet.add(loc);
    }

    // ── 从 shot.environment 中提取场景/地点关键词兜底 ──
    // 2026-08-22 BUG 修复: environment 是「地点+时间+纵深层次」复合文本, 分割后需剔除时间/氛围词,
    // 否则「黄昏」「江面波光粼粼」等词被当场景, 且后续 includes 匹配会把角色/道具误判成场景蓝
    const ENV_TIME_WORDS = new Set([
      '日', '夜', '白天', '夜晚', '黄昏', '黎明', '清晨', '早晨', '早上', '上午', '中午',
      '午后', '傍晚', '晚上', '午夜', '正午', '深夜', '凌晨', '晴天', '阴天', '雨天', '雪天',
      '晴天白日', '霞光', '月光', '阳光', '灯光', '光线', '夕阳', '朝阳',
    ]);
    const envSceneSet = new Set<string>();
    for (const shot of shots) {
      const env = typeof shot.environment === 'string' ? shot.environment : '';
      // 用逗号/顿号/空格/句号分割环境描述, 取 2-12 字片段作为候选场景(排除时间/氛围词)
      const envParts = env.split(/[,，、。\s]+/).filter(Boolean);
      for (const part of envParts) {
        const trimmed = part.trim();
        if (trimmed.length >= 2 && trimmed.length <= 12 && !ENV_TIME_WORDS.has(trimmed)) {
          envSceneSet.add(trimmed);
        }
      }
    }

    // ── shots.entities 去重(兼容字符串/数组/对象形态) ──
    const entityNames = new Set<string>();
    for (const shot of shots) {
      const list = Array.isArray(shot.entities) ? shot.entities
        : typeof shot.entities === 'string' ? [shot.entities]
        : [];
      for (const e of list) {
        const name = typeof e === 'string' ? e.trim()
          : (e?.mention ?? e?.name ?? '').trim();
        if (name) entityNames.add(name);
      }
    }

    // ── 归类: 优先命中对话角色 → character, 场景标题 → scene, 环境描述(整片段精确命中) → scene, 其余 → prop ──
    // 2026-08-22 BUG 修复: 删除 inEnv 子串包含兜底——environment 是复合文本(如「江边栈桥,黄昏,男主与女主并肩而立」),
    // includes 会把「旧书」「男主」等出现在环境描述中的实体全部误判为 scene(全蓝)。场景判定只认
    // 场景标题(sceneSet) 与 环境分割片段的「整词精确命中」(envSceneSet), 杜绝角色/道具被吞进场景色。
    const subjects: Array<{ name: string; kind: 'character' | 'scene' | 'prop'; aliases: string[]; description: string }> = [];
    for (const name of entityNames) {
      let kind: 'character' | 'scene' | 'prop' = 'prop';
      if (characterSet.has(name)) {
        kind = 'character';
      } else if (sceneSet.has(name) || envSceneSet.has(name)) {
        kind = 'scene';
      }
      const hit = shots.find((s) => typeof s.description === 'string' && s.description.includes(name));
      const description = hit ? String(hit.description).slice(0, 80) : '';
      subjects.push({ name, kind, aliases: [], description });
    }

    // ── 剧本中出现但未进任何镜头实体的角色也收录(占位主体完备性) ──
    for (const name of characterSet) {
      if (!entityNames.has(name)) {
        subjects.push({ name, kind: 'character', aliases: [], description: '' });
      }
    }

    // ── 剧本场景标题中未进 entities 的场景也收录 ──
    for (const name of sceneSet) {
      if (!entityNames.has(name) && !subjects.some(s => s.name === name)) {
        subjects.push({ name, kind: 'scene', aliases: [], description: '' });
      }
    }

    return subjects;
  }

  /**
   * 改进建议 #4: 汇总阶段场景一致性校验
   * 检测分镜中是否出现剧本原文中不存在的场景/地点环境。
   * 通过比对 shot.environment 与剧本中的场景标题来识别 hallucinated 场景。
   * 不阻断输出,仅记录警告供后续人工审核或自动过滤。
   */
  private validateSceneConsistency(
    scriptText: string,
    shots: any[],
  ): { warnings: string[] } {
    const warnings: string[] = [];
    // 从剧本中提取所有场景标题 /* 场景 N: 地点 */
    const knownScenes: string[] = [];
    const sceneRe = /【场景\s*\d*\s*[:：]\s*([^】]+)/g;
    let sm: RegExpExecArray | null;
    while ((sm = sceneRe.exec(scriptText)) !== null) {
      knownScenes.push(sm[1].trim());
    }
    // 从剧本中提取所有地点关键词
    const knownLocations = new Set<string>();
    for (const scene of knownScenes) {
      const parts = scene.split(/[-—]/).map((s) => s.trim());
      for (const p of parts) {
        if (p.length >= 2) knownLocations.add(p);
      }
    }
    // 剧本中提到的所有场景/地点关键词
    const scriptKeywords = [
      '江边', '茶馆', '小院', '老街', '房间', '街道', '门口', '窗前',
      '客厅', '卧室', '厨房', '阳台', '花园', '庭院', '走廊', '楼梯',
      '办公室', '会议室', '教室', '食堂', '操场', '医院', '病房', '诊室',
      '酒吧', '咖啡', '餐厅', '饭店', '酒店', '宾馆', '车站', '机场',
      '公园', '广场', '马路', '路上', '车内', '车里', '车上', '地铁',
      '山顶', '海边', '沙滩', '田野', '树林', '湖边', '河边', '桥',
      '战场', '基地', '城堡', '宫殿', '寺庙', '教堂', '学校', '大学',
      '超市', '商场', '市场', '工地', '厂房', '仓库', '车库', '码头',
    ];
    // 检查每个 shot
    for (const shot of shots) {
      const env = (shot.environment || '').toLowerCase();
      const desc = (shot.description || '').toLowerCase();
      const combined = `${env} ${desc}`;
      // 检查是否出现剧本中明确不存在的场景关键词
      for (const kw of scriptKeywords) {
        if (combined.includes(kw) && !knownLocations.has(kw)) {
          // 从剧本原文中检查是否间接提到(如对话中提及)
          const scriptContains = scriptText.toLowerCase().includes(kw);
          if (!scriptContains) {
            warnings.push(
              `shot #${shot.number ?? '?'} sceneId=${shot.sceneId ?? '?'} 出现剧本中不存在的场景"${kw}"`,
            );
          }
        }
      }
    }
    return { warnings };
  }

  /** 执行单个子任务 Agent(不走 worker,避免循环依赖),返回最终输出文本 */
  private async executeChildAgent(child: any, projectId: string, userId: string): Promise<string> {
    const agent = await this.agentFactory.create('storyboard_assistant', projectId, userId);
    // 分块模式强指令置于 user 消息首位(比 system prompt 更近输出层,遵从度更高);
    // schema 段单源化自 SYSTEM_PROMPT.md(Plan#20 T4, 征集#16 前置项)
    // Plan#20 T11: subjectDict 独立成段(比混在任务数据 JSON 里遵从度更高)
    // Plan#9 防幻觉增强: 注入全局剧情摘要 + 前情提要 + 防幻觉铁律
    const subjectDict = (child.input as any)?.subjectDict as string | undefined;
    const globalContext = (child.input as any)?.globalContext as string | undefined;
    const prevContext = (child.input as any)?.prevContext as string | undefined;
    const inputStr = [
      '【分块生成模式·必须遵守】',
      '1. 你是分块处理模式: 禁止调用任何工具,直接输出镜头 JSON 数组;',
      '2. 禁止任何解释、前言、总结或 Markdown 代码块;',
      '3. 输出第一行必须是 JSON 数组本身,sceneId 从 1 开始编号;',
      this.loadChunkSchemaDirective(),
      ...(globalContext
        ? ['【全局剧情摘要·整部小说核心背景(所有分块必须遵守)】', globalContext]
        : []),
      ...(prevContext
        ? [prevContext]
        : []),
      ...(subjectDict
        ? ['【已有主体字典(续写本集时必须沿用这些主体的名字/别名, 不得改名或为同一主体新建名称)】', subjectDict]
        : []),
      '【当前任务数据(仅 scriptChunk 字段是本块剧本原文)】',
      // 过滤掉注入的 meta 字段,只保留原始任务数据
      JSON.stringify(this.buildChunkTaskPayload(child.input)),
    ].join('\n');
    let output = '';

    for await (const event of agent.execute(inputStr, projectId, userId)) {
      if (event.type === 'agent:complete') {
        output = (event.data as any)?.output ?? '';
      } else if (event.type === 'agent:error') {
        throw new Error((event.data as any)?.error ?? '子任务执行失败');
      }
    }
    if (!output) throw new Error('子任务未返回内容');
    return output;
  }

  /** 从子任务输出文本解析镜头 JSON 数组(兼容前言文字 / ```json 围栏 / 对象包裹) */
  private parseShotsFromOutput(output: string): any[] {
    const trimmed = output.trim();
    // 1. 直接 parse(纯 JSON 数组)
    try {
      const direct = JSON.parse(trimmed);
      if (Array.isArray(direct)) return direct;
    } catch { /* 继续尝试 */ }
    // 2. 提取 ```json 围栏内容
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(output);
    if (fence) {
      try {
        const parsed = JSON.parse(fence[1].trim());
        if (Array.isArray(parsed)) return parsed;
      } catch { /* 继续尝试 */ }
    }
    // 3. 提取首个 [ 到最后一个 ](容忍前置文字)
    const arrStart = output.indexOf('[');
    const arrEnd = output.lastIndexOf(']');
    if (arrStart >= 0 && arrEnd > arrStart) {
      try {
        const parsed = JSON.parse(output.slice(arrStart, arrEnd + 1));
        if (Array.isArray(parsed)) return parsed;
      } catch { /* 继续尝试 */ }
    }
    // 4. 对象包裹(如 { shots: [...] })
    const objStart = output.indexOf('{');
    const objEnd = output.lastIndexOf('}');
    if (objStart >= 0 && objEnd > objStart) {
      try {
        const parsed = JSON.parse(output.slice(objStart, objEnd + 1));
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.shots)) return parsed.shots;
      } catch { /* 继续尝试 */ }
    }
    // 5. 截断抢救(Plan#20 P0): 从尾部逐个 `}` 断点尝试补 `]` 闭合,救回完整镜头对象
    const salvaged = this.salvageTruncatedArray(output);
    if (salvaged.length > 0) {
      this.logger.warn(`分块输出被截断,抢救回 ${salvaged.length} 个完整镜头(尾部不完整对象丢弃)`);
      return salvaged;
    }
    // 6. 截断检测: 有 [ 无闭合 ]
    if (output.includes('[') && !output.includes(']')) {
      throw new Error('分块输出不完整(疑似被 max_tokens 截断),请重试或调大 max_tokens');
    }
    throw new Error(`分块输出不是有效 JSON: ${output.slice(0, 120)}`);
  }

  /** 截断抢救: 从尾部向前逐个 `}` 断点尝试补 `]` 闭合,返回能解析出的完整镜头数组(失败返回 []) */
  private salvageTruncatedArray(output: string): any[] {
    const arrStart = output.indexOf('[');
    if (arrStart < 0) return [];
    let searchFrom = output.length;
    for (let attempt = 0; attempt < 80; attempt++) {
      const braceIdx = output.lastIndexOf('}', searchFrom - 1);
      if (braceIdx <= arrStart) break;
      searchFrom = braceIdx;
      try {
        const parsed = JSON.parse(output.slice(arrStart, braceIdx + 1) + ']');
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch { /* 继续向前找断点 */ }
    }
    return [];
  }

  // ===== Plan#9 防幻觉增强: 全局上下文生成 =====

  /**
   * 生成整部小说的全局剧情摘要(Plan#9 防幻觉增强):
   * 提取世界观、核心人物关系、主线走向,作为所有分块的上下文约束。
   * 使用轻量级 storyboard_assistant agent 做摘要, 不增加额外模型调用成本。
   * 输入过长时截断前 50k 字符(通常足够涵盖核心设定)。
   * 支持 1 次自动重试(改进建议 #3)。
   */
  private async generateGlobalContext(
    _taskId: string,
    projectId: string,
    userId: string,
    fullScript: string,
  ): Promise<string | undefined> {
    const MAX_CONTEXT_INPUT = 50000;
    const truncated = fullScript.length > MAX_CONTEXT_INPUT
      ? fullScript.slice(0, MAX_CONTEXT_INPUT)
      : fullScript;

    const agent = await this.agentFactory.create('storyboard_assistant', projectId, userId);
    const inputStr = [
      '请阅读以下剧本全文,生成一份结构化的剧情摘要,必须包含:',
      '1. 世界观/故事背景(时代、地点、社会环境)',
      '2. 核心人物列表(姓名、身份、关键特征)',
      '3. 主要人物关系(谁和谁是什么关系)',
      '4. 主线剧情走向(故事的核心冲突和走向)',
      '5. 关键场景地点列表',
      '',
      '要求: 简洁精准,不超过 500 字。不要分镜,不要镜头描述,只做剧情摘要。',
      '',
      '=== 剧本全文 ===',
      truncated,
    ].join('\n');

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let output = '';
        for await (const event of agent.execute(inputStr, projectId, userId)) {
          if (event.type === 'agent:complete') {
            output = (event.data as any)?.output ?? '';
          } else if (event.type === 'agent:error') {
            this.logger.warn(`全局摘要生成失败(第${attempt + 1}次): ${(event.data as any)?.error}`);
            if (attempt === 0) continue; // 重试
            return undefined;
          }
        }
        if (output && output.length > 100) {
          return output.slice(0, 2000);
        }
        // 摘要过短: 重试
        if (attempt === 0) {
          this.logger.warn(`全局摘要过短(${output?.length ?? 0}字符), 重试`);
          continue;
        }
        return undefined;
      } catch (err) {
        this.logger.warn(`全局摘要生成异常(第${attempt + 1}次): ${(err as Error).message}`);
        if (attempt === 0) continue; // 重试
        return undefined;
      }
    }
    return undefined;
  }

  /**
   * 生成单块分镜的剧情走向摘要(Plan#9 防幻觉增强):
   * 从已生成的 shots 中提取核心剧情点,供后一块作为前情提要。
   */
  private generateChunkSummary(shots: any[], _scriptHead: string): string | undefined {
    if (!shots || shots.length === 0) return undefined;
    const summaries: string[] = [];
    for (const shot of shots.slice(0, 5)) {
      const sceneId = shot.sceneId ?? '?';
      const desc = typeof shot.description === 'string'
        ? shot.description.slice(0, 60)
        : '';
      const entities = Array.isArray(shot.entities) ? shot.entities.slice(0, 3).join('/') : '';
      const parts: string[] = [`[${sceneId}]`];
      if (entities) parts.push(`涉及:${entities}`);
      if (desc) parts.push(desc);
      summaries.push(parts.join(' '));
    }
    if (summaries.length === 0) return undefined;
    return `本块分镜走向: ${summaries.join('; ')}`;
  }

  /**
   * 构建子任务的原始 payload, 过滤掉注入的 meta 字段(Plan#9 防幻觉增强)
   */
  private buildChunkTaskPayload(input: any): Record<string, any> {
    const metaKeys = new Set(['globalContext', 'prevContext']);
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(input ?? {})) {
      if (!metaKeys.has(key)) {
        result[key] = value;
      }
    }
    return result;
  }
}
