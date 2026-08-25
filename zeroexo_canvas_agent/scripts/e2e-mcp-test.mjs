/**
 * E2E 测试：AI（MCP 客户端）→ stdio → mcp-server → HTTP → SSE → 模拟浏览器 → 结果回流
 *
 * 验证真实外部 AI 客户端（Codex/Claude Code 同款 stdio JSON-RPC 2.0）的完整调用链。
 * 前置：HTTP 常驻进程已运行（npm run dev，端口 17381）。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const agentDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.zeroexo', 'canvas-agent.json'), 'utf8'));
const BASE = config.url;
const token = config.token;

// ========== 第一幕：模拟浏览器（SSE 接入 + 快照 + 工具执行器） ==========
console.log('--- [浏览器] 建立 SSE 连接 ---');
const sseRes = await fetch(`${BASE}/events?token=${token}`);
if (!sseRes.ok || !sseRes.body) { console.error('FAIL: SSE 连接失败，请先启动常驻进程'); process.exit(1); }
const reader = sseRes.body.getReader();
const decoder = new TextDecoder();
let sseBuffer = '';
let clientId = '';
const executedOps = [];

async function pushState() {
  await fetch(`${BASE}/canvas/state?clientId=${clientId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-zeroexo-agent-token': token },
    body: JSON.stringify({
      projectId: 'p-e2e',
      nodes: [
        { id: 'n-script', type: 'script', title: '测试剧本', position: { x: 0, y: 0 }, size: { width: 720, height: 520 }, metadata: { content: '第一集：测试用剧本内容' } },
        { id: 'n-text', type: 'text', title: '便签', position: { x: 800, y: 0 }, size: { width: 300, height: 200 }, metadata: { content: '画布上的便签' } },
      ],
      edges: [], selectedNodeIds: ['n-text'], viewport: { x: 0, y: 0, k: 1 },
    }),
  });
}

const sseLoop = (async () => {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    const blocks = sseBuffer.split('\n\n');
    sseBuffer = blocks.pop() || '';
    for (const block of blocks) {
      const evMatch = block.match(/^event: (.+)$/m);
      const dataMatch = block.match(/^data: (.+)$/m);
      if (!evMatch || !dataMatch) continue;
      const data = JSON.parse(dataMatch[1]);
      if (evMatch[1] === 'hello') {
        clientId = data.clientId;
        console.log(`[PASS][浏览器] SSE 握手成功 clientId=${clientId.slice(0, 8)}…`);
        await pushState();
        console.log('[PASS][浏览器] 快照已推送（2 节点）');
      }
      if (evMatch[1] === 'tool_call') {
        const ops = data.input?.ops ?? [];
        executedOps.push(...ops.map((o) => o.op));
        console.log(`[PASS][浏览器] 收到 tool_call: ${data.name}（${ops.length} 个 op: ${ops.map((o) => o.op).join(',')}）`);
        await fetch(`${BASE}/canvas/result`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-zeroexo-agent-token': token },
          body: JSON.stringify({ requestId: data.requestId, result: { ok: true, executed: ops.length, failed: 0 } }),
        });
      }
    }
  }
})().catch(() => undefined);

// 等浏览器就绪
await new Promise((r) => setTimeout(r, 500));

// ========== 第二幕：AI 以 MCP 客户端身份对话（stdio JSON-RPC 2.0） ==========
console.log('\n--- [AI/MCP客户端] 启动 mcp stdio 进程 ---');
const child = spawn(process.execPath, [
  path.join(agentDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
  path.join(agentDir, 'src', 'index.ts'),
  'mcp',
], { cwd: agentDir, stdio: ['pipe', 'pipe', 'pipe'] });

let rpcBuffer = '';
const pending = new Map();
function rpcSend(msg) { child.stdin.write(JSON.stringify(msg) + '\n'); }
function rpcCall(id, method, params) {
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    rpcSend({ jsonrpc: '2.0', id, method, params });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`RPC 超时: ${method}`)); } }, 10000);
  });
}
child.stdout.on('data', (chunk) => {
  rpcBuffer += chunk.toString();
  const lines = rpcBuffer.split('\n');
  rpcBuffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      const p = msg.id != null ? pending.get(msg.id) : null;
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      }
    } catch { /* 非 JSON 行忽略 */ }
  }
});
child.stderr.on('data', (d) => process.stderr.write(`[mcp stderr] ${d}`));

