-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "snapshotProtected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "snapshotRefCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ProjectVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "nodeCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "label" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectVersion_projectId_createdAt_idx" ON "ProjectVersion"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectVersion_projectId_version_key" ON "ProjectVersion"("projectId", "version");
