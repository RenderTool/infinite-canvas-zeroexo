import { Injectable, Logger } from '@nestjs/common';
import { ResourceService } from './resource.service';

/**
 * 资源 GC 服务 - 清理软删除超过宽限期的孤儿资源(物理文件 + DB 记录)。
 * 定时触发由 GcScheduleService 管理(settings 模块),不再使用 @Cron 装饰器。
 */
@Injectable()
export class ResourceGcService {
  private readonly logger = new Logger(ResourceGcService.name);

  constructor(private readonly resourceService: ResourceService) {}

  /** 执行资源 GC,返回清理的孤儿资源数量 */
  async runGarbageCollection(): Promise<number> {
    this.logger.log('资源 GC 任务启动...');
    try {
      const count = await this.resourceService.garbageCollect();
      this.logger.log(`资源 GC 任务完成,清理了 ${count} 个孤儿资源`);
      return count;
    } catch (err) {
      this.logger.error(
        `资源 GC 任务失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }
}
