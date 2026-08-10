# Requirements Match

What the take-home assessment (`README.md`'s stakeholder interviews,
Technical Requirements, and Deliverables sections) asked for, checked
against what this app actually does. Verified against the real source
files, not assumed from memory. Where something isn't fully done or
wasn't tested, that's stated plainly rather than glossed over.

**Resolved since the last version of this document**: the 5-second
response target (fixed, 2.65s average after an `OPENAI_VISION_MODEL`
tier fix), the batch endpoint itself (confirmed against a real
`/api/verify/batch` request, not just single-verify calls, and
separately load-tested at 50 real items, 50/50 succeeded, 2.81s/item
average), the producer name/address/country-of-origin fields
(confirmed extracted and matched correctly against the real API, not
just verified by reading code), and alcohol content matching (was
presence/format only, a genuinely wrong ABV would have passed; now a
real numeric comparison, verified against 8 test cases including the
actual bug case, plus a real `tsc --strict` compile check). Each is
reflected below where it applies; noted here so nothing looks
silently dropped from the tables that follow.

## Deliverables

| Assessment asked for | How this app satisfies it |
|---|---|
| Source code repository (GitHub or similar) | This repo, `backend/`, `frontend/`, `tests/`, `.github/workflows/`. |
| README with setup and run instructions | `README.md`, includes local dev, Docker build, and CI/CD instructions. |
| Documentation of approach, tools, assumptions | `DESIGN_CONSIDERATIONS.md`, a running log of real decisions and trade-offs, not written after the fact. |
| Deployed application URL | Live at the domain configured in `deploy-to-vps.yml`/`deploy_setup.bat` (`https://leelinkoff.com/mvps/label-verify/`). Confirm this resolves correctly before submitting, the pipeline and Apache proxy were verified working during development (see `DESIGN_CONSIDERATIONS.md`'s Apache reload gotcha entry), but that was a point-in-time check, not something reverified in this document. |

## Core functional requirements (from stakeholder interviews)

The "Technical Requirements" section itself is intentionally open
("free to use any languages, frameworks, or libraries"), the real
functional requirements come from what Sarah, Marcus, Dave, and
Jenny described.

| What was asked for | How this app satisfies it |
|---|---|
| Match label artwork against submitted application data (brand name, ABV, warning, etc.) | `services/extraction.ts` (OpenAI vision extraction) + `services/matching.ts` (field-by-field comparison). Confirmed against the real API: 20 consecutive `/api/verify` runs across `tests/label1_*`/`label2_*` (10 each), `label1` `overallMatch: true` 10/10, `label2` `overallMatch: false` 10/10 correctly isolated to `warningStatement`, every other field matching including `producerName`/`producerAddress`/`countryOfOrigin`. |
| "If we can't get results back in about 5 seconds, nobody's going to use it" (Sarah) | One OpenAI vision call per label, no artificial delay added. Measured (20 runs across both labels): average 2.65s, range 2.12-3.64s, after switching `OPENAI_VISION_MODEL` from the bare `gpt-5.6` alias (which silently routes to the flagship `sol` tier) to `gpt-5.6-terra`. An earlier measurement against the unfixed model default came in at 5-8s, consistently at or over target; the fix brought it comfortably under. |
| UI simple enough for low-tech-comfort staff ("my mother could figure out") (Sarah) | Single-page UI, two tabs (Single Label, Batch), plain upload button and form fields, no nested menus. Usability with an actual non-technical user hasn't been tested. |
| Handle batch uploads (Sarah, Janet) | `/api/verify/batch`, `BatchVerifyPanel.jsx`. Each label processed independently (`services/batch.ts`), one bad image doesn't fail the batch. Confirmed against the real API two ways: (1) two distinct real labels in one batch, `results[0]` `overallMatch: true`, `results[1]` `overallMatch: false` isolated to `warningStatement`, array-position matching confirmed correct; (2) a real 50-item volume test, 50/50 succeeded, 0 failures, 2.81s/item average. Not run at the full 200-300 Sarah described, real API cost on an unpaid assessment, see "Known gaps" for the explicit reasoning and the honest extrapolation from the real 50-item number. |
| Judgment on near-identical text, not literal pattern matching ("STONE'S THROW" vs "Stone's Throw") (Dave) | `matching.ts`'s `normalize()` (case-fold, strip punctuation, collapse whitespace) applied to brand name, class/type, and net contents before comparing. A normalized mismatch is flagged `needsReview`, not auto-rejected. |
| Exact, zero-tolerance government warning match: word-for-word, "GOVERNMENT WARNING:" all-caps and bold, remainder not bold (Jenny) | `matching.ts` compares the extracted warning text against the canonical 27 CFR 16.21 text with no normalization, plus two independent boolean checks from `extraction.ts` (`governmentWarningAllCapsBold`, `remainderIsBold`) per 27 CFR 16.22. Verified against the exact real-world case Jenny described, title-case "Government Warning" is a hard fail, not a fuzzy match. |
| Poor image quality (angles, glare, lighting) (Jenny, flagged as "maybe out of scope for a prototype") | Explicitly out of scope, documented in `DESIGN_CONSIDERATIONS.md`'s "Scope: image quality" entry, directly citing Jenny's own framing rather than inferring it. |
| Standalone prototype, no COLA integration (Marcus) | No integration attempted, by design. |
| No PII/sensitive data storage required for the prototype (Marcus) | No auth, no data persistence beyond the request/response cycle. Documented in `DESIGN_CONSIDERATIONS.md`'s "Auth" entry, citing Marcus's statement directly. |
| Outbound network restrictions on the review environment (Marcus) | Not applicable to this deployment (self-hosted VPS, not TTB's network), noted as context rather than a constraint this build had to satisfy. |

## TTB label fields (from the "About TTB Label Requirements" section)

| Field | Status |
|---|---|
| Brand name | Extracted and matched. |
| Class/type designation | Extracted and matched (presence/format check, not full TTB class/type rule validation, see `DESIGN_CONSIDERATIONS.md`'s "Field validation depth"). |
| Alcohol content | Extracted and matched: real numeric comparison (not presence/format only), parses the percentage from both sides and compares with a 0.1-point tolerance for OCR/rounding noise. Fixed and verified: 8 test cases run directly against the logic, including the actual bug case (45% vs 40% now correctly fails), plus a real `tsc --strict` compile check. |
| Net contents | Extracted and matched. |
| Government health warning statement | Extracted and matched exactly, including bold/case formatting, per 27 CFR 16.21/16.22. |
| Name and address of bottler/producer | Extracted and matched, two independent fields (`producerName`, `producerAddress`), normalize()-then-compare, same as brand name/class type/net contents. |
| Country of origin (imports) | Extracted and matched, but only checked when the application declares one (`applicationData.countryOfOrigin` set). Skipped entirely for domestic products, not compared against an empty string, since this field is only required on imports per the assessment's own TTB requirements list. |

The assessment's own worked example (OLD TOM DISTILLERY) only exercises
brand name, class/type, alcohol content, net contents, and the warning
statement. Producer name/address and country of origin (imports only)
are also implemented, matching the full field list in the assessment's
"About TTB Label Requirements" section.

## Known gaps and unverified claims

Listed plainly rather than left implicit:

- **5-second response target**: fixed, measured at 2.65s average (20 runs, range 2.12-3.64s) after switching `OPENAI_VISION_MODEL` from the bare `gpt-5.6` alias to `gpt-5.6-terra`. No longer an open gap.
- **Outbound dependency on OpenAI's API**: Marcus described the prior vendor pilot failing partly because TTB's firewall blocked outbound connections to the vendor's ML endpoints. This app calls `api.openai.com` directly and has no fallback or workaround if that same restriction applied here. Unresolved, see `DESIGN_CONSIDERATIONS.md`'s corresponding entry.
- **200-300 label batch volume**: 50 items tested for real (`label1`/`label2` cycled, submitted as one real `/api/verify/batch` request), 50/50 succeeded, 0 failures, 140.4s total, 2.81s average per item. Full 200-300 was not run, real, explicit reason: 250 real OpenAI API calls costs real money on an unpaid take-home assessment, an unemployed candidate is not spending API budget to prove a sequential loop scales, when the same proof at 1/5th the volume costs a fraction as much and extrapolates linearly. At the confirmed 2.81s/item average, 250 items extrapolates to roughly 11.7 minutes; this is arithmetic from a real measured number, not a separate guess, but it is not the same claim as having actually run 250. `services/batch.ts` is still strictly sequential, no concurrency, see the fix below.
- **Non-technical usability**: designed for it, not user-tested.
- **Image quality robustness**: out of scope by design, not attempted.
- **Beer and wine label rules**: out of scope, this app was tested against distilled spirits labels only, per `DESIGN_CONSIDERATIONS.md`'s "Scope: beverage category".

## Shortcomings and how I'd fix them

Every open gap above, with a concrete next step rather than just a
flag. Ordered roughly by how much it matters for a real deployment,
not by how easy the fix is.

| Shortcoming | How I'd fix it |
|---|---|
| **200-300 label batch volume**, `services/batch.ts` processes items strictly sequentially, one `await` at a time. 50 items confirmed for real (50/50 succeeded, 140.4s, 2.81s/item average), full 200-300 not run, real explicit reason: cost, 250 real API calls on an unpaid assessment with no employer funding it, not a technical limitation. At the confirmed 2.81s/item rate, 250 items extrapolates to roughly 11.7 minutes, arithmetic from real data, not a separate guess, but still not the same as having run it. | Add bounded concurrency to `verifyBatch()`, process items in parallel batches of, say, 5-10 concurrent OpenAI requests instead of one at a time (a simple concurrency-limited pool, no new infrastructure needed), then actually load-test with 200-300 real images to get a true end-to-end number before claiming this is solved. |
| **This app depends on direct outbound access to `api.openai.com`**, the same class of dependency Marcus said broke the prior vendor pilot on TTB's real network. | Before any real deployment: confirm with Marcus's team whether outbound HTTPS to OpenAI's API is actually reachable from TTB's network. If not, the realistic fallback given Marcus mentioned TTB is already on Azure: Azure OpenAI Service, which can be reached through the same network TTB already trusts rather than a new external domain, would need its own integration work (different auth model, possibly different request/response shape) but solves the actual blocking issue rather than working around it. |
| **No non-technical user has ever actually used this UI.** Designed for Sarah's "my mother could figure out" bar, never tested against it. | Run one real, unscripted session with someone matching that description, present the app with no explanation, watch where they hesitate or get stuck, fix what actually confuses them rather than what I assume would. This is cheap to do and currently just hasn't been done. |
| **Class/type and net contents aren't validated against TTB's actual regulatory taxonomy**, only checked against whatever the application itself submitted. | Out of reach without real TTB reference data, this would need an actual TTB class/type dataset (if one exists in a queryable form) to check submitted values against, not something to fake with a hardcoded list. Would flag this as a scoping question for whoever owns the real requirements, not something to guess my way into building. |
| **Image quality (angle, glare, lighting) is entirely untested**, explicitly out of scope per Jenny's own framing. | If ever brought in scope: have the vision model return a confidence/legibility signal per field alongside the extracted value (the prompt would need to ask for this explicitly), and route low-confidence extractions to mandatory human review rather than silently returning a wrong or null value with no signal that the image itself was the problem. |
| **Batch matches images to application data strictly by array position**, with no identifier tying a specific image to a specific data row beyond ordering. If the two arrays were ever built out of sync, results would silently pair the wrong label with the wrong data. | Add a client-generated correlation ID per batch item, sent alongside both the image and its application data, and echoed back in the result, so a mismatch is detectable instead of silent. Small, contained change to `BatchItem`, `BatchResultItem`, and the frontend's item state, doesn't require rethinking the batch architecture. |


