import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  UseGuards, Req, ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CollaborationService } from './collaboration.service';
import { CollaborationMemberService } from './collaboration-member.service';
import { CollaborationAgentService } from './collaboration-agent.service';
import {
  CreateRoomDto, UpdateRoomDto, JoinRoomDto, AutoJoinRoomDto,
  UpdateMemberDto, SendMessageDto, AgentExecuteDto, UpdateMemoryDto,
} from './dto/collaboration.dto';
import type { Request } from 'express';

/** 鉴权后 request.user 类型 */
interface AuthedRequest extends Request {
  user: { id: string };
}

/**
 * 协作模块 REST 端点
 *
 * 房间管理:
 *   POST   /api/collaboration/rooms                创建协作房间
 *   GET    /api/collaboration/rooms/mine            列出当前用户的协作房间
 *   GET    /api/collaboration/rooms/:canvasId      获取画布的协作房间
 *   PATCH  /api/collaboration/rooms/:canvasId      更新房间设置
 *   DELETE /api/collaboration/rooms/:canvasId      关闭房间
 *
 * 邀请码:
 *   POST   /api/collaboration/rooms/:canvasId/invite       生成/重置邀请码
 *   GET    /api/collaboration/invite/:code                  验证邀请码
 *
 * 加入/离开:
 *   POST   /api/collaboration/rooms/:canvasId/join         通过邀请码加入
 *   POST   /api/collaboration/rooms/:canvasId/auto-join    同账户多设备自动加入
 *   POST   /api/collaboration/rooms/:canvasId/leave       离开房间
 *
 * 成员管理:
 *   GET    /api/collaboration/rooms/:canvasId/members       成员列表
 *   PATCH  /api/collaboration/rooms/:canvasId/members/:userId    更新成员权限
 *   DELETE /api/collaboration/rooms/:canvasId/members/:userId    踢出成员
 *   POST   /api/collaboration/rooms/:canvasId/members/:userId/ban     封禁
 *   POST   /api/collaboration/rooms/:canvasId/members/:userId/unban   解禁
 *   POST   /api/collaboration/rooms/:canvasId/members/:userId/mute    禁言
 *
 * 消息:
 *   GET    /api/collaboration/rooms/:canvasId/messages     聊天历史
 *   POST   /api/collaboration/rooms/:canvasId/messages     发送消息
 *   DELETE /api/collaboration/rooms/:canvasId/messages/:messageId   删除消息
 *
 * Agent 协作(共享记忆群聊):
 *   GET    /api/collaboration/rooms/:canvasId/agent/session        获取 Agent 会话与共享记忆
 *   GET    /api/collaboration/rooms/:canvasId/agent/messages       获取 Agent 会话消息历史
 *   POST   /api/collaboration/rooms/:canvasId/agent/execute        执行 Agent(协作模式)
 *   PATCH  /api/collaboration/rooms/:canvasId/agent/session/memory 更新共享记忆
 */
@Controller('collaboration')
@UseGuards(JwtAuthGuard)
export class CollaborationController {
  constructor(
    private readonly collaborationService: CollaborationService,
    private readonly memberService: CollaborationMemberService,
    private readonly agentService: CollaborationAgentService,
  ) {}

  // ==================== 房间管理 ====================

  @Post('rooms')
  async createRoom(@Req() req: AuthedRequest, @Body(ValidationPipe) dto: CreateRoomDto) {
    return this.collaborationService.createRoom(req.user.id, dto);
  }

  @Get('rooms/mine')
  async listMyRooms(@Req() req: AuthedRequest) {
    return this.collaborationService.listMyRooms(req.user.id);
  }

  @Get('rooms/:canvasId')
  async getRoom(@Req() req: AuthedRequest, @Param('canvasId') canvasId: string) {
    return this.collaborationService.getRoomByCanvas(req.user.id, canvasId);
  }

  @Patch('rooms/:canvasId')
  async updateRoom(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Body(ValidationPipe) dto: UpdateRoomDto,
  ) {
    return this.collaborationService.updateRoom(req.user.id, canvasId, dto);
  }

  @Delete('rooms/:canvasId')
  async closeRoom(@Req() req: AuthedRequest, @Param('canvasId') canvasId: string) {
    return this.collaborationService.closeRoom(req.user.id, canvasId);
  }

  // ==================== 邀请码 ====================

  @Post('rooms/:canvasId/invite')
  async regenerateInvite(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Body('expiresInHours') expiresInHours?: number,
  ) {
    return this.collaborationService.regenerateInvite(req.user.id, canvasId, expiresInHours);
  }

