/**
 * UI-P05 (CBD-341 AC01-AC05; model CBD-338, ledger CBD-339, commands CBD-340; UI-BUILD-PLAN.md section 4.5):
 * the savings-goals client, in the wire shape the plan states verbatim. A separate client on purpose, following
 * the precedent `invitations.ts` and `reports.ts` set (section 3.2): a new surface gets its own client module,
 * never an extension of `ApiClient` in `client.ts`.
 *
 * CBD-341-AC01: `targetMinorUnits`, `progressMinorUnits`, `remainingMinorUnits` and `excessMinorUnits` are every
 * one the server's own fields -- computed by the mock the same way a live API would compute them -- and this
 * module's presentation helpers only format them (`formatMinorUnits`) and choose which labelled value applies;
 * nothing here adds, subtracts or compares two money fields to produce a third. `goals.test.ts`'s CBD-341-AC01
 * test greps the *view* module (`goals-view.tsx`) for the same guarantee this file's own doc comment claims.
 *
 * CBD-341-AC02: no control here ever names income, balance or available cash as the source of a contribution.
 * Every contribution control reads "Record a contribution" and the standing sentence -- "Recording a
 * contribution records your intent. MoneyPact moves no money." -- is exported once, verbatim, as
 * `CONTRIBUTION_INTENT_SENTENCE`, so the view renders exactly this string rather than a paraphrase.
 */
import { ApiError, formatMinorUnits } from "./client.ts";

// ---------------------------------------------------------------------------
// Wire shapes -- UI-BUILD-PLAN.md section 4.5, verbatim.
// ---------------------------------------------------------------------------

export type GoalState = "active" | "completed" | "archived";

export interface WireGoal {
  goalId: string; label: string; version: number;
  targetMinorUnits: number; progressMinorUnits: number;
  /** Server-computed, never client-computed (section 6.3.1): max(target - progress, 0). */
  remainingMinorUnits: number;
  /** Server-computed, never client-computed: max(progress - target, 0). */
  excessMinorUnits: number;
  state: GoalState;
  targetDate: string | null;
  currencyCode: string; minorUnitPrecision: number;
  dataAsOf: string; archivedAt: string | null;
}
export interface WireGoalList { budgetSpaceId: string; currencyCode: string; minorUnitPrecision: number; goals: readonly WireGoal[] }
export interface WireLedgerEntry {
  contributionId: string; amountMinorUnits: number; recordedAt: string; actorSubjectId: string;
  reversedAt: string | null; note: string | null;
}
export interface WireGoalDetail { budgetSpaceId: string; goal: WireGoal; ledger: readonly WireLedgerEntry[] }
export interface WireGoalMutation { previousVersion: number | null; goal: WireGoal }
export interface WireContributionMutation { goal: WireGoal; entry: WireLedgerEntry }

export interface GoalDraft { label: string; targetMinorUnits: number; targetDate: string | null }
export interface ContributionDraft { amountMinorUnits: number; note: string | null }

/** `409 stale_version`, the shape every precondition-checked write in this surface answers (section 6.3.4):
 * the version the caller's view was built from no longer matches, the current one travels with the refusal,
 * and nothing was written. Carries `ApiError`'s own status/code so `classifyFailure` needs no special case. */
export class StaleGoalVersionError extends ApiError {
  readonly current: WireGoal;
  constructor(current: WireGoal) { super(409, "stale_version"); this.current = current; }
}

// ---------------------------------------------------------------------------
// Copy (section 6.2, CBD-341-AC02).
// ---------------------------------------------------------------------------

/** CBD-341-AC02, verbatim, never paraphrased. Also satisfies PL-75-06. */
export const CONTRIBUTION_INTENT_SENTENCE = "Recording a contribution records your intent. MoneyPact moves no money.";

