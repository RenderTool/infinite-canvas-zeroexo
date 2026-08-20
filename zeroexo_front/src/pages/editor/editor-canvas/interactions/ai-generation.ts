// TODO(拆分): 该文件超过 1000 行，计划按「状态层/交互层/渲染层」拆分，见 DESIGN.md
/**
 * useAiGeneration - AI 生成相关逻辑 hook
 *
 * 从 use-editor-interactions 提取的 AI 生成回调、事件监听和占位节点管理。
 */

import { useCallback, useRef, useEffect } from 'react';
import { AddNodeCommand, AddEdgeCommand, RemoveEdgeCommand, RemoveNodeCommand, UpdateNodeDataCommand, ResizeNodeCommand, resolveBaseWidth, resolveMinHeight } from '@zeroexo/core';
import type { NodeRecord, NodeTypeExtension } from '@zeroexo/core';
import type { ImageNodeData, VideoNodeData, AudioNodeData } from '@zeroexo/plugin-ai-provider';
import { AiError, classifyError } from '@zeroexo/plugin-ai-provider';
import type { AiErrorType } from '@zeroexo/plugin-ai-provider';
import { nodeActionBus } from '@zeroexo/plugin-nodes';
import type { GenerationMode } from '@/features/prompt-panel/components/prompt-panel';
import { modelOptionLabel } from '@/features/ai-config/use-ai-config-store.js';
import type { AiConfig } from '@/features/ai-config/use-ai-config-store.js';
import { replacePlaceholderWithNode, restoreOldNode } from './ai-generation-utils.js';
import { CanvasOpExecutor } from './canvas-op-executor.js';
import type { ResourceReference } from '@/features/prompt-panel/resource-references.js';
import { agentClient } from '@/features/agent-panel/AgentClient.js';
import i18n from '@/i18n/config';
import type { EditorRefs } from '../use-editor-state.js';

// ===== G11: 提示词拼接函数 =====

/**
 * buildPrompt - 将用户输入、引用资源和节点配置拼接为完整提示词
 *
 * 引用资源格式: @参考图1 @参考图2 @文本1
 * 节点配置: 模型、尺寸、质量等参数以注释形式附加
 *
 * @param basePrompt - 用户输入的基础提示词
 * @param references - 引用资源列表
 * @param nodeConfig - 节点配置(可选)
 * @returns 拼接后的完整提示词
 */
export function buildPrompt(
  basePrompt: string,
  references?: ResourceReference[],
  nodeConfig?: Record<string, unknown>,
): string {
  const parts: string[] = [basePrompt.trim()];

  // 附加引用资源标签
  if (references && references.length > 0) {
    const activeRefs = references.filter((r) => r.active);
    if (activeRefs.length > 0) {
      const refTags = activeRefs.map((r) => `@${r.label}`).join(' ');
      parts.push(`\n\n参考资源: ${refTags}`);
    }
  }

  // 附加节点配置参数(以注释形式)
  if (nodeConfig) {
    const configNotes: string[] = [];
    if (nodeConfig.model) configNotes.push(`model=${nodeConfig.model}`);
    if (nodeConfig.size) configNotes.push(`size=${nodeConfig.size}`);
    if (nodeConfig.quality) configNotes.push(`quality=${nodeConfig.quality}`);
    if (nodeConfig.count) configNotes.push(`count=${nodeConfig.count}`);
    if (configNotes.length > 0) {
      parts.push(`\n<!-- 配置: ${configNotes.join(', ')} -->`);
    }
  }

  return parts.join('');
}

// ===== G7: 通过 CanvasOpExecutor 添加参考资源 =====

/**
 * addReference - 通过 CanvasOpExecutor 为节点添加参考资源
 *
 * 不走直接 DOM 操作，而是通过 update_node 操作写入画布
 *
 * @param executor - CanvasOpExecutor 实例
 * @param nodeId - 目标节点 ID
 * @param newRef - 新增的参考资源
 * @param existingRefs - 现有参考资源列表
 */
