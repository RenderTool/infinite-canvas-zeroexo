/**
 * tool-registry - Agent 工具注册表
 *
 * 定义 Agent 可调用的工具接口与工厂函数。
 * 每个工具包含 name / description / parameters / execute 四个字段,
 * 通过 createToolsForAgentType 按 Agent 类型返回对应的工具列表。
 *
 * 工具能力分两层:
 * - 基础层: read_script / save_script / read_project_config / save_project_config / read_storyboard
 *   只需要 PrismaService,所有 Agent 都可使用
 * - 扩展层: save_shots (含 episodeId + mode) / save_entities / merge_entities / replace_entity_image /
 *   move_variant_to_entity / add_variant / remove_variant / ai_image / ai_audio / list_existing_assets
 *   需要 PrismaService + AssetsService + AiGenerateService + userId,仅 storyboard_assistant 使用
 */

import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AssetsService } from '../assets/assets.service';
import { AiGenerateService } from '../ai-generate/ai-generate.service';
import { GenerateRequestDto } from '../ai-generate/dto/generate-request.dto';
import { AgentSkillService } from './agent-skill.service';

/** 工具接口 - LLM 可调用的最小单元 */
export interface Tool {
  name: string;
  description: string;
  /** LLM 调用的参数 schema (OpenAI function calling 格式) */
  parameters: Record<string, unknown>;
  execute: (args: any) => Promise<any>;
}

/** 工具工厂的依赖上下文(扩展层工具需要) */
export interface ToolContext {
  projectId: string;
  userId: string;
  /** 当前任务 ID（R2：Agent 创建的节点打 agentTaskId 烙印，供追溯/档案关联） */
  taskId?: string;
  prisma: PrismaService;
  assetsService?: AssetsService;
  aiGenerateService?: AiGenerateService;
}

/** 共用的工具日志器 */
const toolLogger = new Logger('AgentTool');

// ============================================================================
// 基础工具(无副作用 / 仅读写 project.script 和 project.config)
// ============================================================================

export function readScript(ctx: ToolContext): Tool {
  return {
    name: 'read_script',
    description: '读取当前项目的剧本/脚本内容,返回多集结构化数据',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async (_args: any) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { script: true },
      });
      return { script: project?.script ?? null, message: '剧本已读取' };
    },
  };
}

export function saveScript(ctx: ToolContext): Tool {
  return {
    name: 'save_script',
    description: '保存/更新剧本内容到当前项目',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'object', description: '剧本内容(JSON)' },
      },
      required: ['content'],
    },
    execute: async (args: { content: any }) => {
      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: { script: args.content },
      });
      return { success: true, message: '剧本已保存' };
    },
  };
}

export function readProjectConfig(ctx: ToolContext): Tool {
  return {
    name: 'read_project_config',
    description: '读取当前项目的配置信息(题材、风格、时长等)',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async (_args: any) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { config: true },
      });
      return { config: project?.config ?? null, message: '配置已读取' };
    },
  };
}

export function saveProjectConfig(ctx: ToolContext): Tool {
  return {
    name: 'save_project_config',
    description: '保存项目配置信息(题材、风格、时长等),浅合并现有 config',
    parameters: {
      type: 'object',
      properties: {
        config: { type: 'object', description: '要合并的配置字段' },
      },
      required: ['config'],
    },
    execute: async (args: { config: Record<string, any> }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { config: true },
      });
      const currentConfig = (project?.config as Record<string, any>) ?? {};
      const merged = { ...currentConfig, ...args.config };
      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: { config: merged },
      });
      return { success: true, message: '配置已保存' };
    },
  };
}

export function readStoryboard(ctx: ToolContext): Tool {
  return {
    name: 'read_storyboard',
    description: '读取当前项目的分镜数据(v2 schema,含 episodes/entities)',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async (_args: any) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      return { storyboard: project?.storyboard ?? null, message: '分镜已读取' };
    },
  };
}

// ============================================================================
// 扩展工具 - storyboard_assistant 专用
// ============================================================================

/**
 * save_shots 工具(扩展) - 支持 episodeId + mode 三种写入策略
 * - mode='replace': 覆盖该 episodeId 的全部 shots
 * - mode='append': 在该 episodeId 现有 shots 尾部追加
 * - mode='patch': 按 shots[].id 局部更新(其他 shot 不动)
 */
export function saveShotsV2(ctx: ToolContext): Tool {
  return {
    name: 'save_shots',
    description:
      '保存分镜到项目 v2 数据。episodeId 必填,mode=replace 覆盖/append 追加/patch 按 id 局部更新',
    parameters: {
      type: 'object',
      properties: {
        episodeId: {
          type: 'string',
          description: '目标剧集 ID(必填,锚定到 episodes[].episodeId)',
        },
        mode: {
          type: 'string',
          enum: ['replace', 'append', 'patch'],
          description: '写入策略:replace 覆盖/append 追加/patch 局部更新',
          default: 'replace',
        },
        shots: {
          type: 'array',
          description: '镜头数组。每个shot字段约束(★=关键):\n' +
            'id: 唯一标识\n' +
            'episodeId: 剧集ID\n' +
            'sceneId: 场次编号\n' +
            'number: 顺序号\n' +
            'dayNight: 日/夜/黄昏/黎明\n' +
            'duration: 4-15秒\n' +
            '★description: 画面描述。约束:①表演驱动:写具体可见行为与神态,近景/特写必须含眼神/目光(如"目光骤然凝住"),禁止"死眼";写"已在状态"(如"转身望向江面"),禁止"正要/准备/即将"等过渡态;②空间阻挡锁:中景及以上镜头给出主体画面位置/朝向(如"前景左侧,面向镜头,位于栈桥中段"),用左/右/前景/背景/正对/侧对/背对等可测量语言;③具体可拍:可被AI视频模型执行\n' +
            '★shotType: 景别,从[特写,近景,中景,中近景,中远景,远景,大全景,全景]选。约束:避免连续3个相同景别;开场用全景/远景,情绪高潮用特写\n' +
            '★cameraMovement: 运镜,从[固定,推,拉,摇,移,跟,升,降,推拉,环绕,航拍]选。约束:按情绪选择(缓推=沉思/紧张、急推=震惊/冲击、环绕=强调、上升=升华、手持=真实),相邻镜头避免同类型运镜\n' +
            'dialogue: 对白文本(可选)\n' +
            'monologue: 独白/旁白(可选)\n' +
            'voiceoverText: 配音文本(可选)\n' +
            'sfx: 音效数组\n' +
            'entities: 实体引用[{entityId,name,type}]\n' +
            'gridLayout: single/2grid/4grid/9grid\n' +
            '★promptText: 中文提示词(seedance风格)。约束:正向优先描述画面有什么/做什么,禁止大段负向堆叠;单镜头精炼;首帧必须含主体;用FOV度数而非mm焦段\n' +
            '★promptEn: 英文提示词(runway/kling风格)。结构与promptText一致\n' +
            'aspectRatio: 宽高比(如16:9/9:16/1:1,可选)\n' +
            'lighting: 光影设计字符串。约束:写明主光源方向+色温(如"左侧45°逆光,5500K"),禁止抽象词"柔和光线";同场景光源方向一致\n' +
            'environment: 环境描述字符串。说明地点/时间/纵深层次\n' +
            'emotion: 情绪落点。与镜头描述一致\n' +
            'transition: 转场方式(CUT/FADE_IN/DISSOLVE等)\n' +
            'referenceImageStorageKeys: 参考图storageKey数组\n' +
            'source: 来源(ai_generated/manual/ai_edited)\n' +
            'status: 状态(draft/ready/generating/error)',
          items: { type: 'object' },
        },
      },
      required: ['episodeId', 'shots'],
    },
    execute: async (args: {
      episodeId: string;
      mode?: 'replace' | 'append' | 'patch';
      shots: any[];
    }) => {
      const { episodeId, mode = 'replace', shots } = args;
      if (!episodeId) {
        throw new Error('save_shots 缺少必填参数 episodeId');
      }
      if (!Array.isArray(shots)) {
        throw new Error('save_shots.shots 必须是数组');
      }

      // 读取当前 storyboard JSON
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      const current = (project?.storyboard as any) ?? {};
      const episodes = Array.isArray(current.episodes) ? [...current.episodes] : [];
      const entities = current.entities ?? {
        characters: [],
        props: [],
        scenes: [],
      };
      const episodeIdx = episodes.findIndex((e: any) => e.episodeId === episodeId);
      const nowIso = new Date().toISOString();

      // 规范化传入的 shots:补全所有必填字段 + 强制写入 source/episodeId
      const normalizedShots = shots.map((s) => {
        const dayNight = s.dayNight ?? '日';
        const duration = s.duration ?? 5;
        const shotType = s.shotType ?? '中景';
        const cameraMovement = s.cameraMovement ?? '固定';
        const gridLayout = s.gridLayout ?? 'single';
        const emotion = s.emotion ?? '';
        const aspectRatio = s.aspectRatio ?? s.cameraParams?.aspectRatio ?? '16:9';
        const lightingStr = typeof s.lighting === 'string' ? s.lighting : (s.lighting ? `${s.lighting.keyLight ?? ''}${s.lighting.colorTemp ? ', ' + s.lighting.colorTemp : ''}` : '');
        const envStr = typeof s.environment === 'string' ? s.environment : (s.environment ? `${s.environment.location ?? ''}${s.environment.time ? ', ' + s.environment.time : ''}` : '');
        const transition = s.transition ?? s.continuity?.transition ?? 'CUT';
        return {
          id: s.id,
          episodeId,
          sceneId: s.sceneId ?? '',
          number: s.number ?? 1,
          dayNight,
          duration,
          description: s.description ?? '',
          shotType,
          cameraMovement,
          dialogue: s.dialogue ?? null,
          monologue: s.monologue ?? null,
          voiceoverText: s.voiceoverText ?? null,
          sfx: Array.isArray(s.sfx) ? s.sfx : [],
          entities: Array.isArray(s.entities) ? s.entities : [],
          gridLayout,
          promptText: s.promptText ?? '',
          promptEn: s.promptEn ?? '',
          aspectRatio,
          lighting: lightingStr,
          environment: envStr,
          emotion,
          transition,
          referenceImageStorageKeys: Array.isArray(s.referenceImageStorageKeys) ? s.referenceImageStorageKeys : [],
          source: s.source ?? 'ai_generated',
          status: s.status ?? 'ready',
          updatedAt: nowIso,
        };
      });

      if (episodeIdx === -1) {
        // 新建 episode 容器
        episodes.push({
          episodeId,
          episodeNumber: episodes.length + 1,
          title: `第 ${episodes.length + 1} 集`,
          shots: normalizedShots,
          status: normalizedShots.length > 0 ? 'partial' : 'empty',
          lastGeneratedAt: nowIso,
        });
      } else {
        const target = episodes[episodeIdx];
        const existingShots: any[] = Array.isArray(target.shots) ? target.shots : [];
        let newShots: any[];

        if (mode === 'replace') {
          newShots = normalizedShots;
        } else if (mode === 'append') {
          newShots = [...existingShots, ...normalizedShots];
        } else {
          // patch: 按 id 局部更新
          const patchMap = new Map(normalizedShots.map((s: any) => [s.id, s]));
          newShots = existingShots.map((s) => {
            const patch = patchMap.get(s.id);
            if (!patch) return s;
            return {
              ...s,
              ...patch,
              updatedAt: nowIso,
              source:
                s.source === 'ai_generated' || s.source === 'ai_edited'
                  ? 'ai_edited'
                  : s.source,
            };
          });
          // 兜底:patch 里有 id 不在 existingShots 的,直接追加
          const existingIds = new Set(existingShots.map((s: any) => s.id));
          const extras = normalizedShots.filter((s: any) => !existingIds.has(s.id));
          if (extras.length > 0) newShots.push(...extras);
        }

        episodes[episodeIdx] = {
          ...target,
          shots: newShots,
          status:
            newShots.length === 0
              ? 'empty'
              : newShots.every((s: any) => s.status === 'ready')
                ? 'complete'
                : 'partial',
          lastGeneratedAt: nowIso,
        };
      }

      const nextStoryboard = {
        ...current,
        schemaVersion: 2,
        episodes,
        entities,
        lastGeneratedAt: nowIso,
      };

      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: { storyboard: nextStoryboard },
      });

      const finalEpisode = episodes.find((e: any) => e.episodeId === episodeId);
      return {
        success: true,
        episodeId,
        mode,
        shotCount: finalEpisode?.shots?.length ?? 0,
        message: `已保存 ${finalEpisode?.shots?.length ?? 0} 个镜头到 ${episodeId}`,
      };
    },
  };
}

