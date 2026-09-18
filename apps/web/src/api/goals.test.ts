/**
 * UI-P05 (CBD-341 AC01-AC05) unit tests: the view module names no raw minor-unit field and applies no
 * arithmetic to one (AC01), the create/edit/contribute/reverse/archive/restore lifecycle over the mock
 * honours `Idempotency-Key` and the `expectedVersion` precondition exactly as the transactions mock's own
 * pattern does, and the mock's own progress/remaining/excess figures reconcile against a genuinely non-zero
 * contribution -- never a fixture that would let the reconciliation degenerate into comparing two zeros.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ApiError, formatMinorUnits } from "./client.ts";
import { createMockClient, handleMockRequest } from "./mock-server.ts";
import type { MockWire } from "./mock-server.ts";
import {
  CONTRIBUTION_INTENT_SENTENCE, StaleGoalVersionError, contributionDraftFromInputs, createGoalsClient,
  fieldErrorForGoal, goalDraftFromInputs, reportGoalError, toGoalRow, toLedgerRow, wouldReduceBelowProgress,
} from "./goals.ts";
import type { WireGoal, WireGoalDetail, WireGoalList } from "./goals.ts";

// --- CBD-341-AC01: the view module names no raw minor-unit field and applies no arithmetic to one -------------

test("CBD-341-AC01: the goals view module names no raw minor-unit field", () => {
  const path = fileURLToPath(new URL("../app/(app)/budgets/[id]/goals/goals-view.tsx", import.meta.url));
  const source = readFileSync(path, "utf8");
  // The strongest guarantee: the view never even names a field of that shape, so there is nothing for any
  // operator to apply to. Every figure it renders is a pre-formatted string this module (`goals.ts`) built.
  assert.equal(/MinorUnits/u.test(source), false, "the view module must never reference a raw minor-unit field");
  // A second, narrower layer for the one specific field-name shape the wire uses, in case a differently
  // spelled money field were ever smuggled in under an unrelated name (REV-UIP04-5's own reasoning).
  const codeLines = source.split("\n").filter(line => !/^\s*(?:\/\/|\*|\/\*\*)/u.test(line));
  for (const line of codeLines) {
    if (!/\bamount\b/iu.test(line)) continue;
    assert.doesNotMatch(line, /[+\-*/]\s*[A-Za-z_][\w.]*amount|amount[A-Za-z_]*\s*[+\-*/]/iu, `possible arithmetic near a money-shaped identifier: ${line}`);
  }
});

test("CBD-341-AC02: the standing contribution-intent sentence is exact, and the goals view renders it verbatim", () => {
  assert.equal(CONTRIBUTION_INTENT_SENTENCE, "Recording a contribution records your intent. MoneyPact moves no money.");
  const path = fileURLToPath(new URL("../app/(app)/budgets/[id]/goals/goals-view.tsx", import.meta.url));
  const source = readFileSync(path, "utf8");
  // REV-UIP05-6: proves the *render site*, not merely that the identifier appears somewhere (which the
  // import line alone would already satisfy, and would still pass if the JSX text were paraphrased instead
  // of interpolating the constant).
  assert.ok(source.includes(">{CONTRIBUTION_INTENT_SENTENCE}<"), "the view interpolates the exported constant directly at its render site, never a paraphrase of it");
  assert.ok(source.includes('>Record a contribution<'), "the contribution control reads exactly \"Record a contribution\"");
  // Each pattern below is a *positive* funding claim -- "from your income", etc. -- never merely the word
  // "income"/"balance"/"cash" in prose, and never the word "automatically" alone: this view's own copy uses
  // it to *deny* automatic funding ("nothing here draws automatically from income..."), which is exactly
  // what CBD-341-AC02 asks for, not a violation of it.
  for (const forbidden of [/\bfrom (?:your|my) income\b/iu, /\bfrom (?:your|my) balance\b/iu, /\bfrom available cash\b/iu, /\bdraws? (?:on|from) your account\b/iu]) {
    assert.doesNotMatch(source, forbidden, `CBD-341-AC02: no suggestion that income, balance or cash funds a goal (${forbidden})`);
  }
});

// --- Presentation: labelled figures, never a bare number ------------------------------------------------------

