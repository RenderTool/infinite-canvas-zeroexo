-- AlterTable: Subject 主体体系扩展（Plan#20 T1：状态集合/封面立绘/音效素材）
ALTER TABLE "Subject" ADD COLUMN "states" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Subject" ADD COLUMN "coverKey" TEXT;

-- AlterTable
ALTER TABLE "Subject" ADD COLUMN "audio" JSONB NOT NULL DEFAULT '[]';
