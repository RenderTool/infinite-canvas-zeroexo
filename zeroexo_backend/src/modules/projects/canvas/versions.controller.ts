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
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { VersionsService } from './versions.service';

/** 创建版本快照 DTO */
export class CreateVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string;
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
    return this.versionsService.createVersion(userId, id, { label: dto.label });
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
