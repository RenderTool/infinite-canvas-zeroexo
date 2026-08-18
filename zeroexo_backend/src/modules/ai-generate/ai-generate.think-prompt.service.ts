import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 思考类任务的项目基础信息（用于构建 system prompt 的 {{baseInfo}}）
 */
export interface ThinkProjectBaseInfo {
  name?: string;
  genre?: string;
  resolution?: string;
  aspectRatio?: string;
  duration?: string;
}

/**
 * AI 思考 prompt 组装服务
 *
 * 统一封装：
 * - 语言指令（langInstruct）
 * - SKILL.md 读取与占位符替换（buildSystemPrompt）
 * - 项目基础信息拼装（buildBaseInfo）
 * - 用户消息构建（buildUserMessage）
 *
 * 供 AiThinkTaskService / AiThinkStreamService 共享，消除三份重复实现。
 */
@Injectable()
export class AiThinkPromptService {
  private readonly logger = new Logger(AiThinkPromptService.name);

  /** 根据 locale 获取语言指令词 */
  langInstruct(locale: string): string {
    const map: Record<string, string> = {
      zh: '请用中文回复',
      en: 'Please reply in English',
      ja: '日本語で回答してください',
    };
    return map[locale] || 'Please reply in English';
  }

  /**
   * 读取 skills/{agentType}/SKILL.md 并替换占位符。
   * 仅替换实际提供的占位符，行为与各调用方原逻辑一致。
   */
  buildSystemPrompt(
    skillAgentType: string,
    options: { baseInfo?: string; langHint?: string } = {},
  ): string {
    let prompt = this.readSkillMd(skillAgentType);
    if (options.baseInfo) prompt = prompt.replace('{{baseInfo}}', options.baseInfo);
    if (options.langHint) prompt = prompt.replace('{{langHint}}', options.langHint);
    return prompt;
  }

  /** 拼装项目基础信息（{{baseInfo}} 占位符内容） */
  buildBaseInfo(projectData: ThinkProjectBaseInfo): string {
    return [
      `项目名称: ${projectData.name || '未命名'}`,
      projectData.genre ? `影片类型: ${projectData.genre}` : '',
      projectData.resolution ? `分辨率: ${projectData.resolution}` : '',
      projectData.aspectRatio ? `画幅比例: ${projectData.aspectRatio}` : '',
      projectData.duration ? `时长: ${projectData.duration}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** 构建用户消息 */
  buildUserMessage(kind: string, projectData: any, _locale: string = 'zh'): string {
    if (kind === 'inspire') {
      return `用户创意描述：${projectData.name || '未命名项目'}\n\n请根据以上创意描述，先进行全面的项目分析，然后生成3-5个多样化的可执行方案。`;
    }
    if (kind === 'script_import') {
      const episodeMode = projectData.episodeMode || 'auto';
      const episodeCount = projectData.episodeCount || 0;
      const modeHint = episodeMode === 'auto'
        ? '请根据内容量自动判断合适的集数'
        : episodeMode === 'manual'
          ? `用户期望拆分 ${episodeCount} 集（请以内容量合理判断，如果内容不足以拆分到 ${episodeCount} 集，按实际内容量合理拆分）`
          : '请合并为单集';
      return `## 原始剧本内容\n\n${projectData.content || ''}\n\n## 分集要求\n\n${modeHint}\n\n请严格按照输出格式输出两行 JSON。\n\n重要：content 字段中的换行必须使用 \\n 转义序列，不得使用实际换行符，确保每行 JSON 是完整合法的单行 JSON。`;
    }
    return `分析项目类型：${projectData.genre || '未指定'}`;
  }

  /** 读取 skills/{agentType}/SKILL.md 文件 */
  private readSkillMd(agentType: string): string {
    const skillPath = path.join(
      __dirname,
      '../agent/skills',
      agentType,
      'SKILL.md',
    );
    try {
      if (fs.existsSync(skillPath)) {
        return fs.readFileSync(skillPath, 'utf-8');
      }
    } catch (err) {
      this.logger.warn(`读取 SKILL.md 失败: ${skillPath}`, err);
    }
    return '';
  }
}