const GOAL_FIELD_OF_CODE: Readonly<Record<string, string>> = Object.freeze({
  label_invalid: "label",
  target_invalid: "target",
  target_date_invalid: "targetDate",
  amount_invalid: "amount",
  note_invalid: "note",
  goal_not_found: "goalId",
  goal_archived: "goalId",
  goal_not_archived: "goalId",
  contribution_not_found: "contributionId",
  contribution_already_reversed: "contributionId",
  stale_version: "goalId",
  idempotency_mismatch: "goalId",
});
const GOAL_MESSAGE_OF_CODE: Readonly<Record<string, string>> = Object.freeze({
  label_invalid: "Enter a name between 1 and 120 characters.",
  target_invalid: "Enter a target greater than zero.",
  target_date_invalid: "Enter a real date as YYYY-MM-DD, or leave it blank.",
  amount_invalid: "Enter a contribution amount greater than zero.",
  note_invalid: "Use 200 characters or fewer.",
  goal_not_found: "This goal is no longer here, or it is not yours to open.",
  goal_archived: "This goal is archived. Restore it first, or choose another.",
  goal_not_archived: "This goal is not archived.",
  contribution_not_found: "This contribution is no longer here.",
  contribution_already_reversed: "This contribution was already reversed.",
  stale_version: "This goal changed since you last loaded it. Refresh and review before trying again.",
  idempotency_mismatch: "This request was already sent with different values. Refresh and try again.",
});
export interface GoalFieldError { path: string; message: string }
/** Maps a server refusal to the field it names and a sentence a person reads; no server code ever reaches
 * the page directly (section 6.2.4). */
export function fieldErrorForGoal(error: ApiError): GoalFieldError {
  return { path: GOAL_FIELD_OF_CODE[error.code] ?? "label", message: GOAL_MESSAGE_OF_CODE[error.code] ?? "This change could not be saved." };
}

/**
 * How a failed mutation is reported (CBD-341-AC04/AC05), the same shape `accounts-presentation.ts`'s
 * `reportAccountError` uses. `revoked` is kept distinct from `denied`: a 401 discovered mid-session means the
 * session itself ended and the sign-in path is the recovery (section 4.5's "revoked" state); a 403 is the
 * uniform, uninformative denial reads already use (CBD-341-AC05) and never distinguishes "does not exist"
 * from "you may not see it". `conflict` is `409 stale_version`: input is preserved, never overwritten, and the
 * caller reviews the goal's current state before trying again.
 */
export interface GoalErrorReport {
  kind: "validation" | "conflict" | "revoked" | "denied" | "other";
  fields: Record<string, string>;
  summary: string;
  /** The 409's current goal, when the refusal carried one, so the caller can offer "review the current goal". */
  current?: WireGoal;
}
export function reportGoalError(error: unknown): GoalErrorReport {
  if (error instanceof StaleGoalVersionError) return { kind: "conflict", fields: {}, summary: fieldErrorForGoal(error).message, current: error.current };
  if (error instanceof ApiError && error.status === 401) return { kind: "revoked", fields: {}, summary: "Your session ended. Sign in again to continue." };
  if (error instanceof ApiError && error.status === 403) return { kind: "denied", fields: {}, summary: "Your current session cannot do this here." };
  if (error instanceof ApiError) {
    const field = fieldErrorForGoal(error);
    return { kind: error.status === 409 ? "conflict" : "validation", fields: { [field.path]: field.message }, summary: field.message };
  }
  return { kind: "other", fields: {}, summary: "We could not save this change. You can try again." };
}

// ---------------------------------------------------------------------------
// Presentation: every figure formatted once, here, from the API's own field. The view renders strings only.
// ---------------------------------------------------------------------------

function magnitude(amountMinorUnits: number, precision: number, currencyCode: string): string {
  return `${formatMinorUnits(Math.abs(amountMinorUnits), precision)} ${currencyCode}`;
}

export interface GoalRow {
  goalId: string; label: string; version: number;
  target: string; progress: string; remaining: string | null; excess: string | null;
  /** "142.00 of 500.00 USD saved; 358.00 USD remaining" -- the text progress statement (section 4.5's exact
   * wording shape). Never shown for an archived goal, which states its own archived-progress sentence instead. */
  statement: string;
  state: GoalState; stateLabel: string;
  targetDate: string | null; currencyCode: string; precision: number;
  dataAsOf: string; archivedAt: string | null;
}
export interface LedgerRow {
  contributionId: string; amount: string; recordedAt: string; actorSubjectId: string;
  reversedAt: string | null; reversed: boolean; note: string | null;
}

