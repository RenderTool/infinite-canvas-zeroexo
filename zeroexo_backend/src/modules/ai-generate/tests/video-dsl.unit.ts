/**
 * 视频模板 DSL v2 单元测试（自测脚本，无框架依赖）
 *
 * 运行: npx ts-node src/modules/ai-generate/tests/video-dsl.unit.ts
 * 覆盖:
 *   - resolvePath 点路径解析（含数组下标）
 *   - kling-signer JWT 签名（对照官方算法向量）+ 认证头组装
 *   - validateTemplateDefinition 模板校验器
 *   - video-executor 全流程: content 风格 + task 轮询 / flat 风格 + sync / OpenAI 兜底 / 失败态 / SSRF
 *   - VolcengineAdapter mode→task 内联翻译（video-edit 强制 adaptive/-1）
 */

import * as crypto from 'crypto';
import { resolvePath } from '../adapters/resolve-path';
import { signKlingJwt, buildAuthHeaders } from '../adapters/kling-signer';
import { validateTemplateDefinition } from '../templates/registry.service';
import { executeVideoByTemplate } from '../adapters/video-executor';
import { VolcengineAdapter } from '../adapters/volcengine.adapter';
import type { AdapterContext, GenerateRequest } from '../adapters/adapter.interface';

// ===== 简易断言 =====

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function assertThrows(fn: () => unknown, label: string, match?: RegExp): void {
  try {
    fn();
    failed++;
    console.error(`  ✗ ${label}（未抛错）`);
  } catch (err) {
    if (match && !match.test((err as Error).message)) {
      failed++;
      console.error(`  ✗ ${label}（错误信息不符: ${(err as Error).message}）`);
    } else {
      passed++;
    }
  }
}

// ===== 1. resolvePath =====

function testResolvePath(): void {
  console.log('[1] resolvePath 点路径解析');
  assert(resolvePath({ data: [{ url: 'https://a.com/v.mp4' }] }, 'data[0].url') === 'https://a.com/v.mp4', 'data[0].url');
  assert(resolvePath({ content: { video_url: 'x' } }, 'content.video_url') === 'x', 'content.video_url');
  assert(
    resolvePath({ data: { task_result: { videos: [{ url: 'y' }] } } }, 'data.task_result.videos[0].url') === 'y',
    'data.task_result.videos[0].url（嵌套+数组）',
  );
  assert(resolvePath({ a: [{ b: [{ c: 42 }] }] }, 'a[0].b[0].c') === 42, 'a[0].b[0].c');
  assert(resolvePath({ a: { b: 1 } }, 'a.b.c') === undefined, '路径不存在返回 undefined');
  assert(resolvePath(null, 'a.b') === undefined, 'null 入参返回 undefined');
  assert(resolvePath({}, '') === undefined, '空路径返回 undefined');
  assert(resolvePath({ 'data[0]': 1 }, 'data[0]') === undefined, '数字下标不走对象键');
}

// ===== 2. kling-signer =====

function testKlingSigner(): void {
  console.log('[2] kling-signer JWT 签名（对照官方算法向量）');
  const now = 1700000000;
  const token = signKlingJwt('ak-123', 'sk-secret', now);
  const parts = token.split('.');
  assert(parts.length === 3, 'JWT 为三段式');

  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));
  assert(header.alg === 'HS256' && header.typ === 'JWT', 'Header = {alg:HS256, typ:JWT}');

  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  assert(payload.iss === 'ak-123', 'Payload.iss = AccessKey');
  assert(payload.exp === now + 1800, 'Payload.exp = now+1800');
  assert(payload.nbf === now - 5, 'Payload.nbf = now-5');

  const expectedSig = crypto
    .createHmac('sha256', 'sk-secret')
    .update(`${parts[0]}.${parts[1]}`)
    .digest('base64url');
  assert(parts[2] === expectedSig, 'Signature = HMAC-SHA256(SK, header.payload)');

  // 认证头组装
  assert(buildAuthHeaders(undefined, 'k')['Authorization'] === 'Bearer k', '缺省 = Bearer apiKey');
  assert(buildAuthHeaders({ type: 'header', apiKeyHeader: 'X-Api-Key' }, 'k')['X-Api-Key'] === 'k', 'header 模式自定义头名');
  const both = buildAuthHeaders({ type: 'header', apiKeyHeader: 'X-Api-Key', alsoBearer: true }, 'k');
  assert(both['X-Api-Key'] === 'k' && both['Authorization'] === 'Bearer k', 'header+alsoBearer 双发');
  const kling = buildAuthHeaders({ type: 'kling-hmac' }, 'ak-123', 'sk-secret');
  assert(!!kling['Authorization']?.startsWith('Bearer '), 'kling-hmac → Bearer JWT');
  assertThrows(
    () => buildAuthHeaders({ type: 'kling-hmac' }, 'ak-123', undefined),
    'kling-hmac 缺 secretKey 抛错',
    /SecretKey/,
  );
}

