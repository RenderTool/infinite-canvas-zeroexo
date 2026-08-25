/**
 * 模型模板注册表服务（系统级模板库）
 *
 * 职责：
 *   1. 启动时从 DB 加载用户自定义模板，注入 built-in-templates 查询层（内存缓存）
 *   2. 导入/删除后 refresh() 重建缓存（导入即生效）
 *   3. validateTemplateDefinition 模板校验（必填字段 / URL 白名单 / DSL 类型 / ≤100KB）
 *   4. 模板 CRUD（列表 / 导入 / 删除，仅自定义可删）
 *
 * 合并规则（built-in-templates.recommendTemplate）：
 *   自定义优先于内置；同一集合内最长关键词优先。
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ErrorCode } from '../../../common/errors/error-codes';
import { badRequest, conflict, notFound } from '../../../common/errors/app-exception';
import { assertSafeHttpUrl } from '../adapters/video-executor';
import {
  setCustomTemplates,
  getAllTemplates,
  getTemplateById,
} from './built-in-templates';
import type { ModelTemplate, ModelType } from './model-templates.types';

/** 导入模板 JSON 大小上限 */
export const MAX_TEMPLATE_JSON_BYTES = 100 * 1024;

/** 校验结果条目 */
export interface ValidationIssue {
  /** 出错字段路径（如 "task.pollUrlTemplate"） */
  field: string;
  /** 错误信息 */
  message: string;
}

const MODEL_TYPES = ['llm', 'image', 'video', 'audio'];
const PROTOCOLS = ['openai', 'anthropic', 'gemini', 'custom'];
const BODY_STYLES = ['flat', 'content'];
const REFERENCE_FORMATS = ['url', 'base64'];
const AUTH_TYPES = ['bearer', 'header', 'kling-hmac'];
const PARAM_TYPES = ['enum', 'number', 'boolean', 'size', 'string', 'images'];

/** URL 字段校验：绝对 URL 必须 http/https 且非内网；相对路径放行（运行时拼 baseUrl 再校验） */
function assertUrlField(url: string, field: string, issues: ValidationIssue[]): void {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      assertSafeHttpUrl(url, field);
    } catch (err) {
      issues.push({ field, message: (err as Error).message });
    }
  } else if (url.includes('://')) {
    issues.push({ field, message: `只允许 http/https 协议` });
  }
}

/**
 * 模板定义校验（纯函数，供导入 API 与单元测试使用）
 * @returns 校验问题列表（空数组 = 通过）
 */
