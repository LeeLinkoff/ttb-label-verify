# TTB Label Verification — Architecture and Deployment

This document covers how the system is put together and how it gets
to production. Unlike insight-engine-rag, deployment here was
automated from day one via `deploy-to-vps.yml` rather than built
manually first, so this is written as reference and manual-fallback
documentation, not a step-by-step first-deploy walkthrough. If the
pipeline itself ever needs debugging, this is what it's actually
doing under the hood.

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
    |-- /api/*                  --->  Docker container (127.0.0.1:3002, internal only)
    |
    |-- /mvps/label-verify/*    --->  /home/leelinko/public_html/mvps/label-verify (static files)
```

Same shape as insight-engine-rag, deliberately: Apache terminates
HTTPS and reverse-proxies API traffic to a backend container that
never exposes a public port directly, static frontend files are
served straight off disk. Two apps, two subpaths, two internal
ports (3001 for RAG, 3002 for this one), one VPS, one Apache config.

## 1.2 Backend architecture

Written in TypeScript (`strict: true`), not plain JavaScript, unlike
insight-engine-rag's backend, which keeps parallel `.ts` files as a
type-checking aid but still deploys the plain-JS originals. Here,
TypeScript is the only source, compiled to `dist/` and that compiled
output is what actually runs, both locally in production mode and in
the deployed Docker container.

```
backend/
  server.ts               Thin router only. Parses each request,
                            calls a service function, shapes the
                            response. No business logic lives here.
  services/
    extraction.ts          extractLabelFields(imageBuffer) -> fields.
                            Will call a vision/OCR provider. Pure
                            function, no Express dependency. Not yet
                            implemented (throws). Exports the
                            ExtractedLabelFields interface.
    matching.ts              matchLabelToApplication(extracted, data)
                            -> per-field match result. Holds the
                            canonical Government Warning text (27 CFR
                            16.21/16.22) and normalize(). Pure
                            function. Not yet implemented (throws).
                            Exports ApplicationData, FieldMatchResult,
                            and MatchResult interfaces.
    batch.ts                 verifyBatch(items) -> per-item results.
                            Orchestrates extraction + matching per
                            item with per-item error isolation.
  swagger-spec.ts          OpenAPI 3.0 spec, maintained manually as a
                            static file, documents current AND
                            planned endpoints.
  tsconfig.json             strict: true, outDir dist.
  Dockerfile                node:20-alpine, port 3002. Full `npm install`
                            (needs devDependencies to compile), then
                            `npx tsc`, then runs the compiled
                            `dist/server.js`.
```

**Why services are split from routing:** each service function takes
plain data in and returns plain data out, with zero dependency on
Express's `req`/`res`. That's the part most likely to move to
AWS/Azure (Lambda, Step Functions) if this prototype informs a real
procurement decision. A Lambda handler for `extractLabelFields`
later is a thin wrapper around the same function, not a rewrite.

## 1.3 Frontend architecture

```
frontend/src/
  main.jsx     Entry point, mounts App.
  App.jsx      Owns app state. Currently just the health check
                result; will become the shared-state owner for the
                full upload/verify/results flow once built.
  App.css      Design tokens and base styles, reused directly from
                insight-engine-rag (--accent, --card, --border,
                --radius, etc) for visual consistency across MVPs.
```

Skeleton only right now, see `frontend/README.md`'s "Planned
structure" section for where this splits into `components/` and
`api/` once the upload/verify UI is built, mirroring
insight-engine-rag's separation of networking from presentation.

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

**Backend:**
```
cd $PROJECT/backend
docker build -t ttb-label-verify-backend .
docker rm -f ttb-label-verify-backend || true
docker run -d \
  --name ttb-label-verify-backend \
  --restart unless-stopped \
  -p 3002:3002 \
  --env-file .env \
  ttb-label-verify-backend
```

**Frontend**, built inside a throwaway container since the VPS host
Node install isn't reliable (same constraint insight-engine-rag
documented):
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
at `/mvps/rag/`, but its backend proxy rule reportedly sits at the
domain root (`/api/`). If this app's backend also proxied at the
domain root, the two would fight over the same path, whichever
Apache rule matches first wins, and the other app's API becomes
unreachable. This app's proxy rule is nested under its own subpath
instead, so it can't collide with anything else on the same VPS:

```apache
ProxyPass /mvps/label-verify/api/ http://127.0.0.1:3002/api/
ProxyPassReverse /mvps/label-verify/api/ http://127.0.0.1:3002/api/
```

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

Once `services/extraction.ts` calls a real vision/OCR provider,
rotate the key by updating the `OPENAI_API_KEY` GitHub repository
secret only. The next deploy writes it to the VPS automatically,
same single-touch-point rotation insight-engine-rag uses, no manual
`.env` editing on the VPS itself required.

## 2.6 Security notes

- No authentication on any endpoint currently, consistent with
  Marcus's stated assumption that this prototype stores nothing
  sensitive. Revisit before any real-data deployment.
- CORS is fully open. Fine for a demo, would need restricting before
  production use.
- Internal port 3002 never exposed publicly, matches insight-engine-rag's
  pattern exactly.
- `backend/.env` is written in plaintext on the VPS via `--env-file`,
  same accepted tradeoff insight-engine-rag documents: a secrets
  manager would avoid this but is disproportionate infrastructure for
  a prototype handling no sensitive data.
