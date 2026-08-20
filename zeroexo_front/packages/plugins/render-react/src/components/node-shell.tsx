/**
 * NodeShell - 通用节点外壳
 * 提供端口布局 + 内容区 + 右上角标题标签
 * 业务方可通过 NodeTypeExtension.renderNode 完全自定义渲染,NodeShell 仅作为默认壳
 */

import React from 'react';
import type { NodeRecord, Pin } from '@zeroexo/core';
import { PinView } from './pin-view.js';
import { usePinDefaults, useNodeDefaults } from '../pin-defaults.js';
import { NodeScaleContext } from './node-scale-context.js';
import { NodeConnectionHoverContext } from './node-connection-hover-context.js';
import { NodeViewContractContext } from './node-view-contract-context.js';

export interface NodeShellProps {
  node: NodeRecord;
  pins: Pin[];
  title?: string;
  color?: string;
  isSelected?: boolean;
  isHovered?: boolean;
  /** 强制显示所有引脚(连线拖拽期间所有节点Pin可见) */
  forceShowPins?: boolean;
  children?: React.ReactNode;
  /** 内容区内边距(默认 '0 20px';图片/视频节点传 0 实现无留白填充) */
  contentPadding?: React.CSSProperties['padding'];
  /** 1/viewport.k,用于引脚磁吸偏移等屏幕恒定尺寸计算 */
  invK?: number;
  /** 标题栏左侧图标(问题5: 左:图标+类型名称) */
  titleIcon?: React.ReactNode;
  /** 标题栏右侧尺寸规格文本(问题5: 右:尺寸规格,如 "1024 × 1024") */
  titleSize?: string;
  onUpdateNode?: (patch: Partial<NodeRecord>) => void;
  onPinPointerDown?: (e: React.PointerEvent, pin: Pin) => void;
  onPinPointerEnter?: (e: React.PointerEvent, pin: Pin) => void;
  onPinPointerLeave?: (e: React.PointerEvent) => void;
  /** 外部触发重命名(由工具栏按钮触发) */
  externalRenaming?: boolean;
  /** 重命名完成/取消回调 */
  onRenameFinish?: () => void;
  /** 外壳圆角覆写(特化外观节点使用,忽略 node.borderRadius 与全局 NodeDefaults) */
  borderRadiusOverride?: React.CSSProperties['borderRadius'];
}

/** PIN 容器 hover 状态 */
interface PinHoverState {
  side: 'left' | 'right';
  pinIndex: number;
  offsetX: number;
  offsetY: number;
}

