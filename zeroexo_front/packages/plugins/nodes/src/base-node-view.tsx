/**
 * BaseNodeView + AIStateView - 节点基类组件
 *
 * 架构(C++ 派生类模式的 React 等价):
 * - BaseNodeView: 所有节点的外壳,用 NodeShell 包裹,提供引脚布局 + 引脚拖拽回调
 * - AIStateView: AI 生成节点的 4 状态机(idle/loading/error/success)
 * - 各派生节点视图(BaseNodeView 的"子类")传入 children 作为内容
 *
 * 引脚回调问题:
 *   NodeRendererProps 不含引脚事件回调(只有节点级回调)。
 *   解法: 插件 install 时获取 ConnectionController,通过闭包传入 BaseNodeView,
 *   BaseNodeView 用 controller + 当前 node.id 构造引脚回调。
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Lock,
  Gauge,
  Wifi,
  Server,
  Clock,
  AlertCircle,
  RefreshCw,
  Upload,
  Square,
  LoaderCircle,
} from 'lucide-react';
import type { NodeRecord, Pin } from '@zeroexo/core';
import { NodeShell } from '@zeroexo/plugin-render-react';
import type { ReactGraphStore } from '@zeroexo/plugin-render-react';
import type { ConnectionController } from '@zeroexo/plugin-connection';
import type { GenerationStatus, AiErrorType } from '@zeroexo/plugin-ai-provider';

// ===== 节点级动作事件(div/重试/取消)=====
// 节点视图内无法直接访问 editor-page 的生成回调,通过轻量模块级事件总线解耦:
// 节点视图 emit → editor-page 订阅并调用 handlePromptGenerate/handlePromptStop。
export interface NodeActionEvent { nodeId: string; [key: string]: unknown }
type NodeActionHandler = (event: NodeActionEvent) => void;
interface NodeActionBus {
  handlers: Map<string, Set<NodeActionHandler>>;
  on: (type: string, handler: NodeActionHandler) => () => void;
  emit: (type: string, event: NodeActionEvent) => void;
}
export const nodeActionBus: NodeActionBus = {
  handlers: new Map(),
  on(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  },
  emit(type, event) {
    this.handlers.get(type)?.forEach((h) => h(event));
  },
};

// ===== 引脚回调集合 =====
export interface PinHandlers {
  onPinPointerDown: (e: React.PointerEvent, pin: Pin) => void;
  onPinPointerEnter: (e: React.PointerEvent, pin: Pin) => void;
  onPinPointerLeave: (e: React.PointerEvent) => void;
}

/** 从 ConnectionController + node.id 构造引脚回调(每次渲染创建,与 demo 模式一致) */
export function createPinHandlers(
  controller: ConnectionController | null,
  nodeId: string,
): PinHandlers {
  return {
    onPinPointerDown: (e, pin) => {
      e.stopPropagation();
      controller?.handlePinPointerDown(
        e.nativeEvent,
        e.currentTarget as HTMLElement,
        nodeId,
        pin.id,
        pin.direction,
      );
    },
    onPinPointerEnter: (e, pin) => {
      controller?.handlePinPointerEnter(
        e.nativeEvent,
        nodeId,
        pin.id,
        pin.direction,
      );
    },
    onPinPointerLeave: () => {
      controller?.handlePinPointerLeave();
    },
  };
}

// ===== BaseNodeView - 节点外壳基类 =====

