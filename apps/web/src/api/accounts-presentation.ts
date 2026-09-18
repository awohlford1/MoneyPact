/**
 * CBD-198 (AC01-AC05), verification concerns CBD-195: presentation-only helpers for the manual accounts
 * lifecycle view. Nothing here computes a figure -- every amount the view shows is the API's own value,
 * already formatted by `formatMinorUnits` before it reaches this module. This file holds no JSX so it can
 * be unit-tested directly under this workspace's plain `node --test`, exactly as `resource-state.ts` is.
 *
 * The account types are the mock's own list (`mock-server.ts` `ACCOUNT_TYPES`); the same five duplicated in
 * `spending.tsx`'s embedded accounts form, which this packet does not touch (out of scope: any edit to
 * `client.ts` or `mock-server.ts` beyond the shared registry line, and `spending.tsx` is UI-P01/dashboard
 * territory). Keeping the list here rather than importing it from `mock-server.ts` avoids a browser-code
 * import of a development-only, Node-only module.
 */
import { ApiError, fieldErrorFor, IN_FLIGHT_MESSAGE } from "./client.ts";
import type { Account } from "./client.ts";

export const ACCOUNT_TYPES = ["checking", "savings", "cash", "credit-card", "other"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

const ACCOUNT_TYPE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  checking: "Checking",
  savings: "Savings",
  cash: "Cash",
  "credit-card": "Credit card",
  other: "Other",
});

/** A canonical account type as a person reads it; an account type the mock has not named yet is shown verbatim
 * rather than hidden, so a future type never disappears from this list silently. */
export function accountTypeLabel(accountType: string): string {
  return ACCOUNT_TYPE_LABELS[accountType] ?? accountType;
}

/** The State column's word (CBD-198-AC03: distinguishable in text, never colour alone). */
export function accountStateLabel(account: Pick<Account, "archived">): string {
  return account.archived ? "Archived" : "Active";
}

export type AccountMutationAction = "added" | "edited" | "archived" | "restored";

/** The polite announcement for a completed mutation (CBD-198-AC02). Archiving names what is kept, per
 * CBD-72 row 36 -- archive is not deletion, and the copy says so and says what survives it. */
export function accountAnnouncement(action: AccountMutationAction, label: string): string {
  switch (action) {
    case "added": return `${label} added.`;
    case "edited": return `${label} updated.`;
    case "archived": return `${label} archived. Its transaction and audit history is kept, and it no longer appears in ordinary views, search, reports or totals.`;
    case "restored": return `${label} restored.`;
  }
}

/**
 * How a failed account read or mutation is reported (CBD-198-AC02/AC03). Four kinds, each with its own
 * presentation:
 *  - `validation`: a 400 the person can fix by changing the named field. Focus moves there; every other
 *    entered value survives untouched.
 *  - `conflict`: a 409. The mock's account routes carry no client-stated version precondition (unlike the
 *    transactions routes' `expectedTransactionVersionId`), so every 409 an account write returns --
 *    `label_taken`, `account_archived`, `account_not_archived` -- is a fact that changed underneath the
 *    caller, not a value to correct and resubmit. Input is preserved, but the caller reviews the current
 *    account before trying again rather than silently overwriting it.
 *  - `in_flight`: the client's own 429 retry was also refused; the standing `IN_FLIGHT_MESSAGE`.
 *  - `denied`: 401/403. Uniform and uninformative (CBD-243-AC07): never distinguishes "does not exist" from
 *    "you may not see it".
 *  - `other`: a lost response (network failure) or an unrecognised refusal.
 */
export interface AccountErrorReport {
  kind: "validation" | "conflict" | "in_flight" | "denied" | "other";
  /** Field path -> message, from the server's own canonical code via `fieldErrorFor`. Empty for `in_flight`,
   * `denied` and `other`, which name no field. */
  fields: Record<string, string>;
  /** The one sentence a status region or alert announces. */
  summary: string;
}

export function reportAccountError(error: unknown): AccountErrorReport {
  if (error instanceof ApiError && error.status === 429) return { kind: "in_flight", fields: {}, summary: IN_FLIGHT_MESSAGE };
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return { kind: "denied", fields: {}, summary: "Your current session cannot do this here." };
  }
  if (error instanceof ApiError) {
    const reported = error.fieldErrors.length ? error.fieldErrors : [fieldErrorFor(error)];
    const fields: Record<string, string> = {};
    for (const field of reported) fields[field.path] = field.message;
    return { kind: error.status === 409 ? "conflict" : "validation", fields, summary: reported[0]!.message };
  }
  return { kind: "other", fields: {}, summary: "We could not save this change. You can try again." };
}
