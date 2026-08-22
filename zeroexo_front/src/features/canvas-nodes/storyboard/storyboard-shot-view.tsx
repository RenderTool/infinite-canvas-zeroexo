/**
 * StoryboardShotView - 分镜「单镜视图」（Plan#33 C1，剧管同款 DIV 结构）
 *
 * 布局 = 剧管 ProductionManagerView 同款骨架：
 * - 左侧 ThumbNav 垂直导航（每镜头一个缩略项：编号徽章 + 景别）
 * - 右侧主区 = 封面舞台（当前镜头描述文本/首张剧照）+ 信息条（镜头号·景别·时长·对白摘要）
 * 顶部 header（状态栏）由 storyboard-sheet 保留，本组件只替换内容区视觉表现。
 * 纯视图态 activeIndex（不落 node.data），与剧管条目切换行为一致。
 */
import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Aperture } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@zeroexo/plugin-theme';
import { ThumbNav } from '@zeroexo/plugin-nodes';
import { useHydratedContent } from '@zeroexo/plugin-nodes';
import { getResourceUrl } from '@/shared/utils/resource-url.js';
import type { Shot } from './storyboard-types';
import { formatLighting, formatEnvironment, entityDisplayName } from './storyboard-utils';

export interface StoryboardShotViewProps {
  shots: Shot[];
  /** 当前集生成状态（空态/生成中提示） */
  status?: string;
  progress?: number;
  readOnly?: boolean;
}

/** 镜头缩略项：编号徽章（无图时主视觉，与剧管 ItemNavItem 数字徽章同款） */
function ShotThumb({ number, shotType, dark }: { number: number; shotType: string; dark: boolean }): React.ReactElement {
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
      background: dark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.07)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: dark ? '#fff' : '#17191c', lineHeight: 1.1 }}>{number}</span>
      <span style={{ fontSize: 8, color: dark ? 'rgba(255,255,255,0.5)' : 'rgba(15,23,42,0.45)', lineHeight: 1, maxWidth: 26, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {shotType || '—'}
      </span>
    </div>
  );
}

