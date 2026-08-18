/**
 * CreativeInputArea - 首页创意输入区组件
 *
 * 位于首页顶部，提供：
 * - AI 输入框 + 预设模板
 * - AI 生成任务进度展示
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import {
  ListOrdered, AlertCircle, Clapperboard, Megaphone,
  Tv, Aperture, Music, Camera, Film, Loader2, Check, X,
} from 'lucide-react';
import { App } from 'antd';
import { useTheme } from '@zeroexo/plugin-theme';
import { apiGet } from '@/services/api-client.js';
import { createAiThinkStreamService } from '@/services/ai-think-service.js';
import type { ThinkRequest, ThinkingStep } from '@/services/ai-think-service.js';
import { createArtifact } from '@/services/artifact-service.js';
import { useAuth } from '@/features/auth/auth-store.js';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n/config';
import { AiInputBar } from '@/shared/components/AiInputBar.js';
import { HomeHero } from '@/shared/components/index.js';
import { LogoIcon } from '@/assets/ico/index.js';
import { useMagneticEffect } from './useMagneticEffect.js';

export interface CreativeInputAreaProps {
  onOpenProject: (projectId: string) => void;
  /** AI忙碌状态变化回调 */
  onAiBusyChange?: (busy: boolean) => void;
}

// ===== Types =====
interface AiChannel {
  id: string;
  provider: string;
  name: string;
  models: Array<{ name: string; capabilities?: string[] }>;
}
interface SchemeTask {
  id: string;
  brief: string;
  status: 'queued' | 'thinking' | 'completing' | 'error';
  thinkingSteps: ThinkingStep[];
  error?: string;
  createdAt: number;
}
const MAX_CONCURRENT = 3;

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

