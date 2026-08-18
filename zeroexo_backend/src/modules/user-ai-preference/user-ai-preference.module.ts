import { Module } from '@nestjs/common';
import { UserAiPreferenceController } from './user-ai-preference.controller';
import { UserAiPreferenceService } from './user-ai-preference.service';

/**
 * 用户级 AI 配置模块
 * 提供当前用户对默认模型、并发数、能力默认值的读写能力
 */
@Module({
  controllers: [UserAiPreferenceController],
  providers: [UserAiPreferenceService],
  exports: [UserAiPreferenceService],
})
export class UserAiPreferenceModule {}
