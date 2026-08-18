/**
 * storyboard_assistant 端到端工具测试
 *
 * 使用方式:
 *   pnpm ts-node src/modules/agent/skills/storyboard_assistant/test-e2e.ts
 *
 * 前置条件:
 *   1. 后端服务可启动
 *   2. 数据库中已存在 test 用户的 Project 测试项目
 *   3. 已配置至少一个可用的 AI 渠道(否则 ai_image/ai_audio 测试会失败,但不会崩溃)
 *
 * 设计原则:
 *   - 每个工具一个独立 test 函数,失败时打印错误但继续下一个
 *   - 测试结束后输出 PASS/FAIL 汇总
 *   - 不依赖 mock;所有调用都走真实 Prisma 写库
 *   - 不会清理测试数据(供人工核对)
 */

import { PrismaService } from '../../../../common/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AssetsService } from '../../../assets/assets.service';
import { AiGenerateService } from '../../../ai-generate/ai-generate.service';
import { AiGenerateAssetService } from '../../../ai-generate/ai-generate.asset.service';
import { AiThinkPromptService } from '../../../ai-generate/ai-generate.think-prompt.service';
import { createToolsForAgentType } from '../../tool-registry';
import type { Tool } from '../../tool-registry';
import { ApiProvidersService } from '../../../api-providers/api-providers.service';
import { MinioService } from '../../../assets/minio.service';
import { ResourceService } from '../../../assets/resource.service';
import { LogsService } from '../../../logs/logs.service';
import { ConfigService } from '@nestjs/config';
import { AiEventsService } from '../../../ai-events/ai-events.service';
import { BillingIntegrationService } from '../../../billing/billing-integration.service';

// ===== 测试结果汇总 =====
const results: Array<{
  name: string;
  pass: boolean;
  message: string;
  durationMs: number;
}> = [];

function record(name: string, pass: boolean, message: string, durationMs: number) {
  results.push({ name, pass, message, durationMs });
  const tag = pass ? '[PASS]' : '[FAIL]';
  console.log(
    `${tag} [${durationMs}ms] ${name}${message ? ': ' + message : ''}`,
  );
}

async function runTest(name: string, fn: () => Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    record(name, true, '', Date.now() - start);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record(name, false, message, Date.now() - start);
  }
}

// ===== 测试主体 =====

