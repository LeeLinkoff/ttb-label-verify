# TTB Label Verification — Backend

Node.js + Express API, written in TypeScript. Thin routing layer over
a set of plain-function services, structured so any given service can
become a Lambda handler later without touching the underlying logic.

Written in TypeScript rather than plain JavaScript, unlike
insight-engine-rag's own backend, which keeps parallel `.ts` files as
a type-checking aid but still deploys the plain-JS originals. Here,
TypeScript is the only source and the compiled output is what
actually runs, both locally and in the deployed Docker container.

## Status

`/api/health`, `/api/docs`, `/api/verify`, and `/api/verify/batch` are
all implemented. `services/extraction.ts` calls an OpenAI vision model
to extract label fields; `services/matching.ts` compares those fields
against submitted application data. `/api/verify` returns `400` if no
`labelImage` is provided, `502` if extraction or matching fails (e.g.
vision API error, malformed model response), otherwise `200` with a
`MatchResult`.

Confirmed against the real API, not just implemented: 20 single-verify
runs and a 50-item real batch run all passed, average latency 2.65s
(single) / 2.81s (batch, per item), see `REQUIREMENTS_MATCH.md` for
the full numbers.

## Structure

```
backend/
├── server.ts
├── swagger-spec.ts
├── schemas.generated.ts        (generated at build time, gitignored)
├── tsconfig.json
├── Dockerfile
├── .env.example
├── package.json
├── package-lock.json
├── README.md
├── services/
│   ├── extraction.ts
│   ├── matching.ts
│   └── batch.ts
└── scripts/
    └── generate-openapi-schemas.ts
```

`node_modules/` and `dist/` (build output) are omitted above, both
gitignored and rebuilt from source, not part of the tracked structure.

- **`server.ts`** — Thin router only: parses requests, calls a
  service, shapes the response. No business logic lives here.

