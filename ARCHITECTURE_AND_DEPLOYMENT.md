# TTB Label Verification — Architecture and Deployment

This document covers how the system is put together and how it gets
to production. Unlike insight-engine-rag, deployment here was
automated from day one via `deploy-to-vps.yml` rather than built
manually first, so this is written as reference and manual-fallback
documentation, not a step-by-step first-deploy walkthrough. If the
pipeline itself ever needs debugging, this is what it's actually
doing under the hood.

**A note on scope:** some of what's below (the exact Apache config
path, the `httpd` vs `apache2` naming, the cPanel-specific restart
command) is specific to this particular Bluehost VPS, not general
best practice or something the assessment itself asked for. It's kept
here in detail because it's genuinely useful for maintaining this
deployment later, not because it's meant to be evaluated. The
architecture decisions (why TypeScript, why this service split, why
this deployment pattern) are the parts actually worth reading closely.

---

# PART 1: ARCHITECTURE

---

## 1.1 System overview

```
Browser
    |
    v
Apache (HTTPS) -- leelinkoff.com
    |
    |-- /mvps/label-verify/api/*   --->  Docker container (127.0.0.1:3002, internal only)
    |
    |-- /mvps/label-verify/*       --->  /home/leelinko/public_html/mvps/label-verify (static files)
```

Same shape as insight-engine-rag, deliberately: Apache terminates
HTTPS and reverse-proxies API traffic to a backend container that
never exposes a public port directly, static frontend files are
served straight off disk. Two apps, two subpaths, two internal
ports (3001 for RAG, 3002 for this one), one VPS, one Apache config.

### Where things actually live on the VPS

Three different locations matter, and they are not the same thing:

| Location | What it is | Is it served publicly? |
|---|---|---|
| `/opt/label-verify` (`VPS_PROJECT_PATH`) | Where `deploy-to-vps.yml` rsyncs the source code to, and where both the backend's Docker build and the frontend's throwaway-container build happen. Contains `backend/` and `frontend/` source, plus `frontend/dist/` after a build. | **No.** This is a build/staging location only. Nothing under this path is reachable from a browser. |
| `backend/Dockerfile` (a real, plain text file, at `/opt/label-verify/backend/Dockerfile` on the VPS) | The build recipe: base image, what to copy in, `npm install`, `npx tsc`, what command to run. This is the only thing in this whole chain that's an actual file you can open and read. Never modified or consumed during deploy, `docker build` just re-reads it each time. | N/A, it's source, not a runtime artifact. |
| Docker **image** `ttb-label-verify-backend`, built by `docker build` reading the Dockerfile above | A static, inert template, compiled TypeScript + `node_modules`, stored inside Docker's own internal storage on the VPS, not a file you'd browse to directly. Built but not running. | No, images don't run. |
| Docker **container** `ttb-label-verify-backend` | A live, running instance created *from* that image. This is the actual running process, the thing listening on `127.0.0.1:3002`. Same name string as the image above by convention here, but a genuinely different Docker object, list images with `docker images`, list containers with `docker ps -a`. | **No**, not directly. Only reachable through Apache's reverse proxy. |
| `/home/leelinko/public_html/mvps/label-verify` | Where the frontend's *built* output (`/opt/label-verify/frontend/dist/*`) gets copied to after each build. This is Apache's actual document root for this app's static files. | **Yes.** This is what a browser actually receives when it requests `/mvps/label-verify/*`. |

The backend's chain, spelled out:

```
backend/Dockerfile (real file, synced to /opt/label-verify/backend/)
    |  read by `docker build`
    v
Docker image "ttb-label-verify-backend" (not a file, Docker's internal storage)
    |  instantiated by `docker run`
    v
Docker container "ttb-label-verify-backend" (the actual running process, listens on 127.0.0.1:3002)
```

So the flow for the frontend specifically is: source lives in
`/opt/label-verify/frontend`, gets built into
`/opt/label-verify/frontend/dist`, then that build output gets
copied (via `rsync`) into `/home/leelinko/public_html/mvps/label-verify`,
which is the only one of these three locations Apache actually serves
from. The backend's "output" is different in kind, not files copied
somewhere, but an image built once and a container created from it.
Rebuilding on a later deploy replaces the image, then the old
container is removed and a new one created from the new image, the
container itself is never "updated" in place.

## 1.2 Backend architecture

