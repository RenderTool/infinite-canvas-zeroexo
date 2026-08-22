/**
 * agent-factory - Agent 工厂
 *
 * 根据 agentType 从数据库加载配置、读取对应的 SKILL.md 指令文件,
 * 组装 AgentExecutor 实例。
 */

import { Injectable, Inject, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiEventsService } from '../ai-events/ai-events.service';
import { AssetsService } from '../assets/assets.service';
import { AiGenerateService } from '../ai-generate/ai-generate.service';
import { AgentExecutor, LlmService } from './agent-executor';
import { createToolsForAgentType } from './tool-registry';
import { AgentSkillService } from './agent-skill.service';

/**
 * LLM 服务注入令牌 - 供外部模块提供具体的 LLM 实现
 */
export const LLM_SERVICE_TOKEN = 'LLM_SERVICE';

@Injectable()
export class AgentFactory {
  private readonly logger = new Logger(AgentFactory.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsService: AiEventsService,
    private readonly assetsService: AssetsService,
    private readonly aiGenerateService: AiGenerateService,
    private readonly skillService: AgentSkillService,
    @Inject(LLM_SERVICE_TOKEN) private readonly llmService: LlmService,
  ) {}

  /**
   * 创建 AgentExecutor 实例
   * 从 DB 读取配置,从 skills/ 目录读取指令文件
   */
  async create(
    agentType: string,
    projectId: string,
    userId: string,
  ): Promise<AgentExecutor> {
    // 1. 从数据库加载配置
    const config = await this.prisma.aiAgentConfig.findUnique({
      where: { agentType },
    });

    // 2. 读取 SKILL.md + SYSTEM_PROMPT.md
    const skillMd = this.readSkillMd(agentType);
    const systemPromptOverride = this.readSystemPrompt(agentType);

    // 3. 拼接系统指令: 优先 DB 配置, 其次 SYSTEM_PROMPT.md, 再拼 SKILL.md
    const dbSystemPrompt = config?.systemPrompt || '';
    const baseSystemPrompt = dbSystemPrompt || systemPromptOverride;
    let instructions = baseSystemPrompt
      ? `${baseSystemPrompt}\n---\n${skillMd}`
      : skillMd;

    // 4. 注入项目上下文（立项配置数据）
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { config: true },
      });
      if (project?.config) {
        const cfg = project.config as Record<string, any>;
        const projectContext = [
          cfg.name ? `影片名称：${cfg.name}` : '',
          cfg.genre ? `影片类型：${cfg.genre}` : '',
          cfg.resolution ? `分辨率：${cfg.resolution}` : '',
          cfg.aspectRatio ? `画幅比例：${cfg.aspectRatio}` : '',
        ].filter(Boolean).join('\n');
        if (projectContext) {
          instructions += `\n\n## 当前项目立项配置\n${projectContext}\n`;
        }
      }
    } catch (err) {
      this.logger.warn(`读取项目配置失败: ${projectId}`, err);
    }

    // 5. 注入用户 AI 偏好(仅 storyboard_assistant: 提供用户偏好的模型选择,供 ai_image/ai_audio 参考)
    if (agentType === 'storyboard_assistant') {
      try {
        const pref = await this.prisma.userAiPreference.findUnique({
          where: { userId },
        });
        if (pref) {
          const modelPrefs = [
            pref.videoModel ? `视频模型：${pref.videoModel}` : '',
            pref.characterModel ? `形象/角色模型：${pref.characterModel}` : '',
            pref.audioModel ? `音频模型：${pref.audioModel}` : '',
          ].filter(Boolean).join('\n');
          if (modelPrefs) {
            instructions += `\n\n## 当前用户 AI 模型偏好\n${modelPrefs}\n`;
          }
        }
      } catch (err) {
        this.logger.warn(`读取用户 AI 偏好失败: ${userId}`, err);
      }
    }

    // 6. 注入 references 知识文件(按需加载,作为user/context层补充)
    const referencesContent = this.loadReferences(agentType);
    if (referencesContent) {
      instructions += `\n\n## 专业知识参考(按需注入)\n${referencesContent}\n`;
    }

    // 7. 统一语言跟随指令:所有 Agent 输出语言跟随用户输入语言
    instructions +=
      '\n\n## 语言要求\n必须全程使用用户输入的语言进行回复（用户用什么语言输入，就用什么语言输出）。';

    // 8. 创建工具列表(注入完整上下文:prisma + assets + ai-generate + userId + 技能服务)
    const tools = createToolsForAgentType(
      agentType,
      projectId,
      userId,
      this.prisma,
      this.assetsService,
      this.aiGenerateService,
      this.skillService,
    );

    this.logger.log(
      `创建 Agent: ${agentType} (projectId=${projectId}, userId=${userId}, tools=${tools.length})`,
    );

    return new AgentExecutor(
      agentType,
      instructions,
      tools,
      this.llmService,
      this.eventsService,
    );
  }

  /** 读取 skills/{agentType}/SKILL.md 文件 */
  private readSkillMd(agentType: string): string {
    const skillPath = path.join(
      __dirname,
      'skills',
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

  /** 读取 skills/{agentType}/SYSTEM_PROMPT.md 文件（可选的系统提示词增强） */
  private readSystemPrompt(agentType: string): string {
    const sysPromptPath = path.join(
      __dirname,
      'skills',
      agentType,
      'SYSTEM_PROMPT.md',
    );
    try {
      if (fs.existsSync(sysPromptPath)) {
        return fs.readFileSync(sysPromptPath, 'utf-8');
      }
    } catch (err) {
      this.logger.warn(`读取 SYSTEM_PROMPT.md 失败: ${sysPromptPath}`, err);
    }
    return '';
  }

  /**
   * 加载 references/*.md 知识文件(按需注入到user/context层)
   * 每个agentType可配置一组references,避免全部常驻system prompt
   */
  private loadReferences(agentType: string): string {
    const refsDir = path.join(__dirname, 'skills', agentType, 'references');
    if (!fs.existsSync(refsDir)) return '';

    // 按agentType配置需要加载的references文件
    const refMap: Record<string, string[]> = {
      storyboard_assistant: [
        'cinematic-camera-movements.md',
        'cinematic-layouts.md',
        'shot-duration.md',
        'content-safety.md',
        'prompt-template.md',
      ],
    };

    const refs = refMap[agentType];
    if (!refs || refs.length === 0) return '';

    const sections: string[] = [];
    for (const fileName of refs) {
      const filePath = path.join(refsDir, fileName);
      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8');
          // 精简每个reference: 只保留前200行核心内容,避免token膨胀
          const lines = content.split('\n').slice(0, 200);
          const name = fileName.replace(/\.md$/, '');
          sections.push(`### ${name}\n${lines.join('\n')}`);
        }
      } catch (err) {
        this.logger.warn(`读取reference失败: ${filePath}`, err);
      }
    }

    return sections.join('\n\n---\n\n');
  }
}