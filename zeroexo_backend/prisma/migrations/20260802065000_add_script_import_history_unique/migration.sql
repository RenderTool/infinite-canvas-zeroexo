-- AlterTable
-- 用户级剧本导入历史唯一约束（按 fileHash 去重，用于云同步 upsert）
CREATE UNIQUE INDEX "ScriptImportHistory_ownerId_fileHash_key" ON "ScriptImportHistory"("ownerId", "fileHash");
