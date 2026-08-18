/**
 * AgentRecommendations - 主页智能推荐组件
 *
 * 展示 Agent 推荐方案，点击后触发创建对应节点并打开 Agent 面板
 */

import { useState } from 'react';import type { CSSProperties } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';

export interface AgentRecommendation {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  /** 点击后发送到 Agent 的提示词 */
  agentPrompt: string;
  /** 目标节点类型（可选） */
  targetNodeType?: string;
}

export interface AgentRecommendationsProps {
  onSelect: (recommendation: AgentRecommendation) => void;
  loading?: boolean;
}

const DEFAULT_RECOMMENDATIONS: AgentRecommendation[] = [
  {
    id: 'script',
    title: '剧本创作',
    description: 'AI 帮你从零开始创作完整剧本，包含角色、场景和对话',
    icon: '\uD83D\uDCDD',
    color: '#d97706',
    agentPrompt: '请帮我创作一个短片剧本，包含角色设定、场景描述和对话。',
    targetNodeType: 'script',
  },
  {
    id: 'storyboard',
    title: '分镜设计',
    description: '根据剧本自动生成分镜头脚本，规划镜头运动和画面构图',
    icon: '\uD83C\uDFAC',
    color: '#7c3aed',
    agentPrompt: '请根据剧本内容生成详细的分镜头脚本，包含镜头编号、画面描述、镜头运动方式和时长。',
    targetNodeType: 'storyboard',
  },
  {
    id: 'image',
    title: '图片生成',
    description: '用文字描述生成高质量的图片，支持多种风格和尺寸',
    icon: '\uD83D\uDDBC\uFE0F',
    color: '#2563eb',
    agentPrompt: '请生成一张高质量的图片，描述如下：',
    targetNodeType: 'image',
  },
  {
    id: 'video',
    title: '视频生成',
    description: '将文字描述转化为动态视频，支持镜头运动和特效',
    icon: '\uD83C\uDFA5',
    color: '#dc2626',
    agentPrompt: '请根据以下描述生成一段视频：',
    targetNodeType: 'video',
  },
  {
    id: 'audio',
    title: '音频制作',
    description: 'AI 生成背景音乐、音效或语音旁白，支持多种音色',
    icon: '\uD83C\uDFB5',
    color: '#059669',
    agentPrompt: '请生成一段音频，描述如下：',
    targetNodeType: 'audio',
  },
  {
    id: 'analysis',
    title: '智能分析',
    description: '分析画布上的现有内容，提供优化建议和创作方向',
    icon: '\uD83D\uDD0D',
    color: '#6366f1',
    agentPrompt: '请分析当前画布内容，提供优化建议和下一步创作方向。',
  },
];

export function AgentRecommendations({
  onSelect,
  loading = false,
}: AgentRecommendationsProps): React.ReactElement {
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';
  const border = theme.toolbar.border;
  const [recommendations] = useState<AgentRecommendation[]>(DEFAULT_RECOMMENDATIONS);

  const containerStyle: CSSProperties = {
    marginTop: 32,
    marginBottom: 24,
  };

  const headerStyle: CSSProperties = {
    fontFamily: 'Sora, system-ui, sans-serif',
    fontSize: 24,
    fontWeight: 300,
    letterSpacing: '-0.03em',
    marginBottom: 16,
    color: theme.toolbar.text,
  };

  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 12,
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={headerStyle}>AI 智能推荐</div>
        <div style={gridStyle}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: 120,
                borderRadius: 12,
                background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                animation: 'recommendationPulse 1.5s ease-in-out infinite',
              }}
            />
          ))}
        </div>
        <style>{`
          @keyframes recommendationPulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 0.7; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>AI 智能推荐</div>
      <div style={gridStyle}>
        {recommendations.map((rec) => (
          <button
            key={rec.id}
            type="button"
            onClick={() => onSelect(rec)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: 16,
              borderRadius: 12,
              border: `1px solid ${border}`,
              background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s ease',
              fontFamily: 'inherit',
              color: theme.toolbar.text,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isDark
                ? 'rgba(255,255,255,0.08)'
                : 'rgba(0,0,0,0.04)';
              e.currentTarget.style.borderColor = rec.color;
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = `0 4px 16px rgba(0,0,0,0.1)`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isDark
                ? 'rgba(255,255,255,0.04)'
                : 'rgba(0,0,0,0.02)';
              e.currentTarget.style.borderColor = border;
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: `${rec.color}18`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
              }}
            >
              {rec.icon}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
              {rec.title}
            </div>
            <div
              style={{
                fontSize: 11,
                opacity: 0.6,
                lineHeight: 1.4,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {rec.description}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}