/** 封面舞台：当前镜头首张剧照（有图时），无图 → 描述文本为画面 */
function ShotCover({ shot, dark }: { shot: Shot; dark: boolean }): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const firstImage = shot.images?.[0];
  const fallback = firstImage?.storageKey ? (getResourceUrl(firstImage.storageKey, 'preview') ?? '') : '';
  const hydrated = useHydratedContent(firstImage?.storageKey ?? '', fallback);

  if (hydrated) {
    return <img src={hydrated} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />;
  }

  // 无图 → 描述文本作为「画面」
  const description = shot.description?.trim();
  if (description) {
    return (
      <div style={{
        width: '100%', height: '100%', padding: '18px 20px', boxSizing: 'border-box',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start',
        overflow: 'auto',
      }} className="zx-thin-scroll">
        <p style={{
          margin: 0, fontSize: 13, lineHeight: 1.75, color: theme.toolbar.text,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>{description}</p>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: dark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.3)' }}>
      <Aperture size={40} />
      <span style={{ fontSize: 11, opacity: 0.75 }}>{t('storyboardShotView.emptyShot')}</span>
    </div>
  );
}

export const StoryboardShotView = memo(function StoryboardShotView({
  shots,
  status,
  progress,
  readOnly,
}: StoryboardShotViewProps): React.ReactElement {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const isDark = theme.mode === 'dark';

  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    if (activeIndex >= shots.length) setActiveIndex(0);
  }, [shots.length, activeIndex]);

  const activeShot = shots[Math.min(activeIndex, shots.length - 1)] ?? null;

  const handlePrev = useCallback(() => {
    if (shots.length <= 1) return;
    setActiveIndex(Math.max(0, activeIndex - 1));
  }, [shots.length, activeIndex]);
  const handleNext = useCallback(() => {
    if (shots.length <= 1) return;
    setActiveIndex(Math.min(shots.length - 1, activeIndex + 1));
  }, [shots.length, activeIndex]);
  const handleJump = useCallback((index: number) => {
    if (index < 0 || index >= shots.length) return;
    setActiveIndex(index);
  }, [shots.length]);

  const navItems = useMemo(() => shots.map((s) => ({
    id: s.id,
    title: `${t('storyboardShotView.shot')} ${s.number}${s.shotType ? ` · ${s.shotType}` : ''}`,
    thumb: <ShotThumb number={s.number} shotType={s.shotType} dark={isDark} />,
  })), [shots, isDark, t]);

  const showNav = shots.length > 1;
  const textPrimary = theme.toolbar.text;
  const textMuted = theme.toolbar.textMuted;
  const accent = theme.toolbar.accent;
  const infoBg = theme.node.fill;
  const contentSurface = isDark ? '#161616' : '#ffffff';

  // 信息条摘要
  const dialogue = activeShot?.dialogue?.trim();
  const envText = activeShot ? formatEnvironment(activeShot.environment) : '';
  const lightingText = activeShot ? formatLighting(activeShot.lighting) : '';
  const entityNames = activeShot?.entities.map((e) => entityDisplayName(e)).filter(Boolean).join('、');
  const promptText = activeShot?.prompt?.trim() ?? activeShot?.promptText?.trim() ?? '';

  // 生成中覆盖提示
  const generating = status === 'generating';

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', minHeight: 0 }}>
      {/* 左侧垂直导航（剧管/堆叠同一套 ThumbNav 框架） */}
      {showNav && (
        <ThumbNav
          orientation="vertical"
          items={navItems}
          activeIndex={activeIndex}
          total={shots.length}
          onPrev={handlePrev}
          onNext={handleNext}
          onJump={handleJump}
        />
      )}

      {/* 右侧主区：封面舞台 + 信息条 */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {generating && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 5, background: isDark ? 'rgba(23,23,23,0.55)' : 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 24, height: 24, border: '2px solid', borderColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.15)', borderTopColor: accent, borderRadius: '50%', animation: 'zeroexo-spin 1s linear infinite' }} />
              <span style={{ fontSize: 11, color: textMuted }}>{t('storyboard.generatingEpisode')} {progress ?? 0}%</span>
            </div>
          </div>
        )}
        {/* 封面舞台 */}
        <div style={{
          flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', background: contentSurface,
        }}>
          {activeShot ? (
            <ShotCover shot={activeShot} dark={isDark} />
          ) : (
            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(15,23,42,0.3)' }}>
              <Aperture size={40} />
              <span style={{ fontSize: 11, opacity: 0.75 }}>{t('storyboardShotView.noShots')}</span>
            </div>
          )}
        </div>

        {/* 信息条（剧管同款：编号 + 景别徽章 + 描述摘要；对白独立一行换行显示，避免截断） */}
        <div style={{
          flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 12px', background: infoBg,
        }}>
          {activeShot && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: textPrimary, flexShrink: 0 }}>
                  {t('storyboardShotView.shot')} {activeShot.number}
                </span>
                {activeShot.shotType && (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', flexShrink: 0, borderRadius: 999,
                    padding: '1px 8px', fontSize: 10, fontWeight: 600, lineHeight: '18px',
                    background: `${accent}18`, color: accent,
                  }}>
                    {activeShot.shotType}
                  </span>
                )}
                <span style={{ flex: 1, minWidth: 0, fontSize: 10, color: textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[`${activeShot.duration}s`, envText, lightingText, entityNames].filter(Boolean).join(' · ')}
                </span>
                {!readOnly && promptText && (
                  <span style={{ flexShrink: 0, fontSize: 10, color: textMuted, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, display: 'inline-block' }} />
                    {t('storyboardShotView.hasPrompt')}
                  </span>
                )}
              </div>
              {dialogue && (
                <div style={{ fontSize: 11, color: textPrimary, opacity: 0.9, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.55, maxHeight: 76, overflowY: 'auto' }} className="zx-thin-scroll">
                  “{dialogue}”
                </div>
              )}
            </>
          )}
          {!activeShot && !generating && (
            <span style={{ fontSize: 11, color: textMuted }}>{t('storyboardShotView.noShots')}</span>
          )}
        </div>
      </div>
    </div>
  );
});

/** 样式（对齐剧管 ProductionManagerView 无边线风格） */
export function coverAreaStyle(contentSurface: string): CSSProperties {
  return {
    flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', background: contentSurface,
  };
}
