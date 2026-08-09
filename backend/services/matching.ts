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

// Loose format check for alcohol content, e.g. "40%", "12.5 %", "40% ALC/VOL".
// Deliberately permissive: this is a presence/format check per the design
// note below, not a strict-value comparison.
const ALCOHOL_CONTENT_FORMAT = /\d{1,2}(\.\d+)?\s*%/;

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
 *
 * NOTE on netContents: the original TODO in this file listed netContents
 * under both the "normalize() then compare" group and the "presence +
 * format check only" group, which is contradictory. This implementation
 * treats netContents as normalize()-and-compare, grouped with brandName
 * and classType, since that was the more specific instruction. Flag if
 * that's not the intended behavior; alcoholContent is the only field
 * getting presence/format-only treatment here.
 */
export function matchLabelToApplication(
  extractedFields: ExtractedLabelFields,
  applicationData: ApplicationData
): MatchResult {
  const fields: Record<string, FieldMatchResult> = {};

  // brandName / classType / netContents: normalize() then compare.
  // A normalized mismatch does NOT auto-reject, it's flagged for human
  // review (needsReview = true) rather than treated as a hard failure.
  const compareNormalized = (
    key: string,
    extracted: string | null,
    applied: string | undefined
  ): void => {
    const extractedStr = extracted || "";
    const appliedStr = applied || "";
    const isMatch = normalize(extractedStr) === normalize(appliedStr);
    fields[key] = {
      match: isMatch,
      extracted: extractedStr,
      applied: appliedStr,
      needsReview: !isMatch
    };
  };

  compareNormalized("brandName", extractedFields.brandName, applicationData.brandName);
  compareNormalized("classType", extractedFields.classType, applicationData.classType);
  compareNormalized("netContents", extractedFields.netContents, applicationData.netContents);

  // alcoholContent: presence + format check only, not an exact-value
  // compare against applicationData.alcoholContent. ABV is printed with
  // enough formatting variance (e.g. "12%" vs "12% ALC/VOL" vs "12.0%
  // ALC./VOL.") that a strict equality check would produce a lot of
  // false needsReview flags for content that's actually fine.
  const alcoholExtracted = extractedFields.alcoholContent || "";
  const alcoholApplied = applicationData.alcoholContent || "";
  const alcoholFormatOk = ALCOHOL_CONTENT_FORMAT.test(alcoholExtracted);
  fields.alcoholContent = {
    match: alcoholFormatOk,
    extracted: alcoholExtracted,
    applied: alcoholApplied,
    needsReview: !alcoholFormatOk
  };

  // warningStatement: exact match against GOVERNMENT_WARNING_TEXT, plus
  // the formatting flags from extraction. Per 27 CFR 16.22 and the
  // assessment outline, this is hardcoded and exact on two independent
  // conditions: "GOVERNMENT WARNING" must be all-caps and bold, AND the
  // remainder of the statement must NOT be bold. No normalize() here,
  // the statement's exact wording is a regulatory requirement, not a
  // fuzzy-match candidate.
  const warningExtracted = extractedFields.warningStatement || "";
  const warningTextExact = warningExtracted.trim() === GOVERNMENT_WARNING_TEXT.trim();
  const warningFormatting = extractedFields.warningStatementFormatted;
  const leadInBoldOk = warningFormatting?.governmentWarningAllCapsBold ?? false;
  const remainderNotBoldOk = warningFormatting ? !warningFormatting.remainderIsBold : false;
  const warningOk = warningTextExact && leadInBoldOk && remainderNotBoldOk;
  fields.warningStatement = {
    match: warningOk,
    extracted: warningExtracted,
    applied: GOVERNMENT_WARNING_TEXT,
    needsReview: !warningOk
  };

  const overallMatch = Object.values(fields).every((f) => f.match);

  return { overallMatch, fields };
}
