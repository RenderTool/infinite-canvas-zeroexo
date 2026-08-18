/*
  Warnings:

  - You are about to drop the `AiProvider` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AiGeneration" DROP CONSTRAINT "AiGeneration_providerId_fkey";

-- DropForeignKey
ALTER TABLE "AiProvider" DROP CONSTRAINT "AiProvider_ownerId_fkey";

-- DropTable
DROP TABLE "AiProvider";