export interface BaseNodeViewProps {
  node: NodeRecord;
  pins: Pin[];
  isSelected: boolean;
  isHovered: boolean;
  title: string;
  color: string;
  /** 连线控制器(install 时获取,通过闭包传入); null 则引脚不响应拖拽 */
  connectionController: ConnectionController | null;
  /** 强制显示所有引脚(连线拖拽期间所有节点Pin可见) */
  forceShowPins?: boolean;
  /** 内容区内边距(默认 '0 20px';图片/视频节点传 0 实现无留白填充) */
  contentPadding?: React.CSSProperties['padding'];
  /** 1/viewport.k,用于引脚磁吸偏移等屏幕恒定尺寸计算 */
  invK?: number;
  /** 标题栏左侧图标(问题5) */
  titleIcon?: React.ReactNode;
  /** 标题栏右侧尺寸规格文本(问题5) */
  titleSize?: string;
  children: React.ReactNode;
  /** 节点更新回调(用于重命名等) */
  updateNode?: (patch: Partial<NodeRecord>) => void;
  /** 外部触发重命名(由工具栏按钮触发) */
  externalRenaming?: boolean;
  /** 重命名完成/取消回调 */
  onRenameFinish?: () => void;
  /** 画布图 store(用于获取连线信息,渲染上一个/下一个导航按钮) */
  store?: ReactGraphStore | null;
  /** 外壳圆角覆写(特化外观节点使用,忽略全局外观配置) */
  borderRadiusOverride?: React.CSSProperties['borderRadius'];
}

/**
 * BaseNodeView - 所有业务节点的统一外壳
 *
 * 用 NodeShell 包裹,自动渲染:
 * - 标题栏(title)
 * - 左侧 input 引脚 / 右侧 output 引脚
 * - 引脚拖拽回调(连线)
 *
 * 派生节点只需提供 children(内容区)。
 */
export function BaseNodeView({
  node,
  pins,
  isSelected,
  isHovered,
  title,
  color,
  connectionController,
  forceShowPins,
  contentPadding,
  invK,
  titleIcon,
  titleSize,
  children,
  updateNode,
  externalRenaming,
  onRenameFinish,
  borderRadiusOverride,
}: BaseNodeViewProps): React.ReactElement {
  const pinHandlers = createPinHandlers(connectionController, node.id);

  return React.createElement(
    NodeShell,
    {
      node,
      pins,
      title,
      color,
      isSelected,
      isHovered,
      forceShowPins,
      contentPadding,
      invK,
      titleIcon,
      titleSize,
      onUpdateNode: updateNode,
      onPinPointerDown: pinHandlers.onPinPointerDown,
      onPinPointerEnter: pinHandlers.onPinPointerEnter,
      onPinPointerLeave: pinHandlers.onPinPointerLeave,
      externalRenaming,
      onRenameFinish,
      borderRadiusOverride,
    },
    // children 直接传入(data-node-content 已设 position:relative,减少一层嵌套)
    children,
  );
}

// ===== AIStateView - AI 生成 4 状态机 =====

export interface AIStateViewProps {
  status: GenerationStatus;
  errorDetails?: string;
  /** P3.5: 错误分类(决定错误态图标 + 文案) */
  errorType?: AiErrorType;
  /** 主题色(loading spinner / error 按钮) */
  accentColor: string;
  /** 空状态(idle 无内容)图标 */
  emptyIcon: React.ReactNode;
  /** 空状态文案 */
  emptyText: string;
  /** 是否有生成内容(决定显示 success 还是 empty) */
  hasContent: boolean;
  /** Bug3: 空状态点击触发替换内容(打开文件选择器) */
  onReplace: () => void;
  /** 替换按钮位置: top-right(右上角) / left(帧左侧并排),默认 top-right */
  replaceBtnPosition?: 'top-right' | 'left';
  /** Bug3: 统一背景色(与文本节点一致) */
  backgroundColor: string;
  /** 空状态/加载状态文字颜色(传入则使用主题色,默认 #6b7280) */
  emptyTextColor?: string;
  /** 生成中任务信息(渠道 · 模型 · 任务hash,由生成时写入 node.data) */
  taskLabel?: string;
  /** 失败/生成中:重试回调(节点视图内 emit 到 editor-page) */
  onRetry?: () => void;
  /** 生成中/失败:取消回调(节点视图内 emit 到 editor-page) */
  onCancel?: () => void;
  /** 成功状态内容(由派生节点提供) */
  children: React.ReactNode;
}

const aiContainerStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  position: 'relative',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};

/**
 * AIStateView - AI 生成节点的 4 状态渲染
 *
 * 状态分支:
 * - loading: 旋转加载动画
 * - error: 错误信息(BUG5: 移除重试按钮,统一交给下方生成按钮触发)
 * - success(hasContent): 渲染 children(媒体内容)
 * - idle(无内容): 空状态占位,双击触发生成
 */