/**
 * validate_shots 工具 - 校验分镜格式与合规(后端兜底校验)
 *
 * 校验维度:
 * - 必填字段: id / description / sceneId / number
 * - 景别词汇表: shotType 必须在合法集合内
 * - 运镜词汇表: cameraMovement 必须在合法集合内
 * - 时长范围: duration 在 4-15 秒区间(可传 durationRange 覆盖)
 * - 实体引用: shot.entities[].entityId 必须存在于 entities(角色/道具/场景)
 * - 内容安全: description/promptText 不含暴力/血腥关键词
 *
 * 返回 { valid, issueCount, issues: [{ shotId, type, message, level }] }
 * 不修改任何数据,仅做只读校验。
 */
export function validateShots(ctx: ToolContext): Tool {
  const SHOT_TYPES = new Set([
    '特写', '近景', '中景', '中近景', '中远景', '远景', '大全景', '全景',
  ]);
  const CAMERA_MOVEMENTS = new Set([
    '固定', '推', '拉', '摇', '移', '跟', '升', '降', '推拉', '环绕', '航拍',
  ]);
  // 内容安全禁用词(暴力/血腥/恐怖)
  const SAFETY_BLOCKLIST = [
    '流血', '血液', '血', '伤口', '尖刀', '刀', '枪', '尸体', '死亡', '打斗',
    '殴打', '击打', '虐待', '恐怖', '狰狞', '爬满', '肠', '断肢', '残肢',
  ];

  return {
    name: 'validate_shots',
    description:
      '校验分镜的格式与合规性(只读,不修改数据)。检查必填字段、景别/运镜词汇表、时长范围、实体引用有效性、内容安全。返回问题列表供修正',
    parameters: {
      type: 'object',
      properties: {
        shots: {
          type: 'array',
          description: '要校验的 shot 数组',
          items: { type: 'object' },
        },
        episodeId: {
          type: 'string',
          description: '可选:目标剧集 ID(用于定位实体引用上下文)',
        },
      },
    },
    execute: async (args: { shots?: any[]; episodeId?: string }) => {
      const shots = Array.isArray(args.shots) ? args.shots : [];
      if (shots.length === 0) {
        return { valid: true, shotCount: 0, issueCount: 0, issues: [] };
      }

      // 读取 entities 用于引用校验
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      const storyboard = (project?.storyboard as any) ?? {};
      const entities = storyboard.entities ?? {
        characters: [],
        props: [],
        scenes: [],
      };
      const entityIds = new Set<string>();
      for (const arr of [
        entities.characters,
        entities.props,
        entities.scenes,
      ]) {
        for (const e of Array.isArray(arr) ? arr : []) {
          if (e?.id) entityIds.add(e.id);
        }
      }

      const issues: Array<{
        shotId: string;
        type: string;
        message: string;
        level: 'error' | 'warning';
      }> = [];

      shots.forEach((s: any, idx: number) => {
        const shotId = s?.id ?? `shot[${idx}]`;
        const push = (type: string, message: string, level: 'error' | 'warning' = 'error') =>
          issues.push({ shotId, type, message, level });

        // 必填字段
        if (!s?.id) push('missing_field', '缺少 id');
        if (!s?.description) push('missing_field', '缺少画面描述 description');
        if (!s?.sceneId) push('missing_field', '缺少场次编号 sceneId');
        if (s?.number === undefined || s?.number === null) push('missing_field', '缺少顺序号 number');

        // 景别词汇表
        if (s?.shotType && !SHOT_TYPES.has(s.shotType)) {
          push('invalid_shot_type', `景别 "${s.shotType}" 不在合法集合内(特写/近景/中景/中近景/中远景/远景/大全景/全景)`);
        }

        // 运镜词汇表
        if (s?.cameraMovement && !CAMERA_MOVEMENTS.has(s.cameraMovement)) {
          push('invalid_camera_movement', `运镜 "${s.cameraMovement}" 不在合法集合内(固定/推/拉/摇/移/跟/升/降/推拉/环绕/航拍)`);
        }

        // 时长范围
        const duration = typeof s?.duration === 'number' ? s.duration : NaN;
        if (!Number.isNaN(duration)) {
          if (duration < 4 || duration > 15) {
            push('duration_out_of_range', `时长 ${duration}s 超出合理区间(4-15秒)`, 'warning');
          }
          if (duration < 3) {
            push('duration_out_of_range', `时长 ${duration}s 过短(建议≥3秒)`, 'error');
          }
        }

        // 实体引用有效性
        if (Array.isArray(s?.entities)) {
          for (const ref of s.entities) {
            if (ref?.entityId && !entityIds.has(ref.entityId)) {
              push('invalid_entity_ref', `引用了不存在的实体 ${ref.entityId}`, 'warning');
            }
          }
        }

        // 内容安全
        const textToScan = `${s?.description ?? ''} ${s?.promptText ?? ''}`;
        const hit = SAFETY_BLOCKLIST.find((w) => textToScan.includes(w));
        if (hit) {
          push('content_safety', `检测到可能违规关键词 "${hit}",建议用抽象视觉元素替代`, 'warning');
        }

        // 表演层:近景/特写镜头应含眼部生命或神态描述(避免"死眼")
        if (s?.description && (s.shotType === '特写' || s.shotType === '近景')) {
          const eyeWords = ['眼神', '目光', '凝视', '注视', '眨眼', '眼睛', '眼帘', '眼眸', '蹙眉', '抿唇', '嘴角', '神态', '神色', '眼尾', '瞳孔'];
          if (!eyeWords.some((w) => s.description.includes(w))) {
            push('eye_life', '近景/特写镜头缺少眼部生命或神态描述(眼神/目光/神态),易产生"死眼",建议补充', 'warning');
          }
        }

        // 状态词:避免"正要/准备/即将"等过渡态,应写"已在状态"
        if (s?.description) {
          const stateWords = ['正要', '准备', '即将', '马上', '打算', '预备', '刚想'];
          const hitWord = stateWords.find((w) => s.description.includes(w));
          if (hitWord) {
            push('state_not_transition', `画面描述含过渡态词 "${hitWord}",应写"已在状态"(如"转身望向"而非"正要转身")`, 'warning');
          }
        }

        // 空间阻挡锁:中景及以上镜头应给出主体的画面位置/朝向(可测量语言)
        if (s?.description) {
          const wideShots = ['远景', '大全景', '中景', '中近景', '中远景', '全景'];
          if (wideShots.includes(s.shotType)) {
            const spatialWords = ['左', '右', '前景', '背景', '镜头', '站在', '位于', '面向', '背对', '侧对', '望向', '朝向', '画面', '前景', '中景'];
            if (!spatialWords.some((w) => s.description.includes(w))) {
              push('spatial_lock', '中景及以上镜头建议给出主体在画面中的位置/朝向(如"前景左侧,面向镜头"),便于构图', 'warning');
            }
          }
        }
      });

      return {
        valid: issues.length === 0,
        shotCount: shots.length,
        issueCount: issues.length,
        issues,
        message:
          issues.length === 0
            ? '校验通过'
            : `发现 ${issues.length} 个问题(${issues.filter((i) => i.level === 'error').length} 个错误)`,
      };
    },
  };
}

/**
 * save_entities 工具(扩展) - 三个类型分别传,全量替换对应数组
 */
export function saveEntitiesV2(ctx: ToolContext): Tool {
  return {
    name: 'save_entities',
    description:
      '保存主体清单到项目 v2 数据。characters/props/scenes 三个数组分别传(可只传其中一个,其他保留)',
    parameters: {
      type: 'object',
      properties: {
        characters: {
          type: 'array',
          description: '角色数组(全量替换)',
          items: { type: 'object' },
        },
        props: {
          type: 'array',
          description: '道具数组(全量替换)',
          items: { type: 'object' },
        },
        scenes: {
          type: 'array',
          description: '场景数组(全量替换)',
          items: { type: 'object' },
        },
      },
    },
    execute: async (args: {
      characters?: any[];
      props?: any[];
      scenes?: any[];
    }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      const current = (project?.storyboard as any) ?? {};
      const episodes = current.episodes ?? [];
      const oldEntities = current.entities ?? {
        characters: [],
        props: [],
        scenes: [],
      };

      const nextEntities = {
        characters: Array.isArray(args.characters)
          ? args.characters
          : oldEntities.characters,
        props: Array.isArray(args.props) ? args.props : oldEntities.props,
        scenes: Array.isArray(args.scenes) ? args.scenes : oldEntities.scenes,
      };

      const nowIso = new Date().toISOString();
      const nextStoryboard = {
        ...current,
        schemaVersion: 2,
        episodes,
        entities: nextEntities,
        lastGeneratedAt: nowIso,
      };

      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: { storyboard: nextStoryboard },
      });

      return {
        success: true,
        characterCount: nextEntities.characters.length,
        propCount: nextEntities.props.length,
        sceneCount: nextEntities.scenes.length,
        message: `已保存主体:角色 ${nextEntities.characters.length}/道具 ${nextEntities.props.length}/场景 ${nextEntities.scenes.length}`,
      };
    },
  };
}

/**
 * merge_entities 工具 - 合并两个主体(自动迁移所有 shot 引用)
 */
