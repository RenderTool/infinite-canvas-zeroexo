/**
 * HooksErrorBoundary - 错误边界，用于捕获 hooks 相关错误并输出组件栈
 *
 * 当子组件树中抛出错误时，本边界会：
 *   1. 在控制台打印错误信息和组件栈（便于调试 hooks 用法问题）
 *   2. 渲染一个降级 UI，提示用户当前捕获到错误
 */
import { Component, type ReactNode } from 'react';

export interface HooksErrorBoundaryProps {
  children: ReactNode;
}

export interface HooksErrorBoundaryState {
  error: Error | null;
  stack: string;
}

export class HooksErrorBoundary extends Component<
  HooksErrorBoundaryProps,
  HooksErrorBoundaryState
> {
  state: HooksErrorBoundaryState = { error: null, stack: '' };

  static getDerivedStateFromError(error: Error) {
    return { error, stack: (error as any).stack || '' };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error('[HooksBug:componentStack]', info.componentStack);
    console.error('[HooksBug:error]', error.message);
  }

  render() {
    if (this.state.error) {
      return <div style={{ padding: 24 }}>捕获错误: {this.state.error.message}</div>;
    }
    return this.props.children;
  }
}

export default HooksErrorBoundary;
