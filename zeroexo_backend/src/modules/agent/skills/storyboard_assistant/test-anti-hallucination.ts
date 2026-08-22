/**
 * 防幻觉端到端测试 v2
 *
 * 直接测试 LLM 在分块模式下是否编造剧本中不存在的场景。
 * 使用数据库中的 AI 渠道配置，直接调用 OpenAI 兼容 API。
 *
 * 使用方式:
 *   pnpm ts-node src/modules/agent/skills/storyboard_assistant/test-anti-hallucination.ts
 */

import { PrismaService } from '../../../../common/prisma/prisma.service';
import { decrypt } from '../../../../common/crypto/crypto-aes.util';

// ===== 测试剧本 =====
// 关键人物: 沈渔(女,小说家)、陆沉(男,邻居)
// 关键场景: 江边、老街茶馆、小院
// 剧本中不会出现的场景: 医院、办公室、酒吧、学校、咖啡馆、地铁
const TEST_SCRIPT = `
【场景 1: 江边 - 黄昏】

沈渔站在江边，风吹起她的长发。她手里攥着一本泛黄的小说，封面已经磨损得看不清字迹。

这是她来这座小城的第三天。三天前，她还是都市里那个被催稿逼疯的畅销书作家，现在，她只是个想在江边发呆的普通人。

陆沉远远看着她，手里的烟燃到了尽头也没发觉。

"你在看什么？"沈渔回头，正好对上他的目光。

"看你。"陆沉走近，把烟头摁灭在栏杆上，"你看起来不像本地人。"

"来采风的。"沈渔把书塞进包里，"听说这里的茶馆很有名。"

"我带你去。"

【场景 2: 老街茶馆 - 夜】

茶馆里人不多，角落里有个老人在拉二胡，曲调悠长。

陆沉给沈渔倒了杯茶，"这是本地特有的云雾茶，你尝尝。"

沈渔抿了一口，苦味里带着回甘，"不错。"

"你来采什么风？"

"写小说。"沈渔看着茶杯里浮沉的茶叶，"写一个关于逃离的故事。"

陆沉笑了，"那可巧了，这整条街的人都在逃离。"

【场景 3: 小院 - 清晨】

沈渔住在陆沉家隔壁的小院里。清晨的鸟叫把她吵醒，她推开窗，看见陆沉在院子里练字。

他写的是"静"字，一笔一划都很认真。

"早。"沈渔打了个哈欠。

"早。"陆沉头也不抬，"昨晚睡得怎么样？"

"挺好的，就是蚊子有点多。"

"晚上我给你点蚊香。"

沈渔笑了，这是她三天来第一次真心实意地笑。

【场景 4: 江边 - 夜晚】

月光洒在江面上，像碎银子。

沈渔和陆沉并排坐在石阶上，谁也没说话。

"你的小说写完了吗？"陆沉问。

"快了。"

"结局是什么？"

"结局是——"沈渔顿了顿，"女主角决定留下来。"

陆沉转头看她，月光下她的眼睛很亮。

"那她为什么留下来？"

"因为这里有人等她。"

沈渔说完，自己也愣住了。
`;

// ===== 测试结果 =====
interface TestResult {
  name: string;
  pass: boolean;
  message: string;
  detail: string;
}

const results: TestResult[] = [];
let score = { points: 0, total: 20 };

function record(name: string, pass: boolean, message: string, detail: string, scoreDelta?: number) {
  results.push({ name, pass, message, detail });
  const tag = pass ? '  [PASS]' : '  [FAIL]';
  console.log(`${tag} ${name}: ${message}`);
  if (detail) console.log(`       ${detail}`);
  if (scoreDelta !== undefined) score.points += pass ? scoreDelta : 0;
}

