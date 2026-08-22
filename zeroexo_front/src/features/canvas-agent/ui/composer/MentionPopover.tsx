/**
 * MentionPopover - @ 提及节点选择浮层
 *
 * 输入 @ 时弹出节点选择浮层，搜索/过滤画布节点。
 * 选择后插入 @标签 + 同步到引用列表。
 * - 节点数据通过 useCanvasContext 实时读取（打开期间轻量轮询，节点增删/改名即时生效）
 * - 列表图标使用 Lucide 按类型映射（无缩略图场景）
 * - 浮层背景不透明（--agent-bg 纯色），避免透出下层内容
 */

import { useEffect, useRef, useState } from 'react';
import { Search, FileText, Image as ImageIcon, Film, AudioLines, Wand2, Folder, File, type LucideIcon } from 'lucide-react';
import { useCanvasContext } from '../context/canvas-context.js';
import { useAgentTheme } from '../context/theme-context.js';

/** 节点类型 → Lucide 图标（与全局图标规范一致，无色、随主题文字色） */
const TYPE_ICONS: Record<string, LucideIcon> = {
  text: FileText,
  image: ImageIcon,
  video: Film,
  audio: AudioLines,
  generator: Wand2,
  group: Folder,
};

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
  const [nodes, setNodes] = useState(() => ctx.getNodes());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // 实时读取:画布节点可能在浮层打开期间变化（新增/删除/重命名）
  useEffect(() => {
    const timer = setInterval(() => {
      setNodes((prev) => {
        const next = ctx.getNodes();
        const changed =
          next.length !== prev.length ||
          next.some(
            (n, i) =>
              n.id !== prev[i]?.id ||
              n.title !== prev[i]?.title ||
              n.type !== prev[i]?.type,
          );
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [ctx]);

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

  // 背景不透明:纯色面板,不透出画布
  const bgColor = 'var(--agent-bg)';

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
        boxShadow: 'var(--agent-shadow)',
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
          borderBottom: '1px solid var(--agent-border)',
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
          filtered.map((node, i) => {
            const Icon = TYPE_ICONS[node.type] ?? File;
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => onSelect(node)}
                onMouseEnter={() => setSelectedIndex(i)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: i === selectedIndex
                    ? 'var(--agent-surface-2)'
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
                    background: 'var(--agent-surface)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: t.textMuted,
                    flexShrink: 0,
                    border: '1px solid var(--agent-border)',
                  }}
                >
                  <Icon size={12} />
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
            );
          })
        )}
      </div>
    </div>
  );
}
