/**
 * AgentDock - 右侧可收起 Agent 对话面板
 *
 * 薄包装器，内容完全由 TvcAgentShell 负责。
 * 仅提供 slide-in/slide-out 动画。
 * 顶部右上角收纳 AI 渠道/模型选择器(AiModelPicker)。
 */

import { useCanvasAgentStore } from './store.js';
import { TvcAgentShell } from './TvcAgentShell.js';
import { AiModelPicker } from '../../top-bar/components/ai-model-picker.js';
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
        {/* 顶部工具行:右上角收纳 AI 模型选择器 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 10px 0', flexShrink: 0 }}>
          <AiModelPicker />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <TvcAgentShell />
        </div>
      </div>
    </div>
  );
}