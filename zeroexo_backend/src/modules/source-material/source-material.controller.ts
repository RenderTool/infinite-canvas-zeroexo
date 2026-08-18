import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SourceMaterialService } from './source-material.service';
import {
  CreateSourceMaterialDto,
  QuerySourceMaterialDto,
  UpdateSourceMaterialStatusDto,
} from './dto/source-material.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Source Material')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/source-material')
export class SourceMaterialController {
  constructor(private readonly sourceMaterialService: SourceMaterialService) {}

  @Post()
  @ApiOperation({ summary: '创建源素材记录' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateSourceMaterialDto) {
    // 使用请求中的 userId 覆盖 DTO 中的 userId,确保安全
    return this.sourceMaterialService.create({ ...dto, userId });
  }

  @Get()
  @ApiOperation({ summary: '按项目查询源素材列表' })
  findByProject(@Query() query: QuerySourceMaterialDto) {
    return this.sourceMaterialService.findByProject(query.projectId);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除源素材记录' })
  async delete(@Param('id') id: string) {
    await this.sourceMaterialService.delete(id);
    return { message: '源素材记录已删除' };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '更新源素材处理状态' })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateSourceMaterialStatusDto,
  ) {
    return this.sourceMaterialService.updateStatus(id, dto);
  }
}