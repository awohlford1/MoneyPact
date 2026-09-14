import type { ProposalApi } from "./proposals";
/** Transport boundary. The wire shapes below are the merged API routes (PROTO-ACTIVATION-001); see API-ASSUMPTIONS.md. */
export interface Session {
  accountSubjectId: string;
  sessionRef: string;
  sessionVersion: number;
}
export interface FieldError { code: string; path: string; message: string }
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: readonly FieldError[];
  constructor(status: number, code: string, fieldErrors: readonly FieldError[] = []) {
    super(code);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}
export interface Period {
  id: string;
  start: string;
  end: string;
  lengthInDays: number;
  scheduleVersionId: string;
}
export interface BudgetSummary { id: string; name: string; currencyCode: string; timeZone: string }
export interface BudgetDetail extends BudgetSummary {
  activePeriod: Period | null;
  freshness: "current" | "stale";
  completeness: "complete" | "partial";
  updatedAt: string;
}
export interface Category { id: string; name: string }
export interface Target {
  categoryId: string;
  /** Decimal major-unit strings formatted from the API's minor units and precision; never computed client-side. */
  baseAmount: string;
  periodAmount: string;
}
export interface Plan {
  budgetSpaceId: string;
  periodId: string;
  currencyCode: string;
  minorUnitPrecision: number;
  categories: readonly Category[];
  targets: readonly Target[];
}
export interface ApiClient extends ProposalApi {
  begin(): Promise<string>;
  me(signal?: AbortSignal): Promise<Session | null>;
  logout(): Promise<void>;
  listBudgets(signal?: AbortSignal): Promise<readonly BudgetSummary[]>;
  budget(id: string, signal?: AbortSignal): Promise<BudgetDetail>;
  plan(id: string, periodId: string, signal?: AbortSignal): Promise<Plan>;
  addCategory(id: string, name: string): Promise<Category>;
  saveTarget(id: string, categoryId: string, amount: string, precision: number): Promise<void>;
  clear(): void;
}

// --- Wire shapes of the merged API routes ------------------------------------------------------------

/** GET /v1/identity/me (CBD-191 section 5.1 bootstrap): `csrfValue` is the session-bound raw value, returned on every bootstrap read of a live session and held only in memory. */
export interface WireSession { accountSubjectId: string; profileId: string; identityBindingId: string; sessionRef: string; sessionVersion: number; environmentId: string; assurance: "session" | "fresh"; csrfValue?: string }
/** GET /v1/budget-spaces (membership.list_own). */
export interface WireSpaceList { spaces: readonly { budgetSpaceId: string; membershipId: string; name: string; nameVersion: number; lifecycle: string; lifecycleVersion: number; currencyCode: string; timeZone: string }[] }
/** GET /v1/budget-spaces/{id} (1.view_space): the active period is the stored budget_space_period row. */
export interface WireSpaceDetail {
  space: { budgetSpaceId: string; name: string; nameVersion: number; timeZone: string; currencyCode: string; lifecycle: string; lifecycleVersion: number };
  scheduleVersion: { scheduleVersionId: string; sequence: number; cadenceDefinition: unknown };
  budgetDate: string;
  activePeriod: { periodId: string; scheduleVersionId: string; status: string; ordinal: number; relation: string; start: string; end: string; lengthInDays: number } | null;
  nextPeriods: readonly unknown[];
}
/** GET /v1/budget-spaces/{id}/plan?periodId= (CBD-153). */
export interface WirePlan {
  budgetSpaceId: string;
  period: { periodId: string; start: string; end: string; status: string; completed: boolean };
  cadence: string; currencyCode: string; minorUnitPrecision: number; formulaVersion: string;
  categories: readonly { categoryId: string; label: string; position: number; baseTarget: { amountMinorUnits: number } | null; periodTarget: { amountMinorUnits: number } }[];
}
/** PUT /v1/budget-spaces/{id}/categories (4.edit_category): upsert of the listed categories. */
export interface WireCategoryList { budgetSpaceId: string; categories: readonly { categoryId: string; label: string; position: number; archivedAt: string | null }[] }
/** PUT /v1/budget-spaces/{id}/targets (2a.edit_target): base targets for the listed categories. */
export interface WireTargetSet { budgetSpaceId: string; cadence: string; currencyCode: string; minorUnitPrecision: number; targets: readonly { categoryId: string; amountMinorUnits: number }[] }

