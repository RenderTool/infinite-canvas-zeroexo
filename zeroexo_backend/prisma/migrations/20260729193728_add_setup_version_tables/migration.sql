-- CreateTable
CREATE TABLE "SetupVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'auto',
    "currentPhase" TEXT,
    "phaseCount" INTEGER NOT NULL DEFAULT 0,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "phaseFollowUps" JSONB,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetupVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupPhase" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetupPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetupChatMessage" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "type" TEXT,
    "phase" TEXT,
    "timestamp" BIGINT NOT NULL,
    "options" JSONB,
    "guideText" TEXT,
    "msgOrder" INTEGER NOT NULL,

    CONSTRAINT "SetupChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAgentExecution" (
    "id" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "toolCalls" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAgentExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAgentConfig" (
    "id" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "systemPrompt" TEXT,
    "model" TEXT,
    "temperature" DOUBLE PRECISION,
    "maxTokens" INTEGER,
    "maxIterations" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AiAgentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SetupVersion_projectId_idx" ON "SetupVersion"("projectId");

-- CreateIndex
CREATE INDEX "SetupVersion_projectId_type_idx" ON "SetupVersion"("projectId", "type");

-- CreateIndex
CREATE INDEX "SetupPhase_versionId_idx" ON "SetupPhase"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "SetupPhase_versionId_phase_key" ON "SetupPhase"("versionId", "phase");

-- CreateIndex
CREATE INDEX "SetupChatMessage_versionId_idx" ON "SetupChatMessage"("versionId");

-- CreateIndex
CREATE INDEX "SetupChatMessage_versionId_msgOrder_idx" ON "SetupChatMessage"("versionId", "msgOrder");

-- CreateIndex
CREATE INDEX "AiAgentExecution_projectId_idx" ON "AiAgentExecution"("projectId");

-- CreateIndex
CREATE INDEX "AiAgentExecution_ownerId_idx" ON "AiAgentExecution"("ownerId");

-- CreateIndex
CREATE INDEX "AiAgentExecution_status_idx" ON "AiAgentExecution"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AiAgentConfig_agentType_key" ON "AiAgentConfig"("agentType");

-- CreateIndex
CREATE INDEX "AiGeneration_projectId_idx" ON "AiGeneration"("projectId");

-- CreateIndex
CREATE INDEX "AiGeneration_kind_idx" ON "AiGeneration"("kind");

-- CreateIndex
CREATE INDEX "AiGeneration_ownerId_projectId_kind_status_idx" ON "AiGeneration"("ownerId", "projectId", "kind", "status");

-- AddForeignKey
ALTER TABLE "SetupVersion" ADD CONSTRAINT "SetupVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ArtifactProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupPhase" ADD CONSTRAINT "SetupPhase_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SetupVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetupChatMessage" ADD CONSTRAINT "SetupChatMessage_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "SetupVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: 清空旧的 config.setupBrief 和 config.setupBriefHistory 数据
-- 激进更新策略：不保留旧 JSON blob 中的立项数据，改用独立的 SetupVersion/SetupPhase/SetupChatMessage 表
UPDATE "ArtifactProject"
SET config = (config - 'setupBrief' - 'setupBriefHistory')
WHERE config ? 'setupBrief' OR config ? 'setupBriefHistory';
