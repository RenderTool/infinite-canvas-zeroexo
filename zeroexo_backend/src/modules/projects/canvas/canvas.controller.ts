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
import { CanvasService } from './canvas.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/canvas.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';

@ApiTags('Projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class CanvasController {
  constructor(private readonly canvasService: CanvasService) {}

  @Get()
  @ApiOperation({ summary: '分页查询项目列表(游标分页)' })
  list(
    @CurrentUser('id') userId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.canvasService.list(
      userId,
      cursor,
      limit ? Number(limit) : undefined,
      keyword,
    );
  }

  @Post()
  @ApiOperation({ summary: '创建项目' })
  create(@CurrentUser('id') userId: string, @Body() dto: CreateProjectDto) {
    return this.canvasService.create(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取项目详情' })
  findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.canvasService.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新项目' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.canvasService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除项目' })
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.canvasService.remove(userId, id);
  }

  @Get(':id/graph')
  @ApiOperation({ summary: '分页获取画布 graph 节点(offset/limit 分页)' })
  getGraph(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.canvasService.getGraphPaginated(
      userId,
      id,
      offset ? Number(offset) : 0,
      limit ? Number(limit) : 50,
    );
  }
}
