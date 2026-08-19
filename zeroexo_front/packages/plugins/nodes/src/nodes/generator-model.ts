/**
 * GeneratorNode Model - 纯数据操作层(第二批 MVVM 试点,参照 stacked-media-model.ts)
 *
 * 视图层消费本模块构造命令/派生数据,数据变换规则集中于此,无 React 依赖。
 * 每个写操作返回「正向命令」(BatchCommand 打包),撤销由 commandQueue 的 undo 栈负责。
 */

import { UpdateNodeDataCommand, BatchCommand } from '@zeroexo/core';

// ===== 类型定义(从 generator-node-view.tsx 迁移) =====

export type GeneratorMode = 'image' | 'video' | 'audio';
export type GeneratorStatus = 'idle' | 'generating' | 'success' | 'error';

export interface GeneratorNodeData {
  generationMode: GeneratorMode;
  prompt: string;
  status: GeneratorStatus;
  referenceImages: string[];
  channelId: string;
  model: string;
  /** 动态参数存储(与 Admin 配置的参数系统一致) */
  params: Record<string, unknown>;
  /** @deprecated 保留向后兼容,迁移到 params 字段 */
  size?: string;
  quality?: string;
  count?: number;
}

/** 连入参考素材(归一化后的纯数据结构) */
export interface IncomingReference {
  id: string;
  type: string;
  title: string;
  content?: string;
  storageKey?: string;
}

/** 连入节点的原始读取结果(由视图从 connectionController/store 采集) */
export interface RawIncomingNode {
  id: string;
  type: string;
  title?: string;
  content?: string;
  storageKey?: string;
}

// 节点类型 → 输入类型映射(用于模型兼容性检查)
export const NODE_TYPE_TO_INPUT_TYPE: Record<string, string> = {
  text: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
  script: 'text',
  storyboard: 'text',
  generator: 'text',
};

// ===== 派生函数(零副作用) =====

/** 归一化连入节点为参考素材列表(title 缺省回退到类型/短 id) */
export function deriveIncomingReferences(raw: RawIncomingNode[]): IncomingReference[] {
  return raw.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title || n.id.slice(0, 8),
    content: n.content,
    storageKey: n.storageKey,
  }));
}

/**
 * 稳定化比较:仅当参考列表实际变化时返回 true。
 * 用于隔离 graphVersion 高频变化导致的无意义重渲染(视图侧配合 ref 缓存使用)。
 */
export function referencesChanged(prev: IncomingReference[], next: IncomingReference[]): boolean {
  if (prev.length !== next.length) return true;
  return next.some(
    (n, i) => n.id !== prev[i]?.id || n.type !== prev[i]?.type || n.content !== prev[i]?.content,
  );
}

export interface CompatibilityOptions {
  /** 是否已选择模型(未选择时默认全部兼容) */
  hasModelSelected: boolean;
  /** 当前模型支持的输入类型 */
  supportedInputTypes: string[];
  /** 当前生成模式 */
  generationMode: GeneratorMode;
}

/**
 * 计算每个连入节点与当前模型的兼容性。
 * 规则:
 * 1. 文本类节点永远兼容(text/script/storyboard/generator)
 * 2. 未选择模型时默认所有节点兼容
 * 3. 已选择模型:模型输入类型包含该节点类型,或生成模式与节点类型匹配
 */
export function computeReferenceCompatibility(
  refs: IncomingReference[],
  opts: CompatibilityOptions,
): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const n of refs) {
    const inputType = NODE_TYPE_TO_INPUT_TYPE[n.type] || 'text';
    if (inputType === 'text') {
      map[n.id] = true;
      continue;
    }
    if (!opts.hasModelSelected) {
      map[n.id] = true;
      continue;
    }
    const modelSupportsType = opts.supportedInputTypes.includes(inputType);
    const modeMatches = opts.generationMode === inputType;
    map[n.id] = modelSupportsType || modeMatches;
  }
  return map;
}

/** 渠道+模型 → 编码值(Select 的 value) */
export function encodeModelValue(channelId: string, model: string): string {
  return channelId && model ? `${channelId}::${model}` : '';
}

/** 编码值 → 渠道+模型(容错:无分隔符时整体视为模型名) */
export function decodeModelValue(encoded: string): { channelId: string; model: string } {
  const parts = encoded.split('::');
  return { channelId: parts[0] ?? '', model: parts[1] ?? '' };
}

// ===== 命令构造(写操作,视图经 commandQueue.execute 提交) =====

/** 切换生成类型 */
export function setGenerationMode(
  nodeId: string,
  data: Partial<GeneratorNodeData>,
  mode: GeneratorMode,
): BatchCommand {
  return new BatchCommand([
    new UpdateNodeDataCommand(nodeId, { ...data, generationMode: mode } as Record<string, unknown>),
  ], 'generator-set-mode');
}

/** 切换模型(编码值解析为 channelId/model) */
export function setModelSelection(
  nodeId: string,
  data: Partial<GeneratorNodeData>,
  encoded: string,
): BatchCommand {
  const { channelId, model } = decodeModelValue(encoded);
  return new BatchCommand([
    new UpdateNodeDataCommand(nodeId, { ...data, channelId, model } as Record<string, unknown>),
  ], 'generator-set-model');
}

/** 提交提示词(视图侧防抖后调用) */
export function setGeneratorPrompt(
  nodeId: string,
  data: Partial<GeneratorNodeData>,
  prompt: string,
): BatchCommand {
  return new BatchCommand([
    new UpdateNodeDataCommand(nodeId, { ...data, prompt } as Record<string, unknown>),
  ], 'generator-set-prompt');
}

/** 合并动态参数 */
export function mergeGeneratorParams(
  nodeId: string,
  data: Partial<GeneratorNodeData>,
  patch: Record<string, unknown>,
): BatchCommand {
  const params = { ...((data.params ?? {}) as Record<string, unknown>), ...patch };
  return new BatchCommand([
    new UpdateNodeDataCommand(nodeId, { ...data, params } as Record<string, unknown>),
  ], 'generator-merge-params');
}

/** 追加参考图(旧数据兼容同步链路使用) */
export function appendReferenceImages(
  nodeId: string,
  data: Partial<GeneratorNodeData>,
  newRefs: string[],
): BatchCommand {
  const referenceImages = [...(data.referenceImages ?? []), ...newRefs];
  return new BatchCommand([
    new UpdateNodeDataCommand(nodeId, { ...data, referenceImages } as Record<string, unknown>),
  ], 'generator-append-refs');
}
