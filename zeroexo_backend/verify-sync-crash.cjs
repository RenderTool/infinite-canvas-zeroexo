/* 一次性验证脚本：模拟 >1MB 画布 Yjs 更新，验证修复后后端进程不再崩溃
 * 用法：node verify-sync-crash.cjs <projectId>，运行后观察后端日志出现 [SIZE] 告警且进程存活
 * 依赖：Node 22+ 内置 WebSocket；yjs 走绝对路径（pnpm 严格隔离）
 */
const jwt = require('jsonwebtoken');
const Y = require('d:/AICode/zeroexo/zeroexo-platform/zeroexo_backend/node_modules/.pnpm/yjs@13.6.31/node_modules/yjs');
const fs = require('fs');
const WebSocket = globalThis.WebSocket;

const projectId = process.argv[2] || '3e820a2e-d205-4f3e-b3c8-51bc770edeb4';
const env = fs.readFileSync('.env', 'utf8');
const secret = (env.match(/JWT_SECRET\s*=\s*(.+)/) || [])[1]?.trim();
if (!secret) { console.error('NO JWT_SECRET'); process.exit(1); }

const token = jwt.sign({ sub: 'verify-sync-test' }, secret);
const ws = new WebSocket(`ws://localhost:3000/ws-sync/canvas:${projectId}?token=${encodeURIComponent(token)}`);

// Yjs 协议：构造 2MB update
const doc = new Y.Doc();
doc.getMap('nodes').set('big-payload', 'x'.repeat(2 * 1024 * 1024));
const update = Y.encodeStateAsUpdate(doc);

function encodeVarUint(num) {
  const bytes = [];
  while (num > 0x7f) { bytes.push((num & 0x7f) | 0x80); num = Math.floor(num / 128); }
  bytes.push(num);
  return Buffer.from(bytes);
}
// sync 消息(0) → update 子消息(2)
const subMsg = Buffer.concat([encodeVarUint(2), encodeVarUint(update.length), Buffer.from(update)]);
const msg = Buffer.concat([Buffer.from([0]), subMsg]);

ws.addEventListener('open', () => {
  console.log(`WS OPEN, sending ${(msg.length / 1024 / 1024).toFixed(1)}MB update...`);
  ws.send(msg);
});
ws.addEventListener('message', (e) => console.log('WS MSG', e.data?.byteLength ?? e.data?.length));
ws.addEventListener('error', (e) => console.log('WS ERR', e.message ?? e.type));
ws.addEventListener('close', (e) => console.log('WS CLOSE', e.code));

setTimeout(() => {
  console.log('VERIFY DONE - 若进程仍存活且日志出现 [SIZE] 告警 = 修复生效');
  process.exit(0);
}, 6000);
