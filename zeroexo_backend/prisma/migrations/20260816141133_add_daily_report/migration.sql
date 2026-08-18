-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "totalCalls" INTEGER NOT NULL DEFAULT 0,
    "totalCredits" INTEGER NOT NULL DEFAULT 0,
    "totalCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalCostCny" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalRevenueCny" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossProfitCny" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "marginRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_date_key" ON "DailyReport"("date");

-- CreateIndex
CREATE INDEX "DailyReport_date_idx" ON "DailyReport"("date");