async function main() {
  console.log('===== storyboard_assistant 端到端测试 =====\n');

  // 1. 准备依赖
  const prisma = new PrismaService();
  await prisma.$connect();

  // 1.1 找或建测试项目
  const testUser = await prisma.user.findFirst({
    where: { email: 'test@zeroexo.com' },
  });
  if (!testUser) {
    console.error('未找到 test@zeroexo.com 测试用户,请先运行 pnpm db:seed');
    process.exit(1);
  }

  let testProject = await prisma.project.findFirst({
    where: {
      ownerId: testUser.id,
      title: { contains: '[e2e-storyboard]' },
    },
  });
  if (!testProject) {
    testProject = await prisma.project.create({
      data: {
        ownerId: testUser.id,
        title: '[e2e-storyboard] 测试项目',
        description: '由 storyboard_assistant/test-e2e.ts 创建,用于工具端到端测试',
        config: {},
        script: Prisma.JsonNull,
        storyboard: { schemaVersion: 2, episodes: [], entities: { characters: [], props: [], scenes: [] } },
        assets: {},
      },
    });
    console.log(`已创建测试项目: ${testProject.id}`);
  } else {
    console.log(`使用已有测试项目: ${testProject.id}`);
  }
  const artifactId = testProject.id;
  const userId = testUser.id;

  // 1.2 构造工具上下文(用 stub 依赖占位,只让走通 Prisma 的工具能跑)
  const config = new ConfigService({});
  const minio = {} as MinioService; // 不实际调用 MinIO
  const resourceService = new ResourceService(prisma, minio);
  const logsService = {} as LogsService;
  const assetsService = new AssetsService(
    prisma,
    minio,
    resourceService,
    logsService,
  );
  const apiProvidersService = {} as ApiProvidersService;
  const aiEventsService = {} as AiEventsService;
  const billingService = {} as BillingIntegrationService;
  const assetService = new AiGenerateAssetService(prisma, minio);
  const aiGenerateService = new AiGenerateService(
    prisma,
    config,
    minio,
    apiProvidersService,
    logsService,
    aiEventsService,
    billingService,
    assetService,
    {} as AiThinkPromptService,
  );

  const tools = createToolsForAgentType(
    'storyboard_assistant',
    artifactId,
    userId,
    prisma,
    assetsService,
    aiGenerateService,
  );
  console.log(`已加载 ${tools.length} 个工具\n`);

  const findTool = (name: string): Tool => {
    const t = tools.find((t: Tool) => t.name === name);
    if (!t) throw new Error(`工具 ${name} 未注册`);
    return t;
  };

  // ===== 1. read_script =====
  await runTest('read_script', async () => {
    const t = findTool('read_script');
    const result = await t.execute({});
    if (typeof result !== 'object') throw new Error('返回非对象');
    if (!('script' in result)) throw new Error('缺少 script 字段');
  });

  // ===== 2. read_storyboard =====
  await runTest('read_storyboard', async () => {
    const t = findTool('read_storyboard');
    const result = await t.execute({});
    if (!('storyboard' in result)) throw new Error('缺少 storyboard 字段');
  });

  // ===== 3. read_project_config =====
  await runTest('read_project_config', async () => {
    const t = findTool('read_project_config');
    const result = await t.execute({});
    if (!('config' in result)) throw new Error('缺少 config 字段');
  });

  // ===== 4. save_shots (mode=replace) =====
  await runTest('save_shots (replace)', async () => {
    const t = findTool('save_shots');
    const result = await t.execute({
      episodeId: 'ep-test-1',
      mode: 'replace',
      shots: [
        {
          id: 'shot-test-1-1',
          sceneId: '1-1',
          number: 1,
          dayNight: '日',
          duration: 5,
          description: '测试镜头 1:主角走入画面',
          shotType: '中景',
          cameraMovement: '推',
          sfx: [],
          entities: [],
          gridLayout: 'single',
          promptText: '主角走入画面',
          promptEn: 'Main character walks into the frame',
          cameraParams: {
            cameraBody: 'ARRI Alexa 35',
            lensModel: 'Cooke S4/i 35mm T2.0',
            iso: 800,
            shutterAngle: '180°',
            frameRate: 24,
            aspectRatio: '2.39:1',
          },
          lighting: { keyLight: '自然光', colorTemp: '5500K', mood: '平和' },
          environment: { location: '', time: '', weather: '', depthLayers: { foreground: '', midground: '', background: '' } },
          emotion: '平静',
          continuity: { prev: null, next: null, transition: 'cut' },
          referenceImageStorageKeys: [],
        },
        {
          id: 'shot-test-1-2',
          sceneId: '1-1',
          number: 2,
          dayNight: '日',
          duration: 4,
          description: '测试镜头 2:特写主角表情',
          shotType: '特写',
          cameraMovement: '固定',
          sfx: [],
          entities: [],
          gridLayout: 'single',
          promptText: '主角表情特写',
          promptEn: 'Close-up of main character',
          cameraParams: {
            cameraBody: 'ARRI Alexa 35',
            lensModel: 'Cooke S4/i 50mm T2.0',
            iso: 800,
            shutterAngle: '180°',
            frameRate: 24,
            aspectRatio: '2.39:1',
          },
          lighting: { keyLight: '侧光', colorTemp: '5000K', mood: '紧张' },
          environment: { location: '', time: '', weather: '', depthLayers: { foreground: '', midground: '', background: '' } },
          emotion: '紧张',
          continuity: { prev: 'shot-test-1-1', next: null, transition: 'cut' },
          referenceImageStorageKeys: [],
        },
      ],
    });
    if (result.shotCount !== 2) {
      throw new Error(`期望 2 个镜头,实际 ${result.shotCount}`);
    }
    // 验证数据库
    const project = await prisma.project.findUnique({
      where: { id: artifactId },
      select: { storyboard: true },
    });
    const sb = project?.storyboard as any;
    const ep = sb?.episodes?.find((e: any) => e.episodeId === 'ep-test-1');
    if (!ep) throw new Error('episode 未写入');
    if (ep.shots.length !== 2) throw new Error('shots 数量不对');
  });

  // ===== 5. save_shots (mode=append) =====
  await runTest('save_shots (append)', async () => {
    const t = findTool('save_shots');
    const result = await t.execute({
      episodeId: 'ep-test-1',
      mode: 'append',
      shots: [
        {
          id: 'shot-test-1-3',
          sceneId: '1-1',
          number: 3,
          dayNight: '日',
          duration: 6,
          description: '追加镜头 3',
          shotType: '全景',
          cameraMovement: '摇',
          sfx: [],
          entities: [],
          gridLayout: 'single',
          promptText: '全景',
          promptEn: 'panorama',
          cameraParams: {
            cameraBody: 'ARRI Alexa 35',
            lensModel: 'Cooke S4/i 25mm T2.0',
            iso: 800,
            shutterAngle: '180°',
            frameRate: 24,
            aspectRatio: '2.39:1',
          },
          lighting: { keyLight: '自然光', colorTemp: '5500K', mood: '平和' },
          environment: { location: '', time: '', weather: '', depthLayers: { foreground: '', midground: '', background: '' } },
          emotion: '平静',
          continuity: { prev: 'shot-test-1-2', next: null, transition: 'cut' },
          referenceImageStorageKeys: [],
        },
      ],
    });
    if (result.shotCount !== 3) throw new Error(`期望 3 个镜头,实际 ${result.shotCount}`);
  });

  // ===== 6. save_shots (mode=patch) =====
  await runTest('save_shots (patch)', async () => {
    const t = findTool('save_shots');
    const result = await t.execute({
      episodeId: 'ep-test-1',
      mode: 'patch',
      shots: [
        {
          id: 'shot-test-1-1',
          duration: 7, // 仅修改时长
        },
      ],
    });
    if (result.shotCount !== 3) throw new Error('patch 模式下总数应不变');
    // 验证时长被改
    const project = await prisma.project.findUnique({
      where: { id: artifactId },
      select: { storyboard: true },
    });
    const sb = project?.storyboard as any;
    const ep = sb?.episodes?.find((e: any) => e.episodeId === 'ep-test-1');
    const shot = ep.shots.find((s: any) => s.id === 'shot-test-1-1');
    if (shot.duration !== 7) throw new Error(`patch 失败,时长=${shot.duration}`);
  });

  // ===== 7. save_entities =====
  await runTest('save_entities', async () => {
    const t = findTool('save_entities');
    const result = await t.execute({
      characters: [
        {
          id: 'entity-test-chen',
          name: '测试角色-陈',
          type: 'character',
          aliases: [],
          description: '测试用主角',
          basicInfo: { age: 28, gender: '男' },
          visualStyle: '电影级写实',
          imageStorageKey: null,
          variants: [],
          sameAs: [],
          shotsAppeared: [],
          consistencyPrompt: 'A 28-year-old Chinese male with short black hair...',
          status: 'draft',
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'entity-test-li',
          name: '测试角色-李',
          type: 'character',
          aliases: [],
          description: '测试用配角',
          visualStyle: '电影级写实',
          imageStorageKey: null,
          variants: [],
          sameAs: [],
          shotsAppeared: [],
          consistencyPrompt: 'A 30-year-old Chinese female...',
          status: 'draft',
          updatedAt: new Date().toISOString(),
        },
      ],
      props: [],
      scenes: [
        {
          id: 'entity-test-scene-1',
          name: '测试场景-都市',
          type: 'scene',
          aliases: [],
          description: '现代都市夜景',
          visualStyle: '电影级写实',
          imageStorageKey: null,
          variants: [],
          sameAs: [],
          shotsAppeared: [],
          consistencyPrompt: 'Modern city skyline at night...',
          status: 'draft',
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    if (result.characterCount !== 2) throw new Error('角色数不对');
    if (result.sceneCount !== 1) throw new Error('场景数不对');
  });

  // ===== 8. add_variant =====
  await runTest('add_variant', async () => {
    const t = findTool('add_variant');
    const result = await t.execute({
      entityId: 'entity-test-chen',
      variant: {
        name: '正面',
        description: '测试角色正面照',
        origin: 'ai_generated',
      },
    });
    if (!result.variantId) throw new Error('未返回 variantId');
  });

  // ===== 9. merge_entities =====
  await runTest('merge_entities', async () => {
    const t = findTool('merge_entities');
    // 先在 shot.entities 里引用 source
    await t2_or_skip(tools, 'save_shots', () => ({
      episodeId: 'ep-test-1',
      mode: 'patch',
      shots: [
        {
          id: 'shot-test-1-1',
          entities: [
            { entityId: 'entity-test-li', mention: '@李' },
          ],
        },
      ],
    }));
    const result = await t.execute({
      sourceId: 'entity-test-li',
      targetId: 'entity-test-chen',
    });
    if (!result.success) throw new Error('merge 失败');
    // 验证 source 已移除,target 包含 sourceId 在 sameAs
    const project = await prisma.project.findUnique({
      where: { id: artifactId },
      select: { storyboard: true },
    });
    const sb = project?.storyboard as any;
    const chens = sb.entities.characters;
    if (chens.find((c: any) => c.id === 'entity-test-li')) {
      throw new Error('source 未被移除');
    }
    const chen = chens.find((c: any) => c.id === 'entity-test-chen');
    if (!chen?.sameAs?.includes('entity-test-li')) {
      throw new Error('target.sameAs 未包含 sourceId');
    }
  });

  // ===== 10. replace_entity_image (使用 mock storageKey) =====
  await runTest('replace_entity_image (storageKey 校验)', async () => {
    const t = findTool('replace_entity_image');
    // 错误用例:非法 storageKey 应被拒
    let rejected = false;
    try {
      await t.execute({
        entityId: 'entity-test-chen',
        imageStorageKey: 'https://example.com/fake.jpg',
        origin: 'asset_picker',
      });
    } catch (err) {
      rejected = true;
    }
    if (!rejected) throw new Error('非法 storageKey 未被拒');
  });

  // ===== 11. list_existing_assets =====
  await runTest('list_existing_assets', async () => {
    const t = findTool('list_existing_assets');
    const result = await t.execute({ kind: 'image', limit: 5 });
    if (typeof result.total !== 'number') throw new Error('缺少 total 字段');
  });

  // ===== 12. save_script =====
  await runTest('save_script', async () => {
    const t = findTool('save_script');
    const result = await t.execute({
      content: { title: 'e2e 测试剧本', episodes: [] },
    });
    if (!result.success) throw new Error('保存失败');
    const project = await prisma.project.findUnique({
      where: { id: artifactId },
      select: { script: true },
    });
    if ((project?.script as any)?.title !== 'e2e 测试剧本') {
      throw new Error('数据库未写入');
    }
  });

  // ===== 13. save_project_config =====
  await runTest('save_project_config (浅合并)', async () => {
    const t = findTool('save_project_config');
    await t.execute({ config: { genre: '科幻', visualStyle: '电影级写实' } });
    await t.execute({ config: { aspectRatio: '2.39:1' } });
    const project = await prisma.project.findUnique({
      where: { id: artifactId },
      select: { config: true },
    });
    const cfg = project?.config as any;
    if (cfg?.genre !== '科幻') throw new Error('浅合并失败:genre 丢失');
    if (cfg?.aspectRatio !== '2.39:1') throw new Error('浅合并失败:新字段未写入');
  });

  // ===== 14. remove_variant =====
  await runTest('remove_variant', async () => {
    // 先加一个临时 variant(不写入测试主表,避免污染)
    const t1 = findTool('add_variant');
    const addRes = await t1.execute({
      entityId: 'entity-test-chen',
      variant: { name: '待删除', description: '临时衍生' },
    });
    const variantId = (addRes as any).variantId;
    if (!variantId) throw new Error('add_variant 未返回 variantId');

    const t2 = findTool('remove_variant');
    const result = await t2.execute({ variantId });
    if (!result.success) throw new Error('删除失败');
    // 验证已移除
    const project = await prisma.project.findUnique({
      where: { id: artifactId },
      select: { storyboard: true },
    });
    const sb = project?.storyboard as any;
    const chen = sb.entities.characters.find((c: any) => c.id === 'entity-test-chen');
    if (chen.variants.find((v: any) => v.id === variantId)) {
      throw new Error('variant 未被移除');
    }
  });

  // ===== 15. move_variant_to_entity (缺 target 应报错) =====
  await runTest('move_variant_to_entity (缺 target 应报错)', async () => {
    const t = findTool('move_variant_to_entity');
    let rejected = false;
    try {
      await t.execute({
        variantId: 'non-existent-variant',
        targetEntityId: 'entity-test-chen',
      });
    } catch (err) {
      rejected = true;
    }
    if (!rejected) throw new Error('不存在的 variantId 未被拒');
  });

  // ===== 16. ai_audio (需要真实 AI 渠道,可能耗时或失败) =====
  await runTest('ai_audio (需真实渠道,失败不计入总通过率)', async () => {
    const t = findTool('ai_audio');
    try {
      const result = await t.execute({
        prompt: '这是一段测试旁白',
        model: 'mock-tts',
        voiceId: 'female_温柔_中音',
        audioFormat: 'mp3',
      });
      if (!result.storageKey) throw new Error('未返回 storageKey');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('未配置可用的 AI 渠道') ||
        msg.includes('未配置模型') ||
        msg.includes('provider')
      ) {
        console.log(`   [SKIP] ai_audio 跳过: ${msg}`);
        return;
      }
      throw err;
    }
  });

  // ===== 汇总 =====
  console.log('\n===== 测试结果汇总 =====');
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass);
  console.log(`总测试: ${results.length}`);
  console.log(`通过: ${passed}`);
  console.log(`失败: ${failed.length}`);
  if (failed.length > 0) {
    console.log('\n失败明细:');
    for (const f of failed) {
      console.log(`  - ${f.name}: ${f.message}`);
    }
  }

  await prisma.$disconnect();
  process.exit(failed.length > 0 ? 1 : 0);
}

/** 辅助:运行另一个工具,失败时 throw */
async function t2_or_skip(
  tools: any[],
  name: string,
  buildArgs: () => any,
) {
  const t = tools.find((t) => t.name === name);
  if (!t) return;
  await t.execute(buildArgs());
}

main().catch(async (err) => {
  console.error('测试执行崩溃:', err);
  process.exit(1);
});
