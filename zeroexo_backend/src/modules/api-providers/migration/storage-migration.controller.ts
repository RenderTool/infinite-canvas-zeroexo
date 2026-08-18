import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import {
  StorageMigrationService,
  CreateMigrationDto,
} from './storage-migration.service';

/**
 * 存储迁移管理后台控制器 - Stage F
 *
 * 端点(全部需 Admin 权限):
 *   GET    /api/admin/storage-migration/jobs            列出任务
 *   POST   /api/admin/storage-migration/jobs            创建任务
 *   GET    /api/admin/storage-migration/jobs/:id        获取状态
 *   POST   /api/admin/storage-migration/jobs/:id/start  启动/恢复
 *   POST   /api/admin/storage-migration/jobs/:id/pause  暂停
 *   POST   /api/admin/storage-migration/jobs/:id/cancel 取消
 *   POST   /api/admin/storage-migration/jobs/:id/verify 字节级校验
 *   GET    /api/admin/storage-migration/jobs/:id/progress-stream  SSE 进度推送
 */
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiTags('AdminStorageMigration')
@Controller('admin/storage-migration')
export class StorageMigrationController {
  constructor(private readonly service: StorageMigrationService) {}

  @Get('jobs')
  @ApiOperation({ summary: '[Admin] 列出所有迁移任务' })
  list(@Query('status') status?: string) {
    return this.service.listJobs({ status });
  }

  @Post('jobs')
  @ApiOperation({ summary: '[Admin] 创建迁移任务' })
  create(@Body() dto: Omit<CreateMigrationDto, 'createdBy'>, @CurrentUser() user: AuthUser) {
    return this.service.createJob({ ...dto, createdBy: user.id });
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: '[Admin] 获取任务状态' })
  getStatus(@Param('id') id: string) {
    return this.service.getJobStatus(id);
  }

  @Post('jobs/:id/start')
  @ApiOperation({ summary: '[Admin] 启动/恢复任务' })
  start(@Param('id') id: string) {
    return this.service.startJob(id);
  }

  @Post('jobs/:id/pause')
  @ApiOperation({ summary: '[Admin] 暂停任务' })
  pause(@Param('id') id: string) {
    return this.service.pauseJob(id);
  }

  @Post('jobs/:id/cancel')
  @ApiOperation({ summary: '[Admin] 取消任务' })
  cancel(@Param('id') id: string) {
    return this.service.cancelJob(id);
  }

  @Post('jobs/:id/verify')
  @ApiOperation({ summary: '[Admin] 校验迁移结果' })
  verify(
    @Param('id') id: string,
    @Body() body: { mode?: 'sample' | 'full' },
  ) {
    return this.service.verifyJob(id, body?.mode || 'sample');
  }

  /**
   * SSE 进度推送
   * - 订阅 service 的 eventBus 事件,过滤出指定 jobId 的进度
   * - 连接建立时立即推送一次当前状态
   */
  @Sse('jobs/:id/progress-stream')
  progressStream(@Param('id') id: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const handler = (progress: { jobId: string }) => {
        if (progress.jobId === id) {
          subscriber.next({ data: progress } as MessageEvent);
        }
      };
      const unsubscribe = this.service.onProgress(handler);
      // 立即推送一次当前状态
      this.service
        .getJobStatus(id)
        .then((status) => {
          subscriber.next({ data: status } as MessageEvent);
        })
        .catch(() => {
          // 任务不存在时静默忽略
        });
      return () => {
        unsubscribe();
      };
    });
  }
}