export function validateTemplateDefinition(raw: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return [{ field: '$', message: '模板必须是 JSON 对象' }];
  }
  const tpl = raw as Record<string, any>;

  // ─── 必填基础字段 ───
  if (typeof tpl.id !== 'string' || !tpl.id.trim()) {
    issues.push({ field: 'id', message: '必填：模板 id（非空字符串）' });
  }
  if (typeof tpl.name !== 'string' || !tpl.name.trim()) {
    issues.push({ field: 'name', message: '必填：模板名称（非空字符串）' });
  }
  if (!MODEL_TYPES.includes(tpl.modelType)) {
    issues.push({ field: 'modelType', message: `必填：modelType 取值 ${MODEL_TYPES.join('|')}` });
  }
  // protocol 可选：纯参数模板缺省（create 时补 'custom'），提供则校验取值
  if (tpl.protocol !== undefined && !PROTOCOLS.includes(tpl.protocol)) {
    issues.push({ field: 'protocol', message: `protocol 取值 ${PROTOCOLS.join('|')}（缺省 custom）` });
  }
  // endpoint 可选：纯参数模板放行；含执行协议（task/sync）时必填提交 URL
  const needsEndpoint = tpl.task !== undefined || tpl.sync !== undefined;
  if (needsEndpoint && (typeof tpl.endpoint !== 'string' || !tpl.endpoint.trim())) {
    issues.push({ field: 'endpoint', message: '必填：endpoint（含 task/sync 执行协议时必须提供提交 URL）' });
  } else if (typeof tpl.endpoint === 'string' && tpl.endpoint.trim()) {
    assertUrlField(tpl.endpoint, 'endpoint', issues);
  }
  if (!Array.isArray(tpl.parameters)) {
    issues.push({ field: 'parameters', message: '必填：parameters 参数声明数组' });
  } else {
    for (let i = 0; i < tpl.parameters.length; i++) {
      const p = tpl.parameters[i];
      if (!p || typeof p !== 'object' || typeof p.name !== 'string' || !p.name) {
        issues.push({ field: `parameters[${i}].name`, message: '参数缺少 name（非空字符串）' });
      }
      if (p && typeof p === 'object' && p.type !== undefined && !PARAM_TYPES.includes(p.type)) {
        issues.push({ field: `parameters[${i}].type`, message: `type 取值 ${PARAM_TYPES.join('|')}` });
      }
    }
  }

  // ─── DSL v2：request ───
  if (tpl.request !== undefined) {
    if (typeof tpl.request !== 'object' || Array.isArray(tpl.request)) {
      issues.push({ field: 'request', message: 'request 必须是对象' });
    } else {
      if (tpl.request.bodyStyle !== undefined && !BODY_STYLES.includes(tpl.request.bodyStyle)) {
        issues.push({ field: 'request.bodyStyle', message: `取值 ${BODY_STYLES.join('|')}` });
      }
      if (tpl.request.referenceFormat !== undefined && !REFERENCE_FORMATS.includes(tpl.request.referenceFormat)) {
        issues.push({ field: 'request.referenceFormat', message: `取值 ${REFERENCE_FORMATS.join('|')}` });
      }
      if (tpl.request.contentRoles !== undefined && (typeof tpl.request.contentRoles !== 'object' || Array.isArray(tpl.request.contentRoles))) {
        issues.push({ field: 'request.contentRoles', message: 'contentRoles 必须是对象' });
      }
    }
  }

  // ─── DSL v2：sync ───
  if (tpl.sync !== undefined) {
    if (typeof tpl.sync !== 'object' || Array.isArray(tpl.sync)) {
      issues.push({ field: 'sync', message: 'sync 必须是对象' });
    } else if (typeof tpl.sync.resultPath !== 'string' || !tpl.sync.resultPath) {
      issues.push({ field: 'sync.resultPath', message: '必填：结果提取路径（如 data[0].url）' });
    }
  }

  // ─── DSL v2：task ───
  if (tpl.task !== undefined) {
    if (typeof tpl.task !== 'object' || Array.isArray(tpl.task)) {
      issues.push({ field: 'task', message: 'task 必须是对象' });
    } else {
      const task = tpl.task;
      for (const f of ['submitIdPath', 'statusPath', 'resultPath']) {
        if (typeof task[f] !== 'string' || !task[f]) {
          issues.push({ field: `task.${f}`, message: '必填：点路径字符串' });
        }
      }
      if (typeof task.pollUrlTemplate !== 'string' || !task.pollUrlTemplate) {
        issues.push({ field: 'task.pollUrlTemplate', message: '必填：轮询 URL 模板（{id} 会被替换为任务 ID）' });
      } else {
        assertUrlField(task.pollUrlTemplate, 'task.pollUrlTemplate', issues);
      }
      if (!Array.isArray(task.successValues) || task.successValues.length === 0) {
        issues.push({ field: 'task.successValues', message: '必填：成功状态值数组（非空）' });
      }
      if (!Array.isArray(task.failureValues)) {
        issues.push({ field: 'task.failureValues', message: '必填：失败状态值数组' });
      }
      if (task.pollIntervalMs !== undefined && (typeof task.pollIntervalMs !== 'number' || task.pollIntervalMs < 500)) {
        issues.push({ field: 'task.pollIntervalMs', message: '轮询间隔需 ≥500ms' });
      }
      if (task.maxPollMs !== undefined && (typeof task.maxPollMs !== 'number' || task.maxPollMs < 10000)) {
        issues.push({ field: 'task.maxPollMs', message: '最长轮询需 ≥10000ms' });
      }
    }
  }

  // ─── DSL v2：auth ───
  if (tpl.auth !== undefined) {
    if (typeof tpl.auth !== 'object' || Array.isArray(tpl.auth)) {
      issues.push({ field: 'auth', message: 'auth 必须是对象' });
    } else if (!AUTH_TYPES.includes(tpl.auth.type)) {
      issues.push({ field: 'auth.type', message: `取值 ${AUTH_TYPES.join('|')}（缺省 bearer）` });
    }
  }

  return issues;
}

