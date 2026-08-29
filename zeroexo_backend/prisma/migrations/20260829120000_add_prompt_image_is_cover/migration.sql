-- 提示词图片增加独立封面标记(2026-08-29)
-- 封面不再用 role='cover' 表达(第三态角色导致设封面后图片被归入输出列/角色错乱),
-- 改为独立布尔 isCover:封面仅星标填充,不改变 reference/output 角色。
ALTER TABLE "PromptImage" ADD COLUMN "isCover" BOOLEAN NOT NULL DEFAULT false;

-- 存量 role='cover' 数据迁移:封面标记置 true,角色回落 output(封面原本语义偏向生成图输出)
UPDATE "PromptImage" SET "isCover" = true, "role" = 'output' WHERE "role" = 'cover';
