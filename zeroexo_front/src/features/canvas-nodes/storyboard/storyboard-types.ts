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

// 2026-08-22 多景别兼容(用户拍板): 放宽为自由文本——一镜到底等复合景别(如「全景→特写」)直接以字符串承载,
// 与 CameraMovement 同策略(预设 + 自定义输入); 预设清单见 ShotSizePickerModal SHOTS
export type ShotType = string;
export type CameraMovement = string;
export type ShotTransition = 'cut' | 'fade' | 'dissolve' | 'wipe' | 'match' | 'jump';
export type EntityKind = 'character' | 'scene' | 'prop';

// ===== 主体引用 =====

export interface EntityRef {
  entityId: string;
  mention: string;
  stateId?: string;
  /** 2026-08-21: 映射到的剧管条目 id(剧管=分镜后置, 分镜主体列点击实体可映射到剧管条目) */
  cardId?: string;
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

/** 镜头剧照（一镜对多图，一图一提示词——Plan#33 C2 全屏编辑复用剧管图册结构） */
export interface ShotImage {
  /** 图片资源 storageKey */
  storageKey: string;
  /** 该图的独立生成提示词 */
  prompt?: string;
  /** 备注 */
  note?: string;
  /** 自由标签 */
  tags: string[];
}

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
  /** Plan#20 T2: 后端分块产出字符串数组, 旧数据为 EntityRef[] —— 双兼容, 展示用 entityDisplayName */
  entities: Array<EntityRef | string>;
  emotion: string;
  /** Plan#20 T2: 后端产出字符串(光影描述), 旧数据为对象 —— 双兼容, 展示统一走 formatLighting */
  lighting: string | LightingDesign;
  environment: string | EnvironmentDesign;
  continuity: { transition: ShotTransition };
  prompt: string;
  /** Plan#20 T2: 后端分块契约提示词字段(prompt 列映射 promptText) */
  promptText?: string;
  promptEn?: string;
  /** Plan#33 C2: 镜头剧照集（一镜对多图，一图一提示词；旧数据无此字段兼容空） */
  images?: ShotImage[];
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

/** Plan#20 T4: 后端汇总阶段产出的主体字典条目(T3: 表格主体列 kind 查找源) */
export interface AiSubject {
  name: string;
  kind: EntityKind;
  aliases: string[];
  description: string;
}

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
  /** Plan#20 T4: 后端汇总阶段产出的主体字典(供占位主体堆叠创建/主体标注匹配) */
  aiSubjects?: AiSubject[];
  /** 2026-08-21: 关联剧管节点 id(剧管=分镜后置工序, 分镜主体列映射到剧管条目) */
  productionManagerId?: string;
}

// ===== Plan#20 T5: 主体节点数据类型 =====

/** 状态级音色（选填，Plan#20 重设计 v2：**音频资产引用**而非预设） */
export interface SubjectStateVoice {
  /** 音频素材 storageKey（从资产库选择或用户上传） */
  key: string;
  /** 显示名 */
  name: string;
  /** 备注（选填） */
  note?: string;
}

/** 状态内单张图片（一图一提示词，提示词互相隔离，选填） */
export interface SubjectStateImage {
  storageKey: string;
  /** 该图的独立生成提示词（选填；生成同款等操作无提示词时给出提示） */
  prompt?: string;
}

/** 主体状态（形象剧照 + 一图一提示词） */
export interface SubjectState {
  id: string;
  name: string;
  /** 形象图列表（每张带独立提示词，备选方案全保留） */
  images: SubjectStateImage[];
  /** 备注 */
  note: string;
  /** 状态级音色（选填，音频资产引用，无则不显示播放器） */
  voice?: SubjectStateVoice;
  /** 停用标记（被引用状态禁删只可停用，防引用断裂；停用后下拉不可选） */
  disabled?: boolean;
}

/** 音效素材条目（voice/ambient/sfx 三类通用） */
export interface SubjectAudio {
  key: string;
  name: string;
  kind: 'voice' | 'ambient' | 'sfx';
  note: string;
}

/** 主体节点 node.data 结构（Plan#20 T5） */
export interface SubjectCardData {
  /** 主体名 */
  name: string;
  /** 主体类型 */
  kind: EntityKind;
  /** 一致性描述（逐字复用到视频生成提示词） */
  consistency: string;
  /** 别名列表（再生成对账用） */
  aliases: string[];
  /** 封面立绘 storageKey */
  coverKey: string | null;
  /** 状态集合 */
  states: SubjectState[];
  /** 当前活跃状态 id */
  activeStateId: string | null;
  /** 音效素材 */
  audio: SubjectAudio[];
  /** 跨集归属（多集关联用） */
  episodeIds: string[];
  /** 资产库 Subject id（用户「发送资产」后回填） */
  assetSubjectId: string | null;
  /** AI 占位创建未转正（AI 建卡标记 true；用户任何编辑后清除；占位未转正风险检测依据） */
  placeholder?: boolean;
}