/** Minor units to a decimal string in major units: presentation only, exact for safe integers. */
export function formatMinorUnits(amountMinorUnits: number, precision: number): string {
  if (!Number.isSafeInteger(amountMinorUnits) || !Number.isSafeInteger(precision) || precision < 0 || precision > 6) throw new ApiError(502, "amount_unrepresentable");
  const negative = amountMinorUnits < 0;
  const digits = String(Math.abs(amountMinorUnits)).padStart(precision + 1, "0");
  const whole = digits.slice(0, digits.length - precision);
  const fraction = digits.slice(digits.length - precision);
  return `${negative ? "-" : ""}${whole}${precision ? `.${fraction}` : ""}`;
}
/** A decimal string in major units to minor units; refuses more fraction digits than the currency's precision. */
export function parseMajorUnits(amount: string, precision: number): number {
  const match = /^\s*(\d+)(?:\.(\d*))?\s*$/.exec(amount);
  if (!match || (match[2] ?? "").length > precision) throw new ApiError(400, "validation_failed", [{ path: "baseAmount", code: "amount.invalid", message: `Enter a zero-or-positive amount with up to ${precision} decimal place${precision === 1 ? "" : "s"}.` }]);
  const value = Number(`${match[1]}${(match[2] ?? "").padEnd(precision, "0")}`);
  if (!Number.isSafeInteger(value)) throw new ApiError(400, "validation_failed", [{ path: "baseAmount", code: "amount.invalid", message: "Enter a smaller amount." }]);
  return value;
}
export function toSession(wire: WireSession): Session {
  return { accountSubjectId: wire.accountSubjectId, sessionRef: wire.sessionRef, sessionVersion: wire.sessionVersion };
}
export function toBudgetSummaries(wire: WireSpaceList): BudgetSummary[] {
  return wire.spaces.map(space => ({ id: space.budgetSpaceId, name: space.name, currencyCode: space.currencyCode, timeZone: space.timeZone }));
}
/** The API carries no staleness signal, so `freshness` is always `current`; a response missing its space, schedule or period section is `partial`. */
export function toBudgetDetail(wire: WireSpaceDetail): BudgetDetail {
  const complete = Boolean(wire.space?.budgetSpaceId && wire.scheduleVersion?.scheduleVersionId && wire.budgetDate && wire.activePeriod !== undefined);
  const period = wire.activePeriod;
  return {
    id: wire.space?.budgetSpaceId ?? "", name: wire.space?.name ?? "", currencyCode: wire.space?.currencyCode ?? "", timeZone: wire.space?.timeZone ?? "",
    activePeriod: period ? { id: period.periodId, start: period.start, end: period.end, lengthInDays: period.lengthInDays, scheduleVersionId: period.scheduleVersionId } : null,
    freshness: "current", completeness: complete ? "complete" : "partial", updatedAt: wire.budgetDate ?? "",
  };
}
export function toPlan(wire: WirePlan): Plan {
  const precision = wire.minorUnitPrecision;
  return {
    budgetSpaceId: wire.budgetSpaceId, periodId: wire.period.periodId, currencyCode: wire.currencyCode, minorUnitPrecision: precision,
    categories: wire.categories.map(category => ({ id: category.categoryId, name: category.label })),
    targets: wire.categories.filter(category => category.baseTarget !== null).map(category => ({
      categoryId: category.categoryId, baseAmount: formatMinorUnits(category.baseTarget!.amountMinorUnits, precision), periodAmount: formatMinorUnits(category.periodTarget.amountMinorUnits, precision),
    })),
  };
}

