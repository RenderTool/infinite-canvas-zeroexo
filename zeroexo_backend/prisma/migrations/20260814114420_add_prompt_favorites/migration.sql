-- CreateTable
CREATE TABLE "PromptFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromptFavorite_userId_idx" ON "PromptFavorite"("userId");

-- CreateIndex
CREATE INDEX "PromptFavorite_promptId_idx" ON "PromptFavorite"("promptId");

-- CreateIndex
CREATE UNIQUE INDEX "PromptFavorite_userId_promptId_key" ON "PromptFavorite"("userId", "promptId");

-- AddForeignKey
ALTER TABLE "PromptFavorite" ADD CONSTRAINT "PromptFavorite_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "PublicPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