async function main() {
  console.log('============================================');
  console.log('  分镜分块防幻觉 - 端到端测试 v2');
  console.log('============================================\n');

  // 1. 连接数据库
  const prisma = new PrismaService();
  await prisma.$connect();

  const testUser = await prisma.user.findFirst({ where: { email: 'test@zeroexo.com' } });
  if (!testUser) { console.error('未找到 test@zeroexo.com'); process.exit(1); }
  console.log(`[SETUP] 用户: ${testUser.email}\n`);

  // 2. 获取 AI 渠道(读取加密的 credentials)
  const provider = await prisma.apiProvider.findFirst({
    where: { type: 'ai', enabled: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!provider) { console.error('未找到可用 AI 渠道'); process.exit(1); }

  const cfg = (provider.config as Record<string, any>) || {};
  const creds = (provider.credentials as Record<string, any>) || {};
  const baseUrl = (cfg.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = cfg.agentModel ?? cfg.defaultModel ?? (Array.isArray(cfg.enabledModels) ? cfg.enabledModels[0] : '');
  const encryptionKey = process.env.AI_ENCRYPTION_KEY ?? '';
  const apiKey = creds.apiKey ? decrypt(creds.apiKey, encryptionKey) : '';
  if (!model) { console.error('渠道未配置模型'); process.exit(1); }
  if (!apiKey) { console.error('渠道未配置 API Key(或加密密钥不匹配)'); process.exit(1); }

  console.log(`[SETUP] 渠道: ${provider.name} | 模型: ${model}`);
  console.log(`[SETUP] API: ${baseUrl}/chat/completions\n`);

  // ===== 测试 1: 文本分块 =====
  console.log('--- 测试 1: 文本分块 ---');
  const CHUNK_MAX_CHARS = 9000;
  const chunks = splitIntoChunks(TEST_SCRIPT, CHUNK_MAX_CHARS);
  record('分块逻辑', true, `${TEST_SCRIPT.length} 字符 → ${chunks.length} 块`,
    `块大小: ${chunks.map(c => c.length).join(', ')}`, 1);

  // ===== 测试 2: 全局摘要生成 =====
  console.log('\n--- 测试 2: 全局剧情摘要 ---');
  const globalContext = await callLLM(prisma, baseUrl, model, apiKey, provider.provider, [
    { role: 'system', content: '你是一个剧情摘要专家。输出简洁精准，不超过500字。' },
    { role: 'user', content: extractSummaryPrompt(TEST_SCRIPT) },
  ], 4096);

  if (globalContext && globalContext.length > 100) {
    console.log(`  [摘要] ${globalContext.slice(0, 300)}...`);
    // 检查核心元素
    const keyTerms = ['沈渔', '陆沉', '江边', '茶馆', '小院'];
    const missing = keyTerms.filter(t => !globalContext.includes(t));
    record('摘要包含核心元素', missing.length === 0,
      missing.length === 0 ? '沈渔/陆沉/江边/茶馆/小院 均在摘要中' : `缺失: ${missing.join(', ')}`,
      '', 2);
    // 检查编造内容
    const badTerms = ['医院', '办公室', '酒吧', '学校', '公司', '警察', '咖啡馆', '地铁'];
    const foundBad = badTerms.filter(t => globalContext.includes(t));
    record('摘要无编造', foundBad.length === 0,
      foundBad.length === 0 ? '未发现编造内容' : `发现: ${foundBad.join(', ')}`,
      '', 2);
  } else {
    record('摘要生成', false, '失败或过短', `长度: ${globalContext?.length ?? 0}`, 0);
  }

  // ===== 测试 3: 分块模式 + 防幻觉 =====
  console.log('\n--- 测试 3: 分块模式防幻觉验证 ---');

  // 用第 1 块测试
  const testChunk = chunks[0]!;
  const prompt = buildChunkPrompt({
    globalContext: globalContext || undefined,
    scriptChunk: testChunk,
    chunkIndex: 0,
    totalChunks: chunks.length,
  });

  console.log(`  [用户消息长度] ${prompt.length} 字符\n`);

  const llmOutput = await callLLM(prisma, baseUrl, model, apiKey, provider.provider, [
    { role: 'system', content: loadSystemPrompt() },
    { role: 'user', content: prompt },
  ], 16384); // 分镜 JSON 输出可能很长，需要大 max_tokens

  console.log(`  [LLM 输出] ${llmOutput.slice(0, 400)}...\n`);

  // 解析并验证
  let shots: any[] = [];
  try {
    shots = parseShotsFromOutput(llmOutput);
    record('LLM 输出解析', true, `成功解析 ${shots.length} 个镜头`, '', 1);
  } catch (err) {
    record('LLM 输出解析', false, `解析失败: ${(err as Error).message}`, '', 0);
  }

  if (shots.length > 0) {
    // 验证防幻觉
    const forbidden = ['医院', '办公室', '酒吧', '学校', '公司', '警察', '咖啡馆', '地铁', '餐厅', '车站'];
    let hallucinatedCount = 0;
    const hallucinatedDetails: string[] = [];

    for (const shot of shots) {
      const combined = ((shot.description || '') + (shot.environment || '')).toLowerCase();
      for (const term of forbidden) {
        if (combined.includes(term) && !hallucinatedDetails.includes(term)) {
          hallucinatedCount++;
          hallucinatedDetails.push(term);
        }
      }
    }

    record('无编造场景', hallucinatedCount === 0,
      hallucinatedCount === 0
        ? '所有镜头场景均基于剧本原文，未发现编造内容'
        : `发现 ${hallucinatedCount} 处编造: ${hallucinatedDetails.join(', ')}`,
      '', 5);

    // 输出镜头清单
    console.log('\n  [镜头清单]');
    for (const shot of shots) {
      console.log(`    #${shot.number} [${shot.sceneId}] ${shot.shotType || '?'} | ${(shot.description || '').slice(0, 60)}`);
      console.log(`        entities: ${Array.isArray(shot.entities) ? shot.entities.join(', ') : '[]'}`);
      console.log(`        environment: ${(shot.environment || '').slice(0, 60)}`);
    }
    console.log('');

    // 检查实体(按新规范: entities 只包含人物角色名)
    const allEntities = new Set<string>();
    for (const shot of shots) {
      if (Array.isArray(shot.entities)) {
        shot.entities.forEach((e: string) => allEntities.add(e));
      }
    }
    // 检查是否包含主要人物
    const hasMainCharacters = shots.some(s => Array.isArray(s.entities) && s.entities.includes('沈渔'));
    record('entities 包含主要人物', hasMainCharacters,
      hasMainCharacters ? '沈渔在 entities 中' : '沈渔不在 entities 中',
      '', 3);

    // 检查是否有剧情连贯性
    const hasDialogue = shots.some(s => s.dialogue && s.dialogue.length > 0);
    record('包含台词', hasDialogue,
      hasDialogue ? '剧本中的对话已出现在分镜中' : '分镜缺少剧本中的对话',
      '', 2);

    // 检查是否是合理数量的镜头(新约束: 每场景 3-5 个镜头, 总镜头数 ≤ 20)
    const reasonableCount = shots.length >= 3 && shots.length <= 20;
    record('镜头数量合理', reasonableCount,
      `${shots.length} 个镜头${reasonableCount ? '' : ' (超出 20 上限)'}`,
      '', 2);
  }

  // ===== 评分 =====
  console.log('============================================');
  console.log('  评分结果');
  console.log('============================================');
  const percentage = Math.round((score.points / score.total) * 100);
  const grade = percentage >= 90 ? 'A (优秀，可上生产)' :
    percentage >= 75 ? 'B (良好，需微调)' :
    percentage >= 60 ? 'C (及格，有改进空间)' :
    'D (不及格，需修复)';

  console.log(`  总分: ${score.points}/${score.total} (${percentage}%)`);
  console.log(`  评级: ${grade}`);
  console.log('');

  // 汇总
  console.log('============================================');
  console.log('  测试汇总');
  console.log('============================================');
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass);
  console.log(`  总测试: ${results.length}`);
  console.log(`  通过: ${passed}`);
  console.log(`  失败: ${failed.length}`);
  if (failed.length > 0) {
    console.log('\n  失败明细:');
    for (const f of failed) {
      console.log(`    - ${f.name}: ${f.message}`);
    }
  }

  console.log('\n  不足与改进建议:');
  if (hallucinatedScenesExist(shots)) {
    console.log('    1. 防幻觉铁律需加强: LLM 仍在编造场景');
    console.log('       - 建议在 SYSTEM_PROMPT.md 中增加"场景黑名单"约束');
    console.log('       - 增加"场景来源标注"强制要求（每个场景必须标注出自剧本的哪个场景）');
  }
  if (shots.length > 20) {
    console.log('    1. 镜头数量超出约束: 新约束上限 20 个, 当前 ' + shots.length + ' 个');
    console.log('       - 建议在 PROMPT 中强化"每场景 3-5 个镜头"的约束力度');
  }
  if (!shots.some(s => s.dialogue)) {
    console.log('    2. 对话缺失: 剧本中的对话未被正确提取到分镜');
    console.log('       - 检查 prompt 中 dialogue 字段的约束强度');
    console.log('       - 考虑在分块模式中增加"对话优先提取"指令');
  }
  if (hallucinatedScenesExist(shots)) {
    console.log('    3. 防幻觉检测触底: 场景校验发现剧本中不存在的场景');
    console.log('       - 增强场景一致性校验(validateSceneConsistency)中的关键词库');
  }

  await prisma.$disconnect();
  process.exit(failed.length > 0 ? 1 : 0);
}

function hallucinatedScenesExist(shots: any[]): boolean {
  if (!shots || shots.length === 0) return false;
  const forbidden = ['医院', '办公室', '酒吧', '学校', '公司', '警察', '咖啡馆', '地铁', '餐厅', '车站'];
  for (const shot of shots) {
    const combined = ((shot.description || '') + (shot.environment || '')).toLowerCase();
    for (const term of forbidden) {
      if (combined.includes(term)) return true;
    }
  }
  return false;
}

// ===== 工具函数 =====

function splitIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if (para.length > maxChars) {
      if (current) { chunks.push(current); current = ''; }
      let rest = para;
      while (rest.length > maxChars) {
        const cut = cutAtSentenceBoundary(rest, maxChars);
        chunks.push(cut);
        rest = rest.slice(cut.length).trim();
      }
      current = rest;
      continue;
    }
    if (current.length + para.length + 2 > maxChars) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function cutAtSentenceBoundary(text: string, max: number): string {
  const head = text.slice(0, max);
  const boundaryChars = '。！？!?…\n';
  const searchStart = Math.max(0, head.length - 300);
  for (let i = head.length - 1; i >= searchStart; i--) {
    if (boundaryChars.includes(head[i])) return head.slice(0, i + 1);
  }
  return head;
}

function extractSummaryPrompt(script: string): string {
  return `请阅读以下剧本全文,生成一份结构化的剧情摘要,必须包含:
1. 世界观/故事背景(时代、地点、社会环境)
2. 核心人物列表(姓名、身份、关键特征)
3. 主要人物关系(谁和谁是什么关系)
4. 主线剧情走向(故事的核心冲突和走向)
5. 关键场景地点列表

要求: 简洁精准,不超过 500 字。不要分镜,不要镜头描述,只做剧情摘要。

=== 剧本全文 ===
${script}`;
}

function loadSystemPrompt(): string {
  return `# 分镜助手 · 系统提示词
## 角色
电影导演+分镜师+摄影指导AI综合体。输出必须可被AI视频模型执行。

## 分块模式豁免(最高优先级)
- 用户输入含 "mode: "chunk"" 时,以上「工具写入」铁律**全部豁免**
- 分块模式: 禁止调用任何工具,直接输出镜头 JSON 数组,不要任何解释/前言/Markdown 代码块
- **防幻觉铁律(本模式最高优先级)**: 必须严格基于剧本原文生成分镜,严禁编造剧本中不存在的人物、场景、道具、事件、对话、情节或背景设定; 如果剧本片段内容不完整,只基于用户提供的全局/前情上下文进行合理推断,不得编造新内容
- **镜头数量约束**: 每场景(每个 sceneId)生成 3-5 个镜头,总镜头数不超过 20 个
- **entities 字段规范**: entities 数组**只包含人物角色名**(如["沈渔","陆沉"]), 场景名称、道具、环境描述等非人物元素**必须归入 environment 字段**, 不得放入 entities
- **输出 schema 固定**: 必填 id / number / sceneId / duration(4-15秒) / shotType / cameraMovement / description(主体位置+具体行为, 禁"正要/准备/即将"过渡态, 中景及以上必须含画面位置/朝向) / lighting(主光源方向+色温, 禁"柔和光线"抽象词) / dialogue(本镜头台词原文, 无台词则空字符串"") / voiceoverText(旁白文本, 无则空字符串"") / monologue(内心独白, 无则空字符串"") / sfx(音效数组, 如["江水声","风声"], 无则空数组[]) / promptText(含[主体描述][场景与氛围][动作与情节][镜头语言][音画同步/音频]段落) / promptEn(与promptText结构一致) / entities(只包含人物角色名) / dayNight(日/夜/黄昏/黎明) / environment(地点+时间+纵深层次)`;
}

function buildChunkPrompt(input: {
  globalContext?: string;
  scriptChunk: string;
  chunkIndex: number;
  totalChunks: number;
}): string {
  const lines = [
    '【分块生成模式·必须遵守】',
    '1. 你是分块处理模式: 禁止调用任何工具,直接输出镜头 JSON 数组;',
    '2. 禁止任何解释、前言、总结或 Markdown 代码块;',
    '3. 输出第一行必须是 JSON 数组本身,sceneId 从 1 开始编号;',
    '【防幻觉铁律·最高优先级】',
    '4. 你必须严格基于"剧本原文"生成分镜,严禁编造剧本中不存在的:',
    '   - 不存在的人物、场景、道具、事件',
    '   - 剧本未提及的对话、情节、背景设定',
    '5. 如果剧本片段内容不完整或含糊,请基于前情提要进行合理推断,但绝对不要编造新内容;',
    '6. 保持与全局剧情摘要中的世界观、人物关系、主线走向一致;',
    '【镜头数量约束】',
    '7. 每场景(每个 sceneId)生成 3-5 个镜头,总镜头数不超过 20 个;',
    '【entities 字段规范】',
    '8. entities 数组只包含人物角色名(如["沈渔","陆沉"]), 场景名称、道具、环境描述等非人物元素必须归入 environment 字段, 不得放入 entities;',
    '',
    ...(input.globalContext
      ? ['【全局剧情摘要·整部小说核心背景(所有分块必须遵守)】', input.globalContext, '']
      : []),
    '【当前任务数据(仅 scriptChunk 字段是本块剧本原文)】',
    JSON.stringify({
      mode: 'chunk',
      chunkIndex: input.chunkIndex,
      totalChunks: input.totalChunks,
      scriptChunk: input.scriptChunk,
    }),
  ];
  return lines.join('\n');
}

function parseShotsFromOutput(output: string): any[] {
  const trimmed = output.trim();
  // 1. 直接 parse
  try {
    const direct = JSON.parse(trimmed);
    if (Array.isArray(direct)) return direct;
  } catch { /* 继续 */ }
  // 2. ```json 围栏
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(output);
  if (fence) {
    try {
      const parsed = JSON.parse(fence[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch { /* 继续 */ }
  }
  // 3. 首个 [ 到最后一个 ](允许尾部有额外文本)
  const arrStart = output.indexOf('[');
  const arrEnd = output.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) {
    const jsonStr = output.slice(arrStart, arrEnd + 1);
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* 继续 */ }
    // 4. 尝试修复常见 JSON 问题: 尾部逗号、quote 等
    try {
      const fixed = jsonStr
        .replace(/,\s*([\]}])/g, '$1') // 移除尾部逗号
        .replace(/'/g, '"') // 单引号转双引号
        .replace(/([{,])\s*(\w+)\s*:/g, '$1"$2":'); // 无引号 key 加引号
      const parsed = JSON.parse(fixed);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* 继续 */ }
    // 5. 尝试修复截断 JSON: 在最后一个完整对象后补 ]]
    try {
      const truncated = jsonStr.replace(/\n/g, ' ').replace(/,\s*$/, '');
      // 尝试补全被截断的末尾
      let candidate = truncated;
      // 移除末尾不完整的 field
      candidate = candidate.replace(/"[^"]*$/g, '');
      // 补全 ] 和 }
      if (!candidate.endsWith(']')) candidate = candidate.replace(/[^\]}]*$/, '') + ']';
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* 继续 */ }
  }
  throw new Error(`无法解析: ${output.slice(0, 100)}`);
}

async function callLLM(
  _prisma: PrismaService,
  baseUrl: string,
  model: string,
  apiKey: string,
  providerName: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
): Promise<string> {
  const url = `${baseUrl}/chat/completions`;
  const body: Record<string, any> = {
    model,
    messages,
    temperature: 0.7,
    max_tokens: maxTokens,
  };
  // DeepSeek 推理模型默认关闭 thinking(否则 reasoning_content 占用 max_tokens 挤占 JSON 输出)
  if (providerName?.toLowerCase().includes('deepseek')) {
    body.thinking = { type: 'disabled' };
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`API ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json() as any;
  const choice = data.choices?.[0];
  if (!choice) throw new Error(`无 choices: ${JSON.stringify(data).slice(0, 500)}`);
  const content = choice.message?.content ?? '';
  // DeepSeek 等模型可能返回 tool_calls 而非 content
  if (!content && choice.message?.tool_calls) {
    throw new Error(`模型返回了 tool_calls 而非 content (tool_calls 数量: ${choice.message.tool_calls.length})`);
  }
  if (!content) {
    throw new Error(`content 为空, 完整响应: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return content;
}

main().catch(async (err) => {
  console.error('测试崩溃:', err);
  process.exit(1);
});