export async function addReference(
  executor: CanvasOpExecutor,
  nodeId: string,
  newRef: ResourceReference,
  existingRefs: ResourceReference[],
): Promise<void> {
  const updatedRefs = [...existingRefs, newRef];
  await executor.executeOps([
    { op: 'update_node', args: { id: nodeId, patch: { references: updatedRefs } } },
  ]);
}

// ===== G16: 一键同款 - 复制节点配置到新节点 =====

/**
 * oneClickCopy - 一键同款:复制当前节点的配置到新节点
 *
 * 通过 CanvasOpExecutor 批量执行:
 * 1. 创建新节点(复制原节点的类型、尺寸、数据)
 * 2. 添加连线(原节点.output → 新节点.input)
 *
 * @param executor - CanvasOpExecutor 实例
 * @param sourceNode - 源节点
 * @param offsetX - 新节点相对于源节点的 X 偏移(默认 96)
 * @returns 新节点 ID
 */
export async function oneClickCopy(
  executor: CanvasOpExecutor,
  sourceNode: NodeRecord,
  offsetX: number = 96,
): Promise<string> {
  const newNodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sourceData = (sourceNode.data ?? {}) as Record<string, unknown>;
  const sourceSize = sourceNode.size ?? { width: 200, height: 80 };

  await executor.executeOps([
    {
      op: 'add_node',
      args: {
        id: newNodeId,
        type: sourceNode.type,
        position: {
          x: sourceNode.position.x + (sourceSize.width ?? 200) + offsetX,
          y: sourceNode.position.y,
        },
        size: { ...sourceSize },
        title: i18n.t('editor.copyNodeTitle', { title: sourceNode.title ?? '' }),
        data: { ...sourceData },
      },
    },
    {
      op: 'add_edge',
      args: {
        source: { nodeId: sourceNode.id, pinId: 'output' },
        target: { nodeId: newNodeId, pinId: 'input' },
      },
    },
  ]);

  return newNodeId;
}

/**
 * buildConnectedReferences - 从 graph 中构建连接到指定节点的引用资源列表
 *
 * 遍历所有连接到 nodeId 的源节点，将其转换为 ResourceReference 格式
 */
function buildConnectedReferences(graph: any, nodeId: string): ResourceReference[] {
  const refs: ResourceReference[] = [];
  const counts = { image: 0, video: 0, audio: 0, text: 0 };

  for (const edge of graph.edges ?? []) {
    const target = typeof edge.target === 'object' ? edge.target : { nodeId: edge.target, pinId: '' };
    if (target.nodeId !== nodeId) continue;

    const source = typeof edge.source === 'object' ? edge.source : { nodeId: edge.source, pinId: '' };
    const srcNode = graph.nodes.find((n: any) => n.id === source.nodeId);
    if (!srcNode) continue;

    const data = (srcNode.data ?? {}) as Record<string, unknown>;
    const kind = srcNode.type === 'image' ? 'image'
      : srcNode.type === 'video' ? 'video'
      : srcNode.type === 'audio' ? 'audio'
      : srcNode.type === 'text' ? 'text'
      : null;

    if (!kind) continue;

    const index = counts[kind]++;
    const label = kind === 'image'
      ? i18n.t('prompt.refImage', { n: index + 1 })
      : kind === 'video'
        ? i18n.t('prompt.refVideo', { n: index + 1 })
        : kind === 'audio'
          ? i18n.t('prompt.refAudio', { n: index + 1 })
          : i18n.t('prompt.refText', { n: index + 1 });

    refs.push({
      id: srcNode.id,
      nodeId: srcNode.id,
      kind,
      label,
      title: srcNode.title || label,
      previewUrl: data.content as string | undefined,
      text: srcNode.type === 'text' ? ((data.content ?? data.prompt) as string) : undefined,
      active: true,
    });
  }

  return refs;
}

