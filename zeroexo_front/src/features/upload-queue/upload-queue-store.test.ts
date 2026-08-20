/**
 * UploadQueueStore - 批次追加语义回归测试
 *
 * 覆盖: addFiles 追加(非替换)、total/completed 累计、
 * 跨批次状态更新、reset 后重试场景
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useUploadQueueStore } from './upload-queue-store.js';

function makeFile(name: string): File {
  return new File(['data'], name, { type: 'image/png' });
}

describe('UploadQueueStore 批次追加语义', () => {
  beforeEach(() => {
    useUploadQueueStore.getState().reset();
  });

  it('第二次 addFiles 追加而非替换: items 合并、total 累计', () => {
    useUploadQueueStore.getState().addFiles([makeFile('a.png'), makeFile('b.png')]);
    expect(useUploadQueueStore.getState().items).toHaveLength(2);
    expect(useUploadQueueStore.getState().total).toBe(2);

    useUploadQueueStore.getState().addFiles([makeFile('c.png')]);
    const s = useUploadQueueStore.getState();
    expect(s.items).toHaveLength(3);
    expect(s.total).toBe(3);
    expect(s.items.map((it) => it.name)).toEqual(['a.png', 'b.png', 'c.png']);
  });

  it('追加模式下跨批次 completeOne 计数正确(总进度不超 100%)', () => {
    useUploadQueueStore.getState().addFiles([makeFile('a.png'), makeFile('b.png')]);
    const firstIds = useUploadQueueStore.getState().items.map((it) => it.id);

    useUploadQueueStore.getState().addFiles([makeFile('c.png')]);
    const s2 = useUploadQueueStore.getState();

    // 第一批两个完成
    s2.completeOne(firstIds[0]!);
    s2.completeOne(firstIds[1]!);
    let s = useUploadQueueStore.getState();
    expect(s.completed).toBe(2);
    expect(s.total).toBe(3);

    // 第二批完成 → 全部完成(覆盖层 allDone 判定成立)
    const thirdId = s.items.find((it) => it.name === 'c.png')!.id;
    s.completeOne(thirdId);
    s = useUploadQueueStore.getState();
    expect(s.completed).toBe(3);
    expect(s.completed >= s.total && s.total > 0).toBe(true);
  });

  it('追加模式下第一批 item 状态更新仍生效(进度不丢失)', () => {
    useUploadQueueStore.getState().addFiles([makeFile('a.png')]);
    const firstId = useUploadQueueStore.getState().items[0]!.id;

    useUploadQueueStore.getState().addFiles([makeFile('b.png')]);

    useUploadQueueStore.getState().completeOne(firstId);
    const s = useUploadQueueStore.getState();
    expect(s.items.find((it) => it.id === firstId)?.status).toBe('done');
    expect(s.items.find((it) => it.name === 'b.png')?.status).toBe('pending');
  });

  it('reset 清空后重新 addFiles 为全新队列(重试场景)', () => {
    useUploadQueueStore.getState().addFiles([makeFile('a.png')]);
    useUploadQueueStore.getState().reset();

    useUploadQueueStore.getState().addFiles([makeFile('b.png'), makeFile('c.png')]);
    const s = useUploadQueueStore.getState();
    expect(s.items).toHaveLength(2);
    expect(s.total).toBe(2);
    expect(s.completed).toBe(0);
  });

  it('失败项 failOne 同样累计计数(供重试/完成判定)', () => {
    useUploadQueueStore.getState().addFiles([makeFile('a.png'), makeFile('b.png')]);
    const [id1, id2] = useUploadQueueStore.getState().items.map((it) => it.id);
    useUploadQueueStore.getState().failOne(id1!, 'mock error');
    useUploadQueueStore.getState().completeOne(id2!);
    const s = useUploadQueueStore.getState();
    expect(s.completed).toBe(2);
    expect(s.items.find((it) => it.id === id1)?.status).toBe('error');
    expect(s.items.find((it) => it.id === id2)?.status).toBe('done');
  });
});
