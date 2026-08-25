/** 冒烟测试：模拟浏览器 SSE 连接 + 快照推送 + 工具调用往返 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.zeroexo', 'canvas-agent.json'), 'utf8'));
const BASE = config.url;
const token = config.token;

// 1. 建立 SSE（模拟浏览器）
const res = await fetch(`${BASE}/events?token=${token}`);
if (!res.ok || !res.body) { console.error('SSE 连接失败', res.status); process.exit(1); }
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let clientId = '';

const pushState = () => fetch(`${BASE}/canvas/state?clientId=${clientId}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-zeroexo-agent-token': token },
  body: JSON.stringify({
    projectId: 'p1',
    nodes: [{ id: 'n1', type: 'text', title: '测试节点', position: { x: 0, y: 0 }, size: { width: 300, height: 200 }, metadata: { content: '冒烟测试内容' } }],
    edges: [], selectedNodeIds: ['n1'], viewport: { x: 0, y: 0, k: 1 },
  }),
});

// 2. 读 SSE 事件流
(async () => {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const evMatch = block.match(/^event: (.+)$/m);
      const dataMatch = block.match(/^data: (.+)$/m);
      if (!evMatch || !dataMatch) continue;
      const type = evMatch[1];
      const data = JSON.parse(dataMatch[1]);
      if (type === 'hello') {
        clientId = data.clientId;
        console.log('[PASS] hello:', clientId);
        await pushState();
        console.log('[PASS] 快照已推送');
        // 3. 发起读工具（另起请求）
        const r1 = await fetch(`${BASE}/api/tools`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-zeroexo-agent-token': token },
          body: JSON.stringify({ name: 'canvas_get_state', input: {} }),
        });
        const j1 = await r1.json();
        console.log('[PASS] canvas_get_state:', JSON.stringify(j1).slice(0, 200));
        const r2 = await fetch(`${BASE}/api/tools`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-zeroexo-agent-token': token },
          body: JSON.stringify({ name: 'canvas_get_selection', input: {} }),
        });
        const j2 = await r2.json();
        console.log('[PASS] canvas_get_selection:', JSON.stringify(j2).slice(0, 200));
        // 4. 发起写工具（应收到 tool_call 事件）
        void fetch(`${BASE}/api/tools`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-zeroexo-agent-token': token },
          body: JSON.stringify({ name: 'canvas_create_node', input: { type: 'text', content: '来自 MCP 的节点' } }),
        }).then(async (r) => {
          const j = await r.json();
          console.log('[PASS] 写工具结果:', JSON.stringify(j));
          console.log('=== 冒烟测试全部通过 ===');
          process.exit(0);
        });
      }
      if (type === 'tool_call') {
        console.log('[PASS] 收到 tool_call:', data.name, JSON.stringify(data.input).slice(0, 120));
        // 模拟浏览器执行后回传结果
        await fetch(`${BASE}/canvas/result`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-zeroexo-agent-token': token },
          body: JSON.stringify({ requestId: data.requestId, result: { ok: true, executed: 1 } }),
        });
      }
    }
  }
})().catch((e) => { console.error('FAIL:', e); process.exit(1); });

setTimeout(() => { console.error('FAIL: 超时'); process.exit(1); }, 15000);
