@echo off
title ZeroExo - Dependency Installer

echo.
echo  ZeroExo Dependency Installer
echo  ------------------------------------------------
echo  This script will install:
echo    1. Node.js LTS (JavaScript runtime)
echo    2. pnpm (Package manager)
echo    3. PostgreSQL 16 (Database, to zeroexo_backend\pgsql)
echo  ------------------------------------------------
echo.

cd /d "%~dp0"

REM ---- Check winget ----
where winget >nul 2>&1
if errorlevel 1 goto no_winget

REM ---- [1/3] Node.js ----
where node >nul 2>&1
if not errorlevel 1 goto check_node_ver
echo  [1/3] Installing Node.js LTS...
winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
goto install_pnpm

:check_node_ver
echo  [1/3] Node.js already installed, skip.
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo        Version: %NODE_VER%

:install_pnpm
REM ---- [2/3] pnpm ----
where pnpm >nul 2>&1
if not errorlevel 1 goto check_pnpm
echo  [2/3] Installing pnpm...
npm install -g pnpm
goto setup_pg_dir

:check_pnpm
echo  [2/3] pnpm already installed, skip.
for /f "tokens=*" %%v in ('pnpm -v') do set PNPM_VER=%%v
echo        Version: %PNPM_VER%

:setup_pg_dir
REM ---- [3/3] PostgreSQL ----
REM Install PostgreSQL to zeroexo_backend\pgsql
pushd "%~dp0.."
set "PG_DIR=%CD%\pgsql"
popd

echo  [3/3] PostgreSQL will be installed to:
echo        %PG_DIR%

netstat -ano | findstr ":5432 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto pg_running
sc query postgresql-x64-16 | findstr "SERVICE_NAME" >nul 2>&1
if not errorlevel 1 goto pg_installed

echo        Installing PostgreSQL 16...
echo        Please click YES on the UAC dialog.
winget install PostgreSQL.PostgreSQL.16 --override "--mode unattended --unattendedmodeui none --superpassword postgres --servicename postgresql-x64-16 --servicepassword postgres --serverport 5432 --prefix %PG_DIR% --datadir %PG_DIR%\data" --accept-package-agreements --accept-source-agreements
goto pg_done

:pg_running
echo        PostgreSQL already running on port 5432, skip.
goto pg_done

:pg_installed
echo        PostgreSQL service found but not running. Starting...
net start postgresql-x64-16
goto pg_done

:pg_done
echo.
echo  ------------------------------------------------
echo  All dependencies checked.
echo.
echo  Next steps:
echo    1. Initialize database:
echo       Run: zeroexo_backend\installers\init-db.bat
echo    2. Start all services:
echo       Run: start-all.bat
echo  ------------------------------------------------
echo.
pause
exit /b 0

:no_winget
echo  ERROR: winget not found.
echo  Please install winget first:
echo    https://github.com/microsoft/winget-cli/releases
echo.
pause
exit /b 1
