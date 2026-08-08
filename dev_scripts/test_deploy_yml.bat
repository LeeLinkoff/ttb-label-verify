@echo off
REM ============================================================
REM  test_deploy_yml.bat
REM  Runs ONLY the verify-build job from deploy-to-vps.yml,
REM  locally, via act. Safe: this job never touches the VPS or
REM  any secrets.
REM
REM  IMPORTANT: this deliberately does NOT run the "deploy" job.
REM  That job actually SSHes into the real production VPS and
REM  modifies it for real (rebuilds containers, overwrites files,
REM  restarts the backend). Running that through act would NOT
REM  be a safe local test, it would genuinely deploy to the live
REM  server. Only verify-build is safe to run this way.
REM
REM  act treats whatever directory it's run FROM as the repo
REM  root, there is no separate flag to decouple that. This
REM  script cd's to the actual repo root internally first, so it
REM  works correctly regardless of which folder you started in.
REM ============================================================

cd /d "%~dp0.."

call "%~dp0act.bat" push -j verify-build -W .github/workflows/deploy-to-vps.yml

echo.
echo ============================================================
echo  This only tested verify-build (safe, no VPS involved).
echo  The "deploy" job was NOT run, it requires real VPS secrets
echo  and would genuinely modify your production server, that is
echo  not something to test through a local run like this.
echo ============================================================
pause
