import { Module } from '@nestjs/common';
import { StudioController } from './studio.controller';
import { StudioService } from './studio.service';

/**
 * 工业化制片项目模块（Plan#46）：
 * 资源浏览器（资产：角色/场景/道具）+ 出片（剧集拆分/过审/提示词/成片登记）的后端数据与 CRUD。
 */
@Module({
  controllers: [StudioController],
  providers: [StudioService],
})
export class StudioModule {}
