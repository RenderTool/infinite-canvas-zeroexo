@echo off
title ZeroExo Backend - 生产构建

echo ========================================
echo  ZeroExo 后端 - 生产构建脚本
echo ========================================
echo.

cd /d "%~dp0"

:: ---------- 1. 检测 Node.js ----------
echo [1/4] 检测 Node.js 环境...
where node >nul 2>&1
if errorlevel 1 (
    echo   [失败] 未找到 Node.js，请先安装
    pause
    exit /b 1
)
node -v

:: ---------- 2. 安装依赖 ----------
echo [2/4] 安装生产依赖...
call pnpm install --prod --frozen-lockfile
if errorlevel 1 (
    echo   [失败] 依赖安装出错
    pause
    exit /b 1
)

:: ---------- 3. 生成 Prisma 客户端 ----------
echo [3/4] 生成 Prisma 客户端...
call npx prisma generate
if errorlevel 1 (
    echo   [失败] Prisma 生成出错
    pause
    exit /b 1
)

:: ---------- 4. 编译 TypeScript ----------
echo [4/4] 编译 TypeScript...
call pnpm build
if errorlevel 1 (
    echo   [失败] 编译出错
    pause
    exit /b 1
)

echo.
echo ========================================
echo  构建完成！
echo.
echo  启动服务请使用 ZeroExoLauncher
echo ========================================
echo.
pause
