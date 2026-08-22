/**
 * PinnedTodoSlot - 任务清单固定卡（Plan#36 P0-3）
 *
 * 对齐 open-design PinnedTodoSlot：任务清单固定在聊天输入框上方（独立于滚动容器），
 * 读取 store 中最新的 todo_write 快照，展示「已完成/总数」计数 + 状态列表。
 * 新快照自动覆盖（消息流中不再重复渲染工具胶囊，屏幕上恰好一张任务卡）。
 */

import { Check, ClipboardList, Loader2, X } from 'lucide-react';
import { useCanvasAgentStore } from './store.js';
import type { TodoSnapshot } from './types.js';

function statusIcon(item: TodoSnapshot['items'][0]): React.ReactElement {
  switch (item.status) {
    case 'completed':
      return (
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: '#10b981',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Check size={9} strokeWidth={3} color="#fff" />
        </span>
      );
    case 'running':
      return (
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: '2px solid var(--agent-accent-soft)',
            borderTopColor: 'var(--agent-accent)',
            flexShrink: 0,
            animation: 'spin 0.9s linear infinite',
          }}
        />
      );
    case 'failed':
      return (
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: 'var(--agent-danger)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <X size={9} strokeWidth={3} color="#fff" />
        </span>
      );
    default:
      return (
        <span
          style={{
            width: 14,
            height: 14,
            borderRadius: '50%',
            border: '2px solid var(--agent-border)',
            flexShrink: 0,
          }}
        />
      );
  }
}

export function PinnedTodoSlot(): React.ReactElement | null {
  const todo = useCanvasAgentStore((s) => s.todoSnapshot);
  const setTodoSnapshot = useCanvasAgentStore((s) => s.setTodoSnapshot);
  if (!todo || todo.items.length === 0) return null;

  const total = todo.items.length;
  const done = todo.items.filter((i) => i.status === 'completed').length;
  const active = todo.items.find((i) => i.status === 'running' || i.status === 'queued');

  return (
    <div
      style={{
        flexShrink: 0,
        margin: '0 14px 8px',
        padding: '8px 10px',
        borderRadius: 10,
        background: 'var(--agent-panel)',
        border: '1px solid var(--agent-border)',
        boxShadow: 'var(--agent-shadow)',
        animation: 'agentFadeUp 0.25s ease',
      }}
    >
      {/* 头部：标题 + 计数 + 清除 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <ClipboardList size={12} color="var(--agent-accent)" style={{ flexShrink: 0 }} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--agent-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {todo.title ?? '任务清单'}
        </span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            color: 'var(--agent-muted)',
            fontVariantNumeric: 'tabular-nums',
            flexShrink: 0,
          }}
        >
          {done}/{total}
        </span>
        <button
          type="button"
          onClick={() => setTodoSnapshot(null)}
          title="清除任务卡"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            borderRadius: 5,
            border: 'none',
            background: 'transparent',
            color: 'var(--agent-muted)',
            cursor: 'pointer',
            flexShrink: 0,
            padding: 0,
          }}
        >
          <X size={11} />
        </button>
      </div>

      {/* 列表 */}
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {todo.items.map((item) => (
          <div
            key={item.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontSize: 11.5,
              color: item.status === 'completed'
                ? 'var(--agent-muted)'
                : item.status === 'running'
                  ? 'var(--agent-accent)'
                  : 'var(--agent-muted)',
              textDecoration: item.status === 'completed' ? 'line-through' : 'none',
              lineHeight: 1.4,
            }}
          >
            {statusIcon(item)}
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
              }}
            >
              {item.label}
            </span>
          </div>
        ))}
      </div>

      {/* 进行中提示 */}
      {active && active.status === 'running' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            marginTop: 6,
            fontSize: 10.5,
            color: 'var(--agent-muted)',
          }}
        >
          <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
          {active.label}
        </div>
      )}
    </div>
  );
}
