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

Skeleton. `/api/health` and `/api/docs` are real. `/api/verify` and
`/api/verify/batch` exist as routes but return 501, since
`services/extraction.ts` and `services/matching.ts` both throw
"not implemented" until the vision/OCR and matching logic are built.

## Structure

```
server.ts               Thin router only: parses requests, calls a
                          service, shapes the response. No business
                          logic lives here.
services/
  extraction.ts          extractLabelFields(imageBuffer) -> fields.
                          Will call a vision/OCR provider. Pure
                          function, no Express dependency.
  matching.ts             matchLabelToApplication(extracted, applicationData)
                          -> per-field match result. Also holds the
                          canonical Government Warning text (27 CFR
                          16.21/16.22) and normalize() for tolerant
                          field comparison. Pure function. Exports the
                          ApplicationData, FieldMatchResult, and
                          MatchResult interfaces used elsewhere.
  batch.ts                verifyBatch(items) -> per-item results.
                          Orchestrates extraction + matching per item
                          with per-item error isolation, no logic of
                          its own.
swagger-spec.ts          OpenAPI 3.0 spec, maintained manually as a
                          static file rather than generated from
                          inline comments, same approach as
                          insight-engine-rag.
tsconfig.json            strict: true, outDir dist, compiles
                          server.ts + swagger-spec.ts + services/**/*.ts.
Dockerfile                node:20-alpine, port 3002. Full `npm install`
                          (not --omit=dev, needs devDependencies to
                          compile), then `npx tsc`, then runs the
                          compiled `dist/server.js`.
```

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
| POST | `/api/verify` | Stub, returns 501 |
| POST | `/api/verify/batch` | Stub, returns 501 |

Full request/response shapes, including the planned ones, are in
Swagger at `/api/docs` while the server is running.

## CI

`.github/workflows/code-checks.yml` runs on every push and pull
request to `main`: type-checks the entire backend under `strict: true`
(`npx tsc --noEmit`), then compiles and boots the real compiled
server, and checks the actual response body of `/api/health` (not
just the status code), `/api/docs`, and confirms `/api/verify`
correctly returns a non-200 while it's still a stub. Run it locally
before pushing with `..\dev_scripts\test_code_checks_yml.bat` (via
`act`).

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

**Production** (compiles first, then runs the compiled output, same
as what Docker does):

```
npm install
npm run build
node dist/server.js
```

Server starts at `http://127.0.0.1:3002`.

## Docker

```
docker build -t ttb-label-verify-backend .
docker run -d --name ttb-label-verify-backend --restart unless-stopped -p 3002:3002 --env-file .env ttb-label-verify-backend
```

Or `..\dev_scripts\build_back.bat` on Windows. The Dockerfile compiles
TypeScript to `dist/` during the image build, then runs `node dist/server.js`,
it never runs `.ts` source directly in the container.

## Known limitations (current skeleton state)

- No vision/OCR call implemented yet, `/api/verify` cannot process a
  real label.
- No persistence; nothing is stored between requests regardless.
- No auth or rate limiting, consistent with the assumption in
  `DESIGN_CONSIDERATIONS.md` that this is acceptable for a prototype
  handling no sensitive data.
- CORS is fully open, fine for a demo, would need restricting before
  any real deployment.
