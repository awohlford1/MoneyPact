/** DEVELOPMENT ONLY (CBD-341, model CBD-338, ledger CBD-339, commands CBD-340; UI-BUILD-PLAN.md section 4.5).
 * Registered in the mock route module registry (`mock-registry.ts`); imported by `mock-server.ts` only, never
 * by browser components.
 *
 * State lives under `directory.extras.get("goals")` (CBD-35's own key, added by UI-P01): a `Map` from budget
 * space id to that space's goals and their ledgers, so no field is added to `MockDirectory` or to `mock-server.ts`
 * itself beyond the one registry line in `mock-registry.ts`.
 *
 * Every figure this module answers is computed here, once, from the stored minor-unit fields -- exactly the
 * "the mock returns it" half of section 6.3.1's rule ("where a total is needed and the API does not return
 * one, the mock returns it -- that is what the stub is for"). `remainingMinorUnits`/`excessMinorUnits` are
 * `max(target - progress, 0)`/`max(progress - target, 0)`; the *view* and the *client* module never repeat
 * that arithmetic, they only format and label the server's own answer (CBD-341-AC01).
 *
 * Mutations honour `Idempotency-Key` (a repeated key with a differing request is `409 idempotency_mismatch`,
 * a repeated key with the same request replays the stored result, exactly as `mock-server.ts`'s own
 * `transactionIdempotent` does for manual transactions) and a `expectedVersion` precondition (a stale one is
 * `409 stale_version` with the goal's current version in the body, never a silent overwrite).
 */
import { randomUUID, createHash } from "node:crypto";
import { ApiError } from "./client.ts";
import type { MockDirectory } from "./mock-invitations.ts";
import { activeMembership } from "./mock-invitations.ts";
import type { MockRouteModule } from "./mock-registry.ts";
import type { GoalState, WireGoal, WireGoalDetail, WireGoalList, WireGoalMutation, WireLedgerEntry } from "./goals.ts";

// The subset of `mock-server.ts`'s private `MockSpace` shape this module reads, structurally -- `mock-server.ts`
// exports no such type, and this packet does not edit that file beyond the registry line (the same convention
// `mock-reports.ts` already established).
interface GoalSpace { detail: { space: { budgetSpaceId: string; currencyCode: string } } }

interface MockGoal {
  goalId: string; label: string; targetMinorUnits: number; progressMinorUnits: number;
  targetDate: string | null; archivedAt: string | null; version: number;
}
interface MockContribution {
  contributionId: string; goalId: string; amountMinorUnits: number; recordedAt: string;
  actorSubjectId: string; reversedAt: string | null; note: string | null;
}
interface GoalsSpaceState {
  goals: Map<string, MockGoal>;
  ledger: Map<string, MockContribution[]>;
  /** One idempotency table per space, keyed on the caller's `Idempotency-Key` alone, the same convention
   * `mock-server.ts`'s `transactionReplays` uses for manual transactions. */
  replays: Map<string, { action: string; digest: string; response: unknown }>;
}
const GOALS_EXTRA_KEY = "goals";
const MINOR_UNIT_PRECISION = 2;

function stateFor(directory: MockDirectory): Map<string, GoalsSpaceState> {
  let table = directory.extras.get(GOALS_EXTRA_KEY) as Map<string, GoalsSpaceState> | undefined;
  if (!table) { table = new Map(); directory.extras.set(GOALS_EXTRA_KEY, table); }
  return table;
}
function spaceStateFor(directory: MockDirectory, budgetSpaceId: string): GoalsSpaceState {
  const table = stateFor(directory);
  let state = table.get(budgetSpaceId);
  if (!state) { state = { goals: new Map(), ledger: new Map(), replays: new Map() }; table.set(budgetSpaceId, state); }
  return state;
}
function authorizedSpace(directory: MockDirectory, accountSubjectId: string, budgetSpaceId: string): GoalSpace {
  const value = (directory.spaces as Map<string, GoalSpace>).get(budgetSpaceId);
  if (!value || !activeMembership(directory, budgetSpaceId, accountSubjectId)) throw new ApiError(403, "authorization_denied");
  return value;
}
function digestOf(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("base64url"); }
/** Same replay convention as `mock-server.ts`'s `transactionIdempotent`: no key tracks nothing, a repeated key
 * with the same request replays the stored answer, a repeated key with a different request is refused. */
