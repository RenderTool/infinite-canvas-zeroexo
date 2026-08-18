/**
 * StackedPreview - Version Folder 叠卡预览组件
 *
 * 渲染为紧凑的叠卡 deck(参考 StackedCardsDeck):
 * - 3 张卡片堆叠效果,最上面为当前激活版本
 * - 底部导航: Prev / 计数器 / Next
 * - 右上角展开按钮(切换到 Grid Mode)
 * - 切换动画:滑出/滑入
 */
import React, { useState, useCallback, useRef } from 'react';
import type { SceneNode } from '@zeroexo/core';
import { VF_PREVIEW_WIDTH, VF_PREVIEW_HEIGHT, GROUP_Z_INDEX } from './constants.js';

interface StackedPreviewProps {
  group: SceneNode;
  children: SceneNode[];
  /** 当前激活版本 ID */
  activeVersionId: string;
  /** 切换版本回调 */
  onSwitchVersion: (newVersionId: string) => void;
  /** 展开到 Grid Mode 回调 */
  onExpand: () => void;
  /** 视口缩放逆值(1/k) */
  invK: number;
  /** 是否选中 */
  isSelected: boolean;
  /** 组 pointerdown 回调 */
  onGroupPointerDown?: (e: React.PointerEvent, groupId: string) => void;
  /** 组双击回调 */
  onGroupDoubleClick?: (e: React.MouseEvent, groupId: string) => void;
}

