// services/batch.ts
//
// Orchestrates extraction + matching across multiple label/application
// pairs. No business logic of its own, just sequencing and per-item
// error isolation so one bad image doesn't fail the whole batch.
// Later this becomes either a Lambda with a loop or a Step Functions
// map state calling the same extraction/matching functions.

import { extractLabelFields } from "./extraction";
import { matchLabelToApplication, ApplicationData, MatchResult } from "./matching";

export interface BatchItem {
  imageBuffer: Buffer;
  applicationData: ApplicationData;
}

export interface BatchResultItem {
  index: number;
  ok: boolean;
  result?: MatchResult;
  error?: string;
}

export async function verifyBatch(items: BatchItem[]): Promise<BatchResultItem[]> {
  const results: BatchResultItem[] = [];

  for (let i = 0; i < items.length; i++) {
    try {
      const extracted = await extractLabelFields(items[i].imageBuffer);
      const result = matchLabelToApplication(extracted, items[i].applicationData);
      results.push({ index: i, ok: true, result });
    } catch (err) {
      // One bad label shouldn't fail the whole batch.
      const message = err instanceof Error ? err.message : String(err);
      results.push({ index: i, ok: false, error: message });
    }
  }

  return results;
}
