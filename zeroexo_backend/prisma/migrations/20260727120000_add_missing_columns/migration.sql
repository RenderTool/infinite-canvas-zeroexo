-- 补充 Asset.category 字段（user | ai-test | ai-generation）
-- 用于区分用户上传、AI 测试和 AI 生成素材
-- 后续调整前端筛选逻辑

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'user';

-- CreateIndex
CREATE INDEX "Asset_category_idx" ON "Asset"("category");

-- 补充 ArtifactProject.version 乐观锁字段
-- 历史记录 version 默认设为 1

-- AlterTable
ALTER TABLE "ArtifactProject" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
