-- AlterTable: ApiProvider 增加余额字段（Plan#17 LLM 渠道余额反馈）
ALTER TABLE "ApiProvider" ADD COLUMN "balance" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "ApiProvider" ADD COLUMN "balanceCurrency" TEXT;

-- AlterTable
ALTER TABLE "ApiProvider" ADD COLUMN "balanceCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ApiProvider" ADD COLUMN "balanceError" TEXT;
