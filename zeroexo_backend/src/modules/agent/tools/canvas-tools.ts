/**
 * canvas-tools — 画布操作工具组（SSE 画布指令架构）
 *
 * 后端 Agent 通过 canvas_* 工具返回"画布操作意图" canvasOps,
 * 由前端 CanvasOpExecutor 映射为 @zeroexo/core 命令(AddNodeCommand 等)执行。
 * 这些工具不直接写 DB(数据层仍走 save_* 工具),只负责把已保存的数据在画布上呈现。
 */

import type { Prisma } from '@prisma/client';
import type { Tool, ToolContext, CanvasOp } from './tool-types';

// ============================================================================
// 画布读取
// ============================================================================

export function canvasGetState(ctx: ToolContext): Tool {
  return {
    name: 'canvas_get_state',
    description:
      '读取当前项目画布的真实状态：节点图（scene，含 id/类型/标题/内容概要）+ 分镜/主体数据统计。' +
      '仅当任务涉及画布内容时调用；返回的节点 id 是后续画布操作的唯一依据，禁止凭记忆猜节点。' +
      '**调用后必须继续：同一回合必须继续处理任务（出选项表单或直接执行），禁止仅输出画布现状就结束回合**',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async (_args: any) => {
      const project = await ctx.prisma.project.findUnique({
        where: { id: ctx.projectId },
        select: { scene: true, connections: true, storyboard: true },
      });

      const scene = Array.isArray(project?.scene) ? (project?.scene as Array<Record<string, unknown>>) : [];
      const connections = Array.isArray(project?.connections) ? (project?.connections as unknown[]) : [];
      const NODE_LIMIT = 20;
      const nodes = scene.slice(0, NODE_LIMIT).map((n) => {
        const type = typeof n?.type === 'string' ? n.type : 'unknown';
        const data = (n?.data ?? {}) as Record<string, unknown>;
        const base: Record<string, unknown> = { id: n?.id, type };
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
          if (content) base.contentPreview = `${content.slice(0, 32)}…（${content.length}字）`;
        } else if (type === 'storyboard') {
          if (Array.isArray(data.shots)) base.shotCount = data.shots.length;
        } else if (type === 'production-manager') {
          base.itemCount = Array.isArray(data.items) ? data.items.length : 0;
        } else if (type === 'image' || type === 'video' || type === 'audio') {
          base.hasContent = Boolean(data.content || data.storageKey || data.status === 'done');
        } else if (type === 'generator') {
          if (typeof data.prompt === 'string' && data.prompt) base.promptPreview = data.prompt.slice(0, 24);
        }
        return base;
      });

      const st = (project?.storyboard as Record<string, unknown> | null) ?? {};
      const episodes = Array.isArray(st.episodes) ? (st.episodes as Array<Record<string, unknown>>) : [];
      const entities = (st.entities ?? {}) as Record<string, unknown>;
      const charCount = Array.isArray(entities.characters) ? entities.characters.length : 0;
      const shotCount = episodes.reduce(
        (sum: number, ep) => sum + (Array.isArray(ep.shots) ? ep.shots.length : 0),
        0,
      );

      const empty = nodes.length === 0 && episodes.length === 0;
      const typeCounts = new Map<string, number>();
      for (const n of scene) {
        const t = typeof n?.type === 'string' ? n.type : 'unknown';
        typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
      }
      const typeSummary = [...typeCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([t, c]) => `${t}×${c}`)
        .join('、');
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
          ? '画布为空（无节点、无分镜数据）。需要我帮你创建内容吗？'
          : `画布有 ${scene.length} 个节点（${typeSummary}）、${connections.length} 条连线。${charCount > 0 ? `已识别 ${charCount} 个角色。` : ''}请告诉我你对这些节点做什么操作（修改/生成/布局/…）。`,
      };
    },
  };
}

// ============================================================================
// 画布写入（返回 canvasOps 由前端执行）
// ============================================================================

