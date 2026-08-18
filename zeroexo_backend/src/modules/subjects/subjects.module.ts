import { Module } from '@nestjs/common';
import { SubjectsController } from './subjects.controller';
import { SubjectsService } from './subjects.service';
import { LogsModule } from '../logs/logs.module';

/**
 * 主体模块 - 角色/场景/道具 的 CRUD,可被画布、创作等模块引用
 */
@Module({
  imports: [LogsModule],
  controllers: [SubjectsController],
  providers: [SubjectsService],
  exports: [SubjectsService],
})
export class SubjectsModule {}
