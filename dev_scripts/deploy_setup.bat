@echo off
REM ============================================================
REM  deploy_setup.bat
REM  Lives in dev_scripts\, but always operates inside ..\secrets
REM  (a sibling folder at the project root), which is gitignored
REM  and safe to contain real key material. Works correctly no
REM  matter which folder you're standing in when you run it.
REM
REM  Does two things:
REM    1. Generates the deploy_key / deploy_key.pub SSH keypair for
REM       this repo, if it doesn't already exist, inside ..\secrets.
REM    2. Sets the GitHub repository secrets deploy-to-vps.yml
REM       needs, via the gh CLI, prompting for each value.
REM
REM  Requires: gh (GitHub CLI), authenticated (gh auth login).
REM
REM  Written with simple, single-line IF statements and goto for
REM  branching rather than nested IF/ELSE ( ) blocks, since nested
REM  parenthetical blocks are fragile in cmd.exe.
REM ============================================================

if not exist "%~dp0..\secrets" mkdir "%~dp0..\secrets"
cd /d %~dp0..\secrets

set "REPO=LeeLinkoff/ttb-label-verify"

gh --version >nul 2>&1
if errorlevel 1 goto no_gh
goto have_gh

:no_gh
echo.
echo ERROR: gh (GitHub CLI) not found or not in PATH.
echo Install it first: https://cli.github.com
echo.
pause
exit /b 1

:have_gh
echo ============================================================
echo  Step 1: SSH keypair
echo ============================================================

if exist "deploy_key" goto key_exists
goto generate_key

:key_exists
echo deploy_key already exists here, skipping generation.
goto show_pubkey

:generate_key
echo Generating a new dedicated keypair for this repo...
ssh-keygen -t ed25519 -C "ttb-label-verify-deploy" -f deploy_key -N ""
if errorlevel 1 goto keygen_failed
echo Generated deploy_key and deploy_key.pub.
goto show_pubkey

:keygen_failed
echo.
echo ERROR: ssh-keygen failed. See output above.
pause
exit /b 1

:show_pubkey
echo.
echo Public key, add this line to the VPS's ~/.ssh/authorized_keys
echo if you haven't already:
echo.
type deploy_key.pub
echo.
echo Sanity check once added:
echo   ssh -i deploy_key ^<user^>@^<host^> "echo it works"
echo.
pause

echo.
echo ============================================================
echo  Step 2: Set GitHub repository secrets for %REPO%
echo ============================================================
echo VPS_HOST, VPS_USER, VPS_PROJECT_PATH, and PUBLIC_HEALTH_URL use
echo this project's known values by default, none of these are
echo secrets, just config. Press Enter to accept the default shown,
echo or type a different value to override it. OPENAI_API_KEY and
echo OPENAI_VISION_MODEL are both required and cannot be left blank.
echo.

set "VPS_HOST=leelinkoff.com"
set /p VPS_HOST=VPS_HOST [%VPS_HOST%]: 
gh secret set VPS_HOST --repo %REPO% --body "%VPS_HOST%"

set "VPS_USER=root"
set /p VPS_USER=VPS_USER [%VPS_USER%]: 
gh secret set VPS_USER --repo %REPO% --body "%VPS_USER%"

if not exist "deploy_key" goto skip_sshkey
echo Setting VPS_SSH_KEY from .\deploy_key ...
gh secret set VPS_SSH_KEY --repo %REPO% < deploy_key
goto sshkey_done
:skip_sshkey
echo No deploy_key found here, skipping VPS_SSH_KEY.
:sshkey_done

set "VPS_PROJECT_PATH=/opt/label-verify"
set /p VPS_PROJECT_PATH=VPS_PROJECT_PATH [%VPS_PROJECT_PATH%]: 
gh secret set VPS_PROJECT_PATH --repo %REPO% --body "%VPS_PROJECT_PATH%"

set "PUBLIC_HEALTH_URL=https://leelinkoff.com/mvps/label-verify/api/health"
set /p PUBLIC_HEALTH_URL=PUBLIC_HEALTH_URL [%PUBLIC_HEALTH_URL%]: 
gh secret set PUBLIC_HEALTH_URL --repo %REPO% --body "%PUBLIC_HEALTH_URL%"

:prompt_openai
set "OPENAI_API_KEY="
set /p OPENAI_API_KEY=OPENAI_API_KEY (required): 
if "%OPENAI_API_KEY%"=="" goto openai_required
gh secret set OPENAI_API_KEY --repo %REPO% --body "%OPENAI_API_KEY%"
goto openai_done

:openai_required
echo ERROR: OPENAI_API_KEY is required and cannot be blank.
goto prompt_openai

:openai_done

:prompt_vision_model
set "OPENAI_VISION_MODEL="
set /p OPENAI_VISION_MODEL=OPENAI_VISION_MODEL (required, e.g. gpt-5.6-terra): 
if "%OPENAI_VISION_MODEL%"=="" goto vision_model_required
gh secret set OPENAI_VISION_MODEL --repo %REPO% --body "%OPENAI_VISION_MODEL%"
goto vision_model_done

:vision_model_required
echo ERROR: OPENAI_VISION_MODEL is required and cannot be blank.
echo extraction.ts has no hardcoded default, deploy-to-vps.yml
echo requires this secret and fails the deploy immediately without
echo it. Confirm current model names against OpenAI's docs first if
echo unsure, model lineups change.
goto prompt_vision_model

:vision_model_done

echo.
echo ============================================================
echo  Done. Verify what's set (names only, gh never shows values):
echo    gh secret list --repo %REPO%
echo ============================================================
pause