/** DB 行 → ModelTemplate */
function normalizeFromDb(row: {
  id: string;
  name: string;
  modelType: string;
  enabled: boolean;
  definition: any;
  matchKeywords: string[];
}): ModelTemplate {
  const def = row.definition ?? {};
  return {
    id: def.id ?? row.id,
    name: def.name ?? row.name,
    protocol: def.protocol,
    modelType: row.modelType as ModelType,
    endpoint: def.endpoint,
    parameters: Array.isArray(def.parameters)
      ? def.parameters.filter((p: any) => p.name !== 'prompt')
      : [],
    maxPromptLength: def.maxPromptLength,
    channelConstraints: def.channelConstraints,
    request: def.request,
    sync: def.sync,
    task: def.task,
    auth: def.auth,
    fallback: def.fallback === true,
    pricing: def.pricing ? { ...def.pricing } : undefined,
    matchKeywords:
      row.matchKeywords?.length > 0
        ? [...row.matchKeywords]
        : def.matchKeywords
          ? [...def.matchKeywords]
          : undefined,
  };
}

@Injectable()
export class TemplateRegistryService implements OnModuleInit {
  private readonly logger = new Logger(TemplateRegistryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 启动时加载 DB 自定义模板到内存（失败不阻断启动，内置模板仍可用） */
  async onModuleInit(): Promise<void> {
    try {
      await this.refresh();
    } catch (err) {
      this.logger.error('模板库初始化失败（内置模板不受影响）', (err as Error).message);
    }
  }

  /** 重建内存缓存（启动 / 导入 / 删除后调用，导入即生效） */
  async refresh(): Promise<void> {
    const rows = await this.prisma.modelTemplate.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });
    setCustomTemplates(rows.map(normalizeFromDb));
    this.logger.log(`模板库已刷新：自定义模板 ${rows.length} 个`);
  }

  /** 全部模板（内置 + 自定义，带 isBuiltIn 标记），管理端列表用 */
  async list(): Promise<Array<ModelTemplate & { isBuiltIn: boolean; enabled: boolean }>> {
    const rows = await this.prisma.modelTemplate.findMany({ orderBy: { createdAt: 'asc' } });
    const customIds = new Set(rows.map((r) => r.id));
    const builtin = getAllTemplates().filter((t) => !customIds.has(t.id));
    return [
      ...builtin.map((t) => ({ ...t, isBuiltIn: true, enabled: true })),
      ...rows.map((r) => ({ ...normalizeFromDb(r), isBuiltIn: false, enabled: r.enabled })),
    ];
  }

  /** 导入模板：校验 → 落库 → 刷新缓存（导入即生效） */
  async create(raw: unknown): Promise<ModelTemplate> {
    const issues = validateTemplateDefinition(raw);
    if (issues.length > 0) {
      throw badRequest(
        ErrorCode.BAD_REQUEST,
        `模板校验失败: ${issues.map((i) => `${i.field}: ${i.message}`).join('; ')}`,
      );
    }
    const tpl = raw as ModelTemplate;
    if (getTemplateById(tpl.id)) {
      throw conflict(ErrorCode.CONFLICT, `模板 id 已存在: ${tpl.id}`);
    }
    // 纯参数模板允许缺省 protocol → 补齐 'custom'，保证执行链路协议语义完整
    const def = {
      ...(raw as object),
      protocol: (raw as Record<string, any>).protocol ?? 'custom',
    };
    await this.prisma.modelTemplate.create({
      data: {
        id: tpl.id,
        name: tpl.name,
        modelType: tpl.modelType,
        definition: def,
        matchKeywords: tpl.matchKeywords ?? [],
      },
    });
    await this.refresh();
    return tpl;
  }

  /** 删除模板（仅自定义模板可删） */
  async remove(id: string): Promise<void> {
    const row = await this.prisma.modelTemplate.findUnique({ where: { id } });
    if (!row) throw notFound(ErrorCode.NOT_FOUND, `模板不存在: ${id}`);
    if (row.isBuiltIn) throw badRequest(ErrorCode.BAD_REQUEST, '内置模板不可删除');
    await this.prisma.modelTemplate.delete({ where: { id } });
    await this.refresh();
  }
}
