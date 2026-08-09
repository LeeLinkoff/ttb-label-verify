@echo off
REM ============================================================
REM  setup_git_hooks.bat
REM
REM  One-time per-clone setup: points git at the repo's own
REM  versioned hooks folder (.githooks) instead of the default,
REM  unversioned .git\hooks\, so the pre-commit lint check
REM  (actionlint + shellcheck against staged GitHub Actions
REM  workflows and shell scripts) is shared across every
REM  clone/machine instead of being local-only and easy to lose.
REM
REM  Safe to re-run any time.
REM ============================================================

cd /d %~dp0..

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
    echo.
    echo ERROR: not inside a git repository ^(ran from "%cd%"^).
    pause
    exit /b 1
)

git config core.hooksPath .githooks
if errorlevel 1 (
    echo.
    echo ERROR: git config failed. See output above.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Git hooks path set to .githooks
echo.
echo  From now on, "git commit" runs actionlint against any staged
echo  .github\workflows\*.yml files, and shellcheck against any
echo  staged *.sh files, before the commit is allowed through.
echo.
echo  Requires actionlint and shellcheck on PATH. If not installed:
echo    choco install actionlint shellcheck
echo    scoop install actionlint shellcheck
echo    winget install actionlint
echo    winget install --id koalaman.shellcheck
echo.
echo  To skip the check for a single commit: git commit --no-verify
echo ============================================================
pause
