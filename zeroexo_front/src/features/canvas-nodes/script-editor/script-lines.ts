/**
 * script-lines.ts - 剧本结构化行编辑器数据模型与工具
 *
 * 剧本节点改用自研结构化编辑器（每行一个带类型的块），替换 Quill。
 * 数据以 HTML 存 node.data.content（兼容 ScriptReader / 分页 / Yjs 同步）：
 *  - 编辑态：内部用 ScriptLine[] 块模型
 *  - 序列化：ScriptLine[] → HTML（<p class="script-xxx">），供阅读/分页/同步
 *  - 解析：HTML → ScriptLine[]（还原编辑态）
 *
 * 场景标题（scene-heading）：
 *  - location: 'interior' | 'exterior' 控制 INT. / EXT. 前缀
 *  - 序列化时自动带前缀，如 `<p class="script-scene-heading">INT. 城市江边 - 黄昏</p>`
 */

/** 剧本行类型（好莱坞格式） */
import i18next from 'i18next';

export type ScriptLineType =
  | 'scene-heading'
  | 'action'
  | 'character'
  | 'dialogue'
  | 'parenthetical'
  | 'transition'
  | 'page-break';

/** 场景内外 */
export type SceneLocation = 'interior' | 'exterior';

/** 结构化剧本行 */
export interface ScriptLine {
  id: string;
  type: ScriptLineType;
  text: string;
  /** 仅 scene-heading：INT./EXT. */
  location?: SceneLocation;
}

/** 类型定义（图标/名称/样式 class/说明） */
export interface ScriptLineTypeDef {
  type: ScriptLineType;
  label: string;
  /** 样式 class（对应 script-styles.css） */
  className: string;
  /** 触发菜单提示 */
  hint: string;
}

export const SCRIPT_LINE_TYPE_ORDER: ScriptLineType[] = [
  'scene-heading',
  'action',
  'character',
  'dialogue',
  'parenthetical',
  'transition',
  'page-break',
];

export const SCRIPT_LINE_DEFS: Record<ScriptLineType, ScriptLineTypeDef> = {
  'scene-heading': { type: 'scene-heading', label: i18next.t('scriptEditor.typeScene'), className: 'script-scene-heading', hint: i18next.t('scriptEditor.hintScene') },
  action: { type: 'action', label: i18next.t('scriptEditor.typeAction'), className: 'script-action', hint: i18next.t('scriptEditor.hintAction') },
  character: { type: 'character', label: i18next.t('scriptEditor.typeCharacter'), className: 'script-character', hint: i18next.t('scriptEditor.hintCharacter') },
  dialogue: { type: 'dialogue', label: i18next.t('scriptEditor.typeDialogue'), className: 'script-dialogue', hint: i18next.t('scriptEditor.hintDialogue') },
  parenthetical: { type: 'parenthetical', label: i18next.t('scriptEditor.typeParenthetical'), className: 'script-parenthetical', hint: i18next.t('scriptEditor.hintParenthetical') },
  transition: { type: 'transition', label: i18next.t('scriptEditor.typeTransition'), className: 'script-transition', hint: i18next.t('scriptEditor.hintTransition') },
  'page-break': { type: 'page-break', label: i18next.t('scriptEditor.typePageBreak'), className: 'script-page-break', hint: i18next.t('scriptEditor.hintPageBreak') },
};

