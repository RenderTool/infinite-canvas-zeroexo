/**
 * AntdThemeProvider - antd ConfigProvider 主题适配器
 *
 * 将 @zeroexo/plugin-theme 的主题 token 映射到 antd 的 ThemeConfig，
 * 使 antd 组件自动继承 ZEROEXO 的配色体系，无需手动覆写每个组件样式。
 *
 * ⚠️ React 版本兼容性
 * antd 6.x 要求 React >= 18。当前项目使用 React 18.3.1，
 * 若未来升级到 React 19 时 antd 弹层系统(Select/Tooltip/Popover 等)出现静默失效，
 * 请检查 @rc-component/trigger 的 React 19 兼容性，或考虑回退到 React 18。
 * 参考: admin 项目使用 React 18.3.1 + antd 6.5.1 正常工作。
 */
import type { ReactNode } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import type { ThemeConfig } from 'antd';

interface AntdThemeProviderProps {
  children: ReactNode;
  /** 强制使用明亮主题(不受全局主题影响) */
  light?: boolean;
}

export function AntdThemeProvider({ children, light = false }: AntdThemeProviderProps): React.ReactElement {
  const { theme } = useTheme();
  const isDark = light ? false : theme.mode === 'dark';

  const antdConfig: ThemeConfig = {
    cssVar: { key: 'zx' },
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      // antd 弹层(Modal/Select/Dropdown/Tooltip)z-index 由本 token 统一分配(全局 20000);
      // 自制 overlay 走 Z_INDEX 常量(全屏编辑器 Z_INDEX.FULLSCREEN=30000),全屏内的 antd 弹层
      // 由 script-fullscreen-editor 局部 ConfigProvider 覆盖为 40000——禁止再手动传 zIndex。
      zIndexPopupBase: 20000,
      colorPrimary: theme.toolbar.accent,
      colorBgLayout: light ? '#ffffff' : theme.canvas.background,
      colorBgContainer: light ? '#ffffff' : theme.toolbar.background,
      colorBgElevated: light ? '#ffffff' : theme.toolbar.panel,
      colorText: light ? '#1c1917' : theme.toolbar.text,
      colorTextSecondary: light ? '#57534e' : theme.toolbar.textMuted,
      colorBorder: light ? '#e7e5e4' : theme.toolbar.border,
      colorError: theme.toolbar.danger,
      borderRadius: 8,
      fontSize: 13,
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    },
    components: {
      Button: {
        primaryShadow: 'none',
        controlHeight: 32,
        fontSize: 13,
        fontWeight: 500,
        paddingXS: 10, // small 按钮水平 padding 增大 3px
      },
      Input: {
        controlHeight: 36,
        fontSize: 14,
      },
      Modal: {
        borderRadiusLG: 12,
        paddingContentHorizontal: 24,
        paddingMD: 20,
      },
      Drawer: {
        borderRadiusLG: 0,
      },
      Select: {
        controlHeight: 36,
      },
      Table: {
        headerBg: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
        headerColor: isDark ? theme.toolbar.textMuted : '#595959',
        headerBorderRadius: 8,
        rowHoverBg: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
        borderColor: isDark ? theme.toolbar.border : '#f0f0f0',
        cellPaddingBlock: 8,
        cellPaddingInline: 12,
        fontSize: 13,
      },
      Form: {
        itemMarginBottom: 12,
      },
    },
  };

  return (
    <ConfigProvider
      theme={antdConfig}
      getPopupContainer={() => document.body}
    >
      {children}
    </ConfigProvider>
  );
}
