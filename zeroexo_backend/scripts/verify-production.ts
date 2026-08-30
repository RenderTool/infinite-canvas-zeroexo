/**
 * verify-production - 端到端验证脚本（临时，用后即删）
 *
 * 验证：视频提示词 zerovideoAgent 化（锚点句/状态/@图片N 占位）+ 出片 Agent 质量门。
 * 运行: npx ts-node scripts/verify-production.ts
 */
import { VideoPromptService } from '../src/modules/video-prompt/video-prompt.service';
import { qualityGateTool } from '../src/modules/agent/tools/production-tools';
import type { ShotInputDto } from '../src/modules/video-prompt/dto/generate-video-prompt.dto';

let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (cond) {
    console.log(`  ✓ ${msg}`);
  } else {
    failed += 1;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

async function main(): Promise<void> {
  console.log('== 视频提示词生成（zerovideoAgent 化）==');
  const service = new VideoPromptService();
  const shot = (over: Partial<ShotInputDto> = {}): ShotInputDto => ({
    description: '三娘在雨夜中持伞缓行',
    shotType: '中景',
    cameraMovement: '跟随',
    dialogue: '',
    emotion: '冷静',
    duration: 5,
    ...over,
  });

  // 1. 锚点句优先（逐字复用）
  const r1 = service.generateVideoPrompt(shot({
    entities: [{ name: '三娘', kind: 'character', description: '路人', anchorSentence: '红发女侠，青衫染血，左眼下有泪痣' }],
  }));
  assert(r1.imagePrompt.includes('红发女侠，青衫染血，左眼下有泪痣'), '锚点句逐字复用');
  assert(!r1.imagePrompt.includes('路人'), '锚点句存在时不回落 description');
  console.log(`  imagePrompt: ${r1.imagePrompt}\n`);

  // 2. 主体状态细分映射
  const r2 = service.generateVideoPrompt(shot({
    entities: [{ name: '三娘', kind: 'character', description: '女侠', anchorSentence: '红发女侠', stateName: '重伤' }],
  }));
  assert(r2.imagePrompt.includes('红发女侠(重伤状态)'), '状态细分映射 (stateName → 状态形态)');
  console.log(`  imagePrompt: ${r2.imagePrompt}\n`);

  // 3. 参考图 @图片N 占位
  const r3 = service.generateVideoPrompt(shot({
    entities: [{ name: '三娘', kind: 'character', description: '女侠' }],
    referenceKeys: ['k1', 'k2'],
  }));
  assert(r3.imagePrompt.includes('参考图: @图片1, @图片2'), 'imagePrompt 参考图占位');
  assert(r3.videoPrompt.includes('参考图: @图片1, @图片2'), 'videoPrompt 参考图占位');
  console.log(`  videoPrompt: ${r3.videoPrompt}\n`);

  // 4. 无参考图不占位
  const r4 = service.generateVideoPrompt(shot());
  assert(!r4.imagePrompt.includes('参考图'), '无参考图时不产生占位');
  assert(r4.aspectRatio === '16:9', `画幅比映射(中景→16:9, 实际 ${r4.aspectRatio})`);

  console.log('\n== 出片 Agent 质量门（quality_gate）==');
  const tool = qualityGateTool();

  const g1 = await tool.execute({
    imagePrompt: '红发女侠中景, 侧逆光, 雨夜街巷, 持伞',
    videoPrompt: '镜头跟随她缓行, 5秒时长',
    negativePrompt: '现代车辆, 字幕',
    shotType: '中景',
    hasReferenceImages: true,
  });
  assert(g1.passed && g1.score >= 7, `高分通过 (${g1.score}/10)`);

  const g2 = await tool.execute({
    imagePrompt: '美丽漂亮的场景',
    negativePrompt: 'no modern objects',
  });
  assert(!g2.passed && g2.score < 7, `低分拦截 (${g2.score}/10), deductions=${g2.deductions.length}`);

  const g3 = (await tool.execute({
    imagePrompt: '中景, 侧逆光, 室内',
    videoPrompt: '镜头推近, 5秒时长',
    shotType: '中景',
    hasReferenceImages: true,
  })) as { deductions: Array<{ item: number }> };
  assert(g3.deductions.some((d) => d.item === 7), '有参考图缺 @图片N 占位 → 扣分');

  console.log(`\n${failed === 0 ? '✅ 全部通过' : `❌ ${failed} 项失败`}`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
