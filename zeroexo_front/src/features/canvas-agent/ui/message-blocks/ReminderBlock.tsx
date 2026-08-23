/**
 * ReminderBlock - 删除调皮回应卡（R3-D3，2026-08-23 交互拍板）
 *
 * 检测到用户删除 Agent 创建的节点（data.agentTaskId 烙印）后，
 * 以 Agent 消息气泡内嵌选项（非弹窗）呈现：
 * - 「补回来 ✅（推荐）」：按删除前快照重建节点（走 add_node canvasOp，
 *   命令队列 → 同步链路自动落后端），重建后聚焦首个节点
 * - 「不补，保留删除」：标记回应 + 会话级降级计数（拒绝 ≥2 次后只调侃不动作）
 *
 * 批量删除 N 个只问一次（deletedCount 汇总）；回应后渲染结果态，不重复询问。
 */

import { useCallback, useState } from 'react';
import { Sparkles, Check, Undo2 } from 'lucide-react';
import type { CanvasAgentMessage } from '../types.js';
import { executeCanvasOp } from '../canvas-op-bridge.js';
import { markReminderRefused } from '../agent-node-reminder.js';
import { useCanvasAgentStore } from '../store.js';

export function ReminderBlock(props: { message: CanvasAgentMessage }): React.ReactElement {
  const { message } = props;
  const reminder = message.reminder;
  const [busy, setBusy] = useState(false);
  if (!reminder) return <></>;

  const answered = message.reminderAnswered;

  // 补回来：按快照重建全部节点 → 聚焦第一个
  const handleRestore = useCallback(async () => {
    if (busy || answered) return;
    setBusy(true);
    try {
      const firstId = reminder.snapshots[0]?.nodeId;
      for (const snap of reminder.snapshots) {
        await executeCanvasOp({
          op: 'add_node',
          args: {
            id: snap.nodeId,
            type: snap.type,
            title: snap.title ?? '',
            position: snap.position,
            size: snap.size,
            data: snap.data,
          },
        });
      }
      if (firstId) void executeCanvasOp({ op: 'focus', args: { id: firstId } });
      useCanvasAgentStore.getState().updateMessage(message.id, { reminderAnswered: 'restored' });
    } finally {
      setBusy(false);
    }
  }, [busy, answered, message.id, reminder.snapshots]);

  const handleRefuse = useCallback(() => {
    if (busy || answered) return;
    markReminderRefused();
    useCanvasAgentStore.getState().updateMessage(message.id, { reminderAnswered: 'refused' });
  }, [busy, answered, message.id]);

  return (
    <div
      style={{
        width: '100%',
        margin: '6px 0',
        padding: '12px 14px',
        background: 'linear-gradient(135deg, var(--agent-accent-soft), transparent 65%)',
        border: '1px solid var(--agent-accent)',
        borderRadius: 12,
        animation: 'agentFadeUp 0.4s ease',
      }}
    >
      {/* 标题行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Sparkles size={13} color="var(--agent-accent)" />
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.08em',
            color: 'var(--agent-accent)',
          }}
        >
          Agent 的碎碎念
        </span>
      </div>

      {/* 正文 */}
      <div style={{ fontSize: 13, color: 'var(--agent-text)', lineHeight: 1.65 }}>
        {reminder.deletedCount > 1
          ? `哎呀，你怎么一口气删了 ${reminder.deletedCount} 个节点！那可都是我辛苦建出来的～要不要全部补回来？`
          : '哎呀，你怎么把人家辛苦建的节点删掉了～我给你补回来！'}
      </div>

      {/* 内嵌选项（非弹窗，拍板确认交互） */}
      {!answered ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleRestore()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 12px',
              border: 'none',
              borderRadius: 8,
              background: 'var(--agent-accent)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.7 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            <Undo2 size={12} />
            补回来 ✅（推荐）
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleRefuse}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '5px 12px',
              border: '1px solid var(--agent-border)',
              borderRadius: 8,
              background: 'var(--agent-surface)',
              color: 'var(--agent-muted)',
              fontSize: 12,
              fontWeight: 500,
              fontFamily: 'inherit',
              cursor: busy ? 'wait' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            不补，保留删除
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            marginTop: 10,
            fontSize: 11.5,
            color: answered === 'restored' ? '#10b981' : 'var(--agent-muted)',
          }}
        >
          <Check size={12} />
          {answered === 'restored' ? '好嘞，节点已补回来啦～' : '收到，那我就不补啦～'}
        </div>
      )}
    </div>
  );
}