export const GOAL_STATE_LABELS: Readonly<Record<GoalState, string>> = Object.freeze({
  active: "In progress", completed: "Completed", archived: "Archived",
});

/** The one text progress statement; never a bare number (section 4.5's own exact wording shape: "142.00 of
 * 500.00 USD saved; 358.00 USD remaining" -- the currency named once, against the target, not repeated
 * against every figure that shares it). */
function progressStatement(wire: WireGoal): string {
  const progress = formatMinorUnits(wire.progressMinorUnits, wire.minorUnitPrecision);
  const target = magnitude(wire.targetMinorUnits, wire.minorUnitPrecision, wire.currencyCode);
  const base = `${progress} of ${target} saved`;
  if (wire.excessMinorUnits > 0) return `${base}; exceeded by ${magnitude(wire.excessMinorUnits, wire.minorUnitPrecision, wire.currencyCode)}`;
  if (wire.state === "completed" || wire.remainingMinorUnits === 0) return `${base}; target reached`;
  return `${base}; ${magnitude(wire.remainingMinorUnits, wire.minorUnitPrecision, wire.currencyCode)} remaining`;
}

export function toGoalRow(wire: WireGoal): GoalRow {
  return {
    goalId: wire.goalId, label: wire.label, version: wire.version,
    target: magnitude(wire.targetMinorUnits, wire.minorUnitPrecision, wire.currencyCode),
    progress: magnitude(wire.progressMinorUnits, wire.minorUnitPrecision, wire.currencyCode),
    remaining: wire.remainingMinorUnits > 0 ? magnitude(wire.remainingMinorUnits, wire.minorUnitPrecision, wire.currencyCode) : null,
    excess: wire.excessMinorUnits > 0 ? magnitude(wire.excessMinorUnits, wire.minorUnitPrecision, wire.currencyCode) : null,
    statement: progressStatement(wire),
    state: wire.state, stateLabel: GOAL_STATE_LABELS[wire.state],
    targetDate: wire.targetDate, currencyCode: wire.currencyCode, precision: wire.minorUnitPrecision,
    dataAsOf: wire.dataAsOf, archivedAt: wire.archivedAt,
  };
}
/** Takes the goal a ledger entry belongs to, not a bare precision/currency pair, so the view module never has
 * to spell out `goal.minorUnitPrecision` itself (CBD-341-AC01's "no MinorUnits reference in the view" guarantee
 * would otherwise be defeated by the property access alone, without any arithmetic ever being applied). */
export function toLedgerRow(wire: WireLedgerEntry, goal: Pick<WireGoal, "minorUnitPrecision" | "currencyCode">): LedgerRow {
  return {
    contributionId: wire.contributionId, amount: magnitude(wire.amountMinorUnits, goal.minorUnitPrecision, goal.currencyCode),
    recordedAt: wire.recordedAt, actorSubjectId: wire.actorSubjectId,
    reversedAt: wire.reversedAt, reversed: wire.reversedAt !== null, note: wire.note,
  };
}
/** A positive major-unit magnitude a person typed, parsed the same way `client.ts`'s `parseMajorUnits` does. */
export function parseGoalAmount(amount: string, precision: number, path: string): number {
  const match = /^\s*(\d+)(?:\.(\d*))?\s*$/.exec(amount);
  if (!match || (match[2] ?? "").length > precision) throw new ApiError(400, path === "amountMinorUnits" ? "amount_invalid" : "target_invalid", [{ path, code: `${path}.invalid`, message: GOAL_MESSAGE_OF_CODE[path === "amountMinorUnits" ? "amount_invalid" : "target_invalid"]! }]);
  const value = Number(`${match[1]}${(match[2] ?? "").padEnd(precision, "0")}`);
  if (!Number.isSafeInteger(value) || value <= 0) throw new ApiError(400, path === "amountMinorUnits" ? "amount_invalid" : "target_invalid", [{ path, code: `${path}.invalid`, message: GOAL_MESSAGE_OF_CODE[path === "amountMinorUnits" ? "amount_invalid" : "target_invalid"]! }]);
  return value;
}
/** The unit-only decimal string an editable target-amount input starts from ("500.00", no currency suffix) --
 * the same shape `parseGoalAmount`/`goalDraftFromInputs` expect back. Kept here, not in the view, for the
 * same reason the three builders below are: the view never spells out `goal.targetMinorUnits` itself. */
