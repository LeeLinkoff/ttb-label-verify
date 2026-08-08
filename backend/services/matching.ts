// services/matching.ts
//
// Compares extracted label fields against submitted application data.
// Pure function: two field objects in, per-field match result out.
// No Express dependency.

import { ExtractedLabelFields } from "./extraction";

// Canonical text per 27 CFR 16.21. Checked exactly, not fuzzy-matched.
// "GOVERNMENT WARNING" must be all-caps and bold per 27 CFR 16.22; the
// remainder of the statement must not be bold.
export const GOVERNMENT_WARNING_TEXT: string =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should not " +
  "drink alcoholic beverages during pregnancy because of the risk of birth defects. " +
  "(2) Consumption of alcoholic beverages impairs your ability to drive a car or " +
  "operate machinery, and may cause health problems.";

export interface ApplicationData {
  brandName?: string;
  classType?: string;
  alcoholContent?: string;
  netContents?: string;
  [key: string]: unknown;
}

export interface FieldMatchResult {
  match: boolean;
  extracted: string;
  applied: string;
  needsReview: boolean;
}

export interface MatchResult {
  overallMatch: boolean;
  fields: Record<string, FieldMatchResult>;
}

/**
 * Normalize a string for tolerant field comparison (case, whitespace,
 * punctuation). NOT used for the warning statement, which must match
 * exactly per 27 CFR 16.21/16.22.
 */
export function normalize(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compare extracted label fields against submitted application data.
 */
export function matchLabelToApplication(
  extractedFields: ExtractedLabelFields,
  applicationData: ApplicationData
): MatchResult {
  // TODO: implement per-field comparison.
  //   - brandName / classType / netContents: normalize() then compare;
  //     if normalized values don't match, needsReview = true rather than
  //     an automatic reject (see outline: "Open engineering judgment calls").
  //   - alcoholContent / netContents: presence + format check only.
  //   - warningStatement: exact match against GOVERNMENT_WARNING_TEXT,
  //     plus the allCapsBold flag from extraction. No normalization here.
  throw new Error("matchLabelToApplication not implemented");
}
