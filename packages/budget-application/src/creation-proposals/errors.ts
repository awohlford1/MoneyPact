/**
 * Canonical field-error envelope and codes (CBD-232 §5.1, §5.2).
 */

export interface FieldError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface ValidationErrorResponse {
  readonly error: "validation_failed";
  readonly fieldErrors: readonly FieldError[];
}

/** The five request fields in the §5.1 declared ordering. */
export const REQUEST_FIELD_ORDER = [
  "name",
  "timeZone",
  "currencyCode",
  "schedule",
  "supersedesProposalId",
] as const;

/**
 * Ordering bucket for a field error, per §5.1: header first, then top-level
 * unknown fields (their own bucket, sorted lexically), then each declared
 * request field in order. A nested unknown field (e.g. under `schedule`)
 * sorts with its owning request field, which this function expresses by
 * mapping any path to the request field it starts with.
 */
export function sortBucket(path: string): number {
  if (path.startsWith("header.")) return 0;
  const owningField = REQUEST_FIELD_ORDER.find(
    (field) => path === field || path.startsWith(`${field}.`),
  );
  if (owningField === undefined) return 1; // top-level unknown field
  return 2 + REQUEST_FIELD_ORDER.indexOf(owningField);
}

/** Stable output ordering: bucket, then lexical path, then lexical code. */
export function sortFieldErrors(errors: readonly FieldError[]): FieldError[] {
  return [...errors].sort((a, b) => {
    const bucketDelta = sortBucket(a.path) - sortBucket(b.path);
    if (bucketDelta !== 0) return bucketDelta;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return 0;
  });
}
