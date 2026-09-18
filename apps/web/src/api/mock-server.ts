/** DEVELOPMENT ONLY. Imported by the mock route and the unit tests, never by browser components.
 * All calculations run on the Next server using the existing domain engine.
 * Volatile synthetic data demonstrates reloads, not durable API persistence.
 *
 * PROTO-ACTIVATION-001: the mock speaks the merged API's wire shapes (see client.ts `Wire*` and
 * API-ASSUMPTIONS.md), so the production `createHttpClient` runs unchanged against it: the same
 * CSRF bootstrap value on GET /identity/me, the same `X-CoBudget-CSRF` header on mutations, the
 * same budget-space, categories, targets and plan bodies. `handleMockRequest` is the HTTP mapping
 * shared by the Next route and the in-memory fetcher (`createMockClient`).
 */
import { randomUUID, createHash } from "node:crypto";
import { buildPaycheckSchedule, customBoundaries, describeCadence, parseCadenceDefinition, periodLengthInDays, setupPreview, weeklyMonthlyBoundaries } from "@cobudget/budget-domain/schedule";
import type { CadenceDefinition } from "@cobudget/budget-domain/schedule";
import { addDays, collapseWhitespace, hasControlOrFormatCharacter, toISODate } from "@cobudget/budget-domain/shared";
import { fullPeriodTargets } from "@cobudget/budget-domain/targets";
import { ApiError, createHttpClient } from "./client.ts";
import type { ApiClient, FieldError, WireAccountList, WireAccountMutation, WireCategoryDetail, WireCategoryList, WirePlan, WireProgress, WireSession, WireSpaceDetail, WireSpaceList, WireTargetSet, WireTransactionMutation } from "./client.ts";
import type { Confirmation, Disclosure, Draft, Proposal, ProposalRead } from "./proposals.ts";
// PK-8: the invitation, members, ceremony, Primary-transfer, step-up and notices routes live in their own module; the
// directory they share across sessions is also where every session's budget spaces and memberships now live.
import { activeMembership, createMockDirectory, mockAssurance, registerMockSpace, sharedMockDirectory } from "./mock-invitations.ts";
import type { MockDirectory } from "./mock-invitations.ts";
// CBD-35: the invitation, members, transfer, step-up and notices routes are the first entry in the mock route
// module registry; later packets register their own module here instead of hard-coding another delegation.
import { MOCK_ROUTE_MODULES } from "./mock-registry.ts";

// SEC-F06-OBS1 / REV-NS-3 / SEC-NS-R1: the mock emulates `name.control-characters` and the live
// budget-name whitespace collapse with the same shared Unicode name rules as
// `packages/budget-application/src/creation-proposals/normalize.ts` and
// `packages/data-access/src/financial-profile.ts` (`@cobudget/budget-domain/shared`), so a
// mock-backed journey can exercise the same rejection: no Cc/Cf except an emoji-sequence ZWJ or
// a between-letters ZWJ/ZWNJ, and the same `\p{White_Space}` collapse (not JS `\s`, which misses
// U+FEFF and other non-`\s` White_Space code points).

/** The mock's stand-in for config/consent-disclosure-registry.json; the live API serves the approved entry. */
const MOCK_DISCLOSURE: Disclosure = {
  kind: "primary_owner_self", version: 1, digest: "mock-consent-disclosure-digest",
  text: {
    heading: "Before you create this budget",
    items: [
      { id: "role", text: "You are creating a personal budget space and you become its sole Primary Owner." },
      { id: "authority", text: "Creating it gives no payment, financial, legal, or bank-account authority, and it moves no money." },
      { id: "privacy", text: "Nobody else can see this budget space." },
      { id: "exits", text: "You can transfer primary ownership or archive this budget space later." },
      { id: "action", text: "Confirming is your agreement to the items above." },
    ],
    acknowledgement: "I have read the items above and I agree to become Primary Owner of this budget space.",
  },
};

function localDate(now: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return toISODate(`${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}-${parts.find(part => part.type === "day")!.value}`);
}
function expiry(now: number, timeZone: string) {
  const date = localDate(now, timeZone);
  let low = now; let high = now + 30 * 60 * 1000;
  if (localDate(high, timeZone) !== date) {
    while (high - low > 1) { const midpoint = Math.floor((low + high) / 2); if (localDate(midpoint, timeZone) === date) low = midpoint; else high = midpoint; }
  }
  return new Date(high).toISOString();
}
interface MockCategory { categoryId: string; label: string; position: number; archivedAt: string | null }
/** PROTO-INCREMENT-B-001: the mock's manual accounts and manual expenses, in the API's own shapes. */
interface MockAccount { accountId: string; origin: string; accountType: string; label: string; currencyCode: string; minorUnitPrecision: number; openingBalanceMinorUnits: number; ownerSubjectId: string; archivedAt: string | null; version: number }
interface MockAllocation { categoryId: string; amountMinorUnits: number }
/** One retained version, exactly as `manual_transaction` stores it: an edit appends, a removal is a tombstone. */
interface MockVersion { transactionId: string; transactionVersionId: string; revision: number; accountId: string; amountMinorUnits: number; budgetDate: string; description: string | null; allocations: MockAllocation[]; removedAt: string | null; supersededAt: string | null }
/** CBD-200-F03: `409 {error: "stale_version", current: {transactionVersionId, revision}}` -- the shape the real API answers (apps/api/src/transactions/http.ts), carrying more than a bare code. */
export class StaleVersionError extends ApiError {
  readonly current: { transactionVersionId: string; revision: number };
  constructor(current: { transactionVersionId: string; revision: number }) { super(409, "stale_version"); this.current = current; }
}
interface MockSpace { detail: WireSpaceDetail; schedule: CadenceDefinition; categories: MockCategory[]; base: Map<string, number>; accounts: MockAccount[]; versions: MockVersion[] }

