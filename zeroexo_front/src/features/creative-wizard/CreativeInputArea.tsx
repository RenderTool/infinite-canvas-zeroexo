/**
 * CreativeInputArea - 首页创意输入区组件
 *
 * 位于首页顶部，提供：
 * - AI 输入框 + 预设模板
 * - 点击生成 → 先创建画布项目 → 记录待注入提示词 → 跳转画布页，
 *   Agent 在画布 Agent 面板内思考（Plan#33 D5，不再在主页下方跑任务卡片）
 */
import { useState, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import {
  Clapperboard, Megaphone,
  Tv, Aperture, Music, Camera, Film,
} from 'lucide-react';
import { App } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { createArtifact } from '@/services/artifact-service.js';
import { useAuth } from '@/features/auth/auth-store.js';
import { useTranslation } from 'react-i18next';
import { AiInputBar } from '@/shared/components/AiInputBar.js';
import { HomeHero } from '@/shared/components/index.js';
import { LogoIcon } from '@/assets/ico/index.js';
import { setPendingAgentPrompt } from '@/features/canvas-agent/ui/pending-agent-prompt.js';
import { useMagneticEffect } from './useMagneticEffect.js';

export interface CreativeInputAreaProps {
  onOpenProject: (projectId: string) => void;
  /** AI忙碌状态变化回调（预留，主页智能体工作流下恒为 false） */
  onAiBusyChange?: (busy: boolean) => void;
}

const TYPEWRITER_PLACEHOLDER_KEYS: string[] = [
  'creative.placeholderCyberpunkTvc',
  'creative.placeholderAiAwakening',
  'creative.placeholderCityPromo',
  'creative.placeholderBrandProduct',
  'creative.placeholderLoveMv',
];

const BRIEF_TEMPLATES: Array<{ labelKey: string; icon: React.ReactNode; content: string }> = [
  {
    labelKey: 'creative.templateShortFilm',
    icon: <Clapperboard size={14} />,
    content: '制作一支5-10分钟的电影短片，16:9横屏，新中式水墨画风，强调留白与勾线。配乐使用国风民乐与交响乐结合。故事讲述一段跨越千年的爱恋，重点刻画人物情感和画面质感。',
  },
  {
    labelKey: 'creative.templateTvc',
    icon: <Megaphone size={14} />,
    content: '制作一支30秒的TVC广告，9:16竖屏，赛博朋克视觉风格。快节奏剪辑配合电子音乐，展示产品从概念到成品的蜕变过程。目标受众18-35岁科技爱好者，强调视觉冲击力。',
  },
  {
    labelKey: 'creative.templateShortDrama',
    icon: <Tv size={14} />,
    content: '制作一支1-3分钟的抖音短剧，9:16竖屏，强剧情钩子与快节奏剪辑。前5秒必须抓住观众，强反转结尾。目标Z世代观众，需要在平台引起共鸣。',
  },
  {
    labelKey: 'creative.templateAnime',
    icon: <Aperture size={14} />,
    content: '制作一支国漫风格的动画短片，16:9横屏，日系动漫或国漫视觉风格。角色形象鲜明，色彩饱满，分镜节奏快慢结合。适合在B站或视频号发布。',
  },
  {
    labelKey: 'creative.templateMusicVideo',
    icon: <Music size={14} />,
    content: '制作一支3-5分钟的音乐MV，16:9横屏，歌词与画面完美融合。视觉风格与音乐情绪高度一致，多场景切换，剪辑节奏贴合旋律。',
  },
  {
    labelKey: 'creative.templateMicroFilm',
    icon: <Camera size={14} />,
    content: '制作一支8-15分钟的微电影，2.35:1宽银幕，电影感叙事。讲述一段真实或虚构的故事，注重人物塑造和情感表达。配乐和画面要协调统一。',
  },
  {
    labelKey: 'creative.templatePromo',
    icon: <Film size={14} />,
    content: '制作一支1-2分钟的城市/企业宣传片，16:9横屏，电影感画面。从宏观场景到微观细节，配合慷慨激昂的配乐，展现城市魅力或企业实力。',
  },
];

export function CreativeInputArea({ onOpenProject }: CreativeInputAreaProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { message, modal } = App.useApp();
  const { isAuthenticated } = useAuth();
  const isDark = theme.mode === 'dark';
  const accent = theme.toolbar.accent;
  const border = theme.toolbar.border;
  const textMuted = theme.toolbar.textMuted;
  const typewriterPlaceholders = TYPEWRITER_PLACEHOLDER_KEYS.map((k) => t(k));

  // State
  const [brief, setBrief] = useState('');
  const templateContainerRef = useRef<HTMLDivElement>(null);
  useMagneticEffect(templateContainerRef, { strength: 25 });

  // ===== 生成入口(Plan#33 D5: 先建项目 → 记录提示词 → 跳转画布页) =====
  const handleGenerate = useCallback(async (briefText: string) => {
    if (!isAuthenticated) {
      modal.confirm({
        title: t('creative.loginRequired'),
        content: t('creative.loginRequiredContent'),
        okText: t('creative.goToLogin'),
        cancelText: t('creative.notNow'),
        centered: true,
        zIndex: 1050,
        onOk: () => { window.location.hash = '#/auth/login'; },
      });
      return;
    }
    const trimmed = briefText.trim();
    if (!trimmed) {
      message.info(t('creative.describeIdea'));
      return;
    }
    // 先创建画布项目（标题取前 100 字），提示词完整传递到画布 Agent 面板
    try {
      const project = await createArtifact({ title: trimmed.slice(0, 100) });
      if (!project) return;
      setPendingAgentPrompt(trimmed);
      onOpenProject(project.id);
    } catch {
      // 创建项目失败，静默处理（用户可重试）
    }
  }, [isAuthenticated, modal, message, onOpenProject, t]);

  // ===== Render =====
  const base: CSSProperties = { fontFamily: "'DM Sans', system-ui, sans-serif", color: theme.toolbar.text };

  return (
    <div style={base}>
      {/* 创意输入区 */}
      <div style={{ maxWidth: 730, margin: '0 auto', paddingTop: 0 }}>
        <HomeHero
          logo={<LogoIcon size={40} style={{ color: 'inherit' }} />}
          title={t('creative.heroTitle')}
          subtitle={t('creative.heroSubtitle')}
          input={
            <AiInputBar
              value={brief}
              onChange={setBrief}
              onSend={(text) => void handleGenerate(text)}
              placeholder={t('creative.inputPlaceholder')}
              typewriterPlaceholders={typewriterPlaceholders}
              prefixLabel={t('creative.briefLabel')}
              accent={accent}
              minRows={3}
              maxRows={8}
              variant="elevated"
            />
          }
          belowInput={null}
        />

        {/* 预设模板 */}
        <div style={{ marginTop: 20, marginBottom: 24 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: textMuted,
            textTransform: 'uppercase', letterSpacing: '0.08em',
            marginBottom: 10, textAlign: 'center',
          }}>
            {t('creative.selectTemplate')}
          </div>
          <div ref={templateContainerRef} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
            {BRIEF_TEMPLATES.map((tmpl, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setBrief(tmpl.content)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 9999,
                  border: `1px solid ${brief === tmpl.content && tmpl.content ? accent : border}`,
                  background: brief === tmpl.content && tmpl.content ? `${accent}15` : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'),
                  color: brief === tmpl.content && tmpl.content ? accent : 'inherit',
                  fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  fontFamily: 'inherit', transition: 'all .2s, transform 0.15s cubic-bezier(0.23,1,0.32,1)',
                  willChange: 'transform',
                }}
              >
                <span style={{ display: 'inline-flex' }}>{tmpl.icon}</span>
                {t(tmpl.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
