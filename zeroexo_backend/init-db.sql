-- ZeroExo 数据库初始化脚本 (PostgreSQL)
-- 使用方法:
--   1. 安装 PostgreSQL 后,以超级用户身份运行此脚本
--   2. 打开命令行,执行: psql -U postgres -f init-db.sql
--   3. 然后在 zeroexo-server 目录运行: npx prisma db push

-- 创建数据库用户(密码与 .env 中 DATABASE_URL 一致)
CREATE USER zeroexo WITH PASSWORD 'zeroexo';

-- 创建数据库(属主为 zeroexo)
CREATE DATABASE zeroexo OWNER zeroexo;

-- 授权
GRANT ALL PRIVILEGES ON DATABASE zeroexo TO zeroexo;

-- 切换到 zeroexo 数据库,授权 schema
\c zeroexo
GRANT ALL ON SCHEMA public TO zeroexo;