Written in TypeScript (`strict: true`), not plain JavaScript, unlike
insight-engine-rag's backend, which keeps parallel `.ts` files as a
type-checking aid but still deploys the plain-JS originals. Here,
TypeScript is the only source, compiled to `dist/` and that compiled
output is what actually runs, both locally in production mode and in
the deployed Docker container.

**Why the backend runs in Docker rather than as a plain Node process
directly on the VPS:** same reason the frontend build has to run in a
container too, the VPS host has no working Node install at all,
confirmed by insight-engine-rag's own deployment notes: a broken,
extremely outdated Node environment missing required shared libraries
(e.g. `libbrotlidec.so.1`). Node cannot run natively on this host, so
the backend genuinely has no alternative to running inside a
container, it isn't a stylistic choice. `--restart unless-stopped`
also brings the container back automatically after a VPS reboot,
which a bare host process wouldn't get without separately setting up
something like `systemd` or `pm2`.

All backend source lives under `backend/`:

- **`server.ts`** — Thin router only. Parses each request, calls a
  service function, shapes the response. No business logic lives
  here.

- **`services/extraction.ts`** — `extractLabelFields(imageBuffer,
  mimeType) -> fields`. Calls an OpenAI vision model (Chat Completions
  API, `image_url` content) to extract label fields. Model is
  env-configurable via `OPENAI_VISION_MODEL`. Pure function, no
  Express dependency. Exports the `ExtractedLabelFields` interface.

- **`services/matching.ts`** — `matchLabelToApplication(extracted,
  data) -> per-field match result`. Holds the canonical Government
  Warning text (27 CFR 16.21/16.22) and `normalize()`. Pure function.
  Exports `ApplicationData`, `FieldMatchResult`, and `MatchResult`
  interfaces.

- **`services/batch.ts`** — `verifyBatch(items) -> per-item results`.
  Orchestrates extraction + matching per item with per-item error
  isolation.

- **`swagger-spec.ts`** — OpenAPI 3.0 spec. `components.schemas` is
  generated directly from the actual TS interfaces in `services/`
  (see `schemas.generated.ts` and `scripts/generate-openapi-schemas.ts`,
  run via `npm run generate:schemas`), so response shapes can't drift
  out of sync with the code. `paths` (routes, verbs, request bodies,
  status codes) is still hand-maintained, Express doesn't carry that
  metadata anywhere for a generator to read.

- **`scripts/generate-openapi-schemas.ts`** — Generates
  `schemas.generated.ts` from the exported service interfaces using
  `ts-json-schema-generator`, then fixes up JSON-Schema-to-OpenAPI-3.0
  differences (nullable unions, `$ref` paths). Build-time only, never
  runs against a live request.

- **`tsconfig.json`** — `strict: true`, `outDir dist`.

- **`Dockerfile`** — `node:20-alpine`, port 3002. Full `npm install`
  (needs devDependencies to compile and to run the schema generator),
  then `npm run generate:schemas && npx tsc` (order matters,
  `swagger-spec.ts` imports the generated file), then runs the
  compiled `dist/server.js`.

**Why services are split from routing:** each service function takes
plain data in and returns plain data out, with zero dependency on
Express's `req`/`res`. That's the part most likely to move to
AWS/Azure (Lambda, Step Functions) if this prototype informs a real
procurement decision. A Lambda handler for `extractLabelFields`
later is a thin wrapper around the same function, not a rewrite.

## 1.3 Frontend architecture

Correction: an earlier version of this section described the
frontend as "skeleton only," a health check panel with no
upload/verify UI built yet. That's no longer accurate and has been
rewritten here. All frontend source lives under `frontend/src/`:

- **`main.jsx`** — Entry point, mounts App.

- **`App.jsx`** — Owns top-level state: the health check result and
  the active tab (`'single'` or `'batch'`). Renders `StatusCard`,
  `Tabs`, and whichever verify panel is active. The original API
  Docs card and "Next Up" placeholder were removed once the real UI
  was built.

- **`App.css`** — Design tokens and base styles, originally reused
  directly from insight-engine-rag (`--accent`, `--card`, `--border`,
  `--radius`, etc), extended with styles for tabs, the image
  dropzone/file list, the application data form grid, the match
  result banner/table, and the batch results table as those
  components were built.

- **`api/client.js`** — Every backend `fetch` call in one place,
  not scattered across components: `checkHealth()`, `verifyLabel(file,
  applicationData)` (`POST /api/verify`), `verifyBatch(items)` (`POST
  /api/verify/batch`). Errors are read from the response body, not
  just the status code, so callers get a real message to show.