// ===== 3. validateTemplateDefinition =====

const VALID_TEMPLATE = {
  id: 'my-video',
  name: '我的视频模型',
  protocol: 'openai',
  modelType: 'video',
  endpoint: '/v1/videos/generations',
  parameters: [{ name: 'size', type: 'enum', label: '尺寸', default: '1024x1024', values: ['1024x1024'] }],
  auth: { type: 'bearer' },
  sync: { resultPath: 'data[0].url' },
  matchKeywords: ['my-video'],
};

function testValidator(): void {
  console.log('[3] validateTemplateDefinition 模板校验器');
  assert(validateTemplateDefinition(VALID_TEMPLATE).length === 0, '合法模板通过');

  for (const field of ['id', 'name', 'modelType', 'parameters']) {
    const t = { ...VALID_TEMPLATE, [field]: undefined };
    assert(
      validateTemplateDefinition(t).some((i) => i.field === field),
      `缺 ${field} 报错`,
    );
  }

  // 纯参数模板（无 protocol/endpoint，管理端参数配置弹窗导入）放行
  const paramOnly = {
    id: 'custom-param-only',
    name: '纯参数模板',
    modelType: 'video',
    parameters: [{ name: 'size', type: 'enum', label: '尺寸', default: '1024x1024', values: ['1024x1024'] }],
  };
  assert(validateTemplateDefinition(paramOnly).length === 0, '纯参数模板（无 protocol/endpoint）通过');

  // advanced 标记（生成面板高级选项折叠）是合法可选字段，校验通过且透传
  const advancedTpl = {
    ...VALID_TEMPLATE,
    parameters: [
      { name: 'mode', type: 'enum', label: '生成模式', default: 'a', values: ['a', 'b'] },
      { name: 'cameraFixed', type: 'boolean', label: '固定镜头', default: false, advanced: true },
      { name: 'priority', type: 'number', label: '执行优先级', default: 0, min: 0, max: 9, advanced: true },
    ],
  };
  assert(validateTemplateDefinition(advancedTpl).length === 0, '带 advanced 字段的模板通过');
  assert(
    (advancedTpl.parameters as any[]).filter((p) => p.advanced).length === 2,
    'advanced 字段保持透传（生成面板据此折叠显示）',
  );

  // 含执行协议（task/sync）时必须提供 endpoint
  const taskNoEndpoint = { ...VALID_TEMPLATE, endpoint: undefined, task: { ...(VALID_TEMPLATE as any).task } };
  assert(
    validateTemplateDefinition(taskNoEndpoint).some((i) => i.field === 'endpoint'),
    'task 存在但缺 endpoint 报错',
  );
  const syncNoEndpoint = { ...VALID_TEMPLATE, endpoint: undefined };
  assert(
    validateTemplateDefinition(syncNoEndpoint).some((i) => i.field === 'endpoint'),
    'sync 存在但缺 endpoint 报错',
  );

  const inner = { ...VALID_TEMPLATE, endpoint: 'http://127.0.0.1:3000/api' };
  assert(validateTemplateDefinition(inner).some((i) => i.field === 'endpoint'), '内网 endpoint 拒绝');

  const ftp = { ...VALID_TEMPLATE, endpoint: 'ftp://example.com/x' };
  assert(validateTemplateDefinition(ftp).some((i) => i.field === 'endpoint'), '非 http/https 协议拒绝');

  const badTask = {
    ...VALID_TEMPLATE,
    task: {
      submitIdPath: 'id',
      pollUrlTemplate: 'http://192.168.1.1/poll/{id}',
      statusPath: 'status',
      successValues: [],
      failureValues: ['failed'],
      resultPath: 'data[0].url',
    },
  };
  const badTaskIssues = validateTemplateDefinition(badTask);
  assert(badTaskIssues.some((i) => i.field === 'task.successValues'), 'task.successValues 空数组报错');
  assert(badTaskIssues.some((i) => i.field === 'task.pollUrlTemplate'), 'task.pollUrlTemplate 内网拒绝');

  const badAuth = { ...VALID_TEMPLATE, auth: { type: 'nope' } };
  assert(validateTemplateDefinition(badAuth).some((i) => i.field === 'auth.type'), 'auth.type 非法报错');

  const badBodyStyle = { ...VALID_TEMPLATE, request: { bodyStyle: 'xml' } };
  assert(validateTemplateDefinition(badBodyStyle).some((i) => i.field === 'request.bodyStyle'), 'request.bodyStyle 非法报错');

  assert(validateTemplateDefinition('str').length === 1, '非对象入参报错');
  assert(validateTemplateDefinition(null).length === 1, 'null 入参报错');
}

