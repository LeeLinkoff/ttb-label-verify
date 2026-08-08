@echo off
REM ============================================================
REM  act.bat
REM  Wrapper for act.exe that checks/starts Docker first, since
REM  act requires Docker and gives a confusing error if it's not
REM  running rather than a clear one.
REM
REM  act treats whatever directory it's run FROM as the repo root,
REM  there is no separate flag to decouple that. This script always
REM  cd's to the project root (one level up from dev_scripts\)
REM  before calling act.exe, so it works correctly no matter which
REM  folder you were standing in when you ran it, including running
REM  act.bat directly from inside dev_scripts\ itself.
REM
REM  Forwards all arguments straight through to the real act.exe.
REM ============================================================

call "%~dp0start_docker.bat"
if errorlevel 1 (
    echo.
    echo Docker did not start successfully, aborting.
    pause
    exit /b 1
)

cd /d "%~dp0.."

if not exist ".github\workflows" (
    echo.
    echo ============================================================
    echo  ERROR: No .github\workflows folder found in:
    echo  %cd%
    echo.
    echo  This usually means act.bat isn't sitting inside the
    echo  project's dev_scripts\ folder where it expects to be.
    echo  Confirm this file is at:
    echo    ^<project root^>\dev_scripts\act.bat
    echo  and that ^<project root^>\.github\workflows\ actually exists.
    echo ============================================================
    echo.
    pause
    exit /b 1
)

"C:\Program Files\act_Windows_x86_64\act.exe" %*
