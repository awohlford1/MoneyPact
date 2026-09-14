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
import { addDays, toISODate } from "@cobudget/budget-domain/shared";
import { fullPeriodTargets } from "@cobudget/budget-domain/targets";
import { ApiError, createHttpClient } from "./client.ts";
import type { ApiClient, FieldError, WireCategoryList, WirePlan, WireSession, WireSpaceDetail, WireSpaceList, WireTargetSet } from "./client.ts";
import type { Confirmation, Draft, Proposal, ProposalRead } from "./proposals.ts";

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
interface MockSpace { detail: WireSpaceDetail; schedule: CadenceDefinition; categories: MockCategory[]; base: Map<string, number> }

/** The wire-level mock of one signed-in browser session. */
export interface MockWire {
  /** The bootstrap body; `csrfValue` is delivered on every bootstrap read of the live session, as the API does (RC-06 bounded retention). */
  me(): WireSession | null;
  /** The session's raw CSRF value for the route's header check. */
  csrf(): string | null;
  logout(): void;
  createProposal(body: Draft & { supersedesProposalId?: string }, idempotency: string): Proposal;
  readProposal(id: string): ProposalRead;
  confirmProposal(id: string, binding: string, idempotency: string): Confirmation;
  listSpaces(): WireSpaceList;
  spaceDetail(id: string): WireSpaceDetail;
  plan(id: string, periodId: string): WirePlan;
  putCategories(id: string, body: unknown): WireCategoryList;
  putTargets(id: string, body: unknown): WireTargetSet;
}

export function createServerMock(now = Date.now): MockWire {
  const csrfValue = randomUUID();
  let session: WireSession | null = { accountSubjectId: randomUUID(), profileId: randomUUID(), identityBindingId: randomUUID(), sessionRef: randomUUID(), sessionVersion: 1, environmentId: "development", assurance: "session" };
  const proposals = new Map<string, { proposal: Proposal; status: "previewed" | "invalidated" | "confirmed" }>();
  const creations = new Map<string, { command: string; proposal: Proposal }>();
  const confirmations = new Map<string, { id: string; response: Confirmation }>();
  const spaces = new Map<string, MockSpace>();
  function authorize() { if (!session) throw new ApiError(403, "authorization_denied"); }
  function space(id: string) { const value = spaces.get(id); if (!value) throw new ApiError(403, "authorization_denied"); return value; }
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
  const mock: MockWire = {
    me() { return session ? { ...session, csrfValue } : null; },
    csrf() { return session ? csrfValue : null; },
    logout() { session = null; proposals.clear(); },
    createProposal(body, idempotency) {
      authorize();
      const { supersedesProposalId: supersedes, ...draft } = body;
      const errors: FieldError[] = [];
      const name = typeof draft.name === "string" ? draft.name.normalize("NFC").trim().replace(/\s+/gu, " ") : "";
      if (!name) errors.push({ path: "name", code: "name.required", message: "Enter a budget name." });
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
        previewDigest: createHash("sha256").update(JSON.stringify(periods)).digest("base64url"), confirmationBinding: randomUUID(), bindingVersion: "bcp-hmac-sha256/v1",
      };
      if (predecessor) predecessor.status = "invalidated";
      proposals.set(proposal.proposalId, { proposal, status: "previewed" });
      creations.set(idempotency, { command, proposal });
      return structuredClone(proposal);
    },
    readProposal(id) { authorize(); return readProposal(id); },
    confirmProposal(id, binding, idempotency) {
      authorize();
      const replay = confirmations.get(idempotency);
      if (replay) { if (replay.id !== id) throw new ApiError(409, "idempotency_key_reused"); return structuredClone(replay.response); }
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
        schedule: proposal.normalizedInputs.schedule, categories: [], base: new Map(),
      });
      proposals.get(id)!.status = "confirmed";
      confirmations.set(idempotency, { id, response });
      return structuredClone(response);
    },
    listSpaces() {
      authorize();
      return { spaces: [...spaces.values()].map(value => ({ budgetSpaceId: value.detail.space.budgetSpaceId, membershipId: randomUUID(), name: value.detail.space.name, nameVersion: 1, lifecycle: "live", lifecycleVersion: 1, currencyCode: value.detail.space.currencyCode, timeZone: value.detail.space.timeZone })) };
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
    if (route === "identity/me" && request.method === "GET") { const session = mock.me(); if (!session) throw new ApiError(403, "authorization_denied"); return json(session); }
    if (route === "identity/logout" && request.method === "POST") { mock.logout(); return json({ signedOut: true }); }
    if (path[0] === "budget-creation-proposals") {
      if (request.method === "POST" && !/^[\x21-\x7e]{16,128}$/.test(idempotency)) throw new ApiError(400, "validation_failed");
      if (path.length === 1 && request.method === "POST") return json(mock.createProposal(body, idempotency), 201);
      if (path.length === 2 && request.method === "GET") return json(mock.readProposal(path[1]!));
      if (path.length === 3 && path[2] === "confirm" && request.method === "POST") {
        if (Object.keys(body).some(field => field !== "confirmationBinding")) throw new ApiError(400, "invalid_request");
        return json(mock.confirmProposal(path[1]!, body.confirmationBinding, idempotency), 201);
      }
    } else if (path[0] === "budget-spaces") {
      if (path.length === 1 && request.method === "GET") return json(mock.listSpaces());
      if (path.length === 2 && request.method === "GET") return json(mock.spaceDetail(path[1]!));
      if (path.length === 3 && path[2] === "plan" && request.method === "GET") return json(mock.plan(path[1]!, url.searchParams.get("periodId") ?? ""));
      if (path.length === 3 && path[2] === "categories" && request.method === "PUT") return json(mock.putCategories(path[1]!, body));
      if (path.length === 3 && path[2] === "targets" && request.method === "PUT") return json(mock.putTargets(path[1]!, body));
    }
    throw new ApiError(404, "not_found");
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.code, ...(error.fieldErrors.length ? { fieldErrors: error.fieldErrors } : {}) }, error.status);
    return json({ error: "request_failed" }, 503);
  }
}

/** The production HTTP client over an in-memory fetch to one mock session, as a browser on the same origin would issue it (unit tests). */
export function createMockClient(now = Date.now, origin = "http://localhost"): ApiClient & { readonly mock: MockWire } {
  const mock = createServerMock(now);
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