/** The wire-level mock of one signed-in browser session. */
export interface MockWire {
  /** PK-8: the state shared with every other mock session (spaces, memberships, invitations, transfers, notices). */
  readonly directory: MockDirectory;
  /** The signed-in subject, or null. */
  subject(): string | null;
  /** The clock this session's mock keeps time by. */
  now(): number;
  /** The bootstrap body; `csrfValue` is delivered on every bootstrap read of the live session, as the API does (RC-06 bounded retention). */
  me(): WireSession | null;
  /** The session's raw CSRF value for the route's header check. */
  csrf(): string | null;
  logout(): void;
  createProposal(body: Draft & { supersedesProposalId?: string }, idempotency: string): Proposal;
  readProposal(id: string): ProposalRead;
  confirmProposal(id: string, binding: string, idempotency: string, acknowledgedDisclosure: { kind: string; version: number }): Confirmation;
  listSpaces(): WireSpaceList;
  spaceDetail(id: string): WireSpaceDetail;
  plan(id: string, periodId: string): WirePlan;
  putCategories(id: string, body: unknown): WireCategoryList;
  putTargets(id: string, body: unknown): WireTargetSet;
  listAccounts(id: string): WireAccountList;
  createAccount(id: string, body: unknown): WireAccountMutation;
  editAccount(id: string, accountId: string, body: unknown): WireAccountMutation;
  archiveAccount(id: string, accountId: string): WireAccountMutation;
  restoreAccount(id: string, accountId: string): WireAccountMutation;
  /**
   * CBD-200-F03/CBD-266-F04: `idempotency`, when non-empty, replays a stored first result for a
   * repeated key (a differing request is `409 idempotency_mismatch`); a second in-flight write by
   * this same session while one of these three is still being processed is `429 {outcome: "retry",
   * reason: "in_flight"}` (`beginTransactionWrite`/`endTransactionWrite`, wrapped around the call by
   * `handleMockRequest`, which alone can create the scheduling window a single-threaded mock needs to
   * observe a genuine race).
   */
  createTransaction(id: string, body: unknown, idempotency: string): WireTransactionMutation;
  editTransaction(id: string, transactionId: string, body: unknown, idempotency: string): WireTransactionMutation;
  removeTransaction(id: string, transactionId: string, body: unknown, idempotency: string): WireTransactionMutation;
  /** Throws `429 in_flight` if another of these three writes from this session has not yet finished. */
  beginTransactionWrite(): void;
  endTransactionWrite(): void;
  progress(id: string, periodId: string): WireProgress;
  categoryDetail(id: string, periodId: string, categoryId: string): WireCategoryDetail;
}

