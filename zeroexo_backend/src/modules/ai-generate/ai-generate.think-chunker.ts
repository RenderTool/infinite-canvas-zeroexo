/** 剧本导入拆分:单集结构 */
export interface SplitEpisode {
  number: number;
  title: string;
  content: string;
}

/**
 * 按语义边界将长文本切分为多个 chunk。
 * - 从切点向前回看寻找段落/句子边界,避免切断场景/句子导致衔接断裂。
 * - 相邻 chunk 预留 overlap 重叠,避免边界内容丢失。
 */
export function splitScriptIntoChunks(content: string, chunkSize: number, overlap = 1000): string[] {
  if (!content) return [];
  if (content.length <= chunkSize) return [content];
  const chunks: string[] = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + chunkSize, content.length);
    if (end < content.length) {
      // 从 end 向前最多回看 300 字符,寻找段落(换行)/句子(。！？!?)边界
      const lookStart = Math.max(start, end - 300);
      const lookback = content.slice(lookStart, end);
      let cut = -1;
      for (let i = lookback.length - 1; i >= 0; i--) {
        const ch = lookback[i];
        if (ch === '\n' || ch === '。' || ch === '！' || ch === '？' || ch === '!') {
          cut = i + 1;
          break;
        }
      }
      if (cut > -1) end = lookStart + cut;
    }
    const piece = content.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= content.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/** 从 LLM 响应文本中解析 episodes 数组(兼容 ```json 代码块包装) */
export function parseEpisodesFromJson(text: string): SplitEpisode[] {
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = codeBlock ? codeBlock[1]! : text;
  try {
    const obj = JSON.parse(raw);
    const arr = obj?.episodes;
    if (!Array.isArray(arr)) return [];
    return arr.map((ep: any, idx: number) => ({
      number: Number(ep?.number) || idx + 1,
      title: ep?.title || `第${idx + 1}集`,
      content: ep?.content || ep?.text || ep?.body || '',
    }));
  } catch {
    return [];
  }
}
