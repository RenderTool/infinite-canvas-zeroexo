/**
 * scheme-types - 方案完整参数类型定义
 *
 * 2 大类参数：基础属性、市场调研。
 * 用于 AI 生成的方案数据模型和 project.config 存储。
 */

// ===== 基础属性 =====
export interface BaseAttributes {
  filmType: string;       // 影片类型: TVC广告/短剧/网络电影/微电影/宣传片/MV/动画短片/纪录片片段
  duration: string;       // 时长: 15s/30s/60s/3min/10min/自定义
  aspectRatio: string;    // 画面比例: 16:9/9:16/1:1/2.35:1/4:3
  quality: string;        // 画面质量: 1080p/4K/8K/杜比视界
  frameRate: string;      // 帧率: 24fps/25fps/30fps/60fps
}

// ===== 市场调研 =====
export interface MarketResearch {
  targetAudience: string;       // 目标受众
  coreSellingPoint: string;     // 核心卖点
  competitiveAdvantage: string; // 竞争优势
  marketPositioning: string;    // 市场定位
}

// ===== 完整方案 =====
export interface Scheme {
  id: string;
  title: string;
  aiSummary: string;
  /** 风格标签（如：电影感、纪录片、动漫、赛博朋克） */
  style?: string;
  /** 画幅（横屏/竖屏/方屏） */
  frame?: string;
  /** 色调（如：暖色调、冷色调、黑白） */
  palette?: string;
  /** 时长建议 */
  duration?: string;
  /** 比例/画面尺寸（如：16:9） */
  aspectRatio?: string;
  /**
   * 该方案专属报告（Markdown，聚焦故事梗概：故事背景/核心冲突/人物主体/叙事结构/视觉基调）。
   * 明确区分于分镜脚本，不含实拍设备指导内容；与「项目分析」（AI 思考展示）相互独立。
   */
  report?: string;
  baseAttributes: BaseAttributes;
  marketResearch: MarketResearch;
  /** 生成时间（毫秒时间戳，用于卡片展示） */
  createdAt?: number;
}

// ===== 历史方案记录 =====
export interface SchemeHistoryRecord {
  id: string;
  brief: string;
  schemes: Scheme[];
  report: Report | null;
  createdAt: number;
  selectedSchemeId: string | null;
}

const SCHEME_HISTORY_KEY = 'zeroexo.schemeHistory.v1';
const SCHEME_HISTORY_MAX = 10;

export function loadSchemeHistory(): SchemeHistoryRecord[] {
  try {
    const raw = localStorage.getItem(SCHEME_HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SchemeHistoryRecord[];
  } catch {
    return [];
  }
}

export function saveSchemeHistory(records: SchemeHistoryRecord[]): void {
  try {
    localStorage.setItem(SCHEME_HISTORY_KEY, JSON.stringify(records.slice(0, SCHEME_HISTORY_MAX)));
  } catch {
    // 静默失败
  }
}

export function addToSchemeHistory(record: SchemeHistoryRecord): SchemeHistoryRecord[] {
  const current = loadSchemeHistory();
  // 移除同 brief 的旧记录
  const filtered = current.filter((r) => r.brief !== record.brief);
  const next = [record, ...filtered].slice(0, SCHEME_HISTORY_MAX);
  saveSchemeHistory(next);
  return next;
}

export function deleteFromSchemeHistory(id: string): SchemeHistoryRecord[] {
  const current = loadSchemeHistory();
  const next = current.filter((r) => r.id !== id);
  saveSchemeHistory(next);
  return next;
}

// ===== 综合报告 =====
export interface ReportSection {
  title: string;
  content: string;
  details?: string[];
}

export interface Report {
  corePositioning: ReportSection;
  marketAnalysis: ReportSection;
  contentCreative: ReportSection;
  technicalFeasibility: ReportSection;
  businessModel: ReportSection;
  socialImpact: ReportSection;
}

// ===== project.config 结构 =====
export interface ProjectSetupConfig {
  setupStatus: 'briefing' | 'generating' | 'reviewing' | 'confirmed';
  brief: string;
  report: Report | null;
  schemes: Scheme[];
  selectedSchemeId: string | null;
  confirmedScheme: Scheme | null;
  activeTaskId: string | null;
  activeTaskKind: 'report' | 'scheme' | null;
  /** 剧本导入标记 */
  scriptImport?: { sourceType?: string };
  /** 历史选题记录（云同步持久化，关联到具体项目） */
  schemeHistory?: SchemeHistoryRecord[];
  /** 集数偏好（AI 生成剧本时使用） */
  episodePreference?: {
    /** 'auto' = AI 智能分析, 'manual' = 用户手动指定 */
    mode: 'auto' | 'manual';
    /** 手动指定时的集数 */
    count: number;
  };
}

/** 默认方案（用于创建空白项目时的初始值） */
export function createDefaultScheme(): Scheme {
  return {
    id: 'default',
    title: '默认方案',
    aiSummary: '',
    baseAttributes: {
      filmType: 'TVC广告',
      duration: '30s',
      aspectRatio: '16:9',
      quality: '1080P',
      frameRate: '24fps',
    },
    marketResearch: {
      targetAudience: '',
      coreSellingPoint: '',
      competitiveAdvantage: '',
      marketPositioning: '',
    },
  };
}