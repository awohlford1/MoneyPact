/** DEVELOPMENT ONLY. Imported by the mock route, never by browser components.
 * All calculations run on the Next server using the existing domain engine.
 * Volatile synthetic data demonstrates reloads, not durable API persistence.
 */
import { randomUUID, createHash } from "node:crypto";
import { buildPaycheckSchedule, customBoundaries, describeCadence, parseCadenceDefinition, periodLengthInDays, setupPreview, weeklyMonthlyBoundaries } from "@cobudget/budget-domain/schedule";
import type { CadenceDefinition } from "@cobudget/budget-domain/schedule";
import { addDays, toISODate } from "@cobudget/budget-domain/shared";
import { fullPeriodTargets } from "@cobudget/budget-domain/targets";
import { ApiError } from "./client.ts";
import type { ApiClient, BudgetDetail, FieldError, Plan, Session } from "./client.ts";
import type { Confirmation, Draft, Proposal } from "./proposals.ts";

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
export function createServerMock(now = Date.now): ApiClient {
  let session: Session | null = { accountSubjectId: randomUUID(), sessionRef: randomUUID(), sessionVersion: 1, csrf: randomUUID() };
  const proposals = new Map<string, { proposal: Proposal; status: "previewed" | "invalidated" | "confirmed" }>();
  const creations = new Map<string, { command: string; proposal: Proposal }>();
  const confirmations = new Map<string, { id: string; response: Confirmation }>();
  const budgets = new Map<string, { detail: BudgetDetail; plan: Plan; schedule: CadenceDefinition }>();
  function authorize(signal?: AbortSignal) { signal?.throwIfAborted(); if (!session) throw new ApiError(401, "unauthenticated"); }
  function budget(id: string) { const value = budgets.get(id); if (!value) throw new ApiError(404, "budget_not_found"); return value; }
  const api: ApiClient = {
    async begin() { return "/budgets"; },
    async me(signal) { signal?.throwIfAborted(); return session; },
    async logout() { session = null; proposals.clear(); },
    clear() {},
    async createProposal(draft: Draft, idempotency, supersedes, signal) {
      authorize(signal);
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
        const read = await api.readProposal(replay.proposal.proposalId);
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
    async readProposal(id, signal) {
      authorize(signal);
      const stored = proposals.get(id);
      if (!stored) throw new ApiError(404, "proposal_not_found");
      const status = stored.status === "previewed" && now() >= Date.parse(stored.proposal.expiresAt) ? "expired" : stored.status;
      return { proposal: structuredClone(stored.proposal), lifecycle: { status, reason: status === "previewed" ? null : status, regenerateRequired: status === "expired" || status === "invalidated" } };
    },
    async confirmProposal(id, binding, idempotency) {
      authorize();
      const replay = confirmations.get(idempotency);
      if (replay) { if (replay.id !== id) throw new ApiError(409, "idempotency_key_reused"); return structuredClone(replay.response); }
      const read = await api.readProposal(id);
      if (read.lifecycle.status !== "previewed" || read.proposal.confirmationBinding !== binding) throw new ApiError(409, "proposal_not_current");
      const raced = confirmations.get(idempotency);
      if (raced) { if (raced.id !== id) throw new ApiError(409, "idempotency_key_reused"); return structuredClone(raced.response); }
      if (proposals.get(id)?.status !== "previewed") throw new ApiError(409, "proposal_not_current");
      const proposal = read.proposal;
      const budgetSpaceId = randomUUID(); const periodId = randomUUID(); const scheduleId = randomUUID();
      const response: Confirmation = { confirmationOutcomeId: randomUUID(), budgetSpaceId, primaryOwnerMembershipId: randomUUID(), initialScheduleVersionId: scheduleId, currentScheduleVersionId: scheduleId, currentPeriodId: periodId, nameVersion: 1, lifecycle: "live", lifecycleVersion: 1, scheduleVersion: 1, authorization: { policyVersion: "mock", policyDigest: "mock", inputSchemaVersion: 1, authorizationVersion: 1 }, committedAt: new Date(now()).toISOString(), onboardingContinuationId: randomUUID() };
      budgets.set(budgetSpaceId, { detail: { id: budgetSpaceId, ...proposal.normalizedInputs, activePeriod: { id: periodId, ...proposal.preview.periods[0], scheduleVersionId: scheduleId }, freshness: "current", completeness: "complete", updatedAt: response.committedAt }, schedule: proposal.normalizedInputs.schedule, plan: { budgetSpaceId, periodId, currencyCode: proposal.normalizedInputs.currencyCode, categories: [], targets: [] } });
      proposals.get(id)!.status = "confirmed";
      confirmations.set(idempotency, { id, response });
      return structuredClone(response);
    },
    async listBudgets(signal) { authorize(signal); return [...budgets.values()].map(value => structuredClone(value.detail)); },
    async budget(id, signal) { authorize(signal); return structuredClone(budget(id).detail); },
    async plan(id, periodId, signal) { authorize(signal); const value = budget(id); if (value.plan.periodId !== periodId) throw new ApiError(409, "period_changed"); return structuredClone(value.plan); },
    async addCategory(id, name) {
      authorize(); const value = budget(id);
      if (typeof name !== "string" || !name.trim()) throw new ApiError(400, "validation_failed", [{ path: "name", code: "name.required", message: "Enter a category name." }]);
      const category = { id: randomUUID(), name: name.trim() }; value.plan.categories = [...value.plan.categories, category]; return category;
    },
    async saveTarget(id, categoryId, amount, version) {
      authorize(); const value = budget(id);
      if (!value.plan.categories.some(category => category.id === categoryId)) throw new ApiError(404, "category_not_found");
      const old = value.plan.targets.find(target => target.categoryId === categoryId);
      if ((old?.version ?? 0) !== version) throw new ApiError(409, "target_changed");
      if (typeof amount !== "string" || !/^\d+(\.\d{1,2})?$/.test(amount) || !Number.isSafeInteger(Math.round(Number(amount) * 100))) throw new ApiError(400, "validation_failed", [{ path: "baseAmount", code: "amount.invalid", message: "Enter a zero-or-positive amount with up to two decimal places." }]);
      const targets = [...value.plan.targets.filter(target => target.categoryId !== categoryId), { categoryId, baseAmount: Number(amount).toFixed(2), periodAmount: "", version: version + 1 }];
      const period = value.detail.activePeriod!;
      const computed = fullPeriodTargets({ cadence: value.schedule.cadence, currency: "USD", targets: targets.map(target => ({ categoryId: target.categoryId, amountMinorUnits: Math.round(Number(target.baseAmount) * 100) })) }, value.schedule.cadence, { start: toISODate(period.start), end: toISODate(period.end) });
      value.plan.targets = targets.map(target => ({ ...target, periodAmount: (computed.find(result => result.categoryId === target.categoryId)!.amountMinorUnits / 100).toFixed(2) }));
    },
  };
  return api;
}
