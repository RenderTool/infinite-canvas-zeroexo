/**
 * CopyButton - 消息复制按钮（Plan#36 R2-7）
 *
 * hover 显示（由 .msg-actions CSS 控制），点击复制原文 + 短暂成功反馈。
 * 统一封装：文本/MD/时间线等消息共用。
 */

import { useCallback, useState } from 'react';
import { Copy, Check } from 'lucide-react';

export interface CopyButtonProps {
  /** 取待复制文本（惰性求值） */
  getText: () => string;
  size?: number;
}

export function CopyButton({ getText, size = 12 }: CopyButtonProps): React.ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const text = getText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板权限失败兜底：临时 textarea
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }, [getText]);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void handleCopy();
      }}
      title={copied ? '已复制' : '复制'}
      className="msg-copy-btn"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 20,
        height: 20,
        border: 'none',
        borderRadius: 5,
        background: 'transparent',
        color: copied ? '#4ade80' : 'var(--agent-muted)',
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        transition: 'color 0.15s',
      }}
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}
