// services/extraction.ts
//
// Extracts label fields from a label image via vision/OCR.
// Pure function: image buffer in, structured fields out. No Express
// dependency, so this can be lifted into a Lambda handler later with
// just a thin wrapper, same as it has one here in server.ts.
//
// Uses OpenAI's Chat Completions API with image_url content (verified
// against OpenAI's current docs, not assumed from memory: this shape
// is still supported as of mid-2026, alongside the newer Responses API).
// The model is required via OPENAI_VISION_MODEL, not hardcoded and
// not defaulted, since OpenAI has been retiring model generations
// quickly and, as of GPT-5.6, splitting each generation into
// multiple priced/tiered variants (sol/terra/luna) with real
// cost and latency differences between them. Set it explicitly in
// .env, see the error thrown below if it's missing for what to check.
//
// PERFORMANCE NOTE: single-label latency measured at 5-8 seconds,
// over the ~5s target from the interview notes. An image-resize step
// (via sharp) was tried and removed here, confirmed against the
// actual test images used (tests/label1_*, tests/label2_*, both
// under 100KB, 900-1200px) that payload size was never the
// bottleneck for this app's real usage, the latency is coming from
// the model's own response time. See DESIGN_CONSIDERATIONS.md and
// REQUIREMENTS_MATCH.md for the model-tier fix that's actually
// relevant (OPENAI_VISION_MODEL, GPT-5.6 ships as sol/terra/luna
// tiers with real speed differences), not image size.

export interface ExtractedLabelFields {
  brandName: string | null;
  classType: string | null;
  alcoholContent: string | null;
  netContents: string | null;
  // Name and address of bottler/producer, per the assessment's TTB
  // label requirements list. Kept as two separate fields rather than
  // one combined string, since matching.ts compares them independently
  // and a producer name mismatch is a different signal than an address
  // mismatch (e.g. a co-packer using the brand owner's name but its
  // own facility address).
  producerName: string | null;
  producerAddress: string | null;
  // Country of origin, required only on imports. null when the label
  // has no country-of-origin marking (the normal case for a domestic
  // product), not an extraction failure.
  countryOfOrigin: string | null;
  warningStatement: string | null;
  // 27 CFR 16.22 requires two independent conditions on the warning
  // statement's formatting: "GOVERNMENT WARNING" itself must be
  // all-caps AND bold, and the remainder of the statement must NOT be
  // bold. Per the assessment outline this is a hardcoded, exact check,
  // not an open design question, so both conditions get their own flag
  // rather than being collapsed into one.
  warningStatementFormatted: {
    governmentWarningAllCapsBold: boolean;
    remainderIsBold: boolean;
  } | null;
}

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

// No hardcoded default model. OPENAI_VISION_MODEL must be set
// explicitly, same pattern as OPENAI_API_KEY below, no silent
// fallback to a model tier baked into source that's easy to miss.
// GPT-5.6 (as of this writing) ships as three explicit tiers with
// real cost/speed differences, gpt-5.6-sol (flagship, $5/$30 per 1M
// tokens), gpt-5.6-terra (balanced, $2.50/$15), gpt-5.6-luna
// (fastest/cheapest, $1/$6), confirm which one your key should use
// and set it in .env, don't rely on a bare "gpt-5.6" alias, that
// currently routes to Sol, the slowest and most expensive tier.

const EXTRACTION_PROMPT = `You are looking at a photo of an alcohol beverage label.

Extract the following fields exactly as they appear printed on the label. If a field is not present or not legible, use null.

- brandName: the brand name on the label
- classType: the class/type designation (e.g. "Bourbon Whiskey", "Vodka", "Red Wine")
- alcoholContent: the alcohol content as printed, including the % sign (e.g. "40% ALC/VOL")
- netContents: the net contents as printed, including units (e.g. "750 mL")
- producerName: the name of the bottler or producer as printed (often after "Bottled by", "Distilled by", "Produced by", or similar). null if not present or not legible.
- producerAddress: the bottler/producer's address as printed (city and state at minimum). null if not present or not legible.
- countryOfOrigin: the country of origin as printed (e.g. "Product of Scotland", "Product of Mexico"), only present on imported products. null if there is no country-of-origin statement on the label, this is expected and normal for domestic products, not a sign of a missing field.
- warningStatement: the full text of the Government Warning statement if present, transcribed exactly as printed, character for character, including punctuation
- warningStatementFormatted: an object with two boolean fields:
  - governmentWarningAllCapsBold: true only if the words "GOVERNMENT WARNING" specifically are printed in bold, all-capital letters
  - remainderIsBold: true if any part of the statement AFTER "GOVERNMENT WARNING:" is printed in bold. This should normally be false; the remainder of the statement is required to be non-bold.

Respond with ONLY a JSON object with exactly these keys: brandName, classType, alcoholContent, netContents, producerName, producerAddress, countryOfOrigin, warningStatement, warningStatementFormatted. No prose, no markdown fences, no explanation.`;

