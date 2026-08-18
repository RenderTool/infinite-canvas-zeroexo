/**
 * HeroVideoPlayer - 右侧品牌展示区背景视频播放器
 *
 * 支持多视频顺序播放:从后端获取视频列表,每个视频播放结束后自动播放下一个。
 * 每个视频可配置专属回退图片,无则使用全局回退图片。
 * 视频 URL 从后端品牌配置动态加载,支持后端随时更换门户视频而无需前端重新打包。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadBrandingConfig, type BrandingConfig, type HeroVideoItem } from '@/services/branding-config.js';

/** 内置回退图片(体积小,打包进 dist) */
const FALLBACK_IMAGE = '/images/hero-fallback.webp';

export function HeroVideoPlayer(): React.ReactElement {
  const [config, setConfig] = useState<BrandingConfig | null>(null);
  const [videoError, setVideoError] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadBrandingConfig().then((cfg) => {
      if (!cancelled) setConfig(cfg);
    });
    return () => { cancelled = true; };
  }, []);

  // 计算有效视频列表
  const activeVideos = useMemo(() => {
    if (!config) return [];
    return (config.heroVideos || []).filter((v) => v.enabled !== false);
  }, [config]);

  const hasMultiple = activeVideos.length > 1;
  const fallbackImage = config?.heroFallbackImage ?? FALLBACK_IMAGE;

  // 当前视频
  const currentVideo: HeroVideoItem | null = useMemo(() => {
    if (activeVideos.length === 0) return null;
    const idx = Math.min(currentIndex, activeVideos.length - 1);
    return activeVideos[idx] ?? null;
  }, [activeVideos, currentIndex]);

  // 当前视频的专属回退图片(优先使用,无则用全局)
  const currentFallback = currentVideo?.image || fallbackImage;

  // 视频播放结束 → 自动播放下一个
  const handleVideoEnded = useCallback(() => {
    if (hasMultiple) {
      setCurrentIndex((prev) => (prev + 1) % activeVideos.length);
    }
  }, [hasMultiple, activeVideos.length]);

  // 视频加载错误 → 切换到下一个或降级图片
  const handleVideoError = useCallback(() => {
    if (hasMultiple && currentIndex < activeVideos.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setVideoError(true);
    }
  }, [hasMultiple, currentIndex, activeVideos.length]);

  // 重置 videoError 当切换视频时
  useEffect(() => {
    setVideoError(false);
  }, [currentIndex]);

  // 回退到图片
  if (videoError || !currentVideo) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        background: `#0d0b0a url(${currentFallback}) center/cover no-repeat`,
      }}>
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '40%',
          background: 'linear-gradient(transparent, rgba(13,11,10,0.85))',
          pointerEvents: 'none',
        }} />
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: '#0d0b0a' }}>
      <video
        key={currentVideo.url}
        ref={videoRef}
        autoPlay
        muted
        playsInline
        onError={handleVideoError}
        onEnded={handleVideoEnded}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      >
        <source src={currentVideo.url} type="video/mp4" />
      </video>

      {/* 底部渐变遮罩 */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '40%',
        background: 'linear-gradient(transparent, rgba(13,11,10,0.85))',
        pointerEvents: 'none',
      }} />

      {/* 多视频指示器 */}
      {hasMultiple && (
        <div style={{
          position: 'absolute',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 8,
          zIndex: 10,
        }}>
          {activeVideos.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentIndex(idx)}
              aria-label={`播放第 ${idx + 1} 个视频`}
              style={{
                width: 24,
                height: 3,
                borderRadius: 2,
                border: 'none',
                cursor: 'pointer',
                background: idx === currentIndex ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)',
                transition: 'background 0.2s',
                padding: 0,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}