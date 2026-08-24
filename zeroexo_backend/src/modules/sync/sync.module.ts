import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { AssetsModule } from '../assets/assets.module';

/**
 * SyncModule - Yjs 实时同步服务
 *
 * 通过 Hocuspocus 将 HTTP server 升级为 WebSocket 端点，为创作项目各模块
 * （剧本/分镜/出片）提供多浏览器实时同步 + JSON 快照持久化。
 * docName 约定：`{namespace}:{artifactId}`，namespace ∈ script/storyboard/generations/canvas。
 * （Plan#40 Phase1：canvas 也走 Yjs 落库闭环，refCount 复用 AssetsModule 的 ResourceService）
 */
@Module({
  imports: [AssetsModule],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
