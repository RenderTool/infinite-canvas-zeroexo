/**
 * storyboard-tools — 分镜数据工具（storyboard_assistant 专用）
 *
 * 包含分镜写入（save_shots）和校验（validate_shots）。
 */

import type { Tool, ToolContext } from './tool-types';

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
            '★description: 画面描述。约束:①表演驱动:写具体可见行为与神态,近景/特写必须含眼神/目光(如"目光骤然凝住"),禁止"死眼";写"已在状态"(如"转身望向江面"),禁止"正要/准备/即将"等过渡态;②空间阻挡锁:中景及以上镜头给出主体画面位置/朝向(如"前景左侧,面向镜头,位于栈桥中段"),用左/右/前景/背景/正对/侧对/背对等可测量语言;③具体可拍:可被AI视频模型执行;④动作终点态:每个动作写清结束状态(如"转身直到侧脸贴上窗边,停住"),禁止无终点动作;⑤行为非情绪:情绪写在身体上(眼神/呼吸/手),禁"他很恐惧"式贴标签\n' +
            '★shotType: 景别,从[特写,近景,中景,中近景,中远景,远景,大全景,全景]选。约束:避免连续3个相同景别;开场用全景/远景,情绪高潮用特写;相邻镜头景别至少差两档(刻意匹配除外)\n' +
            '★cameraMovement: 运镜,从[固定,推,拉,摇,移,跟,升,降,推拉,环绕,航拍]选。约束:按情绪选择(缓推=沉思/紧张、急推=震惊/冲击、环绕=强调、上升=升华、手持=真实),相邻镜头避免同类型运镜;每镜头一个主运镜,"不运镜"(固定)是合法选择;机位角度(平视/俯视/仰视)写入description\n' +
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
 */
export function validateShots(ctx: ToolContext): Tool {
  const SHOT_TYPES = new Set([
    '特写', '近景', '中景', '中近景', '中远景', '远景', '大全景', '全景',
  ]);
  const CAMERA_MOVEMENTS = new Set([
    '固定', '推', '拉', '摇', '移', '跟', '升', '降', '推拉', '环绕', '航拍',
  ]);
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

        if (!s?.id) push('missing_field', '缺少 id');
        if (!s?.description) push('missing_field', '缺少画面描述 description');
        if (!s?.sceneId) push('missing_field', '缺少场次编号 sceneId');
        if (s?.number === undefined || s?.number === null) push('missing_field', '缺少顺序号 number');

        if (s?.shotType && !SHOT_TYPES.has(s.shotType)) {
          push('invalid_shot_type', `景别 "${s.shotType}" 不在合法集合内(特写/近景/中景/中近景/中远景/远景/大全景/全景)`);
        }

        if (s?.cameraMovement && !CAMERA_MOVEMENTS.has(s.cameraMovement)) {
          push('invalid_camera_movement', `运镜 "${s.cameraMovement}" 不在合法集合内(固定/推/拉/摇/移/跟/升/降/推拉/环绕/航拍)`);
        }

        const duration = typeof s?.duration === 'number' ? s.duration : NaN;
        if (!Number.isNaN(duration)) {
          if (duration < 4 || duration > 15) {
            push('duration_out_of_range', `时长 ${duration}s 超出合理区间(4-15秒)`, 'warning');
          }
          if (duration < 3) {
            push('duration_out_of_range', `时长 ${duration}s 过短(建议≥3秒)`, 'error');
          }
        }

        if (Array.isArray(s?.entities)) {
          for (const ref of s.entities) {
            if (ref?.entityId && !entityIds.has(ref.entityId)) {
              push('invalid_entity_ref', `引用了不存在的实体 ${ref.entityId}`, 'warning');
            }
          }
        }

        const textToScan = `${s?.description ?? ''} ${s?.promptText ?? ''}`;
        const hit = SAFETY_BLOCKLIST.find((w) => textToScan.includes(w));
        if (hit) {
          push('content_safety', `检测到可能违规关键词 "${hit}",建议用抽象视觉元素替代`, 'warning');
        }

        if (s?.description && (s.shotType === '特写' || s.shotType === '近景')) {
          const eyeWords = ['眼神', '目光', '凝视', '注视', '眨眼', '眼睛', '眼帘', '眼眸', '蹙眉', '抿唇', '嘴角', '神态', '神色', '眼尾', '瞳孔'];
          if (!eyeWords.some((w) => s.description.includes(w))) {
            push('eye_life', '近景/特写镜头缺少眼部生命或神态描述(眼神/目光/神态),易产生"死眼",建议补充', 'warning');
          }
        }

        if (s?.description) {
          const stateWords = ['正要', '准备', '即将', '马上', '打算', '预备', '刚想'];
          const hitWord = stateWords.find((w) => s.description.includes(w));
          if (hitWord) {
            push('state_not_transition', `画面描述含过渡态词 "${hitWord}",应写"已在状态"(如"转身望向"而非"正要转身")`, 'warning');
          }
        }

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
