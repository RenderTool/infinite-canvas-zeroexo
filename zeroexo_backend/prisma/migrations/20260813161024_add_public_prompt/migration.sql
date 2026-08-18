-- CreateTable
CREATE TABLE "PublicPrompt" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "images" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceId" TEXT,
    "clusterName" TEXT,
    "demoTitles" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicPrompt_category_idx" ON "PublicPrompt"("category");

-- CreateIndex
CREATE INDEX "PublicPrompt_source_idx" ON "PublicPrompt"("source");
