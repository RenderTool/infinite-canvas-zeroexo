/**
 * ReferenceChip - 引用徽标
 *
 * 显示已选中的节点引用，带 ✕ 移除。
 * 点击放大/查看详情（预留）。
 */

import { type CSSProperties } from 'react';
import { X, Image, Clapperboard, Music, FileText, Paperclip, type LucideIcon } from 'lucide-react';
import type { Reference } from '../types.js';
import { useAgentTheme } from '../context/theme-context.js';

const KIND_ICONS: Record<string, LucideIcon> = {
  image: Image,
  video: Clapperboard,
  audio: Music,
  text: FileText,
};

export interface ReferenceChipProps {
  references: Reference[];
  onRemove?: (nodeId: string) => void;
  onClick?: (ref: Reference) => void;
}

export function ReferenceChip({ references, onRemove, onClick }: ReferenceChipProps): React.ReactElement {
  const t = useAgentTheme();

  if (references.length === 0) return <></>;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        padding: '4px 0',
      }}
    >
      {references.map((ref) => {
        const KindIcon = KIND_ICONS[ref.kind] ?? Paperclip;
        return (
          <div
            key={ref.nodeId}
            onClick={() => onClick?.(ref)}
            style={chipStyle(t)}
            title={ref.label}
          >
            <span style={{ fontSize: 12, lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}>
              <KindIcon size={12} />
            </span>
            <span
              style={{
                fontSize: 11.5,
                color: t.text,
                maxWidth: 80,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {ref.label}
            </span>
            {onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(ref.nodeId);
                }}
                style={removeBtnStyle}
                aria-label={`移除 ${ref.label}`}
              >
                <X size={10} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

const chipStyle = (t: ReturnType<typeof useAgentTheme>): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  borderRadius: 6,
  border: `1px solid ${t.isDark ? '#334155' : '#e2e8f0'}`,
  background: t.isDark ? '#0f172a' : '#f8fafc',
  cursor: 'pointer',
  userSelect: 'none',
  transition: 'all 0.12s',
});

const removeBtnStyle: CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: '50%',
  border: 'none',
  background: 'rgba(128,128,128,0.15)',
  color: '#94a3b8',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  lineHeight: 1,
  transition: 'background 0.1s',
  flexShrink: 0,
};