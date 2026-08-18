-- CreateTable
CREATE TABLE "ScriptImportHistory" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "importedAt" BIGINT NOT NULL,
    "episodeCount" INTEGER NOT NULL,
    "fileType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScriptImportHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScriptImportHistory_ownerId_idx" ON "ScriptImportHistory"("ownerId");

-- CreateIndex
CREATE INDEX "ScriptImportHistory_ownerId_importedAt_idx" ON "ScriptImportHistory"("ownerId", "importedAt");

-- AddForeignKey
ALTER TABLE "ScriptImportHistory" ADD CONSTRAINT "ScriptImportHistory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
