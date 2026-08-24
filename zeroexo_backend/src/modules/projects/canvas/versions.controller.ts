import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { VersionsService } from './versions.service';

/** 创建版本快照 DTO */
export class CreateVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string;

  /** 内容去重:与最近一条快照内容相同则跳过(自动冲突快照防冗余) */
  @IsOptional()
  @IsBoolean()
  skipIfIdentical?: boolean;

  /** 快照来源标识(manual / local-stale / 等,用于追溯快照产生场景) */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  source?: string;

  /** 自定义快照内容(离线端旧图留档);不传则基于服务端 DB 当前 scene */
  @IsOptional()
  data?: {
    scene?: unknown;
    connections?: unknown;
    viewport?: unknown;
  };
}

/** 回退 DTO */
export class RollbackDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class VersionsController {
  constructor(private readonly versionsService: VersionsService) {}

  @Post(':id/versions')
  @ApiOperation({ summary: '创建版本快照(用户主动保存)' })
  createVersion(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateVersionDto,
  ) {
    return this.versionsService.createVersion(userId, id, {
      label: dto.label,
      skipIfIdentical: dto.skipIfIdentical,
      source: dto.source,
      data: dto.data,
    });
  }

  @Get(':id/versions')
  @ApiOperation({ summary: '版本列表(按 version 降序)' })
  listVersions(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.versionsService.listVersions(userId, id);
  }

  @Get(':id/versions/:version')
  @ApiOperation({ summary: '获取指定版本的完整画布数据' })
  getVersion(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.versionsService.getVersion(userId, id, version);
  }

  @Delete(':id/versions/:version')
  @ApiOperation({ summary: '删除指定版本快照' })
  async deleteVersion(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Param('version', ParseIntPipe) version: number,
  ) {
    await this.versionsService.deleteVersion(userId, id, version);
    return { message: '版本快照已删除' };
  }

  @Post(':id/versions/cleanup')
  @ApiOperation({ summary: '手动触发版本淘汰清理' })
  async runCleanup(@CurrentUser('id') userId: string, @Param('id') id: string) {
    const removed = await this.versionsService.runCleanup(userId, id);
    return { removed };
  }

  @Post(':id/rollback')
  @ApiOperation({ summary: '回退到指定版本(返回新版本号和资源缺失警告)' })
  rollback(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body('version') version: number,
    @Body() _dto: RollbackDto,
  ) {
    return this.versionsService.rollback(userId, id, Number(version));
  }
}
