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

// Extracts a percentage number from strings like "45% Alc./Vol. (90 Proof)",
// "12.5 %", "40% ALC/VOL". Returns null if no percentage pattern is found,
// callers treat that as a mismatch, not a silent pass, an unparseable
// value is not the same thing as a confirmed-correct one.
function extractPercentage(value: string): number | null {
  const match = value.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  if (!match) return null;
  return parseFloat(match[1]);
}

// Real values are never fully clean: OCR rounding, a label printed as
// "45.0%" against an application entered as "45%", etc. 0.1 percentage
// points is enough slack to absorb that without opening the door to a
// genuinely different ABV (e.g. 45% vs 40%) passing as a rounding
// difference.
const ALCOHOL_CONTENT_TOLERANCE = 0.1;

export interface ApplicationData {
  brandName?: string;
  classType?: string;
  alcoholContent?: string;
  netContents?: string;
  producerName?: string;
  producerAddress?: string;
  // Only present on imports. If unset, this is a domestic product and
  // countryOfOrigin is not checked at all, see matchLabelToApplication.
  countryOfOrigin?: string;
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
 * and classType, since that was the more specific instruction.
 * alcoholContent uses its own numeric comparison (see extractPercentage
 * above), not normalize(), a percentage needs a real numeric match, not
 * a text-normalized one.
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
  compareNormalized("producerName", extractedFields.producerName, applicationData.producerName);
  compareNormalized("producerAddress", extractedFields.producerAddress, applicationData.producerAddress);

  // countryOfOrigin is only required on imports (TTB requirements
  // list it as "Country of origin for imports"). If the application
  // doesn't declare one, this is a domestic product and the field is
  // skipped entirely, not checked and not flagged, rather than
  // comparing against an empty string and generating a false
  // needsReview on every domestic label.
  if (applicationData.countryOfOrigin) {
    compareNormalized("countryOfOrigin", extractedFields.countryOfOrigin, applicationData.countryOfOrigin);
  }

  // alcoholContent: real numeric comparison, not a presence/format-only
  // check. Both sides are parsed to a percentage number and compared
  // with a small tolerance (ALCOHOL_CONTENT_TOLERANCE) to absorb
  // formatting/rounding noise ("12%" vs "12% ALC/VOL" vs "12.0%
  // ALC./VOL.") without letting a genuinely different ABV pass. Either
  // side failing to parse is a mismatch, not a silent pass, an
  // unparseable value is not a confirmed-correct one.
  const alcoholExtracted = extractedFields.alcoholContent || "";
  const alcoholApplied = applicationData.alcoholContent || "";
  const extractedPct = extractPercentage(alcoholExtracted);
  const appliedPct = extractPercentage(alcoholApplied);
  const alcoholMatch =
    extractedPct !== null &&
    appliedPct !== null &&
    Math.abs(extractedPct - appliedPct) <= ALCOHOL_CONTENT_TOLERANCE;
  fields.alcoholContent = {
    match: alcoholMatch,
    extracted: alcoholExtracted,
    applied: alcoholApplied,
    needsReview: !alcoholMatch
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
