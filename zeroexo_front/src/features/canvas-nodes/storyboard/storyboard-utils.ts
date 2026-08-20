/**
 * storyboard-utils - 分镜工具函数
 *
 * 从 storyboard-sheet.tsx 中抽离的辅助函数。
 */
import type { Shot, StoryboardNodeData, StoryboardEntity, EntityRef, EntityConflict, StepRecord } from './storyboard-types';

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
    // Plan#20 T2: entities 双兼容(EntityRef|string), 字符串形态无 entityId 不参与冲突匹配
    const shotEntityIds = shot.entities
      .map((e) => (typeof e === 'string' ? '' : e.entityId))
      .filter(Boolean);
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

// ===== Plan#20 T2: 契约统一工具(后端字符串产出 / 旧数据对象双兼容) =====

/** 光影字符串化: string 直显 / 对象拼 mood·keyLight·colorTemp */
export function formatLighting(lighting: Shot['lighting'] | undefined | null): string {
  if (lighting == null) return '';
  if (typeof lighting === 'string') return lighting;
  return [lighting.mood, lighting.keyLight, lighting.colorTemp].filter(Boolean).join('，');
}

/** 环境字符串化: string 直显 / 对象拼 location·time·weather */
export function formatEnvironment(env: Shot['environment'] | undefined | null): string {
  if (env == null) return '';
  if (typeof env === 'string') return env;
  return [env.location, env.time, env.weather].filter(Boolean).join('，');
}

/** 实体展示名双兼容(EntityRef 取 mention / string 直显) */
export function entityDisplayName(e: EntityRef | string | undefined | null): string {
  if (e == null) return '';
  return typeof e === 'string' ? e : (e.mention ?? '');
}

/**
 * onDone 适配层(写入 node.data 前跑一遍):
 * - lighting/environment 异常形态(非 string 非对象)转字符串
 * - entities 归一为数组(容忍字符串/空)
 * - prompt 映射 promptText(后端分块契约无 prompt 字段)
 * - 新旧数据(含断点续跑复用旧子任务产出)一次适配
 */
export function normalizeShotForUi(raw: Record<string, any>): Shot {
  const shot = { ...raw } as Shot;
  if (shot.lighting != null && typeof shot.lighting !== 'string' && typeof shot.lighting !== 'object') {
    shot.lighting = String(shot.lighting);
  }
  if (shot.environment != null && typeof shot.environment !== 'string' && typeof shot.environment !== 'object') {
    shot.environment = String(shot.environment);
  }
  if (!Array.isArray(shot.entities)) {
    shot.entities = typeof shot.entities === 'string' && shot.entities ? [shot.entities] : [];
  }
  if (!shot.prompt && typeof (shot as any).promptText === 'string') {
    shot.prompt = (shot as any).promptText;
  }
  // 2026-08-20: 对白/旁白/音效字段默认值兜底(旧数据或缺字段时不致空列异常)
  if (typeof shot.dialogue !== 'string') shot.dialogue = shot.dialogue != null ? String(shot.dialogue) : '';
  if (typeof shot.voiceoverText !== 'string') shot.voiceoverText = shot.voiceoverText != null ? String(shot.voiceoverText) : '';
  if (typeof shot.monologue !== 'string') shot.monologue = shot.monologue != null ? String(shot.monologue) : '';
  if (!Array.isArray(shot.sfx)) {
    shot.sfx = typeof shot.sfx === 'string' && shot.sfx ? [shot.sfx] : [];
  }
  return shot;
}