export function NodeShell({
  node,
  pins,
  title,
  color = '#0f3460',
  isSelected = false,
  isHovered = false,
  forceShowPins = false,
  children,
  contentPadding = '0 20px',
  invK = 1,
  titleIcon,
  titleSize,
  onUpdateNode,
  onPinPointerDown,
  onPinPointerEnter,
  onPinPointerLeave,
  externalRenaming,
  onRenameFinish,
  borderRadiusOverride,
}: NodeShellProps): React.ReactElement {
  const [renaming, setRenaming] = React.useState(false);
  const [editTitle, setEditTitle] = React.useState(title ?? '');
  const inputRef = React.useRef<HTMLInputElement>(null);

  // PIN 磁吸悬浮状态
  const [pinHover, setPinHover] = React.useState<PinHoverState | null>(null);
  const leftPinRef = React.useRef<HTMLDivElement>(null);
  const rightPinRef = React.useRef<HTMLDivElement>(null);
  const pinHoverTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // 读取节点缩放因子(PIN hover 区域定位需要除以节点缩放,从屏幕坐标转到节点本地坐标)
  const nodeScale = React.useContext(NodeScaleContext);
  // 连线拖拽悬停(NodeItem 透传,与选中 outline 互斥渲染,消除蓝/红叠加态)
  const connectionHover = React.useContext(NodeConnectionHoverContext);
  // 节点视图契约(外观自定义节点可将状态视觉设为 custom,由视图自绘)
  const viewContract = React.useContext(NodeViewContractContext);

  React.useEffect(() => {
    if (renaming) {
      setEditTitle(title ?? '');
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }
  }, [renaming, title]);

  React.useEffect(() => {
    if (externalRenaming && !renaming) {
      setRenaming(true);
    }
  }, [externalRenaming, renaming]);

  const commitRename = React.useCallback(() => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== title) {
      onUpdateNode?.({ title: trimmed });
    }
    setRenaming(false);
    onRenameFinish?.();
  }, [editTitle, title, onUpdateNode, onRenameFinish]);

  const cancelRename = React.useCallback(() => {
    setEditTitle(title ?? '');
    setRenaming(false);
    onRenameFinish?.();
  }, [title, onRenameFinish]);
  // 节点级 pin 样式覆盖(三层优先级: node 字段 > 全局默认 > pin 自带值)
  // 全局默认来自 PinDefaultsContext(PinDefaultsProvider),node 字段最高优先
  const pinDefaults = usePinDefaults();
  // 节点外观全局默认(由 app 层从 canvasConfig + theme 注入,render-react 不依赖 theme)
  // 三层优先级: node 字段 > NodeDefaultsContext > 内置硬编码
  const nodeDefaults = useNodeDefaults();
  const mergedPins = pins.map((p) => ({
    ...p,
    color: node.pinColor ?? pinDefaults.color ?? p.color,
    shape: node.pinShape ?? pinDefaults.shape ?? p.shape,
    size: node.pinSize ?? pinDefaults.size ?? p.size,
  }));
  const inputPins = mergedPins.filter((p) => p.direction === 'input');
  const outputPins = mergedPins.filter((p) => p.direction === 'output');

  // ===== PIN 磁吸悬浮: 计算最近 PIN 和偏移 =====

  /**
   * PIN 容器 rect 缓存(强制重排缓解):
   * 磁吸悬浮期间 pointermove 高频触发且每次都会 setState 写 DOM,
   * 若每帧都 getBoundingClientRect 会形成写→读交错的强制重排。
   * 悬停会话内容器几何不变,首次测量后缓存,pointerleave/缩放变化时失效。
   */
  const pinRectCacheRef = React.useRef<{ side: 'left' | 'right'; rect: DOMRect } | null>(null);
  React.useEffect(() => {
    // 缩放变化时屏幕几何改变,失效缓存
    pinRectCacheRef.current = null;
  }, [invK]);
  const getPinContainerRect = React.useCallback(
    (side: 'left' | 'right'): DOMRect | null => {
      const cached = pinRectCacheRef.current;
      if (cached && cached.side === side) return cached.rect;
      const container = side === 'left' ? leftPinRef.current : rightPinRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      pinRectCacheRef.current = { side, rect };
      return rect;
    },
    [],
  );

  const getPinNaturalCenterY = React.useCallback(
    (side: 'left' | 'right', idx: number): number => {
      const rect = getPinContainerRect(side);
      if (!rect) return 0;
      const N = side === 'left' ? inputPins.length : outputPins.length;
      if (N === 0) return 0;
      // 容器 padding:8px,flex space-around 等分内容区域
      const topPad = 8;
      const bottomPad = 8;
      const contentH = rect.height - topPad - bottomPad;
      return topPad + (idx + 0.5) * (contentH / N);
    },
    [inputPins.length, outputPins.length, getPinContainerRect],
  );

  const handlePinContainerPointerMove = React.useCallback(
    (side: 'left' | 'right', e: React.PointerEvent) => {
      const rect = getPinContainerRect(side);
      if (!rect) return;
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;
      const N = side === 'left' ? inputPins.length : outputPins.length;
      if (N === 0) return;

      // 找到最近的 PIN 索引(Y 方向)
      const topPad = 8;
      const bottomPad = 8;
      const contentH = rect.height - topPad - bottomPad;
      if (contentH <= 0) return;
      const slotH = contentH / N;
      let nearestIdx = Math.round((pointerY - topPad) / slotH - 0.5);
      nearestIdx = Math.max(0, Math.min(N - 1, nearestIdx));

      // Y 偏移
      const naturalCenterY = getPinNaturalCenterY(side, nearestIdx);
      const rawOffsetY = pointerY - naturalCenterY;

      // X 偏移: input 自然锚点=容器右边缘,output 自然锚点=容器左边缘
      const pinSize = mergedPins[side === 'left' ? 0 : mergedPins.length - 1]?.size ?? 14;
      const containerW = rect.width; // screen pixels
      const pinSizeScreen = pinSize / invK; // CSS→屏幕像素
      const anchorX = side === 'left'
        ? containerW - pinSizeScreen / 2   // input: 右边缘 - 半宽(屏幕像素)
        : pinSizeScreen / 2;              // output: 左边缘 + 半宽(屏幕像素)
      const rawOffsetX = pointerX - anchorX;

      // 圆形边界判定:半径 = 2.2 × pin直径 / 2(屏幕像素)
      const PIN_RADIUS = (2.2 * pinSize / 2) / invK;
      const dist = Math.sqrt(rawOffsetX * rawOffsetX + rawOffsetY * rawOffsetY);
      if (dist > PIN_RADIUS) {
        // 超出圆形范围 → 取消磁吸
        setPinHover((prev) => (prev ? null : prev));
        return;
      }

      // 在圆内等比例钳制(保持方向)
      const clampedDist = Math.min(dist, PIN_RADIUS);
      const ratio = clampedDist / (dist || 1);
      const offsetX = rawOffsetX * ratio;
      const offsetY = rawOffsetY * ratio;

      setPinHover({ side, pinIndex: nearestIdx, offsetX, offsetY });

      if (pinHoverTimeoutRef.current) {
        clearTimeout(pinHoverTimeoutRef.current);
        pinHoverTimeoutRef.current = null;
      }
    },
    [inputPins.length, outputPins.length, mergedPins, getPinNaturalCenterY, getPinContainerRect],
  );

  const handlePinContainerPointerLeave = React.useCallback(() => {
    // 悬停会话结束,失效容器 rect 缓存
    pinRectCacheRef.current = null;
    pinHoverTimeoutRef.current = setTimeout(() => {
      setPinHover(null);
    }, 50);
  }, []);

  // 外观扩展:node 字段优先,回退到 NodeDefaults 全局默认,再回退 prop/硬编码默认
  // 契约:selection/connectionHover/hover 设为 custom 时对应效果由节点视图自绘,此处跳过
  const selectionCustom = viewContract?.selectionEffect === 'custom';
  const connectionCustom = viewContract?.connectionHoverEffect === 'custom';
  // hover 投影已上移到外层 NodeItem 统一绘制(hoverEffect=custom 的跳过逻辑在外层)

  const theme = node.theme ?? 'dark';
  const isLight = theme === 'light';
  // backgroundColor 优先级最高(支持 rgba 含 A 通道),其次 nodeColor,再回退 NodeDefaults.fillColor,
  // 最后回退 prop color(保持向后兼容:调用方显式传 color 时仍生效)
  const shellColor = node.backgroundColor ?? node.nodeColor ?? nodeDefaults.fillColor ?? color;
  const contentBg = node.contentBackgroundColor ?? 'transparent';
  const contentTextColor = nodeDefaults.contentTextColor ?? (isLight ? '#444' : '#bbb');
  const titleColor = isSelected && !selectionCustom
    ? (nodeDefaults.titleSelectedColor ?? 'rgba(233, 69, 96, 0.95)')
    : (nodeDefaults.titleColor ?? (isLight ? '#1c1917' : 'rgba(245, 245, 244, 0.9)'));

  // 外轮廓:node.outlineColor/outlineWidth 自定义,回退到 NodeDefaults 全局默认,再回退选中状态硬编码
  // 用 CSS outline(不占布局空间,支持 rgba 透明,跟随 border-radius 圆角)
  // 互斥状态优先级:连线悬停(蓝 1px) > 选中(红 2px),单一元素渲染,无叠加态
  // 用户澄清:hover 仅保留卡片阴影,不再出现蓝色轮廓线 —— 非选中/非连线悬停时
  // 轮廓宽仅当节点显式声明 node.outlineWidth 时生效,全局默认不再贡献常驻描边
  const shellOutlineWidth = connectionHover && !connectionCustom
    ? 1
    : (!selectionCustom && (node.outlineWidth ?? (isSelected ? 2 : 0)));
  const shellOutlineColor = connectionHover && !connectionCustom
    ? '#4a9eff'
    : (!selectionCustom
      ? (node.outlineColor
        ?? (isSelected ? (nodeDefaults.outlineSelectedColor ?? '#e94560') : (nodeDefaults.outlineColor ?? '#0f3460')))
      : nodeDefaults.outlineColor ?? '#0f3460');
  const shellOutlineOffset = node.outlineOffset ?? 0;
  // 圆角:特化覆写优先,其次 node.borderRadius 自定义,回退 NodeDefaults,再回退默认 8
  const shellBorderRadius = borderRadiusOverride ?? node.borderRadius ?? nodeDefaults.borderRadius ?? 8;
  // 无缝拼接模式(borderRadius 显式为 0,如图片拆解切片):空闲不投影,避免拼合缝隙观感
  const tileMode = (node.borderRadius ?? 8) === 0;
  // opacity 不在此层应用(由外层 NodeItem 统一应用一次,避免双层叠加)

  // 引脚可见性: hover 节点时显示，选中节点时也显示，或连线拖拽期间强制显示所有节点 Pin
  // 默认隐藏，鼠标悬停节点时显示 Pin；拖拽连线时所有节点 Pin 可见
  const pinVisible = isHovered || isSelected || forceShowPins;
  
  // T8: 视口反缩放改走连续 CSS 变量(--zx-invk 由 NodeLayer 容器每帧写入，与视口
  // transform 同源同帧)。量化 invK 仅用于 JS 计算(磁吸几何/缓存失效门控)，不再驱动
  // 标题/PIN 的 CSS 几何，消除视口缩放时「桶内漂移 + 跨桶猛跳」的来回跳动。
  // nodeScale 除法仍为 JS 数值(节点 resize 每帧重渲染，天然连续)。
  const invKVar = 'var(--zx-invk, 1)';

  return (
    <div
      data-node-shell
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        contain: 'layout style',
      }}
    >
      {/* 标题栏 — 渲染在轮廓边缘上方
          左:图标+类型名称  右:尺寸规格
          节点等比缩放(useScale)时用 1/sx,1/sy 反缩放,保证标题/图标/文本永远以恒定尺寸正确显示
          (React Flow 模式:节点铬件不随内容缩放形变) */}
      {(viewContract?.useShellChrome !== false && (title || titleIcon || titleSize)) ? (
        <div
          style={{
            position: 'absolute',
            // 标题栏:外层节点(带 viewport scale k) != 内层自身 transform scale(1/sx,1/sy)。
            // 视觉高 = height × (1/sy 自身) × sy(节点) × k(视口) = height × k → 屏幕恒定。
            // 视觉位置 top 不受自身 transform 影响，只被节点缩放×视口缩放 → 需除 nodeScale.sy。
            // fontSize 同理:视觉 = fontSize × k，按连续 --zx-invk 折算即可。
            top: `calc(${-(NODE_TITLE_HEIGHT + 2) / nodeScale.sy}px * ${invKVar})`,
            left: 0,
            // 宽度跟随节点缩放:布局宽 = NodeShell宽 × sx,自身 scale(1/sx) 缩回后
            // 视觉宽 = NodeShell宽 × sx × k = 节点视觉宽度。若用 left:0/right:0(固定100%)
            // 标题栏视觉宽恒定,节点放大时右侧 titleSize 不会跟随节点 → 文本停驻错位
            width: `${Math.max(0.2, nodeScale.sx) * 100}%`,
            height: `calc(${NODE_TITLE_HEIGHT}px * ${invKVar})`,
            transform: `scale(${1 / nodeScale.sx}, ${1 / nodeScale.sy})`,
            transformOrigin: 'top left',
            padding: '0 6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 4,
            // fontSize 视觉 = fontSize × k:按连续 --zx-invk 折算保持屏幕恒定(下限 8px 同步折算)
            fontSize: `max(${8 * invK}px, calc(13px * ${invKVar}))`,
            color: titleColor,
            fontWeight: 600,
            userSelect: 'none',
            pointerEvents: 'auto',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            background: nodeDefaults.titleBackground ?? 'var(--zeroexo-canvas-bg, transparent)',
            zIndex: 31,
          }}
        >
          {/* 左:图标 + 类型名称 */}
          {renaming ? (
            <input
              ref={inputRef}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
              }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                flex: 1,
                minWidth: 0,
                background: 'transparent',
                border: 'none',
                borderBottom: `1px solid ${isSelected ? 'rgba(233,69,96,0.8)' : 'rgba(100,100,100,0.3)'}`,
                color: 'inherit',
                fontSize: 'inherit',
                fontWeight: 'inherit',
                outline: 'none',
                padding: 0,
                margin: 0,
              }}
            />
          ) : (
            <span
              style={{ display: 'flex', alignItems: 'center', gap: 3, overflow: 'hidden', textOverflow: 'ellipsis' }}
              onDoubleClick={() => setRenaming(true)}
              title={title}
            >
              {titleIcon ? <span style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{titleIcon}</span> : null}
              {title ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span> : null}
            </span>
          )}
          {/* 右:尺寸规格 — 使用连续 --zx-invk 自适应视口缩放，保持与标题文本的相对比例 */}
          {titleSize ? (
            <span style={{ flexShrink: 0, opacity: 0.7, fontSize: `max(${6 * invK}px, calc(10px * ${invKVar}))` }}>{titleSize}</span>
          ) : null}
        </div>
      ) : null}

      {/* 外壳(内容 + 标签,overflow: hidden 保留圆角和背景裁剪) */}
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: shellColor,
          borderRadius: shellBorderRadius,
          overflow: 'hidden',
          // CSS outline 替代 border:不占布局空间,支持透明 rgba,跟随圆角
          // 选中态由 outline 颜色变红体现(选中光晕由外层 NodeItem box-shadow 负责)
          outline: `${shellOutlineWidth}px solid ${shellOutlineColor}`,
          outlineOffset: shellOutlineOffset,
          // hover 卡片投影统一由外层 NodeItem 负责(B9),内层不叠加第二层阴影
          boxShadow: tileMode ? 'none' : '0 1px 1px rgba(0,0,0,0.03)',
          transition: 'box-shadow 0.15s cubic-bezier(0.22,1,0.36,1), outline-color 0.15s cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        {/* 内容区(全高,标题栏已移到轮廓上方) */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            backgroundColor: contentBg,
          }}
        >
          <div
            data-node-content
            style={{
              flex: 1,
              position: 'relative',
              padding: contentPadding,
              overflow: 'auto',
              color: contentTextColor,
              fontSize: `max(${7 * invK}px, calc(11px * ${invKVar}))`,
            }}
          >
            {children}
          </div>
        </div>
      </div>

     {/* 左侧输入引脚(节点外部,圆形磁吸区域 2.2 倍 PIN 直径) */}
      {/* 使用 invK 和 nodeScale 调整偏移,确保 PIN 在节点缩放/视口缩放时保持恒定屏幕距离 */}
      <div
        ref={leftPinRef}
        onPointerMove={handlePinContainerPointerMove.bind(null, 'left')}
        onPointerLeave={handlePinContainerPointerLeave}
        style={{
          position: 'absolute',
          left: `calc(${-40 / nodeScale.sx}px * ${invKVar})`,
          top: 0,
          bottom: 0,
          width: `calc(${32 / nodeScale.sx}px * ${invKVar})`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-around',
          alignItems: 'flex-end',
          padding: `calc(${8 / nodeScale.sy}px * ${invKVar}) 0`,
          zIndex: 30,
          pointerEvents: 'auto',
        }}
      >
        {inputPins.map((pin, idx) => {
          const isHoveredPin = pinHover?.side === 'left' && pinHover.pinIndex === idx;
          const pinSize = mergedPins[0]?.size ?? 14;
          // 磁吸圆:本地 CSS 尺寸 = 目标视觉(2.2*pinSize*k)/节点缩放(sx) —与 PinView 视觉
          // (pinSize*k,随视口缩放)保持一致,避免节点缩放时圆与 PIN 比例失调/跳动
          const magnetW = (2.2 * pinSize) / nodeScale.sx;
          const magnetH = (2.2 * pinSize) / nodeScale.sy;
          const circleR = magnetH / 2;
          return (
            <React.Fragment key={pin.id}>
              {/* 可视化圆形边界(调试用) */}
              {isHoveredPin && (
                <div
                  style={{
                    position: 'absolute',
                    // 容器本地宽 = 32*invK/nodeScale.sx;圆中心对齐 pin 中心(右缘 - pinSizeScreen/2)
                    left: (32 * invK / nodeScale.sx) - (pinSize * invK / nodeScale.sx) / 2 - magnetW / 2,
                    top: (getPinNaturalCenterY('left', idx) * invK) / nodeScale.sy - circleR,
                    width: magnetW,
                    height: magnetH,
                    borderRadius: '50%',
                    border: '1px dashed rgba(233,69,96,0.5)',
                    background: 'rgba(233,69,96,0.04)',
                    pointerEvents: 'none',
                    zIndex: 1,
                  }}
                />
              )}
              <PinView
                pin={pin}
                position="left"
                visible={pinVisible || isHoveredPin}
                // T10: 磁吸偏移不再乘 JS 量化 invK——乘法移入 PinView 的 calc(var(--zx-invk))
                // (连续视口反缩放),避免缩放动画跨桶瞬间磁吸偏移突变
                magnetOffsetX={isHoveredPin ? pinHover.offsetX : undefined}
                magnetOffsetY={isHoveredPin ? pinHover.offsetY : undefined}
                onPointerDown={onPinPointerDown}
                onPointerEnter={onPinPointerEnter}
                onPointerLeave={onPinPointerLeave}
              />
            </React.Fragment>
          );
        })}
      </div>

     {/* 右侧输出引脚(节点外部,圆形磁吸区域 2.2 倍 PIN 直径) */}
      {/* 使用 invK 和 nodeScale 调整偏移,确保 PIN 在节点缩放/视口缩放时保持恒定屏幕距离 */}
      <div
        ref={rightPinRef}
        onPointerMove={handlePinContainerPointerMove.bind(null, 'right')}
        onPointerLeave={handlePinContainerPointerLeave}
        style={{
          position: 'absolute',
          right: `calc(${-40 / nodeScale.sx}px * ${invKVar})`,
          top: 0,
          bottom: 0,
          width: `calc(${32 / nodeScale.sx}px * ${invKVar})`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-around',
          alignItems: 'flex-start',
          padding: `calc(${8 / nodeScale.sy}px * ${invKVar}) 0`,
          zIndex: 30,
          pointerEvents: 'auto',
        }}
      >
        {outputPins.map((pin, idx) => {
          const isHoveredPin = pinHover?.side === 'right' && pinHover.pinIndex === idx;
          const pinSize = mergedPins[0]?.size ?? 14;
          // 磁吸圆:本地 CSS 尺寸 = 目标视觉(2.2*pinSize*k)/节点缩放(sx) —与 PinView 视觉一致
          const magnetW = (2.2 * pinSize) / nodeScale.sx;
          const magnetH = (2.2 * pinSize) / nodeScale.sy;
          const circleR = magnetH / 2;
          return (
            <React.Fragment key={pin.id}>
              {/* 可视化圆形边界(调试用) */}
              {isHoveredPin && (
                <div
                  style={{
                    position: 'absolute',
                    // 输出端 pin 中心在容器左缘 + pinSizeScreen/2,圆以该点居中
                    left: (pinSize * invK / nodeScale.sx) / 2 - magnetW / 2,
                    top: (getPinNaturalCenterY('right', idx) * invK) / nodeScale.sy - circleR,
                    width: magnetW,
                    height: magnetH,
                    borderRadius: '50%',
                    border: '1px dashed rgba(233,69,96,0.5)',
                    background: 'rgba(233,69,96,0.04)',
                    pointerEvents: 'none',
                    zIndex: 1,
                  }}
                />
              )}
              <PinView
                pin={pin}
                position="right"
                visible={pinVisible || isHoveredPin}
                // T10: 磁吸偏移不再乘 JS 量化 invK——乘法移入 PinView 的 calc(var(--zx-invk))
                // (连续视口反缩放),避免缩放动画跨桶瞬间磁吸偏移突变
                magnetOffsetX={isHoveredPin ? pinHover.offsetX : undefined}
                magnetOffsetY={isHoveredPin ? pinHover.offsetY : undefined}
                onPointerDown={onPinPointerDown}
                onPointerEnter={onPinPointerEnter}
                onPointerLeave={onPinPointerLeave}
              />
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// 标题栏屏幕恒定高度(与 group-layer GROUP_TITLE_HEIGHT 对齐)
const NODE_TITLE_HEIGHT = 18;
