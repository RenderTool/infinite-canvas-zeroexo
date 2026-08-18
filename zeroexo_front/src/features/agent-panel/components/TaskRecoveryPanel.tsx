/**
 * TaskRecoveryPanel - 任务恢复面板
 *
 * 显示当前用户所有未完成任务列表，支持重新执行/取消任务
 */

import { useState, useCallback } from 'react';import type { CSSProperties } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';
import { TaskProgressBar } from './TaskProgressBar.js';

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AgentTaskItem {
  id: string;
  taskType: string;
  status: TaskStatus;
  progress: number;
  input?: any;
  output?: any;
  error?: string;
  createdAt: string;
  completedAt?: string;
  projectId?: string;
}

export interface TaskRecoveryPanelProps {
  tasks: AgentTaskItem[];
  loading?: boolean;
  onRerun: (task: AgentTaskItem) => void;
  onCancel: (taskId: string) => void;
  onClose?: () => void;
}

const STATUS_ICONS: Record<string, string> = {
  pending: '\u23F3',
  running: '\u25B6\uFE0F',
  completed: '\u2705',
  failed: '\u274C',
  cancelled: '\u26D4',
};

const TASK_TYPE_LABELS: Record<string, string> = {
  image: '图片生成',
  video: '视频生成',
  audio: '音频生成',
  storyboard: '分镜生成',
  script: '剧本生成',
  agent: '全能Agent',
  script_writer: '剧本写作',
  storyboard_assistant: '分镜助手',
  researcher: '调研分析',
};

function getTaskTypeLabel(taskType: string): string {
  return TASK_TYPE_LABELS[taskType] || taskType;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hours = d.getHours().toString().padStart(2, '0');
    const minutes = d.getMinutes().toString().padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}`;
  } catch {
    return dateStr;
  }
}

export function TaskRecoveryPanel({
  tasks,
  loading = false,
  onRerun,
  onCancel,
  onClose,
}: TaskRecoveryPanelProps): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;

  const [collapsed, setCollapsed] = useState(false);
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());

  const handleCancel = useCallback(
    async (taskId: string) => {
      if (cancellingIds.has(taskId)) return;
      setCancellingIds((prev) => new Set(prev).add(taskId));
      try {
        await onCancel(taskId);
      } finally {
        setCancellingIds((prev) => {
          const next = new Set(prev);
          next.delete(taskId);
          return next;
        });
      }
    },
    [cancellingIds, onCancel],
  );

  const containerStyle: CSSProperties = {
    borderTop: `1px solid ${border}`,
    padding: '8px 12px',
    fontSize: 12,
    color: theme.toolbar.text,
  };

  const headerStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    userSelect: 'none',
    paddingBottom: collapsed ? 0 : 6,
  };

  const pendingTasks = tasks.filter(
    (t) => t.status === 'pending' || t.status === 'running' || t.status === 'failed',
  );

  return (
    <div style={containerStyle}>
      <div style={headerStyle} onClick={() => setCollapsed(!collapsed)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }}>
            任务队列
          </span>
          {pendingTasks.length > 0 && (
            <span
              style={{
                background: accent,
                color: '#fff',
                borderRadius: 10,
                padding: '0 6px',
                fontSize: 10,
                lineHeight: '16px',
                fontWeight: 600,
              }}
            >
              {pendingTasks.length}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {onClose && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: theme.toolbar.text, padding: '2px 4px', fontSize: 11, opacity: 0.5,
              }}
            >
              收起
            </button>
          )}
          <span style={{ fontSize: 11, opacity: 0.4, transition: 'transform 0.2s', display: 'inline-block', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
            {'\u25BC'}
          </span>
        </div>
      </div>

      {!collapsed && (
        <div
          style={{
            maxHeight: 240,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {loading && (
            <div style={{ padding: '12px 0', textAlign: 'center', opacity: 0.5, fontSize: 11 }}>
              加载中...
            </div>
          )}

          {!loading && tasks.length === 0 && (
            <div style={{ padding: '12px 0', textAlign: 'center', opacity: 0.4, fontSize: 11 }}>
              暂无任务记录
            </div>
          )}

          {!loading &&
            tasks.map((task) => {
              const isActive = task.status === 'pending' || task.status === 'running';
              const isFailed = task.status === 'failed';
              const isCompleted = task.status === 'completed';

              return (
                <div
                  key={task.id}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
                    border: `1px solid ${
                      isFailed ? 'rgba(239,68,68,0.3)' : isActive ? `${accent}20` : border
                    }`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 13 }}>{STATUS_ICONS[task.status] || ''}</span>
                      <span style={{ fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {getTaskTypeLabel(task.taskType)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <span style={{ fontSize: 10, opacity: 0.4 }}>
                        {formatDate(task.createdAt)}
                      </span>
                      {(isActive || isFailed) && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          {isFailed && (
                            <button
                              type="button"
                              onClick={() => onRerun(task)}
                              style={{
                                border: `1px solid ${border}`,
                                background: 'transparent',
                                color: theme.toolbar.text,
                                cursor: 'pointer',
                                padding: '2px 6px',
                                borderRadius: 4,
                                fontSize: 10,
                              }}
                            >
                              重试
                            </button>
                          )}
                          {isActive && (
                            <button
                              type="button"
                              onClick={() => handleCancel(task.id)}
                              disabled={cancellingIds.has(task.id)}
                              style={{
                                border: `1px solid rgba(239,68,68,0.4)`,
                                background: 'transparent',
                                color: '#ef4444',
                                cursor: cancellingIds.has(task.id) ? 'not-allowed' : 'pointer',
                                padding: '2px 6px',
                                borderRadius: 4,
                                fontSize: 10,
                                opacity: cancellingIds.has(task.id) ? 0.5 : 1,
                              }}
                            >
                              取消
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {isActive && (
                    <div style={{ marginTop: 4 }}>
                      <TaskProgressBar
                        progress={task.progress}
                        status={task.status}
                        height={4}
                        showPercent={false}
                        phaseText={task.status === 'pending' ? '等待执行...' : '正在执行...'}
                      />
                    </div>
                  )}

                  {isFailed && task.error && (
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: 10,
                        color: '#ef4444',
                        opacity: 0.7,
                        lineHeight: 1.4,
                        wordBreak: 'break-all',
                        maxHeight: 32,
                        overflow: 'hidden',
                      }}
                    >
                      {task.error}
                    </div>
                  )}

                  {isCompleted && task.output && (
                    <div style={{ marginTop: 4, fontSize: 10, opacity: 0.5, lineHeight: 1.3 }}>
                      已完成
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}