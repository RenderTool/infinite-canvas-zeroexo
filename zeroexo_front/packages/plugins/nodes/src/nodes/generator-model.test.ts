import { describe, expect, it } from 'vitest';
import type { GraphModel, NodeRecord } from '@zeroexo/core';
import {
  appendReferenceImages,
  computeReferenceCompatibility,
  decodeModelValue,
  deriveIncomingReferences,
  encodeModelValue,
  mergeGeneratorParams,
  referencesChanged,
  setGenerationMode,
  setModelSelection,
  type GeneratorNodeData,
  type IncomingReference,
} from './generator-model.js';

const context = { eventBus: { emit: () => undefined } } as never;

function createGeneratorNode(): NodeRecord {
  return {
    id: 'gen',
    type: 'generator',
    position: { x: 0, y: 0 },
    size: { width: 620, height: 348 },
    data: { generationMode: 'image', prompt: '', status: 'idle', referenceImages: [], channelId: '', model: '', params: {} },
  };
}

function createGraph(node: NodeRecord): GraphModel {
  return { nodes: [node], edges: [], viewport: { x: 0, y: 0, k: 1 }, metadata: {} };
}

const baseData = (): Partial<GeneratorNodeData> => ({
  generationMode: 'image',
  prompt: 'x',
  status: 'idle',
  referenceImages: [],
  channelId: 'c1',
  model: 'm1',
  params: { size: '1024' },
});

describe('GeneratorNode model', () => {
  it('derives incoming references with title fallback', () => {
    const refs = deriveIncomingReferences([
      { id: 'node-abcdefgh', type: 'image', content: 'blob:x' },
      { id: 'n2', type: 'text', title: '剧本' },
    ]);
    expect(refs[0]!.title).toBe('node-abc');
    expect(refs[0]!.content).toBe('blob:x');
    expect(refs[1]!.title).toBe('剧本');
  });

  it('detects reference changes by id/type/content only', () => {
    const prev: IncomingReference[] = [{ id: 'a', type: 'image', title: 'A', content: 'c' }];
    expect(referencesChanged(prev, [{ ...prev[0]!, title: 'renamed' }])).toBe(false);
    expect(referencesChanged(prev, [{ ...prev[0]!, content: 'c2' }])).toBe(true);
    expect(referencesChanged(prev, [])).toBe(true);
  });

  it('computes compatibility: text always, no-model default, model gate with mode fallback', () => {
    const refs: IncomingReference[] = [
      { id: 't', type: 'script', title: '剧本' },
      { id: 'i', type: 'image', title: '图' },
      { id: 'v', type: 'video', title: '视频' },
    ];
    // 未选模型 → 全兼容
    expect(computeReferenceCompatibility(refs, { hasModelSelected: false, supportedInputTypes: [], generationMode: 'image' }))
      .toEqual({ t: true, i: true, v: true });
    // 已选模型仅支持 image → 视频不兼容
    expect(computeReferenceCompatibility(refs, { hasModelSelected: true, supportedInputTypes: ['image'], generationMode: 'image' }))
      .toEqual({ t: true, i: true, v: false });
    // 模式匹配兜底:模型仅支持 text 时,video 模式下视频节点仍兼容(模式兜底),图片不兼容
    expect(computeReferenceCompatibility(refs, { hasModelSelected: true, supportedInputTypes: ['text'], generationMode: 'video' }))
      .toEqual({ t: true, i: false, v: true });
  });

  it('encodes and decodes model values symmetrically', () => {
    expect(encodeModelValue('ch1', 'sd3')).toBe('ch1::sd3');
    expect(encodeModelValue('', 'sd3')).toBe('');
    expect(decodeModelValue('ch1::sd3')).toEqual({ channelId: 'ch1', model: 'sd3' });
  });

  it('setModelSelection writes channelId/model and supports undo', () => {
    const node = createGeneratorNode();
    const graph = createGraph(node);
    const before = JSON.stringify(graph);
    const cmd = setModelSelection(node.id, baseData(), 'ch2::flux');
    const after = cmd.execute(graph, context);
    const data = after.nodes[0]!.data as GeneratorNodeData;
    expect(data.channelId).toBe('ch2');
    expect(data.model).toBe('flux');
    expect(data.prompt).toBe('x');
    expect(JSON.stringify(cmd.undo(after, context))).toBe(before);
  });

  it('setGenerationMode switches mode without losing prompt/params', () => {
    const node = createGeneratorNode();
    const after = setGenerationMode(node.id, baseData(), 'video').execute(createGraph(node), context);
    const data = after.nodes[0]!.data as GeneratorNodeData;
    expect(data.generationMode).toBe('video');
    expect(data.params).toEqual({ size: '1024' });
  });

  it('mergeGeneratorParams merges without clobbering siblings', () => {
    const node = createGeneratorNode();
    const after = mergeGeneratorParams(node.id, baseData(), { steps: 30 }).execute(createGraph(node), context);
    const data = after.nodes[0]!.data as GeneratorNodeData;
    expect(data.params).toEqual({ size: '1024', steps: 30 });
  });

  it('appendReferenceImages appends without duplicates from caller side', () => {
    const node = createGeneratorNode();
    const data = { ...baseData(), referenceImages: ['data:1'] };
    const after = appendReferenceImages(node.id, data, ['data:2']).execute(createGraph(node), context);
    expect((after.nodes[0]!.data as GeneratorNodeData).referenceImages).toEqual(['data:1', 'data:2']);
  });
});
