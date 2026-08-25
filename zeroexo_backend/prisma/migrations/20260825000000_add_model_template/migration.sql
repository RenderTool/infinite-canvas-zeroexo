-- CreateTable
-- 用户导入的模型模板（系统级模板库，全站可用）
CREATE TABLE "ModelTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "matchKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelTemplate_modelType_idx" ON "ModelTemplate"("modelType");

-- CreateIndex
CREATE INDEX "ModelTemplate_enabled_idx" ON "ModelTemplate"("enabled");
