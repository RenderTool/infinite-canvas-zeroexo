import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ErrorCode } from '../../common/errors/error-codes';
import { badRequest, notFound } from '../../common/errors/app-exception.js';
import { CreatePolicyVersionDto, UpdatePolicyVersionDto } from './dto/policy.dto';

@Injectable()
export class PoliciesService {
  constructor(private readonly prisma: PrismaService) {}

  /** 获取所有政策（含当前版本信息，公开接口只返回已发布的） */
  async list(admin = false, lang?: string) {
    const policies = await this.prisma.policy.findMany({
      orderBy: { createdAt: 'asc' },
    });

    // 批量加载每个政策的当前版本
    const result = [];
    for (const p of policies) {
      if (p.currentVersion != null) {
        const version = await this.prisma.policyVersion.findUnique({
          where: { policyKey_version: { policyKey: p.key, version: p.currentVersion } },
          select: { title: true, titleEn: true, titleJa: true, type: true, updatedAt: true },
        });
        if (version) {
          // 根据语言选择对应标题
          let title = version.title;
          if (lang === 'en' && version.titleEn) title = version.titleEn;
          else if (lang === 'ja' && version.titleJa) title = version.titleJa;
          result.push({
            key: p.key,
            title,
            type: version.type,
            updatedAt: version.updatedAt,
            currentVersion: p.currentVersion,
          });
          continue;
        }
      }
      // 无已发布版本
      if (!admin) continue; // 公开接口跳过无发布版本的政策
      result.push({
        key: p.key,
        title: '(未发布)',
        type: 'policy',
        updatedAt: p.updatedAt,
        currentVersion: null,
      });
    }
    return result;
  }

