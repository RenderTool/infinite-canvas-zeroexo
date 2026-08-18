/**
 * storyboard-utils - 分镜工具函数
 *
 * 从 storyboard-sheet.tsx 中抽离的辅助函数。
 */
import type { Shot, StoryboardNodeData, StoryboardEntity, EntityConflict, StepRecord } from './storyboard-types';

/** 创建新空 shot */
export function createNewShot(shots: Shot[]): Shot {
  const number = shots.length + 1;
  const id = `shot-${Date.now()}-${number}`;
  return {
    id,
    number,
    sceneId: `1-${number}`,
    dayNight: '日',
    duration: 5,
    description: '',
    shotType: '中景',
    cameraMovement: '固定',
    dialogue: '',
    voiceoverText: '',
    monologue: '',
    sfx: [],
    entities: [],
    emotion: '',
    lighting: { keyLight: '自然光', colorTemp: '5500K', mood: '平和' },
    environment: { location: '', time: '午后', weather: '晴' },
    continuity: { transition: 'cut' },
    prompt: '',
  };
}

/** 归一化更新:把传给 updater 的 prev.shots/status/progress 归一化为"当前集"视图 */
export function normalizeUpdate(
  data: StoryboardNodeData,
  activeEpisodeId: string,
  updater: (prev: StoryboardNodeData) => StoryboardNodeData,
): StoryboardNodeData {
  const shots = data.shotsByEpisode?.[activeEpisodeId] ?? (Object.keys(data.shotsByEpisode ?? {}).length > 0 ? [] : (data.shots ?? []));
  const status = data.statusByEpisode?.[activeEpisodeId] ?? (Object.keys(data.statusByEpisode ?? {}).length > 0 ? 'idle' : (data.status ?? 'idle'));
  const progress = data.progressByEpisode?.[activeEpisodeId] ?? data.progress ?? 0;
  const normalizedPrev: StoryboardNodeData = { ...data, shots, status, progress };
  const next = updater(normalizedPrev);
  const sbe = { ...(next.shotsByEpisode ?? {}), [activeEpisodeId]: next.shots };
  return { ...next, shotsByEpisode: sbe };
}

/** 构建 StepRecord 列表（从 shots + entities + conflicts 构建） */
export function buildStepRecords(
  shots: Shot[],
  _entities: StoryboardEntity[],
  conflicts: EntityConflict[],
): StepRecord[] {
  return shots.map((shot) => {
    const shotEntityIds = shot.entities.map((ref) => ref.entityId);
    const shotConflictIds = conflicts
      .filter((c) => c.entities.some((e) => shotEntityIds.includes(e.id)))
      .map((c) => c.groupId);
    return {
      shot,
      entityIds: shotEntityIds,
      conflictIds: shotConflictIds,
    };
  });
}