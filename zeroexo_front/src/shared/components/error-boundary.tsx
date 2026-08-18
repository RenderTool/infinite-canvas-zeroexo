/**
 * ErrorBoundary - React 错误边界
 *
 * 捕获子组件渲染期间的同步错误,防止整个 App 卸载显示空白页面。
 * 错误时显示可恢复的错误提示(附带"重试"按钮),而非白屏。
 *
 * 用法:
 * ```tsx
 * <ErrorBoundary>
 *   <AssetLibraryPage />
 * </ErrorBoundary>
 * ```
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** 可选的自定义错误回退渲染函数 */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] caught render error:', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          width: '100%',
          gap: 12,
          padding: 24,
          color: '#e2e8f0',
          background: '#1a1a1a',
        }}
      >
        <AlertTriangle size={32} color="#f59e0b" />
        <div style={{ fontSize: 14, fontWeight: 600 }}>页面渲染出错</div>
        <div style={{ fontSize: 12, opacity: 0.7, maxWidth: 480, textAlign: 'center', wordBreak: 'break-word' }}>
          {error.message || String(error)}
        </div>
        <button
          type="button"
          onClick={this.reset}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 32,
            padding: '0 14px',
            fontSize: 13,
            borderRadius: 8,
            cursor: 'pointer',
            border: '1px solid #3a3a3a',
            background: 'transparent',
            color: '#e2e8f0',
          }}
        >
          <RotateCcw size={14} />
          重试
        </button>
      </div>
    );
  }
}