function idempotent<T>(state: GoalsSpaceState, action: string, idempotency: string, requestFor: unknown, compute: () => T): T {
  if (!idempotency) return compute();
  const digest = digestOf(requestFor);
  const stored = state.replays.get(idempotency);
  if (stored) {
    if (stored.action !== action || stored.digest !== digest) throw new ApiError(409, "idempotency_mismatch");
    return structuredClone(stored.response) as T;
  }
  const response = compute();
  state.replays.set(idempotency, { action, digest, response: structuredClone(response) });
  return response;
}

function goalStateOf(goal: MockGoal): GoalState {
  if (goal.archivedAt !== null) return "archived";
  return goal.progressMinorUnits >= goal.targetMinorUnits ? "completed" : "active";
}
function toWireGoal(goal: MockGoal, space: GoalSpace, now: number): WireGoal {
  const remainingMinorUnits = Math.max(goal.targetMinorUnits - goal.progressMinorUnits, 0);
  const excessMinorUnits = Math.max(goal.progressMinorUnits - goal.targetMinorUnits, 0);
  return {
    goalId: goal.goalId, label: goal.label, version: goal.version,
    targetMinorUnits: goal.targetMinorUnits, progressMinorUnits: goal.progressMinorUnits,
    remainingMinorUnits, excessMinorUnits, state: goalStateOf(goal), targetDate: goal.targetDate,
    currencyCode: space.detail.space.currencyCode, minorUnitPrecision: MINOR_UNIT_PRECISION,
    dataAsOf: new Date(now).toISOString(), archivedAt: goal.archivedAt,
  };
}
function toWireLedgerEntry(entry: MockContribution): WireLedgerEntry {
  return { contributionId: entry.contributionId, amountMinorUnits: entry.amountMinorUnits, recordedAt: entry.recordedAt, actorSubjectId: entry.actorSubjectId, reversedAt: entry.reversedAt, note: entry.note };
}
function liveGoal(state: GoalsSpaceState, goalId: string): MockGoal {
  const goal = state.goals.get(goalId);
  if (!goal) throw new ApiError(404, "goal_not_found");
  return goal;
}
const noStore = { "Cache-Control": "no-store" };
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...noStore, "content-type": "application/json" } });
}
/** `409 { error: "stale_version", current }`, matching the shape `client.ts`/`goals.ts` both expect. */
class StaleVersion extends ApiError {
  readonly currentGoal: WireGoal;
  constructor(currentGoal: WireGoal) { super(409, "stale_version"); this.currentGoal = currentGoal; }
}

function requireLabel(fields: Record<string, unknown>): string {
  const label = typeof fields.label === "string" ? fields.label.trim() : "";
  if (label.length < 1 || label.length > 120) throw new ApiError(400, "label_invalid", [{ path: "label", code: "label.invalid", message: "Enter a name between 1 and 120 characters." }]);
  return label;
}
function requireTarget(fields: Record<string, unknown>): number {
  const target = fields.targetMinorUnits;
  if (typeof target !== "number" || !Number.isSafeInteger(target) || target <= 0) throw new ApiError(400, "target_invalid", [{ path: "targetMinorUnits", code: "target.invalid", message: "Enter a target greater than zero." }]);
  return target;
}
function normalizeTargetDate(fields: Record<string, unknown>): string | null {
  const value = fields.targetDate;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, "target_date_invalid", [{ path: "targetDate", code: "target-date.invalid", message: "Enter a real date as YYYY-MM-DD, or leave it blank." }]);
  }
  return value;
}
function requireAmount(fields: Record<string, unknown>): number {
  const amount = fields.amountMinorUnits;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) throw new ApiError(400, "amount_invalid", [{ path: "amountMinorUnits", code: "amount.invalid", message: "Enter a contribution amount greater than zero." }]);
  return amount;
}
function normalizeNote(fields: Record<string, unknown>): string | null {
  const note = fields.note;
  if (note === undefined || note === null || note === "") return null;
  if (typeof note !== "string" || note.length > 200) throw new ApiError(400, "note_invalid", [{ path: "note", code: "note.invalid", message: "Use 200 characters or fewer." }]);
  return note;
}

