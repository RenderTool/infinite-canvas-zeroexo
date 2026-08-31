/**
 * workbench-types - 出片工作台节点数据类型
 *
 * 数据直接写入 node.data，随画布 Yjs 同步。
 */

export type WorkbenchStatus = 'idle' | 'ready' | 'generating' | 'done';
// idle = 未开拍(初始态), ready = 已就绪(上游连入), generating = 生成中, done = 全部完成

export interface WorkbenchShot {
  id: string;
  number: number;
  description: string;
  shotType: string;
  duration: number;
  imagePrompt?: string;
  videoPrompt?: string;
  status: 'pending' | 'generating' | 'done' | 'failed';
  /** 首帧/尾帧图片 storageKey */
  firstFrameKey?: string;
  lastFrameKey?: string;
  /** 上游分镜 shot 的 id（用于追溯） */
  sourceShotId?: string;

  // ===== 生产台扩展字段 =====
  /** 负面提示词 */
  negativePrompt?: string;
  /** 质量门评分 */
  quality?: {
    score: number;
    deductions: Array<{ item: number; reason: string }>;
    checkedAt: string;
  };
  /** 组装式引擎元信息 */
  promptAssembly?: {
    form: string;
    anchorSentences: string[];
    motionBudget: { subject: number; camera: number; environment: number };
    aspectRatio: string;
    assembledAt: string;
  };
  /** 生成产物：一镜多视频 */
  videos?: Array<{
    storageKey: string;
    model?: string;
    duration?: number;
    aspectRatio?: string;
    prompt?: string;
    status: 'pending' | 'generating' | 'done' | 'failed';
    progress?: number;
    error?: string;
    createdAt?: string;
    /** 来源：generated=本镜生成 / external=外部拖入（2026-08-31 候选语义） */
    source?: 'generated' | 'external';
  }>;
  /** 当前生效的视频 index */
  activeVideoIndex?: number;
  /** 生成过 */
  generated?: boolean;
  /** 用户手动改过 */
  manualEdit?: boolean;
  /** 圣经引用 */
  bibleRefs?: {
    characters: string[];
    scenes: string[];
    props: string[];
  };
  /** 音频预览 */
  audioPreview?: {
    storageKey: string;
    duration?: number;
    name?: string;
  };

  // ===== 参考素材（2026-08-31：出片模式受控数据，存镜头级 node.data，随 Yjs 云同步）=====
  /** 参考素材列表（首帧/尾帧/参考图/参考视频/参考音频/参考文本），生成时作为 referenceKeys 传后端 */
  references?: WorkbenchShotReference[];


  // ===== 生成配置（2026-08-31：与底部生成参数栏双向同步） =====
  /** 当前镜头选用的模型值（"channelId::model" 编码），由 NodeGenerateDock 写入 */
  model?: string;
  /**
   * 契约参数值（模板驱动，存 duration/resolution/ratio 等）。
   * `duration` 与顶层 `duration` 互为镜像：参数面板改 → 轨道 clip 变长；拖动 clip → 参数面板同步。
   */
  paramValues?: Record<string, unknown>;
}

/** 独立素材池条目（2026-08-31）：删除片段后产物沉淀于此，可拖回轨道新建片段 */
export interface WorkbenchMediaAsset {
  id: string;
  /** 云存储 key */
  storageKey: string;
  title?: string;
  model?: string;
  duration?: number;
  /** 来源镜头 id（仅追溯，不参与强关联） */
  fromShotId?: string;
  createdAt: string;
}

/** 出片镜头参考素材（存 node.data → Yjs 云同步，协作可见） */
export interface WorkbenchShotReference {
  /** 本地唯一 id（`ref-${timestamp}-${rand}`） */
  id: string;
  kind: 'image' | 'video' | 'audio' | 'text';
  title?: string;
  /** 云存储 key（优先） */
  storageKey?: string;
  /** 预览 url（图片 dataUrl / 直链兜底） */
  url?: string;
  width?: number;
  height?: number;
  /** 首尾帧模式槽位（仅 kind=image 时） */
  slot?: 'first' | 'last';
}

export interface WorkbenchNodeData {
  status: WorkbenchStatus;
  shots: WorkbenchShot[];
  /** 总时长(秒) */
  totalDuration: number;
  /** 已完成的镜头数 */
  completedCount: number;
  /** 上游分镜节点 id */
  sourceStoryboardId?: string;
  /** 上游统筹节点 id */
  sourceProductionManagerId?: string;
  /** 被本地删除的上游分镜 sourceShotId（resync 合并时跳过，避免删除复活，2026-08-31） */
  deletedSourceShotIds?: string[];
  /** 独立素材池（2026-08-31）：生成/导入的媒体素材独立留存，不强绑某段，删除片段不删素材 */
  mediaAssets?: WorkbenchMediaAsset[];
  /** 上游分镜主体资产（圣经） */
  entities?: Array<{
    id: string;
    name: string;
    kind: string;
    description: string;
    anchorSentence?: string;
    anchorLocked?: boolean;
    /** 主体状态细分（@主体-状态 匹配用，2026-08-31） */
    states?: Array<{ id: string; name: string; note?: string }>;
    referenceImages?: Array<{ storageKey: string; prompt?: string; isPrimary?: boolean }>;
  }>;
}