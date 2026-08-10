# TTB Label Verification (Prototype)

## What this app does

Verifies that alcohol beverage label artwork matches the data submitted
on its TTB application. An agent (or, in this prototype, a batch of
label images) is checked against submitted brand name, class/type,
alcohol content, net contents, producer name and address, country of
origin (imports only), and the mandatory Government Warning
statement. The goal is to automate the routine matching work TTB
compliance agents currently do by eye, while flagging anything that
needs human judgment rather than silently auto-approving or
auto-rejecting it.

Built for TTB's take-home assessment. See `DESIGN_CONSIDERATIONS.md`
for the full problem statement, requirements, and the reasoning
behind every scope and design decision made along the way.

**Status: implemented, confirmed against the real API, single and
batch both.** 20 consecutive `/api/verify` runs across both test
labels (10 each): `label1` (fully compliant) `overallMatch: true`
10/10, `label2` (one deliberate 27 CFR 16.22 violation)
`overallMatch: false` 10/10, correctly isolated to the
`warningStatement` field every time, every other field matching
including `countryOfOrigin` (the import case). Average latency 2.65s
across all 20 single-verify runs (range 2.12-3.64s), after switching
`OPENAI_VISION_MODEL` to `gpt-5.6-terra`. Separately, `/api/verify/batch`
itself was submitted both labels together in one real batch request
(not two single-verify calls), `results[0]` (label1) `overallMatch: true`,
`results[1]` (label2) `overallMatch: false` isolated to
`warningStatement`, `labelImages[]`/`applications[]` array-position
matching confirmed correct across two different images. Batch was
then load-tested for real at 50 items (`label1`/`label2` cycled),
50/50 succeeded, 0 failures, 137.6s server-measured (140.4s
client-measured), 2.81s/item average, confirmed on both the client
side and the server console independently. Alcohol content matching
was fixed from a presence/format-only check (a genuinely wrong ABV
would have passed) to a real numeric comparison with a 0.1-point
tolerance, verified against 8 test cases including the actual bug
case, plus a real `tsc --strict` compile check. `extraction.ts`'s
OpenAI call now has a real 30-second timeout, previously a stalled
request would hang indefinitely with no error, especially dangerous
inside `batch.ts`'s sequential loop where one stuck item would have
blocked every item after it forever. See `DESIGN_CONSIDERATIONS.md`
and `REQUIREMENTS_MATCH.md` for the full before/after numbers. See
`backend/README.md` and `frontend/README.md` for the technical
breakdown of each half.

## Where to look, by evaluation criteria

The assessment's own Evaluation Criteria, pointed at the actual
evidence for each rather than left for a reviewer to piece together:

- **Correctness and completeness of core requirements** → `REQUIREMENTS_MATCH.md`
- **Code quality and organization** → services split from the API layer (`backend/services/`), generated OpenAPI schemas so docs can't drift from code
- **Appropriate technical choices for the scope** → `DESIGN_CONSIDERATIONS.md`
- **User experience and error handling** → the `StatusCard`/`ErrorMessage` pattern (generic message, technical detail one click away), per-item batch isolation so one bad label doesn't fail the whole batch
- **Attention to requirements** → the producer name/address and country-of-origin fields, caught and fixed only by checking the code against the requirements doc line by line, documented as a real gap in `DESIGN_CONSIDERATIONS.md` rather than left silent
- **Creative problem-solving** → the CI/CD tooling itself (local testing via `act`, the pre-commit lint hook), both of which caught real bugs before they reached production, not built as a checkbox exercise

## Why reuse, not reinvent

