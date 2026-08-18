import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PromptImagesService } from './prompt-images.service';
import { AddPromptImageDto, SetPromptImagesDto } from './dto/prompt-image.dto';

@ApiTags('PromptImages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('prompts/:promptId/images')
export class PromptImagesController {
  constructor(private readonly promptImagesService: PromptImagesService) {}

  @Get()
  @ApiOperation({ summary: '列出提示词的所有参考图' })
  list(@CurrentUser('id') userId: string, @Param('promptId') promptId: string) {
    return this.promptImagesService.list(userId, promptId);
  }

  @Post()
  @ApiOperation({ summary: '添加一张参考图' })
  add(
    @CurrentUser('id') userId: string,
    @Param('promptId') promptId: string,
    @Body() dto: AddPromptImageDto,
  ) {
    return this.promptImagesService.add(userId, promptId, dto);
  }

  @Post('set')
  @ApiOperation({ summary: '覆盖式设置所有参考图(用于整体替换)' })
  setAll(
    @CurrentUser('id') userId: string,
    @Param('promptId') promptId: string,
    @Body() dto: SetPromptImagesDto,
  ) {
    return this.promptImagesService.setAll(userId, promptId, dto);
  }

  @Delete(':imageId')
  @ApiOperation({ summary: '删除一张参考图' })
  remove(
    @CurrentUser('id') userId: string,
    @Param('promptId') promptId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.promptImagesService.remove(userId, promptId, imageId);
  }
}