/**
 * Extract label fields from an image buffer via OpenAI vision.
 *
 * @param imageBuffer Raw image bytes (e.g. Multer's req.file.buffer).
 * @param mimeType The image's MIME type (e.g. Multer's req.file.mimetype).
 *   Required to build a valid data: URL. Multer only puts this on the
 *   file object, not the buffer itself, so callers must pass it through
 *   explicitly rather than this function guessing a format.
 */
export async function extractLabelFields(
  imageBuffer: Buffer | undefined,
  mimeType: string | undefined
): Promise<ExtractedLabelFields> {
  if (!imageBuffer || imageBuffer.length === 0) {
    throw new Error("No label image provided");
  }
  if (!mimeType) {
    throw new Error(
      "No image MIME type provided; cannot build a data URL without it"
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const model = process.env.OPENAI_VISION_MODEL;
  if (!model) {
    throw new Error(
      "OPENAI_VISION_MODEL is not set. No default model is hardcoded " +
        "here on purpose, model tier has real cost and latency " +
        "consequences (e.g. GPT-5.6 ships as gpt-5.6-sol/-terra/-luna " +
        "as of this writing, with real price/speed differences between " +
        "them), so it must be chosen explicitly in .env rather than " +
        "silently defaulted in source."
    );
  }
  const base64Image = imageBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  // Real timeout, not indefinite. Without this, a stalled OpenAI
  // request (network hiccup, model-side hang) waits forever, no error,
  // no way to recover. This matters most in batch.ts's sequential
  // loop, where a single stuck item currently blocks every item after
  // it with no way to know from the client side, "still processing"
  // and "silently hung forever" look identical without a hard cutoff.
  // 30s is generous for a single vision call under normal conditions
  // (observed real latency: 2-4s per request against gpt-5.6-terra),
  // long enough to not false-positive on normal variance, short enough
  // to actually fail instead of hanging indefinitely.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  let response: Response;
  try {
    response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: EXTRACTION_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } }
            ]
          }
        ],
        max_completion_tokens: 1000
      }),
      signal: controller.signal
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        "OpenAI vision request timed out after 30 seconds. This is a " +
          "real timeout, not a stall, either OpenAI's API was slow to " +
          "respond or the network hiccuped. Retry the request."
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `OpenAI vision request failed (${response.status}): ${errText}`
    );
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI vision response contained no message content");
  }

  const parsed = parseJsonResponse(content);
  return normalizeExtractionResponse(parsed);
}

/**
 * Strip markdown code fences if the model wrapped its JSON in them
 * despite being told not to, then parse.
 */
function parseJsonResponse(content: string): unknown {
  const cleaned = content.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `OpenAI vision response was not valid JSON: ${cleaned.slice(0, 500)}`
    );
  }
}

function normalizeExtractionResponse(raw: unknown): ExtractedLabelFields {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;

  const asString = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value : null;

  const formatted = obj.warningStatementFormatted;
  const warningStatementFormatted =
    formatted && typeof formatted === "object"
      ? {
          governmentWarningAllCapsBold: Boolean(
            (formatted as Record<string, unknown>).governmentWarningAllCapsBold
          ),
          remainderIsBold: Boolean(
            (formatted as Record<string, unknown>).remainderIsBold
          )
        }
      : null;

  return {
    brandName: asString(obj.brandName),
    classType: asString(obj.classType),
    alcoholContent: asString(obj.alcoholContent),
    netContents: asString(obj.netContents),
    producerName: asString(obj.producerName),
    producerAddress: asString(obj.producerAddress),
    countryOfOrigin: asString(obj.countryOfOrigin),
    warningStatement: asString(obj.warningStatement),
    warningStatementFormatted
  };
}
