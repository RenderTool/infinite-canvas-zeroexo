/**
 * 从 LLM 流式响应的一个 SSE chunk 中提取 content delta 文本。
 *
 * LLM 流式格式（OpenAI 兼容）:
 *   data: {"id":"...","choices":[{"delta":{"content":"文本片段"}}]}
 *
 * 返回提取的 content 文本，如果没有则返回空字符串。
 */
export function extractLlmDeltaContent(chunk: string): string {
  for (const line of chunk.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const jsonStr = trimmed.slice(6);
    if (jsonStr === '[DONE]') continue;
    try {
      const parsed = JSON.parse(jsonStr);
      return parsed?.choices?.[0]?.delta?.content || '';
    } catch {
      // 跳过无法解析的行
    }
  }
  return '';
}

/**
 * 从部分 JSON 文本中提取 "text" 字段的纯文本内容。
 *
 * 输入可能是 LLM 正在输出的不完整 JSON 行，如：
 *   data: {"type":"step","text":"解读项目关
 *
 * 通过正则匹配 "text":"..." 部分提取已输出的文本内容。
 * 返回纯文本，如果未匹配到则返回空字符串。
 */
export function extractDisplayTextFromPartial(raw: string): string {
  // 去掉可能的 data: 前缀
  const content = raw.startsWith('data: ') ? raw.slice(6) : raw;
  // 匹配 "text":"..." 中的文本内容（支持转义字符）
  const match = content.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (!match || !match[1]) return '';
  try {
    // 通过 JSON.parse 处理转义字符（如 \n, \t, \\, \"）
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
}

/**
 * 容错解析 LLM 输出的 step JSON。
 *
 * 当 LLM 输出形如：
 *   {"type":"step","text":"```json\n{\"schemes\":[...]}\n```","suggestions":[]}
 * 若内嵌 JSON 字符串未正确转义，会导致整行 JSON.parse 失败。
 *
 * 此函数通过正则提取外层 type/text/suggestions 字段，重建一个合法的 step 对象，
 * 保证 text 字段包含完整 ```json ... ``` 块供前端二次解析。
 *
 * 返回 null 表示无法提取。
 */
export function tryParseLenientStepJson(raw: string): any | null {
  // 必须看起来像 step JSON
  if (!/"type"\s*:\s*"step"/.test(raw)) return null;

  // 提取 type（应等于 step）
  const typeMatch = raw.match(/"type"\s*:\s*"([^"]+)"/);
  const type = typeMatch?.[1];
  if (type !== 'step') return null;

  // 提取 suggestions 数组（简单场景下为空数组）
  const suggMatch = raw.match(/"suggestions"\s*:\s*(\[[^\]]*\])/);
  let suggestions: any[] = [];
  if (suggMatch) {
    try {
      suggestions = JSON.parse(suggMatch[1]!);
    } catch {
      suggestions = [];
    }
  }

  // 提取 text 字段
  // 由于 text 内部可能含未转义引号，采用 "text":" ... ","suggestions" 或行尾 作为结束标记
  const textKeyIdx = raw.indexOf('"text"');
  if (textKeyIdx === -1) return null;
  const colonIdx = raw.indexOf(':', textKeyIdx);
  if (colonIdx === -1) return null;
  // 找到第一个 " 字符
  const firstQuote = raw.indexOf('"', colonIdx);
  if (firstQuote === -1) return null;
  // 从 firstQuote+1 开始查找结束：寻找 ", "suggestions" 或 ", "type" 或 ", }
  let cursor = firstQuote + 1;
  let textValue = '';
  while (cursor < raw.length) {
    const ch = raw[cursor];
    if (ch === '"') {
      // 检查后续是否是 "suggestions" 或 "type" 或 "}"（仅顶层，避免内层 JSON key 误匹配）
      const after = raw.slice(cursor + 1, cursor + 20);
      if (/^\s*,\s*"(suggestions|type)"/.test(after) || /^\s*\}\s*$/.test(after)) {
        // 这是 text 结束位置
        break;
      }
      // 否则这是 text 内部的字面量引号，保留
      textValue += ch;
      cursor++;
      continue;
    }
    if (ch === '\\' && cursor + 1 < raw.length) {
      // 保留转义序列
      textValue += ch + raw[cursor + 1];
      cursor += 2;
      continue;
    }
    textValue += ch;
    cursor++;
  }
  // text 提取后反转义
  try {
    textValue = JSON.parse(`"${textValue}"`) as string;
  } catch {
    // 简单替换常见转义
    textValue = textValue
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  return { type: 'step', text: textValue, suggestions };
}