@echo off
REM ============================================================
REM  test_code_checks_yml.bat
REM  Runs the boot-test job (and its syntax-check dependency)
REM  from code-checks.yml locally via act. Safe: this workflow
REM  never touches the VPS or any secrets, and doesn't currently
REM  need an API key (services/extraction.js isn't implemented
REM  yet). Once it calls a real vision/OCR provider, this script
REM  will need updating to pass a secret through, the same way
REM  insight-engine-rag's test_ci_yml.bat reads OPENAI_API_KEY
REM  from backend\.env.
REM
REM  act treats whatever directory it's run FROM as the repo
REM  root, there is no separate flag to decouple that. This
REM  script cd's to the actual repo root internally first, so it
REM  works correctly regardless of which folder you started in.
REM ============================================================

cd /d "%~dp0.."

call "%~dp0act.bat" push -j boot-test -W .github/workflows/code-checks.yml

echo.
pause
