// services/extraction.ts
//
// Extracts label fields from a label image via vision/OCR.
// Pure function: image buffer in, structured fields out. No Express
// dependency, so this can be lifted into a Lambda handler later with
// just a thin wrapper, same as it has one here in server.ts.

export interface ExtractedLabelFields {
  brandName: string | null;
  classType: string | null;
  alcoholContent: string | null;
  netContents: string | null;
  warningStatement: string | null;
  warningStatementFormatted: { allCapsBold: boolean } | null;
}

/**
 * Extract label fields from an image buffer.
 */
export async function extractLabelFields(
  imageBuffer: Buffer | undefined
): Promise<ExtractedLabelFields> {
  // TODO: call vision/OCR provider (OpenAI vision, Claude vision, etc),
  // parse the response into these fields.
  throw new Error("extractLabelFields not implemented");
}
