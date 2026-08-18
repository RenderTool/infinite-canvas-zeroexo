/**
 * ScriptReader - 全屏翻阅阅读模式（Phase 5 第二阶段）
 *
 * PPT 风格翻页动画：纸张以 A4 比例居中展示，切换时带方向滑入 + 轻微 3D 旋转。
 * 快捷键：← / → / PageUp / PageDown / 空格 翻页，Esc 退出。
 *
 * 纸张样式复用 script-styles.css 的 .zx-script-page 命名空间：
 * 外层 .zx-reader-paper 加 zx-script-page，内容加 ql-editor 类，
 * 即可套用米黄纸/磨砂纸背景、Courier 字体与各格式块样式。
 */
import { useEffect, useState, useCallback, type CSSProperties } from 'react';
import { X, ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';
import { Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';
import { Z_INDEX } from '@/shared/constants/z-index.js';
import './ScriptReader.css';
import './script-viewer.css';

/** 阅读页（跨剧集扁平化，globalIndex 从 1 开始） */
export interface ReaderPage {
  episodeId: string;
  episodeNumber: number;
  episodeTitle: string;
  /** 该剧集内页码（从 1 开始） */
  pageNumber: number;
  /** 该剧集总页数 */
  episodeTotalPages: number;
  /** 该页 HTML 片段 */
  html: string;
  /** 全局页码（从 1 开始） */
  globalIndex: number;
}

export interface ScriptReaderProps {
  open: boolean;
  /** 版本名 */
  title: string;
  pages: ReaderPage[];
  accent: string;
  isDark: boolean;
  onClose: () => void;
  /** 自定义 z-index（默认 1000；全屏模式等需要更高层级时传入） */
  zIndex?: number;
}

export function ScriptReader({
  open,
  title,
  pages,
  accent,
  isDark,
  onClose,
  zIndex = Z_INDEX.DROPDOWN,
}: ScriptReaderProps): React.ReactElement | null {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(0);
  /** 翻页方向：'prev' | 'next'，决定进场动画方向 */
  const [direction, setDirection] = useState<'prev' | 'next'>('next');

  // 打开时重置到第一页；页面变化时收敛越界索引
  useEffect(() => {
    if (open) setCurrent(0);
  }, [open]);

  useEffect(() => {
    if (pages.length === 0) return;
    setCurrent((c) => Math.min(c, pages.length - 1));
  }, [pages.length]);

  const goPrev = useCallback(() => {
    setCurrent((c) => {
      if (c <= 0) return c;
      setDirection('prev');
      return c - 1;
    });
  }, []);

  const goNext = useCallback(() => {
    setCurrent((c) => {
      if (c >= pages.length - 1) return c;
      setDirection('next');
      return c + 1;
    });
  }, [pages.length]);

  // 键盘翻页 / 退出
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, goNext, goPrev, onClose]);

  if (!open) return null;

  const page = pages[current];
  const progress = pages.length > 0 ? ((current + 1) / pages.length) * 100 : 0;

  return (
    <div className="zx-reader-overlay" data-theme={isDark ? 'dark' : 'light'} style={{ zIndex }}>
      {/* 顶部栏 */}
      <div className="zx-reader-topbar">
        <span className="zx-reader-title">
          <BookOpen size={15} color={accent} />
          <span>{title} · {t('scriptReader.readingMode')}</span>
        </span>
        <Tooltip title={t('scriptReader.exitEsc')}><button type="button" className="zx-reader-close" onClick={onClose}>
          <X size={16} />
        </button></Tooltip>
      </div>

      {/* 中部翻页舞台 */}
      <div className="zx-reader-stage">
        <Tooltip title={t('scriptReader.previousPage')}>
          <button
          type="button"
          className="zx-reader-nav"
          disabled={current <= 0}
          onClick={goPrev}
        >
          <ChevronLeft size={20} />
        </button>
          </Tooltip>

        <div
          key={current}
          className={`zx-reader-paper zx-script-page ${direction === 'prev' ? 'zx-reader-enter-left' : 'zx-reader-enter-right'}`}
          data-theme={isDark ? 'dark' : 'light'}
        >
          {page ? (
            <>
              <div className="zx-script-reader-meta">
                {t('scriptReader.episodeMeta', { number: page.episodeNumber, title: page.episodeTitle, page: page.pageNumber, total: page.episodeTotalPages })}
              </div>
              <div
                className="ql-editor zx-script-reader-content"
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(page.html) }}
              />
            </>
          ) : (
            <div className="zx-script-reader-empty">{t('scriptReader.emptyContent')}</div>
          )}
        </div>

        <Tooltip title={t('scriptReader.nextPage')}>
        <button
          type="button"
          className="zx-reader-nav"
          disabled={current >= pages.length - 1}
          onClick={goNext}
        >
          <ChevronRight size={20} />
        </button>
        </Tooltip>
      </div>

      {/* 底部进度条 */}
      <div className="zx-reader-bottombar">
        <span className="zx-reader-page-info">
          {t('scriptReader.pageInfo', { current: current + 1, total: pages.length })}
        </span>
        <div className="zx-reader-progress">
          <div style={progressFillStyle(accent, progress)} />
        </div>
        <span className="zx-reader-hint">{t('scriptReader.navigationHint')}</span>
      </div>
    </div>
  );
}

// ===== 内联样式（仅动态部分） =====

const progressFillStyle = (accent: string, progress: number): CSSProperties => ({
  width: `${progress}%`,
  height: '100%',
  borderRadius: 2,
  background: accent,
  transition: 'width 0.25s ease',
});
