import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * 用量查询参数 DTO
 *
 * 用于 GET /admin/api-providers/usage 列表查询与 GET /admin/api-providers/usage/:id 详情查询。
 * 所有字段可选,缺失时使用默认窗口(过去 7 天 / 全部 metric / hour 粒度)。
 */
export class UsageQueryDto {
  @ApiPropertyOptional({ description: '按 providerId 过滤' })
  @IsOptional()
  @IsString()
  providerId?: string;

  @ApiPropertyOptional({
    description: '用量指标,例如 token / request / byte / email_sent',
  })
  @IsOptional()
  @IsString()
  metric?: string;

  @ApiPropertyOptional({
    description: '时间窗口: hour | day | month',
    enum: ['hour', 'day', 'month'],
  })
  @IsOptional()
  @IsIn(['hour', 'day', 'month'])
  window?: 'hour' | 'day' | 'month';

  @ApiPropertyOptional({ description: '起始时间(ISO 字符串或 Date)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startDate?: Date;

  @ApiPropertyOptional({ description: '截止时间(ISO 字符串或 Date)' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;
}

/**
 * 额度状态 DTO
 *
 * 描述单个 provider 当日 / 当月用量与上限对比,以及整体告警等级。
 */
export class QuotaStatusDto {
  @ApiProperty({ description: 'provider id' })
  @IsString()
  providerId!: string;

  @ApiProperty({
    description: '日用量状态',
    example: { used: 100, limit: 1000, percent: 10 },
  })
  daily!: {
    used: number;
    limit: number | null;
    percent: number;
  };

  @ApiProperty({
    description: '月用量状态',
    example: { used: 1500, limit: 30000, percent: 5 },
  })
  monthly!: {
    used: number;
    limit: number | null;
    percent: number;
  };

  @ApiProperty({
    description: '告警等级: ok | warning | critical',
    enum: ['ok', 'warning', 'critical'],
  })
  level!: 'ok' | 'warning' | 'critical';

  @ApiPropertyOptional({ description: '最近一次告警时间' })
  lastAlertAt?: string | null;
}

/**
 * 用量统计 DTO
 *
 * 统计窗口内的总数 / 均值 / 峰值,以及简单趋势方向(上升 / 下降 / 平稳)。
 */
export class UsageStatsDto {
  @ApiProperty({ description: '统计窗口' })
  period!: string;

  @ApiProperty({ description: 'provider id' })
  providerId!: string;

  @ApiProperty({ description: '统计指标' })
  metric!: string;

  @ApiProperty({ description: '总量' })
  total!: number;

  @ApiProperty({ description: '每个窗口的均值' })
  average!: number;

  @ApiProperty({ description: '单窗口峰值' })
  peak!: number;

  @ApiProperty({
    description: '趋势: up | down | flat(对比前半段与后半段)',
    enum: ['up', 'down', 'flat'],
  })
  trend!: 'up' | 'down' | 'flat';

  @ApiProperty({ description: '窗口序列(最近 N 个窗口)' })
  series!: Array<{ windowStart: string; value: number }>;
}

/**
 * 重置用量计数 DTO(敏感操作)
 *
 * 重置指定 provider 在某个时间窗口下的用量计数。仅超级管理员可调用。
 */
export class ResetUsageDto {
  @ApiProperty({
    description: '要重置的窗口: day | month',
    enum: ['day', 'month'],
  })
  @IsIn(['day', 'month'])
  @IsString()
  window!: 'day' | 'month';

  @ApiPropertyOptional({ description: '备注,会写入审计日志' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  reason?: string;
}

/**
 * 单条用量记录 DTO(列表/详情返回)
 */
export class UsageRecordDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  providerId!: string;

  @ApiProperty()
  metric!: string;

  @ApiProperty({ description: 'BigInt 序列化为字符串' })
  value!: string;

  @ApiProperty({ enum: ['hour', 'day', 'month'] })
  window!: string;

  @ApiProperty()
  windowStart!: string;

  @ApiProperty()
  createdAt!: string;
}
