@echo off
setlocal

REM build_back_local.bat
REM
REM Builds the backend WITHOUT Docker: installs deps, regenerates
REM schemas.generated.ts, compiles TypeScript to dist/. Does not run
REM the server afterward, use run_back.bat for that, or
REM "node dist\server.js" directly once this finishes.
REM
REM This does NOT produce what actually runs in production, that's
REM build_back_docker.bat / the Dockerfile. This is for local
REM development and for confirming the backend compiles cleanly
REM without needing Docker Desktop running at all.

set SCRIPT_DIR=%~dp0
set BACKEND_DIR=%SCRIPT_DIR%..\backend

if not exist "%BACKEND_DIR%\package.json" (
    echo ERROR: backend\package.json not found at "%BACKEND_DIR%".
    echo Expected dev_scripts\ and backend\ to be sibling folders.
    exit /b 1
)

cd /d "%BACKEND_DIR%" || (
    echo ERROR: Failed to cd into "%BACKEND_DIR%".
    exit /b 1
)

echo ============================================================
echo  Installing dependencies
echo ============================================================
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed.
    exit /b 1
)

echo.
echo ============================================================
echo  Regenerating OpenAPI schemas from services/*.ts
echo ============================================================
call npm run generate:schemas
if errorlevel 1 (
    echo ERROR: npm run generate:schemas failed.
    echo Common cause: ts-json-schema-generator or ts-node missing from
    echo package.json devDependencies, or "generate:schemas" script missing.
    exit /b 1
)

echo.
echo ============================================================
echo  Compiling TypeScript (strict) to dist\
echo ============================================================
call npm run build
if errorlevel 1 (
    echo ERROR: npm run build failed. See tsc output above.
    exit /b 1
)

echo.
echo ============================================================
echo  Build succeeded. Run it with:
echo    node dist\server.js
echo  or from dev_scripts\: run_back.bat
echo ============================================================

endlocal
exit /b 0