export function createServerMock(now = Date.now, directory: MockDirectory<MockSpace> = sharedMockDirectory<MockSpace>()): MockWire {
  const csrfValue = randomUUID();
  let session: WireSession | null = { accountSubjectId: randomUUID(), profileId: randomUUID(), identityBindingId: randomUUID(), sessionRef: randomUUID(), sessionVersion: 1, environmentId: "development", assurance: "session" };
  const proposals = new Map<string, { proposal: Proposal; status: "previewed" | "invalidated" | "confirmed" }>();
  const creations = new Map<string, { command: string; proposal: Proposal }>();
  const confirmations = new Map<string, { id: string; response: Confirmation }>();
  // CBD-200-F03/CBD-266-F04: one idempotency table across the three manual-transaction writes,
  // keyed on the caller's Idempotency-Key alone (one mock session is one actor); a repeated key with
  // a differing action or request digest is refused, never silently replayed against a mismatch.
  const transactionReplays = new Map<string, { action: "create" | "edit" | "remove"; digest: string; response: WireTransactionMutation }>();
  let writingTransaction = false;
  const spaces = directory.spaces;
  function authorize() { if (!session) throw new ApiError(403, "authorization_denied"); }
  // PK-8: a space is readable by any of its active members, which the shared directory now records (the policy's membership fact live).
  function space(id: string) { const value = spaces.get(id); if (!value || !session || !activeMembership(directory, id, session.accountSubjectId)) throw new ApiError(403, "authorization_denied"); return value; }
  function readProposal(id: string): ProposalRead {
    const stored = proposals.get(id);
    if (!stored) throw new ApiError(403, "authorization_denied");
    const status = stored.status === "previewed" && now() >= Date.parse(stored.proposal.expiresAt) ? "expired" : stored.status;
    return { proposal: structuredClone(stored.proposal), lifecycle: { status, reason: status === "previewed" ? null : status, regenerateRequired: status === "expired" || status === "invalidated" } };
  }
  function planFor(value: MockSpace, periodId: string): WirePlan {
    const period = value.detail.activePeriod!;
    if (period.periodId !== periodId) throw new ApiError(404, "period_not_found");
    const live = value.categories.filter(category => category.archivedAt === null).sort((a, b) => a.position - b.position);
    const computed = live.length ? fullPeriodTargets({ cadence: value.schedule.cadence, currency: "USD", targets: live.map(category => ({ categoryId: category.categoryId, amountMinorUnits: value.base.get(category.categoryId) ?? 0 })) }, value.schedule.cadence, { start: toISODate(period.start), end: toISODate(period.end) }) : [];
    return {
      budgetSpaceId: value.detail.space.budgetSpaceId, period: { periodId, start: period.start, end: period.end, status: "active", completed: false },
      cadence: value.schedule.cadence, currencyCode: "USD", minorUnitPrecision: 2, formulaVersion: "budget-domain/targets/1",
      categories: live.map(category => ({ categoryId: category.categoryId, label: category.label, position: category.position,
        baseTarget: value.base.has(category.categoryId) ? { amountMinorUnits: value.base.get(category.categoryId)! } : null,
        periodTarget: { amountMinorUnits: computed.find(result => result.categoryId === category.categoryId)!.amountMinorUnits } })),
    };
  }
  const ACCOUNT_TYPES: readonly string[] = ["checking", "savings", "cash", "credit-card", "other"];
  function accountsOf(value: MockSpace): MockAccount[] {
    return [...value.accounts].sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()) || a.accountId.localeCompare(b.accountId));
  }
  function liveAccount(value: MockSpace, accountId: string): MockAccount {
    const account = value.accounts.find(entry => entry.accountId === accountId);
    if (!account) throw new ApiError(404, "account_not_found");
    return account;
  }
  function currentVersion(value: MockSpace, transactionId: string): MockVersion {
    const version = value.versions.find(entry => entry.transactionId === transactionId && entry.supersededAt === null);
    if (!version) throw new ApiError(404, "transaction_not_found");
    return version;
  }
  /** CBD-200-F03: the same one-shape precondition the real API takes in the body -- `expectedTransactionVersionId`, omitted meaning no basis stated. */
  function checkPrecondition(current: MockVersion, fields: Record<string, unknown>): void {
    const expected = fields.expectedTransactionVersionId;
    if (expected === undefined) return;
    if (expected !== current.transactionVersionId) throw new StaleVersionError({ transactionVersionId: current.transactionVersionId, revision: current.revision });
  }
  function digestOf(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("base64url"); }
  /** A non-empty Idempotency-Key replays a stored first result for the same action and request; a differing one is `409 idempotency_mismatch`, exactly as the real API refuses it. Empty (no key sent) tracks nothing. */
  function transactionIdempotent(action: "create" | "edit" | "remove", idempotency: string, requestFor: unknown, compute: () => WireTransactionMutation): WireTransactionMutation {
    if (!idempotency) return compute();
    const digest = digestOf(requestFor);
    const stored = transactionReplays.get(idempotency);
    if (stored) {
      if (stored.action !== action || stored.digest !== digest) throw new ApiError(409, "idempotency_mismatch");
      return structuredClone(stored.response);
    }
    const response = compute();
    transactionReplays.set(idempotency, { action, digest, response: structuredClone(response) });
    return response;
  }
  /** Current, non-removed versions assigned to one period: what the aggregate and the detail both count. */
  function settledVersions(value: MockSpace, periodId: string): MockVersion[] {
    const period = value.detail.activePeriod;
    if (!period || period.periodId !== periodId) return [];
    return value.versions.filter(version => version.supersededAt === null && version.removedAt === null && version.budgetDate >= period.start && version.budgetDate <= period.end);
  }
  function cellFor(value: MockSpace, periodId: string, categoryId: string, targetMinorUnits: number): WireProgress["cells"][number] {
    const settled = settledVersions(value, periodId)
      .flatMap(version => version.allocations.filter(allocation => allocation.categoryId === categoryId).map(allocation => ({ recordId: `${version.transactionId}:${categoryId}`, amountMinorUnits: allocation.amountMinorUnits })));
    const settledActualMinorUnits = settled.reduce((total, allocation) => total + allocation.amountMinorUnits, 0);
    // Signed, unclamped, exactly as budget-domain computes it: an overspent cell reports a negative
    // remaining. Every manual record is settled (CBD-107), so the pending impact is zero and remaining
    // after pending equals remaining after settled; the record identities behind each sum travel with
    // the cell so the web can tell "no activity" from "nets to zero" (CBD-211-AC04).
    const remainingAfterSettledMinorUnits = targetMinorUnits + settledActualMinorUnits;
    return {
      categoryId, targetMinorUnits, settledActualMinorUnits, pendingProvisionalImpactMinorUnits: 0,
      remainingAfterSettledMinorUnits, remainingAfterPendingMinorUnits: remainingAfterSettledMinorUnits,
      settledRecordIds: settled.map(record => record.recordId).sort(), pendingRecordIds: [],
    };
  }
  /** The manual-expense write rules, in the same order and with the same canonical codes the API uses. */
  function parseWrite(value: MockSpace, body: unknown): Omit<MockVersion, "transactionId" | "transactionVersionId" | "revision" | "removedAt" | "supersededAt"> {
    const fields = body as Record<string, unknown>;
    // `expectedTransactionVersionId` (CBD-200-F03) travels in the same body on an edit; it is not a write field.
    if (Object.keys(fields).some(field => !["accountId", "amountMinorUnits", "budgetDate", "description", "allocations", "expectedTransactionVersionId"].includes(field))) throw new ApiError(400, "invalid_request");
    const account = value.accounts.find(entry => entry.accountId === fields.accountId);
    if (!account) throw new ApiError(404, "account_not_found");
    if (account.archivedAt !== null) throw new ApiError(409, "account_archived");
    const amountMinorUnits = fields.amountMinorUnits;
    if (typeof amountMinorUnits !== "number" || !Number.isSafeInteger(amountMinorUnits)) throw new ApiError(400, "amount_not_integer");
    const budgetDate = fields.budgetDate;
    // A real calendar date, not merely the shape of one: 2026-02-30 matches the pattern and is still not a date.
    if (typeof budgetDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(budgetDate) || new Date(`${budgetDate}T00:00:00Z`).toISOString().slice(0, 10) !== budgetDate) throw new ApiError(400, "date_invalid");
    const period = value.detail.activePeriod;
    if (!period || budgetDate < period.start || budgetDate > period.end) throw new ApiError(404, "period_not_found");
    const description = fields.description === undefined || fields.description === null ? null : String(fields.description);
    if (description !== null && (description.length < 1 || description.length > 200)) throw new ApiError(400, "description_invalid");
    const items = fields.allocations;
    if (!Array.isArray(items)) throw new ApiError(400, "invalid_request");
    if (items.length === 0) throw new ApiError(400, "allocations_empty");
    const allocations: MockAllocation[] = [];
    for (const item of items) {
      const { categoryId, amountMinorUnits: allocated } = item as { categoryId?: unknown; amountMinorUnits?: unknown };
      if (typeof categoryId !== "string" || !value.categories.some(category => category.categoryId === categoryId && category.archivedAt === null)) throw new ApiError(400, "allocation_category_invalid");
      if (allocations.some(existing => existing.categoryId === categoryId)) throw new ApiError(400, "allocation_duplicate_category");
      if (typeof allocated !== "number" || !Number.isSafeInteger(allocated)) throw new ApiError(400, "amount_not_integer");
      allocations.push({ categoryId, amountMinorUnits: allocated });
    }
    if (allocations.reduce((total, allocation) => total + allocation.amountMinorUnits, 0) !== amountMinorUnits) throw new ApiError(400, "allocation_sum_mismatch");
    return { accountId: account.accountId, amountMinorUnits, budgetDate, description, allocations };
  }
  function snapshot(version: MockVersion): WireTransactionMutation["current"] {
    const { allocations, ...rest } = structuredClone(version);
    return { version: { ...rest, currencyCode: "USD", minorUnitPrecision: 2, origin: "manual", settlementState: "settled" }, allocations };
  }
  const mock: MockWire = {
    directory,
    subject() { return session?.accountSubjectId ?? null; },
    now,
    me() { return session ? { ...session, assurance: mockAssurance(directory, session.accountSubjectId, now()), csrfValue } : null; },
    csrf() { return session ? csrfValue : null; },
    logout() { session = null; proposals.clear(); },
    createProposal(body, idempotency) {
      authorize();
      const { supersedesProposalId: supersedes, ...draft } = body;
      const errors: FieldError[] = [];
      const name = typeof draft.name === "string" ? collapseWhitespace(draft.name) : "";
      if (!name) errors.push({ path: "name", code: "name.required", message: "Enter a budget name." });
      else if (hasControlOrFormatCharacter(name)) errors.push({ path: "name", code: "name.control-characters", message: "Remove control and invisible formatting characters." });
      if ([...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(name)].length > 100) errors.push({ path: "name", code: "name.too-long", message: "Use 100 characters or fewer." });
      let timeZone = typeof draft.timeZone === "string" ? draft.timeZone.trim() : "";
      try { if (!timeZone.includes("/")) throw new Error(); timeZone = new Intl.DateTimeFormat("en", { timeZone }).resolvedOptions().timeZone; }
      catch { errors.push({ path: "timeZone", code: "time-zone.invalid", message: "Choose a valid named IANA time zone." }); }
      const currencyCode = typeof draft.currencyCode === "string" ? draft.currencyCode.trim().toUpperCase() : "";
      if (currencyCode !== "USD") errors.push({ path: "currencyCode", code: "currency.context-mismatch", message: "Choose the currency used by this financial profile." });
      const parsed = parseCadenceDefinition(draft.schedule);
      if (!parsed.ok) errors.push(...parsed.issues.map(issue => ({ ...issue, path: issue.path ? `schedule.${issue.path}` : "schedule" })));
      if (errors.length || !parsed.ok) throw new ApiError(400, "validation_failed", errors);
      const schedule = parsed.value;
      const command = JSON.stringify({ name, timeZone, currencyCode, schedule, supersedes });
      const replay = creations.get(idempotency);
      if (replay) {
        if (replay.command !== command) throw new ApiError(409, "idempotency_key_reused");
        const read = readProposal(replay.proposal.proposalId);
        if (read.lifecycle.status !== "previewed") throw new ApiError(409, "idempotency_replay_unavailable");
        return structuredClone(read.proposal);
      }
      const predecessor = supersedes ? proposals.get(supersedes) : undefined;
      if (supersedes && !predecessor) throw new ApiError(404, "proposal_not_found");
      const issued = now();
      const date = localDate(issued, timeZone);
      const boundaries = schedule.cadence === "custom-fixed-length" ? customBoundaries(schedule) : schedule.cadence === "paycheck" ? buildPaycheckSchedule(schedule, { from: addDays(date, -100), through: addDays(date, 200) }).boundaries : weeklyMonthlyBoundaries(schedule);
      const periods = setupPreview(boundaries, date).map((period, ordinal) => ({ ...period, ordinal, relation: ordinal === 0 ? "current" as const : "following" as const, lengthInDays: periodLengthInDays(period) }));
      const proposal: Proposal = {
        proposalId: `bcp_${randomUUID().replaceAll("-", "")}`, proposalVersion: 1, issuedStatus: "previewed", draftRevision: (predecessor?.proposal.draftRevision ?? 0) + 1, supersedesProposalId: supersedes ?? null,
        normalizedInputs: { name, timeZone, currencyCode, schedule },
        governingVersions: { proposalContractVersion: "cbd-232/0.2", periodContractVersion: "cbd-26/@cobudget-budget-domain-0.1.0", calendarDataVersion: null, timeZoneDataVersion: "mock-runtime", currencyCatalogVersion: "mock-usd" },
        issuedAt: new Date(issued).toISOString(), expiresAt: expiry(issued, timeZone),
        preview: { budgetDate: date, timeZone, cadence: schedule.cadence, cadenceDefinition: schedule, cadenceSummary: describeCadence(schedule), periodCount: 4, periods, adjustments: [], warnings: [] },
        previewDigest: createHash("sha256").update(JSON.stringify(periods)).digest("base64url"), confirmationBinding: randomUUID(), bindingVersion: "bcp-hmac-sha256/v1", currentDisclosure: structuredClone(MOCK_DISCLOSURE),
      };
      if (predecessor) predecessor.status = "invalidated";
      proposals.set(proposal.proposalId, { proposal, status: "previewed" });
      creations.set(idempotency, { command, proposal });
      return structuredClone(proposal);
    },
    readProposal(id) { authorize(); return readProposal(id); },
    confirmProposal(id, binding, idempotency, acknowledgedDisclosure) {
      authorize();
      const replay = confirmations.get(idempotency);
      if (replay) { if (replay.id !== id) throw new ApiError(409, "idempotency_key_reused"); return structuredClone(replay.response); }
      // CBD-236: the acknowledged disclosure is compared with the registry's current entry, exactly as
      // the live API does, so a missing or superseded acknowledgement is denied and nothing is created.
      if (acknowledgedDisclosure?.kind !== MOCK_DISCLOSURE.kind || acknowledgedDisclosure.version !== MOCK_DISCLOSURE.version) throw new ApiError(409, "stale_disclosure");
      const read = readProposal(id);
      if (read.lifecycle.status !== "previewed" || read.proposal.confirmationBinding !== binding) throw new ApiError(409, "proposal_not_current");
      if (proposals.get(id)?.status !== "previewed") throw new ApiError(409, "proposal_not_current");
      const proposal = read.proposal;
      const budgetSpaceId = randomUUID(); const periodId = randomUUID(); const scheduleId = randomUUID();
      const response: Confirmation = { confirmationOutcomeId: randomUUID(), budgetSpaceId, primaryOwnerMembershipId: randomUUID(), initialScheduleVersionId: scheduleId, currentScheduleVersionId: scheduleId, currentPeriodId: periodId, nameVersion: 1, lifecycle: "live", lifecycleVersion: 1, scheduleVersion: 1, authorization: { policyVersion: "mock", policyDigest: "mock", inputSchemaVersion: 1, authorizationVersion: 1 }, committedAt: new Date(now()).toISOString(), onboardingContinuationId: randomUUID() };
      const [current, ...next] = proposal.preview.periods;
      spaces.set(budgetSpaceId, {
        detail: {
          space: { budgetSpaceId, name: proposal.normalizedInputs.name, nameVersion: 1, timeZone: proposal.normalizedInputs.timeZone, currencyCode: proposal.normalizedInputs.currencyCode, lifecycle: "live", lifecycleVersion: 1 },
          scheduleVersion: { scheduleVersionId: scheduleId, sequence: 1, cadenceDefinition: proposal.normalizedInputs.schedule },
          budgetDate: proposal.preview.budgetDate,
          activePeriod: { periodId, scheduleVersionId: scheduleId, status: "active", ...current },
          nextPeriods: next,
        },
        schedule: proposal.normalizedInputs.schedule, categories: [], base: new Map(), accounts: [], versions: [],
      });
      proposals.get(id)!.status = "confirmed";
      registerMockSpace(directory, budgetSpaceId, proposal.normalizedInputs.name, session!.accountSubjectId, response.primaryOwnerMembershipId, response.committedAt);
      confirmations.set(idempotency, { id, response });
      return structuredClone(response);
    },
    listAccounts(id) {
      authorize();
      return { budgetSpaceId: id, accounts: structuredClone(accountsOf(space(id))) };
    },
    createAccount(id, body) {
      authorize(); const value = space(id);
      const fields = body as Record<string, unknown>;
      const label = typeof fields.label === "string" ? fields.label.trim() : "";
      if (!label || [...label].length > 120) throw new ApiError(400, "label_invalid");
      if (typeof fields.accountType !== "string" || !ACCOUNT_TYPES.includes(fields.accountType)) throw new ApiError(400, "account_type_unsupported");
      if (fields.currencyCode !== "USD") throw new ApiError(400, "currency_unsupported");
      const opening = fields.openingBalanceMinorUnits ?? 0;
      if (typeof opening !== "number" || !Number.isSafeInteger(opening)) throw new ApiError(400, "amount_not_integer");
      if (value.accounts.some(account => account.archivedAt === null && account.label.toLowerCase() === label.toLowerCase())) throw new ApiError(409, "label_taken");
      const account: MockAccount = {
        accountId: randomUUID(), origin: "manual", accountType: fields.accountType, label, currencyCode: "USD", minorUnitPrecision: 2,
        openingBalanceMinorUnits: opening, ownerSubjectId: session?.accountSubjectId ?? randomUUID(), archivedAt: null, version: 1,
      };
      value.accounts.push(account);
      return { previousVersion: null, account: structuredClone(account) };
    },
    editAccount(id, accountId, body) {
      authorize(); const value = space(id);
      const account = liveAccount(value, accountId);
      // SEC-P3-F1, the same rule the API handler owns: an archived account refuses an edit.
      if (account.archivedAt !== null) throw new ApiError(409, "account_archived");
      const fields = body as Record<string, unknown>;
      if (Object.keys(fields).some(field => !["accountType", "label", "openingBalanceMinorUnits", "ownerSubjectId"].includes(field))) throw new ApiError(400, "invalid_request");
      if (fields.label !== undefined) {
        const label = typeof fields.label === "string" ? fields.label.trim() : "";
        if (!label || [...label].length > 120) throw new ApiError(400, "label_invalid");
        if (value.accounts.some(other => other !== account && other.archivedAt === null && other.label.toLowerCase() === label.toLowerCase())) throw new ApiError(409, "label_taken");
        account.label = label;
      }
      const previousVersion = account.version;
      account.version += 1;
      return { previousVersion, account: structuredClone(account) };
    },
    archiveAccount(id, accountId) {
      authorize(); const value = space(id);
      const account = liveAccount(value, accountId);
      if (account.archivedAt !== null) throw new ApiError(409, "account_archived");
      const previousVersion = account.version;
      account.archivedAt = new Date(now()).toISOString(); account.version += 1;
      return { previousVersion, account: structuredClone(account) };
    },
    restoreAccount(id, accountId) {
      authorize(); const value = space(id);
      const account = liveAccount(value, accountId);
      if (account.archivedAt === null) throw new ApiError(409, "account_not_archived");
      const previousVersion = account.version;
      account.archivedAt = null; account.version += 1;
      return { previousVersion, account: structuredClone(account) };
    },
    createTransaction(id, body, idempotency) {
      return transactionIdempotent("create", idempotency, { id, body }, () => {
        authorize(); const value = space(id);
        const write = parseWrite(value, body);
        const version: MockVersion = { transactionId: randomUUID(), transactionVersionId: randomUUID(), revision: 1, ...write, removedAt: null, supersededAt: null };
        value.versions.push(version);
        return { previous: null, current: snapshot(version) };
      });
    },
    editTransaction(id, transactionId, body, idempotency) {
      return transactionIdempotent("edit", idempotency, { id, transactionId, body }, () => {
        authorize(); const value = space(id);
        const previous = currentVersion(value, transactionId);
        if (previous.removedAt !== null) throw new ApiError(409, "transaction_removed");
        checkPrecondition(previous, body as Record<string, unknown>);
        const write = parseWrite(value, body);
        previous.supersededAt = new Date(now()).toISOString();
        const version: MockVersion = { transactionId, transactionVersionId: randomUUID(), revision: previous.revision + 1, ...write, removedAt: null, supersededAt: null };
        value.versions.push(version);
        return { previous: snapshot(previous), current: snapshot(version) };
      });
    },
    removeTransaction(id, transactionId, body, idempotency) {
      return transactionIdempotent("remove", idempotency, { id, transactionId, body }, () => {
        authorize(); const value = space(id);
        const previous = currentVersion(value, transactionId);
        if (previous.removedAt !== null) throw new ApiError(409, "transaction_removed");
        const fields = (body ?? {}) as Record<string, unknown>;
        if (Object.keys(fields).some(field => field !== "expectedTransactionVersionId")) throw new ApiError(400, "invalid_request");
        checkPrecondition(previous, fields);
        previous.supersededAt = new Date(now()).toISOString();
        const version: MockVersion = { ...structuredClone(previous), transactionVersionId: randomUUID(), revision: previous.revision + 1, allocations: [], removedAt: new Date(now()).toISOString(), supersededAt: null };
        value.versions.push(version);
        return { previous: snapshot(previous), current: snapshot(version) };
      });
    },
    beginTransactionWrite() {
      if (writingTransaction) throw new ApiError(429, "in_flight");
      writingTransaction = true;
    },
    endTransactionWrite() { writingTransaction = false; },
    progress(id, periodId) {
      authorize(); const value = space(id);
      const plan = planFor(value, periodId);
      return {
        budgetSpaceId: id, periodId, currencyCode: "USD", minorUnitPrecision: 2, calculationVersion: "budget-domain/progress/1",
        labels: Object.fromEntries(plan.categories.map(category => [category.categoryId, category.label])),
        cells: plan.categories.map(category => cellFor(value, periodId, category.categoryId, category.periodTarget.amountMinorUnits)),
      };
    },
    categoryDetail(id, periodId, categoryId) {
      authorize(); const value = space(id);
      const plan = planFor(value, periodId);
      const category = plan.categories.find(entry => entry.categoryId === categoryId);
      // A category this budget does not own is refused before anything is itemized, as the policy does live.
      if (!category) throw new ApiError(403, "authorization_denied");
      return {
        budgetSpaceId: id, periodId, categoryId, label: category.label, currencyCode: "USD", minorUnitPrecision: 2,
        cell: cellFor(value, periodId, categoryId, category.periodTarget.amountMinorUnits),
        items: settledVersions(value, periodId).flatMap(version => version.allocations.filter(allocation => allocation.categoryId === categoryId).map(allocation => ({
          transactionId: version.transactionId, accountId: version.accountId, budgetDate: version.budgetDate,
          description: version.description, amountMinorUnits: allocation.amountMinorUnits,
          // As the API counts it: the whole version's allocations, not this category's share (F-REVB-01).
          allocationCount: version.allocations.length,
        }))).sort((a, b) => a.budgetDate.localeCompare(b.budgetDate) || a.transactionId.localeCompare(b.transactionId)),
      };
    },
    listSpaces() {
      authorize();
      // PK-8 (membership.list_own): the spaces this subject holds an active membership in, with its own membership id.
      return { spaces: [...spaces.values()].flatMap(value => { const membership = activeMembership(directory, value.detail.space.budgetSpaceId, session!.accountSubjectId); return membership ? [{ budgetSpaceId: value.detail.space.budgetSpaceId, membershipId: membership.membershipId, name: value.detail.space.name, nameVersion: 1, lifecycle: "live", lifecycleVersion: 1, currencyCode: value.detail.space.currencyCode, timeZone: value.detail.space.timeZone }] : []; }) };
    },
    spaceDetail(id) { authorize(); return structuredClone(space(id).detail); },
    plan(id, periodId) { authorize(); return planFor(space(id), periodId); },
    putCategories(id, body) {
      authorize(); const value = space(id);
      const items = (body as { categories?: unknown[] })?.categories;
      if (!Array.isArray(items)) throw new ApiError(400, "invalid_request");
      for (const item of items) {
        const label = typeof (item as { label?: unknown }).label === "string" ? ((item as { label: string }).label).trim() : "";
        if (!label || label.length > 80) throw new ApiError(400, "label_invalid");
        const categoryId = (item as { categoryId?: string }).categoryId;
        const existing = categoryId ? value.categories.find(category => category.categoryId === categoryId) : undefined;
        if (categoryId && !existing) throw new ApiError(404, "category_not_found");
        if (value.categories.some(category => category !== existing && category.archivedAt === null && category.label.toLowerCase() === label.toLowerCase())) throw new ApiError(409, "label_taken");
        if (existing) existing.label = label; else value.categories.push({ categoryId: randomUUID(), label, position: value.categories.length, archivedAt: null });
      }
      return { budgetSpaceId: id, categories: structuredClone(value.categories) };
    },
    putTargets(id, body) {
      authorize(); const value = space(id);
      const items = (body as { targets?: unknown[] })?.targets;
      if (!Array.isArray(items)) throw new ApiError(400, "invalid_request");
      for (const item of items) {
        const { categoryId, amountMinorUnits } = item as { categoryId?: unknown; amountMinorUnits?: unknown };
        if (typeof categoryId !== "string" || !value.categories.some(category => category.categoryId === categoryId && category.archivedAt === null)) throw new ApiError(404, "category_not_found");
        if (typeof amountMinorUnits !== "number" || !Number.isSafeInteger(amountMinorUnits)) throw new ApiError(400, "amount_invalid");
        if (amountMinorUnits < 0) throw new ApiError(400, "amount_negative");
        value.base.set(categoryId, amountMinorUnits);
      }
      return { budgetSpaceId: id, cadence: value.schedule.cadence, currencyCode: "USD", minorUnitPrecision: 2, targets: [...value.base].map(([categoryId, amountMinorUnits]) => ({ categoryId, amountMinorUnits })) };
    },
  };
  return mock;
}

