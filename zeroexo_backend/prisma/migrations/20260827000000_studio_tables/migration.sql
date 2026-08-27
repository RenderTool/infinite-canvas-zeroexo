-- Plan#46 studio_tables (2026-08-27)
-- Note: two out-of-scope diffs were manually stripped from the prisma diff output:
--   1) DROP TABLE "Subject" (deprecated subject system table still in DB; removal needs a separate decision, never run it casually)
--   2) CREATE TABLE "AgentSkillProposal" (pending migration owned by another colleague)

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'canvas';

-- CreateTable
CREATE TABLE "StudioAsset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "mainImageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioPromptEntry" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "params" JSONB,
    "referenceImages" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioPromptEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioGeneratedImage" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "promptEntryId" TEXT,
    "url" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioGeneratedImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioEpisode" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "episodeNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "sourceRange" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "splitDraft" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioEpisode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioAsset_projectId_kind_idx" ON "StudioAsset"("projectId", "kind");

-- CreateIndex
CREATE INDEX "StudioPromptEntry_assetId_idx" ON "StudioPromptEntry"("assetId");

-- CreateIndex
CREATE INDEX "StudioGeneratedImage_assetId_idx" ON "StudioGeneratedImage"("assetId");

-- CreateIndex
CREATE INDEX "StudioEpisode_projectId_idx" ON "StudioEpisode"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "StudioEpisode_projectId_episodeNumber_key" ON "StudioEpisode"("projectId", "episodeNumber");

-- CreateIndex
CREATE INDEX "Project_type_idx" ON "Project"("type");

-- AddForeignKey
ALTER TABLE "StudioAsset" ADD CONSTRAINT "StudioAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioPromptEntry" ADD CONSTRAINT "StudioPromptEntry_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "StudioAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioGeneratedImage" ADD CONSTRAINT "StudioGeneratedImage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "StudioAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioEpisode" ADD CONSTRAINT "StudioEpisode_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