/** 根据 errorType 返回 (图标, 文案 key) */
function errorTypeVisual(errorType: AiErrorType | undefined): {
  icon: React.ReactNode;
  labelKey: string;
} {
  switch (errorType) {
    case 'AUTH_ERROR':
      return { icon: <Lock size={18} />, labelKey: 'nodes.errorTypeAuth' };
    case 'RATE_LIMIT':
      return { icon: <Gauge size={18} />, labelKey: 'nodes.errorTypeRateLimit' };
    case 'NETWORK_ERROR':
      return { icon: <Wifi size={18} />, labelKey: 'nodes.errorTypeNetwork' };
    case 'PROVIDER_ERROR':
      return { icon: <Server size={18} />, labelKey: 'nodes.errorTypeProvider' };
    case 'TIMEOUT':
      return { icon: <Clock size={18} />, labelKey: 'nodes.errorTypeTimeout' };
    case 'VALIDATION_ERROR':
      return { icon: <AlertCircle size={18} />, labelKey: 'nodes.errorTypeValidation' };
    default:
      return { icon: <AlertTriangle size={18} />, labelKey: 'nodes.generateFailed' };
  }
}

export function AIStateView({
  status,
  errorDetails,
  errorType,
  accentColor,
  emptyIcon,
  emptyText,
  hasContent,
  onReplace,
  replaceBtnPosition,
  backgroundColor,
  emptyTextColor,
  taskLabel,
  onRetry,
  onCancel,
  children,
}: AIStateViewProps): React.ReactElement {
  const { t } = useTranslation();
  const textColor = emptyTextColor ?? '#6b7280';
  // loading: 环形进度 + 半透明遮罩 + 任务信息 + 取消按钮
  if (status === 'loading') {
    const spinId = `ze-ai-spin-${accentColor.replace('#', '')}`;
    return (
      <div style={{ ...aiContainerStyle, background: backgroundColor, gap: 10, position: 'relative' }}>
        {/* 半透明遮罩,弱化旧内容,强调生成中 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            backdropFilter: 'blur(1px)',
          }}
        />
        <div
          style={{
            position: 'relative',
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* 内圈:静态圆环(缺口基础) */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: `3px solid ${accentColor}30`,
            }}
          />
          {/* 外圈:旋转的进度环 */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              border: `3px solid transparent`,
              borderTopColor: accentColor,
              borderRightColor: `${accentColor}aa`,
              animation: `${spinId} 0.7s linear infinite`,
            }}
          />
          <LoaderCircle size={16} color={accentColor} />
        </div>
        <span style={{ position: 'relative', fontSize: 12, color: '#fff', fontWeight: 500 }}>
          {t('nodes.generating')}
        </span>
        {taskLabel ? (
          <span
            style={{
              position: 'relative',
              fontSize: 10,
              color: 'rgba(255,255,255,0.85)',
              maxWidth: '90%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={taskLabel}
          >
            {taskLabel}
          </span>
        ) : null}
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 10px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.4)',
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <Square size={11} fill="currentColor" />
            {t('nodes.cancelGeneration')}
          </button>
        ) : null}
        <style>{`@keyframes ${spinId} { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // error 且已有内容:保留上次成功内容,叠加错误横幅 + 重试/取消(便于回退)
  if (status === 'error' && hasContent) {
    const visual = errorTypeVisual(errorType);
    const typeLabel = errorType ? t(visual.labelKey) : null;
    return (
      <div className="ze-node-content-wrap" style={{ position: 'relative', width: '100%', height: '100%' }}>
        {children}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            background: 'rgba(239,68,68,0.92)',
            color: '#fff',
            fontSize: 11,
            zIndex: 9,
          }}
        >
          {visual.icon}
          {typeLabel && <span style={{ fontWeight: 600, flexShrink: 0 }}>{typeLabel}</span>}
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {errorDetails ?? t('nodes.generateFailed')}
          </span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              onPointerDown={(e) => e.stopPropagation()}
              style={errorBtnStyle(false)}
            >
              <RefreshCw size={12} />
              {t('nodes.retry')}
            </button>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              onPointerDown={(e) => e.stopPropagation()}
              style={errorBtnStyle(true)}
            >
              {t('common.cancel')}
            </button>
          ) : null}
        </div>
        <ReplaceButton onClick={onReplace} alwaysVisible={false} position={replaceBtnPosition} />
      </div>
    );
  }

  // success / idle(有内容)error 无内容: 错误类型图标 + 类型标签 + 错误详情 + 重试/取消
  if (status === 'error') {
    const visual = errorTypeVisual(errorType);
    const typeLabel = errorType ? t(visual.labelKey) : null;
    return (
      <div style={{ ...aiContainerStyle, background: backgroundColor, gap: 6, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ef4444' }}>
          {visual.icon}
          {typeLabel && (
            <span style={{ fontSize: 12, fontWeight: 600 }}>{typeLabel}</span>
          )}
        </div>
        <span
          style={{
            fontSize: 12,
            color: '#ef4444',
            textAlign: 'center',
            wordBreak: 'break-word',
            lineHeight: 1.4,
            whiteSpace: 'pre-line',
          }}
        >
          {errorDetails ?? t('nodes.generateFailed')}
        </span>
        {(onRetry || onCancel) ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={13} />
                {t('nodes.retry')}
              </button>
            ) : null}
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(0,0,0,0.15)',
                  background: 'transparent',
                  color: '#6b7280',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {t('common.cancel')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  // success / idle(有内容): 渲染媒体内容 + Bug1: 左下角替换按钮(hover 显示)
  if (hasContent) {
    return (
      <div className="ze-node-content-wrap" style={{ position: 'relative', width: '100%', height: '100%' }}>
        {children}
        <ReplaceButton onClick={onReplace} alwaysVisible={false} position={replaceBtnPosition} />
      </div>
    );
  }

  // Bug1: idle(无内容): 空状态占位 + 左下角替换按钮(移除整区域点击避免误触)
  return (
    <div
      style={{
        ...aiContainerStyle,
        background: backgroundColor,
        opacity: 0.7,
      }}
    >
      {emptyIcon}
      <span style={{ fontSize: 11, color: textColor, opacity: 0.7 }}>{emptyText}</span>
      <ReplaceButton onClick={onReplace} alwaysVisible={true} position={replaceBtnPosition} />
    </div>
  );
}

/** error 横幅上的小按钮样式(重试实心 / 取消描边) */
function errorBtnStyle(outline: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 5,
    border: outline ? '1px solid rgba(255,255,255,0.5)' : 'none',
    background: outline ? 'transparent' : 'rgba(255,255,255,0.25)',
    color: '#fff',
    fontSize: 11,
    cursor: 'pointer',
    flexShrink: 0,
    whiteSpace: 'nowrap',
  };
}

// Bug1: 节点左下角替换按钮(避免空状态整区域点击误触)
// 内容节点: hover 父容器时显示; 空节点: 始终显示
// 使用 inline style + onMouseEnter/Leave 替代全局 CSS class,避免多实例互相覆盖
function ReplaceButton({ onClick, alwaysVisible, position = 'top-right' }: {
  onClick: () => void;
  alwaysVisible: boolean;
  position?: 'top-right' | 'left';
}): React.ReactElement {
  const { t } = useTranslation();
  const [hover, setHover] = React.useState(false);
  const show = alwaysVisible || hover;
  return (
    <button
      type="button"
      title={t('nodes.replace')}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'absolute',
        ...(position === 'left'
          ? { left: 6, top: 6 }
          : { right: 20, top: 20 }
        ),
        width: 24,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        border: 'none',
        background: 'rgba(0,0,0,0.55)',
        color: '#fff',
        cursor: 'pointer',
        transition: 'opacity 0.15s',
        zIndex: 10,
        opacity: show ? 0.85 : 0,
      }}
    >
      <Upload size={13} />
    </button>
  );
}
