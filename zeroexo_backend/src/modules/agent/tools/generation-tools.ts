/**
 * generation-tools — AI 生成工具（storyboard_assistant 专用）
 *
 * 包含 AI 生图、生音频、素材列表、生成轮询。
 */

import type { Tool, ToolContext, PollOpts, PollResult } from './tool-types';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GenerateRequestDto } from '../../ai-generate/dto/generate-request.dto';

/** ai_image - 提交 AI 生图 + 轮询结果 + 落 Asset + 返回 storageKey */
export function aiImage(ctx: ToolContext): Tool {
  return {
    name: 'ai_image',
    description:
      'AI 生成图片(同步,等待完成)。返回 { storageKey, assetId, width, height, generationId }。会自动写入 Asset 表,refCount +1。model 必填。mode=\'turnaround\' 时自动拼接角色三视图(正面/侧面/背面)提示词,生成单张并排三视图',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图片生成提示词(主体描述;mode=turnaround 时仅需给角色静态外貌描述)' },
        negativePrompt: { type: 'string', description: '反向提示词(可选)' },
        model: { type: 'string', description: '模型名,例如 gemini-3-pro-image-preview(必填)' },
        providerId: { type: 'string', description: '指定渠道 ID(可选,默认 AI 默认渠道)' },
        mode: { type: 'string', enum: ['standard', 'turnaround'], description: 'standard=单图;turnaround=角色三视图(可选)' },
        aspectRatio: { type: 'string', description: '宽高比,例如 1:1 / 16:9 / 4:3(可选)' },
        size: { type: 'string', description: '尺寸,例如 1024x1024(可选)' },
        quality: { type: 'string', description: '质量,standard/hd(可选)' },
        referenceImageStorageKeys: {
          type: 'array',
          items: { type: 'string' },
          description: '参考图 storageKey 列表(图生图)',
        },
      },
      required: ['prompt', 'model'],
    },
    execute: async (args: {
      prompt: string;
      negativePrompt?: string;
      model: string;
      providerId?: string;
      mode?: 'standard' | 'turnaround';
      aspectRatio?: string;
      size?: string;
      quality?: string;
      referenceImageStorageKeys?: string[];
    }) => {
      if (!ctx.aiGenerateService) {
        throw new Error('ai_image 工具不可用:缺少 AiGenerateService 注入');
      }

      const TURNAROUND_SUFFIX =
        ', character turnaround reference sheet, three views side by side: front view (facing camera), side profile, back view, same character, same clothing and wardrobe, same hair style, same lighting angle, consistent body proportions, neutral studio background, full body, character design sheet';
      const finalPrompt =
        args.mode === 'turnaround'
          ? `${args.prompt}${TURNAROUND_SUFFIX}`
          : args.prompt;

      const params: Record<string, unknown> = {};
      if (args.aspectRatio) params.ratio = args.aspectRatio;
      if (args.size) params.size = args.size;
      if (args.quality) params.quality = args.quality;
      if (Array.isArray(args.referenceImageStorageKeys)) {
        params.referenceImages = args.referenceImageStorageKeys;
      }

      const dto: GenerateRequestDto = {
        kind: 'image',
        prompt: finalPrompt,
        negativePrompt: args.negativePrompt,
        model: args.model,
        providerId: args.providerId,
        params,
        projectId: ctx.projectId,
        tags: ['storyboard_assistant'],
      };

      const submit = await ctx.aiGenerateService.generate(ctx.userId, dto);
      const generationId = (submit as any).generationId;
      if (!generationId) {
        throw new Error('ai_image: 提交生成任务失败,未返回 generationId');
      }

      const result = await pollGenerationResult(ctx.prisma, generationId, {
        timeoutMs: 5 * 60 * 1000,
        intervalMs: 1500,
        userId: ctx.userId,
      });

      if (result.status === 'failed') {
        throw new Error(`ai_image: 生成失败 - ${result.errorMessage ?? '未知错误'}`);
      }
      if (result.status === 'cancelled') {
        throw new Error('ai_image: 任务被取消');
      }
      if (!result.storageKey) {
        throw new Error('ai_image: 生成成功但未返回 storageKey');
      }

      return {
        success: true,
        generationId,
        storageKey: result.storageKey,
        assetId: result.assetId,
        width: result.width,
        height: result.height,
        message: '图片生成完成',
      };
    },
  };
}

