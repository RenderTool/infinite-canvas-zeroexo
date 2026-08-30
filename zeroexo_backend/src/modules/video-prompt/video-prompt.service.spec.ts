/**
 * video-prompt.service.spec - 视频提示词生成测试用例（zerovideoAgent 化，2026-08-31）
 *
 * 可运行: npx ts-node src/modules/video-prompt/video-prompt.service.spec.ts
 * 覆盖：主体锚点句逐字复用 / 状态细分映射 / 参考图 @图片N 占位 / 画幅比映射 / 批量。
 */
import { strict as assert } from 'node:assert';
import { VideoPromptService } from './video-prompt.service';
import type { ShotInputDto } from './dto/generate-video-prompt.dto';

const service = new VideoPromptService();
let passed = 0;

function t(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const shot = (over: Partial<ShotInputDto> = {}): ShotInputDto => ({
  description: '三娘在雨夜中持伞缓行',
  shotType: '中景',
  cameraMovement: '跟随',
  dialogue: '',
  emotion: '冷静',
  duration: 5,
  ...over,
});

function main(): void {
  console.log('== VideoPromptService (zerovideoAgent 化) ==');

  t('锚点句优先于 description（逐字复用）', () => {
    const r = service.generateVideoPrompt(shot({
      entities: [{ name: '三娘', kind: 'character', description: '路人', anchorSentence: '红发女侠，青衫染血，左眼下有泪痣' }],
    }));
    assert.ok(r.imagePrompt.includes('红发女侠，青衫染血，左眼下有泪痣'));
    assert.ok(!r.imagePrompt.includes('路人'));
  });

  t('主体状态细分映射 (stateName → 状态形态)', () => {
    const r = service.generateVideoPrompt(shot({
      entities: [{ name: '三娘', kind: 'character', description: '女侠', anchorSentence: '红发女侠', stateName: '重伤' }],
    }));
    assert.ok(r.imagePrompt.includes('红发女侠(重伤状态)'));
  });

  t('参考图自动 @图片N 占位（顺序对应 referenceKeys）', () => {
    const r = service.generateVideoPrompt(shot({
      entities: [{ name: '三娘', kind: 'character', description: '女侠' }],
      referenceKeys: ['k1', 'k2'],
    }));
    assert.ok(r.imagePrompt.includes('参考图: @图片1, @图片2'));
    assert.ok(r.videoPrompt.includes('参考图: @图片1, @图片2'));
  });

  t('无参考图时不产生占位', () => {
    const r = service.generateVideoPrompt(shot());
    assert.ok(!r.imagePrompt.includes('参考图'));
  });

  t('无锚点句回落 description', () => {
    const r = service.generateVideoPrompt(shot({
      entities: [{ name: '三娘', kind: 'character', description: '持伞女侠' }],
    }));
    assert.ok(r.imagePrompt.includes('持伞女侠'));
  });

  t('负面词非空 + 画幅比按景别映射（特写→1:1）', () => {
    const r = service.generateVideoPrompt(shot({ shotType: '特写' }));
    assert.ok(r.negativePrompt.length > 0);
    assert.equal(r.aspectRatio, '1:1');
  });

  t('批量生成数量一致', () => {
    const rs = service.generateVideoPromptBatch([shot(), shot()]);
    assert.equal(rs.length, 2);
    assert.ok(rs[0].videoPrompt.includes('5秒时长'));
  });

  t('复合景别落幅映射画幅比（全景→特写→1:1）', () => {
    const r = service.generateVideoPrompt(shot({ shotType: '全景→特写' }));
    assert.equal(r.aspectRatio, '1:1');
  });

  console.log(`\n✅ ${passed} 项全部通过`);
}

main();