/**
 * Session cookies stay HttpOnly. The raw CSRF value arrives in the same-origin bootstrap body (GET /identity/me) and
 * is held in this closure only (CBD-191 section 5.1): never a cookie, never storage, so a reload bootstraps again.
 * Mutations echo it in `X-CoBudget-CSRF`; a bootstrap without a value keeps the held one, and `clear()` drops it.
 */
export function createHttpClient(base = "/v1", fetcher: typeof fetch = fetch): ApiClient {
  let csrf: string | undefined;
  async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal, idempotency?: string): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotency) headers["Idempotency-Key"] = idempotency;
    if (method !== "GET" && path !== "/identity/begin") {
      if (!csrf) throw new ApiError(401, "unauthenticated");
      headers["X-CoBudget-CSRF"] = csrf;
    }
    const response = await fetcher(`${base}${path}`, {
      method, headers, credentials: "same-origin", cache: "no-store", signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new ApiError(response.status, payload.error ?? "request_failed", payload.fieldErrors ?? []);
    }
    return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  }
  return {
    createProposal: (draft, idempotency, supersedes, signal) => request("/budget-creation-proposals", "POST", { ...draft, ...(supersedes ? { supersedesProposalId: supersedes } : {}) }, signal, idempotency),
    readProposal: (id, signal) => request(`/budget-creation-proposals/${encodeURIComponent(id)}`, "GET", undefined, signal),
    confirmProposal: (id, binding, idempotency) => request(`/budget-creation-proposals/${encodeURIComponent(id)}/confirm`, "POST", { confirmationBinding: binding }, undefined, idempotency),
    // The API owns its authorize page, chooser, and callback exchange.
    begin: async () => (await request<{ navigateTo: string }>("/identity/begin", "POST", { ceremony: "sign_in", postResultDestinationId: "budgets" })).navigateTo,
    async me(signal) {
      try {
        const wire = await request<WireSession>("/identity/me", "GET", undefined, signal);
        if (typeof wire.csrfValue === "string" && wire.csrfValue) csrf = wire.csrfValue;
        return toSession(wire);
      } catch (error) {
        if (error instanceof ApiError && [401, 403].includes(error.status)) return null;
        throw error;
      }
    },
    async logout() { await request("/identity/logout", "POST"); csrf = undefined; },
    listBudgets: async (signal) => toBudgetSummaries(await request<WireSpaceList>("/budget-spaces", "GET", undefined, signal)),
    budget: async (id, signal) => toBudgetDetail(await request<WireSpaceDetail>(`/budget-spaces/${encodeURIComponent(id)}`, "GET", undefined, signal)),
    plan: async (id, periodId, signal) => toPlan(await request<WirePlan>(`/budget-spaces/${encodeURIComponent(id)}/plan?periodId=${encodeURIComponent(periodId)}`, "GET", undefined, signal)),
    async addCategory(id, name) {
      const label = name.trim();
      if (!label) throw new ApiError(400, "validation_failed", [{ path: "name", code: "name.required", message: "Enter a category name." }]);
      const result = await request<WireCategoryList>(`/budget-spaces/${encodeURIComponent(id)}/categories`, "PUT", { categories: [{ label }] });
      const created = result.categories.find(category => category.label.toLowerCase() === label.toLowerCase() && category.archivedAt === null);
      if (!created) throw new ApiError(502, "category_missing_from_response");
      return { id: created.categoryId, name: created.label };
    },
    async saveTarget(id, categoryId, amount, precision) {
      await request<WireTargetSet>(`/budget-spaces/${encodeURIComponent(id)}/targets`, "PUT", { targets: [{ categoryId, amountMinorUnits: parseMajorUnits(amount, precision) }] });
    },
    clear() { csrf = undefined; },
  };
}
