-- CreateTable
CREATE TABLE "ArtifactProject" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "config" JSONB NOT NULL DEFAULT '{}',
    "script" JSONB,
    "storyboard" JSONB,
    "assets" JSONB,
    "generations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtifactProject_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtifactProject_ownerId_idx" ON "ArtifactProject"("ownerId");

-- CreateIndex
CREATE INDEX "ArtifactProject_updatedAt_idx" ON "ArtifactProject"("updatedAt");

-- AddForeignKey
ALTER TABLE "ArtifactProject" ADD CONSTRAINT "ArtifactProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
