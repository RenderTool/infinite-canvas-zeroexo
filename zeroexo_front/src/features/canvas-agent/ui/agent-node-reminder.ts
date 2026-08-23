/**
 * agent-node-reminder.ts - 删除调皮回应（R3-D3，2026-08-23 交互拍板）
 *
 * 用户删除带 agentTaskId 烙印（Agent 创建）的节点时触发：
 * - 删除前收集快照 → 删除后注入 reminder 消息（气泡内嵌选项，非弹窗）
 * - 批量删除 N 个只问一次（deletedCount 汇总）
 * - 同会话拒绝 ≥2 次 → 学习降级：后续只调侃不动作（视为故意清理）
 * - 用户自己创建的节点（无烙印）删除不触发
 *
 * 恢复走删除前快照重建（add_node canvasOp → 命令队列 → 同步链路落后端），
 * 比档案库 restore 更即时可靠（节点数据删除瞬间仍完整在内存）。
 */

import type { NodeRecord } from '@zeroexo/core';
import { useCanvasAgentStore } from './store.js';
import type { DeletedNodeSnapshot } from './types.js';

/** 同会话拒绝次数（≥2 降级为只调侃） */
let refuseCount = 0;

/** 用户主动拒绝「补回来」→ 计数（由 ReminderBlock 调用） */
export function markReminderRefused(): void {
  refuseCount += 1;
}

/** 从删除目标中收集 Agent 创建节点快照（data.agentTaskId 烙印） */
export function collectAgentNodeSnapshots(
  nodes: Array<Pick<NodeRecord, 'id' | 'type' | 'title' | 'position' | 'size' | 'data'>>,
): DeletedNodeSnapshot[] {
  const snaps: DeletedNodeSnapshot[] = [];
  for (const n of nodes) {
    const data = (n.data ?? {}) as Record<string, unknown>;
    if (typeof data.agentTaskId !== 'string' || !data.agentTaskId) continue;
    snaps.push({
      nodeId: n.id,
      type: n.type,
      title: n.title,
      position: n.position ? { x: n.position.x, y: n.position.y } : undefined,
      size: n.size ? { width: n.size.width, height: n.size.height } : undefined,
      data,
    });
  }
  return snaps;
}

/** 删除后通知：注入调皮回应消息（批量只问一次；拒绝 ≥2 次降级为只调侃） */
export function notifyAgentNodesDeleted(snaps: DeletedNodeSnapshot[]): void {
  if (snaps.length === 0) return;
  const s = useCanvasAgentStore.getState();
  const id = `msg_reminder_${Date.now()}`;
  if (refuseCount >= 2) {
    // 学习降级：只调侃不动作（拍板：拒绝 ≥2 次视为故意清理）
    s.addMessage({
      id,
      role: 'agent',
      type: 'text',
      text:
        snaps.length > 1
          ? `哼，又一口气删了 ${snaps.length} 个～行吧行吧，我知道你不需要它们啦。`
          : '哼，又删我的节点～行吧，反正你也不需要它啦。',
      timestamp: Date.now(),
    });
    return;
  }
  s.addMessage({
    id,
    role: 'agent',
    type: 'reminder',
    text: '删除提醒',
    reminder: { deletedCount: snaps.length, snapshots: snaps },
    timestamp: Date.now(),
  });
}
