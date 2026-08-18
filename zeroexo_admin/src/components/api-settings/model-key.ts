/**
 * provider::modelId 唯一键工具
 *
 * 编码渠道与模型的绑定关系，简洁可追溯。
 * - buildModelKey: 拼接 provider 与 modelId
 * - parseModelKey: 解析回 { provider, modelId }
 *
 * 用途:
 * 1. 模型列表 React key（避免不同渠道同名模型冲突）
 * 2. 前端定价目录 pricingMap 查询键
 * 3. 消费金额按渠道+模型维度分桶
 */
export function buildModelKey(provider: string, modelId: string): string {
  return `${provider}::${modelId}`;
}

export function parseModelKey(
  key: string,
): { provider: string; modelId: string } | null {
  const idx = key.indexOf('::');
  if (idx < 0) return null;
  return {
    provider: key.slice(0, idx),
    modelId: key.slice(idx + 2),
  };
}
