/**
 * production-tools.spec - 出片 Agent 质量门测试用例（2026-08-31）
 *
 * 可运行: npx ts-node src/modules/agent/tools/production-tools.spec.ts
 * 覆盖：高分通过 / 低分拦截 / 参考图占位缺失扣分 / 运镜超预算扣分。
 */
import { strict as assert } from 'node:assert';
import { qualityGateTool } from './production-tools';

const tool = qualityGateTool();
let passed = 0;

async function t(name: string, fn: () => Promise<void>): Promise<void> {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function main(): Promise<void> {
  console.log('== quality_gate (production_agent 质量门) ==');

  await t('高分通过：可观察描述 + 实例负面 + 参考图占位', async () => {
    const r = (await tool.execute({
      imagePrompt: '红发女侠中景, 侧逆光, 雨夜街巷, 持伞',
      videoPrompt: '镜头跟随她缓行, 5秒时长',
      negativePrompt: '现代车辆, 字幕',
      shotType: '中景',
      hasReferenceImages: true,
    })) as { score: number; passed: boolean };
    assert.ok(r.score >= 7 && r.passed);
  });

  await t('低分拦截：形容词汤 + 范畴式负面词', async () => {
    const r = (await tool.execute({
      imagePrompt: '美丽漂亮的场景',
      negativePrompt: 'no modern objects',
    })) as { score: number; passed: boolean; deductions: unknown[]; suggestions: unknown[] };
    assert.ok(r.score < 7 && !r.passed);
    assert.ok(r.deductions.length > 0);
    assert.ok(r.suggestions.length > 0);
  });

  await t('有参考图但无 @图片N 占位 → 扣分', async () => {
    const r = (await tool.execute({
      imagePrompt: '中景, 侧逆光, 室内',
      videoPrompt: '镜头推近, 5秒时长',
      shotType: '中景',
      hasReferenceImages: true,
    })) as { deductions: Array<{ item: number }> };
    assert.ok(r.deductions.some((d) => d.item === 7));
  });

  await t('运镜超预算（>2 个运镜词）→ 扣分', async () => {
    const r = (await tool.execute({
      imagePrompt: '中景, 侧逆光, 室内',
      videoPrompt: '推拉摇移跟全上, 5秒时长',
      shotType: '中景',
    })) as { deductions: Array<{ item: number }> };
    assert.ok(r.deductions.some((d) => d.item === 4));
  });

  console.log(`\n✅ ${passed} 项全部通过`);
}

void main();
