/**
 * previs-types - Previs(预演)节点类型定义
 *
 * 预演节点用于在画布上展示分镜的预演/预览时间线，包含镜头剪辑轨道和片段信息。
 */
import type { Shot } from '../storyboard/storyboard-types';

/** 预演时间线轨道 */
export interface PrevisTimelineTrack {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'effect' | 'overlay';
  clips: PrevisClip[];
  order: number;
  visible: boolean;
}

/** 预演片段 */
export interface PrevisClip {
  id: string;
  shotId: string;
  /** 轨道内起始时间(秒) */
  startTime: number;
  /** 持续时间(秒) */
  duration: number;
  /** 镜头缩略图 URL */
  thumbnailUrl?: string;
  /** 片段标签 */
  label?: string;
  /** 片段颜色标识 */
  color?: string;
}

/** Previs 节点数据 */
export interface PrevisNodeData {
  /** 关联的分镜节点 id */
  sourceStoryboardId: string;
  /** 预演时间线轨道列表 */
  tracks: PrevisTimelineTrack[];
  /** 总时长(秒) */
  totalDuration: number;
  /** 当前播放位置(秒) */
  currentTime: number;
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 播放速度倍率 */
  playbackRate: number;
  /** 节点状态 */
  status: 'idle' | 'ready' | 'generating' | 'error';
  /** 节点标题 */
  title: string;
}

/** 从 Shot 列表生成默认预演轨道 */
export function createDefaultTracks(shots: Shot[]): PrevisTimelineTrack[] {
  const videoClips: PrevisClip[] = shots.map((shot, index) => {
    const startTime = shots.slice(0, index).reduce((sum, s) => sum + (s.duration || 5), 0);
    return {
      id: `clip-${shot.id}`,
      shotId: shot.id,
      startTime,
      duration: shot.duration || 5,
      label: `#${shot.number} ${shot.shotType || ''}`,
      color: getShotTypeColor(shot.shotType),
    };
  });

  return [
    {
      id: 'track-video',
      name: '画面轨道',
      type: 'video',
      clips: videoClips,
      order: 0,
      visible: true,
    },
    {
      id: 'track-audio',
      name: '音频轨道',
      type: 'audio',
      clips: [],
      order: 1,
      visible: true,
    },
    {
      id: 'track-effect',
      name: '特效轨道',
      type: 'effect',
      clips: [],
      order: 2,
      visible: true,
    },
  ];
}

/** 根据景别返回颜色标识 */
function getShotTypeColor(shotType?: string): string {
  const colorMap: Record<string, string> = {
    '特写': '#ef4444',
    '近景': '#f97316',
    '中近景': '#eab308',
    '中景': '#22c55e',
    '中远景': '#14b8a6',
    '远景': '#3b82f6',
    '大全景': '#8b5cf6',
    '全景': '#6366f1',
  };
  return colorMap[shotType || ''] || '#6b7280';
}