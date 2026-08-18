import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { AssetsAdminController } from './assets.admin.controller';
import { MinioService } from './minio.service';
import { ResourceService } from './resource.service';
import { ResourceGcService } from './resource-gc.service';
import { ImageProcessorService } from './image-processor.service';
import { StorageController } from './storage.controller';
import { LogsModule } from '../logs/logs.module';

/**
 * 资产模块 - 提供资产元数据 CRUD、内容寻址存储(CAS)与本地文件存储上传/下载能力。
 *
 * ResourceService: CAS 去重 + 引用计数 + 软删除,被 AssetsService 和 ProjectsService 共用。
 * ResourceGcService: 定时 GC,清理软删除超过宽限期的孤儿资源。
 *
 * MinioService 导出以供 ai-generate 模块直接落 AI 生成产物。
 * ResourceService 导出以供 ProjectsModule 引用计数管理。
 */
@Module({
  imports: [LogsModule, JwtModule.register({})],
  providers: [AssetsService, MinioService, ResourceService, ResourceGcService, ImageProcessorService],
  controllers: [AssetsController, AssetsAdminController, StorageController],
  exports: [AssetsService, MinioService, ResourceService, ResourceGcService],
})
export class AssetsModule {}
