/*
  Warnings:

  - You are about to drop the `ArtifactProject` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ScriptImportHistory` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SetupChatMessage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SetupPhase` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SetupVersion` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ArtifactProject" DROP CONSTRAINT "ArtifactProject_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "ScriptImportHistory" DROP CONSTRAINT "ScriptImportHistory_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "SetupChatMessage" DROP CONSTRAINT "SetupChatMessage_versionId_fkey";

-- DropForeignKey
ALTER TABLE "SetupPhase" DROP CONSTRAINT "SetupPhase_versionId_fkey";

-- DropForeignKey
ALTER TABLE "SetupVersion" DROP CONSTRAINT "SetupVersion_projectId_fkey";

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "folderId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "assets" JSONB,
ADD COLUMN     "config" JSONB,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "generations" JSONB,
ADD COLUMN     "script" JSONB,
ADD COLUMN     "storyboard" JSONB;

-- AlterTable
ALTER TABLE "Prompt" ADD COLUMN     "folderId" TEXT,
ADD COLUMN     "imageKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "note" TEXT;

-- DropTable
DROP TABLE "ArtifactProject";

-- DropTable
DROP TABLE "ScriptImportHistory";

-- DropTable
DROP TABLE "SetupChatMessage";

-- DropTable
DROP TABLE "SetupPhase";

-- DropTable
DROP TABLE "SetupVersion";

-- CreateTable
CREATE TABLE "SourceMaterial" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "processedAssetId" TEXT NOT NULL,
    "processingStatus" TEXT NOT NULL DEFAULT 'pending',
    "scriptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetFolder" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "systemKey" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromptImage" (
    "id" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'reference',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "avatarKey" TEXT,
    "avatarEmoji" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "consistency" TEXT NOT NULL DEFAULT '',
    "fields" JSONB NOT NULL DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "imageKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "folderId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "taskType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" JSONB,
    "output" JSONB,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceMaterial_projectId_idx" ON "SourceMaterial"("projectId");

-- CreateIndex
CREATE INDEX "SourceMaterial_processedAssetId_idx" ON "SourceMaterial"("processedAssetId");

-- CreateIndex
CREATE INDEX "AssetFolder_ownerId_parentId_idx" ON "AssetFolder"("ownerId", "parentId");

-- CreateIndex
CREATE INDEX "AssetFolder_systemKey_idx" ON "AssetFolder"("systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssetFolder_ownerId_parentId_name_key" ON "AssetFolder"("ownerId", "parentId", "name");

-- CreateIndex
CREATE INDEX "PromptImage_promptId_idx" ON "PromptImage"("promptId");

-- CreateIndex
CREATE INDEX "Subject_ownerId_idx" ON "Subject"("ownerId");

-- CreateIndex
CREATE INDEX "Subject_type_idx" ON "Subject"("type");

-- CreateIndex
CREATE INDEX "Subject_folderId_idx" ON "Subject"("folderId");

-- CreateIndex
CREATE INDEX "AgentTask_userId_idx" ON "AgentTask"("userId");

-- CreateIndex
CREATE INDEX "AgentTask_projectId_idx" ON "AgentTask"("projectId");

-- CreateIndex
CREATE INDEX "AgentTask_status_idx" ON "AgentTask"("status");

-- CreateIndex
CREATE INDEX "AgentTask_taskType_idx" ON "AgentTask"("taskType");

-- CreateIndex
CREATE INDEX "AgentTask_userId_status_idx" ON "AgentTask"("userId", "status");

-- CreateIndex
CREATE INDEX "Asset_folderId_idx" ON "Asset"("folderId");

-- CreateIndex
CREATE INDEX "Prompt_folderId_idx" ON "Prompt"("folderId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "AssetFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetFolder" ADD CONSTRAINT "AssetFolder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetFolder" ADD CONSTRAINT "AssetFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AssetFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "AssetFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromptImage" ADD CONSTRAINT "PromptImage_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "Prompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subject" ADD CONSTRAINT "Subject_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "AssetFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
