/**
 * 资源引用工具 — 构建 @ 弹出引用面板的候选列表
 *
 * 资源节点 = 有 content 的 image/video/audio 节点 + 有 content/prompt 的 text 节点
 * label 规则:按类型编号(image→参考图1, video→参考视频1, audio→参考音频1, text→文本1)
 * active = 是否连接到当前 config 节点(决定 @ 弹出面板是否可见)
 */

import type { NodeRecord } from '@zeroexo/core';

export type ResourceKind = 'image' | 'video' | 'audio' | 'text';

export interface ResourceReference {
  id: string;
  nodeId: string;
  kind: ResourceKind;
  label: string;
  title: string;
  previewUrl?: string;
  text?: string;
  active: boolean;
}

/** 节点数据中可读取的 content/prompt 字段(松散类型,兼容各节点 data 结构) */
interface NodeContentData {
  content?: string;
  prompt?: string;
  storageKey?: string;
}

/** 判断节点是否为资源节点(有可用 content/prompt) */
function resourceKind(node: NodeRecord): ResourceKind | null {
  const data = (node.data ?? {}) as NodeContentData;
  const hasContent = !!data.content;
  const hasPrompt = !!data.prompt;
  if (node.type === 'image' && hasContent) return 'image';
  if (node.type === 'video' && hasContent) return 'video';
  if (node.type === 'audio' && hasContent) return 'audio';
  if (node.type === 'text' && (hasContent || hasPrompt)) return 'text';
  return null;
}

/** 按 kind 生成 label(中文 + 编号) */
function labelForKind(kind: ResourceKind, index: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  const n = index + 1;
  switch (kind) {
    case 'image': return t('prompt.refImage', { n });
    case 'video': return t('prompt.refVideo', { n });
    case 'audio': return t('prompt.refAudio', { n });
    case 'text': return t('prompt.refText', { n });
  }
}

/**
 * 构建资源引用列表
 *
 * @param nodes 全画布节点
 * @param edges 全画布边
 * @param contextNodeId 当前节点 id(config 节点或其他节点)
 * @param t i18n 翻译函数
 * @returns ResourceReference[] — 所有资源节点,active 标记是否连接到 contextNodeId
 */
export function buildResourceReferences(
  nodes: NodeRecord[],
  edges: Array<{ source: { nodeId: string }; target: { nodeId: string } }>,
  contextNodeId: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): ResourceReference[] {
  // 找出连接到 contextNodeId 的源节点 id 集合
  const connectedSourceIds = new Set<string>();
  if (contextNodeId) {
    for (const edge of edges) {
      if (edge.target.nodeId === contextNodeId) {
        connectedSourceIds.add(edge.source.nodeId);
      }
    }
  }

  // 按类型计数(生成 label 用)
  const counts: Record<ResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
  const references: ResourceReference[] = [];

  for (const node of nodes) {
    const kind = resourceKind(node);
    if (!kind) continue;
    const index = counts[kind]++;
    const label = labelForKind(kind, index, t);
    const data = (node.data ?? {}) as NodeContentData;
    references.push({
      id: node.id,
      nodeId: node.id,
      kind,
      label,
      title: node.title || label,
      previewUrl: data.content,
      text: node.type === 'text' ? (data.content || data.prompt) : undefined,
      active: connectedSourceIds.has(node.id),
    });
  }

  return references;
}

/**
 * 统计连接到 contextNodeId 的源节点数量(按类型分组)
 *
 * 用于 InputChip 行展示"提示词 N / 参考图 N / 参考视频 N / 参考音频 N"
 */
export function countConnectedResources(
  nodes: NodeRecord[],
  edges: Array<{ source: { nodeId: string }; target: { nodeId: string } }>,
  contextNodeId: string,
): { text: number; image: number; video: number; audio: number } {
  const counts = { text: 0, image: 0, video: 0, audio: 0 };
  for (const edge of edges) {
    if (edge.target.nodeId !== contextNodeId) continue;
    const src = nodes.find((n) => n.id === edge.source.nodeId);
    if (!src) continue;
    const kind = resourceKind(src);
    if (!kind) continue;
    counts[kind] += 1;
  }
  return counts;
}
