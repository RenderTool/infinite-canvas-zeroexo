import { Injectable } from '@nestjs/common';
import {
  ShotInputDto,
  VideoPromptResultDto,
} from './dto/generate-video-prompt.dto';

/**
 * 景别 → 英文构图描述映射
 */
const SHOT_TYPE_MAP: Record<string, string> = {
  '特写': 'close-up shot',
  '近景': 'medium close-up',
  '中近景': 'medium close shot',
  '中景': 'medium shot',
  '中远景': 'medium long shot',
  '远景': 'long shot',
  '大全景': 'wide shot',
  '全景': 'full shot',
};

/**
 * 景别 → 画幅比映射
 *
 * 特写/近景 → 强调人物面部，较方正
 * 中景/中近景 → 标准宽度
 * 远景/中远景 → 宽画幅
 * 大全景/全景 → 超宽
 */
const SHOT_TYPE_ASPECT: Record<string, string> = {
  '特写': '1:1',
  '近景': '4:3',
  '中近景': '16:9',
  '中景': '16:9',
  '中远景': '16:9',
  '远景': '16:9',
  '大全景': '21:9',
  '全景': '16:9',
};

/**
 * 默认负面提示词（按场景类型）
 */
const DEFAULT_NEGATIVE_PROMPT =
  '变形, 扭曲, 模糊, 重影, 画面抖动, 肢体畸形, 多指, 缺指, 面部扭曲, 色彩失真, 过度曝光, 欠曝, 噪点, 水印, 文字, 边框, 低分辨率, 画面撕裂, 闪烁';

/**
 * 视频提示词生成服务
 *
 * 从分镜字段生成视频生成模型可消费的 imagePrompt 和 videoPrompt。
 * 使用模板化拼接而非 AI 调用，零额外成本。
 */
@Injectable()
export class VideoPromptService {

  /**
   * 单镜头生成 imagePrompt 和 videoPrompt
   */
  generateVideoPrompt(shot: ShotInputDto): VideoPromptResultDto {
    const imagePrompt = this.buildImagePrompt(shot);
    const videoPrompt = this.buildVideoPrompt(shot);
    const negativePrompt = DEFAULT_NEGATIVE_PROMPT;
    const aspectRatio = this.mapAspectRatio(shot.shotType);
    return { imagePrompt, videoPrompt, negativePrompt, aspectRatio };
  }

  /**
   * 批量生成
   */
  generateVideoPromptBatch(shots: ShotInputDto[]): VideoPromptResultDto[] {
    return shots.map((shot) => this.generateVideoPrompt(shot));
  }

  // ──────────────────────────────────────────────
  //  imagePrompt 构建
  // ──────────────────────────────────────────────

  /**
   * 句式: [主体描述], [场景描述], [动作/姿态], [构图], [光线], [风格], 高质量, 细节丰富, 电影级
   */
  private buildImagePrompt(shot: ShotInputDto): string {
    const parts: string[] = [];

    // 1. 主体描述
    parts.push(this.buildSubjectPart(shot));

    // 2. 场景描述
    const env = shot.environment?.trim() || this.extractContext(shot.description, 30);
    if (env) parts.push(env);

    // 3. 动作/姿态
    const action = this.extractAction(shot);
    if (action) parts.push(action);

    // 4. 构图（景别）
    parts.push(this.mapShotType(shot.shotType));

    // 5. 光线
    const lighting = shot.lighting?.trim() || this.inferLighting(shot);
    if (lighting) parts.push(lighting);

    // 6. 风格 + 质量后缀
    parts.push('电影级, 写实风格, 8K, 高质量, 细节丰富');

    return parts.join(', ');
  }

  // ──────────────────────────────────────────────
  //  videoPrompt 构建
  // ──────────────────────────────────────────────

  /**
   * 句式: [运镜指导] [场景氛围] [主体动作] [情绪基调] [时间维度] 高质量, 电影级, 细节丰富, 连贯流畅
   */
  private buildVideoPrompt(shot: ShotInputDto): string {
    const parts: string[] = [];

    // 1. 运镜指导
    const camera = this.mapCameraMovement(shot.cameraMovement);
    if (camera) parts.push(camera);

    // 2. 场景氛围
    const atmosphere = this.buildAtmosphere(shot);
    if (atmosphere) parts.push(atmosphere);

    // 3. 主体动作
    const mainAction = this.buildMainAction(shot);
    if (mainAction) parts.push(mainAction);

    // 4. 情绪基调
    const mood = this.buildMood(shot);
    if (mood) parts.push(mood);

    // 5. 时间维度
    parts.push(`${shot.duration}秒时长`);

    // 6. 质量后缀
    parts.push('高质量, 电影级, 细节丰富, 连贯流畅');

    return parts.join(', ');
  }

  // ──────────────────────────────────────────────
  //  辅助方法
  // ──────────────────────────────────────────────

  /**
   * 构建主体描述部分
   * 优先使用 entities 中的描述，其次从 description 提取
   */
  private buildSubjectPart(shot: ShotInputDto): string {
    if (shot.entities && shot.entities.length > 0) {
      return shot.entities
        .map((e) => e.description || e.name)
        .filter(Boolean)
        .join(', ');
    }
    // 无主体时从 description 提取前 60 字作为主体描述
    return this.extractContext(shot.description, 60);
  }

  /**
   * 从 description 中提取上下文（前 N 字符）
   * 截断时在句尾边界（。！？；）处断开，避免截断语义
   */
  private extractContext(text: string, maxLen: number): string {
    if (!text) return '';
    const cleaned = text.replace(/[\n\r]+/g, ' ').trim();
    if (cleaned.length <= maxLen) return cleaned;
    return this.truncateAtBoundary(cleaned, maxLen);
  }