- **`components/`**:
  - `StatusCard.jsx` — backend status as a check/x/spinner icon,
    with a "Technical Details" toggle showing the raw health JSON or
    error instead of always displaying it.
  - `ErrorMessage.jsx` — generic reusable error display, a
    plain-language message with a "Details" toggle revealing the
    real error. Used by both verify panels and by
    `BatchResultsTable`'s per-item failure rows.
  - `Tabs.jsx` — minimal tab switcher between Single Label and
    Batch.
  - `ImageDropzone.jsx` — file picker for label images, single or
    multiple, controlled by the parent, shows a removable file list.
  - `ApplicationDataForm.jsx` — controlled form for the
    `ApplicationData` fields (brand name, class/type, alcohol
    content, net contents, producer name, producer address, country
    of origin), matching `services/matching.ts`'s shape exactly.
  - `MatchResultCard.jsx` — renders a single `MatchResult`: overall
    green/yellow/red banner plus a per-field extracted-vs-applied
    table.
  - `BatchResultsTable.jsx` — renders the `results` array from
    `/api/verify/batch`, click a row to expand full match detail or
    the error.
  - `SingleVerifyPanel.jsx` / `BatchVerifyPanel.jsx` — orchestrate
    each tab: upload, form, submit, result/error display.

**Note on `frontend/README.md`**: this file previously pointed to
that README's "Planned structure" section for where `components/`
and `api/` would eventually go. That section describes a plan, not
what's built now, and wasn't re-verified as part of this pass, it
may still describe the old skeleton state and need its own update
pass, not confirmed accurate as of this writing.

## 1.4 Why reuse an existing app as the starting point