// ===== 4. video-executor（mock fetch） =====

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body: any;
}

function mockFetch(routes: Array<(req: CapturedRequest) => Promise<any>>): { captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  let idx = 0;
  (globalThis as any).fetch = async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) {
      headers[k] = String(v);
    }
    const req: CapturedRequest = {
      url,
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    captured.push(req);
    const handler = routes[Math.min(idx, routes.length - 1)];
    idx++;
    const data = await handler(req);
    return {
      ok: true,
      status: 200,
      json: async () => data.json,
      text: async () => JSON.stringify(data.json),
      arrayBuffer: async () => Buffer.from(data.buffer ?? ''),
    };
  };
  return { captured };
}

const CONTENT_TEMPLATE = {
  paramMapping: { mode: 'task', resolution: 'resolution', duration: 'duration', referenceImages: 'image' },
  request: {
    bodyStyle: 'content' as const,
    contentRoles: {
      image: 'reference_image',
      firstFrame: 'first_frame',
      lastFrame: 'last_frame',
      video: 'reference_video',
      audio: 'reference_audio',
    },
  },
  task: {
    submitIdPath: 'id',
    pollUrlTemplate: '/contents/generations/tasks/{id}',
    statusPath: 'status',
    successValues: ['succeeded'],
    failureValues: ['failed'],
    resultPath: 'content.video_url',
    pollIntervalMs: 10,
    maxPollMs: 60000,
  },
  auth: { type: 'bearer' as const },
  endpoint: '/contents/generations/tasks',
};

function baseCtx(): AdapterContext {
  return { apiKey: 'ak', baseUrl: 'https://ark.example.com/api/v3', timeoutMs: 10000 };
}

async function testExecutorContentTask(): Promise<void> {
  console.log('[4] video-executor content 风格 + task 轮询（Seedance 等价路径）');
  const { captured } = mockFetch([
    async () => ({ json: { id: 'task-1' } }),
    async () => ({ json: { status: 'succeeded', content: { video_url: 'https://cdn.example.com/result.mp4' } } }),
    async () => ({ json: {}, buffer: Buffer.from('VIDEO_BYTES') }),
  ]);

  const req: GenerateRequest = {
    kind: 'video',
    prompt: '海浪拍打礁石',
    model: 'doubao-seedance-2-0',
    params: {
      mode: 'reference', // adapter 内联翻译后的 task 值
      _uiMode: 'image-to-video-first-last-frame',
      resolution: '720p',
      duration: 5,
      referenceImages: ['https://cdn.example.com/first.png', 'https://cdn.example.com/last.png'],
    },
    template: CONTENT_TEMPLATE,
  };
  const result = await executeVideoByTemplate(req, baseCtx(), CONTENT_TEMPLATE);

  // 提交
  const submit = captured[0];
  assert(submit.url === 'https://ark.example.com/api/v3/contents/generations/tasks', '提交 URL = baseUrl + endpoint');
  assert(submit.headers['Authorization'] === 'Bearer ak', '提交带 Bearer 认证头');
  assert(submit.body.model === 'doubao-seedance-2-0', 'body.model');
  assert(submit.body.content[0].type === 'text' && submit.body.content[0].text === '海浪拍打礁石', 'content[0] = text');
  assert(
    submit.body.content[1].role === 'first_frame' && submit.body.content[1].image_url.url === 'https://cdn.example.com/first.png',
    '首尾帧模式第一张图 role=first_frame',
  );
  assert(submit.body.content[2].role === 'last_frame', '第二张图 role=last_frame');
  assert(submit.body.task === 'reference', 'mode→task 翻译写入 body.task');
  assert(submit.body.resolution === '720p', '其余参数平铺');
  assert(!('_uiMode' in submit.body), '_uiMode 不发送');
  assert(!('referenceImages' in submit.body), 'referenceImages 素材数组不发送');

  // 轮询
  const poll = captured[1];
  assert(poll.url === 'https://ark.example.com/api/v3/contents/generations/tasks/task-1', '轮询 URL = 模板 {id} 替换');

  // 下载
  assert(result.kind === 'video' && result.buffer?.toString() === 'VIDEO_BYTES', '结果下载为 video buffer');
}