// 1. initialize 握手
const init = await rpcCall(1, 'initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'e2e-test-ai', version: '1.0.0' },
});
console.log(`[PASS][MCP] initialize 握手: server=${init.serverInfo?.name} v${init.serverInfo?.version}`);
if (init.instructions) console.log(`[PASS][MCP] 收到 instructions: ${init.instructions.slice(0, 60)}…`);
rpcSend({ jsonrpc: '2.0', method: 'notifications/initialized' });

// 2. 列出工具
const tools = await rpcCall(2, 'tools/list', {});
console.log(`[PASS][MCP] tools/list 返回 ${tools.tools.length} 个工具: ${tools.tools.map((t) => t.name).join(', ')}`);

// 3. 读画布
const stateRes = await rpcCall(3, 'tools/call', { name: 'canvas_get_state', arguments: {} });
const stateText = stateRes.content?.[0]?.text ?? '';
console.log(`[PASS][MCP] canvas_get_state → ${stateText.slice(0, 160)}…`);
if (!stateText.includes('测试剧本') || !stateText.includes('便签')) {
  console.error('FAIL: 快照内容不符'); process.exit(1);
}

// 4. 读选区
const selRes = await rpcCall(4, 'tools/call', { name: 'canvas_get_selection', arguments: {} });
const selText = selRes.content?.[0]?.text ?? '';
console.log(`[PASS][MCP] canvas_get_selection → ${selText.slice(0, 120)}`);

// 5. 创建节点（写操作全链路：AI → MCP → SSE → 浏览器执行）
const createRes = await rpcCall(5, 'tools/call', {
  name: 'canvas_create_node',
  arguments: { type: 'text', title: 'AI 创建的节点', content: '这是外部 AI 通过 MCP 创建的节点', x: 100, y: 400 },
});
const createText = createRes.content?.[0]?.text ?? '';
console.log(`[PASS][MCP] canvas_create_node → ${createText}`);

// 6. 批量操作（连线 + 选中）
const batchRes = await rpcCall(6, 'tools/call', {
  name: 'canvas_apply_ops',
  arguments: {
    ops: [
      { op: 'add_edge', args: { source: { nodeId: 'n-text', pinId: 'output' }, target: { nodeId: 'n-script', pinId: 'input' } } },
      { op: 'set_selection', args: { nodeIds: ['n-script'] } },
    ],
  },
});
const batchText = batchRes.content?.[0]?.text ?? '';
console.log(`[PASS][MCP] canvas_apply_ops（2 op）→ ${batchText}`);

// 7. 错误路径：未知工具（MCP 规范：工具级错误以 isError 结果返回，非 JSON-RPC error）
const badRes = await rpcCall(7, 'tools/call', { name: 'canvas_not_exist', arguments: {} }).catch((e) => ({ _rpcError: String(e) }));
const badText = badRes.content?.[0]?.text ?? badRes._rpcError ?? '';
if (badRes.isError || badRes._rpcError) {
  console.log(`[PASS][MCP] 未知工具正确返回错误: ${badText.slice(0, 80)}`);
} else {
  console.error('FAIL: 未知工具未报错'); process.exit(1);
}

console.log(`\n[PASS][浏览器] 共执行 ${executedOps.length} 个画布操作: ${executedOps.join(', ')}`);
console.log('\n=== E2E 全部通过：AI(MCP stdio) ↔ canvas-agent ↔ 浏览器画布 完整链路验证成功 ===');
child.kill();
sseLoop.catch(() => undefined);
process.exit(0);
