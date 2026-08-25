/**
 * LocalAgentConnector — 本地 Canvas Agent 连接面板（Plan#42 MCP S4）
 *
 * 紧凑单行形态：未连接时展开输入（URL + token）；已连接显示状态灯 + 断开。
 * 与 zeroexo_canvas_agent 常驻进程配套（启动后输出 Local URL + Connect token）。
 */

import { useSyncExternalStore, useState } from 'react';
import { Cable, X } from 'lucide-react';
import {
  subscribeLocalAgent,
  getLocalAgentState,
  connectLocalAgent,
  disconnectLocalAgent,
} from './local-agent-bridge.js';

export function LocalAgentConnector(): React.ReactElement {
  const { status, error, config } = useSyncExternalStore(subscribeLocalAgent, getLocalAgentState);
  const [expanded, setExpanded] = useState(false);
  const [url, setUrl] = useState(config?.url ?? 'http://127.0.0.1:17381');
  const [token, setToken] = useState(config?.token ?? '');

  const connected = status === 'connected';
  const connecting = status === 'connecting';

  // ===== 已连接/连接中：单行状态条 =====
  if (connected || connecting) {
    return (
      <div style={wrapStyle}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: connected ? '#4ade80' : 'var(--agent-accent)',
            flexShrink: 0,
          }}
        />
        <span style={labelStyle}>
          {connected ? '本地 Agent 已连接' : '正在连接本地 Agent…'}
        </span>
        <button type="button" onClick={() => disconnectLocalAgent()} title="断开本地 Agent" style={iconBtnStyle}>
          <X size={11} />
        </button>
      </div>
    );
  }

  // ===== 未连接：收起态入口 / 展开态表单 =====
  if (!expanded) {
    return (
      <div style={wrapStyle}>
        <Cable size={11} style={{ flexShrink: 0 }} />
        <button
          type="button"
          onClick={() => {
            const s = getLocalAgentState().config;
            if (s) {
              setUrl(s.url);
              setToken(s.token);
            }
            setExpanded(true);
          }}
          style={{ ...labelStyle, cursor: 'pointer', border: 'none', background: 'transparent', padding: 0, fontFamily: 'inherit' }}
          title="让 Codex / Claude Code 等外部 AI 通过 MCP 操作画布"
        >
          连接本地 Agent（MCP）
        </button>
        {status === 'error' && error && (
          <span style={{ fontSize: 11, color: '#f87171', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{ ...wrapStyle, flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Cable size={11} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--agent-text)' }}>连接本地 Canvas Agent</span>
        <button type="button" onClick={() => setExpanded(false)} style={{ ...iconBtnStyle, marginLeft: 'auto' }}>
          <X size={11} />
        </button>
      </div>
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Local URL（如 http://127.0.0.1:17381）"
        style={inputStyle}
      />
      <input
        type="text"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Connect token（Agent 启动时输出）"
        style={inputStyle}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          disabled={!url.trim() || !token.trim()}
          onClick={() => {
            connectLocalAgent(url, token);
            setExpanded(false);
          }}
          style={{
            flex: 1,
            fontSize: 11.5,
            fontWeight: 600,
            padding: '5px 0',
            borderRadius: 6,
            border: 'none',
            cursor: url.trim() && token.trim() ? 'pointer' : 'not-allowed',
            background: url.trim() && token.trim() ? 'var(--agent-accent)' : 'var(--agent-surface-2)',
            color: url.trim() && token.trim() ? '#fff' : 'var(--agent-muted)',
            fontFamily: 'inherit',
          }}
        >
          连接
        </button>
      </div>
      <div style={{ fontSize: 10.5, color: 'var(--agent-muted)', lineHeight: 1.5 }}>
        终端运行 <code style={{ opacity: 0.85 }}>zeroexo-canvas-agent</code> 后，把输出的 Local URL 与 token 粘贴到上方，即可让 Codex / Claude Code 等外部 AI 经 MCP 操作画布。
      </div>
    </div>
  );
}

const wrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  padding: '6px 12px',
  borderTop: '1px solid var(--agent-border)',
  color: 'var(--agent-muted)',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 600,
  color: 'var(--agent-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  borderRadius: 5,
  border: 'none',
  background: 'transparent',
  color: 'var(--agent-muted)',
  cursor: 'pointer',
  flexShrink: 0,
  marginLeft: 'auto',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 11.5,
  padding: '5px 8px',
  borderRadius: 6,
  border: '1px solid var(--agent-border)',
  background: 'var(--agent-surface)',
  color: 'var(--agent-text)',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};
