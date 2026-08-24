/**
 * form-utils.ts — `<question-form>` 内联澄清表单协议（Plan#36 P0-2）
 *
 * 模型在消息正文内联输出 `<question-form>` XML artifact，前端解析为表单渲染；
 * 用户提交后 formatFormAnswers 格式化为答案文本，作为下一条用户消息回流
 * （对齐 open-design 的 question-form + formatFormAnswers 机制）。
 */

import type { QuestionData } from '../types.js';

export interface ParsedFormResult {
  /** 表单块之前的文本 */
  before: string;
  /** 表单块之后的文本 */
  after: string;
  /** 解析出的表单数据（复用 QuestionData 结构） */
  form: QuestionData;
  /** 原始 XML 块 */
  raw: string;
  /** 在原文中的起始位置（用于多表单场景计算间隙文本） */
  startIndex: number;
  /** 原始 XML 块长度 */
  rawLength: number;
}

const QUESTION_FORM_RE = /<question-form\b([^>]*)>([\s\S]*?)<\/question-form>/gi;
const ITEM_RE = /<item\b([^>]*)>([\s\S]*?)<\/item>/gi;
const ATTR_RE = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;

/** 解析标签属性串 → 键值对 */
function parseAttrs(attrsStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(attrsStr))) {
    out[m[1]!] = m[2]!;
  }
  return out;
}

/** 解析 <item> 列表 */
function parseItems(inner: string): QuestionData['items'] {
  const items: QuestionData['items'] = [];
  let m: RegExpExecArray | null;
  ITEM_RE.lastIndex = 0;
  while ((m = ITEM_RE.exec(inner))) {
    const attrs = parseAttrs(m[1]!);
    const label = m[2]!.trim() || attrs.label || attrs.value || '';
    items.push({
      value: attrs.value ?? label,
      label,
      desc: attrs.desc,
      ai: attrs.ai === 'true' || attrs.ai === '1',
      checked: attrs.checked === 'true' || attrs.checked === '1',
    });
  }
  return items;
}

/** 从消息文本中解析第一个 <question-form> 块（无则返回 null） */
export function parseQuestionForm(text: string): ParsedFormResult | null {
  const results = parseAllQuestionForms(text);
  return results.length > 0 ? results[0]! : null;
}

/** 从消息文本中解析所有 <question-form> 块（按出现顺序） */
export function parseAllQuestionForms(text: string): ParsedFormResult[] {
  const results: ParsedFormResult[] = [];
  let m: RegExpExecArray | null;
  QUESTION_FORM_RE.lastIndex = 0;
  while ((m = QUESTION_FORM_RE.exec(text))) {
    const attrsStr = m[1]!;
    const inner = m[2]!;
    const raw = m[0]!;
    const attrs = parseAttrs(attrsStr);
    const items = parseItems(inner);
    if (items.length === 0) continue;
    results.push({
      before: text.slice(0, m.index),
      after: text.slice(m.index + raw.length),
      raw,
      form: {
        guideText: attrs['guide-text'] || attrs.guide || '',
        multi: attrs.multi === 'true' || attrs.multi === '1',
        items,
      },
      startIndex: m.index,
      rawLength: raw.length,
    });
  }
  return results;
}

/**
 * 将表单答案格式化为回流的用户消息文本。
 * 对齐 open-design formatFormAnswers：答案以「问题 + 回答」形式进入对话上下文。
 */
export function formatFormAnswers(form: QuestionData, answers: string[]): string {
  const answerText = answers.filter(Boolean).join('、');
  if (!answerText) return form.guideText?.trim() || '已提交';
  return form.guideText?.trim()
    ? `${form.guideText.trim()}\n回答：${answerText}`
    : `回答：${answerText}`;
}