const noStore = { "Cache-Control": "no-store" };
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...noStore, "content-type": "application/json" } });
}
/** `429 {outcome: "retry", reason: "in_flight"}` with `Retry-After: 1`, the CBD-266 shape (EXEC-POV-C200F01-001 item 3) the request helper's own single retry expects. */
function inFlightResponse(): Response {
  return new Response(JSON.stringify({ outcome: "retry", reason: "in_flight" }), { status: 429, headers: { ...noStore, "content-type": "application/json", "Retry-After": "1" } });
}
/**
 * CBD-266-F04: wraps one of the three manual-transaction writes with the session's in-flight guard
 * and a deliberate scheduling window (`beginTransactionWrite` throws first, synchronously, for
 * anyone already holding it). A single-threaded mock never races two writes on its own; this is the
 * only place that can hand a second, genuinely concurrent request from the same browser session the
 * chance to observe the first one still in progress, so the browser suite can exercise the 429 path
 * the live API has. An idempotent replay (no real work) is unaffected in every test this packet adds,
 * but shares the same window if one is ever raced against a fresh write; that is a known prototype
 * simplification, not a claim the mock enforces the real API's precise ordering.
 */
async function withTransactionLock<T>(mock: MockWire, work: () => T): Promise<T> {
  mock.beginTransactionWrite();
  try { await new Promise<void>(resolve => setTimeout(resolve, 20)); return work(); }
  finally { mock.endTransactionWrite(); }
}
/** The HTTP mapping of one session's mock: the caller has already resolved the session cookie. Origin, fetch-metadata and CSRF checks mirror the API. */
export async function handleMockRequest(mock: MockWire, request: Request, path: string[]): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method !== "GET") {
      if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin") throw new ApiError(403, "authorization_denied");
      if (request.headers.get("x-cobudget-csrf") !== mock.csrf()) throw new ApiError(403, "csrf_rejected");
    }
    const body = request.method === "GET" ? {} : await request.json().catch(() => ({}));
    const idempotency = request.headers.get("Idempotency-Key") ?? "";
    const route = path.join("/");
    // CBD-35: MOCK_ROUTE_MODULES dispatches in order; a module returning undefined falls through to the next
    // and finally to the existing ladder below. PK-8's invitation, members, transfer, step-up, local-delivery
    // and notices routes are the first entry.
    const subject = mock.subject(); const csrf = mock.csrf();
    if (subject && csrf) {
      for (const routeModule of MOCK_ROUTE_MODULES) {
        const owned = await routeModule(mock.directory, { accountSubjectId: subject, csrf }, request, path, body, mock.now);
        if (owned) return owned;
      }
    }
    if (route === "identity/me" && request.method === "GET") { const session = mock.me(); if (!session) throw new ApiError(403, "authorization_denied"); return json(session); }
    if (route === "identity/logout" && request.method === "POST") { mock.logout(); return json({ signedOut: true }); }
    if (path[0] === "budget-creation-proposals") {
      if (request.method === "POST" && !/^[\x21-\x7e]{16,128}$/.test(idempotency)) throw new ApiError(400, "validation_failed");
      if (path.length === 1 && request.method === "POST") return json(mock.createProposal(body, idempotency), 201);
      if (path.length === 2 && request.method === "GET") return json(mock.readProposal(path[1]!));
      if (path.length === 3 && path[2] === "confirm" && request.method === "POST") {
        if (Object.keys(body).some(field => !["confirmationBinding", "acknowledgedDisclosure"].includes(field))) throw new ApiError(400, "invalid_request");
        return json(mock.confirmProposal(path[1]!, body.confirmationBinding, idempotency, body.acknowledgedDisclosure), 201);
      }
    } else if (path[0] === "budget-spaces") {
      if (path.length === 1 && request.method === "GET") return json(mock.listSpaces());
      if (path.length === 2 && request.method === "GET") return json(mock.spaceDetail(path[1]!));
      if (path.length === 3 && path[2] === "plan" && request.method === "GET") return json(mock.plan(path[1]!, url.searchParams.get("periodId") ?? ""));
      if (path.length === 3 && path[2] === "categories" && request.method === "PUT") return json(mock.putCategories(path[1]!, body));
      if (path.length === 3 && path[2] === "targets" && request.method === "PUT") return json(mock.putTargets(path[1]!, body));
      // PROTO-INCREMENT-B-001: accounts, manual expenses, progress and the CBD-211 drill-down.
      if (path.length === 3 && path[2] === "accounts" && request.method === "GET") return json(mock.listAccounts(path[1]!));
      if (path.length === 3 && path[2] === "accounts" && request.method === "POST") return json(mock.createAccount(path[1]!, body), 201);
      if (path.length === 4 && path[2] === "accounts" && request.method === "PATCH") return json(mock.editAccount(path[1]!, path[3]!, body));
      if (path.length === 5 && path[2] === "accounts" && path[4] === "archive" && request.method === "POST") return json(mock.archiveAccount(path[1]!, path[3]!), 201);
      if (path.length === 5 && path[2] === "accounts" && path[4] === "restore" && request.method === "POST") return json(mock.restoreAccount(path[1]!, path[3]!), 201);
      if (path.length === 3 && path[2] === "transactions" && request.method === "POST") return json(await withTransactionLock(mock, () => mock.createTransaction(path[1]!, body, idempotency)), 201);
      if (path.length === 4 && path[2] === "transactions" && request.method === "PATCH") return json(await withTransactionLock(mock, () => mock.editTransaction(path[1]!, path[3]!, body, idempotency)));
      if (path.length === 5 && path[2] === "transactions" && path[4] === "remove" && request.method === "POST") return json(await withTransactionLock(mock, () => mock.removeTransaction(path[1]!, path[3]!, body, idempotency)), 201);
      if (path.length === 5 && path[2] === "periods" && path[4] === "progress" && request.method === "GET") return json(mock.progress(path[1]!, path[3]!));
      if (path.length === 6 && path[2] === "periods" && path[4] === "progress" && request.method === "GET") return json(mock.categoryDetail(path[1]!, path[3]!, path[5]!));
    }
    throw new ApiError(404, "not_found");
  } catch (error) {
    if (error instanceof StaleVersionError) return json({ error: error.code, current: error.current }, error.status);
    if (error instanceof ApiError && error.status === 429 && error.code === "in_flight") return inFlightResponse();
    if (error instanceof ApiError) return json({ error: error.code, ...(error.fieldErrors.length ? { fieldErrors: error.fieldErrors } : {}) }, error.status);
    return json({ error: "request_failed" }, 503);
  }
}

/** The production HTTP client over an in-memory fetch to one mock session, as a browser on the same origin would issue it (unit tests). */
export function createMockClient(now = Date.now, origin = "http://localhost"): ApiClient & { readonly mock: MockWire } {
  // One directory per client: unit tests never share state through the process-wide one.
  const mock = createServerMock(now, createMockDirectory<MockSpace>());
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(input), origin);
    const headers = new Headers(init?.headers);
    headers.set("origin", origin); headers.set("sec-fetch-site", "same-origin");
    if (init?.signal) init.signal.throwIfAborted();
    const request = new Request(target, { method: init?.method ?? "GET", headers, ...(init?.body === undefined ? {} : { body: init.body }) });
    return handleMockRequest(mock, request, target.pathname.replace(/^\/v1\//, "").split("/"));
  }) as typeof fetch;
  return Object.assign(createHttpClient("/v1", fetcher), { mock });
}
