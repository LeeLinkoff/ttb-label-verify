// services/batch.ts
//
// Orchestrates extraction + matching across multiple label/application
// pairs. No business logic of its own, just sequencing and per-item
// error isolation so one bad image doesn't fail the whole batch.
// Later this becomes either a Lambda with a loop or a Step Functions
// map state calling the same extraction/matching functions.
//
// Logs per-item start/success/failure to the console. Previously this
// was completely silent, a batch of any real size gave zero server-
// side visibility into progress, and "no console output" was
// indistinguishable from "crashed," "hung," or "working fine," all
// three look identical when nothing is ever printed. This is the
// bare minimum, not the full "configurable logging: none/summary/
// verbose" improvement noted in README.md's Potential Improvements,
// that's still not built, this just stops the console being totally
// silent during a batch run.

import { extractLabelFields } from "./extraction";
import { matchLabelToApplication, ApplicationData, MatchResult } from "./matching";

export interface BatchItem {
  imageBuffer: Buffer;
  mimeType: string;
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
  const batchStart = Date.now();
  console.log(`[batch] starting, ${items.length} item(s)`);

  for (let i = 0; i < items.length; i++) {
    const itemStart = Date.now();
    console.log(`[batch] item ${i + 1}/${items.length} (index ${i}): starting`);
    try {
      const extracted = await extractLabelFields(
        items[i].imageBuffer,
        items[i].mimeType
      );
      const result = matchLabelToApplication(extracted, items[i].applicationData);
      const elapsed = ((Date.now() - itemStart) / 1000).toFixed(1);
      console.log(`[batch] item ${i + 1}/${items.length}: ok, overallMatch=${result.overallMatch}, ${elapsed}s`);
      results.push({ index: i, ok: true, result });
    } catch (err) {
      // One bad label shouldn't fail the whole batch.
      const message = err instanceof Error ? err.message : String(err);
      const elapsed = ((Date.now() - itemStart) / 1000).toFixed(1);
      console.log(`[batch] item ${i + 1}/${items.length}: FAILED after ${elapsed}s: ${message}`);
      results.push({ index: i, ok: false, error: message });
    }
  }

  const totalElapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
  console.log(`[batch] done, ${items.length} item(s) in ${totalElapsed}s`);

  return results;
}