export function mergeEntities(ctx: ToolContext): Tool {
  return {
    name: 'merge_entities',
    description:
      '合并两个主体(source → target)。自动迁移所有 shot.entities 引用,合并 sameAs 列表,从对应数组中移除 source',
    parameters: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: '被合并的主体 ID(将被移除)' },
        targetId: { type: 'string', description: '保留的主体 ID(吸收 source)' },
      },
      required: ['sourceId', 'targetId'],
    },
    execute: async (args: { sourceId: string; targetId: string }) => {
      const { sourceId, targetId } = args;
      if (sourceId === targetId) {
        throw new Error('merge_entities 的 sourceId 与 targetId 不能相同');
      }

      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      const current = (project?.storyboard as any) ?? {};
      const entities = current.entities ?? {
        characters: [],
        props: [],
        scenes: [],
      };

      // 找到 source / target 所在数组
      type Located = { idx: number; item: any; array: any[] };
      const findInArray = (arr: any[]): Located | null => {
        const idx = arr.findIndex((e: any) => e?.id === targetId);
        if (idx >= 0) return { idx, item: arr[idx], array: arr };
        return null;
      };
      const findSource = (arr: any[]): Located | null => {
        const idx = arr.findIndex((e: any) => e?.id === sourceId);
        if (idx >= 0) return { idx, item: arr[idx], array: arr };
        return null;
      };

      let targetLocation: Located | null = null;
      let sourceLocation: Located | null = null;
      for (const arr of [entities.characters, entities.props, entities.scenes]) {
        if (!targetLocation) targetLocation = findInArray(arr);
        if (!sourceLocation) sourceLocation = findSource(arr);
      }
      if (!targetLocation) {
        throw new Error(`merge_entities: 找不到 targetId=${targetId} 的主体`);
      }
      if (!sourceLocation) {
        throw new Error(`merge_entities: 找不到 sourceId=${sourceId} 的主体`);
      }

      // 合并 sameAs
      const target = targetLocation.item;
      const source = sourceLocation.item;
      const mergedSameAs = Array.from(
        new Set([
          ...(Array.isArray(target.sameAs) ? target.sameAs : []),
          ...(Array.isArray(source.sameAs) ? source.sameAs : []),
          sourceId,
        ]),
      );
      const updatedTarget = {
        ...target,
        sameAs: mergedSameAs,
        updatedAt: new Date().toISOString(),
      };

      // 迁移 shot.entities 引用
      const episodes = (current.episodes ?? []).map((ep: any) => {
        const shots = (ep.shots ?? []).map((s: any) => {
          if (!Array.isArray(s.entities)) return s;
          const newRefs = s.entities.map((ref: any) =>
            ref?.entityId === sourceId
              ? { ...ref, entityId: targetId }
              : ref,
          );
          return { ...s, entities: newRefs };
        });
        return { ...ep, shots };
      });

      // 从对应数组移除 source
      const newArray = sourceLocation.array.filter(
        (_: any, idx: number) => idx !== sourceLocation!.idx,
      );
      // 更新 target 在原数组中的位置
      newArray[targetLocation.idx] = updatedTarget;

      const nextEntities = {
        characters: sourceLocation.array === entities.characters ? newArray : entities.characters,
        props: sourceLocation.array === entities.props ? newArray : entities.props,
        scenes: sourceLocation.array === entities.scenes ? newArray : entities.scenes,
      };

      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: {
          storyboard: {
            ...current,
            schemaVersion: 2,
            episodes,
            entities: nextEntities,
            lastGeneratedAt: new Date().toISOString(),
          },
        },
      });

      return {
        success: true,
        sourceId,
        targetId,
        sameAs: mergedSameAs,
        message: `已合并: ${source.name ?? sourceId} → ${target.name ?? targetId}`,
      };
    },
  };
}

/**
 * replace_entity_image 工具 - 替换主体主形象
 * 自动 refCount:旧 key -1,新 key +1(若新 key 不在 Resource 表则忽略)
 */
export function replaceEntityImage(ctx: ToolContext): Tool {
  return {
    name: 'replace_entity_image',
    description:
      '替换主体的主形象(imageStorageKey)。自动维护 refCount:旧 -1,新 +1。origin 必填(asset_picker/manual_upload/ai_generated)',
    parameters: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: '主体 ID' },
        imageStorageKey: {
          type: 'string',
          description: '新的 storageKey(必填,resources/ 前缀)',
        },
        origin: {
          type: 'string',
          enum: ['asset_picker', 'manual_upload', 'ai_generated'],
          description: '新图片来源(必填,影响审计/统计)',
        },
      },
      required: ['entityId', 'imageStorageKey', 'origin'],
    },
    execute: async (args: {
      entityId: string;
      imageStorageKey: string;
      origin: 'asset_picker' | 'manual_upload' | 'ai_generated';
    }) => {
      const { entityId, imageStorageKey, origin } = args;
      if (!imageStorageKey?.startsWith('resources/')) {
        throw new Error(
          'imageStorageKey 必须以 resources/ 开头(CAS 路径,不能是外链或 base64)',
        );
      }

      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      const current = (project?.storyboard as any) ?? {};
      const entities = current.entities ?? {
        characters: [],
        props: [],
        scenes: [],
      };

      let found = false;
      let oldKey: string | null = null;
      const newEntities = { ...entities };
      for (const key of ['characters', 'props', 'scenes'] as const) {
        newEntities[key] = entities[key].map((e: any) => {
          if (e?.id === entityId) {
            found = true;
            oldKey = e.imageStorageKey ?? null;
            return {
              ...e,
              imageStorageKey,
              status: 'image_ready',
              updatedAt: new Date().toISOString(),
            };
          }
          return e;
        });
      }
      if (!found) {
        throw new Error(`replace_entity_image: 找不到 entityId=${entityId}`);
      }

      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: {
          storyboard: {
            ...current,
            schemaVersion: 2,
            entities: newEntities,
            lastGeneratedAt: new Date().toISOString(),
          },
        },
      });

      // refCount 维护(失败不阻塞,记录日志)
      try {
        const resourceService = ctx.assetsService?.['resourceService'];
        if (resourceService) {
          if (oldKey) await resourceService.decrementRef(oldKey);
          await resourceService.incrementRef(imageStorageKey);
        }
      } catch (err) {
        toolLogger.warn(
          `replace_entity_image: refCount 维护失败(${entityId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      return {
        success: true,
        entityId,
        oldImageStorageKey: oldKey,
        newImageStorageKey: imageStorageKey,
        origin,
        message: `已更新主体主形象: ${entityId}`,
      };
    },
  };
}

/**
 * add_variant 工具 - 给主体新增衍生形象
 */
export function addVariant(ctx: ToolContext): Tool {
  return {
    name: 'add_variant',
    description: '为主体新增衍生形象(variant)。name + description 必填,imageStorageKey 可后续通过 replace_entity_image 写入',
    parameters: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: '主体 ID' },
        variant: {
          type: 'object',
          description: 'variant 对象(必填: name + description;可选: imageStorageKey/origin/detectionSource)',
        },
      },
      required: ['entityId', 'variant'],
    },
    execute: async (args: { entityId: string; variant: any }) => {
      const { entityId, variant } = args;
      if (!variant?.name) throw new Error('add_variant.variant.name 必填');

      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      const current = (project?.storyboard as any) ?? {};
      const entities = current.entities ?? {
        characters: [],
        props: [],
        scenes: [],
      };

      const nowIso = new Date().toISOString();
      const newVariant = {
        id: variant.id ?? `var-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: variant.name,
        description: variant.description ?? '',
        imageStorageKey: variant.imageStorageKey ?? null,
        detectionSource: variant.detectionSource,
        status: variant.status ?? 'draft',
        manuallyEdited: false,
        origin: variant.origin ?? 'ai_generated',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      let found = false;
      const newEntities = { ...entities };
      for (const key of ['characters', 'props', 'scenes'] as const) {
        newEntities[key] = entities[key].map((e: any) => {
          if (e?.id === entityId) {
            found = true;
            return {
              ...e,
              variants: [...(e.variants ?? []), newVariant],
              updatedAt: nowIso,
            };
          }
          return e;
        });
      }
      if (!found) throw new Error(`add_variant: 找不到 entityId=${entityId}`);

      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: {
          storyboard: {
            ...current,
            schemaVersion: 2,
            entities: newEntities,
            lastGeneratedAt: nowIso,
          },
        },
      });

      return {
        success: true,
        entityId,
        variantId: newVariant.id,
        message: `已新增衍生形象: ${variant.name}`,
      };
    },
  };
}

/**
 * remove_variant 工具 - 删除主体衍生形象
 */
