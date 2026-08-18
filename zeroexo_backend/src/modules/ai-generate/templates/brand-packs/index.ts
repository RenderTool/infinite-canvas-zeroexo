/**
 * 品牌配置包注册表
 *
 * 所有品牌数据统一存储在 data/ 目录下，每个品牌一个 .json 文件。
 * 新增品牌 → 在 data/ 下新建一个 .json 文件即可，无需改任何代码。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { BrandPresetPack } from '../model-templates.types';

const DATA_DIR = path.join(__dirname, 'data');

/** 从 data/ 目录加载所有 JSON 配置包 */
function loadPacks(): BrandPresetPack[] {
  const results: BrandPresetPack[] = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    console.warn('[brand-packs] data 目录不存在:', DATA_DIR);
    return results;
  }

  files.sort();
  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      results.push(JSON.parse(content));
    } catch (err) {
      console.warn(`[brand-packs] 加载配置包失败: ${file}`, (err as Error).message);
    }
  }
  return results;
}

/** 运行时配置包列表（JSON 文件变更后重启生效） */
export const BRAND_PRESET_PACKS: BrandPresetPack[] = loadPacks();

/** 按 provider 获取配置包列表 */
export function getPacksByProvider(provider: string): BrandPresetPack[] {
  return BRAND_PRESET_PACKS.filter((p) => p.provider === provider);
}

/** 按 ID 获取配置包 */
export function getPackById(packId: string): BrandPresetPack | undefined {
  return BRAND_PRESET_PACKS.find((p) => p.id === packId);
}
