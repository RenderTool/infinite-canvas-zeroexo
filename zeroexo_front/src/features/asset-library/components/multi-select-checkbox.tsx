/**
 * multi-select-checkbox - 多选复选框组件
 *
 * 消除网格视图中 3 次重复的多选复选框 JSX。
 * 征集 #87 验收轮十九：新增 inline 模式（flex 流内占位），层级列表行复用同款框（颜色/样式/尺寸一致）。
 */

import { Check } from 'lucide-react';

interface MultiSelectCheckboxProps {
  selected: boolean;
  onToggle: () => void;
  accentColor: string;
  /** 定位模式：默认 absolute 覆盖卡片左上角；inline 为流内占位（层级列表行用） */
  inline?: boolean;
}

export function MultiSelectCheckbox({
  selected,
  onToggle,
  accentColor,
  inline = false,
}: MultiSelectCheckboxProps): React.ReactElement {
  const box = (
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
  );

  return (
    <div
      style={inline
        ? { cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
        : { position: 'absolute', top: 8, left: 8, zIndex: 3, cursor: 'pointer' }}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
    >
      {box}
    </div>
  );
}