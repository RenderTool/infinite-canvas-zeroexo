/**
 * mcp-server — MCP stdio 注册壳（AI 客户端连接面）
 *
 * 由 AI 客户端（Codex/Claude Code/Cursor）以 stdio 方式启动：
 *   zeroexo-canvas-agent mcp
 *
 * 职责仅为「MCP 协议 → HTTP 转发」：把工具调用 POST 给常驻的 HTTP 模式进程
 * （127.0.0.1:17381 /api/tools），画布会话状态由后者持有。
 * 因此使用前需先启动 HTTP 模式：zeroexo-canvas-agent（无参数）。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { AGENT_PROMPT, loadConfig, VERSION, type CanvasAgentConfig } from './config.js';
import { toolDescriptions, toolInputSchemas, toolNames, type ToolName } from './schemas.js';

type ToolResponse = { ok?: boolean; result?: unknown; error?: string };

export async function startMcpServer(): Promise<void> {
  const config = loadConfig(true);
  const server = new McpServer(
    { name: 'zeroexo-canvas', version: VERSION },
    { instructions: AGENT_PROMPT },
  );
  toolNames.forEach((name) => registerCanvasTool(server, config, name));
  await server.connect(new StdioServerTransport());
}

function registerCanvasTool(server: McpServer, config: CanvasAgentConfig, name: ToolName): void {
  const schema = toolInputSchemas[name];
  server.registerTool(
    name,
    { description: toolDescriptions[name], inputSchema: schema.shape },
    async (input: unknown) => {
      const result = await postCanvasAgentTool(config, name, schema.parse(input));
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}

async function postCanvasAgentTool(config: CanvasAgentConfig, name: ToolName, input: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${config.url}/api/tools`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-zeroexo-agent-token': config.token,
      },
      body: JSON.stringify({ name, input }),
    });
  } catch {
    throw new Error('无法连接 ZeroExo Canvas Agent 常驻进程——请先在终端运行 `zeroexo-canvas-agent`（不带 mcp 参数）启动本地服务，并在画布 Agent 面板完成连接');
  }
  const body = (await res.json()) as ToolResponse;
  if (!body.ok) throw new Error(body.error || 'tool call failed');
  return body.result;
}