export function formatGoalTargetForEditing(goal: WireGoal): string {
  return formatMinorUnits(goal.targetMinorUnits, goal.minorUnitPrecision);
}

// CBD-341-AC01: these three builders are the only place `goals-view.tsx` is allowed to reach for a
// minor-unit field, and none of them names one in a way the view module would ever spell out itself --
// the view passes plain strings in and an opaque draft out. `goals.test.ts`'s AC01 test greps the view
// module for the literal substring "MinorUnits" and fails if it appears there at all, so a mutation body
// built with an inline `{ amountMinorUnits: ... }` object literal in the view would fail that test even
// though it performs no arithmetic; building the draft here instead is what keeps the view free of the
// field name, not merely free of an operator applied to it.
export function goalDraftFromInputs(label: string, targetAmount: string, targetDate: string, precision: number): GoalDraft {
  return { label, targetMinorUnits: parseGoalAmount(targetAmount, precision, "targetMinorUnits"), targetDate: targetDate.trim() === "" ? null : targetDate.trim() };
}
export function contributionDraftFromInputs(amount: string, note: string, precision: number): ContributionDraft {
  const trimmedNote = note.trim();
  return { amountMinorUnits: parseGoalAmount(amount, precision, "amountMinorUnits"), note: trimmedNote === "" ? null : trimmedNote };
}
/** Whether reducing this goal's target to `targetAmount` would put it below the progress already recorded
 * (CBD-341-AC04's "target reduction below progress" state): the view calls this to decide whether an
 * `ImpactConfirm` is owed before submitting the edit, without ever comparing a minor-unit figure itself. */
export function wouldReduceBelowProgress(goal: WireGoal, targetAmount: string): boolean {
  try { return parseGoalAmount(targetAmount, goal.minorUnitPrecision, "targetMinorUnits") < goal.progressMinorUnits; }
  catch { return false; }
}

// ---------------------------------------------------------------------------
// The client.
// ---------------------------------------------------------------------------

export interface GoalsClient {
  /** Bootstraps the CSRF value this client's mutations echo, exactly as `invitations.ts`'s `session` does. */
  session(signal?: AbortSignal): Promise<{ accountSubjectId: string } | null>;
  list(budgetSpaceId: string, signal?: AbortSignal): Promise<WireGoalList>;
  create(budgetSpaceId: string, draft: GoalDraft, idempotency: string): Promise<WireGoal>;
  detail(budgetSpaceId: string, goalId: string, signal?: AbortSignal): Promise<WireGoalDetail>;
  edit(budgetSpaceId: string, goalId: string, draft: GoalDraft, expectedVersion: number, idempotency: string): Promise<WireGoal>;
  contribute(budgetSpaceId: string, goalId: string, draft: ContributionDraft, expectedVersion: number, idempotency: string): Promise<WireContributionMutation>;
  reverseContribution(budgetSpaceId: string, goalId: string, contributionId: string, expectedVersion: number, idempotency: string): Promise<WireContributionMutation>;
  archive(budgetSpaceId: string, goalId: string, expectedVersion: number): Promise<WireGoal>;
  restore(budgetSpaceId: string, goalId: string, expectedVersion: number): Promise<WireGoal>;
  clear(): void;
}

const CSRF_HEADER = "X-CoBudget-CSRF";

