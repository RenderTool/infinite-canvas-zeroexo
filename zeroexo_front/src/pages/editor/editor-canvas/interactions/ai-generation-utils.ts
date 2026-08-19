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

/** 分镜生成提示词：指导 AI 将剧本拆解为专业分镜镜头 JSON(融入表演层/空间阻挡锁/景别多样性/提示词质量) */
export const STORYBOARD_GENERATE_PRESET = `你是一名资深电影导演+分镜师。请根据以下剧本内容，将其拆解为专业分镜镜头，并只输出一个 JSON 数组。

剧本内容：
{script}

要求：
1. 每个镜头对应一个对象，字段严格如下：
{
  "sceneId": "场景编号，如 1-1",
  "dayNight": "日" 或 "夜" 或 "黄昏" 或 "黎明",
  "duration": 镜头时长秒数（数字，通常 3 至 8 之间，按信息量合理分配）,
  "description": "画面描述，必须符合以下专业要求：
     ① 表演驱动：写具体可见的行为与神态；近景/特写必须含眼神/目光/神态（如'目光骤然凝住'），避免'死眼'；写'已在状态'（如'转身望向江面'），禁止'正要/准备/即将/马上'等过渡态；
     ② 空间阻挡锁：中景及以上镜头给出主体在画面中的位置与朝向（如'前景左侧，面向镜头，位于栈桥中段'），用左/右/前/背景/正对/背对等可测量语言；
     ③ 具体可拍：描述可被 AI 视频模型执行的画面，避免空洞形容词",
  "shotType": "景别，从[特写, 近景, 中景, 中近景, 中远景, 远景, 大全景, 全景]中选一个",
  "cameraMovement": "运镜，从[固定, 推, 拉, 摇, 移, 跟, 升, 降, 推拉, 环绕, 航拍]中选一个",
  "dialogue": "本镜头出现的对白（无则为空字符串）",
  "voiceoverText": "本镜头的旁白（无则为空字符串）",
  "monologue": "本镜头的内心独白（无则为空字符串）",
  "sfx": ["音效数组，如: 雨声, 脚步声；无则为[]"],
  "entities": [{"name": "画面中的主体名", "type": "character|scene|prop"}],
  "lighting": { "mood": "光影氛围，写明主光源方向+色温，如'左侧45°侧逆光,5500K'" },
  "environment": { "location": "场景地点" },
  "emotion": "本镜头的情绪基调",
  "prompt": "本镜头的生图/生视频提示词：正向描述画面里有什么/做什么，含主体、动作、镜头、光影、情绪，精炼不臃肿"
}
2. 严格按剧本叙事顺序生成镜头，覆盖剧本全部关键情节，不要遗漏。
3. 景别必须有变化，避免连续 3 个以上相同景别（防止视觉疲劳）。
4. 只输出 JSON 数组本身，不要输出任何解释、注释或 Markdown 代码块标记。`;

/** 调用 AI 生成分镜镜头列表(支持流式进度回调) */
export async function generateStoryboardShots(
  provider: any,
  scriptText: string,
  signal?: AbortSignal,
  onProgress?: (pct: number) => void,
  providerId?: string,
  model?: string,
): Promise<Shot[]> {
  const prompt = STORYBOARD_GENERATE_PRESET.replace('{script}', scriptText);
  let accLen = 0;
  const textModel = model || 'gpt-4o';
  console.log('[generateStoryboardShots] calling generateText with:', { providerId, model: textModel, promptLength: prompt.length });
  const text = await provider.generateText({ prompt, model: textModel, providerId, signal, params: { maxTokens: 16384 } }, (delta: string) => {
    accLen += delta.length;
    if (onProgress) onProgress(accLen);
  });
  console.log('[generateStoryboardShots] generateText returned, length:', text?.length, 'text preview:', text?.substring(0, 200));
  const jsonMatch = /\[\s*\{[\s\S]*\}\s*\]/.exec(text);
  const raw = jsonMatch ? jsonMatch[0] : text;
  if (!raw || !raw.trim()) {
    console.error('[generateStoryboardShots] AI returned empty text, providerId:', providerId, 'model:', textModel);
    throw new Error(i18n.t('editor.noStoryboardReturned'));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(i18n.t('editor.invalidStoryboardRetry'));
  }
  if (!Array.isArray(parsed)) throw new Error(i18n.t('editor.invalidStoryboardData'));
  return parsed.map((s, i) => {
    const lighting = (s.lighting ?? {}) as Record<string, unknown>;
    const environment = (s.environment ?? {}) as Record<string, unknown>;
    const sfxRaw = s.sfx;
    return {
      id: `shot-${Date.now()}-${i + 1}`,
      number: i + 1,
      sceneId: String(s.sceneId ?? `1-${i + 1}`),
      dayNight: String(s.dayNight ?? '日'),
      duration: Number(s.duration) || 5,
      description: String(s.description ?? ''),
      shotType: String(s.shotType ?? '中景'),
      cameraMovement: String(s.cameraMovement ?? '固定'),
      dialogue: String(s.dialogue ?? ''),
      voiceoverText: String(s.voiceoverText ?? ''),
      monologue: String(s.monologue ?? ''),
      sfx: Array.isArray(sfxRaw) ? sfxRaw.map(String) : (sfxRaw ? [String(sfxRaw)] : []),
      entities: Array.isArray(s.entities)
        ? s.entities.map((e: any, ei: number) => ({
            entityId: String(e?.name ? `entity_${e.name}_${ei}` : `entity_${ei}`),
            mention: String(e?.name ?? ''),
          }))
        : [],
      emotion: String(s.emotion ?? ''),
      lighting: { keyLight: '自然光', colorTemp: '5500K', mood: String(lighting.mood ?? '') },
      environment: { location: String(environment.location ?? ''), time: '午后', weather: '晴' },
      continuity: { transition: 'cut' },
      prompt: String(s.prompt ?? ''),
    } as Shot;
  });
}

