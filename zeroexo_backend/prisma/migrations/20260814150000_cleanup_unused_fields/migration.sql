-- 清理废弃字段：删除 AiAgentExecution 表、移除 ApiProvider.ownerRole/userId、AiAgentConfig.deletedAt

-- Drop AiAgentExecution table (unused model)
DROP TABLE IF EXISTS "AiAgentExecution";

-- Drop AiAgentConfig.deletedAt column
ALTER TABLE "AiAgentConfig" DROP COLUMN IF EXISTS "deletedAt";

-- Drop ApiProvider.ownerRole column and index
DROP INDEX IF EXISTS "ApiProvider_ownerRole_idx";
ALTER TABLE "ApiProvider" DROP COLUMN IF EXISTS "ownerRole";

-- Drop ApiProvider.userId column and foreign key
ALTER TABLE "ApiProvider" DROP CONSTRAINT IF EXISTS "ApiProvider_userId_fkey";
ALTER TABLE "ApiProvider" DROP COLUMN IF EXISTS "userId";