/**
 * subject-risks 核心算法单测(Plan#20 T12 联调验证):
 * 引用改写(合并/拆分)/ 引用收集 / 断裂检测 / 跨集冲突 / 视频门禁。
 */

import { describe, it, expect } from 'vitest';
import {
  subjectNameKeys,
  rewriteShotRefs,
  rewriteMentionInEntities,
  collectSubjectShotRefs,
  detectBrokenRefs,
  detectCrossEpisodeStateConflicts,
  assessVideoGate,
} from './subject-risks.js';

function sbNode(id: string, title: string, shots: unknown[], shotsByEpisode?: Record<string, unknown[]>): unknown {
  return { id, title, type: 'storyboard', data: { shots, shotsByEpisode } };
}

function subjectCard(id: string, name: string, aliases: string[], states?: unknown[]): unknown {
  return {
    id,
    type: 'subject',
    data: {
      name,
      aliases,
      states: states ?? [{ id: 'state-default', name: '默认', images: [] }],
      placeholder: true,
    },
  };
}

describe('引用改写(合并/拆分共用)', () => {
  it('rewriteShotRefs: 字符串引用与对象引用全部改写为目标名', () => {
    const shots = [
      { id: 's1', entities: ['男主', { mention: '小陈', stateId: 'st-1' }] },
      { id: 's2', entities: ['路人'] },
    ];
    const next = rewriteShotRefs(shots, subjectNameKeys('男主', ['小陈']), '陈默');
    expect(next[0]!.entities).toEqual(['陈默', { mention: '陈默', stateId: 'st-1' }]);
    expect(next[1]).toBe(shots[1]); // 无匹配的镜头不重建引用
  });

  it('rewriteShotRefs: 别名命中同样改写', () => {
    const shots = [{ id: 's1', entities: ['小陈'] }];
    const next = rewriteShotRefs(shots, subjectNameKeys('男主', ['小陈']), '陈默');
    expect(next[0]!.entities).toEqual(['陈默']);
  });

  it('rewriteMentionInEntities(拆分按镜头): 字符串与对象 mention 同步替换', () => {
    const entities = ['男主', { mention: '男主', stateId: 'st-1' }, '女主'];
    expect(rewriteMentionInEntities(entities, '男主', '男主幼年')).toEqual([
      '男主幼年',
      { mention: '男主幼年', stateId: 'st-1' },
      '女主',
    ]);
  });
});

describe('collectSubjectShotRefs(拆分镜头勾选数据源)', () => {
  it('收集 shots 与 shotsByEpisode 中的引用,含分镜标题/集 id/镜头序号', () => {
    const nodes = [
      sbNode(
        'sb-1',
        '第一集分镜',
        [{ id: 'shot-a', entities: ['男主'], promptText: '男主站在桥上' }],
        { 'ep-2': [{ id: 'shot-b', entities: [{ mention: '小陈' }], prompt: '小陈回头' }] },
      ),
    ];
    const refs = collectSubjectShotRefs(nodes, '男主', ['小陈']);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ storyboardId: 'sb-1', storyboardTitle: '第一集分镜', episodeId: undefined, shotIndex: 0, shotId: 'shot-a', mention: '男主' });
    expect(refs[1]).toMatchObject({ episodeId: 'ep-2', shotIndex: 0, shotId: 'shot-b', mention: '小陈' });
  });

  it('无匹配返回空数组', () => {
    const nodes = [sbNode('sb-1', '分镜', [{ id: 'a', entities: ['路人'] }])];
    expect(collectSubjectShotRefs(nodes, '男主', [])).toEqual([]);
  });
});

describe('detectBrokenRefs(引用断裂)', () => {
  it('引用名在主体卡集合找不到 → 断裂,按分镜×mention 去重计数', () => {
    const storyboards = [sbNode('sb-1', '分镜A', [{ id: 'a', entities: ['路人甲', '男主'] }, { id: 'b', entities: ['路人甲'] }])];
    const cards = [subjectCard('sub-1', '男主', [])];
    const broken = detectBrokenRefs(storyboards, cards);
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ mention: '路人甲', storyboardTitle: '分镜A', count: 2 });
  });

  it('全部引用可匹配 → 无断裂', () => {
    const storyboards = [sbNode('sb-1', '分镜A', [{ id: 'a', entities: ['男主', { mention: '小陈' }] }])];
    const cards = [subjectCard('sub-1', '男主', ['小陈'])];
    expect(detectBrokenRefs(storyboards, cards)).toEqual([]);
  });
});

