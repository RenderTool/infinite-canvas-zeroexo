import { Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

/**
 * 审计日志模块
 * - 写入敏感操作日志到数据库
 * - 提供查询接口
 */
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