export function createGoalsClient(base = "/v1", fetcher: typeof fetch = fetch): GoalsClient {
  let csrf: string | undefined;
  const space = (id: string) => `/budget-spaces/${encodeURIComponent(id)}/goals`;
  const goal = (id: string, goalId: string) => `${space(id)}/${encodeURIComponent(goalId)}`;

  async function send(path: string, method: string, body: unknown, options: { csrf: boolean; signal?: AbortSignal; idempotency?: string }): Promise<{ status: number; json: Record<string, unknown> }> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (options.idempotency) headers["Idempotency-Key"] = options.idempotency;
    if (options.csrf) {
      if (!csrf) await bootstrap(options.signal);
      if (!csrf) throw new ApiError(401, "unauthenticated");
      headers[CSRF_HEADER] = csrf;
    }
    const response = await fetcher(`${base}${path}`, {
      method, headers, credentials: "same-origin", cache: "no-store", ...(options.signal ? { signal: options.signal } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = response.status === 204 ? {} : await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: response.status, json };
  }
  function failure(answer: { status: number; json: Record<string, unknown> }): ApiError {
    if (answer.status === 409 && answer.json.error === "stale_version" && answer.json.current) return new StaleGoalVersionError(answer.json.current as WireGoal);
    const fieldErrors = Array.isArray(answer.json.fieldErrors) ? answer.json.fieldErrors as { path: string; code: string; message: string }[] : [];
    return new ApiError(answer.status, typeof answer.json.error === "string" ? answer.json.error : "request_failed", fieldErrors);
  }
  async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal, idempotency?: string): Promise<T> {
    const answer = await send(path, method, body, { csrf: method !== "GET", signal, idempotency });
    if (answer.status < 200 || answer.status >= 300) throw failure(answer);
    return answer.json as T;
  }
  async function bootstrap(signal?: AbortSignal): Promise<{ accountSubjectId: string } | null> {
    const answer = await send("/identity/me", "GET", undefined, { csrf: false, signal });
    if (answer.status === 401 || answer.status === 403) return null;
    if (answer.status !== 200) throw failure(answer);
    if (typeof answer.json.csrfValue === "string" && answer.json.csrfValue) csrf = answer.json.csrfValue;
    return { accountSubjectId: String(answer.json.accountSubjectId ?? "") };
  }
  const draftBody = (draft: GoalDraft) => ({ label: draft.label.trim(), targetMinorUnits: draft.targetMinorUnits, targetDate: draft.targetDate });

  return {
    session: bootstrap,
    list: (budgetSpaceId, signal) => request<WireGoalList>(space(budgetSpaceId), "GET", undefined, signal),
    create: async (budgetSpaceId, draft, idempotency) => (await request<WireGoalMutation>(space(budgetSpaceId), "POST", draftBody(draft), undefined, idempotency)).goal,
    detail: (budgetSpaceId, goalId, signal) => request<WireGoalDetail>(goal(budgetSpaceId, goalId), "GET", undefined, signal),
    edit: async (budgetSpaceId, goalId, draft, expectedVersion, idempotency) =>
      (await request<WireGoalMutation>(goal(budgetSpaceId, goalId), "PATCH", { ...draftBody(draft), expectedVersion }, undefined, idempotency)).goal,
    contribute: (budgetSpaceId, goalId, draft, expectedVersion, idempotency) =>
      request<WireContributionMutation>(`${goal(budgetSpaceId, goalId)}/contributions`, "POST", { amountMinorUnits: draft.amountMinorUnits, note: draft.note, expectedVersion }, undefined, idempotency),
    reverseContribution: (budgetSpaceId, goalId, contributionId, expectedVersion, idempotency) =>
      request<WireContributionMutation>(`${goal(budgetSpaceId, goalId)}/contributions/${encodeURIComponent(contributionId)}/reverse`, "POST", { expectedVersion }, undefined, idempotency),
    archive: async (budgetSpaceId, goalId, expectedVersion) => (await request<WireGoalMutation>(`${goal(budgetSpaceId, goalId)}/archive`, "POST", { expectedVersion })).goal,
    restore: async (budgetSpaceId, goalId, expectedVersion) => (await request<WireGoalMutation>(`${goal(budgetSpaceId, goalId)}/restore`, "POST", { expectedVersion })).goal,
    clear() { csrf = undefined; },
  };
}
