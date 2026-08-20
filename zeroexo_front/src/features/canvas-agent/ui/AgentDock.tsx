/**
 * AgentDock - 右侧可收起 Agent 对话面板
 *
 * 外层容器（slide-in/slide-out 动画 + AiModelPicker），
 * 内容由 DockContent（真连后端 SSE）负责。
 * projectId 由 editor-page 注入，用于会话归属与项目上下文。
 */

import { useEffect } from 'react';
import { useCanvasAgentStore } from './store.js';
import { DockContent } from './DockContent.js';
import { setSessionProjectId } from './session/agent-session.js';
import { AiModelPicker } from '../../top-bar/components/ai-model-picker.js';
import './AgentDock.css';

const DOCK_WIDTH = 420;

export interface AgentDockProps {
  /** 当前画布/项目 ID（透传给后端会话与任务） */
  projectId?: string;
}

export function AgentDock({ projectId }: AgentDockProps): React.ReactElement {
  const dockOpen = useCanvasAgentStore((s) => s.dockOpen);

  // 注入当前项目 ID 到真连层
  useEffect(() => {
    setSessionProjectId(projectId ?? null);
  }, [projectId]);

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
          <DockContent projectId={projectId} />
        </div>
      </div>
    </div>
  );
}