test("CBD-341-AC01: a goal's row states target/progress/remaining or excess as separately labelled values, and a progress statement in words", () => {
  const active: WireGoal = { goalId: "g1", label: "Emergency fund", version: 3, targetMinorUnits: 50000, progressMinorUnits: 14200, remainingMinorUnits: 35800, excessMinorUnits: 0, state: "active", targetDate: null, currencyCode: "USD", minorUnitPrecision: 2, dataAsOf: "2026-09-15T12:00:00.000Z", archivedAt: null };
  const row = toGoalRow(active);
  assert.equal(row.target, `${formatMinorUnits(50000, 2)} USD`);
  assert.equal(row.progress, `${formatMinorUnits(14200, 2)} USD`);
  assert.equal(row.remaining, `${formatMinorUnits(35800, 2)} USD`);
  assert.equal(row.excess, null);
  assert.equal(row.statement, "142.00 of 500.00 USD saved; 358.00 USD remaining", "section 4.5's exact wording shape");

  const excess: WireGoal = { ...active, progressMinorUnits: 60000, remainingMinorUnits: 0, excessMinorUnits: 10000, state: "completed" };
  const excessRow = toGoalRow(excess);
  assert.equal(excessRow.remaining, null);
  assert.equal(excessRow.excess, `${formatMinorUnits(10000, 2)} USD`);
  assert.match(excessRow.statement, /exceeded by 100\.00 USD/u);
  assert.equal(excessRow.stateLabel, "Completed");

  const completedExactly: WireGoal = { ...active, progressMinorUnits: 50000, remainingMinorUnits: 0, excessMinorUnits: 0, state: "completed" };
  assert.match(toGoalRow(completedExactly).statement, /target reached/u);

  const archived: WireGoal = { ...active, archivedAt: "2026-09-16T00:00:00.000Z", state: "archived" };
  assert.equal(toGoalRow(archived).stateLabel, "Archived");
});

test("a stale-version refusal is reported as a conflict, carrying the current goal, never a validation error", () => {
  const current: WireGoal = { goalId: "g1", label: "Trip", version: 4, targetMinorUnits: 10000, progressMinorUnits: 2000, remainingMinorUnits: 8000, excessMinorUnits: 0, state: "active", targetDate: null, currencyCode: "USD", minorUnitPrecision: 2, dataAsOf: "2026-09-15T12:00:00.000Z", archivedAt: null };
  const error = new StaleGoalVersionError(current);
  assert.equal(error.status, 409);
  assert.equal(error.code, "stale_version");
  const report = reportGoalError(error);
  assert.equal(report.kind, "conflict");
  assert.equal(report.current, current);
  assert.equal(fieldErrorForGoal(error).path, "goalId");
});

test("a 401 is reported distinctly from a 403: the session ended (revoked) versus the uniform denial (denied)", () => {
  assert.equal(reportGoalError(new ApiError(401, "unauthenticated")).kind, "revoked");
  const deniedA = reportGoalError(new ApiError(403, "authorization_denied"));
  const deniedB = reportGoalError(new ApiError(403, "goal_not_found"));
  assert.equal(deniedA.kind, "denied");
  // CBD-341-AC05: the denial sentence is the same uniform one regardless of the server's own reason, so it
  // never tells an unauthorized caller whether the goal exists or is merely out of their reach.
  assert.equal(deniedA.summary, deniedB.summary);
  assert.equal(deniedA.summary, "Your current session cannot do this here.");
});

test("wouldReduceBelowProgress is true only when the typed target would fall under the recorded progress", () => {
  const goal: WireGoal = { goalId: "g1", label: "Trip", version: 1, targetMinorUnits: 50000, progressMinorUnits: 20000, remainingMinorUnits: 30000, excessMinorUnits: 0, state: "active", targetDate: null, currencyCode: "USD", minorUnitPrecision: 2, dataAsOf: "x", archivedAt: null };
  // Progress recorded so far is 200.00; a new target under that is the case an ImpactConfirm is owed for.
  assert.equal(wouldReduceBelowProgress(goal, "100.00"), true);
  assert.equal(wouldReduceBelowProgress(goal, "199.99"), true);
  assert.equal(wouldReduceBelowProgress(goal, "200.00"), false, "exactly equal to progress is not a reduction below it");
  assert.equal(wouldReduceBelowProgress(goal, "300.00"), false);
  assert.equal(wouldReduceBelowProgress(goal, "not a number"), false, "an unparsable input is not this check's business; the ordinary field-error path reports it");
});

// --- Over the mock: the full lifecycle, idempotency, preconditions, and a non-degenerate reconciliation --------

