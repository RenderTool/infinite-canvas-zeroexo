/**
 * production-tools - 出片生产台 Agent 工具（production_agent）
 *
 * 2026-08-31 新建：出片 Agent 是独立身份（面对出片工作台镜头，不操作画布）。
 * 质量门为纯规则引擎（零 LLM 成本、可回归），对齐 zerovideoAgent qc-checklist 十项。
 */
import type { Tool } from './tool-types';

export interface QualityGateInput {
  imagePrompt?: string;
  videoPrompt?: string;
  negativePrompt?: string;
  shotType?: string;
  hasReferenceImages?: boolean;
}

export interface QualityGateResult {
  score: number;
  passed: boolean;
  deductions: Array<{ item: number; name: string; reason: string }>;
  suggestions: string[];
}

/** 范畴式负面词检测词表（出现即扣分） */
const CATEGORY_NEGATIVE_WORDS = [
  '现代物件', '现代物品', '现代建筑', '不真实', '非真实', 'no modern', 'bad quality',
  'worst quality', 'low quality', 'ugly', 'deformed', 'extra', 'missing',
];

/** 形容词汤词表（抽象感受词，无法在生成结果上验证） */
const ABSTRACT_ADJECTIVES = [
  '漂亮', '美丽', '帅气', '炫酷', '震撼', '感人', '高级感', '有氛围', 'beautiful', 'gorgeous', 'cool', 'epic',
];

/**
 * 视频提示词质量门（10 分制，<7 分禁止输出）
 */
export function qualityGateTool(): Tool {
  return {
    name: 'quality_gate',
    description:
      '对视频提示词进行 10 分制质量评分，返回失分项与修复建议。' +
      '入参: { imagePrompt, videoPrompt, negativePrompt, shotType?, hasReferenceImages? }。' +
      'score < 7 时 passed=false，禁止直接用于生成，必须按 suggestions 修复后重评。',
    parameters: {
      type: 'object',
      properties: {
        imagePrompt: { type: 'string', description: '图片/首帧提示词' },
        videoPrompt: { type: 'string', description: '视频运动提示词' },
        negativePrompt: { type: 'string', description: '负面提示词' },
        shotType: { type: 'string', description: '景别(特写/中景/远景等)' },
        hasReferenceImages: { type: 'boolean', description: '是否携带参考图' },
      },
      required: [],
    },
    execute: async (input: QualityGateInput): Promise<QualityGateResult> => {
      const deductions: QualityGateResult['deductions'] = [];
      const suggestions: string[] = [];
      const text = `${input.imagePrompt ?? ''} ${input.videoPrompt ?? ''}`.toLowerCase();

      // 1. 可验证性：提示词是否可观察（含具体动作/构图/光线/场景词）
      if (!/[跑|走|站|坐|看|转身|抬手|推|拉|摇|移|跟|环绕|特写|中景|远景|室内|室外|光|夜|日]/.test(text)) {
        deductions.push({ item: 1, name: '可验证性', reason: '提示词缺少可观察的动作/构图/光线/场景描述，生成结果无法检查' });
        suggestions.push('补充具体动作与构图/光线描述，确保每句都可在生成结果上检查');
      }

      // 2. 负面词实例化：检测范畴式负面词
      if (input.negativePrompt) {
        const neg = input.negativePrompt.toLowerCase();
        const hit = CATEGORY_NEGATIVE_WORDS.find((w) => neg.includes(w));
        if (hit) {
          deductions.push({ item: 2, name: '负面词实例化', reason: `负面词含范畴式表达「${hit}」，应改为具体物件/现象实例` });
          suggestions.push('负面提示词只写实例（如"现代车辆""字幕"），删除范畴式抽象');
        }
      }

      // 3. 无形容词汤：检测抽象感受词
      const abstractHits = ABSTRACT_ADJECTIVES.filter((w) => text.includes(w));
      if (abstractHits.length > 0) {
        deductions.push({ item: 3, name: '无形容词汤', reason: `含抽象形容词 ${abstractHits.join('/')}，无法验证，应改写为可观察描述` });
        suggestions.push(`删除 "${abstractHits.join('、')}" 等抽象感受词，改为具体画面元素`);
      }

      // 4. 运动单一性：videoPrompt 主运镜数量
      if (input.videoPrompt) {
        const cameraMoves = (input.videoPrompt.match(/推|拉|摇|移|跟|环绕|升降|横移|俯拍|仰拍|旋转/g) ?? []).length;
        if (cameraMoves > 2) {
          deductions.push({ item: 4, name: '运动预算', reason: `videoPrompt 含 ${cameraMoves} 个运镜词，超单主运镜预算` });
          suggestions.push('每镜保留 1 个主运镜，其余运动并入主体动作或删除');
        }
      }

      // 5. 构图/光线明确：imagePrompt 是否含景别与光线
      if (input.imagePrompt) {
        if (!input.shotType && !/(特写|近景|中景|远景|全景)/.test(input.imagePrompt)) {
          deductions.push({ item: 5, name: '构图明确', reason: 'imagePrompt 未标注景别' });
          suggestions.push('在 imagePrompt 中标注景别（如 中景/特写）');
        }
        if (!/(光|夜|日|室内|室外|低光|柔和|逆光|侧光)/.test(input.imagePrompt)) {
          deductions.push({ item: 6, name: '光线明确', reason: 'imagePrompt 未标注光线方向/明暗' });
          suggestions.push('补充光线描述（如 侧逆光、黄昏暖光）');
        }
      }

      // 7. 参考图占位：有参考图时应含 @图片N 占位
      if (input.hasReferenceImages && !/@图片\d/.test(`${input.imagePrompt ?? ''} ${input.videoPrompt ?? ''}`)) {
        deductions.push({ item: 7, name: '参考图占位', reason: '携带参考图但提示词未含 @图片N 占位' });
        suggestions.push('在提示词中追加参考图占位（参考图: @图片1, @图片2 ...）');
      }

      // 8. 时长/画幅：videoPrompt 是否标注时长
      if (input.videoPrompt && !/(秒|duration|\d+s)/.test(input.videoPrompt)) {
        deductions.push({ item: 8, name: '时长标注', reason: 'videoPrompt 未标注时长' });
        suggestions.push('videoPrompt 标注时长（如 5秒时长）');
      }

      const score = Math.max(0, 10 - deductions.length);
      return {
        score,
        passed: score >= 7,
        deductions,
        suggestions,
      };
    },
  };
}
