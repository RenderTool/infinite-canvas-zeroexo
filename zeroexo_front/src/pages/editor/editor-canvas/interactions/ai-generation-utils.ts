/**
 * AI 生成相关纯工具函数 - 无 hook 依赖
 */

import type { Shot } from '@/features/canvas-nodes/storyboard/storyboard-types.js';
import { Semaphore } from '@/utils/Semaphore.js';
import { apiPost } from '@/services/api-client.js';
import { AddNodeCommand, AddEdgeCommand, RemoveEdgeCommand, RemoveNodeCommand, UpdateNodeDataCommand, resolveNodeSize } from '@zeroexo/core';
import type { NodeRecord, NodeTypeExtension } from '@zeroexo/core';
import i18n from '@/i18n/config';

// ===== 反推提示词预设 =====
export const IMAGE_PROMPT_REVERSE_PRESET = `请根据参考图片反推一段适合用于 AI 生图的提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。
3. 尽量写成可直接用于生图模型的完整提示词。`;

/** 将 content(blob:/data:/http URL)转为 dataUrl(base64),供 AI referenceImages 使用 */
export async function contentToDataUrl(content: string): Promise<string> {
  if (content.startsWith('data:')) return content;
  if (content.startsWith('blob:')) {
    const res = await fetch(content);
    const blob = await res.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  // http(s) URL 直接返回
  return content;
}

/** 将剧本剧集 HTML 内容提取为纯文本 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}



// ===== 按集并行分镜生成 (Phase 4) =====

/** 剧集信息 */
export interface EpisodeInfo {
  id: string;
  number: number;
  title: string;
  content: string;
}

/** 单集分镜生成结果 */
export interface EpisodeShotResult {
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  shots: Shot[];
  usage?: {
    costTokens?: number;
    costMs?: number;
    model: string;
  };
  error?: string;
}

/** 按集生成进度回调 */
export interface EpisodeProgressCallback {
  /** 单集开始生成 */
  onEpisodeStart?: (episode: EpisodeInfo) => void;
  /** 单集生成完成 */
  onEpisodeComplete?: (result: EpisodeShotResult) => void;
  /** 单集生成失败 */
  onEpisodeError?: (episode: EpisodeInfo, error: string) => void;
  /** 总进度更新 (completedCount / totalCount) */
  onProgress?: (completedCount: number, totalCount: number, totalTokens: number) => void;
}

/** 按集生成配置 */
export interface GenerateByEpisodeOptions {
  /** 所有剧集 */
  episodes: EpisodeInfo[];
  /** AI 渠道 ID */
  providerId?: string;
  /** 模型名 */
  model?: string;
  /** 模板 ID（从 zeroexo-prompt 加载） */
  templateId?: string;
  /** 并发数（默认 3） */
  concurrency?: number;
  /** 取消信号 */
  signal?: AbortSignal;
  /** 进度回调 */
  callbacks?: EpisodeProgressCallback;
}

/** 后端 /api/storyboard/episode 响应类型 */
interface StoryboardEpisodeApiResponse {
  episodeNumber: number;
  episodeTitle: string;
  shots: Shot[];
  usage: {
    costTokens?: number;
    costMs?: number;
    model: string;
  };
}

/**
 * 按集并行生成分镜镜头
 *
 * 从剧本资产加载所有剧集，并发 3 集同时处理（Semaphore 控制）。
 * 每集完成 → 调用后端 API → 返回结构化结果。
 * 可取消（AbortSignal）。
 *
 * @param options 生成配置
 * @returns 所有剧集的分镜生成结果
 */
export async function generateStoryboardShotsByEpisode(
  options: GenerateByEpisodeOptions,
): Promise<EpisodeShotResult[]> {
  const {
    episodes,
    providerId,
    model,
    templateId,
    concurrency = 3,
    signal,
    callbacks,
  } = options;

  if (!episodes || episodes.length === 0) return [];

  const semaphore = new Semaphore(concurrency);
  const results: EpisodeShotResult[] = [];
  let completedCount = 0;
  let totalTokens = 0;

  const processEpisode = async (episode: EpisodeInfo): Promise<void> => {
    // 检查取消信号
    if (signal?.aborted) {
      results.push({
        episodeId: episode.id,
        episodeNumber: episode.number,
        episodeTitle: episode.title,
        shots: [],
        error: i18n.t('editor.cancelled'),
      });
      return;
    }

    callbacks?.onEpisodeStart?.(episode);

    try {
      const data = await semaphore.run(async () => {
        // 再次检查取消信号
        if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');

        const response = await apiPost<StoryboardEpisodeApiResponse>('/storyboard/episode', {
          episodeContent: episode.content,
          episodeNumber: episode.number,
          episodeTitle: episode.title,
          providerId: providerId || undefined,
          model: model || 'gpt-4o',
          templateId: templateId || undefined,
        });

        if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');

        return response;
      });

      const result: EpisodeShotResult = {
        episodeId: episode.id,
        episodeNumber: episode.number,
        episodeTitle: episode.title,
        shots: data.shots,
        usage: data.usage,
      };

      results.push(result);
      completedCount++;
      totalTokens += data.usage?.costTokens ?? 0;

      callbacks?.onEpisodeComplete?.(result);
      callbacks?.onProgress?.(completedCount, episodes.length, totalTokens);
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted) {
        results.push({
          episodeId: episode.id,
          episodeNumber: episode.number,
          episodeTitle: episode.title,
          shots: [],
          error: i18n.t('editor.cancelled'),
        });
        return;
      }

      const errorMsg = err instanceof Error ? err.message : i18n.t('nodes.generateFailed');
      results.push({
        episodeId: episode.id,
        episodeNumber: episode.number,
        episodeTitle: episode.title,
        shots: [],
        error: errorMsg,
      });
      completedCount++;

      callbacks?.onEpisodeError?.(episode, errorMsg);
      callbacks?.onProgress?.(completedCount, episodes.length, totalTokens);
    }
  };

  // 并发处理所有剧集（Semaphore 控制并发数）
  await Promise.all(episodes.map((ep) => processEpisode(ep)));

  semaphore.dispose();

  return results;
}

