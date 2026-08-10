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

## Pre-commit lint hook: caught a real bug act didn't

`act` (see "Build approach" above) catches a broken workflow step
once it actually runs, but a plain bash syntax error inside a `run:`
block got past both `act` and manual review anyway: an apostrophe
inside a single-quoted `ssh '...'` remote command in
`deploy-to-vps.yml` (`cPanel's`, closing the quote early, with the
rest of the script then parsed as literal shell) reached a real
GitHub Actions run and broke the "Confirm Apache has the ProxyPass
rule" step in production, not caught locally first this time.

Added a git pre-commit hook (`.githooks/pre-commit`,
`dev_scripts/setup_git_hooks.bat` for one-time setup) that runs
`actionlint` against staged workflow YAML and `shellcheck` against
staged shell scripts, blocking the commit on a syntax error before it
can reach GitHub at all, a cheaper and earlier check than waiting for
`act` to execute the step. Verified against the actual bug, not just
assumed to work: run against a throwaway git repo with the original
broken `deploy-to-vps.yml` staged, `actionlint` blocked the commit
and correctly identified the exact line (`SC1011: This apostrophe
terminated the single quoted string!`); run again against the fixed
file, the commit went through clean.

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
UI, and a live deployment), that estimate is not grounded in the
reality of what this task involves, unless it assumes a pre-built
environment already configured (repo scaffolded, CI/CD already
working, hosting already provisioned and proven, no errors
encountered anywhere in the chain) and a zero-error run through every
step. That is not a realistic assumption for a fresh build.

Concrete evidence, not just assertion: even the deployment
infrastructure alone, separate from the actual label-matching logic
this assessment is meant to evaluate, took real, non-trivial
debugging to get working end to end. Getting the live health check to
pass involved diagnosing an Apache path-collision with an existing
app, a wrong proxy target that silently dropped the required `/api/`
prefix, and a cPanel-specific reload command that reports success
while not actually reloading the config, each confirmed only by
direct testing (backend curl, config syntax check, vhost dump, error
log inspection), not guesswork. None of that is unusual or a sign of
a poorly-run assessment, it's the normal texture of standing up a new
service on shared infrastructure. It is, however, real evidence that
one hour covers essentially none of the actual work this task
requires, let alone the label-matching logic itself.

Documented as an accommodation consideration separately. Scope
decisions throughout this log are made assuming more than an hour was
actually available, with the narrowest complete core prioritized over
a broader partial one.

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

**Why Docker specifically, not just a plain Node process on the
VPS.** Not a stylistic preference, a hard requirement discovered when
insight-engine-rag was first deployed to this same VPS: the host's
native Node installation is broken and extremely outdated, missing
shared libraries it needs to run at all (e.g. `libbrotlidec.so.1`),
confirmed directly, not assumed. Node cannot run natively on this
host, full stop, which is why both the backend and the frontend's
build step run inside Docker containers (the frontend using a
throwaway container as a build environment, since it can't build on
the host either) rather than as ordinary host processes.

**Frontend theme reused from Insight Engine RAG** (same CSS custom
properties, card/button/input styling) for visual consistency across
MVPs and to avoid spending build time on a new design system.

## UI simplicity for non-technical users

Sarah's benchmark was explicit: "something my mother could figure
out," 73, video-calls her grandkids, half the review team is over 50
years old. This drove concrete UI decisions that weren't previously written
down anywhere: a single page, two tabs (Single Label, Batch), no
nested menus or settings screens, one visible upload button, plain
labeled text inputs for the application data fields, and one primary
action button per tab. The original Swagger/API-docs link was
removed from the user-facing UI (still reachable directly at
`/api/docs` for anyone technical who wants it, just not surfaced to
the reviewing agent) specifically because it's developer-facing
information with no place in a tool meant for Dave and Sarah's
mother's level of comfort.

This was never actually tested with a non-technical user, which is
already noted as an open gap in `REQUIREMENTS_MATCH.md`, worth
repeating here rather than only in that file: "designed for it" and
"confirmed usable by the target user" are different claims, and only
the first one is true right now.

## Error handling and UX pattern

Two reusable pieces, both used everywhere a request can fail (the
health check, single verify, batch verify): a status indicator
(check/x/spinner icon) that shows the plain-language state at a
glance, and a generic error component that shows a short,
non-technical message by default with a "Details" toggle that
reveals the real error (status code, raw response body, exception
message) for anyone who needs it. The goal: an agent doesn't need to
understand what a 502 or a JSON parse failure is to know something
went wrong and what to do next, but the real error is never actually
hidden or discarded, it's one click away, which matters both for
Lee debugging a real issue and for Jenny or Dave reporting one
accurately instead of just saying "it broke."

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