This prototype deliberately starts from an existing, already-deployed
application rather than a blank slate:
[insight-engine-rag](https://github.com/LeeLinkoff/insight-engine-rag),
a live RAG system running in production at leelinkoff.com/mvps/rag/.

Reused directly: the deployment pattern (Docker container behind an
Apache reverse proxy on a self-hosted VPS, restart-safe, no public
port exposure), the CI/CD pipeline shape, and the frontend's visual
design system (color tokens, card/button/input styling).

Built new for this project: the label extraction logic (vision/OCR
instead of text embeddings) and the field-matching logic (exact legal-
text comparison against 27 CFR 16.21 plus tolerant matching on other
fields), which are a genuinely different problem from the RAG use
case and have no equivalent to reuse.

Given the real scope of this assessment against the time available,
reusing a working, battle-tested deployment pattern instead of
standing up new infrastructure from scratch was the pragmatic choice,
not a shortcut. It let effort go toward the part of the problem that
was actually new. It also reflects a plain judgment call: this is
unpaid work, and paying for new hosting just to run a take-home
assessment isn't reasonable. The VPS used here is already running for
other purposes; nothing new was purchased or provisioned for this.

## Structure

```
ttb-label-verify/
├── backend/
│   ├── services/
│   │   ├── extraction.ts
│   │   ├── matching.ts
│   │   └── batch.ts
│   ├── scripts/
│   │   └── generate-openapi-schemas.ts
│   ├── server.ts
│   ├── swagger-spec.ts
│   ├── schemas.generated.ts        (generated at build time, gitignored)
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── .env.example
│   ├── package.json
│   └── README.md
│
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   └── client.js
│   │   ├── components/
│   │   │   ├── StatusCard.jsx
│   │   │   ├── ErrorMessage.jsx
│   │   │   ├── Tabs.jsx
│   │   │   ├── ImageDropzone.jsx
│   │   │   ├── ApplicationDataForm.jsx
│   │   │   ├── MatchResultCard.jsx
│   │   │   ├── BatchResultsTable.jsx
│   │   │   ├── SingleVerifyPanel.jsx
│   │   │   └── BatchVerifyPanel.jsx
│   │   ├── App.jsx
│   │   ├── App.css
│   │   └── main.jsx
│   ├── vite.config.js
│   ├── package.json
│   └── README.md
│
├── dev_scripts/                    (Windows helper scripts, see "Run locally" below)
│
├── tests/
│   ├── label1_image.png
│   ├── label1_text.txt
│   ├── label2_image.png
│   └── label2_text.txt
│
├── .githooks/
│   └── pre-commit
│
├── .github/
│   └── workflows/
│       ├── code-checks.yml
│       └── deploy-to-vps.yml
│
├── secrets/                        (gitignored, holds the deploy SSH keypair, not committed)
├── dev_reports/                    (gitignored, generated by housekeeping scripts)
│
├── README.md
├── ARCHITECTURE_AND_DEPLOYMENT.md
├── DESIGN_CONSIDERATIONS.md
└── REQUIREMENTS_MATCH.md
```

`node_modules/` and build output (`backend/dist/`, `frontend/dist/`) are
omitted above, both are gitignored and rebuilt from source, not part
of the tracked structure.

| Path | What it's for |
|---|---|
| `backend/services/` | The actual label-verification logic: `extraction.ts` (OpenAI vision call), `matching.ts` (field comparison), `batch.ts` (per-item orchestration). No Express dependency, plain functions in, plain data out. |
| `backend/scripts/generate-openapi-schemas.ts` | Generates `schemas.generated.ts` from the real TS interfaces, so the Swagger spec can't drift out of sync with the code. Build-time only. |
| `backend/server.ts` | Thin Express router. Parses requests, calls a service, shapes the response. No business logic. |
| `backend/swagger-spec.ts` | OpenAPI 3.0 spec, `components.schemas` generated, `paths` hand-maintained. |
| `backend/Dockerfile` | Builds the backend image the VPS actually runs, the host itself can't run Node natively. |
| `backend/.env.example` | Template for the real `.env` (`OPENAI_API_KEY`, `OPENAI_VISION_MODEL`), copy and fill in, never commit the real one. |
| `frontend/src/api/client.js` | Every backend `fetch` call in one place: health check, single verify, batch verify. |
| `frontend/src/components/` | The UI itself, see `frontend/README.md`'s Structure section for what each component does. |
| `dev_scripts/` | Local dev, Docker builds, local CI/CD testing, the pre-commit lint hook setup, and housekeeping scripts. Full breakdown in "Run locally" below. |
| `tests/` | Synthetic test label images plus their expected field values, used to exercise `/api/verify` and `/api/verify/batch` against real, known-correct data. |
| `.githooks/pre-commit` | Runs `actionlint`/`shellcheck` against staged workflow YAML and shell scripts, blocks the commit on a syntax error. Wired in via `dev_scripts/setup_git_hooks.bat`. |
| `.github/workflows/` | `code-checks.yml` (every push/PR, never touches the VPS) and `deploy-to-vps.yml` (the only workflow that touches production). |
| `secrets/` | Holds the deploy SSH keypair generated by `dev_scripts/deploy_setup.bat`. Gitignored, never committed. |
| `dev_reports/` | Output of the housekeeping scripts (`git_status.bat` and similar). Gitignored, safe to delete anytime. |
| `README.md` | This file. |
| `ARCHITECTURE_AND_DEPLOYMENT.md` | How the system is put together and how it actually gets deployed. |
| `DESIGN_CONSIDERATIONS.md` | Running log of real decisions made during the build, why, and what they trade off. |
| `REQUIREMENTS_MATCH.md` | The assessment's requirements checked line by line against what's actually implemented. |

## Run locally

Two subsections: every script in `dev_scripts\`, and the equivalent
commands if you'd rather not use a script at all.

### All dev_scripts\ scripts

`dev_scripts\` holds every Windows helper script in this project,
covering local development, Docker builds, local CI/CD testing,
git-hook-based linting, performance testing, and housekeeping. Every
script checks for prerequisites itself and gives a clear error if
something's missing, rather than failing with a confusing raw error
partway through.

**Everyday dev**

| Script | Purpose |
|---|---|
| `run_back.bat` | Install deps and run backend locally (npm) |
| `run_front.bat` | Install deps and run frontend dev server (npm) |
| `build_back_local.bat` | Compile backend WITHOUT Docker (no server start) |
| `build_back_docker.bat` | Build backend Docker image (build only, doesn't run it) |
| `build_front.bat` | Production build of frontend (`dist\`) |

Run `run_back.bat` first, then `run_front.bat` in a second window.

- **`run_back.bat`** — checks `backend\.env` exists (fails with clear
  instructions if not), frees port 3002 if something else is already
  bound to it, runs `npm install`, regenerates `schemas.generated.ts`
  from the service interfaces (required before `server.ts` can even
  load, `swagger-spec.ts` imports it and it doesn't exist on a fresh
  checkout), then `npm run dev` (runs the TypeScript source directly
  via `tsx`, no manual compile step, and auto-restarts on changes).
  This is the fastest day-to-day way to run the backend while
  developing, no Docker involved.

- **`run_front.bat`** — checks `frontend\package.json` exists, runs
  `npm install`, then starts the Vite dev server. Reminds you to have
  `run_back.bat` running in another window first, since the frontend
  proxies `/api/*` to it.

- **`build_back_local.bat`** — compiles the backend WITHOUT Docker:
  `npm install`, regenerates `schemas.generated.ts`, then `npm run build`
  (`tsc`). Does not start the server afterward, use `run_back.bat` for
  dev, or `node dist\server.js` directly once this finishes. Exists to
  confirm the backend actually compiles cleanly without needing Docker
  Desktop running at all, faster feedback than a full Docker build.

- **`build_back_docker.bat`** — builds the backend Docker image, the
  same image the VPS deploy actually runs. Checks Docker is installed
  and the daemon is reachable first, with a clear message if not.
  Always builds with `--no-cache`, Docker's layer cache can otherwise
  reuse a stale `COPY package.json` layer and silently build against
  an old dependency list. Does not run the container afterward, only
  builds the image; prints the `docker run` command to use next.
  Exists because the real deployment target is a Docker container
  behind Apache, so this is how you test the backend the same way it
  actually runs in production, not just how it runs on your machine.

- **`build_front.bat`** — runs the frontend's production build
  (`npm run build`) and verifies `dist\` actually got created.
  Exists to catch a build failure locally before it becomes a
  surprise in CI or on deploy.

**Internal helpers**

Two scripts other scripts call automatically. You'd basically never
run either directly:

| Script | Purpose |
|---|---|
| `start_docker.bat` | Checks Docker is running, launches it and waits if not |
| `act.bat` | Wrapper around `act.exe` used by the CI/CD test runners below |

- **`start_docker.bat`** — checks whether the Docker engine is
  actually running, and if not, launches Docker Desktop and waits up
  to two minutes for it to come up. Exists as a shared helper so
  every script that needs Docker (`act.bat`, `build_back_docker.bat`)
  gets the same clear "Docker isn't ready yet" behavior instead of
  each one failing with a raw, confusing error from Docker itself.

- **`act.bat`** — thin wrapper around the real `act.exe` binary.
  Calls `start_docker.bat` first, then always `cd`s to the project
  root before invoking `act`, since `act` treats whatever directory
  it's run from as the repo root and has no separate flag to point it
  elsewhere. Every other script that uses `act` calls this wrapper
  rather than invoking `act.exe` directly, so that Docker-check and
  path-fixing logic only has to live in one place.

**Local CI/CD test runners**

Run both GitHub Actions workflows locally via `act` before pushing.
See "Why test locally with act" under CI/CD below for why this
matters and the real bug it caught.

| Script | Purpose |
|---|---|
| `test_code_checks_yml.bat` | Runs `boot-test` locally, safe |
| `test_deploy_yml.bat` | Runs ONLY `verify-build` locally, safe |

- **`test_code_checks_yml.bat`** — runs the `boot-test` job (and its
  `type-check` dependency, which itself regenerates OpenAPI schemas
  before type-checking) from `code-checks.yml` via `act`. Exists so a
  broken type check or a broken health/docs/verify check is caught in
  seconds locally, not minutes later on GitHub. No secrets needed,
  this workflow never touches the VPS.

- **`test_deploy_yml.bat`** — runs only the `verify-build` job from
  `deploy-to-vps.yml` via `act`, using `-j verify-build` to
  deliberately exclude the `deploy` job from running, that job
  genuinely modifies the live VPS and isn't something to trigger
  through a local test run.

**Pre-commit lint hook**

Blocks a commit if staged workflow YAML or shell scripts have a real
syntax error. See "Pre-commit hook" under CI/CD below for why this
exists and the real bug it caught.

| Script | Purpose |
|---|---|
| `setup_git_hooks.bat` | One-time per-clone setup: points git at `.githooks\` |
| `lint_workflows.bat` | Run the same check on demand, no staging/commit required |

- **`setup_git_hooks.bat`** — runs `git config core.hooksPath
  .githooks`, one-time per clone (this setting isn't itself tracked
  by git, so a fresh clone needs this run once). After this, `git
  commit` runs the checks automatically; `git commit --no-verify`
  skips them for a single commit if ever needed.

- **`lint_workflows.bat`** — runs `actionlint` against everything in
  `.github\workflows\` right after editing a workflow file, without
  needing to stage or commit first.

Requires `actionlint` and `shellcheck` on `PATH`:
```
choco install actionlint shellcheck
```
(or `scoop install actionlint shellcheck`, or `winget install
actionlint` plus `winget install --id koalaman.shellcheck`)

**Performance testing (PowerShell)**

Five scripts for exercising `/api/verify` and `/api/verify/batch`
directly against a real backend, used to measure the actual latency
Sarah's "about 5 seconds" requirement is judged against, load-test
batch volume, and diagnose a mismatch or a hang instead of guessing
at any of it.

**Confirmed result** (2026-08-09, `tests/label1_*` + `tests/label2_*`,
`OPENAI_VISION_MODEL=gpt-5.6-terra`): 20/20 runs succeeded across
both label pairs (10 each). `label1` (compliant): `overallMatch: true`
10/10. `label2` (one deliberate warning-format violation):
`overallMatch: false` 10/10, correctly isolated to
`warningStatement` every time, every other field matching including
`countryOfOrigin`. Average latency 2.65s across all 20 runs (range
2.12-3.64s). This replaced an earlier 5-8s range measured against the
bare `gpt-5.6` alias, which silently routes to the flagship `sol`
tier, not a sensible default for straightforward structured
extraction. Separately, a real `/api/verify/batch` request submitting
both labels together confirmed `labelImages[]`/`applications[]`
array-position matching, `results[0]` `overallMatch: true`,
`results[1]` `overallMatch: false` isolated to `warningStatement`.
Batch was then load-tested for real at 50 items (`label1`/`label2`
cycled), 50/50 succeeded, 0 failures, 137.6s server-measured (140.4s
client-measured), 2.81s/item average, confirmed independently on both
the client and the server console. Full 200-300 was not run, real
API cost on an unpaid assessment, see `REQUIREMENTS_MATCH.md` for the
honest extrapolation from this real number. See
`DESIGN_CONSIDERATIONS.md` for the full story.

| Script | Purpose |
|---|---|
| `benchmark_verify.ps1` | Runs `/api/verify` against every label pair in `tests\`, `$RunsPerImage` times each (default 10), reports per-image and overall average/min/max latency |
| `debug_verify.ps1` | Runs `/api/verify` once per label pair in `tests\`, prints every field's match/needsReview/extracted/applied side by side |
| `test_batch_verify.ps1` | Submits every label pair in `tests\` together in ONE real `/api/verify/batch` request, confirms `labelImages[]`/`applications[]` array-position matching actually works, not just repeated single-verify calls |
| `test_batch_volume.ps1` | Duplicates `label1`/`label2` up to `$TargetCount` items (default 50) and submits them in ONE real batch request, times it, confirms every item completes, real throughput/stability test at volume |
| `debug_verify_label1_loop.ps1` | Runs `/api/verify` against `label1` `$Runs` times (default 15), prints a one-line summary per run, full field detail only on an actual failure, built to catch and diagnose an intermittent result without wading through successful output first |

- **`benchmark_verify.ps1`** — discovers every `labelN_image.*` in
  `tests\` with a matching `labelN_text.txt` (not hardcoded to
  `label1`) and runs `$RunsPerImage` requests (default 10) against
  each, builds the multipart request manually via .NET's
  `HttpClient` rather than `Invoke-RestMethod -Form`, which only
  exists in PowerShell 6.1+ (`pwsh`) and fails outright on Windows
  PowerShell 5.1 (the default `powershell.exe` on Windows) with "A
  parameter cannot be found that matches parameter name 'Form'".
  This version works on both. Checks `/api/health` first and fails
  fast with one clear message if the backend isn't reachable, rather
  than grinding through every run and hitting the same connection
  error repeatedly. Application data fields are parsed directly from
  each image's matching `_text.txt` at run time, not duplicated as
  literal strings in the script, an earlier version did duplicate
  them, which meant the script and the test fixture could silently
  drift apart, exactly the class of bug this whole project's docs
  kept catching elsewhere.

- **`debug_verify.ps1`** — same discovery and health check as above,
  but runs each pair once and prints the full `MatchResult` field by
  field instead of just `overallMatch`. Written after `overallMatch:
  false` on a supposedly fully-compliant test label turned out to
  have two separate real causes stacked at once: `tests\label1_image.png`
  was still an old test image (wrong brand name printed on it), and
  `matching.ts` was a stale version that never compared the newer
  `producerName`/`producerAddress`/`countryOfOrigin` fields at all.
  Neither cause was visible from `overallMatch` alone, this script
  exists so that class of problem is diagnosable immediately instead
  of guessed at one theory at a time.

- **`test_batch_verify.ps1`** — the one gap `benchmark_verify.ps1`
  and `debug_verify.ps1` don't cover: both call `/api/verify`
  (single-label) repeatedly, neither actually exercises
  `/api/verify/batch`. This script submits every discovered pair
  together in one real batch request, confirming
  `labelImages[]`/`applications[]` array-position matching actually
  holds across multiple different images, not assumed from the
  single-verify results alone. `ConvertTo-Json -AsArray` is
  deliberately not used to build the request body, that parameter
  doesn't exist in Windows PowerShell 5.1 either, same class of
  version gap as `-Form`, the JSON array brackets are built manually
  instead.

- **`test_batch_volume.ps1`** — tests throughput and stability at
  volume, not extraction accuracy across unique labels, only 2 real
  labels exist, duplicated up to `$TargetCount`. Prints a heartbeat
  every 5 seconds while waiting (a 50-item batch takes ~2 minutes,
  and the endpoint sends zero response bytes until every item
  finishes, a silent multi-minute wait looks identical to a hang
  without one). Costs real OpenAI API usage proportional to
  `$TargetCount`, a 3-second cancel window prints before sending.
  Real incident this script exposed: `extraction.ts`'s OpenAI call
  had no timeout at all, a single stalled request would have hung
  the entire sequential batch forever with no error and no way to
  tell from the client whether the backend was working, hung, or had
  crashed, all three looked identical. Fixed with a real 30-second
  timeout in `extraction.ts`, and `services/batch.ts` now logs
  per-item start/success/failure to the console so a run can be
  diagnosed from the server side too, not just the client.

- **`debug_verify_label1_loop.ps1`** — built after `benchmark_verify.ps1`
  showed a single `overallMatch: false` on `label1` (expected `true`
  every time) buried among otherwise-clean runs, with no per-field
  detail available to diagnose it. This script runs `label1` alone,
  repeatedly, staying quiet on success and printing full field detail
  only on an actual failure. 15 runs after the original anomaly
  reproduced zero failures, consistent with transient model-response
  variance on that one call rather than a code defect, documented as
  such rather than either dismissed or treated as an unresolved bug.

**Housekeeping and diagnostics**

Not needed day to day, but useful when something's unclear or things
have accumulated cruft. The four report-generating scripts below
create `dev_reports\` at the project root the first time any of them
runs. That folder is gitignored and safe to delete anytime, nothing
in it is needed for the app to run, it's just where these reports
get written and reused (each script overwrites its own file on the
next run rather than piling up new ones).

| Script | Purpose |
|---|---|
| `git_status.bat` | Dump full local + remote git status to a report |
| `git_staged_diff_report.bat` | Dump staged (`git add`'d) changes to a report |
| `git_unstaged_diff_report.bat` | Dump unstaged (working tree) changes to a report |
| `docker_status.bat` | Dump full Docker status (images, containers, disk usage) to a report |
| `clean_act.bat` | Clear act/Docker caches to reclaim disk space |
| `clear_actions_history.bat` | Delete all GitHub Actions run history for this repo (via `gh` CLI) |
| `uninstall_act.bat` | Fully remove act if you're done with local workflow testing |
| `deploy_setup.bat` | Generate the deploy SSH keypair and set GitHub deploy secrets |

- **`git_status.bat`** — writes current branch, remotes, all local
  and remote-tracking branches with ahead/behind counts, full status,
  staged/unstaged diff stats, last 10 commits, unpulled and unpushed
  commits, and any stashes to `dev_reports\git_status_report-SAFE_TO_DELETE.txt`,
  then opens it in Notepad. Useful when `git status` alone doesn't
  give enough context, e.g. figuring out exactly how far a branch has
  diverged from `origin` before deciding whether to push, pull, or
  rebase.

- **`git_staged_diff_report.bat`** — writes the full diff of
  everything currently staged (`git add`'d, not yet committed) to
  `dev_reports\staged-diffs-SAFE_TO_DELETE.txt` and opens it in
  Notepad. Exists to let you review exactly what's about to be
  committed in one readable file, rather than scrolling through
  `git diff --cached` in a terminal. Excludes the `secrets\` folder
  from the diff.

- **`git_unstaged_diff_report.bat`** — same idea, but for unstaged
  working-tree changes (what shows red in `git status`), written to
  `dev_reports\all-diffs-SAFE_TO_DELETE.txt`. Also excludes `secrets\`.

- **`docker_status.bat`** — writes Docker version, engine info,
  running and stopped containers, images, dangling images, networks,
  volumes, and disk usage to
  `dev_reports\docker_status_report-SAFE_TO_DELETE.txt`, then opens
  it in Notepad. Useful when a Docker build or run is behaving
  strangely and `docker ps` alone doesn't give the full picture.

- **`clean_act.bat`** — clears act's action cache and config folder,
  and prunes stopped containers and dangling images. Deliberately
  leaves the `catthehacker/ubuntu:act-latest` base image in place
  (prints the manual removal command if you want it gone too), since
  removing it means the next `act` run has to re-download roughly
  500MB. Exists to reclaim disk space after repeated local testing
  without losing the ability to test quickly again.

- **`clear_actions_history.bat`** — deletes all GitHub Actions
  workflow run history for this repo (both `code-checks.yml` and
  `deploy-to-vps.yml`) via the `gh` CLI. Does not touch the workflow
  files themselves, only the run logs shown in the Actions tab.
  Requires `gh` installed and authenticated (`gh auth login`), and
  asks for a typed `YES` confirmation before deleting anything, since
  this is destructive and not reversible.

- **`uninstall_act.bat`** — fully removes the `act.exe` binary, its
  cache, and its config, not just the cache like `clean_act.bat`
  does. Use this only when actually done with local workflow testing,
  since `act.bat` and both `test_*.bat` scripts stop working after
  this runs. Asks for a typed `YES` confirmation first.

- **`deploy_setup.bat`** — generates the `deploy_key`/`deploy_key.pub`
  SSH keypair for this repo if one doesn't already exist, always
  inside `..\secrets\` (creates that folder if needed) regardless of
  which directory you run the script from, since `secrets\` is
  gitignored and safe to hold real key material. Prints the public
  key so it can be added to the VPS's `authorized_keys`, then walks
  through setting each `deploy-to-vps.yml` repository secret via the
  `gh` CLI. `VPS_HOST`, `VPS_USER`, `VPS_PROJECT_PATH`, and
  `PUBLIC_HEALTH_URL` aren't actual secrets, just config, so those
  four prompts show this project's real default value in brackets,
  press Enter to accept it or type over it to change. `VPS_SSH_KEY`
  is set automatically from the generated `deploy_key` file, no
  prompt.

  **`OPENAI_API_KEY`** and **`OPENAI_VISION_MODEL`** are both
  genuinely required, the script loops with a clear error until a
  real value is entered for each, it will not let you leave either
  blank and move on. This matches what `deploy-to-vps.yml`'s
  required-secrets check actually enforces, a clean run of this
  script now always produces a repo that can deploy.

  Requires `gh` installed and authenticated (`gh auth login`). Written with
  `goto`-based branching rather than nested `if/else ( )` blocks,
  since nested parenthetical blocks are fragile in `cmd.exe`,
  particularly across files with inconsistent line endings.

### Commands you can run locally outside of scripts

Everything above wraps these same underlying commands with
prerequisite checks and clearer error messages. Here's the manual,
any-OS equivalent, no `.bat`/`.ps1` needed.

**Backend**

```
cd backend
npm install
cp .env.example .env
npm run generate:schemas
npm run dev
```

`npm run generate:schemas` regenerates `schemas.generated.ts` from the
service interfaces. `swagger-spec.ts` imports it, and it doesn't exist
on a fresh checkout, `server.ts` (and therefore `npm run dev`) fails
immediately without this step.

Backend runs on `http://localhost:3002`.
Health check: `http://localhost:3002/api/health`
API docs: `http://localhost:3002/api/docs`

**Frontend**

```
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5174` and proxies `/api/*` to the
backend on port 3002.

## CI/CD

Two GitHub Actions workflows in `.github/workflows/`:

```
code-checks.yml      Runs on every push and pull request to main.
                     Regenerates OpenAPI schemas, type-checks the
                     backend under strict TypeScript, boots the real
                     compiled server, and confirms /api/health,
                     /api/docs, and /api/verify all behave correctly.
                     Never touches the VPS.
deploy-to-vps.yml    Runs on every push to main (or manually).
                     Re-verifies the build, then SSHes into the
                     VPS, syncs source, rebuilds the backend
                     container, rebuilds the frontend, and
                     publishes it. The only workflow that touches
                     production.
```

> **⚠ One manual step required before this works, and it's not
> automated by design.** `deploy-to-vps.yml` deploys the app, but it
> does not configure Apache. Until Apache has a `ProxyPass` rule
> pointing `/mvps/label-verify/api/` at the backend container, the
> pipeline's final health-check step will fail with a 404, exactly
> the failure this project hit on its first real deploy. This is a
> one-time setup step, not something that needs repeating on future
> deploys. See `ARCHITECTURE_AND_DEPLOYMENT.md` section 2.4 for the
> real config file path, the exact block to add, why the service is
> named `httpd` rather than `apache2` on this specific VPS, and a
> real gotcha confirmed on this exact server: `systemctl restart httpd`
> reports success but doesn't actually reload the config, use
> `/usr/local/cpanel/scripts/restartsrv_httpd --graceful` instead.

### Why test locally with act, not just push and see

Pushing a broken workflow file to GitHub means finding out it's
broken minutes later, on GitHub's runner, disconnected from the
terminal you're actually working in, then fixing it, pushing again,
and waiting again. `act` (https://github.com/nektos/act) runs the
same workflow file in Docker on this machine, so a mistake in the
YAML itself, not just the application code, gets caught in seconds,
locally, before it's ever pushed. The actual scripts that do this
(`test_code_checks_yml.bat`, `test_deploy_yml.bat`) are documented
under "Run locally" above, alongside every other script in this
project, not repeated here.

This isn't hypothetical: while building this project, `act` caught a
real bug this way, a "confirm required secrets are set" check had
been placed in the wrong job (`verify-build`, which is supposed to be
safe and secret-free to run locally) instead of the right one
(`deploy`, which actually needs those secrets). Running
`test_deploy_yml.bat` surfaced that immediately, as a clear failed
step with a readable log, rather than as a confusing failure
discovered only after pushing.

### Pre-commit hook: catches broken workflow/shell syntax before it's committed

`act` (above) catches a broken workflow *step's logic* before it's
pushed, but it still has to actually execute the step to find out,
and it won't catch every kind of failure until that step runs. A
plain bash syntax error inside a `run:` block is a narrower, cheaper
class of bug to catch, and one that got past review once already:
an apostrophe inside a single-quoted `ssh '...'` remote command in
`deploy-to-vps.yml` (`cPanel's`, closing the quote early) reached a
real GitHub Actions run and broke `deploy-to-vps.yml`'s "Confirm
Apache has the ProxyPass rule" step in production, not just locally.

A git pre-commit hook now runs
[`actionlint`](https://github.com/rhysd/actionlint) against any
staged `.github\workflows\*.yml` file and
[`shellcheck`](https://github.com/koalaman/shellcheck) against any
staged `*.sh` file, and blocks the commit if either finds a problem.
`actionlint` runs `shellcheck` internally against every embedded
`run:` block, so this catches shell syntax errors inside workflow
YAML, not just standalone scripts, the exact bug above included:
`actionlint` correctly flags it as `SC1011: This apostrophe
terminated the single quoted string!`, pointing at the exact line.
The scripts that set this up and run it on demand
(`setup_git_hooks.bat`, `lint_workflows.bat`) are documented under
"Run locally" above.

## Potential improvements (not implemented)

Not built, not planned for this submission. Noted here as optional
future work, only worth picking up at leisure if this gets polished
into a longer-term showcase MVP later:

- **Configurable government warning text**, editable in the UI
  instead of hardcoded in `matching.ts`. Bottom line: when 27 CFR
  16.21's text changes, "edit `matching.ts` and redeploy" shouldn't
  be the only path to updating it. Not a casually-editable text
  field, though, whatever replaces the hardcoded constant needs real
  verification logic built in, access control and a change log alone
  don't confirm the new text is actually correct. Three pieces,
  chained together, not three separate alternatives to pick one of:

  1. **Attempt an automatic pull first**: eCFR (ecfr.gov) has a real
     public API (confirmed, `https://www.ecfr.gov`, documented at
     `ecfr.gov/developers/documentation/api/v1`, maintained by the
     National Archives/GPO) that can be queried for the current text
     of 27 CFR 16.21. Use it to fetch the live text and diff it
     against what's about to be saved.
  2. **Fall back to manual entry if the pull fails**: API
     unreachable, the section moved/was renumbered, the response
     doesn't parse cleanly, whatever the reason, don't block the
     update on a third-party API's uptime, let a person paste in the
     text by hand instead.
  3. **Either path ends at a required electronic signature before
     the change takes effect, not just a logged approval click.**
     This step isn't optional even when the automatic pull succeeds
     and matches cleanly: eCFR's own documentation describes it as
     "authoritative but unofficial," typically current within about
     two business days of a real Federal Register change, not the
     official legal edition. An automatic match is strong evidence,
     not proof, so it should make signing off faster (the diff is
     already done, ready to review) rather than replace the sign-off
     entirely. The electronic signature is what makes this
     defensible later: a specific, identified person attested that
     this exact text was correct as of this exact date.

  This is federally regulated text with real compliance consequences
  if it's ever wrong, not a style preference, and the verification
  chain above is the actual point, not an afterthought bolted onto
  an editable field.

- **Result persistence**, verification results currently only exist
  in the HTTP response and are gone once the frontend discards them,
  no history, no lookup. Would need a real retention-policy decision
  first, this prototype was deliberately built to store nothing.

- **Configurable logging** (`none` / `summary` / `verbose`). Partially
  addressed: `services/batch.ts` now logs per-item start/success/
  failure with elapsed time to the console (added after a real
  incident, a batch request failed with zero server-side output,
  impossible to tell whether the backend had crashed, hung, or was
  working fine, all three looked identical). That's fixed logging,
  always on, not the configurable `none`/`summary`/`verbose` levels
  described here, and `server.ts`/`extraction.ts`/`matching.ts` still
  have no logging of their own outside that one addition. The
  configurable-levels version remains unbuilt.

- **Configurable AI endpoint URL and extraction prompt**, both are
  currently hardcoded in `extraction.ts`
  (`OPENAI_CHAT_COMPLETIONS_URL` as a constant, `EXTRACTION_PROMPT` as
  a template string), changing either means editing source and
  redeploying. Bottom line, same as the warning-text item above: an
  easier update path than editing source is the goal. Making both
  env-configurable (or admin-UI-configurable) would let the endpoint
  point at a different provider or region without a code change, and
  let the extraction prompt be tuned (wording, added fields,
  different model instructions) without touching
  `services/extraction.ts` directly. Real trade-off worth flagging:
  the prompt currently encodes real regulatory logic (exactly what
  counts as bold/all-caps for the warning statement per 27 CFR
  16.22), so a UI-editable prompt needs the same verification-before-
  it-takes-effect treatment as the warning-text item, not an open
  text field with no check against what the regulation actually
  requires.

These are listed here because they have real value, not as padding.
None of them are in scope for this specific TTB assessment, the
assessment asked for label verification, not a configuration or
admin system, and building any of them now would be scope creep
against what was actually requested. But this app's underlying
structure (services split from the API layer, generated OpenAPI
schemas, the CI/CD and pre-commit tooling) is general enough to be
reused as a starting point for other projects later, and in that
context, several of these stop being optional. A version of this app
handling a different document type, or a different regulated
industry, would likely need configurable extraction logic and some
form of persistence from day one, not as an afterthought. Worth
having written down now, while the reasoning is fresh, rather than
re-deriving it from scratch on some future project.

## Approach, tools, and assumptions

See `DESIGN_CONSIDERATIONS.md` for the running log of decisions made
during this build (time constraint, judgment-call defaults, matching
approach, deployment choices) and why.
