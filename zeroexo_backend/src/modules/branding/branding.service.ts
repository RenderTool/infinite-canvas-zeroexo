/**
 * BrandingService - 品牌配置管理
 *
 * 存储: config/branding.json(与 settings.json 同目录)
 * 用途: 前端门户登录页背景视频轮播、品牌素材等动态配置
 *
 * 接口:
 *   GET  /api/branding          → 公开,供登录页拉取
 *   GET  /api/admin/branding    → 管理员获取完整配置
 *   PUT  /api/admin/branding    → 管理员更新配置
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** 视频配置 */
export interface HeroVideoItem {
  /** 视频 URL */
  url: string;
  /** 该视频的专属回退图片(可选,无则使用全局回退图片) */
  image?: string | null;
  /** 标签(管理后台识别用) */
  label?: string;
  /** 是否启用 */
  enabled?: boolean;
}

/** 品牌配置结构 */
export interface BrandingConfig {
  /** 视频列表(按顺序播放) */
  heroVideos: HeroVideoItem[];
  /** 全局回退图片(视频列表为空或均加载失败时显示) */
  heroFallbackImage: string | null;
  updatedAt: string;
  version: number;
}

const CONFIG_DIR = path.resolve(process.cwd(), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'branding.json');
const CURRENT_VERSION = 3;

const DEFAULT_CONFIG: BrandingConfig = {
  heroVideos: [],
  heroFallbackImage: '/api/storage/get?key=resources/public/branding/fallback/hero-fallback.webp',
  updatedAt: new Date().toISOString(),
  version: CURRENT_VERSION,
};

@Injectable()
export class BrandingService implements OnModuleInit {
  private readonly logger = new Logger(BrandingService.name);

  async onModuleInit(): Promise<void> {
    try {
      await fs.access(CONFIG_FILE);
      const cfg = await this.readConfig();
      this.logger.log(`品牌配置已加载: ${cfg.heroVideos.length} 个视频`);
    } catch {
      this.logger.log('品牌配置文件不存在,首次使用默认配置');
    }
  }

  /** 获取当前配置(不存在则返回默认) */
  async getConfig(): Promise<BrandingConfig> {
    try {
      return await this.readConfig();
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  /** 更新配置(合并写入) */
  async updateConfig(patch: Partial<BrandingConfig>): Promise<BrandingConfig> {
    const current = await this.getConfig();
    const updated: BrandingConfig = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
      version: CURRENT_VERSION,
    };
    // heroVideos 是数组,直接覆盖(不做深层合并)
    if (patch.heroVideos) {
      updated.heroVideos = patch.heroVideos;
    }
    await this.writeConfig(updated);
    this.logger.log(`品牌配置已更新: ${updated.heroVideos.length} 个视频`);
    return updated;
  }

  private async readConfig(): Promise<BrandingConfig> {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BrandingConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      heroVideos: Array.isArray(parsed.heroVideos) ? parsed.heroVideos : [],
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      version: parsed.version ?? CURRENT_VERSION,
    };
  }

  private async writeConfig(config: BrandingConfig): Promise<void> {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  }
}