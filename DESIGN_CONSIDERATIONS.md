# Design Considerations

Running log of decisions made while building this prototype, why, and
what they trade off. Updated as the build progresses, not written
after the fact.

## Build approach: baseline first, incrementally

Before writing any label-verification logic, the priority was getting
a sound, verified baseline in place first, then building on top of it
incrementally rather than all at once. Concretely, in order:

1. Scaffold backend and frontend skeletons (health check, Swagger
   docs, a status panel that actually calls the backend), confirmed
   running locally before anything else was added.
2. Split backend logic into services (`extraction.js`, `matching.js`,
   `batch.js`) with `server.js` as a thin router, confirmed each
   endpoint still behaved correctly (including the stub 501s) after
   the refactor, not just that the server started.
3. Wrote CI (`code-checks.yml`) and the deploy pipeline
   (`deploy-to-vps.yml`) against that skeleton, and ran both locally
   via `act` before ever pushing a first commit, rather than pushing
   first and debugging failures on GitHub's runner. `dev_scripts/`
   has the scripts for this (`test_code_checks_yml.bat`,
   `test_deploy_yml.bat`).
4. Only after CI, the deploy pipeline, and the health/docs skeleton
   were all confirmed working does the actual label extraction and
   matching logic get built inside that structure.

Reasoning: infrastructure and pipeline problems are cheaper to find
and fix against a trivial skeleton than after real business logic is
layered on top. Testing CI/CD before the first real commit means the
first commit that lands is already known to build, boot, and deploy
correctly, rather than discovering a broken pipeline step at the same
time as debugging new feature code.

This paid off directly: running `test_deploy_yml.bat` caught a real
bug in `deploy-to-vps.yml` before any commit, a secrets-check step
had been placed in the wrong job (`verify-build`, meant to be
secret-free and safe to run locally) instead of the right one
(`deploy`). Found and fixed locally in seconds via `act`, instead of
discovered later as a confusing failure on GitHub's runner.

## Backend language: converted to TypeScript

The backend started as plain JavaScript (steps 1-4 above describe
that phase accurately) and was later converted to TypeScript in full,
`server.ts`, `swagger-spec.ts`, and all three `services/*.ts` files,
compiled via `tsc` with `strict: true`. This is a real conversion,
not the parallel-files pattern insight-engine-rag uses (where
type-checked `.ts` files exist alongside the JS originals but the
JS is what actually deploys). Here the `.js` originals were deleted;
TypeScript is the only source, and the compiled `dist/` output is
what runs in both dev (via `tsx`, no manual compile step) and
production (Dockerfile compiles then runs `dist/server.js`).

Reasoning: this project's service-split architecture already leans on
explicit interfaces as the contract between `server.ts` and each
service (`ExtractedLabelFields`, `ApplicationData`, `MatchResult`,
`BatchItem`), which is exactly what TypeScript's type system is for.
Enforcing those contracts at compile time, rather than only in
comments, catches a mismatched field name or a wrong argument shape
before the code runs, not after. CI reflects this: the old plain-JS
`node --check` syntax check was replaced with a real `npx tsc --noEmit`
type-check under `strict: true`, in both `code-checks.yml` and
`deploy-to-vps.yml`'s `verify-build` job.

## Time constraint

Interviewer stated verbally (not in the README) not to spend more
than 1 hour on this assessment. Given the actual scope (vision/OCR
extraction, exact legal-text matching, batch handling, an accessible
UI, and a live deployment), that is not realistic for a complete
build. Documented as an accommodation consideration separately.
Scope decisions throughout this log are made assuming more than an
hour was actually available, with the narrowest complete core
prioritized over a broader partial one.

## Architecture

**Services split into separate files, server.ts kept thin.**
`extraction.ts`, `matching.ts`, and `batch.ts` are plain functions
with no Express dependency, decoupled from `req`/`res`. Chosen so
each one can become a Lambda handler later with a thin wrapper, no
rewrite of the underlying logic. `server.ts` only parses requests,
calls a service, and shapes the response. TypeScript interfaces
(`ExtractedLabelFields`, `ApplicationData`, `MatchResult`, `BatchItem`)
make each service's input/output contract explicit and checked at
compile time, see "Backend language: converted to TypeScript" above.

**Deployment: Docker container behind Apache reverse proxy on a
self-hosted VPS**, same pattern as insight-engine-rag, rather than
AWS/Azure. No meaningful performance difference at this scale (low
review-window traffic), and reusing an already-working deploy
pipeline is faster than standing up new cloud infra under the time
constraint. Trade-off: no managed redundancy, single VPS, accepted
as reasonable for a short-lived demo.

**Frontend theme reused from Insight Engine RAG** (same CSS custom
properties, card/button/input styling) for visual consistency across
MVPs and to avoid spending build time on a new design system.

## Warning statement matching

Canonical text is fixed by 27 CFR 16.21, not a design choice:

> GOVERNMENT WARNING: (1) According to the Surgeon General, women
> should not drink alcoholic beverages during pregnancy because of
> the risk of birth defects. (2) Consumption of alcoholic beverages
> impairs your ability to drive a car or operate machinery, and may
> cause health problems.

Per 27 CFR 16.22, "GOVERNMENT WARNING" must be all-caps and bold, the
remainder must not be bold. This is hardcoded in `services/matching.ts`
and checked exactly, with no normalization applied, unlike other
fields. A prior real-world case (title-case "Government Warning")
was rejected by a human reviewer, so this field intentionally has
zero tolerance.

## Fuzzy matching on other fields

Interview notes flagged a real tension: "STONE'S THROW" vs "Stone's
Throw" is technically a mismatch but obviously the same brand.
Decision: normalize (case-fold, strip punctuation, collapse
whitespace) before comparing. If normalized values still don't
match, flag for human review rather than auto-reject or silently
auto-approve. AI/semantic comparison considered as an optional later
pass, not the primary mechanism, since a wrong auto-approve is worse
than an extra review. This is a judgment call, not sourced from the
README.

## Field validation depth

Class/type designation and net contents get a presence and format
check (field exists, net contents parses as a valid volume unit)
rather than full regulatory validation against TTB's class/type
rules, which vary by beverage type. Arbitrary line drawn given the
time constraint; noted as a limitation, not a completeness claim.

## Scope: image quality

Poor-quality images (angled, glare, low light) are out of scope.
Jenny's interview note called this "maybe out of scope for a
prototype" directly, so this isn't an inference.

## Scope: beverage category

Test labels cover distilled spirits only, matching the README's own
worked example ("OLD TOM DISTILLERY"). Beer and wine have different
field rules per TTB and would need separate handling, noted as a
limitation rather than built out.

## Speed vs. judgment trade-off

Where the 5-second-per-label target and more sophisticated matching
logic conflict, speed wins. Sarah's account of the prior vendor pilot
is explicit that it was abandoned for being too slow, not for weak
matching logic. A fast tool with a documented judgment limitation is
preferred over a slow tool with better judgment.

## Batch size

Designed against the 200-300 figure mentioned anecdotally by Sarah.
Demo/test batches kept smaller (10-20) to keep the 5-second-per-label
target easy to verify live during review.

## Auth

None. Marcus stated directly they are "not storing anything sensitive
for this exercise," which settles this rather than requiring a guess.
An open demo URL is used.

## Deployment platform

Self-hosted VPS (Bluehost), not a free-tier platform like
Vercel/Render/Railway, since the existing insight-engine-rag pipeline
was already available and faster to reuse than standing up something
new. Documented explicitly since nothing in the README specifies this.