export const StackedPreview = React.memo(function StackedPreview({
  group,
  children,
  activeVersionId,
  onSwitchVersion,
  onExpand,
  invK,
  onGroupPointerDown,
  onGroupDoubleClick,
}: StackedPreviewProps): React.ReactElement {
  const [animDir, setAnimDir] = useState<'left' | 'right' | null>(null);
  const [animating, setAnimating] = useState(false);
  const [prevActiveId, setPrevActiveId] = useState(activeVersionId);
  const deckRef = useRef<HTMLDivElement>(null);

  const currentIndex = children.findIndex((c) => c.id === activeVersionId);
  const total = children.length;

  // 切换动画
  const handlePrev = useCallback(() => {
    if (animating || currentIndex <= 0) return;
    const target = children[currentIndex - 1];
    if (!target) return;
    setAnimDir('right');
    setAnimating(true);
    setPrevActiveId(activeVersionId);
    setTimeout(() => {
      onSwitchVersion(target.id);
      setAnimating(false);
      setAnimDir(null);
    }, 300);
  }, [animating, currentIndex, children, onSwitchVersion, activeVersionId]);

  const handleNext = useCallback(() => {
    if (animating || currentIndex >= total - 1) return;
    const target = children[currentIndex + 1];
    if (!target) return;
    setAnimDir('left');
    setAnimating(true);
    setPrevActiveId(activeVersionId);
    setTimeout(() => {
      onSwitchVersion(target.id);
      setAnimating(false);
      setAnimDir(null);
    }, 300);
  }, [animating, currentIndex, total, children, onSwitchVersion, activeVersionId]);

  // 渲染卡片内容
  const renderCard = (child: SceneNode, isActive: boolean, index: number): React.ReactElement => {
    const isTop = isActive && !animating;
    // 计算堆叠偏移:最多3张
    const stackIndex = Math.min(index, 2);
    const offsetY = stackIndex * 4;
    const scale = 1 - stackIndex * 0.03;
    let opacity = isTop ? 1 : Math.max(0.2, 1 - stackIndex * 0.3);
    const zIndex = isTop ? 10 : 10 - stackIndex;

    // 动画状态
    let transform = `translateY(${offsetY}px) scale(${scale})`;
    let transition = 'transform .35s cubic-bezier(.34,1.56,.64,1), opacity .3s ease';

    if (animating && isActive) {
      // 新卡进入
      transform = `translateY(0) scale(1)`;
    } else if (animating && child.id === prevActiveId) {
      // 旧卡滑出
      const exitX = animDir === 'left' ? '-120%' : '120%';
      transform = `translateX(${exitX}) rotate(${animDir === 'left' ? -8 : 8}deg) scale(.9)`;
      opacity = 0;
    }

    return (
      <div
        key={child.id}
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 12 * invK,
          transform,
          opacity,
          zIndex,
          transition,
          willChange: 'transform',
          background: 'linear-gradient(145deg, #1e293b, #0f172a)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          overflow: 'hidden',
          padding: `${16 * invK}px`,
          display: 'flex',
          flexDirection: 'column',
          color: '#f1f5f9',
          fontSize: 12 * invK,
          cursor: 'grab',
        }}
      >
        {/* 类型标签 */}
        <div
          style={{
            fontSize: 9 * invK,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#818cf8',
            background: 'rgba(99,102,241,0.15)',
            padding: '2px 8px',
            borderRadius: 20 * invK,
            alignSelf: 'flex-start',
            marginBottom: 8 * invK,
          }}
        >
          {child.type}
        </div>
        {/* 标题 */}
        <h3
          style={{
            fontSize: 14 * invK,
            fontWeight: 700,
            color: '#f1f5f9',
            lineHeight: 1.3,
            margin: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {child.title || '未命名'}
        </h3>
        {/* 内容预览(取前100字符) */}
        <div
          style={{
            fontSize: 10 * invK,
            color: '#94a3b8',
            lineHeight: 1.5,
            marginTop: 6 * invK,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {(() => {
            const cardData = (child.data ?? {}) as Record<string, unknown>;
            const content =
              typeof cardData.content === 'string'
                ? cardData.content.slice(0, 150) + (cardData.content.length > 150 ? '...' : '')
                : '';
            const fallbackTitle = typeof cardData.title === 'string' ? cardData.title : '';
            const fallbackPrompt = typeof cardData.prompt === 'string' ? cardData.prompt : '';
            return content || fallbackTitle || fallbackPrompt || '无预览内容';
          })()}
        </div>
      </div>
    );
  };

  // 计算可见卡片(最多3张,以激活版本为中心)
  const visibleCards = React.useMemo(() => {
    if (animating) {
      // 动画期间:显示旧卡+新卡
      const prevCard = children.find((c) => c.id === prevActiveId);
      const currCard = children.find((c) => c.id === activeVersionId);
      const result: SceneNode[] = [];
      if (prevCard && prevCard.id !== currCard?.id) result.push(prevCard);
      if (currCard) result.push(currCard);
      // 补齐到3张
      for (const c of children) {
        if (result.length >= 3) break;
        if (!result.find((r) => r.id === c.id)) result.push(c);
      }
      return result;
    }
    // 正常显示:以激活版本为中心的3张
    const start = Math.max(0, currentIndex - 1);
    const end = Math.min(children.length, start + 3);
    return children.slice(start, end).reverse();
  }, [children, activeVersionId, currentIndex, animating, prevActiveId]);

  return (
    <div
      data-canvas-group-id={group.id}
      data-version-folder="stacked"
      onPointerDown={onGroupPointerDown ? (e) => onGroupPointerDown(e, group.id) : undefined}
      onDoubleClick={onGroupDoubleClick ? (e) => onGroupDoubleClick(e, group.id) : undefined}
      style={{
        position: 'absolute',
        left: group.position.x,
        top: group.position.y,
        width: VF_PREVIEW_WIDTH,
        height: VF_PREVIEW_HEIGHT,
        zIndex: GROUP_Z_INDEX + 1, // 在组之上
        pointerEvents: 'auto',
        userSelect: 'none',
      }}
    >
      {/* 叠卡容器 */}
      <div
        ref={deckRef}
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 12 * invK,
          overflow: 'hidden',
          background: 'transparent',
        }}
      >
        {visibleCards.map((child, i) => {
          const isActive = child.id === activeVersionId;
          return renderCard(child, isActive, i);
        })}
      </div>

      {/* 底部导航栏 */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 32 * invK,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `0 ${8 * invK}px`,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.5))',
          borderRadius: `0 0 ${12 * invK}px ${12 * invK}px`,
          zIndex: 20,
        }}
      >
        <button
          onClick={handlePrev}
          disabled={currentIndex <= 0 || animating}
          title="上一版本"
          style={{
            width: 24 * invK,
            height: 24 * invK,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(0,0,0,0.3)',
            color: currentIndex <= 0 ? '#475569' : '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: currentIndex <= 0 ? 'default' : 'pointer',
            padding: 0,
            fontSize: 12 * invK,
            lineHeight: 1,
            transition: 'background .2s',
          }}
        >
          ‹
        </button>
        <span style={{ fontSize: 10 * invK, color: '#64748b', minWidth: 40 * invK, textAlign: 'center' }}>
          {currentIndex + 1} / {total}
        </span>
        <button
          onClick={handleNext}
          disabled={currentIndex >= total - 1 || animating}
          title="下一版本"
          style={{
            width: 24 * invK,
            height: 24 * invK,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(0,0,0,0.3)',
            color: currentIndex >= total - 1 ? '#475569' : '#94a3b8',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: currentIndex >= total - 1 ? 'default' : 'pointer',
            padding: 0,
            fontSize: 12 * invK,
            lineHeight: 1,
            transition: 'background .2s',
          }}
        >
          ›
        </button>
      </div>

      {/* 展开按钮(右上角) */}
      <button
        onClick={onExpand}
        title="展开查看全部"
        style={{
          position: 'absolute',
          top: 4 * invK,
          right: 4 * invK,
          width: 22 * invK,
          height: 22 * invK,
          borderRadius: 4 * invK,
          border: 'none',
          background: 'rgba(0,0,0,0.3)',
          color: '#94a3b8',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          fontSize: 11 * invK,
          lineHeight: 1,
          zIndex: 25,
          transition: 'background .2s',
        }}
      >
        ⊞
      </button>
    </div>
  );
});