function handleList(state: GoalsSpaceState, space: GoalSpace, now: number): WireGoalList {
  const goals = [...state.goals.values()].sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()) || a.goalId.localeCompare(b.goalId));
  return { budgetSpaceId: space.detail.space.budgetSpaceId, currencyCode: space.detail.space.currencyCode, minorUnitPrecision: MINOR_UNIT_PRECISION, goals: goals.map(goal => toWireGoal(goal, space, now)) };
}
function handleCreate(state: GoalsSpaceState, space: GoalSpace, fields: Record<string, unknown>, idempotency: string, now: number): WireGoalMutation {
  return idempotent(state, "create", idempotency, fields, () => {
    const label = requireLabel(fields);
    const targetMinorUnits = requireTarget(fields);
    const targetDate = normalizeTargetDate(fields);
    const goal: MockGoal = { goalId: `goal_${randomUUID().replaceAll("-", "")}`, label, targetMinorUnits, progressMinorUnits: 0, targetDate, archivedAt: null, version: 1 };
    state.goals.set(goal.goalId, goal);
    state.ledger.set(goal.goalId, []);
    return { previousVersion: null, goal: toWireGoal(goal, space, now) };
  });
}
function handleDetail(state: GoalsSpaceState, space: GoalSpace, goalId: string, now: number): WireGoalDetail {
  const goal = liveGoal(state, goalId);
  const ledger = (state.ledger.get(goalId) ?? []).slice().sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.contributionId.localeCompare(a.contributionId));
  return { budgetSpaceId: space.detail.space.budgetSpaceId, goal: toWireGoal(goal, space, now), ledger: ledger.map(toWireLedgerEntry) };
}
function precondition(goal: MockGoal, space: GoalSpace, now: number, fields: Record<string, unknown>): void {
  const expected = fields.expectedVersion;
  if (expected !== undefined && expected !== goal.version) throw new StaleVersion(toWireGoal(goal, space, now));
}
function handleEdit(state: GoalsSpaceState, space: GoalSpace, goalId: string, fields: Record<string, unknown>, idempotency: string, now: number): WireGoalMutation {
  return idempotent(state, `edit:${goalId}`, idempotency, fields, () => {
    const goal = liveGoal(state, goalId);
    if (goal.archivedAt !== null) throw new ApiError(409, "goal_archived", [{ path: "goalId", code: "goal.archived", message: "This goal is archived. Restore it first, or choose another." }]);
    precondition(goal, space, now, fields);
    const previousVersion = goal.version;
    goal.label = requireLabel(fields);
    goal.targetMinorUnits = requireTarget(fields);
    goal.targetDate = normalizeTargetDate(fields);
    goal.version += 1;
    return { previousVersion, goal: toWireGoal(goal, space, now) };
  });
}
function handleContribute(state: GoalsSpaceState, space: GoalSpace, goalId: string, fields: Record<string, unknown>, actorSubjectId: string, idempotency: string, now: number) {
  return idempotent(state, `contribute:${goalId}`, idempotency, fields, () => {
    const goal = liveGoal(state, goalId);
    if (goal.archivedAt !== null) throw new ApiError(409, "goal_archived", [{ path: "goalId", code: "goal.archived", message: "This goal is archived. Restore it first, or choose another." }]);
    precondition(goal, space, now, fields);
    const amountMinorUnits = requireAmount(fields);
    const note = normalizeNote(fields);
    goal.progressMinorUnits += amountMinorUnits;
    goal.version += 1;
    const entry: MockContribution = { contributionId: `ctb_${randomUUID().replaceAll("-", "")}`, goalId, amountMinorUnits, recordedAt: new Date(now).toISOString(), actorSubjectId, reversedAt: null, note };
    (state.ledger.get(goalId) ?? state.ledger.set(goalId, []).get(goalId)!).push(entry);
    return { goal: toWireGoal(goal, space, now), entry: toWireLedgerEntry(entry) };
  });
}
function handleReverse(state: GoalsSpaceState, space: GoalSpace, goalId: string, contributionId: string, fields: Record<string, unknown>, idempotency: string, now: number) {
  return idempotent(state, `reverse:${goalId}:${contributionId}`, idempotency, fields, () => {
    const goal = liveGoal(state, goalId);
    precondition(goal, space, now, fields);
    const ledger = state.ledger.get(goalId) ?? [];
    const entry = ledger.find(row => row.contributionId === contributionId);
    if (!entry) throw new ApiError(404, "contribution_not_found", [{ path: "contributionId", code: "contribution.not-found", message: "This contribution is no longer here." }]);
    if (entry.reversedAt !== null) throw new ApiError(409, "contribution_already_reversed", [{ path: "contributionId", code: "contribution.reversed", message: "This contribution was already reversed." }]);
    entry.reversedAt = new Date(now).toISOString();
    goal.progressMinorUnits -= entry.amountMinorUnits;
    goal.version += 1;
    return { goal: toWireGoal(goal, space, now), entry: toWireLedgerEntry(entry) };
  });
}
function handleArchive(state: GoalsSpaceState, space: GoalSpace, goalId: string, fields: Record<string, unknown>, now: number): WireGoalMutation {
  const goal = liveGoal(state, goalId);
  if (goal.archivedAt !== null) throw new ApiError(409, "goal_archived", [{ path: "goalId", code: "goal.archived", message: "This goal is already archived." }]);
  precondition(goal, space, now, fields);
  const previousVersion = goal.version;
  goal.archivedAt = new Date(now).toISOString();
  goal.version += 1;
  return { previousVersion, goal: toWireGoal(goal, space, now) };
}
function handleRestore(state: GoalsSpaceState, space: GoalSpace, goalId: string, fields: Record<string, unknown>, now: number): WireGoalMutation {
  const goal = liveGoal(state, goalId);
  if (goal.archivedAt === null) throw new ApiError(409, "goal_not_archived", [{ path: "goalId", code: "goal.not-archived", message: "This goal is not archived." }]);
  precondition(goal, space, now, fields);
  const previousVersion = goal.version;
  goal.archivedAt = null;
  goal.version += 1;
  return { previousVersion, goal: toWireGoal(goal, space, now) };
}

