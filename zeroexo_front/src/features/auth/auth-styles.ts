/**
 * auth-styles - 认证页面样式定义
 */

import type { CSSProperties } from 'react';

export const pageStyle: CSSProperties = {
  display: 'flex',
  height: '100%',
  width: '100%',
  overflowY: 'auto',
  overflowX: 'hidden',
  background: '#0d0b0a',
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
};

/**
 * 页面滚动条隐藏样式（同时兼容 WebKit / Firefox / IE）
 * 需配合 pageStyle 的 scrollbarWidth / msOverflowStyle 一起使用
 */
export const AUTH_HIDE_SCROLLBAR_CSS = `
  [data-auth-page]::-webkit-scrollbar {
    width: 0;
    height: 0;
  }
  [data-auth-page]::-webkit-scrollbar-thumb {
    background: transparent;
  }
`;

export function leftPanelStyle(isMobile: boolean): CSSProperties {
  return {
    width: '100%',
    minHeight: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: isMobile ? 'center' : 'flex-start',
    // 不使用 justifyContent: center:当内容高度超过容器时,垂直居中会把顶部裁掉且无法滚动访问
    // 垂直居中改由 formContainer 的 margin: auto 0 实现(内容不超限时居中,超限时自动贴顶并允许滚动)
    background: 'transparent',
    position: 'relative',
    zIndex: 10,
    paddingLeft: isMobile ? '0' : '12%',
    paddingTop: isMobile ? 72 : 0,
    paddingBottom: isMobile ? 80 : 0,
  };
}

export const centeredWrapperStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  flex: 1,
  width: '100%',
  maxWidth: 460,
  gap: 0,
};

export function formContainerStyle(isMobile: boolean): CSSProperties {
  return {
    width: '100%',
    maxWidth: 420,
    // 用 margin: auto 垂直居中:内容不超限时居中,超限时自动贴顶并把溢出放到可滚动的底部,避免顶部被裁剪
    margin: 'auto 0',
    padding: isMobile ? '32px 24px' : '36px 32px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    position: 'relative',
    zIndex: 1,
  };
}

export const switchStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  fontWeight: 400,
};

