/**
 * previs-timeline - 预演轨道生成工具
 *
 * 提供从分镜数据生成预演轨道的工具函数。
 */
import type { Shot } from '../storyboard/storyboard-types';
import type { PrevisTimelineTrack, PrevisClip } from './previs-types';
import i18n from '@/i18n/config';

/** 镜头颜色映射 */
const SHOT_TYPE_COLORS: Record<string, string> = {
  '特写': '#ef4444',
  '近景': '#f97316',
  '中近景': '#eab308',
  '中景': '#22c55e',
  '中远景': '#14b8a6',
  '远景': '#3b82f6',
  '大全景': '#8b5cf6',
  '全景': '#6366f1',
};

function getShotColor(shotType?: string): string {
  return SHOT_TYPE_COLORS[shotType || ''] || '#6b7280';
}

/** 从 Shot 列表生成视频剪辑片段 */
export function generateVideoClips(shots: Shot[]): PrevisClip[] {
  return shots.map((shot, index) => {
    const startTime = shots.slice(0, index).reduce((sum, s) => sum + (s.duration || 5), 0);
    return {
      id: `clip-${shot.id}`,
      shotId: shot.id,
      startTime,
      duration: shot.duration || 5,
      label: `#${shot.number} ${shot.shotType || ''}`,
      color: getShotColor(shot.shotType),
    };
  });
}

/** 生成完整预演轨道列表 */
export function generateTimeline(shots: Shot[]): PrevisTimelineTrack[] {
  const videoClips = generateVideoClips(shots);

  return [
    {
      id: 'track-video',
      name: i18n.t('previs.videoTrack'),
      type: 'video',
      clips: videoClips,
      order: 0,
      visible: true,
    },
    {
      id: 'track-audio',
      name: i18n.t('previs.audioTrack'),
      type: 'audio',
      clips: [],
      order: 1,
      visible: true,
    },
    {
      id: 'track-effect',
      name: i18n.t('previs.effectTrack'),
      type: 'effect',
      clips: [],
      order: 2,
      visible: true,
    },
  ];
}

/** 计算轨道总时长 */
export function calculateTotalDuration(shots: Shot[]): number {
  return shots.reduce((sum, s) => sum + (s.duration || 5), 0);
}

/** 根据时间点查找所在镜头 */
export function findShotAtTime(shots: Shot[], time: number): Shot | undefined {
  let accumulated = 0;
  for (const shot of shots) {
    accumulated += shot.duration || 5;
    if (time <= accumulated) return shot;
  }
  return shots[shots.length - 1];
}