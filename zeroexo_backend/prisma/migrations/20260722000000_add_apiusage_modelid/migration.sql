-- ApiUsage 增加 modelId 字段（可空，用于按模型精确计价）
-- 历史记录 modelId 为 null，消费计算时归入 unknown 分组

-- AlterTable
ALTER TABLE "ApiUsage" ADD COLUMN "modelId" TEXT;

-- CreateIndex
CREATE INDEX "ApiUsage_providerId_modelId_metric_window_windowStart_idx" ON "ApiUsage"("providerId", "modelId", "metric", "window", "windowStart");