- **`services/extraction.ts`** — `extractLabelFields(imageBuffer,
  mimeType) -> fields`. Calls an OpenAI vision model (Chat Completions
  API, `image_url` content) to extract label fields. `OPENAI_VISION_MODEL`
  is required, not optional, no default is hardcoded, the function
  throws a clear error if it's unset. GPT-5.6 (as of this writing)
  ships as three priced tiers with real speed differences
  (`gpt-5.6-sol`/`-terra`/`-luna`), the bare `gpt-5.6` alias silently
  routes to the slowest, most expensive tier, which is why there's no
  default baked into source. The OpenAI call has a real 30-second
  timeout via `AbortController`, a stalled request fails with a clear
  "timed out" error instead of hanging indefinitely, added after a
  real incident where a missing timeout made a stalled batch item
  indistinguishable from a crashed server.
  `mimeType` is required (from Multer's `req.file.mimetype`) to build
  a valid `data:` URL, there's no attempt to guess image format from
  the buffer alone. Pure function, no Express dependency.

- **`services/matching.ts`** — `matchLabelToApplication(extracted,
  applicationData) -> per-field match result`. Also holds the
  canonical Government Warning text (27 CFR 16.21/16.22) and
  `normalize()` for tolerant field comparison. brandName, classType,
  netContents, producerName, and producerAddress get
  normalize()-and-compare (a normalized mismatch is flagged
  `needsReview`, not auto-rejected). countryOfOrigin gets the same
  treatment but only when the application declares one (imports
  only), skipped entirely for domestic products. alcoholContent gets
  a real numeric comparison, both sides parsed to a percentage and
  compared with a 0.1-point tolerance for formatting/rounding noise,
  not a presence-only check, an earlier version only checked format
  and would have let a genuinely wrong ABV pass. warningStatement
  requires exact text match plus two independent formatting
  conditions per 27 CFR 16.22: "GOVERNMENT WARNING" must be all-caps
  and bold, and the remainder of the statement must NOT be bold. Pure
  function. Exports the `ApplicationData`, `FieldMatchResult`, and
  `MatchResult` interfaces used elsewhere.

- **`services/batch.ts`** — `verifyBatch(items) -> per-item results`.
  Orchestrates extraction + matching per item with per-item error
  isolation. Logs per-item start/success/failure with elapsed time to
  the console, added after a real batch request failed with zero
  server-side output, impossible to tell whether the backend had
  crashed, hung, or was working fine, all three looked identical
  without it.

- **`swagger-spec.ts`** — OpenAPI 3.0 spec. `components.schemas` is
  generated directly from the actual TS interfaces in `services/` (see
  `schemas.generated.ts` and `scripts/generate-openapi-schemas.ts`),
  so response shapes can't drift out of sync with the code the way a
  fully hand-maintained copy did earlier in this project. `paths`
  (routes, verbs, request bodies, status codes) is still hand-written,
  Express doesn't carry that metadata anywhere for a generator to read.

- **`scripts/generate-openapi-schemas.ts`** — Generates
  `schemas.generated.ts` from `ExtractedLabelFields`, `ApplicationData`,
  `FieldMatchResult`, `MatchResult`, and `BatchResultItem` using
  `ts-json-schema-generator`, then fixes up a few JSON-Schema-to-OpenAPI-3.0
  differences (nullable unions, `$ref` paths). Run via
  `npm run generate:schemas`. Runs automatically as part of the Docker
  build, see Dockerfile below, `schemas.generated.ts` is a build
  artifact, not something to hand-edit.

- **`tsconfig.json`** — `strict: true`, `outDir dist`, compiles
  `server.ts` + `swagger-spec.ts` + `services/**/*.ts`.

- **`Dockerfile`** — `node:20-alpine`, port 3002. Full `npm install`
  (not `--omit=dev`, needs devDependencies to compile and to run the
  schema generator), then `npm run generate:schemas && npx tsc`, then
  runs the compiled `dist/server.js`.

## Dockerfile, image, container: what's actually a file

`Dockerfile` (this file, right here in this folder) is the only real,
plain text file in this whole chain, everything downstream of it is a
Docker-internal object, not something you'd browse to on disk:

```
Dockerfile (real file)
    |  read by `docker build`
    v
Docker image "ttb-label-verify-backend" (Docker's internal storage, not a file)
    |  instantiated by `docker run`
    v
Docker container "ttb-label-verify-backend" (the actual running process)
```

The image is a static, inert template, built once per `docker build`.
The container is a live instance created *from* that image, and it's
the container, not the image, that's actually running and listening
on port 3002. They happen to share the same name string here by
convention (`-t ttb-label-verify-backend` on build, `--name ttb-label-verify-backend`
on run), but they're genuinely different Docker objects, list images
with `docker images`, list running containers with `docker ps`.

On the VPS, this Dockerfile lives at
`/opt/label-verify/backend/Dockerfile` after `deploy-to-vps.yml`
syncs it there, unchanged and unconsumed, `docker build` just
re-reads it fresh on every deploy.

## Why services are split out

Each service function takes plain data in and returns plain data out,
with no dependency on `req`/`res`. That's the part of this codebase
most likely to move to AWS/Azure (Lambda, Step Functions) if this
prototype informs a real procurement decision. Keeping business logic
decoupled from Express now means that move is a thin wrapper around
an existing function later, not a rewrite. TypeScript's interfaces
(`ExtractedLabelFields`, `ApplicationData`, `MatchResult`, `BatchItem`)
make that boundary explicit and checked at compile time, not just
documented in a comment. See `DESIGN_CONSIDERATIONS.md` for the full
reasoning.

## Endpoints

| Method | Path | Status |
|---|---|---|
| GET | `/api/health` | Live |
| GET | `/api/docs` | Live (Swagger UI) |
| POST | `/api/verify` | Live. `200` on success, `400` if `labelImage` missing, `502` on extraction/matching failure |
| POST | `/api/verify/batch` | Live. `200` with per-item results (each item independently `ok`/failed), `502` on batch-level failure (e.g. malformed `applications` JSON) |

Full request/response shapes are in Swagger at `/api/docs` while the
server is running, generated from the same interfaces the code
actually uses (see `swagger-spec.ts` and `schemas.generated.ts` above).

## CI

`.github/workflows/code-checks.yml` runs on every push and pull
request to `main` (also runnable by hand via `workflow_dispatch`).

Three jobs: `frontend-build` (independent, runs in parallel, confirms
`dist/index.html` exists after a real production build), `type-check`
(regenerates `schemas.generated.ts`, then `npx tsc --noEmit` under
`strict: true`), and `boot-test` (installs deps, regenerates schemas,
compiles, boots the real compiled `dist/server.js`, checks the actual
response body of `/api/health`, not just the status code, confirms
`/api/docs` responds, and confirms `/api/verify` returns `400` on a
request with no image).

That last check only exercises the missing-`labelImage` validation
path in `server.ts`, it does not send a real label through the OpenAI
vision call in CI, so no `OPENAI_API_KEY`/`OPENAI_VISION_MODEL` secret
is needed for CI to pass. Real end-to-end verification against a live
label does exist, but as local PowerShell tooling
(`dev_scripts\debug_verify.ps1`, `benchmark_verify.ps1`,
`test_batch_verify.ps1`, `test_batch_volume.ps1`), not as a CI job.
Folding an equivalent check into `code-checks.yml` itself (gated on
`OPENAI_API_KEY`/`OPENAI_VISION_MODEL` secrets) is the natural next
step, not yet done. Run the existing CI checks locally before pushing
with `..\dev_scripts\test_code_checks_yml.bat` (via `act`).

## Running

**Development** (runs `.ts` source directly via `tsx`, no manual
compile step, auto-restarts on changes):

```
npm install
cp .env.example .env
npm run dev
```

Or `..\dev_scripts\run_back.bat` on Windows, which checks for `.env`,
frees port 3002 if something else is bound to it, and starts the dev
server.

**Production** (regenerates schemas, compiles, then runs the compiled
output, same steps Docker runs):

```
npm install
npm run generate:schemas
npm run build
node dist/server.js
```

If your `package.json`'s `build` script doesn't already run
`generate:schemas` as part of it, run them as two separate steps like
above, otherwise `swagger-spec.ts` will fail to compile against a
missing or stale `schemas.generated.ts`.

Server starts at `http://127.0.0.1:3002`.

## Docker

**Why Docker at all, not just running `node dist/server.js` directly
on the VPS:** the production VPS host has no working Node install,
it's broken and missing required shared libraries (see
`ARCHITECTURE_AND_DEPLOYMENT.md` section 1.2 for the specifics). This
container isn't a deployment preference, it's the only way this
backend can actually run on that host at all.