/** ai_audio - 提交 AI 生音频 + 轮询 + 落 Asset + 返回 storageKey */
export function aiAudio(ctx: ToolContext): Tool {
  return {
    name: 'ai_audio',
    description:
      'AI 生成音频(同步,等待完成)。返回 { storageKey, assetId, duration, generationId }。会自动写入 Asset 表',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '要朗读的文本' },
        model: { type: 'string', description: '模型名,例如 speech-2.8-hd(必填)' },
        providerId: { type: 'string', description: '指定渠道 ID(可选)' },
        voiceId: { type: 'string', description: '音色 ID(可选)' },
        voiceSpeed: { type: 'number', description: '语速 0.5-2.0(可选)' },
        audioFormat: { type: 'string', description: 'mp3/wav/pcm(可选,默认 mp3)' },
      },
      required: ['prompt', 'model'],
    },
    execute: async (args: {
      prompt: string;
      model: string;
      providerId?: string;
      voiceId?: string;
      voiceSpeed?: number;
      audioFormat?: string;
    }) => {
      if (!ctx.aiGenerateService) {
        throw new Error('ai_audio 工具不可用:缺少 AiGenerateService 注入');
      }

      const params: Record<string, unknown> = {};
      if (args.voiceId) params.voice = args.voiceId;
      if (args.voiceSpeed) params.audioSpeed = args.voiceSpeed;
      if (args.audioFormat) params.audioFormat = args.audioFormat;

      const dto: GenerateRequestDto = {
        kind: 'audio',
        prompt: args.prompt,
        model: args.model,
        providerId: args.providerId,
        params,
        projectId: ctx.projectId,
        tags: ['storyboard_assistant'],
      };

      const submit = await ctx.aiGenerateService.generate(ctx.userId, dto);
      const generationId = (submit as any).generationId;
      if (!generationId) {
        throw new Error('ai_audio: 提交生成任务失败,未返回 generationId');
      }

      const result = await pollGenerationResult(ctx.prisma, generationId, {
        timeoutMs: 5 * 60 * 1000,
        intervalMs: 1500,
        userId: ctx.userId,
      });

      if (result.status === 'failed') {
        throw new Error(`ai_audio: 生成失败 - ${result.errorMessage ?? '未知错误'}`);
      }
      if (result.status === 'cancelled') {
        throw new Error('ai_audio: 任务被取消');
      }
      if (!result.storageKey) {
        throw new Error('ai_audio: 生成成功但未返回 storageKey');
      }

      return {
        success: true,
        generationId,
        storageKey: result.storageKey,
        assetId: result.assetId,
        duration: result.duration,
        message: '音频生成完成',
      };
    },
  };
}

/** list_existing_assets - 列出当前用户的素材 */
export function listExistingAssets(ctx: ToolContext): Tool {
  return {
    name: 'list_existing_assets',
    description: '列出当前用户已上传/AI 生成的素材,支持 kind 过滤与 keyword 模糊匹配',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: '过滤: image/video/audio/text(可选)' },
        keyword: { type: 'string', description: '文件名/标签模糊匹配(可选)' },
        limit: { type: 'number', description: '返回条数(默认 20,最大 100)' },
      },
    },
    execute: async (args: { kind?: string; keyword?: string; limit?: number }) => {
      if (!ctx.assetsService) {
        throw new Error('list_existing_assets 工具不可用:缺少 AssetsService 注入');
      }
      const list = await ctx.assetsService.list(ctx.userId, undefined, args.limit ?? 20, args.kind);
      const items = (list.items ?? []).map((a: any) => ({
        id: a.id,
        kind: a.kind,
        filename: a.filename,
        storageKey: a.storageKey,
        mimeType: a.mimeType,
        width: a.width,
        height: a.height,
        tags: a.tags,
      }));
      const keyword = args.keyword?.toLowerCase().trim();
      const filtered = keyword
        ? items.filter(
            (a: any) =>
              a.filename?.toLowerCase().includes(keyword) ||
              a.tags?.some((t: string) => t.toLowerCase().includes(keyword)),
          )
        : items;
      return {
        total: filtered.length,
        items: filtered,
        message: `找到 ${filtered.length} 个素材`,
      };
    },
  };
}

/**
 * 同步轮询 AiGeneration 记录直到终态或超时。
 * 复用 worker 落库的 Asset + Resource 表,无副作用。
 */
export async function pollGenerationResult(
  prisma: PrismaService,
  generationId: string,
  opts: PollOpts,
): Promise<PollResult> {
  const start = Date.now();
  while (Date.now() - start < opts.timeoutMs) {
    await new Promise((r) => setTimeout(r, opts.intervalMs));
    const gen = await prisma.aiGeneration.findUnique({
      where: { id: generationId },
    });
    if (!gen) {
      return { status: 'failed', errorMessage: 'AiGeneration 记录不存在' };
    }
    if (gen.status === 'success') {
      let storageKey: string | undefined;
      let width: number | undefined;
      let height: number | undefined;
      let duration: number | undefined;
      if (gen.resultAssetId) {
        const asset = await prisma.asset.findUnique({
          where: { id: gen.resultAssetId },
        });
        if (asset) {
          storageKey = asset.storageKey;
          width = asset.width ?? undefined;
          height = asset.height ?? undefined;
          duration = asset.duration ?? undefined;
        }
      }
      return {
        status: 'success',
        storageKey,
        assetId: gen.resultAssetId ?? undefined,
        width,
        height,
        duration,
      };
    }
    if (gen.status === 'failed') {
      return { status: 'failed', errorMessage: gen.errorMessage ?? '生成失败' };
    }
    if (gen.status === 'cancelled') {
      return { status: 'cancelled' };
    }
  }
  return { status: 'timeout', errorMessage: `轮询超时(>${opts.timeoutMs}ms)` };
}
