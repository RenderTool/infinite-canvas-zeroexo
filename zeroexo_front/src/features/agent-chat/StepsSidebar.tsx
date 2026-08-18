/**
 * StepsSidebar - 通用右侧垂直步骤条
 *
 * 数据驱动：由 AgentStepGroup[]（步骤组）+ confirmedKeys + currentKey 渲染。
 * - 已完成步骤：绿色勾
 * - 当前步骤所在组：accent 高亮 + 光晕
 * - 待处理组：灰色圆点
 * - 点击跳转（仅已完成组/当前组可点）
 * - hover 显示截断下游按钮（存在下游已确认步骤时）
 *
 * 主题由调用方注入 AgentThemeTokens，不依赖具体主题系统。
 * 立项的 RightStepSidebar 已委托本组件实现（见 agent-setup 接入）。
 */

import { useState, type CSSProperties } from 'react';
import { Tooltip } from 'antd';
import { Check, Unlink } from 'lucide-react';
import type { AgentStepGroup, AgentThemeTokens } from './types.js';

export interface StepsSidebarProps {
  /** 步骤组数据 */
  groups: AgentStepGroup[];
  /** 已确认的步骤 key 列表 */
  confirmedKeys: string[];
  /** 当前步骤 key（用于定位当前组高亮） */
  currentKey: string | null;
  /** 主题 tokens（由调用方注入） */
  theme: AgentThemeTokens;
  /** 根节点标题（如 "项目立项"） */
  rootTitle?: string;
  /** 根节点状态文案（如 "进行中"/"已完成"） */
  rootStatus?: string;
  onStepClick?: (groupKey: string) => void;
  /** 截断下游：清除该组之后的所有已确认步骤 */
  onTruncate?: (groupKey: string) => void;
  /** 位置：left = 左侧导航，right = 右侧助手（默认） */
  position?: 'left' | 'right';
}