// ===== Plan#33 A6: 生成器提示词组装 =====

/** 提示词超限保护阈值(字符)。对齐后端 ai.scriptChunkSize(40000) 留裕量 */
export const MAX_GENERATOR_PROMPT_CHARS = 30000;

/** 连入文本源归一化结果 */
export interface GeneratorTextSource {
  nodeId: string;
  nodeType: string;
  title: string;
  content: string;
}

/**
 * 组装生成器最终提示词(Plan#33 A6,需求 6)
 *
 * 规则:
 * 1. 输入框描述(prompt)始终必追加;
 * 2. 连入文本源(text/script)作为「参考文本/小说原文」段落附加(带来源标注),
 *    文本源认定为小说附件: script 模式尽量完整携带(后端有分批拆分链路),
 *    其余模式同样携带但受 MAX_GENERATOR_PROMPT_CHARS 整体保护;
 * 3. 超限时: 优先保留输入框描述,截断附加段落并在结果标记 truncated;
 * 4. 默认只有输入框中的内容必追加,连入文本源为空时不产生任何附加。
 *
 * @returns 组装后的提示词 + 是否截断 + 实际附加的文本源数量
 */
export function assembleGeneratorPrompt(
  prompt: string,
  textSources: GeneratorTextSource[],
  opts?: { maxChars?: number },
): { prompt: string; truncated: boolean; appendedCount: number } {
  const maxChars = opts?.maxChars ?? MAX_GENERATOR_PROMPT_CHARS;
  const promptPart = prompt.trim();
  if (!textSources || textSources.length === 0) {
    return { prompt: promptPart, truncated: false, appendedCount: 0 };
  }
  const sections: string[] = [];
  let appendedCount = 0;
  for (const src of textSources) {
    const content = (src.content ?? '').trim();
    if (!content) continue;
    sections.push(`【参考文本：${src.title || src.nodeType}】\n${content}`);
    appendedCount++;
  }
  if (sections.length === 0) {
    return { prompt: promptPart, truncated: false, appendedCount: 0 };
  }

  const attachment = `\n\n${sections.join('\n\n---\n\n')}`;
  const full = promptPart + attachment;
  if (full.length <= maxChars) {
    return { prompt: full, truncated: false, appendedCount };
  }
  // 超限保护: 优先保留输入框描述,截断附件段落
  const budget = Math.max(0, maxChars - promptPart.length);
  const truncatedAttachment = attachment.slice(0, budget) + '\n\n[已截断：参考文本超长,已省略部分内容,可在生成器输入框补充要点]';
  return {
    prompt: (promptPart + truncatedAttachment).slice(0, maxChars),
    truncated: true,
    appendedCount,
  };
}

