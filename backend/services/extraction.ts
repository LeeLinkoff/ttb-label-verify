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
// The model name is env-overridable via OPENAI_VISION_MODEL rather than
// hardcoded, since OpenAI has been retiring model generations quickly.
// DEFAULT_VISION_MODEL below reflects what was current when this was
// written; confirm it against whatever model your key actually has
// access to before relying on the default.

export interface ExtractedLabelFields {
  brandName: string | null;
  classType: string | null;
  alcoholContent: string | null;
  netContents: string | null;
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

// Confirmed against OpenAI's own images-and-vision docs as the example
// model in their current image_url usage sample. Verify this is still
// accurate and that it's a model your OPENAI_API_KEY has access to.
const DEFAULT_VISION_MODEL = "gpt-5.6";

const EXTRACTION_PROMPT = `You are looking at a photo of an alcohol beverage label.

Extract the following fields exactly as they appear printed on the label. If a field is not present or not legible, use null.

- brandName: the brand name on the label
- classType: the class/type designation (e.g. "Bourbon Whiskey", "Vodka", "Red Wine")
- alcoholContent: the alcohol content as printed, including the % sign (e.g. "40% ALC/VOL")
- netContents: the net contents as printed, including units (e.g. "750 mL")
- warningStatement: the full text of the Government Warning statement if present, transcribed exactly as printed, character for character, including punctuation
- warningStatementFormatted: an object with two boolean fields:
  - governmentWarningAllCapsBold: true only if the words "GOVERNMENT WARNING" specifically are printed in bold, all-capital letters
  - remainderIsBold: true if any part of the statement AFTER "GOVERNMENT WARNING:" is printed in bold. This should normally be false; the remainder of the statement is required to be non-bold.

Respond with ONLY a JSON object with exactly these keys: brandName, classType, alcoholContent, netContents, warningStatement, warningStatementFormatted. No prose, no markdown fences, no explanation.`;

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

  const model = process.env.OPENAI_VISION_MODEL || DEFAULT_VISION_MODEL;
  const base64Image = imageBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
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
    })
  });

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
    warningStatement: asString(obj.warningStatement),
    warningStatementFormatted
  };
}
