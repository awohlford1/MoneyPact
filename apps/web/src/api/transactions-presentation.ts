/**
 * UI-P03 (CBD-202): presentation-only helpers for the manual transactions view, following the precedent
 * `accounts-presentation.ts` set (UI-P02). Nothing here computes a figure -- every amount the view shows is
 * the API's own value, already formatted by `formatMinorUnits`/`toTransactionRow` before it reaches this
 * module. No JSX, so it is unit-testable directly under this workspace's plain `node --test`.
 */
import { ApiError, fieldErrorFor, IN_FLIGHT_MESSAGE } from "./client.ts";

export type TransactionMutationAction = "recorded" | "updated" | "removed";

/** The polite announcement for a completed mutation (CBD-202-AC01/AC02). */
export function transactionAnnouncement(action: TransactionMutationAction): string {
  switch (action) {
    case "recorded": return "Transaction recorded.";
    case "updated": return "Transaction updated.";
    case "removed": return "Transaction removed.";
  }
}

/**
 * How a failed transaction read or write is reported (CBD-202-AC02/AC03). Five kinds:
 *  - `validation`: a 400 the person can fix by changing the named field. Focus moves there; every other
 *    entered value survives untouched.
 *  - `stale`: `409 stale_version` (CBD-200-F03) -- the transaction changed underneath this view since it was
 *    opened. Input is preserved and nothing is overwritten; the caller reviews the current version or tries
 *    again, never a silent resubmission over the newer one.
 *  - `conflict`: any other 409 (`transaction_removed`, `idempotency_mismatch`, `account_archived`, ...) -- a
 *    fact that changed underneath the caller, reviewed the same way a stale version is.
 *  - `in_flight`: the client's own 429 retry was also refused; the standing `IN_FLIGHT_MESSAGE`.
 *  - `denied`: 401/403. Uniform and uninformative (CBD-243-AC07): never distinguishes "does not exist" from
 *    "you may not see it".
 *  - `other`: a lost response (network failure) or an unrecognised refusal.
 */
export interface TransactionErrorReport {
  kind: "validation" | "stale" | "conflict" | "in_flight" | "denied" | "other";
  /** Field path -> message, from the server's own canonical code via `fieldErrorFor`. Empty for every kind
   * but `validation`, `stale` and `conflict`, which name the field the code is about. */
  fields: Record<string, string>;
  /** The one sentence a status region or alert announces. */
  summary: string;
}

export function reportTransactionError(error: unknown): TransactionErrorReport {
  if (error instanceof ApiError && error.status === 429) return { kind: "in_flight", fields: {}, summary: IN_FLIGHT_MESSAGE };
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return { kind: "denied", fields: {}, summary: "Your current session cannot do this here." };
  }
  if (error instanceof ApiError && error.status === 409 && error.code === "stale_version") {
    const reported = error.fieldErrors.length ? error.fieldErrors : [fieldErrorFor(error)];
    const fields: Record<string, string> = {};
    for (const field of reported) fields[field.path] = field.message;
    return { kind: "stale", fields, summary: "This transaction changed since you opened it." };
  }
  if (error instanceof ApiError) {
    const reported = error.fieldErrors.length ? error.fieldErrors : [fieldErrorFor(error)];
    const fields: Record<string, string> = {};
    for (const field of reported) fields[field.path] = field.message;
    return { kind: error.status === 409 ? "conflict" : "validation", fields, summary: reported[0]!.message };
  }
  return { kind: "other", fields: {}, summary: "We could not save this change. You can try again." };
}
