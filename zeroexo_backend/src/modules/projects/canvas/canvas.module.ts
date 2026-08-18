import { Module } from '@nestjs/common';
import { CanvasService } from './canvas.service';
import { CanvasController } from './canvas.controller';
import { CanvasAdminController } from './canvas.admin.controller';
import { VersionsService } from './versions.service';
import { VersionsController } from './versions.controller';
import { LogsModule } from '../../logs/logs.module';
import { AssetsModule } from '../../assets/assets.module';

@Module({
  imports: [LogsModule, AssetsModule],
  providers: [CanvasService, VersionsService],
  controllers: [CanvasController, CanvasAdminController, VersionsController],
})
export class CanvasModule {}