/** CBD-35: one path prefix, `budget-spaces/{id}/goals[...]`; `undefined` for anything else so the loop falls through. */
export const handleMockGoalsRequest: MockRouteModule = async (directory, session, request, path, body, now) => {
  if (!(path[0] === "budget-spaces" && path[2] === "goals")) return undefined;
  if (!session) throw new ApiError(403, "authorization_denied");
  const idempotency = request.headers.get("Idempotency-Key") ?? "";
  try {
    const budgetSpaceId = path[1]!;
    const space = authorizedSpace(directory, session.accountSubjectId, budgetSpaceId);
    const state = spaceStateFor(directory, budgetSpaceId);
    const clock = now();
    if (path.length === 3 && request.method === "GET") return json(handleList(state, space, clock));
    if (path.length === 3 && request.method === "POST") return json(handleCreate(state, space, body, idempotency, clock), 201);
    if (path.length === 4 && request.method === "GET") return json(handleDetail(state, space, path[3]!, clock));
    if (path.length === 4 && request.method === "PATCH") return json(handleEdit(state, space, path[3]!, body, idempotency, clock));
    if (path.length === 5 && path[4] === "contributions" && request.method === "POST") return json(handleContribute(state, space, path[3]!, body, session.accountSubjectId, idempotency, clock), 201);
    if (path.length === 7 && path[4] === "contributions" && path[6] === "reverse" && request.method === "POST") return json(handleReverse(state, space, path[3]!, path[5]!, body, idempotency, clock), 201);
    if (path.length === 5 && path[4] === "archive" && request.method === "POST") return json(handleArchive(state, space, path[3]!, body, clock), 201);
    if (path.length === 5 && path[4] === "restore" && request.method === "POST") return json(handleRestore(state, space, path[3]!, body, clock), 201);
    return undefined;
  } catch (error) {
    if (error instanceof StaleVersion) return json({ error: "stale_version", current: error.currentGoal }, 409);
    if (error instanceof ApiError) return json({ error: error.code, ...(error.fieldErrors.length ? { fieldErrors: error.fieldErrors } : {}) }, error.status);
    return json({ error: "request_failed" }, 503);
  }
};