async function testExecutorFlatSync(): Promise<void> {
  console.log('[5] video-executor flat 风格 + sync（OpenAI 兼容中转）');
  const { captured } = mockFetch([
    async () => ({ json: { data: [{ url: 'https://cdn.example.com/out.mp4' }] } }),
    async () => ({ json: {}, buffer: Buffer.from('FLAT_VIDEO') }),
  ]);

  const req: GenerateRequest = {
    kind: 'video',
    prompt: '城市夜景',
    model: 'my-relay-video',
    params: {
      size: '1024x1024',
      duration: 5,
      referenceImages: ['https://cdn.example.com/ref.png'],
    },
    template: {
      paramMapping: { size: 'size', duration: 'duration', referenceImages: 'image' },
      sync: { resultPath: 'data[0].url' },
      auth: { type: 'header', apiKeyHeader: 'X-Api-Key', alsoBearer: true },
      endpoint: '/v1/videos/generations',
    },
  };
  const result = await executeVideoByTemplate(req, baseCtx(), req.template);

  const submit = captured[0];
  assert(submit.url === 'https://ark.example.com/api/v3/v1/videos/generations', 'flat 提交 URL');
  assert(submit.headers['X-Api-Key'] === 'ak' && submit.headers['Authorization'] === 'Bearer ak', 'header+alsoBearer 认证头');
  assert(Array.isArray(submit.body.image) && submit.body.image[0] === 'https://cdn.example.com/ref.png', '参考图数组写入 image 字段');
  assert(submit.body.size === '1024x1024', 'size 平铺');
  assert(result.buffer?.toString() === 'FLAT_VIDEO', 'sync.resultPath 下载成功');
}

async function testExecutorOpenAiFallback(): Promise<void> {
  console.log('[6] video-executor 无 DSL → OpenAI 兼容兜底（b64_json）');
  const { captured } = mockFetch([async () => ({ json: { data: [{ b64_json: Buffer.from('B64_VIDEO').toString('base64') }] } })]);
  const result = await executeVideoByTemplate(
    { kind: 'video', prompt: 'x', model: 'gpt-video', params: {} },
    baseCtx(),
    undefined,
  );
  assert(captured[0].url === 'https://ark.example.com/api/v3/videos/generations', '兜底 URL = /videos/generations');
  assert(result.buffer?.toString() === 'B64_VIDEO', 'b64_json 直接解码（无需下载）');
}

async function testExecutorTaskFailed(): Promise<void> {
  console.log('[7] video-executor task 失败态');
  mockFetch([
    async () => ({ json: { id: 'task-fail' } }),
    async () => ({ json: { status: 'failed', error: '素材审核未通过' } }),
  ]);
  await assertThrowsAsync(
    () =>
      executeVideoByTemplate(
        { kind: 'video', prompt: 'x', model: 'm', params: {} },
        baseCtx(),
        CONTENT_TEMPLATE,
      ),
    '轮询到 failed 状态抛错',
    /视频生成失败/,
  );
}

async function testExecutorSsrProtection(): Promise<void> {
  console.log('[8] video-executor SSRF 防护');
  // 正常提交响应（供 pollUrlTemplate 用例走到轮询 URL 构建）
  mockFetch([async () => ({ json: { id: 'ssrf-task' } })]);
  await assertThrowsAsync(
    () =>
      executeVideoByTemplate(
        { kind: 'video', prompt: 'x', model: 'm', params: {} },
        baseCtx(),
        { ...CONTENT_TEMPLATE, endpoint: 'http://192.168.1.10/api' },
      ),
    '内网 endpoint 拒绝',
    /禁止访问内网/,
  );
  await assertThrowsAsync(
    () =>
      executeVideoByTemplate(
        { kind: 'video', prompt: 'x', model: 'm', params: {} },
        baseCtx(),
        { ...CONTENT_TEMPLATE, task: { ...CONTENT_TEMPLATE.task!, pollUrlTemplate: 'http://localhost/poll/{id}' } },
      ),
    '内网 pollUrlTemplate 拒绝',
    /禁止访问内网/,
  );
}