function csrfFetcher(mock: MockWire, origin = "http://localhost"): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(input), origin);
    const headers = new Headers(init?.headers);
    headers.set("origin", origin); headers.set("sec-fetch-site", "same-origin");
    const request = new Request(target, { method: init?.method ?? "GET", headers, ...(init?.body === undefined ? {} : { body: init.body }) });
    return handleMockRequest(mock, request, target.pathname.replace(/^\/v1\//, "").split("/"));
  }) as typeof fetch;
}

async function setUpBudget(clock: () => number) {
  const client = createMockClient(clock);
  await client.me();
  const proposal = await client.createProposal(
    { name: "Household", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } },
    "proposal-key-0000000001",
  );
  const confirmed = await client.confirmProposal(proposal.proposalId, proposal.confirmationBinding, "confirm-key-0000000001", { kind: "primary_owner_self", version: 1 });
  return { mock: client.mock, budgetSpaceId: confirmed.budgetSpaceId };
}

test("CBD-341: create, edit, contribute, reverse, archive and restore over the mock, honouring Idempotency-Key and expectedVersion", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z");
  const { mock, budgetSpaceId } = await setUpBudget(clock);
  const goals = createGoalsClient("/v1", csrfFetcher(mock));

  const listBefore: WireGoalList = await goals.list(budgetSpaceId);
  assert.deepEqual(listBefore.goals, []);

  const created = await goals.create(budgetSpaceId, goalDraftFromInputs("Emergency fund", "500.00", "", 2), "goal-create-0000000001");
  assert.equal(created.label, "Emergency fund");
  assert.equal(created.progressMinorUnits, 0);
  assert.equal(created.version, 1);
  assert.equal(created.state, "active");

  // Idempotent replay: the same key with the same request returns the same goal, not a second one.
  const replay = await goals.create(budgetSpaceId, goalDraftFromInputs("Emergency fund", "500.00", "", 2), "goal-create-0000000001");
  assert.deepEqual(replay, created);
  assert.equal((await goals.list(budgetSpaceId)).goals.length, 1, "a repeated Idempotency-Key never creates a second goal");
  // The same key with a different request is refused, never silently replayed against a mismatch.
  await assert.rejects(() => goals.create(budgetSpaceId, goalDraftFromInputs("Different goal", "1.00", "", 2), "goal-create-0000000001"), (error: unknown) => error instanceof ApiError && error.code === "idempotency_mismatch");

  const edited = await goals.edit(budgetSpaceId, created.goalId, goalDraftFromInputs("Emergency fund (6 months)", "500.00", "", 2), created.version, "goal-edit-0000000001");
  assert.equal(edited.label, "Emergency fund (6 months)");
  assert.equal(edited.version, created.version + 1);

  // A stale expectedVersion is refused 409 with the current goal in the body; nothing was written.
  await assert.rejects(
    () => goals.edit(budgetSpaceId, created.goalId, goalDraftFromInputs("Should not land", "500.00", "", 2), created.version, "goal-edit-0000000002"),
    (error: unknown) => error instanceof StaleGoalVersionError && error.current.label === "Emergency fund (6 months)",
  );
  assert.equal((await goals.detail(budgetSpaceId, created.goalId)).goal.label, "Emergency fund (6 months)", "the stale write did not land");

  // REV-UIP04-6-shaped guard: contribute a genuinely non-zero amount before reconciling against it, so the
  // reconciliation below cannot degenerate into comparing two zeros.
  const contribution = await goals.contribute(budgetSpaceId, created.goalId, contributionDraftFromInputs("142.00", "First deposit", 2), edited.version, "goal-contribute-0000000001");
  assert.notEqual(contribution.goal.progressMinorUnits, 0, "the fixture's contribution must actually register");
  assert.equal(contribution.goal.progressMinorUnits, 14200);
  assert.equal(contribution.goal.remainingMinorUnits, 35800, "server-computed remaining, never client-recomputed");
  assert.equal(contribution.goal.excessMinorUnits, 0);
  assert.equal(contribution.entry.amountMinorUnits, 14200);
  assert.equal(contribution.entry.reversedAt, null);

  // A contribution that carries the goal past its target: excess is its own labelled figure, never folded
  // into "remaining" as a negative, and the state moves to completed.
  const excessContribution = await goals.contribute(budgetSpaceId, created.goalId, contributionDraftFromInputs("400.00", "", 2), contribution.goal.version, "goal-contribute-0000000002");
  assert.equal(excessContribution.goal.progressMinorUnits, 54200);
  assert.equal(excessContribution.goal.remainingMinorUnits, 0);
  assert.equal(excessContribution.goal.excessMinorUnits, 4200);
  assert.equal(excessContribution.goal.state, "completed");

  // Reversing the second contribution brings the goal back under target with an exact, server-stated figure.
  const reversed = await goals.reverseContribution(budgetSpaceId, created.goalId, excessContribution.entry.contributionId, excessContribution.goal.version, "goal-reverse-0000000001");
  assert.equal(reversed.goal.progressMinorUnits, 14200);
  assert.equal(reversed.goal.state, "active");
  assert.notEqual(reversed.entry.reversedAt, null);
  // Reversing the same contribution again is refused; it is not deleted, only marked.
  await assert.rejects(() => goals.reverseContribution(budgetSpaceId, created.goalId, excessContribution.entry.contributionId, reversed.goal.version, "goal-reverse-0000000002"), (error: unknown) => error instanceof ApiError && error.code === "contribution_already_reversed");

  const detail: WireGoalDetail = await goals.detail(budgetSpaceId, created.goalId);
  assert.equal(detail.ledger.length, 2, "the reversed entry stays in the ledger, marked, never removed");
  const ledgerRows = detail.ledger.map(entry => toLedgerRow(entry, detail.goal));
  assert.ok(ledgerRows.some(row => row.reversed === true));
  assert.ok(ledgerRows.some(row => row.reversed === false));

  const archived = await goals.archive(budgetSpaceId, created.goalId, detail.goal.version);
  assert.equal(archived.state, "archived");
  assert.notEqual(archived.archivedAt, null);
  await assert.rejects(() => goals.contribute(budgetSpaceId, created.goalId, contributionDraftFromInputs("1.00", "", 2), archived.version, "goal-contribute-0000000003"), (error: unknown) => error instanceof ApiError && error.code === "goal_archived", "an archived goal refuses a new contribution");
  // REV-UIP05-3: reversal is refused too, consistently with edit and contribute -- the still-unreversed
  // first contribution is used, so this is a genuine reversal attempt, not one already refused for another reason.
  await assert.rejects(() => goals.reverseContribution(budgetSpaceId, created.goalId, contribution.entry.contributionId, archived.version, "goal-reverse-0000000003"), (error: unknown) => error instanceof ApiError && error.code === "goal_archived", "an archived goal refuses a reversal too");

  const restored = await goals.restore(budgetSpaceId, created.goalId, archived.version);
  assert.equal(restored.state, "active");
  assert.equal(restored.archivedAt, null);
});