export function StepsSidebar({
  groups,
  confirmedKeys,
  currentKey,
  theme,
  rootTitle = 'Agent 流程',
  rootStatus,
  onStepClick,
  onTruncate,
  position = 'right',
}: StepsSidebarProps): React.ReactElement {
  const confirmedSet = new Set(confirmedKeys);
  const allStepKeys = groups.flatMap((g) => g.steps.map((s) => s.key));
  const doneCount = confirmedKeys.length;
  const totalCount = allStepKeys.length;

  const currentGroupKey = currentKey
    ? (groups.find((g) => g.steps.some((s) => s.key === currentKey))?.key ?? groups[0]?.key ?? null)
    : (groups[0]?.key ?? null);

  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const hasDownstreamConfirmed = (groupIdx: number): boolean => {
    return groups.slice(groupIdx + 1).some((g) => g.steps.some((s) => confirmedSet.has(s.key)));
  };

  return (
    <aside style={containerStyle(theme, position)}>
      <div style={treeWrapStyle}>
        {/* Root */}
        <div style={rootNodeStyle(theme)}>
          <div style={rootLabelStyle(theme)}>{rootTitle}</div>
          <div style={rootValueStyle(theme)}>{rootStatus ?? (doneCount === totalCount ? '已完成' : '进行中')}</div>
          {totalCount > 0 && (
            <span style={{ ...progressBadgeStyle(theme), ...progressBadgeInRootStyle }}>
              {doneCount}/{totalCount}
            </span>
          )}
        </div>

        {groups.map((group, groupIdx) => {
          const groupConfirmed = group.steps.every((s) => confirmedSet.has(s.key));
          const isCurrentGroup = group.key === currentGroupKey;
          const someDone = group.steps.some((s) => confirmedSet.has(s.key));
          const clickable = groupConfirmed || isCurrentGroup;
          const subDone = group.steps.filter((s) => confirmedSet.has(s.key)).length;

          return (
            <div key={group.key} style={branchContainerStyle}>
              {/* 连接线 */}
              <div style={connectorLineStyle(groupConfirmed || someDone, theme)} />

              {/* 节点 */}
              <Tooltip title={group.description}>
              <button
                style={nodeStyle(groupConfirmed, isCurrentGroup, theme, clickable)}
                onClick={() => clickable && onStepClick?.(group.key)}
                disabled={!clickable}
                onMouseEnter={() => setHoveredKey(group.key)}
                onMouseLeave={() => setHoveredKey(null)}
              >
                {/* 左侧状态指示 */}
                <div style={statusDotStyle(groupConfirmed, isCurrentGroup, theme)}>
                  {groupConfirmed ? (
                    <Check size={10} strokeWidth={3} />
                  ) : isCurrentGroup ? (
                    <span style={activeDotStyle} />
                  ) : null}
                </div>

                {/* 内容 */}
                <div style={nodeContentStyle}>
                  <div style={nodeLabelRowStyle}>
                    {group.icon && <span style={nodeIconStyle}>{group.icon}</span>}
                    <span style={nodeLabelStyle(groupConfirmed, isCurrentGroup, theme)}>
                      {group.label}
                    </span>
                  </div>
                  <div style={nodeDescStyle(theme)}>
                    {group.description}
                  </div>
                </div>

                {/* 组内进度 */}
                <div style={subProgressStyle(groupConfirmed, isCurrentGroup, theme)}>
                  {subDone}/{group.steps.length}
                </div>

                {/* 截断下游按钮 — hover 时显示 */}
                {hasDownstreamConfirmed(groupIdx) && (
                  <div
                    style={{
                      ...truncateBtnWrapStyle,
                      opacity: hoveredKey === group.key ? 1 : 0,
                    }}
                  >
                    <Tooltip title="截断下游步骤">
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          onTruncate?.(group.key);
                        }}
                      >
                        <div style={truncateBtnStyle(theme.accent)}>
                          <Unlink size={10} />
                        </div>
                      </div>
                    </Tooltip>
                  </div>
                )}
              </button>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ===== 样式 =====

const SIDEBAR_WIDTH = 220;

const containerStyle = (theme: AgentThemeTokens, position: 'left' | 'right' = 'right'): CSSProperties => ({
  width: SIDEBAR_WIDTH,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  ...(position === 'right'
    ? { borderLeft: `1px solid ${theme.cardBorder}` }
    : { borderRight: `1px solid ${theme.cardBorder}` }),
  overflow: 'hidden',
});

const progressBadgeStyle = (theme: AgentThemeTokens): CSSProperties => ({
  fontSize: 10,
  fontWeight: 600,
  padding: '2px 7px',
  borderRadius: 8,
  background: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  color: theme.isDark ? '#aaa' : '#777',
  lineHeight: '16px',
});

const progressBadgeInRootStyle: CSSProperties = {
  position: 'absolute',
  right: 10,
  bottom: 8,
};

const treeWrapStyle: CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: '8px 10px',
};

const rootNodeStyle = (theme: AgentThemeTokens): CSSProperties => ({
  position: 'relative',
  padding: '8px 12px',
  paddingRight: 60,
  borderRadius: 8,
  background: theme.cardBg,
  border: `1px solid ${theme.cardBorder}`,
  marginBottom: 8,
  cursor: 'default',
});

const rootLabelStyle = (theme: AgentThemeTokens): CSSProperties => ({
  fontSize: 10,
  color: theme.mutedColor,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  fontWeight: 600,
  marginBottom: 2,
});

const rootValueStyle = (theme: AgentThemeTokens): CSSProperties => ({
  fontSize: 12,
  color: theme.labelColor,
  fontWeight: 500,
});

const branchContainerStyle: CSSProperties = {
  position: 'relative',
  paddingLeft: 20,
  marginBottom: 4,
};

const connectorLineStyle = (
  active: boolean,
  theme: AgentThemeTokens,
): CSSProperties => ({
  position: 'absolute',
  left: 8,
  top: 0,
  bottom: 0,
  width: 2,
  background: active
    ? theme.accent
    : (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'),
  borderRadius: 1,
});

const nodeStyle = (
  done: boolean,
  current: boolean,
  theme: AgentThemeTokens,
  clickable: boolean,
): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 10px',
  borderRadius: 8,
  position: 'relative',
  border: `1px solid ${current ? theme.accent : theme.cardBorder}`,
  background: current
    ? `${theme.accent}12`
    : done
      ? (theme.isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)')
      : theme.cardBg,
  cursor: clickable ? 'pointer' : 'default',
  transition: 'all 0.15s',
  opacity: (!done && !current) ? 0.6 : 1,
  boxShadow: current ? `0 0 12px ${theme.accent}33` : 'none',
  textAlign: 'left',
  fontFamily: 'inherit',
});

const statusDotStyle = (
  done: boolean,
  current: boolean,
  theme: AgentThemeTokens,
): CSSProperties => ({
  width: 18,
  height: 18,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  ...(done
    ? {
        background: '#10b981',
        color: '#fff',
      }
    : current
      ? {
          background: `${theme.accent}20`,
          border: `2px solid ${theme.accent}`,
        }
      : {
          background: 'transparent',
          border: `1.5px solid ${theme.isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)'}`,
        }),
});

const activeDotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'currentColor',
};

const nodeContentStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const nodeLabelRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  marginBottom: 2,
};

const nodeIconStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 11,
  width: 16,
  height: 16,
  flexShrink: 0,
};

const nodeLabelStyle = (
  done: boolean,
  current: boolean,
  theme: AgentThemeTokens,
): CSSProperties => ({
  fontSize: 12,
  fontWeight: current ? 600 : 500,
  color: done ? '#10b981' : current ? theme.accent : theme.labelColor,
});

const nodeDescStyle = (theme: AgentThemeTokens): CSSProperties => ({
  fontSize: 10,
  color: theme.mutedColor,
  lineHeight: 1.3,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

const subProgressStyle = (
  done: boolean,
  current: boolean,
  theme: AgentThemeTokens,
): CSSProperties => ({
  fontSize: 10,
  fontWeight: 600,
  flexShrink: 0,
  color: done ? '#10b981' : current ? theme.accent : (theme.isDark ? '#666' : '#999'),
  padding: '0 3px',
});

const truncateBtnWrapStyle: CSSProperties = {
  position: 'absolute',
  right: -6,
  top: -6,
  zIndex: 1,
  transition: 'opacity 0.15s',
};

const truncateBtnStyle = (accent: string): CSSProperties => ({
  width: 20,
  height: 20,
  borderRadius: '50%',
  background: accent,
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
  transition: 'transform 0.15s',
});
