/**
 * multi-select-checkbox - 多选复选框组件
 *
 * 消除网格视图中 3 次重复的多选复选框 JSX。
 */

import { Check } from 'lucide-react';

interface MultiSelectCheckboxProps {
  selected: boolean;
  onToggle: () => void;
  accentColor: string;
}

export function MultiSelectCheckbox({
  selected,
  onToggle,
  accentColor,
}: MultiSelectCheckboxProps): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        zIndex: 3,
        cursor: 'pointer',
      }}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: 4,
          border: `2px solid ${selected ? accentColor : '#fff'}`,
          background: selected ? accentColor : 'rgba(0,0,0,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 1,
          transition: 'opacity 0.15s',
        }}
      >
        {selected && <Check size={12} color="#fff" />}
      </div>
    </div>
  );
}