This project deliberately started from
[insight-engine-rag](https://github.com/LeeLinkoff/insight-engine-rag)
rather than a blank slate. Reused directly: the Docker + Apache
reverse-proxy deployment pattern, the CI/CD pipeline shape, and the
frontend's design tokens. Built new: the vision/OCR extraction logic
and the field-matching logic, since those solve a genuinely different
problem than RAG's text embeddings and have no equivalent to reuse.
See the top-level `README.md`'s "Why reuse, not reinvent" section for
the full reasoning.

---

# PART 2: DEPLOYMENT

---

## 2.1 Automated deployment (how this actually happens)

Deployment is handled entirely by
`.github/workflows/deploy-to-vps.yml`, triggered automatically on
every push to `main`, or manually via GitHub Actions' "Run workflow"
button. Two jobs:

1. **`verify-build`** — runs on GitHub's own disposable runner, never
   touches the VPS. Syntax-checks the backend, does a real `docker
   build`, installs and builds the frontend, confirms `dist/index.html`
   exists. If any of this fails, nothing below runs and the VPS is
   never touched.
2. **`deploy`** — only runs if `verify-build` passed. Confirms all
   required secrets are present (fails immediately with a clear
   message naming exactly which are missing, rather than failing
   confusingly mid-SSH), creates the VPS project directories if they
   don't exist (`mkdir -p`, safe to re-run), syncs source, writes
   `backend/.env` from the `OPENAI_API_KEY` secret, rebuilds and
   restarts the backend container, confirms via `docker ps` that it's
   actually running (not just that `docker run` exited 0), builds the
   frontend on the VPS itself inside a throwaway container, confirms
   the build output exists, copies it into Apache's static directory,
   confirms it landed, then verifies `/api/health` responds through
   the public domain with the response body printed either way.

See `.github/workflows/deploy-to-vps.yml`'s own header comment for
the full list of required repository secrets and what each holds.
`dev_scripts\deploy_setup.bat` automates setting them: generates a
dedicated SSH keypair into `secrets\` if one doesn't exist, prints
the public key to add to the VPS's `authorized_keys`, then sets each
GitHub secret via the `gh` CLI. The four non-secret config values
(`VPS_HOST`, `VPS_USER`, `VPS_PROJECT_PATH`, `PUBLIC_HEALTH_URL`)
default to this project's real values, shown at each prompt, just
press Enter to accept. `VPS_SSH_KEY` is set automatically from the
generated key file; `OPENAI_API_KEY` prompts blank and is skipped
until it's actually needed.

## 2.2 Testing the pipeline locally before it touches production

Both workflows can be run locally via `act`
(https://github.com/nektos/act) before ever pushing, using
`dev_scripts\test_code_checks_yml.bat` and
`dev_scripts\test_deploy_yml.bat`. The latter deliberately only runs
`verify-build`, never `deploy`, since that job genuinely modifies the
live VPS. See the top-level `README.md`'s CI/CD section for why this
matters, including a real bug this local testing already caught
before any code was committed.

A narrower check runs even earlier, at commit time: a git pre-commit
hook (`.githooks\pre-commit`, wired in once via
`dev_scripts\setup_git_hooks.bat`) runs `actionlint`/`shellcheck`
against any staged workflow YAML or shell script and blocks the
commit on a syntax error, the class of bug `act` only catches once it
actually executes the broken step. This is a direct response to a
real incident: an apostrophe inside a single-quoted `ssh '...'`
remote command in `deploy-to-vps.yml`'s "Confirm Apache has the
ProxyPass rule" step reached a real GitHub Actions run and broke it
in production before this hook existed. See the top-level `README.md`
CI/CD section for the full writeup and setup.

## 2.3 Manual deployment (fallback reference)

If the automated pipeline needs debugging, here's what it's doing
under the hood, so the same steps can be run by hand over SSH if
needed:

**Connect:** SSH to the VPS as the deploy user, same access
insight-engine-rag uses (Bluehost cPanel Terminal or PuTTY). See that
project's `DEPLOYMENT_AND_ARCHITECTURE.md` section 1.1 for exact
connection steps, unchanged here.

**Project path:** this app's `VPS_PROJECT_PATH` must be a
**different** directory than insight-engine-rag's, e.g. `/opt/label-verify`
vs `/opt/rag`. Sharing a path would let the two deploys overwrite
each other.

**Backend**, runs as a Docker container rather than a bare Node
process since the VPS host has no working Node install to run it on
directly (see 1.2 above for why):
```
cd $PROJECT/backend
docker build -t ttb-label-verify-backend .
docker rm -f ttb-label-verify-backend || true
docker run -d \
  --name ttb-label-verify-backend \
  --restart unless-stopped \
  -p 127.0.0.1:3002:3002 \
  --env-file .env \
  ttb-label-verify-backend
```

**Frontend**, built inside a throwaway container since the VPS host
has no working Node install at all, confirmed by insight-engine-rag's
own deployment notes: a broken, extremely outdated Node environment
missing required shared libraries (e.g. `libbrotlidec.so.1`). Node
cannot run natively on this host, not just an unreliable version:
```
docker run --rm \
  -v "$PROJECT/frontend:/app" \
  -w /app \
  node:20-alpine sh -c "npm install && npm run build"
rsync -a --delete "$PROJECT/frontend/dist/" /home/leelinko/public_html/mvps/label-verify/
```

**Verify:**
```
curl -sf https://leelinkoff.com/mvps/label-verify/api/health
```

## 2.4 Apache reverse proxy

**Not** a bare `/api/` proxy at the domain root, unlike an earlier
draft of this doc assumed. insight-engine-rag's frontend is served
at `/mvps/rag/`, but its backend proxy rule genuinely does sit at the
domain root (`/api/`), confirmed directly against that project's own
deployment doc. If this app's backend also proxied at the domain
root, the two would fight over the same path, whichever Apache rule
matches first wins, and the other app's API becomes unreachable.
This app's proxy rule is nested under its own subpath instead, so it
can't collide with anything else on the same VPS.

### Why different internal ports (3001 vs 3002) don't already solve this

They solve a different problem. Apache decides which `ProxyPass` rule
to use based entirely on the incoming request's **URL path**, before
it ever looks at where that rule points to. If two rules both matched
`/api/`, Apache picks one, the other never fires for any `/api/*`
request, full stop. The target ports only matter *after* a rule has
already been selected, they have no bearing on which rule Apache
chooses in the first place. Ports keep the two Docker containers from
colliding with each other on the VPS (two processes can't both bind
the same port), but that's a completely separate problem from two
public URL patterns colliding at the Apache layer. Giving each app
its own path prefix is what actually fixes the URL-matching
collision, the ports were never going to.

### This is a manual, one-time step, not automated

`deploy-to-vps.yml` deploys the app (syncs source, rebuilds the
Docker container, publishes the frontend) but does **not** touch
Apache's configuration. Until this block is added by hand, the
pipeline's final health-check step will fail with a 404, Apache has
no rule routing `/mvps/label-verify/api/` anywhere, so it falls
through to a plain "not found" response. This only needs doing once;
after that, every future deploy just works.

### Config file location

Same file insight-engine-rag's own `/api/` rule lives in, confirmed
against this specific server:

```
/etc/apache2/conf.d/includes/post_virtualhost_global.conf
```

This is a cPanel EasyApache (EA4) install. The config tree lives
under `/etc/apache2/`, but the actual service and binary are named
`httpd` (`/usr/sbin/httpd`, `systemctl status httpd`), not `apache2`,
that's a cPanel packaging convention. Using `systemctl restart apache2`
here will fail or silently do nothing; it has to be `httpd`.

### Config to add

Append this block to the same file, alongside insight-engine-rag's
existing `/api/` block, not a separate file:

```apache
<IfModule mod_proxy.c>
    ProxyPreserveHost On
    ProxyPass "/mvps/label-verify/api/" "http://127.0.0.1:3002/api/"
    ProxyPassReverse "/mvps/label-verify/api/" "http://127.0.0.1:3002/api/"
</IfModule>
```

### Apply it

```
apachectl -t
/usr/local/cpanel/scripts/restartsrv_httpd --graceful
```

Always run `-t` (syntax check) first, a syntax error here would take
down Apache for every site on the VPS, including insight-engine-rag,
not just this app.

Use the cPanel service script, not `systemctl restart httpd`
directly. Confirmed on this exact VPS: `systemctl restart httpd`
completed with no error, but Apache continued serving the old config
regardless, real requests kept 404ing even though `apachectl -t`
reported the new config as valid. `/usr/local/cpanel/scripts/restartsrv_httpd --graceful`
is what actually got the new config live. cPanel manages its own
service state around `httpd`, and that state can drift out of sync
with what `systemctl` sees, using cPanel's own script avoids that.

### Verify

```
curl -sf https://leelinkoff.com/mvps/label-verify/api/health
```

Once this returns a healthy JSON response, re-run (or just wait for
the next push to trigger) `deploy-to-vps.yml`, its own health-check
step will now pass.

The frontend calls this same prefixed path, built from
`import.meta.env.BASE_URL` in `App.jsx` rather than hardcoded as
`/api/...`, so it resolves correctly in both dev (Vite's dev server
proxy, configured in `vite.config.js` with a matching rewrite that
strips the prefix before forwarding to the backend) and production
(this Apache rule). `PUBLIC_HEALTH_URL` in repo secrets should be set
to `https://leelinkoff.com/mvps/label-verify/api/health`, not a bare
`/api/health` path, and not the placeholder `/api/label-verify-health`
path an earlier draft of this doc used, that path was never real.

Internal port 3002 is never exposed publicly. All public traffic
reaches the backend only through Apache's reverse proxy.

## 2.5 Rotating the OpenAI API key

`services/extraction.ts` calls a real OpenAI vision model, so
`OPENAI_API_KEY` is required, not optional, for `/api/verify` and
`/api/verify/batch` to work. Rotate the key by updating the
`OPENAI_API_KEY` GitHub repository secret only. The next deploy
writes it to the VPS automatically, same single-touch-point rotation
insight-engine-rag uses, no manual `.env` editing on the VPS itself
required. `OPENAI_VISION_MODEL` is required as well, not optional,
no default is hardcoded in `extraction.ts`, it throws a clear error
if unset. `deploy-to-vps.yml` checks it's present as a required
secret before deploying, writes it into `backend/.env` alongside
`OPENAI_API_KEY`, and confirms it landed on the VPS with a real
value, all three steps confirmed directly in the workflow file
itself, not assumed. Same rotation pattern as `OPENAI_API_KEY`:
update the GitHub secret, the next deploy picks it up automatically.

## 2.6 Security notes

- No authentication on any endpoint currently, consistent with
  Marcus's stated assumption that this prototype stores nothing
  sensitive. Revisit before any real-data deployment.
- CORS is fully open. Fine for a demo, would need restricting before
  production use.
- Internal port 3002 never exposed publicly, matches insight-engine-rag's
  pattern exactly. **Confirmed fixed**: `docker run` in both 2.3 above
  and `deploy-to-vps.yml`'s equivalent step now use
  `-p 127.0.0.1:3002:3002`, binding only to localhost, not all
  interfaces. This was previously `-p 3002:3002` (binds
  `0.0.0.0:3002`), an earlier version of this note flagged that as an
  unverified, potentially-open port; that's fixed now, not just
  documented as a risk. `EXPOSE 3002` in the Dockerfile remains
  documentation only, it never restricted anything either way.
- `backend/.env` is written in plaintext on the VPS via `--env-file`,
  same accepted tradeoff insight-engine-rag documents: a secrets
  manager would avoid this but is disproportionate infrastructure for
  a prototype handling no sensitive data.
