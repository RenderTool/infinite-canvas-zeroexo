/**
 * agent-skill - Agent 技能文件与升级提案服务
 *
 * Plan#33 D6 Agent 自我升级:
 * - 技能文件读写(仅白名单文件,防路径穿越)
 * - 升级提案 CRUD(Agent 提案 -> 管理员审批 -> 写盘生效)
 *
 * 文件根目录与 agent-factory 保持一致(__dirname/skills,编译后为 dist/modules/agent/skills)。
 */

import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../common/prisma/prisma.service';

/** 允许读写/提案编辑的技能文件名白名单 */
export const EDITABLE_SKILL_FILES = ['SKILL.md', 'SYSTEM_PROMPT.md'] as const;

/** 提案状态 */
export const PROPOSAL_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;

export interface SkillFileInfo {
  skillKey: string;
  fileName: string;
  /** 字节大小(用于前端判断文件是否为空) */
  size: number;
}

@Injectable()
export class AgentSkillService {
  private readonly logger = new Logger(AgentSkillService.name);
  private readonly skillsRoot = path.join(__dirname, 'skills');

  constructor(private readonly prisma: PrismaService) {}

  /** 校验 skillKey/fileName 并解析为安全绝对路径(禁止路径穿越) */
  private resolveSkillPath(skillKey: string, fileName: string): string {
    if (!skillKey || !/^[a-zA-Z0-9_-]+$/.test(skillKey)) {
      throw new BadRequestException('非法技能名称');
    }
    if (!EDITABLE_SKILL_FILES.includes(fileName as (typeof EDITABLE_SKILL_FILES)[number])) {
      throw new BadRequestException('该文件不允许编辑');
    }
    const filePath = path.join(this.skillsRoot, skillKey, fileName);
    if (!filePath.startsWith(this.skillsRoot + path.sep)) {
      throw new BadRequestException('非法路径');
    }
    return filePath;
  }

  /** 列出技能目录树(目录 + 白名单文件及大小) */
  listSkills(): { skillKey: string; files: SkillFileInfo[] }[] {
    if (!fs.existsSync(this.skillsRoot)) return [];
    const entries = fs
      .readdirSync(this.skillsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'));
    return entries.map((dir) => {
      const dirPath = path.join(this.skillsRoot, dir.name);
      const files: SkillFileInfo[] = EDITABLE_SKILL_FILES.filter((f) =>
        fs.existsSync(path.join(dirPath, f)),
      ).map((f) => {
        const stats = fs.statSync(path.join(dirPath, f));
        return { skillKey: dir.name, fileName: f, size: stats.size };
      });
      return { skillKey: dir.name, files };
    });
  }

  /** 读取技能文件内容 */
  readSkill(skillKey: string, fileName: string): { skillKey: string; fileName: string; content: string } {
    const filePath = this.resolveSkillPath(skillKey, fileName);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`技能文件不存在: ${skillKey}/${fileName}`);
    }
    return { skillKey, fileName, content: fs.readFileSync(filePath, 'utf-8') };
  }

  /** 直接写盘(仅管理员调用,由调用方保证权限) */
  writeSkill(skillKey: string, fileName: string, content: string): { success: boolean; skillKey: string; fileName: string } {
    const filePath = this.resolveSkillPath(skillKey, fileName);
    const dirPath = path.dirname(filePath);
    if (!fs.existsSync(dirPath)) {
      throw new NotFoundException(`技能目录不存在: ${skillKey}`);
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    this.logger.log(`技能文件已写盘: ${skillKey}/${fileName} (${content.length} chars)`);
    return { success: true, skillKey, fileName };
  }

  /** 创建升级提案(不写盘,等待管理员审批) */
  async createProposal(
    userId: string,
    dto: { skillKey: string; fileName: string; content: string; reason?: string },
  ) {
    const { skillKey, fileName, content, reason } = dto;
    this.resolveSkillPath(skillKey, fileName); // 白名单/路径校验
    if (!content || !content.trim()) {
      throw new BadRequestException('提案内容不能为空');
    }
    // 合并 pending 提案(同技能同文件未审批则追加更新,避免提案堆积)
    const existing = await this.prisma.agentSkillProposal.findFirst({
      where: { skillKey, fileName, status: PROPOSAL_STATUS.PENDING },
    });
    if (existing) {
      const updated = await this.prisma.agentSkillProposal.update({
        where: { id: existing.id },
        data: { content, reason: reason ?? existing.reason },
      });
      return { proposal: updated, merged: true };
    }
    const proposal = await this.prisma.agentSkillProposal.create({
      data: {
        skillKey,
        fileName,
        reason: reason ?? null,
        content,
        status: PROPOSAL_STATUS.PENDING,
        createdById: userId,
      },
    });
    return { proposal, merged: false };
  }

  /** 提案列表(可按状态过滤) */
  listProposals(status?: string) {
    return this.prisma.agentSkillProposal.findMany({
      where: status && status !== 'all' ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 批准提案: 写盘 + 状态置 approved */
  async approveProposal(proposalId: string, reviewerId: string) {
    const proposal = await this.prisma.agentSkillProposal.findUnique({
      where: { id: proposalId },
    });
    if (!proposal) throw new NotFoundException('提案不存在');
    if (proposal.status !== PROPOSAL_STATUS.PENDING) {
      throw new ConflictException(`提案已${proposal.status === PROPOSAL_STATUS.APPROVED ? '批准' : '拒绝'},不可重复操作`);
    }
    this.writeSkill(proposal.skillKey, proposal.fileName, proposal.content);
    return this.prisma.agentSkillProposal.update({
      where: { id: proposalId },
      data: { status: PROPOSAL_STATUS.APPROVED, reviewedById: reviewerId, reviewedAt: new Date() },
    });
  }

  /** 拒绝提案: 仅状态更新,不写盘 */
  async rejectProposal(proposalId: string, reviewerId: string) {
    const proposal = await this.prisma.agentSkillProposal.findUnique({
      where: { id: proposalId },
    });
    if (!proposal) throw new NotFoundException('提案不存在');
    if (proposal.status !== PROPOSAL_STATUS.PENDING) {
      throw new ConflictException('提案已处理,不可重复操作');
    }
    return this.prisma.agentSkillProposal.update({
      where: { id: proposalId },
      data: { status: PROPOSAL_STATUS.REJECTED, reviewedById: reviewerId, reviewedAt: new Date() },
    });
  }
}