describe('detectCrossEpisodeStateConflicts(跨集形象冲突)', () => {
  const states = [
    { id: 'st-red', name: '红发', images: [{ storageKey: 'a' }] },
    { id: 'st-white', name: '白发', images: [{ storageKey: 'b' }] },
  ];

  it('两个有图状态被不同集引用 → 冲突', () => {
    const nodes = [
      sbNode('sb-1', '分镜', [], {
        'ep-1': [{ id: 'a', entities: [{ mention: '男主', stateId: 'st-red' }] }],
        'ep-2': [{ id: 'b', entities: [{ mention: '男主', stateId: 'st-white' }] }],
      }),
    ];
    const conflicts = detectCrossEpisodeStateConflicts(nodes, '男主', [], states);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ subjectName: '男主', stateA: 'st-red', stateB: 'st-white' });
  });

  it('同一集内切换状态(共享引用集)不冲突', () => {
    const nodes = [
      sbNode('sb-1', '分镜', [], {
        'ep-1': [
          { id: 'a', entities: [{ mention: '男主', stateId: 'st-red' }] },
          { id: 'b', entities: [{ mention: '男主', stateId: 'st-white' }] },
        ],
      }),
    ];
    expect(detectCrossEpisodeStateConflicts(nodes, '男主', [], states)).toEqual([]);
  });

  it('无图状态被引用不算冲突', () => {
    const nodes = [
      sbNode('sb-1', '分镜', [], {
        'ep-1': [{ id: 'a', entities: [{ mention: '男主', stateId: 'st-empty' }] }],
        'ep-2': [{ id: 'b', entities: [{ mention: '男主', stateId: 'st-empty' }] }],
      }),
    ];
    const emptyStates = [{ id: 'st-empty', name: '空', images: [] }];
    expect(detectCrossEpisodeStateConflicts(nodes, '男主', [], emptyStates)).toEqual([]);
  });
});

describe('assessVideoGate(视频生成三级门禁,预留纯函数)', () => {
  it('占位未转正 → block 拦截', () => {
    const sb = sbNode('sb-1', '分镜A', [{ id: 'a', entities: ['男主'] }]);
    const cards = [subjectCard('sub-1', '男主', [])]; // placeholder: true 且无图
    const issues = assessVideoGate(sb, [sb, ...cards]);
    expect(issues.some((i) => i.level === 'block' && i.kind === 'placeholderPending')).toBe(true);
  });

  it('缺形象图(非占位) → warn 可跳过', () => {
    const sb = sbNode('sb-1', '分镜A', [{ id: 'a', entities: ['男主'] }]);
    const cards = [subjectCard('sub-1', '男主', [], [{ id: 'st-1', name: '默认', images: [] }])];
    const card = cards[0] as { data: Record<string, unknown> };
    card.data = { ...card.data, placeholder: false };
    const issues = assessVideoGate(sb, [sb, cards[0]]);
    expect(issues.some((i) => i.level === 'warn' && i.kind === 'noImage')).toBe(true);
    expect(issues.some((i) => i.level === 'block')).toBe(false);
  });

  it('引用断裂(主体无卡) → block', () => {
    const sb = sbNode('sb-1', '分镜A', [{ id: 'a', entities: ['幽灵角色'] }]);
    const issues = assessVideoGate(sb, [sb]);
    expect(issues.some((i) => i.level === 'block' && i.kind === 'noCard' && i.subjectName === '幽灵角色')).toBe(true);
  });

  it('全部就绪(有图非占位 + 引用匹配) → 零拦截零警告', () => {
    const sb = sbNode('sb-1', '分镜A', [{ id: 'a', entities: ['男主'] }]);
    const card = subjectCard('sub-1', '男主', [], [{ id: 'st-1', name: '默认', images: [{ storageKey: 'a' }] }]) as { data: Record<string, unknown> };
    card.data = { ...card.data, placeholder: false };
    const issues = assessVideoGate(sb, [sb, card]);
    expect(issues).toEqual([]);
  });
});
