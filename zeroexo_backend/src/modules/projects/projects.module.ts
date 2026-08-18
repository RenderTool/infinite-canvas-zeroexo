import { Module } from '@nestjs/common';
import { CanvasModule } from './canvas/canvas.module';

@Module({
  imports: [CanvasModule],
})
export class ProjectsModule {}
