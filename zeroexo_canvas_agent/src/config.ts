/**
 * config — Agent 配置持久化（~/.zeroexo/canvas-agent.json）
 *
 * 存储：监听地址 / 连接 token / 已信任 Origin 列表。
 * token 首次启动随机生成，网页需携带正确 token 才能连接；
 * 首个成功连接的 Origin 被锁定，防止其他站点劫持本地 Agent。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PORT = 17381;
export const CONFIG_DIR = path.join(os.homedir(), '.zeroexo');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'canvas-agent.json');
export const VERSION = '0.1.0';

/** 注入给 AI 的操作指引（MCP instructions + 工具调用守则） */
export const AGENT_PROMPT = [
  '你正在帮助用户操作 ZeroExo 网页画布（短剧/视频创作工作台）。',
  '需要改动画布时使用 zeroexo-canvas MCP 工具：',
  '先 canvas_get_state 读取当前画布拿到真实节点 id，再用 canvas_create_node / canvas_update_node / canvas_apply_ops / canvas_connect_nodes 等工具操作。',
  '节点类型：script 剧本 / storyboard 分镜 / text 文本 / image 图片 / video 视频 / audio 音频 / generator 生成器 / config 配置。',
  '禁止凭记忆猜测节点 id；禁止要求用户手动复制 JSON；批量改动优先 canvas_apply_ops 一次完成。',
].join('');

export interface CanvasAgentConfig {
  url: string;
  token: string;
  origins?: string[];
}

export function loadConfig(create = false): CanvasAgentConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as CanvasAgentConfig;
  } catch {
    const config: CanvasAgentConfig = {
      url: `http://127.0.0.1:${Number(process.env.PORT) || DEFAULT_PORT}`,
      token: crypto.randomBytes(18).toString('hex'),
    };
    if (create) saveConfig(config);
    return config;
  }
}

export function saveConfig(config: CanvasAgentConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
