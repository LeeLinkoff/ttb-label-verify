@echo off
REM ============================================================
REM  build_back.bat
REM  Builds and runs the backend in Docker.
REM  Lives in dev_scripts\, project root is one level up.
REM ============================================================

call "%~dp0start_docker.bat"
if errorlevel 1 (
    echo.
    echo Docker did not start successfully, aborting.
    pause
    exit /b 1
)

cd /d %~dp0..\backend

if not exist ".env" (
    echo.
    echo ============================================================
    echo  ERROR: .env file not found in this folder:
    echo  %cd%
    echo.
    echo  Create it by copying the example:
    echo    copy .env.example .env
    echo  Then edit as needed:
    echo    notepad .env
    echo ============================================================
    echo.
    pause
    exit /b 1
)

echo.
echo Building backend image...
docker build -t ttb-label-verify-backend .
if errorlevel 1 (
    echo.
    echo ============================================================
    echo  ERROR: docker build failed. See output above.
    echo ============================================================
    echo.
    pause
    exit /b 1
)

echo.
echo Removing any existing ttb-label-verify-backend container...
docker rm -f ttb-label-verify-backend >nul 2>&1

echo.
echo Starting backend container...
docker run -d --name ttb-label-verify-backend --restart unless-stopped -p 3002:3002 --env-file .env ttb-label-verify-backend
if errorlevel 1 (
    echo.
    echo ============================================================
    echo  ERROR: docker run failed. See output above.
    echo ============================================================
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Backend container is up. Health check:
echo    curl http://127.0.0.1:3002/api/health
echo  Logs:
echo    docker logs -f ttb-label-verify-backend
echo ============================================================
pause