  /**
   * 从 description 中提取动作部分（用于 imagePrompt）
   * 限制 120 字符，截断在句尾
   */
  private extractAction(shot: ShotInputDto): string {
    const desc = shot.description?.trim();
    if (!desc) return '';

    // 若有台词/旁白，标注在动作中
    const dialogueParts: string[] = [];
    if (shot.dialogue) dialogueParts.push(`对话:"${shot.dialogue}"`);
    if (shot.voiceoverText) dialogueParts.push(`旁白:"${shot.voiceoverText}"`);
    const dialogueSuffix = dialogueParts.length > 0 ? ` (${dialogueParts.join('; ')})` : '';

    const MAX_ACTION_LEN = 120;
    return desc.length > MAX_ACTION_LEN
      ? this.truncateAtBoundary(desc, MAX_ACTION_LEN) + '…' + dialogueSuffix
      : desc + dialogueSuffix;
  }

  /**
   * 景别映射
   * 2026-08-22 多景别兼容: 复合景别(如「全景→特写」/「全景-特写」/「全景到特写」)拆起幅/落幅两端分别映射,
   * 输出 "wide shot to close-up" 保留一镜到底的景别演进意图; 未命中映射回退 "{原文} shot"
   */
  private mapShotType(shotType: string): string {
    const t = shotType.trim();
    if (!t) return '';
    const parts = t.split(/[→\-到]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const from = SHOT_TYPE_MAP[parts[0]] || `${parts[0]} shot`;
      const to = SHOT_TYPE_MAP[parts[parts.length - 1]] || `${parts[parts.length - 1]} shot`;
      return `${from} to ${to}`;
    }
    return SHOT_TYPE_MAP[t] || `${t} shot`;
  }

  /**
   * 运镜：直接透传原始 cameraMovement 文本，不限制 AI 解释
   * 支持组合运镜描述（如"推+摇+移"、"先推后拉环绕"）
   */
  private mapCameraMovement(cameraMovement: string): string {
    const trimmed = cameraMovement.trim();
    if (!trimmed) return '';
    return trimmed;
  }

  /**
   * 推断光线（lighting 为空时）
   */
  private inferLighting(shot: ShotInputDto): string {
    const env = shot.environment?.toLowerCase() || '';
    const desc = shot.description?.toLowerCase() || '';
    if (env.includes('夜') || desc.includes('夜') || desc.includes('暗')) return '低光, 暗调';
    if (env.includes('室') || desc.includes('室')) return '室内光, 柔和';
    if (env.includes('日') || desc.includes('日') || desc.includes('阳光')) return '自然光, 明亮';
    return '柔和光';
  }

  /**
   * 构建场景氛围（environment + lighting）
   */
  private buildAtmosphere(shot: ShotInputDto): string {
    const env = shot.environment?.trim() || '';
    const lighting = shot.lighting?.trim() || '';
    if (env && lighting) return `${env}, ${lighting}氛围`;
    if (env) return `${env}氛围`;
    if (lighting) return `${lighting}氛围`;
    return '';
  }

  /**
   * 构建主体动作（含台词）
   * 用于 videoPrompt，限制 300 字符，截断在句尾
   */
  private buildMainAction(shot: ShotInputDto): string {
    const desc = shot.description?.trim() || '';
    const dialogueParts: string[] = [];
    if (shot.dialogue) dialogueParts.push(`对话:"${shot.dialogue}"`);
    if (shot.voiceoverText) dialogueParts.push(`旁白:"${shot.voiceoverText}"`);
    if (shot.monologue) dialogueParts.push(`内心独白:"${shot.monologue}"`);
    const dialogueSuffix = dialogueParts.length > 0 ? ` (${dialogueParts.join('; ')})` : '';

    const MAX_ACTION_LEN = 300;
    return desc.length > MAX_ACTION_LEN
      ? this.truncateAtBoundary(desc, MAX_ACTION_LEN) + '…' + dialogueSuffix
      : desc + dialogueSuffix;
  }

  /**
   * 构建情绪基调
   */
  private buildMood(shot: ShotInputDto): string {
    const emotion = shot.emotion?.trim();
    if (emotion) return `${emotion}情绪`;
    return '';
  }

  // ──────────────────────────────────────────────
  //  新增：截断 / 画幅比 / 负面提示词
  // ──────────────────────────────────────────────

  /**
   * 在句尾边界截断文本，避免语义被切断
   * 从 maxLen 位置向前搜索最近的句尾标记（。！？；\n）
   */
  private truncateAtBoundary(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    const head = text.slice(0, maxLen);
    const boundaryChars = '。！？；\n.!?;';
    const searchStart = Math.max(0, head.length - 100);
    for (let i = head.length - 1; i >= searchStart; i--) {
      if (boundaryChars.includes(head[i])) {
        return head.slice(0, i + 1);
      }
    }
    // 未找到句尾边界，回退到最长截断
    return head;
  }

  /**
   * 景别 → 画幅比映射
   * 2026-08-22 多景别兼容: 复合景别取落幅(最后一段)映射画幅比, 如「全景→特写」→ 特写 1:1
   */
  private mapAspectRatio(shotType: string): string {
    const t = shotType.trim();
    const parts = t.split(/[→\-到]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      return SHOT_TYPE_ASPECT[last] || '16:9';
    }
    return SHOT_TYPE_ASPECT[t] || '16:9';
  }
}