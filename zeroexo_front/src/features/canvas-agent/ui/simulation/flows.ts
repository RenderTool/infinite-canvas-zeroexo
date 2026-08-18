/**
 * simulation/flows.ts — 模拟后端 Agent 的 skill 编排流程
 *
 * 基于真实后端 skills 目录结构：
 *   canvas_agent / script_writer / storyboard_breaker /
 *   entity_extractor / cinematographer / genre_analyzer / analyze
 *
 * 每个流程定义：
 *   - 识别条件（intentMatcher）
 *   - 执行步骤列表（step 数组）
 *   - 每一步模拟一个 SSE 事件序列
 */

import type { ClarifyItem, PlanData } from '../types.js';

// ===== 步骤定义 =====

export interface SimStep {
  /** 步骤名称（显示在步骤胶囊中） */
  label: string;
  /** 后端 skill 名称 */
  skillName: string;
  /** 模拟耗时 ms */
  dur: number;
  /** 打字机文本内容 */
  thinkText: string;
  /** 工具调用参数 */
  toolCall?: { args: Record<string, unknown> };
  /** 是否在步骤中产生 clarify_request */
  clarify?: ClarifyItem[];
  /** 是否在步骤中产生 plan */
  plan?: PlanData;
  /** 进度百分比（0-100） */
  progress?: number;
  /** 进度阶段文案 */
  progressLabel?: string;
  /** 结果文本 */
  result?: string;
  /** canvas_patch 操作描述 */
  canvasOp?: string;
}

// ===== 流程定义 =====

export interface SimFlow {
  id: string;
  label: string;
  /** 匹配用户输入的正则 */
  intentMatcher: RegExp;
  /** 执行步骤 */
  steps: SimStep[];
  /** 最终结果文本 */
  finalResult: string;
}

// ===== 15秒 TVC 广告流程 =====

