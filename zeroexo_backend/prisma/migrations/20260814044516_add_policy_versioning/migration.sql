/*
  Warnings:

  - You are about to drop the column `content` on the `Policy` table. All the data in the column will be lost.
  - You are about to drop the column `editorId` on the `Policy` table. All the data in the column will be lost.
  - You are about to drop the column `title` on the `Policy` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `Policy` table. All the data in the column will be lost.
  - You are about to drop the column `visible` on the `Policy` table. All the data in the column will be lost.

*/

-- 数据迁移: 将旧 Policy 数据迁移到新 PolicyVersion 表
-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" TEXT NOT NULL,
    "policyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "contentEn" TEXT NOT NULL DEFAULT '',
    "contentJa" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'policy',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "editorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- 迁移现有数据: 每条旧 Policy 记录创建 v1 版本并标记为已发布
INSERT INTO "PolicyVersion" ("id", "policyKey", "version", "title", "content", "type", "published", "notes", "editorId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "key", 1, "title", "content", "type", true, '从旧版迁移', "editorId", "createdAt", "updatedAt"
FROM "Policy";

-- DropIndex
DROP INDEX IF EXISTS "Policy_type_idx";

-- DropIndex
DROP INDEX IF EXISTS "Policy_type_visible_idx";

-- AlterTable: 先 ADD currentVersion 再 DROP 旧列
ALTER TABLE "Policy" ADD COLUMN "currentVersion" INTEGER;

-- 更新 Policy 表: 设置 currentVersion = 1
UPDATE "Policy" SET "currentVersion" = 1;

-- 删除旧列
ALTER TABLE "Policy" DROP COLUMN "content",
DROP COLUMN "editorId",
DROP COLUMN "title",
DROP COLUMN "type",
DROP COLUMN "visible";

-- CreateIndex
CREATE INDEX "PolicyVersion_policyKey_published_idx" ON "PolicyVersion"("policyKey", "published");

-- CreateIndex
CREATE INDEX "PolicyVersion_policyKey_version_idx" ON "PolicyVersion"("policyKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_policyKey_version_key" ON "PolicyVersion"("policyKey", "version");

-- AddForeignKey
ALTER TABLE "PolicyVersion" ADD CONSTRAINT "PolicyVersion_policyKey_fkey" FOREIGN KEY ("policyKey") REFERENCES "Policy"("key") ON DELETE CASCADE ON UPDATE CASCADE;