```
docker build -t ttb-label-verify-backend .
docker run -d --name ttb-label-verify-backend --restart unless-stopped -p 127.0.0.1:3002:3002 --env-file .env ttb-label-verify-backend
```

Binds only to localhost (`127.0.0.1:3002:3002`), not all interfaces,
an earlier version of this command used `-p 3002:3002`, which bound
`0.0.0.0:3002` and left the backend reachable directly from the
internet, bypassing Apache entirely. Fixed, confirmed in both this
command and `deploy-to-vps.yml`'s equivalent step.

Or `..\dev_scripts\build_back_local.bat` (compiles without Docker) or
`..\dev_scripts\build_back_docker.bat` (builds the actual image) on
Windows. The Dockerfile regenerates `schemas.generated.ts` from the
service interfaces, then compiles TypeScript to `dist/` during the
image build, then runs `node dist/server.js`, it never runs `.ts`
source directly in the container. `.env` needs both `OPENAI_API_KEY`
and `OPENAI_VISION_MODEL` for `--env-file .env` to actually work at
runtime, neither is optional, see Environment variables below.

## Environment variables

`.env.example`:
```
PORT=3002
OPENAI_API_KEY=
OPENAI_VISION_MODEL=
```

Both `OPENAI_API_KEY` and `OPENAI_VISION_MODEL` are required, `/api/verify`
and `/api/verify/batch` fail extraction without either one, no default
model is hardcoded in source. GPT-5.6 (as of this writing) ships as
three priced tiers with real speed differences, `gpt-5.6-sol`
(flagship, slowest, $5/$30 per 1M tokens), `gpt-5.6-terra` (balanced,
$2.50/$15), `gpt-5.6-luna` (fastest/cheapest, $1/$6). Confirm current
model names/pricing against OpenAI's docs before setting this, model
lineups change.

## Known limitations

- No persistence; nothing is stored between requests regardless.
- No auth or rate limiting, consistent with the assumption in
  `DESIGN_CONSIDERATIONS.md` that this is acceptable for a prototype
  handling no sensitive data.
- CORS is fully open, fine for a demo, would need restricting before
  any real deployment.
- Batch processing is strictly sequential, one item at a time, no
  concurrency. Confirmed working at 50 real items (50/50 succeeded,
  2.81s/item average); the full 200-300 volume mentioned in the
  assessment interviews was not run, real OpenAI API cost on an
  unpaid assessment, not a technical limitation, see
  `REQUIREMENTS_MATCH.md` for the honest extrapolation from the real
  50-item number.
- This app depends on direct outbound access to `api.openai.com`.
  If deployed inside a network with outbound restrictions (the
  assessment interviews mention this happened to a prior vendor
  pilot), this would need to be confirmed reachable first, or routed
  through something like Azure OpenAI Service instead.