export function removeVariant(ctx: ToolContext): Tool {
  return {
    name: 'remove_variant',
    description: '删除主体的衍生形象。自动 decrementRef 对应 imageStorageKey(若有)',
    parameters: {
      type: 'object',
      properties: {
        variantId: { type: 'string', description: 'variant ID' },
      },
      required: ['variantId'],
    },
    execute: async (args: { variantId: string }) => {
      const { variantId } = args;
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      const current = (project?.storyboard as any) ?? {};
      const entities = current.entities ?? {
        characters: [],
        props: [],
        scenes: [],
      };

      let removedVariant: any = null;
      let parentEntityId: string | null = null;
      const newEntities = { ...entities };
      for (const key of ['characters', 'props', 'scenes'] as const) {
        newEntities[key] = entities[key].map((e: any) => {
          const variants = Array.isArray(e.variants) ? e.variants : [];
          const target = variants.find((v: any) => v?.id === variantId);
          if (target) {
            removedVariant = target;
            parentEntityId = e.id;
            return {
              ...e,
              variants: variants.filter((v: any) => v.id !== variantId),
              updatedAt: new Date().toISOString(),
            };
          }
          return e;
        });
      }
      if (!removedVariant) {
        throw new Error(`remove_variant: 找不到 variantId=${variantId}`);
      }

      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: {
          storyboard: {
            ...current,
            schemaVersion: 2,
            entities: newEntities,
            lastGeneratedAt: new Date().toISOString(),
          },
        },
      });

      // decrementRef
      if (removedVariant.imageStorageKey) {
        try {
          const resourceService = ctx.assetsService?.['resourceService'];
          if (resourceService) {
            await resourceService.decrementRef(removedVariant.imageStorageKey);
          }
        } catch (err) {
          toolLogger.warn(
            `remove_variant: decrementRef 失败(${variantId}): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      return {
        success: true,
        variantId,
        entityId: parentEntityId,
        imageStorageKey: removedVariant.imageStorageKey,
        message: `已删除衍生形象: ${removedVariant.name ?? variantId}`,
      };
    },
  };
}

/**
 * move_variant_to_entity 工具 - 错误识别纠正(衍生图从一个主体转给另一个)
 */
export function moveVariantToEntity(ctx: ToolContext): Tool {
  return {
    name: 'move_variant_to_entity',
    description:
      '错误识别纠正:把 variant 从原 entity 转移到目标 entity。自动设置 correctedTo 字段',
    parameters: {
      type: 'object',
      properties: {
        variantId: { type: 'string', description: '要转移的 variant ID' },
        targetEntityId: { type: 'string', description: '目标 entity ID' },
      },
      required: ['variantId', 'targetEntityId'],
    },
    execute: async (args: { variantId: string; targetEntityId: string }) => {
      const { variantId, targetEntityId } = args;
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { storyboard: true },
      });
      const current = (project?.storyboard as any) ?? {};
      const entities = current.entities ?? {
        characters: [],
        props: [],
        scenes: [],
      };

      let movedVariant: any = null;
      let sourceEntityId: string | null = null;
      const newEntities = { ...entities };
      const nowIso = new Date().toISOString();

      // 1. 从原 entity 移除
      for (const key of ['characters', 'props', 'scenes'] as const) {
        newEntities[key] = entities[key].map((e: any) => {
          const variants = Array.isArray(e.variants) ? e.variants : [];
          const target = variants.find((v: any) => v?.id === variantId);
          if (target) {
            movedVariant = target;
            sourceEntityId = e.id;
            return {
              ...e,
              variants: variants.filter((v: any) => v.id !== variantId),
              updatedAt: nowIso,
            };
          }
          return e;
        });
      }
      if (!movedVariant) {
        throw new Error(`move_variant_to_entity: 找不到 variantId=${variantId}`);
      }

      // 2. 加入目标 entity,设置 correctedTo
      const updatedVariant = {
        ...movedVariant,
        correctedTo: targetEntityId,
        manuallyEdited: true,
        updatedAt: nowIso,
      };
      let targetFound = false;
      for (const key of ['characters', 'props', 'scenes'] as const) {
        newEntities[key] = newEntities[key].map((e: any) => {
          if (e?.id === targetEntityId) {
            targetFound = true;
            return {
              ...e,
              variants: [...(e.variants ?? []), updatedVariant],
              updatedAt: nowIso,
            };
          }
          return e;
        });
      }
      if (!targetFound) {
        throw new Error(
          `move_variant_to_entity: 找不到 targetEntityId=${targetEntityId}`,
        );
      }

      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: {
          storyboard: {
            ...current,
            schemaVersion: 2,
            entities: newEntities,
            lastGeneratedAt: nowIso,
          },
        },
      });

      return {
        success: true,
        variantId,
        sourceEntityId,
        targetEntityId,
        message: `已转移衍生图: ${movedVariant.name ?? variantId} → ${targetEntityId}`,
      };
    },
  };
}

/**
 * ai_image 工具(同步版) - 提交 AI 生图 + 轮询结果 + 落 Asset + 返回 storageKey
 *
 * 内部流程:
 *   1. 调用 aiGenerateService.generate 提交任务(返回 generationId)
 *   2. 每 1.5s 轮询 AiGeneration 表,直到 status ∈ {success, failed, cancelled}
 *   3. success → 读 resultAssetId → 拿 storageKey 返回
 *   4. failed/cancelled → 抛错
 *   5. timeout 5 分钟
 */
export function aiImage(ctx: ToolContext): Tool {
  return {
    name: 'ai_image',
    description:
      'AI 生成图片(同步,等待完成)。返回 { storageKey, assetId, width, height, generationId }。会自动写入 Asset 表,refCount +1。model 必填。mode=\'turnaround\' 时自动拼接角色三视图(正面/侧面/背面)提示词,生成单张并排三视图',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图片生成提示词(主体描述;mode=turnaround 时仅需给角色静态外貌描述)' },
        negativePrompt: { type: 'string', description: '反向提示词(可选)' },
        model: { type: 'string', description: '模型名,例如 gemini-3-pro-image-preview(必填)' },
        providerId: { type: 'string', description: '指定渠道 ID(可选,默认 AI 默认渠道)' },
        mode: { type: 'string', enum: ['standard', 'turnaround'], description: 'standard=单图;turnaround=角色三视图(自动拼接,单张并排,可选)' },
        aspectRatio: { type: 'string', description: '宽高比,例如 1:1 / 16:9 / 4:3(可选)' },
        size: { type: 'string', description: '尺寸,例如 1024x1024(可选)' },
        quality: { type: 'string', description: '质量,standard/hd(可选)' },
        referenceImageStorageKeys: {
          type: 'array',
          items: { type: 'string' },
          description: '参考图 storageKey 列表(图生图,可上传最多 N 张,具体看模型)',
        },
      },
      required: ['prompt', 'model'],
    },
    execute: async (args: {
      prompt: string;
      negativePrompt?: string;
      model: string;
      providerId?: string;
      mode?: 'standard' | 'turnaround';
      aspectRatio?: string;
      size?: string;
      quality?: string;
      referenceImageStorageKeys?: string[];
    }) => {
      if (!ctx.aiGenerateService) {
        throw new Error('ai_image 工具不可用:缺少 AiGenerateService 注入');
      }

      // 三视图模式:自动拼接角色三视图(正面/侧面/背面)并排提示词
      const TURNAROUND_SUFFIX =
        ', character turnaround reference sheet, three views side by side: front view (facing camera), side profile, back view, same character, same clothing and wardrobe, same hair style, same lighting angle, consistent body proportions, neutral studio background, full body, character design sheet';
      const finalPrompt =
        args.mode === 'turnaround'
          ? `${args.prompt}${TURNAROUND_SUFFIX}`
          : args.prompt;

      const params: Record<string, unknown> = {};
      if (args.aspectRatio) params.ratio = args.aspectRatio;
      if (args.size) params.size = args.size;
      if (args.quality) params.quality = args.quality;
      if (Array.isArray(args.referenceImageStorageKeys)) {
        params.referenceImages = args.referenceImageStorageKeys;
      }

      const dto: GenerateRequestDto = {
        kind: 'image',
        prompt: finalPrompt,
        negativePrompt: args.negativePrompt,
        model: args.model,
        providerId: args.providerId,
        params,
        projectId: ctx.projectId,
        tags: ['storyboard_assistant'],
      };

      const submit = await ctx.aiGenerateService.generate(ctx.userId, dto);
      const generationId = (submit as any).generationId;
      if (!generationId) {
        throw new Error('ai_image: 提交生成任务失败,未返回 generationId');
      }

      // 同步轮询结果
      const result = await pollGenerationResult(ctx.prisma, generationId, {
        timeoutMs: 5 * 60 * 1000,
        intervalMs: 1500,
        userId: ctx.userId,
      });

      if (result.status === 'failed') {
        throw new Error(`ai_image: 生成失败 - ${result.errorMessage ?? '未知错误'}`);
      }
      if (result.status === 'cancelled') {
        throw new Error('ai_image: 任务被取消');
      }
      if (!result.storageKey) {
        throw new Error('ai_image: 生成成功但未返回 storageKey');
      }

      return {
        success: true,
        generationId,
        storageKey: result.storageKey,
        assetId: result.assetId,
        width: result.width,
        height: result.height,
        message: '图片生成完成',
      };
    },
  };
}

/** ai_audio 工具(同步版) - 提交 AI 生音频 + 轮询 + 落 Asset + 返回 storageKey */
export function aiAudio(ctx: ToolContext): Tool {
  return {
    name: 'ai_audio',
    description:
      'AI 生成音频(同步,等待完成)。返回 { storageKey, assetId, duration, generationId }。会自动写入 Asset 表',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '要朗读的文本' },
        model: { type: 'string', description: '模型名,例如 speech-2.8-hd(必填)' },
        providerId: { type: 'string', description: '指定渠道 ID(可选)' },
        voiceId: { type: 'string', description: '音色 ID(可选,例如 female_温柔_中音)' },
        voiceSpeed: { type: 'number', description: '语速 0.5-2.0(可选)' },
        audioFormat: { type: 'string', description: 'mp3/wav/pcm(可选,默认 mp3)' },
      },
      required: ['prompt', 'model'],
    },
    execute: async (args: {
      prompt: string;
      model: string;
      providerId?: string;
      voiceId?: string;
      voiceSpeed?: number;
      audioFormat?: string;
    }) => {
      if (!ctx.aiGenerateService) {
        throw new Error('ai_audio 工具不可用:缺少 AiGenerateService 注入');
      }

      const params: Record<string, unknown> = {};
      if (args.voiceId) params.voice = args.voiceId;
      if (args.voiceSpeed) params.audioSpeed = args.voiceSpeed;
      if (args.audioFormat) params.audioFormat = args.audioFormat;

      const dto: GenerateRequestDto = {
        kind: 'audio',
        prompt: args.prompt,
        model: args.model,
        providerId: args.providerId,
        params,
        projectId: ctx.projectId,
        tags: ['storyboard_assistant'],
      };

      const submit = await ctx.aiGenerateService.generate(ctx.userId, dto);
      const generationId = (submit as any).generationId;
      if (!generationId) {
        throw new Error('ai_audio: 提交生成任务失败,未返回 generationId');
      }

      const result = await pollGenerationResult(ctx.prisma, generationId, {
        timeoutMs: 5 * 60 * 1000,
        intervalMs: 1500,
        userId: ctx.userId,
      });

      if (result.status === 'failed') {
        throw new Error(`ai_audio: 生成失败 - ${result.errorMessage ?? '未知错误'}`);
      }
      if (result.status === 'cancelled') {
        throw new Error('ai_audio: 任务被取消');
      }
      if (!result.storageKey) {
        throw new Error('ai_audio: 生成成功但未返回 storageKey');
      }

      return {
        success: true,
        generationId,
        storageKey: result.storageKey,
        assetId: result.assetId,
        duration: result.duration,
        message: '音频生成完成',
      };
    },
  };
}

/** list_existing_assets 工具 - 列出当前用户的素材(支持 kind/keyword 过滤) */
export function listExistingAssets(ctx: ToolContext): Tool {
  return {
    name: 'list_existing_assets',
    description: '列出当前用户已上传/AI 生成的素材,支持 kind 过滤(image/video/audio/text)与 keyword 模糊匹配',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: '过滤: image/video/audio/text(可选)' },
        keyword: { type: 'string', description: '文件名/标签模糊匹配(可选)' },
        limit: { type: 'number', description: '返回条数(默认 20,最大 100)' },
      },
    },
    execute: async (args: { kind?: string; keyword?: string; limit?: number }) => {
      if (!ctx.assetsService) {
        throw new Error('list_existing_assets 工具不可用:缺少 AssetsService 注入');
      }
      const list = await ctx.assetsService.list(
        ctx.userId,
        undefined,
        args.limit ?? 20,
        args.kind,
      );
      const items = (list.items ?? []).map((a: any) => ({
        id: a.id,
        kind: a.kind,
        filename: a.filename,
        storageKey: a.storageKey,
        mimeType: a.mimeType,
        width: a.width,
        height: a.height,
        tags: a.tags,
      }));
      // 简易 keyword 过滤
      const keyword = args.keyword?.toLowerCase().trim();
      const filtered = keyword
        ? items.filter(
            (a: any) =>
              a.filename?.toLowerCase().includes(keyword) ||
              a.tags?.some((t: string) => t.toLowerCase().includes(keyword)),
          )
        : items;
      return {
        total: filtered.length,
        items: filtered,
        message: `找到 ${filtered.length} 个素材`,
      };
    },
  };
}

// ============================================================================
// 内部辅助
// ============================================================================

interface PollOpts {
  timeoutMs: number;
  intervalMs: number;
  userId: string;
}

interface PollResult {
  status: 'success' | 'failed' | 'cancelled' | 'timeout';
  storageKey?: string;
  assetId?: string;
  width?: number;
  height?: number;
  duration?: number;
  errorMessage?: string;
}

/**
 * 同步轮询 AiGeneration 记录直到终态或超时。
 * 复用 worker 落库的 Asset + Resource 表,无副作用。
 */
async function pollGenerationResult(
  prisma: PrismaService,
  generationId: string,
  opts: PollOpts,
): Promise<PollResult> {
  const start = Date.now();
  while (Date.now() - start < opts.timeoutMs) {
    await new Promise((r) => setTimeout(r, opts.intervalMs));
    const gen = await prisma.aiGeneration.findUnique({
      where: { id: generationId },
    });
    if (!gen) {
      return { status: 'failed', errorMessage: 'AiGeneration 记录不存在' };
    }
    if (gen.status === 'success') {
      // 读 Asset 拿 storageKey
      let storageKey: string | undefined;
      let width: number | undefined;
      let height: number | undefined;
      let duration: number | undefined;
      if (gen.resultAssetId) {
        const asset = await prisma.asset.findUnique({
          where: { id: gen.resultAssetId },
        });
        if (asset) {
          storageKey = asset.storageKey;
          width = asset.width ?? undefined;
          height = asset.height ?? undefined;
          duration = asset.duration ?? undefined;
        }
      }
      return {
        status: 'success',
        storageKey,
        assetId: gen.resultAssetId ?? undefined,
        width,
        height,
        duration,
      };
    }
    if (gen.status === 'failed') {
      return { status: 'failed', errorMessage: gen.errorMessage ?? '生成失败' };
    }
    if (gen.status === 'cancelled') {
      return { status: 'cancelled' };
    }
    // pending/running 继续轮询
  }
  return { status: 'timeout', errorMessage: `轮询超时(>${opts.timeoutMs}ms)` };
}

// ============================================================================
// 工厂函数 - 按 agentType 返回对应工具集
// ============================================================================

/**
 * 基础工具集(无副作用,任何 Agent 都能用)
 */
function commonTools(ctx: ToolContext): Tool[] {
  return [
    readScript(ctx),
    saveScript(ctx),
    readProjectConfig(ctx),
    saveProjectConfig(ctx),
    readStoryboard(ctx),
  ];
}

/**
 * storyboard_assistant 专用工具集(包含全部 16 个工具)
 */
/**
 * 画布操作工具组(SSE 画布指令架构)
 *
 * 后端 Agent 通过 canvas_* 工具返回"画布操作意图" canvasOps,
 * 由前端 CanvasOpExecutor 映射为 @zeroexo/core 命令(AddNodeCommand 等)执行。
 * 这些工具不直接写 DB(数据层仍走 save_* 工具),只负责把已保存的数据在画布上呈现。
 */
export interface CanvasOp {
  op: 'add_node' | 'add_edge' | 'update_node' | 'remove_node' | 'set_selection' | 'focus' | 'workflow_chain' | 'set_config' | 'start_storyboard_generate';
  args: Record<string, unknown>;
}

/**
 * 工作链素材源引用(workflow_generate 工具输入)
 * - id/type: 画布已有节点(前端按 id 读取源节点数据创建副本)
 * - title: 供 Agent 语义引用与生成器标题命名
 */
export interface WorkflowChainSource {
  id: string;
  type: string;
  title?: string;
}

/** 工作链定义(workflow_chain canvasOp 的 args,前端展开执行) */
export interface WorkflowChainDefinition {
  sources: WorkflowChainSource[];
  targetType: string;
  prompt: string;
  generatorTitle?: string;
  generatorParams?: Record<string, unknown>;
  productTitle?: string;
  productId?: string;
}

function canvasGetState(ctx: ToolContext): Tool {
  return {
    name: 'canvas_get_state',
    description:
      '读取当前项目画布的真实状态：节点图（scene，含 id/类型/标题/内容概要）+ 分镜/主体数据统计。' +
      '仅当任务涉及画布内容时调用；返回的节点 id 是后续画布操作的唯一依据，禁止凭记忆猜节点',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async (_args: any) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { scene: true, connections: true, storyboard: true },
      });

      // 1. 画布节点图（真实画布内容的事实源，Plan#36 R2 返工：此前只读 storyboard 导致对节点"睁眼瞎"）
      const scene = Array.isArray(project?.scene) ? (project?.scene as Array<Record<string, unknown>>) : [];
      const connections = Array.isArray(project?.connections) ? (project?.connections as unknown[]) : [];
      const NODE_LIMIT = 40;
      const nodes = scene.slice(0, NODE_LIMIT).map((n) => {
        const type = typeof n?.type === 'string' ? n.type : 'unknown';
        const data = (n?.data ?? {}) as Record<string, unknown>;
        const base: Record<string, unknown> = { id: n?.id, type };
        // R2：坐标（四舍五入）+ 摘要 + Agent 生成烙印，不返回完整数据（控 token）
        const pos = n?.position as { x?: number; y?: number } | undefined;
        if (pos && typeof pos.x === 'number') {
          base.position = { x: Math.round(pos.x), y: Math.round(pos.y ?? 0) };
        }
        const title =
          typeof n?.title === 'string' && n.title
            ? n.title
            : typeof data.title === 'string' && data.title
              ? data.title
              : undefined;
        if (title) base.title = title;
        if (typeof data.agentTaskId === 'string') base.agentTaskId = data.agentTaskId;
        if (type === 'script' || type === 'text') {
          const content = typeof data.content === 'string' ? data.content : '';
          if (content) base.contentPreview = `${content.slice(0, 60)}…（共 ${content.length} 字）`;
        } else if (type === 'storyboard') {
          if (Array.isArray(data.shots)) base.shotCount = data.shots.length;
        } else if (type === 'production-manager') {
          base.itemCount = Array.isArray(data.items) ? data.items.length : 0;
        } else if (type === 'image' || type === 'video' || type === 'audio') {
          base.hasContent = Boolean(data.content || data.storageKey || data.status === 'done');
        } else if (type === 'generator') {
          if (typeof data.prompt === 'string' && data.prompt) base.promptPreview = data.prompt.slice(0, 40);
        }
        return base;
      });

      // 2. 分镜数据层统计（storyboard_assistant 写入的结构化数据）
      const st = (project?.storyboard as Record<string, unknown> | null) ?? {};
      const episodes = Array.isArray(st.episodes) ? (st.episodes as Array<Record<string, unknown>>) : [];
      const entities = (st.entities ?? {}) as Record<string, unknown>;
      const charCount = Array.isArray(entities.characters) ? entities.characters.length : 0;
      const shotCount = episodes.reduce(
        (sum: number, ep) => sum + (Array.isArray(ep.shots) ? ep.shots.length : 0),
        0,
      );

      const empty = nodes.length === 0 && episodes.length === 0;
      return {
        ok: true,
        summary: {
          nodeCount: scene.length,
          edgeCount: connections.length,
          nodes,
          truncated: scene.length > NODE_LIMIT,
          storyboard: {
            episodeCount: episodes.length,
            shotCount,
            characterCount: charCount,
            entities: {
              characters: Array.isArray(entities.characters)
                ? entities.characters.map((c) => (c as Record<string, unknown>)?.name)
                : [],
              scenes: Array.isArray(entities.scenes)
                ? entities.scenes.map((s) => (s as Record<string, unknown>)?.name)
                : [],
            },
          },
        },
        message: empty
          ? '画布确实为空（无节点、无分镜数据）'
          : `画布状态已读取：${scene.length} 个节点、${connections.length} 条连线`,
      };
    },
  };
}

function canvasAddNode(ctx: ToolContext): Tool {
  return {
    name: 'canvas_add_node',
    description:
      '在画布上创建一个节点。返回 canvasOps 由前端执行。type ∈ script/storyboard/image/video/audio/generator/text/config;可带 data(如分镜数据)',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '节点唯一 id' },
        type: { type: 'string', description: '节点类型(script/storyboard/image/video/audio/generator/text/config)' },
        position: { type: 'object', description: '画布坐标 {x,y}(可选)' },
        title: { type: 'string', description: '节点标题(可选)' },
        data: { type: 'object', description: '节点数据(可选,如分镜 shots)' },
      },
      required: ['id', 'type'],
    },
    execute: async (args: any) => {
      // R2：Agent 创建的节点打任务烙印（agentTaskId），画布状态摘要/档案库可追溯

      const data = args && typeof args.data === 'object' && args.data !== null ? { ...args.data } : {};
      if (ctx.taskId) data.agentTaskId = ctx.taskId;
      return {
        ok: true,
        message: '已请求创建画布节点',
        canvasOps: [{ op: 'add_node', args: { ...args, data } }] as CanvasOp[],
      };
    },
  };
}

function canvasAddEdge(): Tool {
  return {
    name: 'canvas_add_edge',
    description: '在画布上连接两个节点的 pin。返回 canvasOps 由前端执行',
    parameters: {
      type: 'object',
      properties: {
        edgeId: { type: 'string', description: '边唯一 id(可选)' },
        source: { type: 'object', description: '{nodeId, pinId}' },
        target: { type: 'object', description: '{nodeId, pinId}' },
      },
      required: ['source', 'target'],
    },
    execute: async (args: any) => ({
      ok: true,
      message: '已请求连接节点',
      canvasOps: [{ op: 'add_edge', args }] as CanvasOp[],
    }),
  };
}

function canvasUpdateNode(): Tool {
  return {
    name: 'canvas_update_node',
    description:
      '更新画布节点的数据(外科手术式:只改传入字段,其余保留)。返回 canvasOps 由前端执行',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '节点 id' },
        patch: { type: 'object', description: '要更新的字段(如 {title, data})' },
      },
      required: ['id', 'patch'],
    },
    execute: async (args: any) => ({
      ok: true,
      message: '已请求更新节点',
      canvasOps: [{ op: 'update_node', args }] as CanvasOp[],
    }),
  };
}

function canvasRemoveNode(): Tool {
  return {
    name: 'canvas_remove_node',
    description: '删除画布上的节点。返回 canvasOps 由前端执行',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '节点 id' },
      },
      required: ['id'],
    },
    execute: async (args: any) => ({
      ok: true,
      message: '已请求删除节点',
      canvasOps: [{ op: 'remove_node', args }] as CanvasOp[],
    }),
  };
}

function canvasSetSelection(): Tool {
  return {
    name: 'canvas_set_selection',
    description: '选中画布上的节点。返回 canvasOps 由前端执行',
    parameters: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['nodeIds'],
    },
    execute: async (args: any) => ({
      ok: true,
      message: '已请求选中节点',
      canvasOps: [{ op: 'set_selection', args }] as CanvasOp[],
    }),
  };
}

function canvasFocus(): Tool {
  return {
    name: 'canvas_focus',
    description: '聚焦/定位到画布上的某个节点。返回 canvasOps 由前端执行',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '节点 id' },
      },
      required: ['id'],
    },
    execute: async (args: any) => ({
      ok: true,
      message: '已请求聚焦节点',
      canvasOps: [{ op: 'focus', args }] as CanvasOp[],
    }),
  };
}

function canvasTools(ctx: ToolContext): Tool[] {
  return [
    canvasGetState(ctx),
    canvasAddNode(ctx),
    canvasAddEdge(),
    canvasUpdateNode(),
    canvasRemoveNode(),
    canvasSetSelection(),
    canvasFocus(),
    workflowGenerate(),
    // R2：全节点读写契约工具（读单节点 / 分镜加镜头）
    readNode(ctx),
    storyboardAddShot(ctx),
  ];
}

/**
 * read_node - 读单节点全量数据（R2：节点读写契约的读端）
 * 修改任何节点内容前必须先读，禁止凭摘要猜字段。
 */
function readNode(ctx: ToolContext): Tool {
  return {
    name: 'read_node',
    description:
      '按 id 读取单个画布节点的完整数据（返回 type/title/position/data，超长截断）。修改节点内容前必须先调用本工具，禁止凭 canvas_get_state 摘要猜字段。',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '节点 id（来自 canvas_get_state 摘要）' },
      },
      required: ['nodeId'],
    },
    execute: async (args: any) => {
      const nodeId = String(args.nodeId ?? '');
      if (!nodeId) return { ok: false, errorMessage: '缺少 nodeId' };
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { scene: true },
      });
      const scene = Array.isArray(project?.scene) ? (project?.scene as Array<Record<string, unknown>>) : [];
      const node = scene.find((n) => n?.id === nodeId);
      if (!node) {
        return { ok: false, errorMessage: `节点不存在: ${nodeId}（先用 canvas_get_state 获取真实 id）` };
      }
      const dataStr = JSON.stringify(node.data ?? {});
      const truncated = dataStr.length > 1500;
      return {
        ok: true,
        node: {
          id: node.id,
          type: node.type,
          title: node.title,
          position: node.position,
          data: truncated ? `${dataStr.slice(0, 1500)}…（共 ${dataStr.length} 字符已截断，请分块处理）` : node.data,
        },
      };
    },
  };
}

/**
 * storyboard_add_shot - 向分镜节点追加单镜头（R2：分镜写端契约）
 * 直接写库 + 发 update_node 同步前端；自动编号；批量生成请用 create_storyboard。
 */
function storyboardAddShot(ctx: ToolContext): Tool {
  return {
    name: 'storyboard_add_shot',
    description:
      '向指定分镜节点追加一个镜头（自动编号，直接写入节点 data.shots）。适用于新增/补录单镜头；整批生成请用 create_storyboard。nodeId 来自 canvas_get_state，写入前建议先 read_node 确认。',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: '分镜节点 id' },
        description: { type: 'string', description: '镜头画面描述（必填）' },
        shotType: { type: 'string', description: '景别（如 特写/近景/中景/全景）' },
        cameraMovement: { type: 'string', description: '运镜（如 推/拉/摇/移/固定）' },
        dialogue: { type: 'string', description: '对白（可选）' },
        duration: { type: 'number', description: '时长秒（默认 5）' },
      },
      required: ['nodeId', 'description'],
    },
    execute: async (args: any) => {
      const nodeId = String(args.nodeId ?? '');
      const description = String(args.description ?? '').trim();
      if (!nodeId || !description) return { ok: false, errorMessage: 'nodeId 与 description 必填' };
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { scene: true },
      });
      const scene = Array.isArray(project?.scene) ? [...(project?.scene as Array<Record<string, unknown>>)] : [];
      const idx = scene.findIndex((n) => n?.id === nodeId);
      if (idx < 0) return { ok: false, errorMessage: `分镜节点不存在: ${nodeId}（先用 canvas_get_state 获取真实 id）` };
      const node = scene[idx]!;
      if (node.type !== 'storyboard') return { ok: false, errorMessage: `节点 ${nodeId} 不是分镜节点（实际类型 ${node.type}）` };
      const data = { ...((node.data ?? {}) as Record<string, unknown>) };
      const shots = Array.isArray(data.shots) ? [...(data.shots as Array<Record<string, unknown>>)] : [];
      const shot = {
        id: `shot_${Date.now()}_${shots.length + 1}`,
        number: shots.length + 1,
        sceneId: typeof args.sceneId === 'string' ? args.sceneId : '',
        dayNight: typeof args.dayNight === 'string' ? args.dayNight : '',
        duration: typeof args.duration === 'number' ? args.duration : 5,
        description,
        shotType: typeof args.shotType === 'string' ? args.shotType : '',
        cameraMovement: typeof args.cameraMovement === 'string' ? args.cameraMovement : '',
        dialogue: typeof args.dialogue === 'string' ? args.dialogue : '',
        images: [],
        entities: [],
      };
      shots.push(shot);
      data.shots = shots;
      scene[idx] = { ...node, data };
      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: { scene: scene as unknown as Prisma.InputJsonValue },
      });
      return {
        ok: true,
        message: `已添加第 ${shot.number} 个镜头（当前共 ${shots.length} 镜）`,
        shotId: shot.id,
        canvasOps: [{ op: 'update_node', args: { id: nodeId, patch: { data: { shots } } } }] as CanvasOp[],
      };
    },
  };
}

// ============================================================================
// 全节点生成工具组（Plan#36 R2-3，canvas_agent 专属）
// ============================================================================

/**
 * create_script - 生成剧本并落画布节点（R2-3）
 *
 * 剧本内容由 LLM 基于用户素材创作（无素材时先用对话/request_upload 收集，禁止脑补），
 * 本工具负责：写入 project.script + 返回 add_node canvasOps 在画布创建剧本节点。
 */
function createScriptNode(ctx: ToolContext): Tool {
  return {
    name: 'create_script',
    description:
      '将创作好的剧本内容保存为项目剧本并在画布创建剧本节点。调用前提：已拿到用户提供的故事素材（对话/上传/画布引用）；素材缺失时禁止调用，先用对话或 request_upload 收集。content 为剧本文本，title 为剧本标题（可选）。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '剧本文本内容（完整创作结果）' },
        title: { type: 'string', description: '剧本节点标题（可选）' },
        nodeId: { type: 'string', description: '节点 id（可选，缺省由前端生成）' },
      },
      required: ['content'],
    },
    execute: async (args: any) => {
      const content = String(args.content ?? '').trim();
      if (!content) return { ok: false, errorMessage: '剧本内容(content)不能为空' };
      if (content.length > 200000) return { ok: false, errorMessage: '剧本内容超长(>20万字)，请分步处理' };
      try {
        await ctx.prisma.project.update({
          where: { id: ctx.projectId },
          data: { script: { content, updatedAt: new Date().toISOString() } },
        });
      } catch (err) {
        toolLogger.warn(`create_script 保存失败: ${(err as Error).message}`);
        return { ok: false, errorMessage: '剧本保存失败' };
      }
      return {
        ok: true,
        message: '剧本已保存并请求创建画布节点',
        summary: { charCount: content.length, preview: content.slice(0, 80) },
        canvasOps: [
          {
            op: 'add_node',
            args: {
              id: args.nodeId ? String(args.nodeId) : undefined,
              type: 'script',
              title: args.title ? String(args.title) : undefined,
              // R3-D3: 剧本节点同样打 agentTaskId 烙印（删除调皮回应可识别）
              data: { content, ...(ctx.taskId ? { agentTaskId: ctx.taskId } : {}) },
            },
          },
        ] as CanvasOp[],
      };
    },
  };
}

/**
 * create_storyboard - 创建分镜节点并触发分镜生成链路（R2-3）
 *
 * 复用既有 storyboard_generate 编排（分块/防幻觉/实体提取）：本工具只准备（建节点），
 * 实际生成由前端收到 start_storyboard_generate canvasOp 后走既有生成入口（保留骨架/进度/确认全套 UX）。
 * 无剧本时先走 create_script。
 */
function createStoryboardNode(ctx: ToolContext): Tool {
  return {
    name: 'create_storyboard',
    description:
      '为画布创建分镜节点并触发分镜生成链路（复用既有分块编排/防幻觉机制）。调用前提：项目已有剧本（先 canvas_get_state / read_script 确认；无则先 create_script）。本工具只创建节点并发起生成，不直接产出镜头数据。',
    parameters: {
      type: 'object',
      properties: {
        scriptNodeId: { type: 'string', description: '画布上剧本节点 id（可选，用于连线）' },
        nodeId: { type: 'string', description: '分镜节点 id（可选，缺省由前端生成）' },
        title: { type: 'string', description: '分镜节点标题（可选）' },
      },
    },
    execute: async (args: any) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { script: true },
      });
      const script = project?.script as { content?: string } | null;
      if (!script?.content) {
        return {
          ok: false,
          errorMessage: '项目还没有剧本，无法生成分镜。请先用 create_script 创建剧本（素材不足时先向用户收集）。',
        };
      }
      return {
        ok: true,
        message: '分镜节点创建请求已下发，前端将走既有分镜生成链路',
        canvasOps: [
          {
            op: 'add_node',
            args: {
              id: args.nodeId ? String(args.nodeId) : undefined,
              type: 'storyboard',
              title: args.title ? String(args.title) : undefined,
              // R3-D3: 分镜节点同样打 agentTaskId 烙印（删除调皮回应可识别）
              data: ctx.taskId ? { agentTaskId: ctx.taskId } : undefined,
            },
          },
          {
            op: 'start_storyboard_generate',
            args: {
              storyboardNodeId: args.nodeId ? String(args.nodeId) : undefined,
              scriptNodeId: args.scriptNodeId ? String(args.scriptNodeId) : undefined,
            },
          },
        ] as CanvasOp[],
      };
    },
  };
}

/**
 * canvas_set_config - 修改画布配置（主题色/节点样式等，R2-3）
 *
 * 字段白名单严格对齐前端 DEFAULT_CANVAS_CONFIG 契约（经验 #29）；
 * 白名单外字段直接拒绝，防止 Agent 污染未受控配置。
 */
function canvasSetConfig(): Tool {
  const WHITELIST = [
    'nodeBorderRadius', 'nodeOutlineWidth',
    'groupBackground', 'groupBorderRadius', 'groupOutlineWidth',
    'groupOutlineColor', 'groupOutlineType', 'groupOutlineOffset', 'groupOpacity',
    'pinColor', 'pinShape', 'pinSize', 'pinOpacity',
  ];
  return {
    name: 'canvas_set_config',
    description:
      '修改画布配置（用户说"调整主题色/改节点圆角/换连线样式"等时调用）。只接受白名单字段：' +
      WHITELIST.join('/') + '。返回 set_config canvasOps 由前端应用到画布配置。',
    parameters: {
      type: 'object',
      properties: {
        patch: {
          type: 'object',
          description: `要修改的配置字段（仅白名单：${WHITELIST.join('/')}），如 {pinColor:"#e94560"}`,
        },
      },
      required: ['patch'],
    },
    execute: async (args: any) => {
      const patch = args.patch && typeof args.patch === 'object' ? args.patch : {};
      const keys = Object.keys(patch);
      if (keys.length === 0) return { ok: false, errorMessage: 'patch 为空' };
      const invalid = keys.filter((k) => !WHITELIST.includes(k));
      if (invalid.length > 0) {
        return { ok: false, errorMessage: `字段不在白名单: ${invalid.join(',')}（可修改: ${WHITELIST.join('/')}）` };
      }
      return {
        ok: true,
        message: `已请求修改画布配置: ${keys.join(',')}`,
        canvasOps: [{ op: 'set_config', args: { patch } }] as CanvasOp[],
      };
    },
  };
}

/**
 * read_content_chunked - 超长内容分块定位读取（R2-5，追问"某集要改"场景）
 *
 * 禁止全量注入上下文（对齐分块防幻觉铁律，经验 #32）：
 * 按集/章节定位 + 关键词过滤 + 长度截断，只返回目标片段与结构目录。
 */
function readContentChunked(ctx: ToolContext): Tool {
  const MAX_CHARS = 6000;
  return {
    name: 'read_content_chunked',
    description:
      '分块定位读取超长剧本/分镜内容（用户追问"第 x 集/某章节要改"时使用）。' +
      '返回：全篇结构目录(episodes/chapters) + 定位到的片段内容（截断保护）。' +
      '禁止用 read_script 全量读取超长内容后再分析。',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['script', 'storyboard'], description: '读取目标：剧本 / 分镜' },
        episode: { type: 'number', description: '集数（1 基，可选）' },
        keyword: { type: 'string', description: '章节/内容关键词（可选，与 episode 二选一定位）' },
      },
      required: ['source'],
    },
    execute: async (args: any) => {
      const source = String(args.source ?? 'script');
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { script: true, storyboard: true },
      });

      if (source === 'storyboard') {
        const st = (project?.storyboard as any) ?? {};
        const episodes = Array.isArray(st.episodes) ? st.episodes : [];
        const toc = episodes.map((ep: any, i: number) => ({
          episode: ep.episodeNumber ?? i + 1,
          title: ep.title ?? '',
          shotCount: Array.isArray(ep.shots) ? ep.shots.length : 0,
        }));
        let target: any = null;
        if (typeof args.episode === 'number') {
          target = episodes.find((ep: any, i: number) => (ep.episodeNumber ?? i + 1) === args.episode) ?? null;
        } else if (args.keyword) {
          const kw = String(args.keyword);
          target = episodes.find((ep: any) => JSON.stringify(ep).includes(kw)) ?? null;
        }
        if (!target) {
          return { ok: true, toc, chunk: null, message: '未定位到目标集，请根据目录调整 episode/keyword' };
        }
        const raw = JSON.stringify(target);
        return {
          ok: true,
          toc,
          chunk: raw.length > MAX_CHARS ? `${raw.slice(0, MAX_CHARS)}\n…[已截断，共 ${raw.length} 字符]` : raw,
          truncated: raw.length > MAX_CHARS,
        };
      }

      // script
      const script = (project?.script as any) ?? null;
      const content = typeof script === 'string' ? script : script?.content ? String(script.content) : '';
      if (!content) return { ok: false, errorMessage: '项目暂无剧本内容' };
      const chapters = content.split(/\n(?=第[\d一二三四五六七八九十百]+[集章回])/).filter(Boolean);
      const toc = chapters.map((c, i) => ({ index: i + 1, head: c.slice(0, 30).replace(/\n/g, ' ') }));
      let chunk = '';
      if (typeof args.episode === 'number') {
        chunk = chapters[args.episode - 1] ?? '';
      } else if (args.keyword) {
        const kw = String(args.keyword);
        const hit = chapters.find((c) => c.includes(kw));
        chunk = hit ?? '';
        if (!hit) {
          const idx = content.indexOf(kw);
          if (idx >= 0) chunk = content.slice(Math.max(0, idx - 500), idx + MAX_CHARS - 500);
        }
      } else {
        chunk = content.slice(0, MAX_CHARS);
      }
      return {
        ok: true,
        toc,
        totalChars: content.length,
        chunk: chunk.length > MAX_CHARS ? `${chunk.slice(0, MAX_CHARS)}\n…[已截断]` : chunk,
        truncated: chunk.length > MAX_CHARS,
      };
    },
  };
}

/**
 * read_asset_content - 读取资产库文本资产内容（R3-A1 附件落库三档分流：M/L 档按需分段读取）
 *
 * 用户附件发送时前端自动落库到资产库（Asset.text 字段，纯元数据资产无存储文件）。
 * 附件 >6000 字时 AI 必须用本工具分段读取完整内容，禁止要求用户重新粘贴。
 */
function readAssetContent(ctx: ToolContext): Tool {
  const MAX_CHARS = 6000;
  return {
    name: 'read_asset_content',
    description:
      '分块读取资产库中的文本资产内容（用户附件落库后按需读取）。' +
      '返回：全文结构目录(toc，按 第x集/章 切分) + 指定片段（默认前 6000 字）。' +
      '附件预览超过 6000 字时必须用本工具分段读取完整内容，禁止要求用户重新粘贴。',
    parameters: {
      type: 'object',
      properties: {
        assetId: { type: 'string', description: '资产 ID（附件清单 [附件清单:...] 中的 assetId）' },
        offset: { type: 'number', description: '起始字符偏移（默认 0；每段建议 6000 字）' },
        keyword: { type: 'string', description: '内容关键词（可选，定位包含该词的片段）' },
      },
      required: ['assetId'],
    },
    execute: async (args: any) => {
      const assetId = String(args.assetId ?? '');
      if (!assetId) return { ok: false, errorMessage: '缺少 assetId' };
      const asset = await ctx.prisma.asset.findFirst({ where: { id: assetId, ownerId: ctx.userId } });
      if (!asset) return { ok: false, errorMessage: '资产不存在或无权访问' };
      if (asset.kind !== 'text' && asset.kind !== 'script') {
        return { ok: false, errorMessage: '该资产不是文本类资产' };
      }
      const content = asset.text ?? '';
      if (!content) return { ok: false, errorMessage: '资产内容为空' };
      // 结构目录：按 第x集/章 切分（与 read_content_chunked 同款规则）
      const chapters = content.split(/\n(?=第[\d一二三四五六七八九十百]+[集章回])/).filter(Boolean);
      const toc = chapters.map((c, i) => ({ index: i + 1, head: c.slice(0, 30).replace(/\n/g, ' ') }));
      let chunk = '';
      if (typeof args.offset === 'number' && args.offset > 0) {
        chunk = content.slice(args.offset, args.offset + MAX_CHARS);
      } else if (args.keyword) {
        const kw = String(args.keyword);
        const idx = content.indexOf(kw);
        chunk = idx >= 0 ? content.slice(Math.max(0, idx - 500), idx + MAX_CHARS - 500) : '';
      } else {
        chunk = content.slice(0, MAX_CHARS);
      }
      return {
        ok: true,
        assetId: asset.id,
        filename: asset.filename,
        totalChars: content.length,
        toc,
        offset: typeof args.offset === 'number' && args.offset > 0 ? args.offset : 0,
        chunk: chunk.length > MAX_CHARS ? `${chunk.slice(0, MAX_CHARS)}\n…[已截断]` : chunk,
        truncated: content.length > MAX_CHARS,
      };
    },
  };
}

// ============================================================================
// 工作执行链工具(Plan#33 D4)
// ============================================================================

/**
 * workflow_generate - 生成「素材源副本 + 生成器 + 产物」三段式工作执行链
 *
 * 用途: 用户 @ 引用画布素材并表达生成意图时,Agent 语义分析素材后,
 * 产出完整工作链 canvasOps(单条 workflow_chain)由前端展开执行:
 *   1. 素材源副本列(过滤 @ 生成器: 生成器不作为副本源,其内容已并入生成器自身)
 *   2. 生成器节点(含最终提示词/参数, generationMode=targetType)
 *   3. 产物节点(连入生成器 output)
 * 落点由前端 resolveWorkflowChainPosition 计算(视口中心基准 + 避让 + 聚焦)。
 */
function workflowGenerate(): Tool {
  const TARGET_TYPES = ['image', 'video', 'audio', 'text', 'script', 'storyboard'];
  const SOURCE_TYPES = ['text', 'image', 'video', 'audio', 'script', 'storyboard'];

  return {
    name: 'workflow_generate',
    description:
      '生成画布工作执行链(素材源副本 + 生成器 + 产物三段式)。用户 @ 引用画布素材并请求生成/创作时调用本工具: ' +
      'Agent 先语义分析素材(sources),产出最终提示词(prompt)与生成器参数(generatorParams),' +
      '前端自动在画布空白处落位并连线。sources 仅填非生成器素材源(文本/图片/视频/音频/剧本/分镜),' +
      '若用户 @ 引用了生成器节点,请改引其上游素材而非生成器本身。' +
      `targetType ∈ ${TARGET_TYPES.join('/')}(与生成器类型一致)。`,
    parameters: {
      type: 'object',
      properties: {
        sources: {
          type: 'array',
          description: `素材源引用(画布已有节点; 仅非生成器类型,type ∈ ${SOURCE_TYPES.join('/')})`,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '画布节点 id' },
              type: { type: 'string', description: '节点类型' },
              title: { type: 'string', description: '节点标题(可选,供命名)' },
            },
            required: ['id', 'type'],
          },
        },
        targetType: {
          type: 'string',
          description: '生成目标类型(与生成器类型一致,决定产物节点类型)',
          enum: TARGET_TYPES,
        },
        prompt: { type: 'string', description: '最终提示词(结合用户输入与素材语义组装,生成器将直接使用)' },
        generatorTitle: { type: 'string', description: '生成器节点标题(可选,缺省用「AI 生成 <targetType>」)' },
        generatorParams: {
          type: 'object',
          description: '生成器参数(可选; 如 image: {model,size,count}; storyboard: {episodes:[..],autoExtractProductionManager:true})',
        },
        productTitle: { type: 'string', description: '产物节点标题(可选)' },
        productId: { type: 'string', description: '产物节点 id(可选,缺省由前端生成)' },
      },
      required: ['sources', 'targetType', 'prompt'],
    },
    execute: async (args: any) => {
      const rawSources = Array.isArray(args.sources) ? args.sources : [];
      const sources: WorkflowChainSource[] = rawSources
        .filter((s: any) => s && typeof s.id === 'string' && typeof s.type === 'string')
        .map((s: any) => ({ id: s.id, type: s.type, title: s.title ? String(s.title) : undefined }));
      const targetType = String(args.targetType ?? 'image');

      if (sources.length === 0) {
        return { ok: false, errorMessage: 'workflow_generate 需要至少一个素材源(sources)' };
      }
      if (!TARGET_TYPES.includes(targetType)) {
        return { ok: false, errorMessage: `targetType 不合法: ${targetType}` };
      }
      // 过滤 @ 生成器: 生成器节点不作为副本源(其能力/内容已由生成器自身承载)
      const filtered = sources.filter((s) => s.type !== 'generator');
      if (filtered.length === 0) {
        return { ok: false, errorMessage: '素材源仅含生成器节点,请引用其上游素材(文本/图片/视频/音频/剧本/分镜)' };
      }

      const chain: WorkflowChainDefinition = {
        sources: filtered,
        targetType,
        prompt: String(args.prompt ?? '').trim(),
        generatorTitle: args.generatorTitle ? String(args.generatorTitle) : undefined,
        generatorParams: args.generatorParams && typeof args.generatorParams === 'object' ? args.generatorParams : undefined,
        productTitle: args.productTitle ? String(args.productTitle) : undefined,
        productId: args.productId ? String(args.productId) : undefined,
      };

      return {
        ok: true,
        message: `已生成工作执行链: ${filtered.length} 个素材源副本 → ${targetType} 生成器 → ${targetType} 产物`,
        summary: {
          sourceCount: filtered.length,
          targetType,
          generatorTitle: chain.generatorTitle,
          productTitle: chain.productTitle,
        },
        canvasOps: [{ op: 'workflow_chain', args: chain }] as unknown as CanvasOp[],
      };
    },
  };
}

/**
 * artifact_library - 生成产物档案库（Plan#36 R2-4，图书馆式）
 *
 * 每次具体生成（剧本/分镜/图/视频/文本）由 worker 自动归档；本工具供 Agent：
 * - search:   按关键词/类型检索归档（项目维度，支持跨会话引用）
 * - detail:   读取完整生成信息（输入摘要/参数/产物快照）
 * - restore:  恢复产物到画布（重建节点+写回内容，节点被删也能恢复）
 * - reproduce:以同参数复现（返回参数供对应生成工具重跑）
 * 档案与会话消息分离存储，不进对话历史注入，不污染 Agent 上下文。
 */
function artifactLibrary(ctx: ToolContext): Tool {
  const ACTIONS = ['search', 'detail', 'restore', 'reproduce'];
  return {
    name: 'artifact_library',
    description:
      '生成产物档案库（图书馆式）：用户提及历史产物（"之前生成的那个剧本/图…"）时必须先用 search 查阅再回答/恢复，支持跨会话。' +
      'search 按关键词/类型检索；detail 读取完整生成信息；restore 恢复产物到画布（节点被删也能恢复）；reproduce 以同参数复现。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ACTIONS, description: '操作类型' },
        artifactId: { type: 'string', description: '档案 id（detail/restore/reproduce 必填）' },
        keyword: { type: 'string', description: '检索关键词（search 可选，匹配输入摘要/产物摘要）' },
        nodeType: { type: 'string', description: '产物类型过滤（search 可选：script/storyboard/image/video/audio/text）' },
      },
      required: ['action'],
    },
    execute: async (args: any) => {
      const action = String(args.action ?? '');
      if (!ACTIONS.includes(action)) {
        return { ok: false, errorMessage: `action 不合法: ${action}，可选 ${ACTIONS.join('/')}` };
      }

      if (action === 'search') {
        const keyword = args.keyword ? String(args.keyword) : '';
        const items = await ctx.prisma.agentArtifact.findMany({
          where: {
            projectId: ctx.projectId,
            ...(args.nodeType ? { nodeType: String(args.nodeType) } : {}),
            ...(keyword
              ? {
                  OR: [
                    { inputSummary: { contains: keyword, mode: 'insensitive' } },
                    { summary: { contains: keyword, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: { id: true, nodeType: true, toolName: true, summary: true, nodeId: true, createdAt: true },
        });
        return { ok: true, count: items.length, items, message: items.length === 0 ? '档案库无匹配记录' : '检索完成' };
      }

      const artifactId = String(args.artifactId ?? '');
      if (!artifactId) return { ok: false, errorMessage: `${action} 需要 artifactId` };
      const record = await ctx.prisma.agentArtifact.findFirst({
        where: { id: artifactId, projectId: ctx.projectId },
      });
      if (!record) return { ok: false, errorMessage: `档案不存在或不属于当前项目: ${artifactId}` };

      if (action === 'detail') {
        return { ok: true, artifact: record };
      }

      if (action === 'restore') {
        // 重建节点：文本类写回内容快照；其他类型携带参数重建，由前端落位（视口中心契约）
        const data: Record<string, unknown> = {};
        if (record.content) data.content = record.content;
        if (record.params && typeof record.params === 'object') {
          const p = record.params as Record<string, unknown>;
          if (p.prompt) data.prompt = p.prompt;
          if (p.generatorParams) data.generatorParams = p.generatorParams;
        }
        // R3-D3: 档案恢复的节点也打烙印（删除调皮回应可识别）
        if (ctx.taskId) data.agentTaskId = ctx.taskId;
        return {
          ok: true,
          message: `已请求恢复 ${record.nodeType} 产物到画布`,
          canvasOps: [
            { op: 'add_node', args: { type: record.nodeType, title: record.summary.slice(0, 40), data } },
          ] as CanvasOp[],
        };
      }

      // reproduce
      return {
        ok: true,
        message: '复现参数已就绪：请用对应生成工具（create_script/create_storyboard/workflow_generate）以相同参数重新执行',
        artifact: { id: record.id, nodeType: record.nodeType, toolName: record.toolName, params: record.params, inputSummary: record.inputSummary },
      };
    },
  };
}

// ============================================================================
// Agent 自我升级工具(Plan#33 D6)
// ============================================================================

/**
 * agent_self_upgrade - Agent 技能自我升级(管理员专属写权限,普通用户走提案审批流)
 *
 * 动作:
 * - list:    列出技能目录树(目录 + 白名单文件),不返回内容
 * - read:    读取指定技能文件内容({ skillKey, fileName })
 * - propose: 提交升级提案(不直接生效),等待管理员在管理后台批准后写盘
 * - apply:   直接修改技能文件(仅管理员 admin/super_admin;普通用户会被拒绝并引导提案)
 *
 * 使用时机: Agent 在对话中发现自身技能缺陷/规则过时/需要补充新能力时,
 * 先 read 当前内容,再 propose(非管理员)或 apply(管理员)发起升级。
 */
function agentSelfUpgrade(ctx: ToolContext, skillService: AgentSkillService): Tool {
  const ACTIONS = ['list', 'read', 'propose', 'apply'];

  return {
    name: 'agent_self_upgrade',
    description:
      'Agent 技能自我升级工具。发现自身技能缺陷/规则过时/需补充能力时使用: ' +
      'list 列出技能与文件; read 读取文件内容; propose 提交升级提案(管理员审批后生效,适用于普通用户); ' +
      'apply 直接修改技能文件(仅管理员可用,非管理员会被拒绝)。' +
      '升级理由必须具体(缺陷描述/改进点),禁止无理由修改。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '操作类型', enum: ACTIONS },
        skillKey: { type: 'string', description: '技能目录名(如 canvas_agent / storyboard_assistant)' },
        fileName: { type: 'string', description: '技能文件名(仅 SKILL.md / SYSTEM_PROMPT.md)' },
        content: { type: 'string', description: '新文件内容(propose/apply 必填)' },
        reason: { type: 'string', description: '升级理由(propose 必填)' },
      },
      required: ['action'],
    },
    execute: async (args: any) => {
      const action = String(args.action ?? '');
      if (!ACTIONS.includes(action)) {
        return { ok: false, errorMessage: `action 不合法: ${action},可选 ${ACTIONS.join('/')}` };
      }

      if (action === 'list') {
        return { ok: true, skills: skillService.listSkills() };
      }

      const skillKey = String(args.skillKey ?? '');
      const fileName = String(args.fileName ?? '');

      if (action === 'read') {
        try {
          const file = skillService.readSkill(skillKey, fileName);
          return { ok: true, skillKey, fileName, content: file.content };
        } catch (err) {
          return { ok: false, errorMessage: (err as Error).message };
        }
      }

      if (action === 'propose') {
        const content = String(args.content ?? '');
        if (!content.trim()) return { ok: false, errorMessage: '提案内容(content)不能为空' };
        try {
          const { proposal, merged } = await skillService.createProposal(ctx.userId, {
            skillKey,
            fileName,
            content,
            reason: args.reason ? String(args.reason) : undefined,
          });
          return {
            ok: true,
            message: merged
              ? '升级提案已更新(覆盖同技能同文件的待审批提案)'
              : '升级提案已提交,等待管理员在管理后台审批后写入生效',
            proposalId: proposal.id,
            status: proposal.status,
          };
        } catch (err) {
          return { ok: false, errorMessage: (err as Error).message };
        }
      }

      // action === 'apply': 仅管理员
      if (action === 'apply') {
        let role = '';
        try {
          const user = await ctx.prisma.user.findUnique({
            where: { id: ctx.userId },
            select: { role: true },
          });
          role = user?.role ?? '';
        } catch {
          return { ok: false, errorMessage: '用户信息校验失败' };
        }
        if (role !== 'admin' && role !== 'super_admin') {
          return {
            ok: false,
            errorMessage:
              'agent_self_upgrade 的 apply 仅管理员可用。请改用 propose 提交升级提案,由管理员审批后写入。',
          };
        }
        const content = String(args.content ?? '');
        if (!content.trim()) return { ok: false, errorMessage: '内容(content)不能为空' };
        try {
          const result = skillService.writeSkill(skillKey, fileName, content);
          return { ok: true, message: '技能文件已直接更新生效', ...result };
        } catch (err) {
          return { ok: false, errorMessage: (err as Error).message };
        }
      }

      return { ok: false, errorMessage: `未处理的动作: ${action}` };
    },
  };
}

function storyboardAssistantTools(ctx: ToolContext): Tool[] {
  return [
    ...commonTools(ctx),
    saveShotsV2(ctx),
    validateShots(ctx),
    saveEntitiesV2(ctx),
    mergeEntities(ctx),
    replaceEntityImage(ctx),
    addVariant(ctx),
    removeVariant(ctx),
    moveVariantToEntity(ctx),
    aiImage(ctx),
    aiAudio(ctx),
    listExistingAssets(ctx),
    ...canvasTools(ctx),
  ];
}

/** 工厂映射(老 Agent 保留兼容) */
const legacyToolFactories: Record<
  string,
  (ctx: ToolContext) => Tool[]
> = {
  researcher: (ctx) => [...commonTools(ctx), searchWeb()],
  entity_extractor: (ctx) => [...commonTools(ctx), saveEntitiesLegacy(ctx)],
  storyboard_breaker: (ctx) => [
    ...commonTools(ctx),
    saveShotsLegacy(ctx),
    readStoryboard(ctx),
  ],
  script_writer: (ctx) => [...commonTools(ctx)],
  cinematographer: (ctx) => [
    ...commonTools(ctx),
    saveShotsLegacy(ctx),
    readStoryboard(ctx),
  ],
  grid_strategy: (ctx) => [...commonTools(ctx), readStoryboard(ctx)],
  asset_manager: (ctx) => [...commonTools(ctx), saveEntitiesLegacy(ctx)],
  script_format: (ctx) => [...commonTools(ctx)],
  script_multi_version: (ctx) => [...commonTools(ctx)],
};

/**
 * 工厂入口
 *
 * @param agentType    Agent 类型(决定返回哪些工具)
 * @param projectId   项目 ID(所有工具共享的上下文)
 * @param userId       用户 ID(扩展工具必填)
 * @param prisma       Prisma 服务
 * @param assetsService 资产服务(ai_image/ai_audio/list_existing_assets 需要)
 * @param aiGenerateService AI 生成服务(ai_image/ai_audio 需要)
 */
export function createToolsForAgentType(
  agentType: string,
  projectId: string,
  userId: string,
  prisma: PrismaService,
  assetsService?: AssetsService,
  aiGenerateService?: AiGenerateService,
  skillService?: AgentSkillService,
  /** R2：当前任务 ID（Agent 建节点打 agentTaskId 烙印） */
  taskId?: string,
): Tool[] {
  const ctx: ToolContext = {
    projectId,
    userId,
    taskId,
    prisma,
    assetsService,
    aiGenerateService,
  };

  if (agentType === 'storyboard_assistant') {
    if (!assetsService || !aiGenerateService) {
      toolLogger.warn(
        `storyboard_assistant 缺少 AssetsService/AiGenerateService 注入,部分工具将不可用`,
      );
    }
    return storyboardAssistantTools(ctx);
  }

  // canvas_agent: 画布编排助手,使用 canvasTools + commonTools + 自我升级工具
  if (agentType === 'canvas_agent') {
    if (!skillService) {
      toolLogger.warn(`canvas_agent 缺少 AgentSkillService 注入,agent_self_upgrade 工具将不可用`);
    }
    const upgradeTools = skillService ? [agentSelfUpgrade(ctx, skillService)] : [];
    return [
      ...canvasTools(ctx),
      ...commonTools(ctx),
      // R2-3/R2-5: 全节点生成 + 配置修改 + 超长内容分块读取
      createScriptNode(ctx),
      createStoryboardNode(ctx),
      canvasSetConfig(),
      readContentChunked(ctx),
      readAssetContent(ctx),
      artifactLibrary(ctx),
      ...upgradeTools,
    ];
  }

  const legacy = legacyToolFactories[agentType];
  if (legacy) {
    return legacy(ctx);
  }
  return commonTools(ctx);
}

// ===== 老工具(保留兼容,内部用 saveShotsLegacy 走 v1 旧路径) =====

function searchWeb(): Tool {
  return {
    name: 'search_web',
    description: '联网搜索,获取最新的网络信息用于事实验证和资料收集',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
      },
      required: ['query'],
    },
    execute: async (args: { query: string }) => {
      return { results: [], query: args.query, message: '联网搜索功能待集成' };
    },
  };
}

function saveShotsLegacy(ctx: ToolContext): Tool {
  return {
    name: 'save_shots',
    description: '保存分镜数据到项目(老 v1 接口,新 Agent 请用 storyboard_assistant 的 v2 save_shots)',
    parameters: {
      type: 'object',
      properties: {
        shots: { type: 'array', items: { type: 'object' } },
      },
      required: ['shots'],
    },
    execute: async (args: { shots: any[] }) => {
      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: { storyboard: args.shots },
      });
      return { success: true, shotCount: args.shots?.length ?? 0 };
    },
  };
}

function saveEntitiesLegacy(ctx: ToolContext): Tool {
  return {
    name: 'save_entities',
    description: '保存提取的实体信息到项目中(老 v1 接口)',
    parameters: {
      type: 'object',
      properties: {
        entities: { type: 'array', items: { type: 'object' } },
      },
      required: ['entities'],
    },
    execute: async (args: { entities: any[] }) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { assets: true },
      });
      const currentAssets = (project?.assets as Record<string, any>) ?? {};
      currentAssets.entities = args.entities;
      await ctx.prisma.project.update({
        where: { id: ctx.projectId },
        data: { assets: currentAssets },
      });
      return { success: true, entityCount: args.entities?.length ?? 0 };
    },
  };
}
