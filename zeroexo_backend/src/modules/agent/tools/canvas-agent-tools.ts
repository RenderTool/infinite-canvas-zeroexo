/**
 * canvas-agent-tools — canvas_agent 专用编排工具
 *
 * 包含全节点生成、配置修改、分块读取、工作链、档案库、自我升级。
 */

import { Logger } from '@nestjs/common';
import type { Tool, ToolContext, CanvasOp, WorkflowChainSource, WorkflowChainDefinition } from './tool-types';
import { AgentSkillService } from '../agent-skill.service';

const toolLogger = new Logger('AgentTool');

// ============================================================================
// 全节点生成工具组（Plan#36 R2-3）
// ============================================================================

/** create_script - 生成剧本并落画布节点 */
export function createScriptNode(ctx: ToolContext): Tool {
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
              data: { content, ...(ctx.taskId ? { agentTaskId: ctx.taskId } : {}) },
            },
          },
        ] as CanvasOp[],
      };
    },
  };
}

/** create_storyboard - 创建分镜节点并触发分镜生成链路 */
export function createStoryboardNode(ctx: ToolContext): Tool {
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

/** canvas_set_config - 修改画布配置（白名单字段） */
export function canvasSetConfig(): Tool {
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

/** read_content_chunked - 超长内容分块定位读取 */
export function readContentChunked(ctx: ToolContext): Tool {
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

/** read_asset_content - 读取资产库文本资产内容 */
export function readAssetContent(ctx: ToolContext): Tool {
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

/** workflow_generate - 生成工作执行链（素材源副本 + 生成器 + 产物） */
export function workflowGenerate(): Tool {
  const TARGET_TYPES = ['image', 'video', 'audio', 'text', 'script', 'storyboard'];
  const SOURCE_TYPES = ['text', 'image', 'video', 'audio', 'script', 'storyboard'];

  return {
    name: 'workflow_generate',
    description:
      '生成画布工作执行链（素材源副本 → 产物节点两段式，**无生成器概念**）。用户 @ 引用画布素材并请求生成/创作时调用本工具: ' +
      'Agent 先语义分析素材(sources),产出最终提示词(prompt)与生成参数(generatorParams),' +
      '提示词/参数直接写入产物节点，用户选中产物节点即可执行生成。' +
      '前端自动在画布空白处落位并连线。sources 仅填非生成器素材源(文本/图片/视频/音频/剧本/分镜),' +
      '若用户 @ 引用了带上游的生成态节点,请改引其上游素材。' +
      `targetType ∈ ${TARGET_TYPES.join('/')}（与产物节点类型一致）。`,
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
          description: '生成参数(可选,写入产物节点; 如 image: {model,size,count}; storyboard: {episodes:[..],autoExtractProductionManager:true})',
        },
        productTitle: { type: 'string', description: '产物节点标题(可选; 不填则无标题，禁止无意义占位标题)' },
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

/** artifact_library - 生成产物档案库 */
export function artifactLibrary(ctx: ToolContext): Tool {
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
        const data: Record<string, unknown> = {};
        if (record.content) data.content = record.content;
        if (record.params && typeof record.params === 'object') {
          const p = record.params as Record<string, unknown>;
          if (p.prompt) data.prompt = p.prompt;
          if (p.generatorParams) data.generatorParams = p.generatorParams;
        }
        if (ctx.taskId) data.agentTaskId = ctx.taskId;
        return {
          ok: true,
          message: `已请求恢复 ${record.nodeType} 产物到画布`,
          canvasOps: [
            { op: 'add_node', args: { type: record.nodeType, title: record.summary.slice(0, 40), data } },
          ] as CanvasOp[],
        };
      }

      return {
        ok: true,
        message: '复现参数已就绪：请用对应生成工具（create_script/create_storyboard/workflow_generate）以相同参数重新执行',
        artifact: { id: record.id, nodeType: record.nodeType, toolName: record.toolName, params: record.params, inputSummary: record.inputSummary },
      };
    },
  };
}

/** agent_self_upgrade - Agent 技能自我升级 */
export function agentSelfUpgrade(ctx: ToolContext, skillService: AgentSkillService): Tool {
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