export const tvcAdFlow: SimFlow = {
  id: 'tvc-15s',
  label: '15秒TVC广告',
  intentMatcher: /(15s|15秒|tvc|广告|宣传片|TVC)/i,

  /** 步骤序列：严格遵循后端 CanvasOrchestrator 编排 */
  steps: [
    // ── Phase 1: 意图理解（CanvasOrchestrator） ──
    {
      label: '分析需求',
      skillName: 'canvas_agent',
      dur: 1200,
      thinkText:
        '分析需求：用户需要生成一段 15 秒的 TVC 广告。\n\n' +
        '正在解析需求类型：产品广告，目标受众为年轻消费群体。\n' +
        '正在检测画布状态：当前画布为空，需要从零开始创建。',
      toolCall: { args: { taskType: 'script', intent: '15s_tvc_ad' } },
    },
    {
      label: '风格分析',
      skillName: 'genre_analyzer',
      dur: 800,
      thinkText: '正在分析视觉风格偏好：赛博朋克、科技简约、温暖治愈、国风…',
    },

    // ── Phase 2: 澄清需求 ──
    {
      label: '补充需求信息',
      skillName: 'canvas_agent',
      dur: 300,
      thinkText: '需求信息不足，需要用户补充以下信息…',
      clarify: [
        {
          itemId: 'ad_type',
          question: '广告类型？',
          kind: 'single',
          required: true,
          options: [
            { value: 'product', label: '产品广告', desc: '突出产品功能与卖点' },
            { value: 'brand', label: '品牌广告', desc: '传递品牌理念与调性' },
            { value: 'promo', label: '促销广告', desc: '限时优惠与活动推广' },
          ],
          aiHint: '自然语言中提取不到明确广告类型，推荐单选',
        },
        {
          itemId: 'style',
          question: '视觉风格倾向？',
          kind: 'single',
          required: true,
          options: [
            { value: 'cyberpunk', label: '赛博朋克', desc: '霓虹灯光、科技感、都市夜景' },
            { value: 'warm', label: '温暖治愈', desc: '柔和色调、生活化场景、情感共鸣' },
            { value: 'tech', label: '科技简约', desc: '冷色调、极简构图、产品特写' },
            { value: 'chinese', label: '国风', desc: '水墨意境、传统元素、东方美学' },
          ],
          aiHint: '根据用户输入"TVC"推测，品牌广告为主流选择',
        },
        {
          itemId: 'assets',
          question: '需要生成哪些资产？',
          kind: 'multi',
          required: false,
          options: [
            { value: 'characters', label: '角色设定图' },
            { value: 'scenes', label: '场景图' },
            { value: 'voiceover', label: '配音' },
            { value: 'bgm', label: '背景音乐' },
          ],
          aiHint: 'TVC 广告通常需要角色 + 场景 + 配音',
        },
        {
          itemId: 'product_focus',
          question: '产品核心卖点？',
          kind: 'text',
          required: false,
          aiHint: '开放输入，用户可自由描述产品卖点',
        },
      ],
    },

    // ── Phase 3: 剧本生成（script_writer） ──
    {
      label: '生成剧本',
      skillName: 'script_writer',
      dur: 2500,
      thinkText:
        '正在生成 15 秒 TVC 广告剧本…\n\n' +
        '采用三幕式结构：\n' +
        '  场景 1（5s）：开篇建立情境，吸引注意力\n' +
        '  场景 2（6s）：展示产品核心功能与使用场景\n' +
        '  场景 3（4s）：品牌露出 + 行动号召',
      toolCall: {
        args: {
          advertisementType: 'product',
          duration: 15,
          structure: 'three-act',
          audience: 'young-adults',
        },
      },
      progress: 15,
      progressLabel: '剧本生成中…',
    },
    {
      label: '优化剧本格式',
      skillName: 'script_format',
      dur: 600,
      thinkText: '正在格式化剧本为标准影视格式…',
      progress: 25,
      progressLabel: '格式化剧本…',
    },

    // ── Phase 4: 分镜拆解（storyboard_breaker） ──
    {
      label: '拆解分镜',
      skillName: 'storyboard_breaker',
      dur: 2000,
      thinkText:
        '正在拆解分镜：将剧本转化为 3 个镜头组…\n\n' +
        '  镜头 1（5s）：全景建立场景 → 中景引入产品\n' +
        '  镜头 2（6s）：特写展示产品细节 → 中景使用场景\n' +
        '  镜头 3（4s）：品牌 Logo 出场 → 行动号召文案',
      toolCall: { args: { scriptId: 'tmp_script_1', totalShots: 3 } },
      progress: 40,
      progressLabel: '分镜拆解中…',
    },

    // ── Phase 5: 实体提取（entity_extractor） ──
    {
      label: '提取实体',
      skillName: 'entity_extractor',
      dur: 1500,
      thinkText:
        '正在提取剧本中的实体信息…\n\n' +
        '  角色：目标用户（年轻人/商务人士）\n' +
        '  场景：都市/室内/产品展示台\n' +
        '  道具：产品本身、使用场景道具',
      toolCall: { args: { sources: ['tmp_script_1'] } },
      progress: 55,
      progressLabel: '实体提取中…',
    },

    // ── Phase 6: 运镜规划（cinematographer） ──
    {
      label: '规划运镜',
      skillName: 'cinematographer',
      dur: 1000,
      thinkText:
        '正在规划镜头运动方案…\n\n' +
        '  镜头 1：推轨（dolly in）从全景到中景\n' +
        '  镜头 2：环绕（orbit）突出产品质感\n' +
        '  镜头 3：上摇（tilt up）配合 Logo 出现',
      progress: 70,
      progressLabel: '运镜规划中…',
    },

    // ── Phase 7: 生成计划 + 确认 ──
    {
      label: '生成执行计划',
      skillName: 'canvas_agent',
      dur: 500,
      thinkText: '正在汇总所有步骤，生成执行计划…',
      plan: {
        steps: [
          { skillName: 'script_writer', label: '创建剧本节点', affectedNodes: ['tmp_script_1'], estimatedCost: 0.02, riskLevel: 'low' },
          { skillName: 'storyboard_breaker', label: '创建分镜节点（3 镜头）', affectedNodes: ['tmp_script_1'], estimatedCost: 0.04, riskLevel: 'low' },
          { skillName: 'entity_extractor', label: '创建实体卡片（角色/场景/道具）', affectedNodes: ['tmp_script_1'], estimatedCost: 0.02, riskLevel: 'low' },
          { skillName: 'media_generate', label: '生成 3 个镜头的关键帧', affectedNodes: ['tmp_storyboard_1'], estimatedCost: 0.15, riskLevel: 'medium' },
          { skillName: 'media_generate', label: '生成配音 + 背景音乐', affectedNodes: ['tmp_script_1'], estimatedCost: 0.08, riskLevel: 'medium' },
          { skillName: 'canvas_layout', label: '智能排版所有节点', affectedNodes: ['tmp_script_1', 'tmp_storyboard_1', 'tmp_entities_1'], estimatedCost: 0.01, riskLevel: 'low' },
        ],
        totalCost: 0.32,
        riskLevel: 'medium',
        hasHighRiskOps: false,
      },
    },

    // ── Phase 8: 执行阶段（模拟确认后执行） ──
    {
      label: '创建剧本节点',
      skillName: 'script_writer',
      dur: 800,
      thinkText: '正在画布上创建剧本节点…',
      canvasOp: 'add_node(script) → 写入剧本内容',
      progress: 80,
      progressLabel: '创建剧本节点…',
    },
    {
      label: '创建分镜表',
      skillName: 'storyboard_breaker',
      dur: 1000,
      thinkText: '正在创建分镜表节点，包含 3 个镜头组…',
      canvasOp: 'add_node(storyboard) → 写入 3 组分镜',
      progress: 85,
      progressLabel: '创建分镜表…',
    },
    {
      label: '创建实体卡片',
      skillName: 'entity_extractor',
      dur: 600,
      thinkText: '正在创建实体卡片节点：角色、场景、道具…',
      canvasOp: 'add_node(text) × 3 → 角色/场景/道具卡片',
      progress: 90,
      progressLabel: '创建实体卡片…',
    },
    {
      label: '规划媒体生成',
      skillName: 'cinematographer',
      dur: 500,
      thinkText: '正在规划媒体生成参数：模型选择、尺寸、数量…',
      canvasOp: 'add_node(generator) × 3 → 镜头关键帧',
      progress: 95,
      progressLabel: '规划媒体生成…',
    },
    {
      label: '智能排版',
      skillName: 'canvas_agent',
      dur: 400,
      thinkText: '正在执行智能排版，按场景分组排列…',
      canvasOp: 'layout() → 按场景分组排列',
      progress: 100,
      progressLabel: '排版完成',
    },
  ],

  finalResult:
    '已完成 15 秒 TVC 广告制作流程。\n\n' +
    '在画布上创建了以下节点：\n' +
    '  - 剧本节点 × 1（3 场景，15 秒）\n' +
    '  - 分镜表节点 × 1（3 镜头组）\n' +
    '  - 实体卡片节点 × 3（角色、场景、道具）\n' +
    '  - 生成器节点 × 3（镜头关键帧）\n' +
    '  - 生成器节点 × 2（配音、BGM）\n\n' +
    '预估消耗：¥0.32\n' +
    '已按场景分组排列，完成智能排版。',
};

// ===== 流程注册表 =====

export const ALL_FLOWS: SimFlow[] = [tvcAdFlow];

/** 根据用户输入匹配流程 */
export function matchFlow(input: string): SimFlow | null {
  for (const flow of ALL_FLOWS) {
    if (flow.intentMatcher.test(input)) return flow;
  }
  return null;
}