/** 赛博朋克风格 CSS 字符串 */
export const AUTH_PAGE_CSS = `
  :root {
    --auth-accent: #ff1a2c;
    --auth-accent-glow: rgba(255,26,44,0.5);
    --auth-accent-glow-dim: rgba(255,26,44,0.2);
    --auth-autofill-bg: rgba(255,255,255,0.06);
    --auth-autofill-color: #e5e5e5;
  }
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&family=Rajdhani:wght@300;400;500;600;700&display=swap');

  @keyframes auth-grid-shift {
    0% { background-position: 0 0, 0 0; }
    100% { background-position: 0 60px, 60px 0; }
  }
  @keyframes auth-data-flow {
    0%, 100% { opacity: 0.1; height: 8px; }
    50% { opacity: 0.6; height: 18px; box-shadow: 0 0 6px var(--auth-accent); }
  }
  @keyframes auth-deco-flicker {
    0%, 90%, 100% { opacity: 0.3; }
    95% { opacity: 0.8; }
  }
  @keyframes auth-fog-drift {
    0% { transform: translateX(-20px) scale(1); }
    100% { transform: translateX(20px) scale(1.05); }
  }
  @keyframes borderPulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 0.5; }
  }
  /* 覆盖浏览器自动填充样式 */
  [data-auth-page] input:-webkit-autofill,
  [data-auth-page] input:-webkit-autofill:hover,
  [data-auth-page] input:-webkit-autofill:focus,
  [data-auth-page] input:-webkit-autofill:active {
    -webkit-box-shadow: 0 0 0 1000px var(--auth-autofill-bg) inset !important;
    -webkit-text-fill-color: var(--auth-autofill-color) !important;
    transition: background-color 50000s ease-in-out 0s, color 50000s ease-in-out 0s !important;
    caret-color: var(--auth-autofill-color);
  }
  /* 按钮 - 磨砂玻璃效果 */
  .auth-btn-gradient {
    position: relative;
    overflow: hidden;
    background: rgba(255, 255, 255, 0) !important;
    backdrop-filter: blur(12px) !important;
    -webkit-backdrop-filter: blur(5px) !important;
    border: 1px solid rgba(255, 255, 255, 0.07) !important;
    font-family: 'Orbitron', sans-serif !important;
    font-weight: 700 !important;
    letter-spacing: 4px !important;
    text-transform: uppercase !important;
    transition: all 0.3s !important;
  }
  .auth-btn-gradient::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
    transform: translateX(-100%);
    transition: transform 0.6s;
  }
  .auth-btn-gradient:hover::before {
    transform: translateX(100%);
  }
  .auth-btn-gradient:hover {
    background: rgba(255,255,255,0.12) !important;
    border-color: rgba(255,255,255,0.2) !important;
    box-shadow: 0 0 24px rgba(255,255,255,0.08) !important;
    transform: translateY(-1px) !important;
  }
  .auth-btn-gradient:active {
    transform: translateY(0) !important;
  }
  /* Form Label - 参考login.html */
  .auth-form-item label {
    display: block !important;
    font-size: 10px !important;
    font-weight: 600 !important;
    letter-spacing: 3px !important;
    text-transform: uppercase !important;
    color: rgba(255,255,255,0.5) !important;
    margin-bottom: 8px !important;
    padding-left: 4px !important;
    background: transparent !important;
  }
  .auth-form-item label span {
    color: #ff1a2c !important;
  }
  /* Input Wrapper with left red bar */
  .auth-input-wrapper {
    position: relative;
  }
  .auth-input-wrapper::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: #d6303eff;
    box-shadow: 0 0 10px #d6303eff;
    transform: scaleY(0);
    transition: transform 0.3s;
    transform-origin: center;
  }
  .auth-input-wrapper:focus-within::before {
    transform: scaleY(1);
  }
  /* Form Input */
  .auth-form-input {
    width: 100%;
    padding: 14px 16px 14px 20px !important;
    background: rgba(255,255,255,0.03) !important;
    border: 1px solid rgba(255,255,255,0.1) !important;
    border-left: none !important;
    color: #fff !important;
    font-size: 15px !important;
    font-weight: 400 !important;
    letter-spacing: 1px !important;
    outline: none !important;
    border-radius: 0 8px 8px 0 !important;
    transition: all 0.3s !important;
  }
  .auth-form-input::placeholder {
    color: rgba(255,255,255,0.15) !important;
    letter-spacing: 2px !important;
    opacity: 1 !important;
  }
  .ant-input:focus-within.auth-form-input,
  .auth-input-wrapper:focus-within .auth-form-input {
    background: rgba(255,26,44,0.04) !important;
    border-color: rgba(255,26,44,0.3) !important;
    box-shadow: inset 0 0 20px rgba(255,26,44,0.05) !important;
  }
  /* Input scanline at bottom */
  .auth-input-scanline {
    position: absolute;
    left: 3px;
    right: 0;
    bottom: 0;
    height: 1px;
    background: linear-gradient(90deg, #ff1a2c, transparent);
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.4s;
  }
  .auth-input-wrapper:focus-within .auth-input-scanline {
    transform: scaleX(1);
  }
  /* Code button */
  .auth-code-btn {
    background: rgba(255,255,255,0.08) !important;
    border: 1px solid rgba(255,255,255,0.12) !important;
    color: #fff !important;
  }
  .auth-code-btn:hover {
    background: rgba(255,255,255,0.12) !important;
    border-color: rgba(255,26,44,0.3) !important;
    color: #fff !important;
  }
  /* Forgot password link */
  .auth-forgot-link {
    color: rgba(255,255,255,0.5) !important;
    text-decoration: none !important;
    font-size: 12px !important;
    letter-spacing: 1px !important;
    transition: color 0.2s !important;
    border-bottom: 1px solid transparent !important;
    padding-bottom: 1px !important;
  }
  .auth-forgot-link:hover {
    color: #ff1a2c !important;
    border-bottom-color: #ff1a2c !important;
  }
  /* Login button with clip-path */
  .auth-login-btn {
    width: 100%;
    padding: 16px !important;
    border: 1px solid rgba(255,255,255,0.15) !important;
    background: transparent !important;
    color: #fff !important;
    font-family: 'Orbitron', sans-serif !important;
    font-size: 14px !important;
    font-weight: 700 !important;
    letter-spacing: 5px !important;
    text-transform: uppercase;
    position: relative;
    overflow: hidden;
    transition: all 0.3s !important;
    clip-path: polygon(12px 0, 100% 0, calc(100% - 12px) 100%, 0 100%);
    border-radius: 0 !important;
  }
  .auth-login-btn::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent);
    transform: translateX(-100%);
    transition: transform 0.6s;
  }
  .auth-login-btn:hover::before {
    transform: translateX(100%);
  }
  .auth-login-btn:hover {
    box-shadow: 0 0 30px rgba(255,26,44,0.3), 0 0 60px rgba(255,26,44,0.1) !important;
    border-color: rgba(255,26,44,0.3) !important;
    transform: translateY(-1px) !important;
  }
  .auth-login-btn:active {
    transform: translateY(0) !important;
  }
  /* Switch link */
  .auth-switch-link {
    color: #ff1a2c !important;
  }
  .auth-switch-link:hover {
    color: #ff1a2c !important;
    opacity: 0.8;
  }
  /* 浏览器高度较小时,为底部固定信息栏预留滚动空间,防止登录/注册按钮被遮挡无法点击 */
  @media (max-height: 800px) {
    [data-auth-page] {
      padding-bottom: 84px;
    }
  }
`;