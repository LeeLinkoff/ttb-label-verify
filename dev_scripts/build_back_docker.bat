@echo off
setlocal

REM build_back_docker.bat
REM
REM Builds the backend Docker image, same image the VPS deploy
REM actually runs (see Dockerfile, ARCHITECTURE_AND_DEPLOYMENT.md 1.2).
REM This is what to use to reproduce a production-shaped build
REM locally, or to catch a Docker-specific failure (like a missing
REM package.json devDependency) before pushing.
REM
REM Does NOT run the container afterward, this only builds the image.
REM To run it locally after a successful build (from backend\, with a
REM real .env present, see _env.example):
REM   docker run -d --name ttb-label-verify-backend --restart unless-stopped -p 3002:3002 --env-file .env ttb-label-verify-backend
REM
REM Always builds with --no-cache. Docker's layer cache will happily
REM reuse a stale COPY package.json layer if only the file's contents
REM changed but the cache thinks nothing did, silently building against
REM an old package.json. --no-cache costs a slower build but guarantees
REM you're testing what's actually on disk right now.

set SCRIPT_DIR=%~dp0
set BACKEND_DIR=%SCRIPT_DIR%..\backend
set IMAGE_NAME=ttb-label-verify-backend

where docker >nul 2>nul
if errorlevel 1 (
    echo ERROR: docker not found on PATH. Is Docker Desktop installed?
    exit /b 1
)

REM Launches Docker Desktop and waits up to two minutes for the daemon
REM to come up if it isn't already running. This step was dropped when
REM the original build_back.bat was split into build_back_local.bat
REM and build_back_docker.bat, restored here, this script should
REM auto-start Docker the same way the old combined script did.
call "%SCRIPT_DIR%start_docker.bat"
if errorlevel 1 (
    echo.
    echo Docker did not start successfully, aborting.
    pause
    exit /b 1
)

if not exist "%BACKEND_DIR%\Dockerfile" (
    echo ERROR: backend\Dockerfile not found at "%BACKEND_DIR%".
    echo Expected dev_scripts\ and backend\ to be sibling folders.
    exit /b 1
)

cd /d "%BACKEND_DIR%" || (
    echo ERROR: Failed to cd into "%BACKEND_DIR%".
    exit /b 1
)

echo ============================================================
echo  Building Docker image: %IMAGE_NAME%
echo  (--no-cache: always rebuilds from the real package.json/source
echo   on disk right now, not a stale cached layer)
echo ============================================================
docker build --no-cache -t %IMAGE_NAME% .
if errorlevel 1 (
    echo.
    echo ERROR: docker build failed. Scroll up for the actual error,
    echo the summary Docker prints at the bottom only shows an exit
    echo code, not the real failure. If it's collapsed, re-run with:
    echo   docker build --no-cache --progress=plain -t %IMAGE_NAME% .
    exit /b 1
)

echo.
echo ============================================================
echo  Build succeeded: %IMAGE_NAME%
echo  Run it with (from backend\, with a real .env present):
echo    docker run -d --name %IMAGE_NAME% --restart unless-stopped -p 3002:3002 --env-file .env %IMAGE_NAME%
echo ============================================================

endlocal
exit /b 0