export function canvasAddNode(ctx: ToolContext): Tool {
  return {
    name: 'canvas_add_node',
    description:
      '在画布上创建一个节点。返回 canvasOps 由前端执行，**返回的 nodeId 即新节点 id**（后续 focus/update/连线一律用它）。type ∈ script/storyboard/image/video/audio/generator/text/config;可带 data(如分镜数据)',
    parameters: {
      type: 'object',
      properties: {
        // 契约(SKILL.md):禁止硬编码 ID——缺省时由后端统一生成并回传模型,
        // 前端 CanvasOpExecutor 收到非空 id 原样使用(agent-node-id-fallback.md 契约)
        id: { type: 'string', description: '节点唯一 id(可选,缺省由后端生成并在结果中回传)' },
        type: { type: 'string', description: '节点类型(script/storyboard/image/video/audio/generator/text/config)' },
        position: { type: 'object', description: '画布坐标 {x,y}(可选)' },
        title: { type: 'string', description: '节点标题(可选)' },
        data: { type: 'object', description: '节点数据(可选,如分镜 shots)' },
      },
      required: ['type'],
    },
    execute: async (args: any) => {
      const data = args && typeof args.data === 'object' && args.data !== null ? { ...args.data } : {};
      if (ctx.taskId) data.agentTaskId = ctx.taskId;
      // Plan#43 R3 修订(2026-08-25 实测：创建后拿不到 id 无法聚焦/复核，画布状态异步落库导致空转重试)：
      // id 统一后端生成并回传模型；前端执行器收到非空 id 原样使用，不会重复生成。
      const nodeId = typeof args.id === 'string' && args.id.trim()
        ? args.id
        : `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      return {
        ok: true,
        nodeId,
        message: `已请求创建画布节点（nodeId: ${nodeId}，由前端执行渲染）。注意：新节点由前端异步落库，canvas_get_state 随后一两次读不到属正常延迟——禁止因此重复创建，直接用本 nodeId 继续 focus/update，收尾向用户报告即可。`,
        canvasOps: [{ op: 'add_node', args: { ...args, id: nodeId, data } }] as CanvasOp[],
      };
    },
  };
}

export function canvasAddEdge(): Tool {
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

export function canvasUpdateNode(): Tool {
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

export function canvasRemoveNode(): Tool {
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

export function canvasSetSelection(): Tool {
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

export function canvasFocus(): Tool {
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

// ============================================================================
// 节点读写契约工具（R2）
// ============================================================================

/** read_node - 读单节点全量数据（R2：节点读写契约的读端） */
export function readNode(ctx: ToolContext): Tool {
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
      const nodeType = typeof node.type === 'string' ? node.type : 'unknown';
      const nodeTitle = typeof node.title === 'string' && node.title ? node.title : '无标题';
      return {
        ok: true,
        node: {
          id: node.id,
          type: nodeType,
          title: nodeTitle,
          position: node.position,
          data: truncated ? `${dataStr.slice(0, 1500)}…（共 ${dataStr.length} 字符已截断，请分块处理）` : node.data,
        },
        message: `已读取节点「${nodeTitle}」（${nodeType}）${
          truncated ? '，内容较长已截断，需要分块读取' : ''
        }。如需修改请告诉我具体改什么，或继续下一步操作。`,
      };
    },
  };
}

/** storyboard_add_shot - 向分镜节点追加单镜头（R2：分镜写端契约） */
export function storyboardAddShot(ctx: ToolContext): Tool {
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
// 画布工具集工厂
// ============================================================================

export function canvasTools(ctx: ToolContext): Tool[] {
  return [
    canvasGetState(ctx),
    canvasAddNode(ctx),
    canvasAddEdge(),
    canvasUpdateNode(),
    canvasRemoveNode(),
    canvasSetSelection(),
    canvasFocus(),
    readNode(ctx),
    storyboardAddShot(ctx),
  ];
}
