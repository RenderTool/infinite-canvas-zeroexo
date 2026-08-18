/**
 * storyboard-types - 画布分镜节点简化数据类型
 *
 * 与 StoryboardPage 完整数据模型的差异：
 * - 无版本管理（单版本，节点即版本）
 * - 无剧集容器（单镜头列表，单个节点负责一个分镜单元）
 * - 主体简化（无衍生图、无形象管理、无音色）
 * - 数据直接写入 node.data，随画布 Yjs 同步
 */

// ===== 枚举 =====

export type ShotType = '特写' | '近景' | '中景' | '中近景' | '中远景' | '远景' | '大全景' | '全景';
export type CameraMovement = '固定' | '推' | '拉' | '摇' | '移' | '跟' | '升' | '降' | '推拉' | '环绕' | '航拍';
export type ShotTransition = 'cut' | 'fade' | 'dissolve' | 'wipe' | 'match' | 'jump';
export type EntityKind = 'character' | 'scene' | 'prop';

// ===== 主体引用 =====

export interface EntityRef {
  entityId: string;
  mention: string;
  stateId?: string;
  position?: string;
  appearance?: string;
}

// ===== 主体 =====

export interface StoryboardEntity {
  id: string;
  name: string;
  kind: EntityKind;
  description: string;
  source?: EntitySource;
  conflictGroup?: string;
  states?: EntityState[];
  defaultStateId?: string;
  mergedFrom?: string[];
  placeholderImageUrl?: string;
}

// ===== 摄影参数 =====

export interface CameraParams {
  cameraBody: string;
  lensModel: string;
  iso: number;
  shutterAngle: string;
  frameRate: number;
  aspectRatio: string;
}

export interface LightingDesign {
  keyLight: string;
  colorTemp: string;
  mood: string;
}

export interface EnvironmentDesign {
  location: string;
  time: string;
  weather: string;
}

// ===== 镜头 =====

export interface Shot {
  id: string;
  number: number;
  sceneId: string;
  dayNight: string;
  duration: number;
  description: string;
  shotType: ShotType;
  cameraMovement: CameraMovement;
  dialogue: string;
  voiceoverText: string;
  monologue: string;
  sfx: string[];
  entities: EntityRef[];
  emotion: string;
  lighting: LightingDesign;
  environment: EnvironmentDesign;
  continuity: { transition: ShotTransition };
  prompt: string;
}

// ===== 实体关联 =====

export type EntitySource = 'ai_generated' | 'user_manual' | 'merged';

export interface EntityState {
  id: string;
  name: string;
  description: string;
  placeholderImageUrl?: string;
  prompt: string;
  shots: string[];
}

export interface EntityConflict {
  groupId: string;
  entities: StoryboardEntity[];
  confidence: number;
  suggestedName?: string;
  suggestedMerged: boolean;
  resolvedAt?: string;
}

export interface StepRecord {
  shot: Shot;
  entityIds: string[];
  conflictIds: string[];
}

// ===== 画布分镜节点数据 =====

/** 单集分镜的生成状态 */
export type EpisodeStatus = 'idle' | 'generating' | 'ready' | 'error';

export interface StoryboardNodeData {
  shots: Shot[];
  entities: StoryboardEntity[];
  status: 'idle' | 'ready' | 'generating' | 'error';
  /** 是否为范文模板分镜(由剧本"生成分镜"在范文态生成,渲染时标注"范文示例") */
  isSample?: boolean;
  /** AI 生成进度(0-100,仅 status==='generating' 时使用) */
  progress?: number;
  /** 关联的剧本节点 id(冗余存,断开边后仍可读剧集列表;重新生成仍校验边) */
  sourceScriptId?: string;
  /** 当前显示/生成的集 id(存节点内而非跟随剧本激活集,支持分镜内切换集数) */
  activeEpisodeId?: string;
  /** 每集镜头缓存 key=episodeId */
  shotsByEpisode?: Record<string, Shot[]>;
  /** 每集生成状态 key=episodeId */
  statusByEpisode?: Record<string, EpisodeStatus>;
  /** 每集生成进度(0-100) key=episodeId */
  progressByEpisode?: Record<string, number>;
  /** Step 视图记录列表 */
  steps?: StepRecord[];
  /** 实体冲突列表 */
  conflicts?: EntityConflict[];
}