/**
 * UploadQueue 批次隔离单元测试
 *
 * 覆盖 2026-08-20 修复的「二次上传重复收集历史批次结果」回归场景：
 * - addTasks 返回本次批次 ID
 * - waitForTasks 只等待指定批次进入终态
 * - 第二次上传只收集第二次的结果，不附带第一次
 * - removeTasks 清理已结束批次，防止历史任务残留
 * - 失败重试耗尽后 waitForTasks 正常返回
 * - 并发多批次互不干扰
 */
import { describe, it, expect } from 'vitest';
import { UploadQueue } from './upload-queue.js';

describe('UploadQueue 批次隔离', () => {
  it('addTasks 返回本次批次任务 ID 列表', () => {
    const q = new UploadQueue({ concurrency: 5 });
    const ids = q.addTasks([1, 2, 3], async (n) => n * 2);
    expect(ids).toHaveLength(3);
  });

  it('waitForTasks 等待指定批次完成并返回结果', async () => {
    const q = new UploadQueue({ concurrency: 5 });
    const ids = q.addTasks(['a', 'b'], async (s) => s.toUpperCase());
    await q.waitForTasks(ids);
    const results = ids.map((id) => q.getTask(id)?.result);
    expect(results).toEqual(['A', 'B']);
  });

  it('第二次上传不收集第一次批次的历史结果（回归：重复素材 bug）', async () => {
    const q = new UploadQueue({ concurrency: 5 });
    // 第一批
    const ids1 = q.addTasks(['a'], async (s) => `r1-${s}`);
    await q.waitForTasks(ids1);
    // 第二批（不清理第一批，模拟历史任务残留）
    const ids2 = q.addTasks(['b'], async (s) => `r2-${s}`);
    await q.waitForTasks(ids2);
    const results2 = ids2.map((id) => q.getTask(id)?.result);
    expect(results2).toEqual(['r2-b']); // 只含第二批结果，不含第一批
  });

  it('removeTasks 移除已结束批次，getTasks 不再包含', async () => {
    const q = new UploadQueue({ concurrency: 5 });
    const ids = q.addTasks(['a'], async (s) => s);
    await q.waitForTasks(ids);
    q.removeTasks(ids);
    expect(q.getTasks()).toHaveLength(0);
  });

  it('失败重试耗尽后 waitForTasks 正常返回，结果不包含失败项', async () => {
    const q = new UploadQueue({ concurrency: 1, maxRetries: 1, retryBaseDelay: 1 });
    let calls = 0;
    const ids = q.addTasks(['ok', 'bad'], async (s) => {
      if (s === 'bad' && ++calls <= 2) throw new Error('boom');
      return s;
    });
    await q.waitForTasks(ids);
    const results = ids
      .map((id) => q.getTask(id))
      .filter((t) => t?.status === 'done')
      .map((t) => t?.result);
    expect(results).toEqual(['ok']);
  });

  it('并发两批任务互不干扰，各自收集本批结果', async () => {
    const q = new UploadQueue({ concurrency: 5 });
    const ids1 = q.addTasks(['a1', 'a2'], async (s) => `A-${s}`);
    const ids2 = q.addTasks(['b1'], async (s) => `B-${s}`);
    const [r1, r2] = await Promise.all([
      q.waitForTasks(ids1).then(() => ids1.map((id) => q.getTask(id)?.result)),
      q.waitForTasks(ids2).then(() => ids2.map((id) => q.getTask(id)?.result)),
    ]);
    expect(r1).toEqual(['A-a1', 'A-a2']);
    expect(r2).toEqual(['B-b1']);
  });
});
