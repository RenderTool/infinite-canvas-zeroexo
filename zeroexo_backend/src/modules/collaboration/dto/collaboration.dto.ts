import { IsString, IsEnum, IsOptional, IsBoolean, IsInt, IsArray, IsObject } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  canvasId!: string;

  @IsOptional()
  @IsEnum(['invite-only', 'public', 'auto-self'])
  mode?: 'invite-only' | 'public' | 'auto-self';

  @IsOptional()
  @IsInt()
  maxMembers?: number;

  @IsOptional()
  @IsBoolean()
  allowChat?: boolean;

  @IsOptional()
  @IsBoolean()
  allowAgentChat?: boolean;

  @IsOptional()
  @IsBoolean()
  allowEdit?: boolean;

  @IsOptional()
  @IsBoolean()
  allowDownload?: boolean;

  @IsOptional()
  @IsInt()
  expiresInHours?: number;
}

export class UpdateRoomDto {
  @IsOptional()
  @IsEnum(['invite-only', 'public', 'auto-self'])
  mode?: 'invite-only' | 'public' | 'auto-self';

  @IsOptional()
  @IsInt()
  maxMembers?: number;

  @IsOptional()
  @IsBoolean()
  allowChat?: boolean;

  @IsOptional()
  @IsBoolean()
  allowAgentChat?: boolean;

  @IsOptional()
  @IsBoolean()
  allowEdit?: boolean;

  @IsOptional()
  @IsBoolean()
  allowDownload?: boolean;

  @IsOptional()
  @IsInt()
  expiresInHours?: number;
}

export class JoinRoomDto {
  @IsString()
  inviteCode!: string;

  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsEnum(['desktop', 'tablet', 'mobile'])
  deviceType?: 'desktop' | 'tablet' | 'mobile';
}

export class AutoJoinRoomDto {
  @IsOptional()
  @IsEnum(['desktop', 'tablet', 'mobile'])
  deviceType?: 'desktop' | 'tablet' | 'mobile';
}

export class UpdateMemberDto {
  @IsOptional()
  @IsEnum(['owner', 'editor', 'viewer'])
  role?: 'owner' | 'editor' | 'viewer';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

export class SendMessageDto {
  @IsString()
  content!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentions?: string[];

  @IsOptional()
  @IsBoolean()
  agentMentioned?: boolean;

  @IsOptional()
  @IsString()
  replyToId?: string;
}

/** 执行协作 Agent 请求 */
export class AgentExecuteDto {
  @IsString()
  content!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentions?: string[];

  @IsOptional()
  @IsString()
  replyToId?: string;
}

/** 更新 Agent 共享记忆请求 */
export class UpdateMemoryDto {
  @IsObject()
  memory!: Record<string, unknown>;
}