/**
 * 从图数据收集生成器的连入文本源(text/script 节点内容)
 * 过滤条件: 以 genNodeId 为 input 目标的边,源节点类型为 text/script
 */
export function collectGeneratorTextSources(
  graph: { nodes: Array<{ id: string; type: string; data?: Record<string, unknown>; title?: string }>; edges: Array<{ id: string; source: any; target: any }> },
  genNodeId: string,
): GeneratorTextSource[] {
  const sources: GeneratorTextSource[] = [];
  for (const edge of graph.edges) {
    const tgt = typeof edge.target === 'object' ? edge.target?.nodeId : edge.target;
    const pin = typeof edge.target === 'object' ? edge.target?.pinId : undefined;
    if (tgt !== genNodeId || (pin !== undefined && pin !== 'input')) continue;
    const src = typeof edge.source === 'object' ? edge.source?.nodeId : edge.source;
    const node = graph.nodes.find((n) => n.id === src);
    if (!node || !['text', 'script'].includes(node.type)) continue;
    const data = node.data ?? {};
    let content = '';
    if (node.type === 'script') {
      // 剧本: 优先收集剧集内容拼接(单集 HTML→纯文本),无剧集时回退 content 字段
      const episodes = (data.episodes as Array<{ content?: string; title?: string }> | undefined) ?? [];
      if (episodes.length > 0) {
        content = episodes
          .map((ep) => ep.content ?? '')
          .map(htmlToPlainText)
          .filter(Boolean)
          .join('\n\n');
      } else {
        content = typeof data.content === 'string' ? (data.content as string) : '';
      }
    } else {
      content = typeof data.content === 'string' ? (data.content as string) : '';
    }
    if (!content.trim()) continue;
    sources.push({
      nodeId: node.id,
      nodeType: node.type,
      title: (node.title as string) || data.title as string || node.id.slice(0, 8),
      content,
    });
  }
  return sources;
}

// ===== 占位节点替换 / 恢复工具函数 =====

/**
 * 替换占位节点为载体节点（图片/视频/音频）
 * 1. 读取占位节点的位置、尺寸、连线
 * 2. 移除占位节点及其连线
 * 3. 创建目标类型的新节点
 * 4. 重新建立连线
 * @returns 新节点 ID，或 null（失败时）
 */