export function useAiGeneration({
  refs,
  extensions,
  aiConfig,
  t,
  message,
  triggerAutoLayoutAndFocus,
}: {
  refs: EditorRefs;
  extensions: Map<string, NodeTypeExtension>;
  aiConfig: AiConfig;
  t: (key: string, opts?: any) => string;
  message: any;
  triggerAutoLayoutAndFocus: (newIds: string[]) => void;
}) {
  // P3.5 失败机制: 每个节点的 AbortController 映射(用户点停止时 abort)
  // 同时跟踪每个节点连续失败次数(用于达 3 次时建议检查 API KEY)
  const nodeAbortControllersRef = useRef<Map<string, any>>(new Map());
  const nodeFailureCountRef = useRef<Map<string, number>>(new Map());
  // 分镜重新生成:保存旧节点数据(用于失败/取消时恢复)
  const savedOldNodesRef = useRef<Map<string, { node: NodeRecord; edges: Array<{ id: string; source: any; target: any }> }>>(new Map());
  // 用 ref 存储 triggerAutoLayoutAndFocus 避免其作为 deps 导致无限循环渲染
  const triggerAutoLayoutAndFocusRef = useRef(triggerAutoLayoutAndFocus);
  triggerAutoLayoutAndFocusRef.current = triggerAutoLayoutAndFocus;

  const handlePromptGenerate = useCallback(
    async (nodeId: string, mode: GenerationMode, prompt: string): Promise<void> => {
      const provider = refs.aiProvider;
      if (!provider || !refs.commandQueue || !refs.store) return;
      // 取消该节点上正在进行的请求(若有)
      const prevCtl = nodeAbortControllersRef.current.get(nodeId);
      if (prevCtl) prevCtl.abort();
      const ctl = new AbortController();
      nodeAbortControllersRef.current.set(nodeId, ctl);
      // 从 graph 读取节点自身配置(支持重试非选中节点,避免依赖 selectedNodeData)
      const nodeRec = refs.store.getGraph().nodes.find((n: any) => n.id === nodeId);
      const nodeData = (nodeRec?.data ?? {}) as Partial<ImageNodeData> & Partial<VideoNodeData> & Partial<AudioNodeData>;
      const modelValue = (nodeData?.model as string) ?? '';
      const taskLabel = modelValue ? modelOptionLabel(aiConfig, modelValue) : undefined;

      // G11: 使用 buildPrompt 拼接完整提示词(包含引用资源和节点配置)
      const graph = refs.store.getGraph();
      const connectedRefs = buildConnectedReferences(graph, nodeId);
      const fullPrompt = buildPrompt(prompt, connectedRefs, nodeData as Record<string, unknown>);

      // 设置 loading + 写入 prompt + 清除旧错误 + 记录任务信息
      refs.commandQueue.execute(
        new UpdateNodeDataCommand(nodeId, {
          prompt: fullPrompt,
          status: 'loading',
          errorDetails: undefined,
          errorType: undefined,
          taskLabel,
        } as Record<string, unknown>),
      );
      try {
        if (mode === 'image') {
          const data = nodeData;
          const results = await provider.generateImage({
            prompt: fullPrompt,
            model: (data?.model as string) ?? 'gpt-4o',
            size: (data?.size as string) ?? '1024x1024',
            quality: (data?.quality as string) ?? 'standard',
            count: (data?.count as number) ?? 1,
            signal: ctl.signal,
          });
          const first = results[0];
          if (!first) throw new Error(t('nodes.noImageReturned'));
          refs.commandQueue.execute(
            new UpdateNodeDataCommand(nodeId, {
              content: first.dataUrl,
              status: 'success',
              naturalWidth: first.width,
              naturalHeight: first.height,
              mimeType: first.mimeType,
              bytes: first.bytes,
              errorDetails: undefined,
              errorType: undefined,
            } as Record<string, unknown>),
          );
          // AI 生成图片:以基准宽度为约束,按图片宽高比计算高度
          if (first.width && first.height) {
            const graph = refs.store.getGraph();
            const node = graph.nodes.find((n: NodeRecord) => n.id === nodeId);
            if (node) {
              const ext = extensions.get(node.type);
              // 尺寸契约: 基准宽度/默认高度/最小高度读节点扩展声明(Plan#11 全入口读契约)
              const baseW = resolveBaseWidth(ext);
              const minH = resolveMinHeight(ext);
              const baseH = ext?.defaultSize?.height ?? Math.round(baseW * 9 / 16);
              const ratio = first.width / first.height;
              const newW = baseW;
              const newH = Math.max(minH, Math.round(baseW / ratio));
              const oldRect = {
                x: node.position.x,
                y: node.position.y,
                width: node.size?.width ?? baseW,
                height: node.size?.height ?? baseH,
              };
              refs.commandQueue.execute(new ResizeNodeCommand(nodeId, oldRect, {
                ...oldRect,
                width: newW,
                height: newH,
              }));
            }
          }
          // 生成成功后自动按层排列
          triggerAutoLayoutAndFocusRef.current([nodeId]);
        } else if (mode === 'text') {
          const text = await provider.generateText({ prompt: fullPrompt, model: 'gpt-4o', signal: ctl.signal });
          refs.commandQueue.execute(
            new UpdateNodeDataCommand(nodeId, {
              content: text,
              status: 'success',
              errorDetails: undefined,
              errorType: undefined,
            } as Record<string, unknown>),
          );
          // 生成成功后自动按层排列
          triggerAutoLayoutAndFocusRef.current([nodeId]);
        } else if (mode === 'video') {
          const data = nodeData;
          const result = await provider.generateVideo({
            prompt: fullPrompt,
            model: (data?.model as string) ?? 'sora-2',
            size: (data?.size as string) ?? '1280x720',
            seconds: (data?.seconds as number) ?? 5,
            vquality: (data?.vquality as string) ?? 'medium',
            generateAudio: data?.generateAudio ?? true,
            watermark: data?.watermark ?? false,
            signal: ctl.signal,
          });
          const url = URL.createObjectURL(result.blob);
          refs.commandQueue.execute(
            new UpdateNodeDataCommand(nodeId, {
              content: url,
              status: 'success',
              naturalWidth: result.width,
              naturalHeight: result.height,
              durationMs: result.durationMs,
              mimeType: result.mimeType,
              bytes: result.bytes,
              errorDetails: undefined,
              errorType: undefined,
            } as Record<string, unknown>),
          );
          // AI 生成视频:以基准宽度为约束,按视频宽高比计算高度
          if (result.width && result.height) {
            const graph = refs.store.getGraph();
            const node = graph.nodes.find((n: NodeRecord) => n.id === nodeId);
            if (node) {
              const ext = extensions.get(node.type);
              // 尺寸契约: 基准宽度/默认高度/最小高度读节点扩展声明(Plan#11 全入口读契约)
              const baseW = resolveBaseWidth(ext);
              const minH = resolveMinHeight(ext);
              const baseH = ext?.defaultSize?.height ?? Math.round(baseW * 9 / 16);
              const ratio = result.width / result.height;
              const newW = baseW;
              const newH = Math.max(minH, Math.round(baseW / ratio));
              const oldRect = {
                x: node.position.x,
                y: node.position.y,
                width: node.size?.width ?? baseW,
                height: node.size?.height ?? baseH,
              };
              refs.commandQueue.execute(new ResizeNodeCommand(nodeId, oldRect, {
                ...oldRect,
                width: newW,
                height: newH,
              }));
            }
          }
          // 生成成功后自动按层排列
          triggerAutoLayoutAndFocusRef.current([nodeId]);
        } else if (mode === 'audio') {
          const data = nodeData;
          const result = await provider.generateAudio({
            prompt: fullPrompt,
            model: (data?.model as string) ?? 'tts-1',
            voice: (data?.voice as string) ?? 'alloy',
            format: (data?.audioFormat as string) ?? 'mp3',
            speed: (data?.audioSpeed as number) ?? 1,
            signal: ctl.signal,
          });
          const url = URL.createObjectURL(result.blob);
          refs.commandQueue.execute(
            new UpdateNodeDataCommand(nodeId, {
              content: url,
              status: 'success',
              durationMs: result.durationMs,
              mimeType: result.mimeType,
              bytes: result.bytes,
              errorDetails: undefined,
              errorType: undefined,
            } as Record<string, unknown>),
          );
          // 生成成功后自动按层排列
          triggerAutoLayoutAndFocusRef.current([nodeId]);
        }
        // 成功:清空失败计数
        nodeFailureCountRef.current.delete(nodeId);
      } catch (err) {
        // 用户主动取消:回到 idle,不算失败
        if (ctl.signal.aborted) {
          refs.commandQueue.execute(
            new UpdateNodeDataCommand(nodeId, {
              status: 'idle',
              errorDetails: undefined,
              errorType: undefined,
            } as Record<string, unknown>),
          );
          return;
        }
        // 错误分类
        const errorType: AiErrorType = err instanceof AiError
          ? err.errorType
          : classifyError(err);
        let message = err instanceof Error ? err.message : String(err);
        // 连续失败计数 + 提示
        const failCount = (nodeFailureCountRef.current.get(nodeId) ?? 0) + 1;
        nodeFailureCountRef.current.set(nodeId, failCount);
        if (failCount >= 3) {
          message = `${message}\n\n${t('nodes.checkApiKeyHint')}`;
        }
        refs.commandQueue.execute(
          new UpdateNodeDataCommand(nodeId, {
            status: 'error',
            errorDetails: message,
            errorType,
          } as Record<string, unknown>),
        );
      } finally {
        // 清理 AbortController(仅当仍是当前这个)
        if (nodeAbortControllersRef.current.get(nodeId) === ctl) {
          nodeAbortControllersRef.current.delete(nodeId);
        }
      }
    },
    [refs.aiProvider, refs.commandQueue, refs.store, extensions, aiConfig, t],
  );

  const handlePromptStop = useCallback(
    (nodeId: string): void => {
      // 触发 AbortController → 上游 fetch 抛 AbortError → catch 中识别为取消
      const ctl = nodeAbortControllersRef.current.get(nodeId);
      if (ctl) ctl.abort();
      // 立即切回 idle(防止 provider 重试中的延迟)
      if (refs.commandQueue) {
        refs.commandQueue.execute(
          new UpdateNodeDataCommand(nodeId, { status: 'idle' } as Record<string, unknown>),
        );
      }
    },
    [refs.commandQueue],
  );

  // nodeActionBus 事件:监听节点内重试/取消按钮,对接生成/停止逻辑
  useEffect(() => {
    const unsubRetry = nodeActionBus.on('retry', (event: { nodeId: string }) => {
      const node = refs.store?.getGraph().nodes.find((n: any) => n.id === event.nodeId);
      if (!node) return;
      const prompt = (node.data as { prompt?: string } | null)?.prompt;
      if (!prompt) return;
      const mode = (node.type === 'text' || node.type === 'image' || node.type === 'video' || node.type === 'audio'
        ? node.type
        : 'image') as GenerationMode;
      void handlePromptGenerate(node.id, mode, prompt);
    });
    const unsubCancel = nodeActionBus.on('cancel', (event: { nodeId: string }) => {
      const ctl = nodeAbortControllersRef.current.get(event.nodeId);
      if (ctl instanceof Map) {
        // 分镜节点:嵌套 Map(epKey → AbortController), abort 所有任务
        ctl.forEach((epCtl) => epCtl.abort());
        return;
      }
      handlePromptStop(event.nodeId);
    });

    // 占位节点:重试生成(仅图片/视频/剧本等非分镜类型使用,分镜已改用节点状态模式)
    const unsubPlaceholderRetry = nodeActionBus.on('ai:placeholder:retry', (event: { nodeId: string }) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      const graph = store.getGraph();
      const placeholderNode = graph.nodes.find((n: any) => n.id === event.nodeId);
      if (!placeholderNode) {
        message.warning(i18n.t('errors.NOT_FOUND'));
        return;
      }
      const phData = (placeholderNode.data ?? {}) as { generationType?: string; targetNodeType?: string };
      const generationType = phData.generationType ?? 'image';
      // 非分镜类型的重试逻辑(图片/视频/剧本等)由各类型自己的处理器处理
      if (generationType === 'storyboard') {
        message.warning(i18n.t('editor.storyboardRetryUnavailable'));
      }
      // 注:图片/视频/剧本的重试逻辑后续可在此扩展
    });

    // 占位节点:移除(同时移除其连线)
    const unsubPlaceholderRemove = nodeActionBus.on('ai:placeholder:remove', (event: { nodeId: string }) => {
      const q = refs.commandQueue;
      if (!q) return;
      const graph = q.getState();
      // 检查是否为分镜重新生成的占位节点:如果是,恢复旧节点
      const placeholderNode = graph.nodes.find((n: any) => n.id === event.nodeId);
      const phData = (placeholderNode?.data ?? {}) as { targetNodeId?: string; generationType?: string };
      if (phData.targetNodeId && phData.generationType === 'storyboard') {
        // 分镜重新生成:恢复旧节点(如果存在)
        restoreOldNode(q, phData.targetNodeId, savedOldNodesRef.current);
      } else {
        // 移除所有连接到占位节点的边
        const edges = graph.edges.filter((e: any) => {
          const src = typeof e.source === 'object' ? e.source?.nodeId : e.source;
          const tgt = typeof e.target === 'object' ? e.target?.nodeId : e.target;
          return src === event.nodeId || tgt === event.nodeId;
        });
        for (const edge of edges) {
          q.execute(new RemoveEdgeCommand(edge.id));
        }
        q.execute(new RemoveNodeCommand(event.nodeId));
      }
    });

    // 分镜重新生成:停止并恢复旧节点(点击占位节点的停止按钮时触发)
    const unsubStopRegen = nodeActionBus.on('ai:placeholder:stop-regen', (event: any) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;
      // 1. 先正确中止嵌套的 AbortController(分镜重新生成使用 Map<epKey, AbortController> 存储)
      const ctlMap = nodeAbortControllersRef.current.get(event.nodeId);
      if (ctlMap instanceof Map) {
        ctlMap.forEach((ctl) => ctl.abort());
      } else if (ctlMap && typeof ctlMap.abort === 'function') {
        ctlMap.abort();
      }
      // 2. 恢复旧节点(调用后 then/catch 的守卫会检测到占位节点已不存在)
      restoreOldNode(q, event.origNodeId, savedOldNodesRef.current);
    });

    // ==== 生成器节点:统一生成事件(generator:generate) ====
    // 通过 AgentClient 提交任务，替代直接调用 AI provider
    const unsubGeneratorGenerate = nodeActionBus.on('generator:generate', (event: any) => {
      const store = refs.store;
      const q = refs.commandQueue;
      if (!store || !q) return;

      const graph = store.getGraph();
      const genNode = graph.nodes.find((n: any) => n.id === event.nodeId);
      if (!genNode) return;
      const genData = (genNode.data ?? {}) as Record<string, unknown>;

      const generationMode = event.generationMode || 'image';
      const prompt = event.prompt || '';
      if (!prompt.trim()) return;

      const model = event.model || (genData.model as string) || 'gpt-4o';
      const size = (genData.size as string) || '';
      const quality = (genData.quality as string) || '';
      const count = (genData.count as number) ?? 1;
      const seconds = (genData.seconds as number) ?? 5;
      const vquality = (genData.vquality as string) || '';
      const generateAudio = (genData.generateAudio as boolean) ?? false;
      const watermark = (genData.watermark as boolean) ?? false;
      const voice = (genData.voice as string) || '';
      const audioFormat = (genData.audioFormat as string) || '';
      const audioSpeed = (genData.audioSpeed as number) ?? 1;

      // 确定目标载体类型
      const targetType = generationMode === 'image' ? 'image'
        : generationMode === 'video' ? 'video'
        : 'audio';

      // Step 7: 检查生成器 output 是否连线到 StackNode
      let stackTargetId: string | null = null;
      const outputEdge = graph.edges.find((e: any) => {
        const src = typeof e.source === 'object' ? e.source?.nodeId : e.source;
        return src === event.nodeId && e.source?.pinId === 'output';
      });
      if (outputEdge) {
        const tgt = typeof outputEdge.target === 'object' ? outputEdge.target?.nodeId : outputEdge.target;
        const tgtNode = graph.nodes.find((n: any) => n.id === tgt);
        if (tgtNode?.type === 'stacked-media') {
          stackTargetId = tgt!;
        }
      }

      // 创建占位节点(放置到生成器右侧)
      const placeholderId = `placeholder-${event.nodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      q.execute(new AddNodeCommand({
        id: placeholderId,
        type: 'ai-placeholder',
        position: {
          x: genNode.position.x + (genNode.size?.width ?? 340) + 48,
          y: genNode.position.y,
        },
        title: i18n.t('editor.aiGenerating'),
        data: { status: 'generating', generationType: generationMode, targetNodeType: targetType, taskLabel: model || '' },
      }));

      // 连线:生成器.output → 占位节点.input
      q.execute(new AddEdgeCommand({
        id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        source: { nodeId: event.nodeId, pinId: 'output' },
        target: { nodeId: placeholderId, pinId: 'input' },
      }));

      store.setSelection({ selectedNodeIds: new Set([placeholderId]), selectedEdgeIds: new Set() });

      // 通过 AgentClient 提交任务
      const inputPayload = {
        generationMode,
        prompt,
        model,
        size,
        quality,
        count,
        seconds,
        vquality,
        generateAudio,
        watermark,
        voice,
        audioFormat,
        audioSpeed,
        targetType,
        nodeId: event.nodeId,
      };

      const ctl = new AbortController();
      nodeAbortControllersRef.current.set(placeholderId, ctl);

      void agentClient.send('generator_generate', inputPayload)
        .then(({ taskId }) => {
          // 订阅 SSE 事件流，等待生成完成
          agentClient.subscribe(taskId, {
            onProgress: (progress, message) => {
              q.execute(new UpdateNodeDataCommand(placeholderId, {
                progress,
                phaseText: message || i18n.t('editor.aiGenerating'),
              }));
            },
            onError: (error) => {
              q.execute(new UpdateNodeDataCommand(placeholderId, {
                status: 'error',
                error,
              }));
            },
            onDone: (output) => {
              const result = (output as any)?.result;
              if (!result) {
                q.execute(new UpdateNodeDataCommand(placeholderId, {
                  status: 'error',
                  error: i18n.t('editor.aiNoResult'),
                }));
                return;
              }
              // 生成成功:替换占位节点为载体节点
              const nodeData: Record<string, unknown> = {
                content: result.content,
                status: 'success',
                prompt,
                model,
              };
              if (result.naturalWidth) nodeData.naturalWidth = result.naturalWidth;
              if (result.naturalHeight) nodeData.naturalHeight = result.naturalHeight;
              if (result.mimeType) nodeData.mimeType = result.mimeType;
              if (size) nodeData.size = size;
              if (quality) nodeData.quality = quality;
              if (count > 1) nodeData.count = count;
              if (seconds !== 5) nodeData.seconds = seconds;
              if (vquality) nodeData.vquality = vquality;
              if (generateAudio) nodeData.generateAudio = generateAudio;
              if (watermark) nodeData.watermark = watermark;
              if (voice) nodeData.voice = voice;
              if (audioFormat) nodeData.audioFormat = audioFormat;
              if (audioSpeed !== 1) nodeData.audioSpeed = audioSpeed;

              if (stackTargetId) {
                // Step 7: 目标为 StackNode → 追加卡片,移除占位节点
                const graph = q.getState();
                const stackNode = graph.nodes.find((n: any) => n.id === stackTargetId);
                if (stackNode) {
                  const stackData = (stackNode.data ?? {}) as Record<string, unknown>;
                  const cards: any[] = (stackData.cards as any[]) ?? [];
                  const newCard = {
                    id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    sourceType: targetType,
                    data: { ...nodeData },
                    title: '',
                  };
                  const updatedCards = [...cards, newCard];
                  q.execute(new UpdateNodeDataCommand(stackTargetId, {
                    cards: updatedCards,
                    activeIndex: updatedCards.length - 1,
                  }));
                }
                // 移除占位节点及其连线
                const phEdges = graph.edges.filter((e: any) => {
                  const tgt = typeof e.target === 'object' ? e.target?.nodeId : e.target;
                  return tgt === placeholderId || (typeof e.source === 'object' ? e.source?.nodeId : e.source) === placeholderId;
                });
                for (const e of phEdges) q.execute(new RemoveEdgeCommand(e.id));
                q.execute(new RemoveNodeCommand(placeholderId));
              } else {
                const newNodeId = replacePlaceholderWithNode(q, placeholderId, targetType, nodeData, extensions);
                if (newNodeId) {
                  store.setSelection({ selectedNodeIds: new Set([newNodeId]), selectedEdgeIds: new Set() });
                  triggerAutoLayoutAndFocusRef.current([newNodeId]);
                }
              }
            },
            onClose: () => {
              nodeAbortControllersRef.current.delete(placeholderId);
            },
          });
        })
        .catch((err: any) => {
          if (ctl.signal.aborted) return;
          console.error('提交生成任务失败:', err);
          q.execute(new UpdateNodeDataCommand(placeholderId, {
            status: 'error',
            error: err instanceof Error ? err.message : i18n.t('editor.submitTaskFailed'),
          }));
          nodeAbortControllersRef.current.delete(placeholderId);
        });
    });

    return () => {
      unsubRetry();
      unsubCancel();
      unsubPlaceholderRetry();
      unsubPlaceholderRemove();
      unsubStopRegen();
      unsubGeneratorGenerate();
    };
  }, [refs.store, handlePromptGenerate, handlePromptStop, message]);

  // 监听 graph 变化:当图片/视频节点连入生成器节点时,即时更新 referenceImages
  const syncedRefMapRef = useRef<Map<string, Set<string>>>(new Map());
  useEffect(() => {
    const store = refs.store;
    const q = refs.commandQueue;
    if (!store || !q) return;
    const unsub = store.subscribeGraph(() => {
      const graph = store.getGraph();
      // 找出所有边,其 target 为生成器节点
      for (const edge of graph.edges) {
        if (!edge.target?.nodeId) continue;
        const targetNode = graph.nodes.find((n: any) => n.id === edge.target.nodeId);
        if (!targetNode || targetNode.type !== 'generator') continue;
        // 找出 source 节点
        const sourceNode = graph.nodes.find((n: any) => n.id === edge.source?.nodeId);
        if (!sourceNode || (sourceNode.type !== 'image' && sourceNode.type !== 'video')) continue;
        // 检查是否已同步过
        const synced = syncedRefMapRef.current;
        if (!synced.has(targetNode.id)) synced.set(targetNode.id, new Set());
        if (synced.get(targetNode.id)!.has(sourceNode.id)) continue;
        // 获取图片内容
        const content = (sourceNode.data as Record<string, unknown>)?.content as string | undefined;
        if (!content) continue;
        // 更新生成器节点的 referenceImages
        const genData = targetNode.data as Record<string, unknown>;
        const existingRefs = (genData.referenceImages as string[]) ?? [];
        if (!existingRefs.includes(content)) {
          q.execute(new UpdateNodeDataCommand(targetNode.id, {
            ...genData,
            referenceImages: [...existingRefs, content],
          }));
        }
        synced.get(targetNode.id)!.add(sourceNode.id);
      }
    });
    return unsub;
  }, [refs.store, refs.commandQueue]);

  return {
    handlePromptGenerate,
    handlePromptStop,
    nodeAbortControllersRef,
    nodeFailureCountRef,
    savedOldNodesRef,
  };
}