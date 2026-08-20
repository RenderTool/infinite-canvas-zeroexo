/**
 * ConfigPreviewHost - 配置面板预览挂载组件(Plan#13)
 *
 * 用真实节点渲染链组装"配置专用节点"预览,替代手动构造 DIV(CanvasPreview):
 * - ConfigPreviewNodeView: 配置专用节点视图(hidden 契约类型,零实例)
 * - GroupItem: 真实组渲染单元(组背景/轮廓/圆角/透明度)
 *
 * 样式同源:全部经 Provider 注入,与画布真实节点同源管线——
 * - NodeDefaultsProvider: 节点圆角/轮廓/填充/标题色(CanvasConfig + theme 派生)
 * - GroupDefaultsProvider: 组背景/轮廓/圆角/透明度(CanvasConfig 派生)
 * - PinDefaultsProvider: 引脚颜色/形状/尺寸/透明度(CanvasConfig 派生)
 *
 * 依赖倒置:本组件只接收已派生样式对象,不感知 CanvasConfig 结构,
 * 映射函数 configToNodeDefaults / configToGroupDefaults 在 config-dialog.tsx 定义。
 */

import React from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ThemeConfig } from '@zeroexo/shared';
import type { NodeDefaults, PinDefaults } from '@zeroexo/plugin-render-react';
import { NodeDefaultsProvider, PinDefaultsProvider } from '@zeroexo/plugin-render-react';
import type { GroupDefaults } from '@zeroexo/plugin-group';
import { GroupDefaultsProvider, GroupItem } from '@zeroexo/plugin-group';
import { ConfigPreviewNodeView } from '@zeroexo/plugin-nodes';

/** 预览组静态 id(仅 ConfigPreviewHost 内部使用,不进入任何 graph) */
const PREVIEW_GROUP_ID = '__config_preview_group__';

/** 预览组宽度(包裹节点;移动端更紧凑) */
const PREVIEW_GROUP_WIDTH = 460;
const PREVIEW_GROUP_HEIGHT = 287;
const PREVIEW_GROUP_WIDTH_MOBILE = 300;
const PREVIEW_GROUP_HEIGHT_MOBILE = 187;
const PREVIEW_NODE_WIDTH = 280;
const PREVIEW_NODE_HEIGHT = 96;
const PREVIEW_NODE_WIDTH_MOBILE = 180;
const PREVIEW_NODE_HEIGHT_MOBILE = 72;

export interface ConfigPreviewHostProps {
  /** 节点全局默认样式(由 CanvasConfig + theme 派生,与画布注入同源) */
  nodeDefaults: NodeDefaults;
  /** 组全局默认样式(由 CanvasConfig 派生,与画布注入同源) */
  groupDefaults: GroupDefaults;
  /** 引脚全局默认(由 CanvasConfig 派生,与画布注入同源) */
  pinDefaults: PinDefaults;
  theme: ThemeConfig;
  isMobile?: boolean;
}

/**
 * 配置面板预览挂载组件。
 * 静态渲染(容器 pointerEvents none),不持有任何 store / 命令 / 回调依赖,
 * 与画布渲染完全解耦;调参实时反映(Props 变化 → Provider 下发 → 真实渲染链重渲)。
 */
export function ConfigPreviewHost({
  nodeDefaults,
  groupDefaults,
  pinDefaults,
  theme,
  isMobile = false,
}: ConfigPreviewHostProps): React.ReactElement {
  const { t } = useTranslation();
  const groupWidth = isMobile ? PREVIEW_GROUP_WIDTH_MOBILE : PREVIEW_GROUP_WIDTH;
  const groupHeight = isMobile ? PREVIEW_GROUP_HEIGHT_MOBILE : PREVIEW_GROUP_HEIGHT;
  const nodeWidth = isMobile ? PREVIEW_NODE_WIDTH_MOBILE : PREVIEW_NODE_WIDTH;
  const nodeHeight = isMobile ? PREVIEW_NODE_HEIGHT_MOBILE : PREVIEW_NODE_HEIGHT;

  const wrapStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    background: theme.canvas.background,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: isMobile ? '16px 16px' : '24px 40px',
    overflow: 'hidden',
    pointerEvents: 'none',
    position: 'relative',
  };

  // 组与节点同层绝对定位叠加(GroupItem 不接收 children,节点叠于组上居中)
  const nodeLayerStyle: CSSProperties = {
    position: 'absolute',
    left: (groupWidth - nodeWidth) / 2,
    top: (groupHeight - nodeHeight) / 2,
    width: nodeWidth,
    height: nodeHeight,
  };
  // 内层相对定位容器:GroupItem(bounds 0,0 绝对定位)与节点层共用定位基准。
  // isolation:isolate 必须保留——GroupItem 使用 GROUP_Z_INDEX(-10) 渲染于节点之下,
  // 若容器不建立 stacking context,负 z-index 会穿透到 wrap 背景(theme.canvas.background)
  // 之后导致组不可见(与画布 group-layer 靠 transform 建 stacking context 同机制)。
  const sceneStyle: CSSProperties = {
    position: 'relative',
    width: groupWidth,
    height: groupHeight,
    flexShrink: 0,
    isolation: 'isolate',
  };

  return (
    <NodeDefaultsProvider value={nodeDefaults}>
      <GroupDefaultsProvider value={groupDefaults}>
        <PinDefaultsProvider value={pinDefaults}>
          <div style={wrapStyle}>
            <div style={sceneStyle}>
              {/* 真实组渲染单元(静态:交互回调省略,isPreview=false 常规外观) */}
              <GroupItem
                groupId={PREVIEW_GROUP_ID}
                title={t('group.previewTitle')}
                bounds={{ x: 0, y: 0, width: groupWidth, height: groupHeight }}
                childrenCount={1}
                backgroundColor={groupDefaults.backgroundColor}
                borderRadius={groupDefaults.borderRadius}
                outlineColor={groupDefaults.outlineColor}
                outlineWidth={groupDefaults.outlineWidth}
                outlineType={groupDefaults.outlineType}
                outlineOffset={groupDefaults.outlineOffset}
                opacity={groupDefaults.opacity}
                isSelected={false}
                isPreview={false}
                forceShowPins
              />
              {/* 配置专用节点:真实 NodeShell 渲染,叠于组上居中 */}
              <div style={nodeLayerStyle}>
                <ConfigPreviewNodeView
                  title={t('settings.nodePreviewLabel')}
                  showPins
                  contentPadding="0 20px"
                >
                  <span style={{ opacity: 0.55, fontSize: isMobile ? 12 : 13 }}>
                    {theme.mode === 'dark' ? t('settings.darkTheme') : t('settings.lightTheme')}
                  </span>
                </ConfigPreviewNodeView>
              </div>
            </div>
          </div>
        </PinDefaultsProvider>
      </GroupDefaultsProvider>
    </NodeDefaultsProvider>
  );
}
