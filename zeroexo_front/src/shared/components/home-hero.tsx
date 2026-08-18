/**
 * HomeHero - 首页顶部 Hero 区域
 *
 * 包含 LOGO + 标题 + 副标题 + 创意输入框
 * - 距离顶部 pt-20
 * - 输入框: border + 白色 + 阴影 + 圆角
 */

import type { CSSProperties, ReactNode } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';

export interface HomeHeroProps {
  /** LOGO 节点(可选,未传则不显示) */
  logo?: ReactNode;
  /** 主标题(大号细体) */
  title: string;
  /** 副标题 */
  subtitle?: string;
  /** 输入框节点 */
  input: ReactNode;
  /** 输入框下方节点(模板按钮等) */
  belowInput?: ReactNode;
  /** 自定义样式 */
  style?: CSSProperties;
}

export function HomeHero({
  logo,
  title,
  subtitle,
  input,
  belowInput,
  style,
}: HomeHeroProps): React.ReactElement {
  const { theme } = useTheme();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        paddingTop: 80, // pt-20
        paddingBottom: 16,
        ...style,
      }}
    >
      {/* 标题行 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 12, marginBottom: 10,
      }}>
        {logo}
        <div style={{
          fontFamily: "'Sora', system-ui, sans-serif",
          fontSize: 24, fontWeight: 300, letterSpacing: '-0.03em',
          color: theme.toolbar.text,
        }}>
          {title}
        </div>
      </div>
      {subtitle && (
        <div style={{
          fontSize: 13, color: theme.toolbar.textMuted,
          lineHeight: 1.6, marginBottom: 20,
        }}>
          {subtitle}
        </div>
      )}

      {/* 输入框容器 */}
      {input}

      {/* 输入框下方(模板/快捷操作) */}
      {belowInput && (
        <div style={{ width: '100%', maxWidth: 730, marginTop: 16 }}>
          {belowInput}
        </div>
      )}
    </div>
  );
}
