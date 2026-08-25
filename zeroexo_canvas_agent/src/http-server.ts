/**
 * http-server — 本地 HTTP/SSE 服务（浏览器连接面）
 *
 * 端点：
 *   GET  /health          健康检查（无需 token）
 *   GET  /config          返回监听地址（无需 token）
 *   GET  /events          浏览器 SSE 接入（携带 token）
 *   POST /canvas/state    浏览器上行画布快照
 *   POST /canvas/result   浏览器回传工具执行结果
 *   POST /api/tools       工具调用（MCP stdio 模式之外的直连通道，调试用）
 *
 * 安全：仅监听 127.0.0.1；token 校验；首个成功 Origin 锁定。
 */

import express, { type NextFunction, type Request, type Response } from 'express';

import { DEFAULT_PORT, loadConfig, saveConfig, type CanvasAgentConfig } from './config.js';
import { CanvasSession } from './canvas-session.js';

export function startHttpServer(): void {
  const config = loadConfig(true);
  const port = Number(process.env.PORT) || Number(new URL(config.url).port) || DEFAULT_PORT;
  config.url = `http://127.0.0.1:${port}`;
  saveConfig(config);

  const session = new CanvasSession();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));

  // CORS + Origin 锁定
  app.use((req, res, next) => {
    if (!setCors(req, res, config)) {
      res.status(403).json({ ok: false, error: 'origin not allowed' });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.json({});
      return;
    }
    next();
  });

  app.get('/health', (_req, res) => res.json(session.health()));
  app.get('/config', (_req, res) => res.json({ ok: true, url: config.url, hasToken: true }));

  // token 鉴权（其余端点）
  app.use((req, res, next) => {
    if (validToken(req, config.token)) next();
    else res.status(401).json({ ok: false, error: 'invalid token' });
  });

  app.get('/events', (req, res) => {
    const url = new URL(req.originalUrl || req.url || '/', config.url);
    session.openEvents(url, res);
  });
  app.post('/canvas/state', (req, res) => {
    session.updateState(req.body, typeof req.query.clientId === 'string' ? req.query.clientId : undefined);
    res.json({ ok: true });
  });
  app.post('/canvas/result', (req, res) => {
    session.resolveResult(req.body);
    res.json({ ok: true });
  });
  app.post('/api/tools', route(async (req, res) => {
    const result = await session.callTool(req.body?.name, req.body?.input || {});
    res.json({ ok: true, result });
  }));

  app.use((_req, res) => res.status(404).json({ ok: false, error: 'not found' }));
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ ok: false, error: error.message });
  });

  app.listen(port, '127.0.0.1', () => {
    console.log('ZeroExo Canvas Agent');
    console.log(`Local URL: ${config.url}`);
    console.log(`Connect token: ${config.token}`);
    console.log('MCP: 在 AI 客户端注册本程序并追加参数 mcp（stdio 模式）');
  });
}

function route(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res).catch(next);
  };
}

function validToken(req: Request, token: string): boolean {
  const url = new URL(req.originalUrl || req.url || '/', 'http://127.0.0.1');
  const header = req.headers['x-zeroexo-agent-token'];
  return (
    url.searchParams.get('token') === token ||
    header === token ||
    (Array.isArray(header) && header.includes(token))
  );
}

/** CORS 放行 + 首个可信 Origin 锁定（对齐 infinite-canvas 安全模型） */
function setCors(req: Request, res: Response, config: CanvasAgentConfig): boolean {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-zeroexo-agent-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  const url = new URL(req.originalUrl || req.url || '/', config.url);
  if (!origin || req.method === 'OPTIONS' || url.pathname === '/health' || url.pathname === '/config') {
    return true;
  }
  config.origins ||= [];
  if (validToken(req, config.token) && !config.origins.includes(origin)) {
    config.origins.push(origin);
    saveConfig(config);
  }
  res.setHeader('Vary', 'Origin');
  return config.origins.includes(origin);
}