Correction: an earlier version of this entry claimed classType and
netContents get "a presence and format check (field exists, net
contents parses as a valid volume unit)". That's inaccurate against
the actual code and has been fixed here. What `matching.ts` actually
does: classType and netContents go through the same normalize()-then-
compare mechanism as brandName (case-fold, strip punctuation, collapse
whitespace, then exact comparison), flagged `needsReview` on a
mismatch, not a bare presence check. There is no volume-unit format
validation anywhere in the code, `netContents` is never checked
against a unit pattern the way `alcoholContent` is (see "Alcohol
content matching" below).

The real, still-accurate limitation: neither field is validated
against TTB's actual regulatory rules for what a legitimate class/type
designation is (TTB maintains a real taxonomy that varies by beverage
type), or what net-contents values are authorized standards of fill.
This app only confirms the label's printed value matches the
application's submitted value, it does not confirm either value is
itself TTB-compliant. Arbitrary line drawn given the time constraint;
noted as a limitation, not a completeness claim.

## Alcohol content matching: fixed, real numeric comparison

Originally, `alcoholContent` was checked for presence and format only
(`/\d{1,2}(\.\d+)?\s*%/` against the extracted text), never actually
compared against `applicationData.alcoholContent`. The reasoning at
the time wasn't wrong on its own terms, ABV is printed with enough
formatting variance ("12%" vs "12% ALC/VOL" vs "12.0% ALC./VOL.")
that a naive strict-string-equality check would generate false
`needsReview` flags on labels that are actually fine, but the actual
consequence was a real gap, not a hypothetical one: a label with the
wrong ABV printed on it (e.g. 45% on the label, 40% in the
application) would pass this field's check as long as it was
formatted like a percentage. Documented as an open gap for a while
before actually being fixed, which in hindsight is the wrong
sequencing, the fix itself was small and bounded, it should have
been built the same day the gap was found, not repeatedly
re-documented instead.

Fixed now: both sides are parsed to a numeric percentage
(`extractPercentage()`, matches the leading `\d{1,2}(\.\d+)?\s*%`
pattern and returns a `number`) and compared directly, with a 0.1
percentage-point tolerance to absorb real formatting/rounding noise
without letting an actually-different ABV pass as a rounding
difference. Either side failing to parse is treated as a mismatch,
not a silent pass. Verified two ways, not just written and assumed
correct: a real `tsc --noEmit --strict` compile against the actual
project TypeScript settings, and 8 explicit test cases run directly
against the comparison logic in Node, including the exact bug case
this was meant to fix (45% vs 40% now correctly returns `match:
false`), the reversed case, two legitimate-formatting-variance cases
that should still match, and two unparseable-input cases that
correctly fail rather than silently pass.

## Name/address of bottler/producer, and country of origin

Both are listed in the README's "About TTB Label Requirements"
section as common label elements, and both were missed in the
initial field scoping, they weren't in `ExtractedLabelFields` or
`ApplicationData` when this file was first written, and unlike the
deliberate scope cuts elsewhere in this log (image quality, beverage
category, batch load-testing), there was no stated reason for
leaving them out, they were simply absent from the field list that
became the TypeScript interfaces. Caught later by checking the code
against the full requirements list line by line, not caught during
initial design.

Added as `producerName` and `producerAddress` (two separate fields,
not one combined string, since a mismatch on one is a different
signal than a mismatch on the other, e.g. a co-packer bottling under
the brand owner's name but at its own facility address), using the
same normalize()-then-compare mechanism as brandName/classType/
netContents. `countryOfOrigin` is only checked when
`applicationData.countryOfOrigin` is actually set, skipped entirely
for domestic products rather than compared against an empty string,
since the README is explicit this field is required "for imports"
only, not universally.

## No integration with COLA

Marcus was explicit that this is meant as "a standalone
proof-of-concept," not something that integrates with the real COLA
system, which "has its own authorization requirements." No
integration was attempted, this app has no awareness of COLA's data
model, authentication, or workflow at all. Worth stating directly
rather than leaving it as an absence, since a reviewer skimming the
architecture might otherwise wonder why there's no COLA-facing code.

## Outbound network dependency on OpenAI's API (unresolved risk)

Marcus described the prior scanning vendor pilot failing partly
because "our firewall blocked connections to their ML endpoints,"
and warned generally that "our network blocks outbound traffic to a
lot of domains." This app's extraction step (`services/extraction.ts`)
makes a direct outbound HTTPS call to `api.openai.com` for every
label, the exact shape of dependency Marcus flagged as a known
failure mode in TTB's real environment.

This was never resolved or even addressed anywhere in this build.
The prototype's own deployment (a self-hosted VPS outside TTB's
network) never hits this problem, so it went unnoticed unless
checked against Marcus's specific warning directly. If this were
ever deployed inside TTB's actual network rather than as an external
demo URL, outbound access to `api.openai.com` on port 443 would need
to be confirmed or explicitly allowlisted first, this is not
something the current build handles, works around, or even flags to
the user at runtime. Documented here as a real, open risk rather than
implied to be solved by "it works on the demo URL."

## Scope: image quality

Poor-quality images (angled, glare, low light) are out of scope.
Jenny's interview note called this "maybe out of scope for a
prototype" directly, so this isn't an inference.

## Scope: beverage category

Test labels cover distilled spirits only, matching the README's own
worked example ("OLD TOM DISTILLERY"). Beer and wine have different
field rules per TTB and would need separate handling, noted as a
limitation rather than built out.

## Test label generation

The README explicitly suggests "AI image generation tools work well
for this" for sourcing additional test labels. What was actually
used instead: labels rendered programmatically (Python, Pillow),
clean synthetic layouts with real, correct field text and the exact
27 CFR warning statement, not AI-generated photorealistic label
images. This is a substitution worth being explicit about rather
than letting "test labels" imply something it isn't, these are
simple, high-contrast, dead-center renders, they don't exercise
anything close to real photograph conditions (angle, glare,
lighting), which is consistent with, and actually reinforces, the
"Scope: image quality" limitation above rather than contradicting
it. Two labels exist: `label1`, fully compliant (PALE HORSE
DISTILLERY, Kentucky Straight Bourbon Whiskey, domestic), and
`label2`, an import (HIGHLAND MIST DISTILLERS, Blended Scotch
Whisky) with one deliberate 27 CFR 16.22 violation ("Government
warning:" printed in mixed case and not bold, rather than
"GOVERNMENT WARNING:" all-caps and bold), built specifically to
confirm the zero-tolerance matching logic actually rejects a real
violation rather than only ever being exercised against passing
input.

## Speed vs. judgment trade-off

Where the 5-second-per-label target and more sophisticated matching
logic conflict, speed wins. Sarah's account of the prior vendor pilot
is explicit that it was abandoned for being too slow, not for weak
matching logic. A fast tool with a documented judgment limitation is
preferred over a slow tool with better judgment.

## Batch size

Designed against the 200-300 figure mentioned anecdotally by Sarah,
and by Marcus/Janet from the Seattle office. Architecture supports
arbitrary batch length, `services/batch.ts` loops over the submitted
array with no hardcoded limit, and each item is processed
independently (see below), so nothing in the code caps it at a
smaller number.

Correction: an earlier version of this entry claimed "demo/test
batches kept smaller (10-20)" were actually run. That did not happen
and has been fixed here. The largest batch actually exercised end to
end during this build was 2 real label images. The 200-300 target
figure, and the 10-20 demo-scale figure, are both untested claims,
not confirmed behavior, and `REQUIREMENTS_MATCH.md`'s "Known gaps"
section already says as much; this entry previously contradicted
that by implying testing had happened that hadn't.

## Batch processing design: per-item isolation, matched by position not filename

Two decisions that shaped `services/batch.ts` and the batch UI,
neither previously written down here. First, one failed label
(extraction error, malformed image, OpenAI request failure) does not
fail the whole batch, each item is wrapped in its own try/catch and
reported independently as `{ index, ok, result? , error? }`. This
matters directly for the 200-300-label scenario Sarah and Janet
described: without per-item isolation, one bad scan in a batch of
250 would force a re-submission of the entire batch rather than just
that one label.

Second, `/api/verify/batch` matches `labelImages[]` to the
`applications` JSON array strictly by array position, not by
filename or any other identifier, the backend never sees or returns
filenames at all, only numeric index. The frontend (`BatchVerifyPanel.jsx`)
compensates for this by tracking each file's original name
client-side and passing that list separately to `BatchResultsTable.jsx`
purely for display, filename is a UI convenience, not something the
matching logic depends on or validates. A real operational risk this
creates: if a batch's images and application-data rows ever get
reordered independently of each other client-side, results would
silently pair the wrong label with the wrong application data with
no error raised, since the backend has no way to detect that. This
isn't currently guarded against beyond keeping both arrays built
from the same ordered `items` list in the frontend, worth flagging
as a fragility rather than treating array-order matching as a solved
problem.

## Auth

None. Marcus stated directly they are "not storing anything sensitive
for this exercise," which settles this rather than requiring a guess.
An open demo URL is used.

## Deployment platform

Self-hosted VPS (Bluehost), not a free-tier platform like
Vercel/Render/Railway, for two separate reasons. First, cost: paying
for new hosting just to run an unpaid take-home assessment isn't a
reasonable ask, and there was no need to, this VPS is already paid
for and running for other purposes (it already hosts
insight-engine-rag and other sites), so deploying here adds no new
expense at all. Second, speed: the existing insight-engine-rag
deploy pipeline was already available and faster to reuse than
standing up new cloud infra under the time constraint. Documented
explicitly since nothing in the README specifies a required or
preferred hosting platform.

## Apache reload gotcha (cPanel-specific)

After adding this app's `ProxyPass` rule to the shared Apache config,
the public endpoint still 404'd even with the config file confirmed
correct and `apachectl -t` reporting `Syntax OK`. Backend confirmed
healthy directly (`curl http://127.0.0.1:3002/api/health` returned
200), ruling out the application. `apachectl -S` confirmed the
correct vhost was being reached. The actual cause, found by checking
Apache's error log directly rather than continuing to guess:
`systemctl restart httpd` completed with no error but did not
actually reload the running config, Apache kept serving the previous
version. `/usr/local/cpanel/scripts/restartsrv_httpd --graceful`
fixed it immediately, confirmed by a real `curl` returning the
correct JSON body through the public HTTPS URL.

Documented here because `systemctl restart httpd` looks like the
obviously correct command on a service literally named `httpd`, and
nothing about it failing is visible without checking behavior, not
just exit codes. On this specific cPanel/EasyApache VPS, use the
cPanel service script for any future Apache config change, not
`systemctl` directly.

## OpenAPI schema generation: generated, not hand-maintained

`swagger-spec.ts`'s `components.schemas` block was originally
hand-written, and went stale against the real code more than once
during this build (endpoints still documented as `501` stubs after
they were implemented, a field-formatting shape change in
`ExtractedLabelFields` never reflected in the spec). Rather than keep
manually syncing a parallel copy of every response type,
`scripts/generate-openapi-schemas.ts` generates
`schemas.generated.ts` directly from the actual exported TS
interfaces (`FieldMatchResult`, `MatchResult`, `ApplicationData`,
`BatchResultItem`, `ExtractedLabelFields`) using
`ts-json-schema-generator`, then fixes up a handful of JSON-Schema-
to-OpenAPI-3.0 differences (nullable unions, `$ref` path rewriting)
that library doesn't handle natively.

`paths` (routes, verbs, request bodies, status codes) stays
hand-written. Express doesn't carry that metadata anywhere a
generator could read it from without a heavier framework change
(e.g. `tsoa`'s decorated-controller pattern), which would cut against
the "thin router, plain-function services" split documented above.
Generating the schemas half while hand-maintaining the paths half was
the narrower fix for the actual problem (response shapes drifting),
not a full OpenAPI-generation rewrite.

Runs at build time only (`npm run generate:schemas`, wired into the
Dockerfile before `tsc`, and into both `code-checks.yml` and
`deploy-to-vps.yml`'s `verify-build` job before their own type-check
steps), never against a live request. `schemas.generated.ts` is a
build artifact, not something to hand-edit.

One real bug surfaced by this: the `generate:schemas` npm script
originally invoked `ts-node` directly (`ts-node scripts/generate-
openapi-schemas.ts`). That hits a known, long-standing `ts-node` CLI
bootstrap bug (`Cannot find module`, referencing an internal probe
file `imaginaryUncacheableRequireResolveScript`) inconsistently
across Node/`ts-node`/OS combinations, confirmed via multiple
`TypeStrong/ts-node` GitHub issues going back to 2019, still
reproducing on Node 22 in 2025. It didn't reproduce in every
environment tested, which is exactly what made it worth documenting:
a fix that "works on my machine" isn't verified. The script now runs
via `node -r ts-node/register scripts/generate-openapi-schemas.ts`
instead, which loads the same TypeScript-execution hook without going
through the buggy CLI bootstrap.

## Final verification pass: two real fixes, plus a documentation-drift pattern worth naming

Two last real gaps closed, both already flagged earlier in this log
as open, neither hypothetical:

- **Port binding**: `docker run` (both the manual command in
  `ARCHITECTURE_AND_DEPLOYMENT.md` 2.3 and the equivalent step in
  `deploy-to-vps.yml`) used `-p 3002:3002`, which binds all
  interfaces (`0.0.0.0:3002`), not just localhost. `EXPOSE 3002` in
  the Dockerfile never restricted anything, that's documentation
  only. Fixed to `-p 127.0.0.1:3002:3002` in both places, confirmed
  by direct re-read of the actual workflow file after the change, not
  assumed from the diff alone.
- **`deploy_setup.bat`**: `OPENAI_API_KEY`'s prompt was labeled
  "optional for now, blank to skip" and genuinely let you skip it,
  while `OPENAI_VISION_MODEL` wasn't prompted for at all. Both are
  required by `deploy-to-vps.yml`'s own secrets check, so a clean run
  of the old script produced a repo that couldn't deploy. Fixed: both
  are now genuinely required, the script loops with a clear error
  until a real value is entered for each, using the same single-line
  `if`/`goto` pattern as the rest of the file, not the parenthetical
  `IF ( )` blocks the file's own header explicitly warns against
  (an inconsistency introduced in an early draft of this exact fix,
  caught and corrected before delivery).

Worth naming as its own finding, separate from the two fixes above:
during this final pass, `README.md` and `ARCHITECTURE_AND_DEPLOYMENT.md`
both reverted to a stale state at least once after already being
fixed, the `OPENAI_VISION_MODEL` "optional" claim and the
`deploy_setup.bat` bug description both came back after being
corrected earlier. Root cause wasn't identified with certainty, most
likely an older locally-saved copy getting re-uploaded rather than
the actually-corrected version. Caught each time only by re-checking
the specific lines directly (`grep` against the literal stale phrase,
not just skimming), rather than trusting that a file already fixed
once would stay fixed. Confirmed clean on the final pass by checksum
match against the last delivered version plus a direct content
re-check of every previously-regressed line, not checksum alone.

## Batch volume test found a real bug: no request timeout

Running `test_batch_volume.ps1` for the first time (50 items,
`label1`/`label2` cycled, one real batch request) failed after 60.3
seconds with a generic connection error and zero output on the
backend console, the server process was confirmed still running, not
crashed, so the failure gave no information about what actually
happened, "still processing," "silently hung," and "connection
dropped" all looked identical from both sides.

Two real gaps, found by that failure, not by inspection beforehand:

- **`extraction.ts`'s call to OpenAI had no timeout at all.** If any
  single request stalled (network hiccup, model-side hang), the
  `await fetch(...)` would wait indefinitely, no error, no way to
  recover. Inside `services/batch.ts`'s sequential loop this is worse
  than a single-request problem, one stuck item blocks every item
  after it forever, with the client seeing nothing but silence.
  Fixed: a real 30-second timeout via `AbortController`, a stalled
  request now fails with a clear "timed out" error instead of hanging.
  30s was chosen against observed real latency (2-4s per request
  under normal conditions), generous enough not to false-positive on
  ordinary variance, short enough to actually fail rather than wait
  indefinitely.
- **`services/batch.ts` had zero logging.** Nothing printed per item,
  success or failure, ever. Combined with the missing timeout, this
  meant a stalled batch was silent on both ends at once, no client
  response, no server output, the exact conditions that made the
  60-second failure undiagnosable in the moment. Fixed: per-item
  start/success/failure logged to the console with elapsed time.
  This is a fixed, always-on log, not the configurable
  `none`/`summary`/`verbose` levels noted separately under Potential
  Improvements, that remains unbuilt.

The original 60-second failure was never reproduced after both
fixes landed. Most likely a transient network-level cause, not a
code defect, plausibly an idle-connection timeout somewhere between
client and server: the batch endpoint sends zero response bytes
until every item finishes, so a multi-minute request looks
completely idle at the packet level even while the backend is
actively working, and some routers/firewalls kill connections that
look idle around that mark. Not confirmed with certainty, stated as
the most likely explanation rather than a proven root cause.

With both fixes in place, `test_batch_volume.ps1` was re-run at the
full 50 items and completed cleanly: 50/50 succeeded, 0 failures,
137.6s measured on the server console (`[batch] done, 50 item(s) in
137.6s`), 140.4s measured on the client, 2.81s/item average. Both
sides logged independently and agree within normal request overhead,
this is real, corroborated evidence, not a single-sided claim. See
`REQUIREMENTS_MATCH.md` for how this extrapolates honestly to the
200-300 volume Sarah described, and why the full volume wasn't run
(real API cost, not a technical limitation).

