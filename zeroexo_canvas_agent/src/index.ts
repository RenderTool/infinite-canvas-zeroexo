#!/usr/bin/env node
/**
 * zeroexo-canvas-agent 入口
 *
 * 用法：
 *   zeroexo-canvas-agent        启动本地 HTTP/SSE 常驻服务（浏览器连接面）
 *   zeroexo-canvas-agent mcp    stdio MCP 模式（AI 客户端注册用，转发到常驻服务）
 */

import { startHttpServer } from './http-server.js';
import { startMcpServer } from './mcp-server.js';

if (process.argv[2] === 'mcp') await startMcpServer();
else startHttpServer();
