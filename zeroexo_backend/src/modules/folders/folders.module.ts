import { Module } from '@nestjs/common';
import { FoldersController } from './folders.controller';
import { FoldersService } from './folders.service';
import { LogsModule } from '../logs/logs.module';

/**
 * 文件夹模块 - 提供树形文件夹 CRUD 与系统根目录懒加载。
 * 导出 FoldersService 供 AssetsModule / PromptsModule / SubjectsModule 引用。
 */
@Module({
  imports: [LogsModule],
  controllers: [FoldersController],
  providers: [FoldersService],
  exports: [FoldersService],
})
export class FoldersModule {}