  /** 管理员获取版本列表 */
  async listVersions(key: string) {
    const policy = await this.prisma.policy.findUnique({ where: { key } });
    if (!policy) throw notFound(ErrorCode.POLICY_NOT_FOUND, 'Policy not found');

    const versions = await this.prisma.policyVersion.findMany({
      where: { policyKey: key },
      orderBy: { version: 'desc' },
      select: {
        version: true,
        title: true,
        type: true,
        published: true,
        notes: true,
        editorId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      key,
      currentVersion: policy.currentVersion,
      versions,
    };
  }

  /** 管理员获取指定版本的完整内容 */
  async getVersionDetail(key: string, version: number) {
    const policy = await this.prisma.policy.findUnique({ where: { key } });
    if (!policy) throw notFound(ErrorCode.POLICY_NOT_FOUND, 'Policy not found');

    const v = await this.prisma.policyVersion.findUnique({
      where: { policyKey_version: { policyKey: key, version } },
    });
    if (!v) throw notFound(ErrorCode.POLICY_VERSION_NOT_FOUND, 'Policy version not found');

    return {
      version: v.version,
      title: v.title,
      titleEn: v.titleEn,
      titleJa: v.titleJa,
      content: v.content,
      contentEn: v.contentEn,
      contentJa: v.contentJa,
      type: v.type,
      published: v.published,
      notes: v.notes,
      editorId: v.editorId,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    };
  }

  /** 公开 API：根据 key 获取已发布版本的内容（支持语言选择） */
  async findByKey(key: string, lang?: string) {
    const policy = await this.prisma.policy.findUnique({ where: { key } });
    if (!policy || policy.currentVersion == null) {
      throw notFound(ErrorCode.POLICY_NOT_FOUND, 'Policy document not found');
    }

    const version = await this.prisma.policyVersion.findUnique({
      where: { policyKey_version: { policyKey: key, version: policy.currentVersion } },
    });
    if (!version) throw notFound(ErrorCode.POLICY_NOT_FOUND, 'Policy document not found');

    // 根据语言返回对应内容和标题
    let content = version.content;
    let title = version.title;
    if (lang === 'en') {
      if (version.contentEn) content = version.contentEn;
      if (version.titleEn) title = version.titleEn;
    } else if (lang === 'ja') {
      if (version.contentJa) content = version.contentJa;
      if (version.titleJa) title = version.titleJa;
    }

    return {
      key: version.policyKey,
      title,
      content,
      type: version.type,
      updatedAt: version.updatedAt,
    };
  }

  /** 创建新版本（自动+1版号） */
  async createVersion(key: string, dto: CreatePolicyVersionDto, editorId: string) {
    // 确保 Policy 记录存在
    let policy = await this.prisma.policy.findUnique({ where: { key } });
    if (!policy) {
      policy = await this.prisma.policy.create({ data: { key } });
    }

    // 获取当前最大版本号
    const latest = await this.prisma.policyVersion.findFirst({
      where: { policyKey: key },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const newVersion = (latest?.version ?? 0) + 1;

    // 如无内容，从上一版本继承
    let content = dto.content ?? '';
    let contentEn = dto.contentEn ?? '';
    let contentJa = dto.contentJa ?? '';
    let title = dto.title;
    let titleEn = dto.titleEn ?? '';
    let titleJa = dto.titleJa ?? '';
    let type = dto.type ?? 'policy';

    if (latest && !content && !contentEn && !contentJa) {
      const prev = await this.prisma.policyVersion.findUnique({
        where: { policyKey_version: { policyKey: key, version: latest.version } },
      });
      if (prev) {
        if (!content) content = prev.content;
        if (!contentEn) contentEn = prev.contentEn;
        if (!contentJa) contentJa = prev.contentJa;
        if (!title) title = prev.title;
        if (!titleEn) titleEn = prev.titleEn;
        if (!titleJa) titleJa = prev.titleJa;
        type = prev.type;
      }
    }

    return this.prisma.policyVersion.create({
      data: {
        policyKey: key,
        version: newVersion,
        title,
        titleEn,
        titleJa,
        content,
        contentEn,
        contentJa,
        type,
        notes: dto.notes ?? '',
        editorId,
      },
    });
  }

  /** 更新指定版本 */
  async updateVersion(key: string, version: number, dto: UpdatePolicyVersionDto, editorId: string) {
    const existing = await this.prisma.policyVersion.findUnique({
      where: { policyKey_version: { policyKey: key, version } },
    });
    if (!existing) throw notFound(ErrorCode.POLICY_VERSION_NOT_FOUND, 'Policy version not found');
    if (existing.published) throw badRequest(ErrorCode.POLICY_PUBLISHED_LOCKED, 'Published versions cannot be edited; please create a new version');

    return this.prisma.policyVersion.update({
      where: { policyKey_version: { policyKey: key, version } },
      data: {
        title: dto.title,
        titleEn: dto.titleEn,
        titleJa: dto.titleJa,
        content: dto.content,
        contentEn: dto.contentEn,
        contentJa: dto.contentJa,
        type: dto.type,
        notes: dto.notes,
        editorId,
      },
    });
  }

  /** 发布指定版本（自动取消其他版本的发布状态） */
  async publishVersion(key: string, version: number) {
    const existing = await this.prisma.policyVersion.findUnique({
      where: { policyKey_version: { policyKey: key, version } },
    });
    if (!existing) throw notFound(ErrorCode.POLICY_VERSION_NOT_FOUND, 'Policy version not found');

    // 同一个 policy 下，所有版本取消发布
    await this.prisma.policyVersion.updateMany({
      where: { policyKey: key, published: true },
      data: { published: false },
    });

    // 发布指定版本
    await this.prisma.policyVersion.update({
      where: { policyKey_version: { policyKey: key, version } },
      data: { published: true },
    });

    // 更新 Policy 的 currentVersion
    await this.prisma.policy.update({
      where: { key },
      data: { currentVersion: version },
    });

    return { message: '已发布', version };
  }

  /** 删除指定版本（已发布版本删除后自动停止公示） */
  async deleteVersion(key: string, version: number) {
    const existing = await this.prisma.policyVersion.findUnique({
      where: { policyKey_version: { policyKey: key, version } },
    });
    if (!existing) throw notFound(ErrorCode.POLICY_VERSION_NOT_FOUND, 'Policy version not found');

    // 如果删除的是当前公示版本，自动停止公示
    const policy = await this.prisma.policy.findUnique({ where: { key } });
    if (policy?.currentVersion === version) {
      await this.prisma.policy.update({
        where: { key },
        data: { currentVersion: null },
      });
    }

    await this.prisma.policyVersion.delete({
      where: { policyKey_version: { policyKey: key, version } },
    });
    return { message: '已删除' };
  }

  /** 删除整个政策（含所有版本） */
  async remove(key: string) {
    const existing = await this.prisma.policy.findUnique({ where: { key } });
    if (!existing) throw notFound(ErrorCode.POLICY_NOT_FOUND, 'Policy not found');
    await this.prisma.policy.delete({ where: { key } });
    return { message: '已删除' };
  }
}