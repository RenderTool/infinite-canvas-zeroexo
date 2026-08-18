/**
 * LogsService - 后台日志服务
 *
 * 内存环形缓冲区(保留最近 1000 条),无需数据库表。
 * 支持分类(auth/asset/project/sync/ai/http/system)与级别(info/warn/error)。
 *
 * 日志条目结构:
 * - timestamp: ISO 时间
 * - level: info | warn | error
 * - category: auth | asset | project | sync | ai | http | system
 * - message: 简短描述
 * - userId?: 关联用户(若已认证)
 * - username?: 用户名(便于阅读)
 * - meta?: 任意附加元数据(对象)
 */

import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogCategory =
  | 'auth'
  | 'asset'
  | 'project'
  | 'sync'
  | 'ai'
  | 'http'
  | 'system';

export interface LogEntry {
  id: number;
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  userId?: string;
  username?: string;
  meta?: Record<string, unknown>;
}

export interface LogQuery {
  category?: LogCategory;
  level?: LogLevel;
  keyword?: string;
  username?: string;
  startTime?: string;
  endTime?: string;
  offset?: number;
  limit?: number;
}

export interface LogQueryResult {
  entries: LogEntry[];
  total: number;
}

const MAX_ENTRIES = 1000;

@Injectable()
export class LogsService {
  private readonly entries: LogEntry[] = [];
  private nextId = 1;
  private readonly logger = new Logger('Log');
  private readonly logDir: string;

  constructor() {
    this.logDir = path.resolve(process.cwd(), 'storage', 'logs');
    fs.mkdirSync(this.logDir, { recursive: true });

    // 记录系统启动
    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      level: 'info',
      category: 'system',
      message: 'ZeroExo 后端服务已启动',
    };
    this.entries.push(entry);
    this.writeToFile(entry);
  }

  /**
   * 记录一条日志
   */
  log(
    category: LogCategory,
    message: string,
    options: {
      level?: LogLevel;
      userId?: string;
      username?: string;
      meta?: Record<string, unknown>;
    } = {},
  ): void {
    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      level: options.level ?? 'info',
      category,
      message,
      userId: options.userId,
      username: options.username,
      meta: options.meta,
    };

    this.entries.push(entry);
    // 超出容量时丢弃最旧的
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }

    // 写入文件日志
    this.writeToFile(entry);

    // 同时输出到控制台(便于开发)
    const userTag = options.username ? `[${options.username}]` : '';
    const metaStr = options.meta ? ` ${JSON.stringify(options.meta)}` : '';
    const consoleMsg = `[${category}]${userTag} ${message}${metaStr}`;
    if (entry.level === 'error') {
      this.logger.error(consoleMsg);
    } else if (entry.level === 'warn') {
      this.logger.warn(consoleMsg);
    } else {
      this.logger.log(consoleMsg);
    }
  }

  /**
   * 查询日志(支持按分类/级别/关键词/用户名/时间范围过滤,最新在前,分页)
   */
  query(query: LogQuery): LogQueryResult {
    let result = this.entries;

    if (query.category) {
      result = result.filter((e) => e.category === query.category);
    }
    if (query.level) {
      result = result.filter((e) => e.level === query.level);
    }
    if (query.username) {
      const uname = query.username.toLowerCase();
      result = result.filter((e) => e.username?.toLowerCase().includes(uname) ?? false);
    }
    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      result = result.filter(
        (e) =>
          e.message.toLowerCase().includes(kw) ||
          (e.username?.toLowerCase().includes(kw) ?? false) ||
          (e.userId?.toLowerCase().includes(kw) ?? false),
      );
    }
    if (query.startTime) {
      result = result.filter((e) => e.timestamp >= query.startTime!);
    }
    if (query.endTime) {
      result = result.filter((e) => e.timestamp <= query.endTime!);
    }

    // 最新在前
    const sorted = result.slice().reverse();
    const total = sorted.length;
    const limit = Math.min(query.limit ?? 200, MAX_ENTRIES);
    const offset = query.offset ?? 0;
    return { entries: sorted.slice(offset, offset + limit), total };
  }

  /**
   * 获取日志统计(各分类/级别的数量)
   */
  stats(): {
    total: number;
    byCategory: Record<string, number>;
    byLevel: Record<string, number>;
  } {
    const byCategory: Record<string, number> = {};
    const byLevel: Record<string, number> = {};
    for (const e of this.entries) {
      byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
      byLevel[e.level] = (byLevel[e.level] ?? 0) + 1;
    }
    return { total: this.entries.length, byCategory, byLevel };
  }

  /**
   * 将日志条目写入当日文件
   */
  private writeToFile(entry: LogEntry): void {
    const dateStr = entry.timestamp.slice(0, 10); // 2026-07-16
    const filePath = path.join(this.logDir, `${dateStr}.log`);
    const line = JSON.stringify(entry) + '\n';
    try {
      fs.appendFileSync(filePath, line, 'utf-8');
    } catch (err) {
      this.logger.error(`写入日志文件失败: ${(err as Error).message}`);
    }
  }

  /**
   * 删除超过指定天数的日志文件
   */
  cleanupLogFiles(daysToKeep: number): { deletedFiles: number; deletedSize: number } {
    const now = Date.now();
    const cutoffMs = daysToKeep * 24 * 60 * 60 * 1000;
    let deletedFiles = 0;
    let deletedSize = 0;

    if (!fs.existsSync(this.logDir)) {
      return { deletedFiles: 0, deletedSize: 0 };
    }

    const files = fs.readdirSync(this.logDir);
    for (const file of files) {
      if (!file.endsWith('.log')) continue;
      const filePath = path.join(this.logDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > cutoffMs) {
          deletedSize += stat.size;
          fs.unlinkSync(filePath);
          deletedFiles++;
        }
      } catch {
        // 跳过无法读取的文件
      }
    }
    return { deletedFiles, deletedSize };
  }

  /**
   * 获取每个日志文件的大小和日期
   */
  getLogFileStats(): Array<{ name: string; size: number; date: string }> {
    if (!fs.existsSync(this.logDir)) {
      return [];
    }

    const files = fs.readdirSync(this.logDir);
    const stats: Array<{ name: string; size: number; date: string }> = [];
    for (const file of files) {
      if (!file.endsWith('.log')) continue;
      const filePath = path.join(this.logDir, file);
      try {
        const stat = fs.statSync(filePath);
        const date = file.replace(/\.log$/, '');
        stats.push({ name: file, size: stat.size, date });
      } catch {
        // 跳过无法读取的文件
      }
    }
    // 按日期降序排列
    stats.sort((a, b) => b.date.localeCompare(a.date));
    return stats;
  }

  /**
   * 清空所有日志
   */
  clear(): void {
    this.entries.length = 0;
    this.log('system', '日志已清空', { level: 'info' });
  }
}
