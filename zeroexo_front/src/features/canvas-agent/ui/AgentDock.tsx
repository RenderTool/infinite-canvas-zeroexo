/**
 * AgentDock - 右侧可收起 Agent 对话面板
 *
 * 薄包装器，内容完全由 TvcAgentShell 负责。
 * 仅提供 slide-in/slide-out 动画。
 */

import { useCanvasAgentStore } from './store.js';
import { TvcAgentShell } from './TvcAgentShell.js';
import './AgentDock.css';

const DOCK_WIDTH = 420;

export function AgentDock(): React.ReactElement {
  const dockOpen = useCanvasAgentStore((s) => s.dockOpen);

  return (
    <div
      style={{
        width: dockOpen ? DOCK_WIDTH : 0,
        minWidth: dockOpen ? DOCK_WIDTH : 0,
        overflow: 'hidden',
        background: '#0a0c14',
        transition: 'width 0.32s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.32s cubic-bezier(0.4, 0, 0.2, 1)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ width: DOCK_WIDTH, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <TvcAgentShell />
      </div>
    </div>
  );
}