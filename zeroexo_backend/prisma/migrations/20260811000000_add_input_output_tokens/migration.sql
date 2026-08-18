-- AlterTable
-- 为 AiGeneration 表添加 inputTokens 和 outputTokens 列，记录 API 返回的 token 用量
ALTER TABLE "AiGeneration" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "AiGeneration" ADD COLUMN "outputTokens" INTEGER;