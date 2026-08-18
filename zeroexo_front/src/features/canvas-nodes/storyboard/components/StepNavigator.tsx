/**
 * StepNavigator - Step 导航器组件
 *
 * 上一镜/下一镜按钮、当前镜号显示、返回分镜列表按钮。
 */
import { type ReactElement } from 'react';
import { Button } from 'antd';
import { ChevronLeft, ChevronRight, List } from 'lucide-react';
import { useTheme } from '@zeroexo/plugin-theme';

export interface StepNavigatorProps {
  currentIndex: number;
  totalSteps: number;
  onPrev: () => void;
  onNext: () => void;
  onBackToList: () => void;
}

export function StepNavigator({
  currentIndex,
  totalSteps,
  onPrev,
  onNext,
  onBackToList,
}: StepNavigatorProps): ReactElement {
  const { theme } = useTheme();
  const textColor = theme.toolbar.text;
  const mutedColor = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const isDark = theme.mode === 'dark';
  const bgCard = isDark ? '#1f1f1f' : '#f5f5f5';
  const borderMuted = isDark ? '#2e2e2e' : '#e5e5e5';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        background: bgCard,
        borderBottom: `1px solid ${borderMuted}`,
        flexShrink: 0,
      }}
    >
      <Button
        size="small"
        type="text"
        icon={<ChevronLeft size={14} />}
        disabled={currentIndex <= 0}
        onClick={onPrev}
        style={{ color: textColor, fontSize: 11 }}
      >
        上一镜
      </Button>
      <span
        style={{
          flex: 1,
          textAlign: 'center',
          fontSize: 12,
          fontWeight: 600,
          color: accent,
          whiteSpace: 'nowrap',
        }}
      >
        Step {currentIndex + 1}/{totalSteps}
      </span>
      <Button
        size="small"
        type="text"
        icon={<ChevronRight size={14} />}
        disabled={currentIndex >= totalSteps - 1}
        onClick={onNext}
        style={{ color: textColor, fontSize: 11 }}
      >
        下一镜
      </Button>
      <div style={{ width: 1, height: 16, background: borderMuted, margin: '0 2px' }} />
      <Button
        size="small"
        type="text"
        icon={<List size={14} />}
        onClick={onBackToList}
        style={{ color: mutedColor, fontSize: 11 }}
      >
        列表
      </Button>
    </div>
  );
}