/** 生成唯一 id */
function genId(): string {
  return `ln-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 创建一行 */
export function createScriptLine(type: ScriptLineType, text = ''): ScriptLine {
  return {
    id: genId(),
    type,
    text: type === 'page-break' ? '' : text,
    ...(type === 'scene-heading' ? { location: 'interior' as SceneLocation } : {}),
  };
}

/** 场景前缀文本 */
export function sceneLocationPrefix(location?: SceneLocation): string {
  return location === 'exterior' ? 'EXT. ' : 'INT. ';
}

/** 读取场景前缀对应 location（未匹配返回 undefined） */
export function parseSceneLocation(text: string): { location: SceneLocation | undefined; rest: string } {
  const trimmed = text.trimStart();
  if (/^EXT\./i.test(trimmed)) return { location: 'exterior', rest: trimmed.replace(/^EXT\.\s*/i, '') };
  if (/^INT\./i.test(trimmed)) return { location: 'interior', rest: trimmed.replace(/^INT\.\s*/i, '') };
  return { location: undefined, rest: text };
}

/** 单行文本 → 对应 className（用于 HTML class / 样式） */
export function lineClassName(line: ScriptLine): string {
  return SCRIPT_LINE_DEFS[line.type].className;
}

// ===== 序列化 / 解析 =====

/** 转义 HTML 特殊字符（文本内容） */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** ScriptLine[] → HTML（供阅读/分页/同步） */
export function serializeScriptLines(lines: ScriptLine[]): string {
  return lines
    .map((line) => {
      if (line.type === 'page-break') {
        return '<div class="script-page-break"></div>';
      }
      const cls = lineClassName(line);
      const text = line.type === 'scene-heading'
        ? `${sceneLocationPrefix(line.location)}${line.text}`
        : line.text;
      return `<p class="${cls}">${escapeHtml(text)}</p>`;
    })
    .join('');
}

/**
 * 纯文本 → 剧本结构化 HTML（Agent 生成剧本落地用）
 *
 * 启发式识别好莱坞格式：INT./EXT./内景/外景 → 场景标题；"角色: 对白" → 角色+对白两行；
 * 全大写短行 → 角色名；切至/淡入/淡出 → 转场；其余 → 动作段落。
 * 无法识别的行统一按 action 保留，保证内容不丢。
 */
export function plainTextToScriptHtml(text: string): string {
  if (!text) return '';
  const lines: ScriptLine[] = [];
  const rawLines = text.split(/\r?\n/);
  for (const raw of rawLines) {
    const lineText = raw.trim();
    if (!lineText) continue;
    // 场景标题:INT./EXT./内景/外景 前缀
    if (/^(INT\.|EXT\.|内景|外景)/i.test(lineText)) {
      const { location, rest } = parseSceneLocation(lineText);
      const isChinese = /^(内景|外景)/.test(lineText);
      const restText = isChinese ? lineText.replace(/^(内景|外景)\s*/i, '') : rest;
      lines.push({
        ...createScriptLine('scene-heading', restText.trim()),
        location: isChinese ? (lineText.startsWith('外') ? 'exterior' : 'interior') : (location ?? 'interior'),
      });
      continue;
    }
    // 转场
    if (/^(切至|淡入|淡出|CUT TO|FADE IN|FADE OUT)[:：]?$/i.test(lineText)) {
      lines.push(createScriptLine('transition', lineText.replace(/[:：]$/, '')));
      continue;
    }
    // 对白:"角色名: 对白"
    const dialogueMatch = lineText.match(/^([^:：]{1,20})[:：]\s*(.+)$/);
    if (dialogueMatch && dialogueMatch[2]) {
      lines.push(createScriptLine('character', dialogueMatch[1]!.trim()));
      lines.push(createScriptLine('dialogue', dialogueMatch[2]!.trim()));
      continue;
    }
    // 独立全大写短行 → 角色名(好莱坞约定)
    if (/^[A-Z][A-Z0-9\s·]{1,24}$/.test(lineText) && lineText === lineText.toUpperCase()) {
      lines.push(createScriptLine('character', lineText));
      continue;
    }
    // 其余 → 动作段落
    lines.push(createScriptLine('action', lineText));
  }
  return serializeScriptLines(lines);
}

/** HTML → ScriptLine[]（还原编辑态） */
export function parseScriptHtml(html: string): ScriptLine[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = Array.from(doc.body.children) as HTMLElement[];
  const lines: ScriptLine[] = [];
  for (const el of blocks) {
    const cls = el.className || '';
    // 分页标记
    if (cls.includes('script-page-break')) {
      lines.push(createScriptLine('page-break'));
      continue;
    }
    const raw = el.textContent ?? '';
    // 匹配已知剧本格式
    const type = SCRIPT_LINE_TYPE_ORDER.find((t) => cls.includes(SCRIPT_LINE_DEFS[t].className));
    if (type) {
      if (type === 'scene-heading') {
        const { location, rest } = parseSceneLocation(raw);
        lines.push({ ...createScriptLine('scene-heading', rest.trim()), location: location ?? 'interior' });
      } else {
        lines.push(createScriptLine(type, raw.trim()));
      }
      continue;
    }
    // 普通段落 → 按动作处理
    lines.push(createScriptLine('action', raw.trim()));
  }
  return lines;
}

/** 结构化范文（新节点空内容时填充） */
export function buildSampleLines(): ScriptLine[] {
  return [
    { ...createScriptLine('scene-heading', '城市江边 - 黄昏'), location: 'exterior' },
    createScriptLine('action', '林晚站在江边栏杆前，望着远处渐次的灯火。风有些凉，她拢了拢外套。'),
    createScriptLine('character', '林晚'),
    createScriptLine('parenthetical', '低声'),
    createScriptLine('dialogue', '三年了，这座城还是一点没变。'),
    createScriptLine('character', '陈默'),
    createScriptLine('dialogue', '变的从来不是城，是看城的人。'),
    createScriptLine('action', '两人沉默片刻。远处一艘游船缓缓驶过，江面泛起金色碎光。'),
    createScriptLine('transition', 'CUT TO:'),

    createScriptLine('page-break'),

    { ...createScriptLine('scene-heading', '老茶馆 - 夜'), location: 'interior' },
    createScriptLine('action', '斑驳的搪瓷杯冒着热气，墙上挂钟指向十点。林晚把一封泛黄的信推到桌上。'),
    createScriptLine('character', '林晚'),
    createScriptLine('dialogue', '这是爸最后留下的。他说，等你回来那天再看。'),
    createScriptLine('action', '陈默的手指停在信封口，没有拆开，只是把信按进贴身的口袋。'),
    createScriptLine('character', '陈默'),
    createScriptLine('parenthetical', '哑着嗓子'),
    createScriptLine('dialogue', '你爸……知道当年的事吗？'),
    createScriptLine('transition', 'CUT TO:'),
  ];
}