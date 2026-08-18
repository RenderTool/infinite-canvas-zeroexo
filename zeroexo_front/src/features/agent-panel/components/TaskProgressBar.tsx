/**
 * TaskProgressBar - 任务进度条组件
 * 显示任务进度（0-100%）和当前阶段文字提示
 */

import type { CSSProperties } from 'react';

export interface TaskProgressBarProps {
  progress: number;
  phaseText?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  color?: string;
  bgColor?: string;
  showPercent?: boolean;
  height?: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#8b8b8b', running: '#2563eb', completed: '#22c55e',
  failed: '#ef4444', cancelled: '#8b8b8b',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '等待中', running: '执行中', completed: '已完成',
  failed: '失败', cancelled: '已取消',
};

export function TaskProgressBar({
  progress, phaseText, status = 'running', color,
  bgColor = 'rgba(128,128,128,0.15)', showPercent = true, height = 6,
}: TaskProgressBarProps): React.ReactElement {
  const barColor = color || STATUS_COLORS[status] || '#2563eb';
  const clamped = Math.max(0, Math.min(100, progress));
  const isIndet = status === 'running' && clamped === 0;

  const trackStyle: CSSProperties = {
    width: '100%', height, borderRadius: height / 2, backgroundColor: bgColor,
    overflow: 'hidden', position: 'relative',
  };

  const fillStyle: CSSProperties = isIndet ? {
    width: '40%', height: '100%', borderRadius: height / 2,
    background: `linear-gradient(90deg, transparent, ${barColor}, transparent)`,
    position: 'absolute', left: 0, top: 0,
    animation: 'taskProgressIndeterminate 1.5s ease-in-out infinite',
  } : {
    width: `${clamped}%`, height: '100%', borderRadius: height / 2,
    backgroundColor: barColor, transition: 'width 0.4s ease',
  };

  const labelColor = status === 'failed' ? '#ef4444' : status === 'completed' ? '#22c55e' : 'inherit';

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 4 } as CSSProperties}>
      <div style={trackStyle}><div style={fillStyle} /></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: labelColor, opacity: 0.75 } as CSSProperties}>
        <span>{phaseText || STATUS_LABELS[status] || '未知状态'}</span>
        {showPercent && !isIndet && <span>{clamped}%</span>}
      </div>
      <style>{`@keyframes taskProgressIndeterminate{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}`}</style>
    </div>
  );
}