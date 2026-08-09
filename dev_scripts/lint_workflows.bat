@echo off
REM ============================================================
REM  lint_workflows.bat
REM
REM  Runs actionlint against every workflow in .github\workflows\
REM  (actionlint auto-detects them, no args needed), regardless of
REM  what's staged in git. Use this right after editing a workflow
REM  file, not just at commit time via the pre-commit hook, see
REM  setup_git_hooks.bat.
REM
REM  actionlint also runs shellcheck internally against every
REM  embedded `run:` block, so this catches both YAML-level
REM  mistakes (bad `${{ }}` expressions, wrong input names) and
REM  shell syntax errors inside `run:` scripts in one pass.
REM ============================================================

where actionlint >nul 2>nul
if errorlevel 1 (
    echo.
    echo ERROR: actionlint not found on PATH.
    echo Install with one of:
    echo   choco install actionlint
    echo   scoop install actionlint
    echo   winget install actionlint
    echo.
    pause
    exit /b 1
)

cd /d %~dp0..

echo.
echo ============================================================
echo  Running actionlint on .github\workflows\...
echo ============================================================
actionlint
if errorlevel 1 (
    echo.
    echo ============================================================
    echo  actionlint found problems, see output above.
    echo ============================================================
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  No problems found.
echo ============================================================
pause