export function replacePlaceholderWithNode(
  q: any,
  placeholderId: string,
  targetType: string,
  nodeData: Record<string, unknown>,
  extensions: Map<string, NodeTypeExtension>,
): string | null {
  const graph = q.getState();
  const placeholderNode = graph.nodes.find((n: any) => n.id === placeholderId);
  if (!placeholderNode) return null;

  // 收集占位节点的入边（来自生成器）和出边
  const incomingEdges = graph.edges.filter((e: any) => {
    const tgt = typeof e.target === 'object' ? e.target?.nodeId : e.target;
    return tgt === placeholderId;
  });
  const outgoingEdges = graph.edges.filter((e: any) => {
    const src = typeof e.source === 'object' ? e.source?.nodeId : e.source;
    return src === placeholderId;
  });

  // 移除占位节点及其连线
  for (const edge of [...incomingEdges, ...outgoingEdges]) {
    q.execute(new RemoveEdgeCommand(edge.id));
  }
  q.execute(new RemoveNodeCommand(placeholderId));

  // 创建新节点
  const newNodeId = `${targetType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ext = extensions.get(targetType);
  // 尺寸契约: 占位替换节点用扩展 defaultSize(未知类型走统一兜底)
  const defaultSize = resolveNodeSize({}, ext);
  q.execute(new AddNodeCommand({
    id: newNodeId,
    type: targetType,
    position: { ...placeholderNode.position },
    size: { ...defaultSize },
    title: '',
    data: { ...nodeData },
  }));

  // 重新建立入边（生成器 → 新节点）
  for (const edge of incomingEdges) {
    q.execute(new AddEdgeCommand({
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: typeof edge.source === 'object' ? edge.source : { nodeId: edge.source },
      target: { nodeId: newNodeId, pinId: 'input' },
    }));
  }
  // 重新建立出边（新节点 → 下游）
  for (const edge of outgoingEdges) {
    q.execute(new AddEdgeCommand({
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: { nodeId: newNodeId, pinId: 'output' },
      target: typeof edge.target === 'object' ? edge.target : { nodeId: edge.target },
    }));
  }

  return newNodeId;
}

/**
 * 恢复已保存的旧节点（用于分镜重新生成取消/失败时回滚）
 */
export function restoreOldNode(
  q: any,
  origNodeId: string,
  savedOldNodes: Map<string, { node: NodeRecord; edges: Array<{ id: string; source: any; target: any }> }>,
): void {
  const saved = savedOldNodes.get(origNodeId);
  if (!saved) return;
  // 移除关联的占位节点（如果有）
  const graph = q.getState();
  const placeholderNodes = graph.nodes.filter((n: any) =>
    n.type === 'ai-placeholder' &&
    (n.data as any)?.targetNodeId === origNodeId,
  );
  for (const ph of placeholderNodes) {
    const phEdges = graph.edges.filter((e: any) => {
      const src = typeof e.source === 'object' ? e.source?.nodeId : e.source;
      const tgt = typeof e.target === 'object' ? e.target?.nodeId : e.target;
      return src === ph.id || tgt === ph.id;
    });
    for (const e of phEdges) q.execute(new RemoveEdgeCommand(e.id));
    q.execute(new RemoveNodeCommand(ph.id));
  }
  // 恢复旧节点
  q.execute(new AddNodeCommand(saved.node));
  // 恢复旧边
  for (const edge of saved.edges) {
    q.execute(new AddEdgeCommand(edge));
  }
  savedOldNodes.delete(origNodeId);
}

/**
 * Plan#33 D2: 生成器切换类型时,将下游产物节点转换为新目标类型
 * - 通用字段迁移(title/prompt);类型专用字段丢弃
 * - 调用方需确保非 stacked-media / ai-placeholder
 * @returns 新节点 ID,或 null(失败/类型已匹配)
 */
export function convertTargetNodeType(
  q: any,
  targetNodeId: string,
  newType: string,
  extensions: Map<string, NodeTypeExtension>,
): string | null {
  const graph = q.getState();
  const oldNode = graph.nodes.find((n: any) => n.id === targetNodeId);
  if (!oldNode) return null;
  if (oldNode.type === newType) return oldNode.id;

  const incomingEdges = graph.edges.filter((e: any) => {
    const tgt = typeof e.target === 'object' ? e.target?.nodeId : e.target;
    return tgt === targetNodeId;
  });
  const outgoingEdges = graph.edges.filter((e: any) => {
    const src = typeof e.source === 'object' ? e.source?.nodeId : e.source;
    return src === targetNodeId;
  });
  for (const edge of [...incomingEdges, ...outgoingEdges]) {
    q.execute(new RemoveEdgeCommand(edge.id));
  }
  q.execute(new RemoveNodeCommand(targetNodeId));

  const newNodeId = `${newType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ext = extensions.get(newType);
  const defaultSize = resolveNodeSize({}, ext);
  const oldData = (oldNode.data ?? {}) as Record<string, unknown>;
  const migrated: Record<string, unknown> = {};
  if (typeof oldData.prompt === 'string') migrated.prompt = oldData.prompt;

  q.execute(new AddNodeCommand({
    id: newNodeId,
    type: newType,
    position: { ...oldNode.position },
    size: { ...defaultSize },
    title: oldNode.title ?? '',
    data: migrated,
  }));

  for (const edge of incomingEdges) {
    q.execute(new AddEdgeCommand({
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: typeof edge.source === 'object' ? edge.source : { nodeId: edge.source },
      target: { nodeId: newNodeId, pinId: 'input' },
    }));
  }
  for (const edge of outgoingEdges) {
    q.execute(new AddEdgeCommand({
      id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: { nodeId: newNodeId, pinId: 'output' },
      target: typeof edge.target === 'object' ? edge.target : { nodeId: edge.target },
    }));
  }
  return newNodeId;
}

/**
 * 保存节点配置到 node.data（统一处理 model/size/quality 等参数序列化）
 */
export function saveNodeConfig(
  q: any,
  nodeId: string,
  config: {
    model?: string;
    size?: string;
    quality?: string;
    count?: number;
    seconds?: number;
    vquality?: string;
    generateAudio?: boolean;
    watermark?: boolean;
    voice?: string;
    audioFormat?: string;
    audioSpeed?: number;
  },
): void {
  const patch: Record<string, unknown> = {};
  if (config.model !== undefined) patch.model = config.model;
  if (config.size !== undefined) patch.size = config.size;
  if (config.quality !== undefined) patch.quality = config.quality;
  if (config.count !== undefined) patch.count = config.count;
  if (config.seconds !== undefined) patch.seconds = config.seconds;
  if (config.vquality !== undefined) patch.vquality = config.vquality;
  if (config.generateAudio !== undefined) patch.generateAudio = config.generateAudio;
  if (config.watermark !== undefined) patch.watermark = config.watermark;
  if (config.voice !== undefined) patch.voice = config.voice;
  if (config.audioFormat !== undefined) patch.audioFormat = config.audioFormat;
  if (config.audioSpeed !== undefined) patch.audioSpeed = config.audioSpeed;
  if (Object.keys(patch).length > 0) {
    q.execute(new UpdateNodeDataCommand(nodeId, patch));
  }
}

// ===== 契约参数模块:模板参数组装(与 Admin 契约参数模块对齐) =====

/** provider 强类型兜底字段(模板参数缺失时使用;params 存在时后端以其为准) */
export interface TemplateProviderFallback {
  size: string;
  quality?: string;
  count?: number;
  seconds?: number;
  vquality?: string;
  generateAudio?: boolean;
  watermark?: boolean;
  voice?: string;
  format?: string;
  speed?: number;
  instructions?: string;
}

/** 不传给后端运营商的 meta/系统参数 */
const TEMPLATE_META_PARAMS = new Set([
  'referenceImagesEnabled',
  'maxReferenceImages',
  'maxReferenceVideos',
  'maxReferenceAudios',
  'referenceVideosEnabled',
  'referenceAudiosEnabled',
]);

/**
 * 从 node.data.paramValues 组装模板参数(契约参数模块)与 provider 强类型兜底字段。
 *
 * 尺寸传值策略(与 Admin use-image-generation 一致):
 * - AUTO 模式(aspectRatio='auto'):保留 resolution + aspectRatio(后端适配器据此计算尺寸),删除显式 size
 * - 非 AUTO 模式:传 size("WxH" 字符串),删除 resolution + aspectRatio
 */
export function buildTemplateParams(
  mode: 'text' | 'image' | 'video' | 'audio',
  nodeData: Record<string, unknown>,
): { params: Record<string, unknown>; fallback: TemplateProviderFallback } {
  const pv = ((nodeData.paramValues ?? {}) as Record<string, any>) ?? {};
  const filtered: Record<string, any> = {};
  for (const [k, v] of Object.entries(pv)) {
    if (v !== '' && v !== null && v !== undefined) filtered[k] = v;
  }

  // 尺寸传值策略
  const isAuto = filtered.aspectRatio === 'auto';
  if (isAuto) {
    if (filtered.size && typeof filtered.size === 'object') {
      const sz = filtered.size as { width: number; height: number };
      // AUTO 下 SizeRenderer 将 size 置为 {0,0};若有真实尺寸则转字符串兜底
      filtered.size = sz.width > 0 && sz.height > 0 ? `${sz.width}x${sz.height}` : undefined;
      if (filtered.size === undefined) delete filtered.size;
    }
  } else if (filtered.size && typeof filtered.size === 'object') {
    const sz = filtered.size as { width: number; height: number };
    filtered.size = `${sz.width}x${sz.height}`;
    delete filtered.resolution;
    delete filtered.aspectRatio;
  }

  // 清理 meta 参数
  for (const key of TEMPLATE_META_PARAMS) delete filtered[key];

  // 强类型兜底字段
  const fallback: TemplateProviderFallback = { size: '1024x1024' };
  if (mode === 'image') {
    fallback.size = (filtered.size as string) ?? '1024x1024';
    fallback.quality = (filtered.quality as string) ?? 'standard';
    fallback.count = (filtered.count as number) ?? 1;
  } else if (mode === 'video') {
    fallback.size = (filtered.size as string) ?? '1280x720';
    fallback.seconds = (filtered.seconds as number) ?? (filtered.duration as number) ?? 5;
    fallback.vquality = (filtered.vquality as string) ?? (filtered.resolution as string) ?? '720p';
    fallback.generateAudio = (filtered.generateAudio as boolean) ?? true;
    fallback.watermark = (filtered.watermark as boolean) ?? false;
  } else if (mode === 'audio') {
    fallback.voice = (filtered.voice as string) ?? 'alloy';
    fallback.format = (filtered.audioFormat as string) ?? 'mp3';
    fallback.speed = (filtered.audioSpeed as number) ?? 1;
    fallback.instructions = (filtered.audioInstructions as string) ?? undefined;
  }

  return { params: filtered, fallback };
}