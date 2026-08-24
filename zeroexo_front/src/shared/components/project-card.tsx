/**
 * ProjectCard - 通用项目卡片
 *
 * 用法:
 * - <ProjectCard variant="create" onClick={handleCreate} />
 * - <ProjectCard title="..." updateTime="..." onClick={...} actions={[...]} />
 *
 * 特性:
 * - variant: 'create' 显示空白创建样式; 'normal' 显示普通卡片
 * - 暗色模式自动适配
 * - 三点菜单位于卡片右下角(更新时同一行),点击弹下拉
 * - actions 数组里每一项可以是 'rename' / 'delete' / 自定义 {label, icon, danger, onClick}
 */

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Image as ImageIcon, MoreHorizontal, Pencil, Share2, Trash2 } from 'lucide-react';
import { Dropdown, Tag, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import { AuthorizedImage } from '@/shared/components/authorized-media.js';

export type ProjectCardVariant = 'normal' | 'create';

export type ProjectCardAction =
  | { type: 'copy'; label?: string; onClick: () => void }
  | { type: 'rename'; label?: string; onClick: () => void }
  | { type: 'delete'; label?: string; onClick: () => void }
  | { type: 'cover'; label?: string; onClick: () => void }
  | { type: 'collab'; label?: string; onClick: () => void }
  | { type: 'custom'; label: string; icon?: ReactNode; danger?: boolean; onClick: () => void };

/** 卡片右上角协作状态 Tag（tone 决定颜色） */
export interface ProjectCardStatusTag {
  label: string;
  tone: 'success' | 'processing' | 'warning' | 'error';
}

export interface ProjectCardProps {
  /** 卡片变体: normal 普通项目 / create 空白创建 */
  variant?: ProjectCardVariant;
  /** 标题 */
  title?: string;
  /** 更新时间(仅 normal 模式显示) */
  updateTime?: string;
  /** 封面图 URL(仅 normal 模式) */
  cover?: string;
  /** 整体点击事件(空白创建卡片/正面打开项目) */
  onClick?: () => void;
  /** 点击三点按钮后显示的操作列表 */
  actions?: ProjectCardAction[];
  /** 是否选中（选择模式） */
  selected?: boolean;
  /** 切换选中回调（提供此 prop 会显示复选框） */
  onToggleSelect?: () => void;
  /** 右上角状态 Tag（如"协作中/我参与的/已失效"） */
  statusTag?: ProjectCardStatusTag;
  /** 失效蒙层：封面置灰 + 中央"已失效"提示（失效协作画布） */
  expiredOverlay?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 自定义样式 */
  style?: CSSProperties;
}

const ICON_SIZE = 14;

export function ProjectCard({
  variant = 'normal',
  title,
  updateTime,
  cover,
  onClick,
  actions,
  selected = false,
  onToggleSelect,
  statusTag,
  expiredOverlay = false,
  className,
  style,
}: ProjectCardProps): React.ReactElement {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const isDark = theme.mode === 'dark';
  const isCreate = variant === 'create';
  const hasActions = !!actions && actions.length > 0;

  const [hovered, setHovered] = useState(false);
  const [coverError, setCoverError] = useState(false);

  // 通过 getResourceUrl 获取封面 URL(不拼接 token,私有资源由 AuthorizedImage 经 fetch + Authorization header 加载)
  const coverUrl = cover ? (getResourceUrl(cover, 'full') ?? cover) : undefined;

  // 封面 URL 变化时重置 coverError，使新封面能重新尝试加载
  useEffect(() => {
    setCoverError(false);
  }, [coverUrl]);

  const handleCardClick = () => {
    onClick?.();
  };

  // ---- 辅助函数(先定义再使用,避免 TDZ) ----
  const renderActionIcon = (action: ProjectCardAction): ReactNode => {
    if (action.type === 'copy') return <Copy size={ICON_SIZE} />;
    if (action.type === 'rename') return <Pencil size={ICON_SIZE} />;
    if (action.type === 'delete') return <Trash2 size={ICON_SIZE} />;
    if (action.type === 'cover') return <ImageIcon size={ICON_SIZE} />;
    if (action.type === 'collab') return <Share2 size={ICON_SIZE} />;
    return action.icon ?? null;
  };

  const renderActionLabel = (action: ProjectCardAction): string => {
    if (action.type === 'copy') return action.label ?? t('projectCard.copyProject');
    if (action.type === 'rename') return action.label ?? t('projectCard.renameProject');
    if (action.type === 'delete') return action.label ?? t('projectCard.deleteProject');
    if (action.type === 'cover') return action.label ?? t('projectCard.setCover');
    if (action.type === 'collab') return action.label ?? t('projectCard.collaboration');
    return action.label;
  };

  const isActionDanger = (action: ProjectCardAction): boolean => {
    if (action.type === 'delete') return true;
    if (action.type === 'copy') return false;
    if (action.type === 'cover') return false;
    if (action.type === 'collab') return false;
    if (action.type === 'custom') return !!action.danger;
    return false;
  };

  // 将 actions 转为 antd MenuProps['items'] 格式
  const dropdownItems: MenuProps['items'] = useMemo(() => {
    if (!actions) return [];
    return actions.map((action, i) => {
      const danger = isActionDanger(action);
      return {
        key: String(i),
        icon: renderActionIcon(action),
        label: renderActionLabel(action),
        danger,
        onClick: (e) => {
          e.domEvent.stopPropagation();
          action.onClick();
        },
      };
    });
  }, [actions]);

  // 封面背景：normal 模式统一为白(亮) / 与 create 一致(暗)
  const coverBg = isDark
    ? 'rgba(255,255,255,0.02)'
    : '#ffffff';
  const coverBorder = isDark
    ? isCreate
      ? `1px dashed rgba(255,255,255,0.2)`
      : `1px solid rgba(255,255,255,0.06)`
    : isCreate
      ? `1px dashed #d4d4d8`
      : `1px solid #e5e7eb`;

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: '100%',
        cursor: 'pointer',
        ...style,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 封面区域 */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '239.2 / 135.4',
          borderRadius: 12,
          overflow: 'hidden',
          background: coverBg,
          border: coverBorder,
        }}
        onClick={handleCardClick}
      >
        {/* 选择模式复选框 */}
        {onToggleSelect && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: 8,
              zIndex: 3,
              cursor: 'pointer',
            }}
            onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                border: `2px solid ${selected ? theme.toolbar.accent : '#fff'}`,
                background: selected ? theme.toolbar.accent : 'rgba(0,0,0,0.2)',
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
        )}
        {/* 右上角状态 Tag（协作中/我参与的/已失效） */}
        {statusTag && !onToggleSelect && (
          <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 3 }}>
            <Tag
              color={statusTag.tone}
              style={{
                marginInlineEnd: 0,
                fontSize: 11,
                lineHeight: '18px',
                borderRadius: 4,
                border: 'none',
              }}
            >
              {statusTag.label}
            </Tag>
          </div>
        )}
        {isCreate ? (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="24" height="24" viewBox="0 0 14 14" fill="none" style={{ color: theme.toolbar.textMuted }}>
              <path
                fill="currentColor"
                fillRule="evenodd"
                d="M6.417 2.917a.583.583 0 0 1 1.166 0v3.5h3.5a.583.583 0 0 1 0 1.166h-3.5v3.5a.583.583 0 1 1-1.166 0v-3.5h-3.5a.583.583 0 1 1 0-1.166h3.5z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        ) : (
          <>
            {coverUrl && !coverError ? (
              <AuthorizedImage
                src={coverUrl}
                alt={title}
                onError={() => setCoverError(true)}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                color: theme.toolbar.textMuted,
              }}>
                {t('projectCard.noCover')}
              </div>
            )}
          </>
        )}
        {/* Hover 遮罩 */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.05)',
          opacity: hovered && !isCreate ? 1 : 0,
          transition: 'opacity 0.3s',
          pointerEvents: 'none',
        }} />
        {/* 失效蒙层（失效协作画布：置灰 + 中央提示） */}
        {expiredOverlay && (
          <div style={{
            position: 'absolute',
            inset: 0,
            zIndex: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isDark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.55)',
            backdropFilter: 'saturate(0.6)',
            pointerEvents: 'none',
          }}>
            <span style={{
              fontSize: 13,
              fontWeight: 500,
              color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.65)',
              padding: '4px 12px',
              borderRadius: 6,
              background: isDark ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.8)',
            }}>
              {t('projectCard.expired')}
            </span>
          </div>
        )}
      </div>

      {/* 底部信息 */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 2,
        minHeight: isCreate ? 42 : 'auto',
        paddingLeft: 4,
        paddingRight: 4,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          height: 24,
        }}>
          <span style={{
            fontSize: 14,
            lineHeight: '22px',
            fontWeight: 500,
            color: theme.toolbar.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}>
            {title || (isCreate ? t('projectCard.newProject') : t('projectCard.untitledProject'))}
          </span>
        </div>
        {!isCreate && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}>
            <div style={{
              fontSize: 11,
              lineHeight: '16px',
              color: theme.toolbar.textMuted,
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}>
              {updateTime || ''}
            </div>
            {hasActions && (
              <Dropdown
                menu={{ items: dropdownItems }}
                trigger={['click']}
                placement="bottomRight"
              >
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    flexShrink: 0,
                    width: 24,
                    height: 24,
                    padding: 0,
                    border: 'none',
                    borderRadius: 6,
                    background: 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: theme.toolbar.textMuted,
                    opacity: hovered ? 1 : 0,
                    transition: 'opacity 0.2s, background 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <Tooltip title={t('projectCard.moreActions')}>
                    <MoreHorizontal size={14} />
                  </Tooltip>
                </button>
              </Dropdown>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
