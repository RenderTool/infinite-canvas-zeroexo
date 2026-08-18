/**
 * EpisodeContainerView - 剧集容器节点视图
 *
 * 聚合展示多集信息，支持：
 * - 顶部导航栏（剧集切换）
 * - 内容区（摘要展示）
 * - 底部状态栏（总集数/总时长/总场次）
 * - 数据懒加载（通过 data 的 loading 状态控制）
 * - [展开] 按钮 → 全屏阅读器 Modal
 */

import { useCallback, useState } from 'react';import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Book, ChevronLeft, ChevronRight, Maximize2, Clock, Layers, List } from 'lucide-react';
import type { NodeRendererProps } from '@zeroexo/core';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import { useTheme } from '@zeroexo/plugin-theme';
import { BaseNodeView } from '@zeroexo/plugin-nodes';
import { Modal, Tooltip } from 'antd';

/** 剧集条目 */
export interface EpisodeItem {
  id: string;
  number: number;
  title: string;
  summary: string;
  sceneCount: number;
  estimatedDuration: number;
}

/** 剧集容器节点数据 */
export interface EpisodeContainerData {
  title: string;
  status: 'idle' | 'ready' | 'loading';
  episodes: EpisodeItem[];
  totalDuration: number;
  totalScenes: number;
  activeEpisodeIndex: number;
  expanded: boolean;
}

export function EpisodeContainerView({
  node,
  pins,
  isSelected,
  isHovered,
  forceShowPins,
  updateNode,
  invK,
  externalRenaming,
  onRenameFinish,
  store,
}: NodeRendererProps & { store?: ReactGraphStore | null }): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  const data = (node.data ?? {}) as EpisodeContainerData;
  const episodes = data.episodes ?? [];
  const activeIndex = data.activeEpisodeIndex ?? 0;
  const activeEpisode = episodes[activeIndex];
  const isLoading = data.status === 'loading';

  // 导航
  const canPrev = activeIndex > 0;
  const canNext = activeIndex < episodes.length - 1;

  const handlePrev = useCallback(() => {
    if (!canPrev) return;
    const nextIndex = activeIndex - 1;
    updateNode({ data: { ...data, activeEpisodeIndex: nextIndex } });
  }, [updateNode, data, canPrev, activeIndex]);

  const handleNext = useCallback(() => {
    if (!canNext) return;
    const nextIndex = activeIndex + 1;
    updateNode({ data: { ...data, activeEpisodeIndex: nextIndex } });
  }, [updateNode, data, canNext, activeIndex]);

  const handleExpand = useCallback(() => {
    setFullscreenOpen(true);
  }, []);

  const handleFullscreenClose = useCallback(() => {
    setFullscreenOpen(false);
  }, []);

  const nodeColor = theme.node.fill;
  const title = node.title ?? data.title ?? t('canvasNodes.stage.episodeContainer');

  // 懒加载骨架
  if (isLoading) {
    return (
      <BaseNodeView
        node={node}
        pins={pins}
        isSelected={isSelected}
        isHovered={isHovered}
        title={title}
        color={nodeColor}
        forceShowPins={forceShowPins}
        invK={invK}
        titleIcon={<Book size={11 * (invK ?? 1)} />}
        updateNode={updateNode}
        externalRenaming={externalRenaming}
        onRenameFinish={onRenameFinish}
        contentPadding="0"
        store={store}
        connectionController={undefined as any}
      >
        <div style={contentShellStyle}>
          <div style={loadingStyle}>
            <div style={loadingSpinnerStyle} />
            <span style={loadingTextStyle}>{t('common.loading')}</span>
          </div>
        </div>
      </BaseNodeView>
    );
  }

  // 空状态
  if (episodes.length === 0) {
    return (
      <BaseNodeView
        node={node}
        pins={pins}
        isSelected={isSelected}
        isHovered={isHovered}
        title={title}
        color={nodeColor}
        forceShowPins={forceShowPins}
        invK={invK}
        titleIcon={<Book size={11 * (invK ?? 1)} />}
        updateNode={updateNode}
        externalRenaming={externalRenaming}
        onRenameFinish={onRenameFinish}
        contentPadding="0"
        store={store}
        connectionController={undefined as any}
      >
        <div style={contentShellStyle}>
          <div style={emptyStateStyle}>
            <Book size={24} opacity={0.3} />
            <span style={emptyTextStyle}>{t('canvasNodes.episodeContainer.empty')}</span>
          </div>
        </div>
      </BaseNodeView>
    );
  }

  return (
    <>
      <BaseNodeView
        node={node}
        pins={pins}
        isSelected={isSelected}
        isHovered={isHovered}
        title={title}
        color={nodeColor}
        forceShowPins={forceShowPins}
        invK={invK}
        titleIcon={<Book size={11 * (invK ?? 1)} />}
        updateNode={updateNode}
        externalRenaming={externalRenaming}
        onRenameFinish={onRenameFinish}
        contentPadding="0"
        store={store}
        connectionController={undefined as any}
      >
        <div style={contentShellStyle}>
          {/* 顶部导航栏 */}
          <div style={topNavStyle}>
            <Tooltip title={t('common.previous')}>
              <button
                type="button"
                style={{ ...navBtnStyle, opacity: canPrev ? 1 : 0.3 }}
                disabled={!canPrev}
                onClick={handlePrev}
              >
              <ChevronLeft size={14} />
            </button>
            </Tooltip>
            <span style={navTitleStyle}>
              {activeEpisode?.title ?? `#${activeIndex + 1}`}
            </span>
            <Tooltip title={t('common.next')}>
              <button
                type="button"
                style={{ ...navBtnStyle, opacity: canNext ? 1 : 0.3 }}
                disabled={!canNext}
                onClick={handleNext}
              >
              <ChevronRight size={14} />
            </button>
            </Tooltip>
            <div style={navSpacerStyle} />
            <Tooltip title={t('common.expand')}>
              <button
                type="button"
                style={expandBtnStyle}
                onClick={handleExpand}
              >
              <Maximize2 size={12} />
            </button>
            </Tooltip>
          </div>

          {/* 内容区 */}
          <div style={contentAreaStyle}>
            <p style={summaryStyle}>
              {activeEpisode?.summary || t('canvasNodes.episodeContainer.noSummary')}
            </p>
          </div>

          {/* 底部状态栏 */}
          <div style={bottomBarStyle}>
            <div style={statItemStyle}>
              <List size={11} />
              <span style={statLabelStyle}>{episodes.length}</span>
            </div>
            <div style={statItemStyle}>
              <Layers size={11} />
              <span style={statLabelStyle}>{data.totalScenes ?? 0}</span>
            </div>
            <div style={statItemStyle}>
              <Clock size={11} />
              <span style={statLabelStyle}>{formatDuration(data.totalDuration ?? 0)}</span>
            </div>
          </div>
        </div>
      </BaseNodeView>

      {/* 全屏阅读器 Modal */}
      <Modal
        open={fullscreenOpen}
        onCancel={handleFullscreenClose}
        footer={null}
        width="80vw"
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Book size={16} />
            <span>{title}</span>
          </div>
        }
      >
        <div style={fullscreenContentStyle}>
          {episodes.map((ep, idx) => (
            <div
              key={ep.id}
              style={{
                ...fullscreenEpisodeStyle,
                borderLeft: `3px solid ${idx === activeIndex ? '#10b981' : 'transparent'}`,
                background: idx === activeIndex ? 'rgba(16, 185, 129, 0.05)' : 'transparent',
              }}
            >
              <div style={fullscreenEpisodeHeaderStyle}>
                <span style={fullscreenEpisodeNumStyle}>#{ep.number}</span>
                <span style={fullscreenEpisodeTitleStyle}>{ep.title}</span>
                <span style={fullscreenEpisodeMetaStyle}>
                  {ep.sceneCount} 场 · {formatDuration(ep.estimatedDuration)}
                </span>
              </div>
              <p style={fullscreenSummaryStyle}>{ep.summary || t('canvasNodes.episodeContainer.noSummary')}</p>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}

/** 格式化时长(分钟 → "Xh Ym" 或 "Xm") */
function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ===== Styles =====

const contentShellStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  boxSizing: 'border-box',
};

const topNavStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '6px 8px',
  gap: 4,
  borderBottom: '1px solid rgba(128,128,128,0.15)',
  flexShrink: 0,
};

const navBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  cursor: 'pointer',
  color: 'inherit',
  padding: 0,
};

const navTitleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 120,
};

const navSpacerStyle: CSSProperties = {
  flex: 1,
};

const expandBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  border: 'none',
  borderRadius: 4,
  background: 'rgba(128,128,128,0.1)',
  cursor: 'pointer',
  color: 'inherit',
  padding: 0,
};

const contentAreaStyle: CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  padding: '8px 10px',
  minHeight: 0,
};

const summaryStyle: CSSProperties = {
  fontSize: 11,
  lineHeight: 1.5,
  margin: 0,
  display: '-webkit-box',
  WebkitLineClamp: 4,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  color: 'rgba(128,128,128,0.8)',
};

const bottomBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-around',
  padding: '4px 8px',
  borderTop: '1px solid rgba(128,128,128,0.15)',
  flexShrink: 0,
  gap: 8,
};

const statItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 10,
  color: 'rgba(128,128,128,0.7)',
};

const statLabelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
};

const loadingStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  gap: 8,
};

const loadingSpinnerStyle: CSSProperties = {
  width: 20,
  height: 20,
  border: '2px solid rgba(128,128,128,0.2)',
  borderTopColor: '#10b981',
  borderRadius: '50%',
  animation: 'spin 0.8s linear infinite',
};

const loadingTextStyle: CSSProperties = {
  fontSize: 11,
  color: 'rgba(128,128,128,0.6)',
};

const emptyStateStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  gap: 8,
  color: 'rgba(128,128,128,0.4)',
};

const emptyTextStyle: CSSProperties = {
  fontSize: 11,
};

const fullscreenContentStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '4px 0',
};

const fullscreenEpisodeStyle: CSSProperties = {
  padding: '12px 16px',
  borderRadius: 8,
};

const fullscreenEpisodeHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 6,
};

const fullscreenEpisodeNumStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: '#10b981',
  minWidth: 24,
};

const fullscreenEpisodeTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  flex: 1,
};

const fullscreenEpisodeMetaStyle: CSSProperties = {
  fontSize: 11,
  color: 'rgba(128,128,128,0.6)',
};

const fullscreenSummaryStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.6,
  margin: 0,
  color: 'rgba(128,128,128,0.8)',
};