@echo off
cd /d %~dp0..\frontend

if not exist "package.json" (
    echo.
    echo ============================================================
    echo  ERROR: No package.json found in this folder:
    echo  %cd%
    echo ============================================================
    echo.
    pause
    exit /b 1
)

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

echo.
echo Reminder: make sure run_back.bat is already running in
echo another window before you open the app in a browser.
echo.
echo Starting Vite dev server...
echo.
call npm run dev

echo.
echo ============================================================
echo  Dev server exited. If this was unexpected, scroll up to see
echo  the error printed above.
echo ============================================================
pause
