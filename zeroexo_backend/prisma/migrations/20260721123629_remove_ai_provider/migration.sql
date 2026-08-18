-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "driver" TEXT NOT NULL DEFAULT 'local',
ADD COLUMN     "driverMeta" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "migratedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ApiProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "credentials" JSONB NOT NULL DEFAULT '{}',
    "credentialsMask" TEXT,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quota" JSONB NOT NULL DEFAULT '{}',
    "health" TEXT NOT NULL DEFAULT 'unknown',
    "healthLatencyMs" INTEGER,
    "healthCheckedAt" TIMESTAMP(3),
    "healthError" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "ownerRole" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,

    CONSTRAINT "ApiProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiUsage" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" BIGINT NOT NULL,
    "window" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiHealthLog" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "errorMessage" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiHealthLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationJob" (
    "id" TEXT NOT NULL,
    "fromDriver" TEXT NOT NULL,
    "toDriver" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "completedFiles" INTEGER NOT NULL DEFAULT 0,
    "failedFiles" INTEGER NOT NULL DEFAULT 0,
    "skippedFiles" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" BIGINT NOT NULL DEFAULT 0,
    "completedBytes" BIGINT NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationJobItem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "checksum" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationJobItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiProvider_type_enabled_idx" ON "ApiProvider"("type", "enabled");

-- CreateIndex
CREATE INDEX "ApiProvider_provider_idx" ON "ApiProvider"("provider");

-- CreateIndex
CREATE INDEX "ApiProvider_ownerRole_idx" ON "ApiProvider"("ownerRole");

-- CreateIndex
CREATE INDEX "ApiProvider_isDefault_idx" ON "ApiProvider"("isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "ApiProvider_ownerId_provider_name_key" ON "ApiProvider"("ownerId", "provider", "name");

-- CreateIndex
CREATE INDEX "ApiUsage_providerId_metric_window_windowStart_idx" ON "ApiUsage"("providerId", "metric", "window", "windowStart");

-- CreateIndex
CREATE INDEX "ApiUsage_windowStart_idx" ON "ApiUsage"("windowStart");

-- CreateIndex
CREATE INDEX "ApiHealthLog_providerId_checkedAt_idx" ON "ApiHealthLog"("providerId", "checkedAt");

-- CreateIndex
CREATE INDEX "ApiHealthLog_status_checkedAt_idx" ON "ApiHealthLog"("status", "checkedAt");

-- CreateIndex
CREATE INDEX "MigrationJob_status_idx" ON "MigrationJob"("status");

-- CreateIndex
CREATE INDEX "MigrationJob_createdBy_idx" ON "MigrationJob"("createdBy");

-- CreateIndex
CREATE INDEX "MigrationJob_createdAt_idx" ON "MigrationJob"("createdAt");

-- CreateIndex
CREATE INDEX "MigrationJobItem_jobId_status_idx" ON "MigrationJobItem"("jobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationJobItem_jobId_storageKey_key" ON "MigrationJobItem"("jobId", "storageKey");

-- CreateIndex
CREATE INDEX "Resource_driver_idx" ON "Resource"("driver");

-- AddForeignKey
ALTER TABLE "ApiProvider" ADD CONSTRAINT "ApiProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiUsage" ADD CONSTRAINT "ApiUsage_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ApiProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiHealthLog" ADD CONSTRAINT "ApiHealthLog_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ApiProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationJobItem" ADD CONSTRAINT "MigrationJobItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MigrationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
