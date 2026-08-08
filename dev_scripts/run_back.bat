@echo off
cd /d %~dp0..\backend

echo Checking for .env file...

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

echo .env found.
echo.

echo Checking if port 3002 is already in use...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :3002 ^| findstr LISTENING') do (
    echo Found PID %%p listening on port 3002, killing it...
    taskkill /PID %%p /F >nul 2>&1
)
echo Port 3002 check complete.
echo.

call npm install
if errorlevel 1 (
    echo.
    echo ============================================================
    echo  ERROR: npm install failed. See output above.
    echo ============================================================
    echo.
    pause
    exit /b 1
)

REM Runs server.ts directly via tsx, no manual compile step needed.
REM Watches for changes and restarts automatically. Production uses
REM the compiled dist/server.js instead, via build_back.bat/Docker.
call npm run dev

echo.
echo ============================================================
echo  Dev server exited. If this was unexpected, scroll up to see
echo  the error printed above.
echo ============================================================
pause
