-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'policy',
ADD COLUMN     "visible" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Policy_type_idx" ON "Policy"("type");

-- CreateIndex
CREATE INDEX "Policy_type_visible_idx" ON "Policy"("type", "visible");
