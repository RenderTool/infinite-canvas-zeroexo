-- Plan#47 prompt_generation_mode (2026-08-27, 征集 #79)
-- 提示词生成模式:文生图/图生图;存量数据默认文生图(零迁移,用户拍板)

-- AlterTable
ALTER TABLE "Prompt" ADD COLUMN "generationMode" TEXT NOT NULL DEFAULT 'txt2img';
