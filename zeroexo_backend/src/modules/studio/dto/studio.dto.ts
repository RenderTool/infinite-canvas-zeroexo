/**
 * Studio 模块 DTO（工业化制片项目，Plan#46）
 *
 * 资产卡三类：character 角色 / scene 场景 / prop 道具
 * 资产状态机：draft → generating → pending_review → locked（locked=主图锁定，一致性基准）
 * 剧集状态机：draft → split_pending_review → split_reviewed → storyboard_ready → done
 */
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export const STUDIO_ASSET_KINDS = ['character', 'scene', 'prop'] as const;
export type StudioAssetKind = (typeof STUDIO_ASSET_KINDS)[number];

export const STUDIO_ASSET_STATUSES = [
  'draft',
  'generating',
  'pending_review',
  'locked',
] as const;
export type StudioAssetStatus = (typeof STUDIO_ASSET_STATUSES)[number];

export const STUDIO_EPISODE_STATUSES = [
  'draft',
  'split_pending_review',
  'split_reviewed',
  'storyboard_ready',
  'done',
] as const;
export type StudioEpisodeStatus = (typeof STUDIO_EPISODE_STATUSES)[number];

/** 参考素材项：多图、有序、分用途（图生图多输入） */
export interface StudioReferenceImage {
  url: string;
  /** character=角色参考 | style=风格参考 | composition=构图参考 */
  purpose?: 'character' | 'style' | 'composition';
  name?: string;
}

export class CreateStudioProjectDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateStudioProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class CreateStudioAssetDto {
  @IsIn(STUDIO_ASSET_KINDS as unknown as string[])
  kind!: StudioAssetKind;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

export class UpdateStudioAssetDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsIn(STUDIO_ASSET_STATUSES as unknown as string[])
  status?: StudioAssetStatus;

  @IsOptional()
  @IsString()
  mainImageUrl?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class CreateStudioPromptEntryDto {
  @IsString()
  @MaxLength(20000)
  promptText!: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  referenceImages?: StudioReferenceImage[];
}

export class UpdateStudioPromptEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  promptText?: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  referenceImages?: StudioReferenceImage[];
}

export class RegisterStudioImageDto {
  @IsString()
  url!: string;

  @IsOptional()
  @IsString()
  promptEntryId?: string;
}

export class CreateStudioEpisodeDto {
  /** 缺省时自动取当前项目最大集数 +1 */
  @IsOptional()
  @IsInt()
  @Min(1)
  episodeNumber?: number;

  @IsString()
  @MaxLength(200)
  title!: string;

  /** 原始剧本行号范围（如 L5-49） */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceRange?: string;
}

export class UpdateStudioEpisodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceRange?: string;

  @IsOptional()
  @IsIn(STUDIO_EPISODE_STATUSES as unknown as string[])
  status?: StudioEpisodeStatus;

  /** 拆分稿内容（原文逐字+片段切分；状态须配合 split_pending_review / split_reviewed） */
  @IsOptional()
  @IsObject()
  splitDraft?: Record<string, unknown>;
}
