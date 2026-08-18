import React, { useRef, useEffect, useCallback } from 'react';
import ReactEChartsCore from 'echarts-for-react';
import { Card, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import type { EChartsOption } from 'echarts';
import { color, radius, spacing } from '@/design-tokens';

interface EChartsCardProps {
  title: React.ReactNode;
  option: EChartsOption | null;
  height?: number;
  loading?: boolean;
  extra?: React.ReactNode;
}

/**
 * 图表卡片组件
 * - loading 期间显示遮罩层
 * - 数据加载完成后显示图表
 * - 监听 option 变化，确保图表正确更新
 */
const EChartsCard: React.FC<EChartsCardProps> = ({
  title,
  option,
  height = 300,
  loading = false,
  extra,
}) => {
  const { t } = useTranslation();
  const chartRef = useRef<ReactEChartsCore>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeTimerRef = useRef<number | null>(null);
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null);

  // 稳定的 resize 函数，避免无限循环
  const handleResize = useCallback(() => {
    const instance = chartRef.current?.getEchartsInstance();
    if (instance) {
      instance.resize();
    }
  }, []);

  // 监听 option 变化，确保图表实例更新
  useEffect(() => {
    if (!option) return;
    
    const instance = chartRef.current?.getEchartsInstance();
    if (instance) {
      instance.setOption(option, true);
      requestAnimationFrame(() => {
        handleResize();
      });
    }
  }, [option, handleResize]);

  // 监听容器尺寸变化（防抖 500ms + 尺寸未变化时跳过）
  useEffect(() => {
    if (!containerRef.current) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const { width, height } = entry.contentRect;

      // 尺寸未发生显著变化时跳过，避免频繁触发
      if (lastSizeRef.current) {
        const dw = Math.abs(width - lastSizeRef.current.width);
        const dh = Math.abs(height - lastSizeRef.current.height);
        if (dw < 1 && dh < 1) return;
      }
      lastSizeRef.current = { width, height };

      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = window.setTimeout(() => {
        handleResize();
      }, 500);
    });
    resizeObserver.observe(containerRef.current);
    
    return () => {
      resizeObserver.disconnect();
      if (resizeTimerRef.current) {
        window.clearTimeout(resizeTimerRef.current);
      }
      lastSizeRef.current = null;
    };
  }, [handleResize]);

  return (
    <Card
      style={{
        borderRadius: radius.lg,
        height: '100%',
      }}
      styles={{
        body: {
          padding: `${spacing.md}px ${spacing.md}px ${spacing.sm}px ${spacing.md}px`,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
        },
        header: {
          borderBottom: 'none',
          paddingBottom: 0,
          minHeight: 40,
        },
      }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 3,
            height: 18,
            borderRadius: 2,
            background: `linear-gradient(180deg, ${color.primary}, ${color.primaryHover})`,
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 14, fontWeight: 500, color: color.textPrimary }}>{title}</span>
        </div>
      }
      extra={extra}
    >
      <div 
        ref={containerRef}
        style={{ 
          height: height,
          position: 'relative', 
          overflow: 'hidden' 
        }}
      >
        {option ? (
          <ReactEChartsCore
            ref={chartRef}
            option={option}
            style={{ height: '100%', width: '100%' }}
          />
        ) : (
          !loading && (
            <div style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: color.textTertiary,
              fontSize: 13,
            }}>
              {t('common.noData')}
            </div>
          )
        )}
        
        {/* Loading 遮罩层 */}
        {loading && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(255, 255, 255, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            borderRadius: radius.lg,
          }}>
            <Spin size="large" />
          </div>
        )}
      </div>
    </Card>
  );
};

export default EChartsCard;