/** 范文模板分镜(与剧本范文内容一致,标注 isSample 供分镜节点渲染"范文示例") */
export function buildTemplateShots(): Shot[] {
  const now = Date.now();
  const base: Array<{
    sceneId: string; duration: number; description: string; shotType: Shot['shotType'];
    cameraMovement: Shot['cameraMovement']; dialogue: string; lighting: string; location: string;
    emotion: string; sfx: string[];
  }> = [
    { sceneId: '1-1', duration: 5, description: '黄昏江边，夕阳洒在江面上泛起金色波光。男主站在栈桥尽头，望向远方。', shotType: '远景', cameraMovement: '固定', dialogue: '又到了这个时间。', lighting: '黄昏逆光，暖金色调', location: '江边栈桥', emotion: '怅惘', sfx: ['江水声', '风声'] },
    { sceneId: '1-2', duration: 4, description: '镜头推近男主面部特写，风吹动他的发丝，眼神中带着回忆。', shotType: '近景', cameraMovement: '推', dialogue: '', lighting: '侧逆光，黄昏余晖', location: '江边栈桥', emotion: '怀念', sfx: ['微风'] },
    { sceneId: '1-3', duration: 6, description: '女主从远处走来，逆光剪影，脚步轻盈。男主回头，两人四目相对。', shotType: '中景', cameraMovement: '移', dialogue: '你来了。', lighting: '逆光剪影，暖色调', location: '江边栈桥', emotion: '温暖', sfx: ['脚步声'] },
    { sceneId: '2-1', duration: 5, description: 'CUT TO 老茶馆内，木桌竹椅，茶香袅袅。两人相对而坐，端起茶碗。', shotType: '中景', cameraMovement: '固定', dialogue: '这么多年，还是这家茶馆。', lighting: '室内暖黄灯光', location: '老茶馆', emotion: '平静', sfx: ['瓷器碰撞声', '水声'] },
    { sceneId: '2-2', duration: 4, description: '男主为女主斟茶，氤氲的茶气升起，两人的手在桌边交错。', shotType: '特写', cameraMovement: '固定', dialogue: '', lighting: '暖黄侧光', location: '老茶馆', emotion: '温情', sfx: ['倒水声'] },
  ];
  return base.map((s, i) => ({
    id: `shot-${now}-${i + 1}`,
    number: i + 1,
    sceneId: s.sceneId,
    dayNight: '日',
    duration: s.duration,
    description: s.description,
    shotType: s.shotType,
    cameraMovement: s.cameraMovement,
    dialogue: s.dialogue,
    voiceoverText: '',
    monologue: '',
    sfx: s.sfx,
    entities: [],
    emotion: s.emotion,
    lighting: { keyLight: '自然光', colorTemp: '5500K', mood: s.lighting },
    environment: { location: s.location, time: '傍晚', weather: '晴' },
    continuity: { transition: 'cut' },
    prompt: '',
  }));
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