export function CreativeInputArea({ onOpenProject, onAiBusyChange }: CreativeInputAreaProps): React.ReactElement {
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
  const [tasks, setTasks] = useState<SchemeTask[]>([]);
  const templateContainerRef = useRef<HTMLDivElement>(null);
  useMagneticEffect(templateContainerRef, { strength: 25 });

  const aiBusy = tasks.length > 0;
  const hasActiveTasks = tasks.some((t) => t.status === 'thinking' || t.status === 'queued');

  // 通知父组件AI忙碌状态
  useEffect(() => {
    onAiBusyChange?.(aiBusy);
  }, [aiBusy, onAiBusyChange]);

  /** 检查AI是否正在执行任务，若是则显示禁止切换提示 */
  const checkAiBusy = useCallback((): boolean => {
    if (hasActiveTasks) {
      modal.warning({
        title: t('creative.aiBusyTitle'),
        icon: <AlertCircle size={18} />,
        content: t('creative.aiBusyContent'),
        centered: true,
        okText: t('creative.gotIt'),
      });
      return true;
    }
    return false;
  }, [hasActiveTasks, modal]);

  // ===== AI Generation =====
  const getAiChannel = useCallback(async (): Promise<{ id: string; model: string } | null> => {
    const res = await apiGet<{ items: AiChannel[] }>('/ai/channels');
    const channels = res?.items ?? [];
    const channel = channels.find((c) => c.models && c.models.length > 0 && c.models[0]?.name);
    if (!channel) return null;
    return { id: channel.id, model: channel.models[0]!.name };
  }, []);

  const enqueueGeneration = useCallback(async (briefText: string) => {
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
    const channel = await getAiChannel();
    if (!channel) {
      message.warning(i18n.t('errors.CHANNEL_NOT_FOUND'));
      return;
    }
    const task: SchemeTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      brief: trimmed,
      status: 'queued',
      thinkingSteps: [],
      createdAt: Date.now(),
    };
    setTasks((prev) => [...prev, task]);
    setBrief('');
  }, [getAiChannel, message, isAuthenticated]);

  const runTask = useCallback(async (task: SchemeTask) => {
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: 'thinking' } : t));
    const channel = await getAiChannel();
    if (!channel) {
      setTasks((prev) => prev.map((item) => item.id === task.id ? { ...item, status: 'error', error: t('creative.aiNotConfigured') } : item));
      return;
    }
    const req: ThinkRequest = {
      providerId: channel.id,
      model: channel.model,
      kind: 'inspire',
      locale: (i18n.language as string) || 'zh',
      projectData: { name: task.brief },
    };
    const service = createAiThinkStreamService();
    const collected: ThinkingStep[] = [];
    try {
      await service.start(req, {
        onStepDelta: () => {},
        onStepComplete: (s) => {
          collected.push(s);
          setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, thinkingSteps: [...collected] } : t));
        },
        onDone: async () => {
          setTasks((prev) => prev.filter((t) => t.id !== task.id));
          try {
            const project = await createArtifact({ title: task.brief.slice(0, 100) });
            if (project) onOpenProject(project.id);
          } catch {
            // 创建项目失败，静默处理
          }
        },
        onError: (err) => {
          setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: 'error', error: err.message } : t));
        },
      });
    } catch (err) {
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: 'error', error: err instanceof Error ? err.message : String(err) } : t));
    }
  }, [getAiChannel]);

  // Concurrent scheduler
  useEffect(() => {
    const running = tasks.filter((t) => t.status === 'thinking').length;
    if (running >= MAX_CONCURRENT) return;
    const queued = tasks.filter((t) => t.status === 'queued');
    const toStart = queued.slice(0, MAX_CONCURRENT - running);
    toStart.forEach((t) => { void runTask(t); });
  });

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
              onSend={(text) => void enqueueGeneration(text)}
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
                onClick={() => {
                  if (checkAiBusy()) return;
                  setBrief(tmpl.content);
                }}
                disabled={aiBusy}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px', borderRadius: 9999,
                  border: `1px solid ${brief === tmpl.content && tmpl.content ? accent : border}`,
                  background: brief === tmpl.content && tmpl.content ? `${accent}15` : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'),
                  color: brief === tmpl.content && tmpl.content ? accent : 'inherit',
                  fontSize: 12, fontWeight: 500, cursor: aiBusy ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', transition: 'all .2s, transform 0.15s cubic-bezier(0.23,1,0.32,1)',
                  opacity: aiBusy ? 0.4 : 1, willChange: 'transform',
                }}
              >
                <span style={{ display: 'inline-flex' }}>{tmpl.icon}</span>
                {t(tmpl.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* 生成任务 */}
        {tasks.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <ListOrdered size={14} style={{ color: accent }} />
              <div style={{ fontFamily: "'Sora', system-ui, sans-serif", fontSize: 14, fontWeight: 600 }}>
                {t('creative.generationTasks')}
              </div>
              <span style={{
                fontSize: 11, color: textMuted, padding: '2px 8px', borderRadius: 9999,
                background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
              }}>
                {t('creative.concurrentInfo', { running: tasks.filter((t) => t.status === 'thinking').length, max: MAX_CONCURRENT, queued: tasks.filter((t) => t.status === 'queued').length })}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {tasks.map((t) => (
                <TaskSkeletonCard
                  key={t.id}
                  task={t}
                  queueIndex={tasks.filter((x) => x.status === 'queued' && x.createdAt < t.createdAt).length}
                  accent={accent}
                  border={border}
                  textMuted={textMuted}
                  isDark={isDark}
                  onRetry={() => setTasks((prev) => prev.map((x) => x.id === t.id ? { ...x, status: 'queued', error: undefined, thinkingSteps: [] } : x))}
                  onRemove={() => setTasks((prev) => prev.filter((x) => x.id !== t.id))}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== TaskSkeletonCard Component =====
interface TaskSkeletonCardProps {
  task: SchemeTask;
  queueIndex: number;
  accent: string;
  border: string;
  textMuted: string;
  isDark: boolean;
  onRetry: () => void;
  onRemove: () => void;
}

function TaskSkeletonCard({ task, queueIndex, accent, border, textMuted, isDark, onRetry, onRemove }: TaskSkeletonCardProps): React.ReactElement {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (task.status !== 'thinking') return;
    const timer = setInterval(() => {
      setProgress((prev) => (prev >= 95 ? 95 : prev + Math.random() * 12));
    }, 800);
    return () => clearInterval(timer);
  }, [task.status]);

  const statusLabel = task.status === 'queued' ? t('creative.statusQueued', { index: queueIndex + 1 }) : task.status === 'thinking' ? t('creative.statusThinking') : task.status === 'completing' ? t('creative.statusCompleting') : t('creative.statusError');
  const statusColor = task.status === 'error' ? '#ef4444' : task.status === 'completing' ? '#10b981' : accent;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px', borderRadius: 10,
      background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      border: `1px solid ${border}`,
    }}>
      <div style={{
        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: task.status === 'error' ? '#ef444420' : task.status === 'completing' ? '#10b98120' : `${accent}15`,
        color: statusColor,
      }}>
        {task.status === 'queued' ? (
          <span style={{ fontSize: 10, fontWeight: 700 }}>{queueIndex + 1}</span>
        ) : task.status === 'thinking' ? (
          <Loader2 size={12} style={{ animation: 'zeroexo-spin 1s linear infinite' }} />
        ) : task.status === 'completing' ? (
          <Check size={12} />
        ) : (
          <AlertCircle size={12} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
            {task.brief.slice(0, 50)}{task.brief.length > 50 ? '...' : ''}
          </span>
          <span style={{ fontSize: 10, color: statusColor, fontWeight: 500, whiteSpace: 'nowrap' }}>{statusLabel}</span>
        </div>
        {task.status === 'thinking' && (
          <div style={{ width: '100%', height: 3, background: border, borderRadius: 9999, overflow: 'hidden', marginTop: 4 }}>
            <div style={{ width: `${Math.min(progress, 95)}%`, height: '100%', background: `linear-gradient(90deg, ${accent}, ${accent}80)`, borderRadius: 9999, transition: 'width .6s cubic-bezier(0.22, 1, 0.36, 1)' }} />
          </div>
        )}
        {task.status === 'error' && task.error && (
          <div style={{ fontSize: 10, color: '#ef4444', marginTop: 2 }}>{task.error}</div>
        )}
      </div>
      {task.status === 'error' && (
        <button type="button" onClick={onRetry} style={{
          background: 'transparent', border: `1px solid ${border}`, borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', color: textMuted, fontFamily: 'inherit',
        }}>
          {t('creative.retry')}
        </button>
      )}
      {(task.status === 'queued' || task.status === 'error') && (
        <button type="button" onClick={onRemove} style={{
          background: 'transparent', border: 'none', cursor: 'pointer', color: textMuted, padding: 2, display: 'flex',
        }}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}

