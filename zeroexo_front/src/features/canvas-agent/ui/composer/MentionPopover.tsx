/**
 * MentionPopover - @ 提及节点选择浮层
 *
 * 输入 @ 时弹出节点选择浮层，搜索/过滤画布节点。
 * 选择后插入 @标签 + 同步到引用列表。
 * 使用 useCanvasContext 获取画布节点列表。
 */

import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useCanvasContext } from '../context/canvas-context.js';
import { useAgentTheme } from '../context/theme-context.js';

export interface MentionPopoverProps {
  /** 搜索关键词 */
  search: string;
  /** 浮层位置（相对于输入框） */
  position: { top: number; left: number };
  /** 选中节点回调 */
  onSelect: (node: { id: string; title: string; type: string }) => void;
  /** 关闭 */
  onClose: () => void;
}

export function MentionPopover({
  search,
  position,
  onSelect,
  onClose,
}: MentionPopoverProps): React.ReactElement {
  const t = useAgentTheme();
  const ctx = useCanvasContext();
  const [nodes] = useState(() => ctx.getNodes());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = !search
    ? nodes
    : nodes.filter(
        (n) =>
          n.title.toLowerCase().includes(search.toLowerCase()) ||
          n.type.toLowerCase().includes(search.toLowerCase()),
      );

  // 键盘导航
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered[selectedIndex]) {
        e.preventDefault();
        onSelect(filtered[selectedIndex]);
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [filtered, selectedIndex, onSelect, onClose]);

  // 点击外部关闭
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const bgColor = t.isDark ? '#1e293b' : '#ffffff';

  return (
    <div
      ref={listRef}
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        width: 260,
        maxHeight: 280,
        borderRadius: 12,
        background: bgColor,
        border: `1px solid ${t.border}`,
        boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        zIndex: 1000,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 搜索头 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderBottom: `1px solid ${t.isDark ? '#334155' : '#e2e8f0'}`,
        }}
      >
        <Search size={13} color={t.textMuted} />
        <span style={{ fontSize: 12, color: t.textMuted }}>
          {search ? `搜索 "${search}"` : '选择节点'}
        </span>
      </div>

      {/* 列表 */}
      <div className="agent-scrollbar" style={{ overflowY: 'auto', flex: 1 }}>
        {filtered.length === 0 ? (
          <div
            style={{
              padding: '20px 14px',
              textAlign: 'center',
              fontSize: 12,
              color: t.textMuted,
            }}
          >
            未找到节点
          </div>
        ) : (
          filtered.map((node, i) => (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelect(node)}
              onMouseEnter={() => setSelectedIndex(i)}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: i === selectedIndex
                  ? (t.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)')
                  : 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                textAlign: 'left',
                fontFamily: 'inherit',
                transition: 'background 0.1s',
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: t.isDark ? '#0f172a' : '#f1f5f9',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  color: t.textMuted,
                  flexShrink: 0,
                  border: `1px solid ${t.isDark ? '#334155' : '#e2e8f0'}`,
                }}
              >
                {node.type.slice(0, 2).toUpperCase()}
              </span>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: t.text,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {node.title || '未命名节点'}
                </div>
                <div style={{ fontSize: 10, color: t.textMuted }}>
                  {node.type}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}