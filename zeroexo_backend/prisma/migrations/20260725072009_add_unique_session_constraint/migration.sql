/*
  Warnings:

  - A unique constraint covering the columns `[userId,providerId,model]` on the table `AiChatSession` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "AiChatSession_userId_providerId_model_idx";

-- CreateIndex
CREATE UNIQUE INDEX "AiChatSession_userId_providerId_model_key" ON "AiChatSession"("userId", "providerId", "model");