async function testExecutorKlingAuth(): Promise<void> {
  console.log('[9] video-executor kling-hmac 认证（Kling 官方直连）');
  const { captured } = mockFetch([
    async () => ({ json: { code: 1000, data: { task_id: 'k-task' } } }),
    async () => ({
      json: {
        code: 1000,
        data: { task_status: 'succeeded', task_result: { videos: [{ url: 'https://cdn.example.com/k.mp4' }] } },
      },
    }),
    async () => ({ json: {}, buffer: Buffer.from('KLING_VIDEO') }),
  ]);
  const result = await executeVideoByTemplate(
    {
      kind: 'video',
      prompt: 'x',
      model: 'kling-v3',
      params: { mode: 'image_to_video_first_last_frame', duration: 5 },
      template: {
        paramMapping: { mode: 'mode', duration: 'duration' },
        valueMapping: {
          mode: { image_to_video_first_last_frame: 'image_to_video_first_last_frame' },
        },
        task: {
          submitIdPath: 'data.task_id',
          pollUrlTemplate: '/api/v1/services/aigc/video-generation/video-synthesis/{id}',
          statusPath: 'data.task_status',
          successValues: ['succeeded'],
          failureValues: ['failed'],
          resultPath: 'data.task_result.videos[0].url',
          pollIntervalMs: 10,
          maxPollMs: 60000,
        },
        auth: { type: 'kling-hmac' },
        endpoint: '/api/v1/services/aigc/video-generation/video-synthesis',
      },
    },
    { ...baseCtx(), secretKey: 'sk' },
  );
  const jwt = captured[0].headers['Authorization'];
  assert(!!jwt && jwt.startsWith('Bearer ') && jwt.slice(7).split('.').length === 3, '提交带 Bearer JWT（三段+前缀）');
  assert(captured[1].url.endsWith('/k-task'), '轮询 URL 替换 data.task_id');
  assert(result.buffer?.toString() === 'KLING_VIDEO', 'Kling resultPath 下载成功');
}

async function testVolcengineModeTranslation(): Promise<void> {
  console.log('[10] VolcengineAdapter mode→task 内联翻译（video-edit）');
  const { captured } = mockFetch([
    async () => ({ json: { id: 'task-edit' } }),
    async () => ({ json: { status: 'succeeded', content: { video_url: 'https://cdn.example.com/edit.mp4' } } }),
    async () => ({ json: {}, buffer: Buffer.from('EDIT_VIDEO') }),
  ]);
  const adapter = new VolcengineAdapter();
  await adapter.generate(
    {
      kind: 'video',
      prompt: '把背景换成海边',
      model: 'doubao-seedance-2-0',
      params: {
        mode: 'video-edit',
        ratio: '16:9',
        duration: 5,
        referenceVideos: ['https://cdn.example.com/src.mp4'],
      },
      template: CONTENT_TEMPLATE,
    },
    baseCtx(),
  );
  const body = captured[0].body;
  assert(body.task === 'edit', 'mode=video-edit → task=edit');
  assert(body.ratio === 'adaptive', '编辑任务强制 ratio=adaptive');
  assert(body.duration === -1, '编辑任务强制 duration=-1');
  assert(body.content[1].role === 'reference_video', '参考视频 role=reference_video');
}

// ===== 异步断言辅助 =====

async function assertThrowsAsync(fn: () => Promise<unknown>, label: string, match?: RegExp): Promise<void> {
  try {
    await fn();
    failed++;
    console.error(`  ✗ ${label}（未抛错）`);
  } catch (err) {
    if (match && !match.test((err as Error).message)) {
      failed++;
      console.error(`  ✗ ${label}（错误信息不符: ${(err as Error).message}）`);
    } else {
      passed++;
    }
  }
}

// ===== 入口 =====

async function main(): Promise<void> {
  testResolvePath();
  testKlingSigner();
  testValidator();
  await testExecutorContentTask();
  await testExecutorFlatSync();
  await testExecutorOpenAiFallback();
  await testExecutorTaskFailed();
  await testExecutorSsrProtection();
  await testExecutorKlingAuth();
  await testVolcengineModeTranslation();

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