  @Get('invite/:code')
  async verifyInvite(@Param('code') code: string) {
    return this.collaborationService.verifyInvite(code);
  }

  // ==================== 加入/离开 ====================

  @Post('rooms/:canvasId/join')
  async joinRoom(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Body(ValidationPipe) dto: JoinRoomDto,
  ) {
    return this.collaborationService.joinByInvite(
      req.user.id, canvasId, dto.inviteCode, dto.nickname, dto.deviceType,
    );
  }

  @Post('rooms/:canvasId/auto-join')
  async autoJoin(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Body(ValidationPipe) dto: AutoJoinRoomDto,
  ) {
    return this.collaborationService.autoJoin(req.user.id, canvasId, dto.deviceType);
  }

  @Post('rooms/:canvasId/leave')
  async leaveRoom(@Req() req: AuthedRequest, @Param('canvasId') canvasId: string) {
    return this.collaborationService.leaveRoom(req.user.id, canvasId);
  }

  // ==================== 成员管理 ====================

  @Get('rooms/:canvasId/members')
  async listMembers(@Req() req: AuthedRequest, @Param('canvasId') canvasId: string) {
    return this.memberService.listMembers(canvasId, req.user.id);
  }

  @Patch('rooms/:canvasId/members/:userId')
  async updateMember(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Param('userId') memberUserId: string,
    @Body(ValidationPipe) dto: UpdateMemberDto,
  ) {
    return this.memberService.updateMember(canvasId, memberUserId, req.user.id, dto);
  }

  @Delete('rooms/:canvasId/members/:userId')
  async kickMember(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Param('userId') memberUserId: string,
  ) {
    return this.memberService.kickMember(canvasId, memberUserId, req.user.id);
  }

  @Post('rooms/:canvasId/members/:userId/ban')
  async banMember(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Param('userId') memberUserId: string,
  ) {
    return this.memberService.banMember(canvasId, memberUserId, req.user.id);
  }

  @Post('rooms/:canvasId/members/:userId/unban')
  async unbanMember(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Param('userId') memberUserId: string,
  ) {
    return this.memberService.unbanMember(canvasId, memberUserId, req.user.id);
  }

  @Post('rooms/:canvasId/members/:userId/mute')
  async muteMember(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Param('userId') memberUserId: string,
  ) {
    return this.memberService.muteMember(canvasId, memberUserId, req.user.id);
  }

  @Post('rooms/:canvasId/members/:userId/unmute')
  async unmuteMember(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Param('userId') memberUserId: string,
  ) {
    return this.memberService.unmuteMember(canvasId, memberUserId, req.user.id);
  }

  // ==================== 消息 ====================

  @Get('rooms/:canvasId/messages')
  async listMessages(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Query('limit') limit?: number,
    @Query('beforeId') beforeId?: string,
  ) {
    return this.memberService.listMessages(canvasId, req.user.id, limit, beforeId);
  }

  @Post('rooms/:canvasId/messages')
  async sendMessage(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Body(ValidationPipe) dto: SendMessageDto,
  ) {
    return this.memberService.sendMessage(canvasId, req.user.id, dto);
  }

  @Delete('rooms/:canvasId/messages/:messageId')
  async deleteMessage(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Param('messageId') messageId: string,
  ) {
    return this.memberService.deleteMessage(canvasId, messageId, req.user.id);
  }

  // ==================== Agent 协作(共享记忆群聊) ====================

  @Get('rooms/:canvasId/agent/session')
  async getAgentSession(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
  ) {
    return this.agentService.getSession(canvasId, req.user.id);
  }

  @Get('rooms/:canvasId/agent/messages')
  async listAgentMessages(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Query('limit') limit?: number,
  ) {
    return this.agentService.listMessages(canvasId, req.user.id, limit);
  }

  @Post('rooms/:canvasId/agent/execute')
  async executeAgent(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Body(ValidationPipe) dto: AgentExecuteDto,
  ) {
    return this.agentService.execute(canvasId, req.user.id, dto);
  }

  @Patch('rooms/:canvasId/agent/session/memory')
  async updateAgentMemory(
    @Req() req: AuthedRequest,
    @Param('canvasId') canvasId: string,
    @Body(ValidationPipe) dto: UpdateMemoryDto,
  ) {
    return this.agentService.updateMemory(canvasId, req.user.id, dto.memory);
  }
}