test("CBD-341-AC05: an unrecognised goal id is refused 404, and a subject with no membership is refused 403 -- both uniform, neither distinguishing the other", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z");
  const { mock, budgetSpaceId } = await setUpBudget(clock);
  const goals = createGoalsClient("/v1", csrfFetcher(mock));
  await assert.rejects(() => goals.detail(budgetSpaceId, "not-a-real-goal"), (error: unknown) => error instanceof ApiError && error.status === 404);

  const outsider = createMockClient(clock);
  const outsiderGoals = createGoalsClient("/v1", csrfFetcher(outsider.mock));
  await assert.rejects(() => outsiderGoals.list(budgetSpaceId), (error: unknown) => error instanceof ApiError && error.status === 403);
});

test("REV-UIP05-5: an edit that fails validation partway through leaves the stored goal completely untouched", async () => {
  const clock = () => Date.parse("2026-09-15T12:00:00Z");
  const { mock, budgetSpaceId } = await setUpBudget(clock);
  const goals = createGoalsClient("/v1", csrfFetcher(mock));
  const created = await goals.create(budgetSpaceId, goalDraftFromInputs("Original label", "500.00", "", 2), "goal-create-0000000010");

  // `goalDraftFromInputs` refuses a bad target client-side before any request is sent, so the mock's own
  // partial-apply bug (label assigned before target validation ran) needs a request built directly, the
  // same way `invitations.test.ts`'s raw `fetch` calls exercise a route below the client's own guard rails.
  const fetcher = csrfFetcher(mock);
  const response = await fetcher(`/v1/budget-spaces/${budgetSpaceId}/goals/${created.goalId}`, {
    method: "PATCH", headers: { "content-type": "application/json", "X-CoBudget-CSRF": mock.csrf()! },
    body: JSON.stringify({ label: "Label that must not stick", targetMinorUnits: -5, targetDate: null, expectedVersion: created.version }),
  });
  assert.equal(response.status, 400, "the negative target is refused");

  const after = await goals.detail(budgetSpaceId, created.goalId);
  assert.equal(after.goal.label, "Original label", "the label from the same rejected request must not have been assigned either");
  assert.equal(after.goal.version, created.version, "no version bump for a write that did not land");
});
