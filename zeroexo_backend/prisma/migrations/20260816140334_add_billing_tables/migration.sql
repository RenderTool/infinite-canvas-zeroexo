-- CreateTable
CREATE TABLE "UserCredit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "totalCharged" INTEGER NOT NULL DEFAULT 0,
    "totalConsumed" INTEGER NOT NULL DEFAULT 0,
    "totalRefunded" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CREDIT',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "frozenAmount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "referenceId" TEXT,
    "remark" TEXT,
    "operatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsumptionLog" (
    "id" TEXT NOT NULL,
    "generationId" TEXT,
    "chatSessionId" TEXT,
    "userId" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "usageAmount" BIGINT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "creditsConsumed" INTEGER NOT NULL,
    "creditValueCny" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "upstreamCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "channelPool" TEXT,
    "modelMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "completionMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "groupMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "creditPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "billingStatus" TEXT NOT NULL DEFAULT 'completed',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumptionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingConfig" (
    "id" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "unitType" TEXT NOT NULL,
    "modelMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "completionMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "groupMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "creditPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "creditUnitSize" INTEGER NOT NULL DEFAULT 1000,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserCredit_userId_key" ON "UserCredit"("userId");

-- CreateIndex
CREATE INDEX "UserCredit_userId_idx" ON "UserCredit"("userId");

-- CreateIndex
CREATE INDEX "CreditTransaction_userId_idx" ON "CreditTransaction"("userId");

-- CreateIndex
CREATE INDEX "CreditTransaction_type_idx" ON "CreditTransaction"("type");

-- CreateIndex
CREATE INDEX "CreditTransaction_createdAt_idx" ON "CreditTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "CreditTransaction_userId_type_createdAt_idx" ON "CreditTransaction"("userId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "ConsumptionLog_userId_idx" ON "ConsumptionLog"("userId");

-- CreateIndex
CREATE INDEX "ConsumptionLog_model_idx" ON "ConsumptionLog"("model");

-- CreateIndex
CREATE INDEX "ConsumptionLog_createdAt_idx" ON "ConsumptionLog"("createdAt");

-- CreateIndex
CREATE INDEX "ConsumptionLog_userId_createdAt_idx" ON "ConsumptionLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsumptionLog_modelType_idx" ON "ConsumptionLog"("modelType");

-- CreateIndex
CREATE INDEX "PricingConfig_modelType_idx" ON "PricingConfig"("modelType");

-- CreateIndex
CREATE INDEX "PricingConfig_provider_idx" ON "PricingConfig"("provider");

-- CreateIndex
CREATE INDEX "PricingConfig_enabled_idx" ON "PricingConfig"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "PricingConfig_modelType_provider_modelId_key" ON "PricingConfig"("modelType", "provider", "modelId");

-- AddForeignKey
ALTER TABLE "UserCredit" ADD CONSTRAINT "UserCredit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "UserCredit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionLog" ADD CONSTRAINT "ConsumptionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionLog" ADD CONSTRAINT "ConsumptionLog_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "UserCredit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
