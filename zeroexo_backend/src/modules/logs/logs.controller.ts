/**
 * LogsController - 日志查询 API
 *
 * 路由(受全局 /api 前缀影响):
 * - GET    /api/admin/logs → 查询日志(支持 category/level/keyword/username/startTime/endTime/offset/limit)
 * - DELETE /api/admin/logs → 清空所有日志
 * - POST   /api/admin/logs/cleanup → 清理超过指定天数的日志文件
 * - GET    /api/admin/logs/files → 获取日志文件列表
 */

import {
  Controller,
  Get,
  Delete,
  Post,
  Query,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { LogsService } from './logs.service';
import type { LogCategory, LogLevel } from './logs.service';

@Controller('admin/logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  /**
   * 查询日志(支持过滤 + 分页)
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async queryLogs(
    @Query('category') category?: string,
    @Query('level') level?: string,
    @Query('keyword') keyword?: string,
    @Query('username') username?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    const { entries, total } = this.logsService.query({
      category: category as LogCategory | undefined,
      level: level as LogLevel | undefined,
      keyword: keyword || undefined,
      username: username || undefined,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
    const stats = this.logsService.stats();
    return { entries, total, stats };
  }

  /**
   * 清空所有日志
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  async clearLogs() {
    this.logsService.clear();
    return { message: '日志已清空' };
  }

  /**
   * 清理超过指定天数的日志文件
   */
  @Post('cleanup')
  @HttpCode(HttpStatus.OK)
  async cleanupLogFiles(@Body('daysToKeep') daysToKeep?: number) {
    const days = daysToKeep ?? 30;
    const result = this.logsService.cleanupLogFiles(days);
    const deletedSize =
      result.deletedSize < 1024
        ? `${result.deletedSize} B`
        : result.deletedSize < 1024 * 1024
          ? `${(result.deletedSize / 1024).toFixed(2)} KB`
          : `${(result.deletedSize / 1024 / 1024).toFixed(2)} MB`;
    return { deletedFiles: result.deletedFiles, deletedSize };
  }

  /**
   * 获取日志文件列表
   */
  @Get('files')
  @HttpCode(HttpStatus.OK)
  async getLogFiles() {
    const stats = this.logsService.getLogFileStats();
    const files = stats.map((f) => ({
      name: f.name,
      size:
        f.size < 1024
          ? `${f.size} B`
          : f.size < 1024 * 1024
            ? `${(f.size / 1024).toFixed(2)} KB`
            : `${(f.size / 1024 / 1024).toFixed(2)} MB`,
      date: f.date,
    }));
    return { files };
  }
}
