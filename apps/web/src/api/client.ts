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

// --- PROTO-INCREMENT-B-001: manual accounts, manual expenses and budget progress ---------------

export interface Account {
  id: string;
  label: string;
  accountType: string;
  currencyCode: string;
  minorUnitPrecision: number;
  /** Decimal major-unit string formatted from the API's minor units; never computed client-side. */
  openingBalance: string;
  archived: boolean;
  version: number;
}
export interface AccountDraft { label: string; accountType: string; currencyCode: string; openingBalance: string }
/**
 * One category's figure for the period. `spent` is the positive magnitude of the
 * API's signed `settledActualMinorUnits`: the API is signed end to end (an expense
 * is negative), and a person reads "spent 12.50", not "spent -12.50". `remaining`
 * is the API's `remainingAfterSettledMinorUnits` unchanged; when it is negative the
 * cell is `over` and the magnitude is what the view labels as overspent.
 */
export interface ProgressCell {
  categoryId: string;
  label: string;
  target: string;
  spent: string;
  remaining: string;
  over: boolean;
}
export interface Progress {
  budgetSpaceId: string;
  periodId: string;
  currencyCode: string;
  minorUnitPrecision: number;
  cells: readonly ProgressCell[];
}
export interface DetailItem {
  transactionId: string;
  accountId: string;
  budgetDate: string;
  description: string | null;
  /** The positive magnitude of this allocation, for the same reason `spent` is. */
  amount: string;
}
export interface CategoryDetail {
  budgetSpaceId: string;
  periodId: string;
  categoryId: string;
  label: string;
  currencyCode: string;
  minorUnitPrecision: number;
  cell: ProgressCell | null;
  items: readonly DetailItem[];
}
/** Amounts are positive major-unit magnitudes; the client negates them, because an expense is negative on the wire. */
export interface ExpenseDraft {
  accountId: string;
  amount: string;
  budgetDate: string;
  description: string;
  allocations: readonly { categoryId: string; amount: string }[];
}
export interface Expense { transactionId: string; revision: number }

export interface ApiClient extends ProposalApi {
  begin(): Promise<string>;
  me(signal?: AbortSignal): Promise<Session | null>;
  logout(): Promise<void>;
  listBudgets(signal?: AbortSignal): Promise<readonly BudgetSummary[]>;
  budget(id: string, signal?: AbortSignal): Promise<BudgetDetail>;
  plan(id: string, periodId: string, signal?: AbortSignal): Promise<Plan>;
  addCategory(id: string, name: string): Promise<Category>;
  saveTarget(id: string, categoryId: string, amount: string, precision: number): Promise<void>;
  listAccounts(id: string, signal?: AbortSignal): Promise<readonly Account[]>;
  addAccount(id: string, draft: AccountDraft): Promise<Account>;
  editAccount(id: string, accountId: string, draft: Pick<AccountDraft, "label">): Promise<Account>;
  archiveAccount(id: string, accountId: string): Promise<Account>;
  restoreAccount(id: string, accountId: string): Promise<Account>;
  recordExpense(id: string, draft: ExpenseDraft, precision: number): Promise<Expense>;
  editExpense(id: string, transactionId: string, draft: ExpenseDraft, precision: number): Promise<Expense>;
  removeExpense(id: string, transactionId: string): Promise<void>;
  progress(id: string, periodId: string, signal?: AbortSignal): Promise<Progress>;
  categoryDetail(id: string, periodId: string, categoryId: string, signal?: AbortSignal): Promise<CategoryDetail>;
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

/** POST/GET/PATCH /v1/budget-spaces/{id}/accounts[...] (CBD-196, PROTO-INCREMENT-B-001). */
export interface WireAccount {
  accountId: string; origin: string; accountType: string; label: string; currencyCode: string; minorUnitPrecision: number;
  openingBalanceMinorUnits: number; ownerSubjectId: string; archivedAt: string | null; version: number;
}
export interface WireAccountList { budgetSpaceId: string; accounts: readonly WireAccount[] }
export interface WireAccountMutation { previousVersion: number | null; account: WireAccount }
/** POST/PATCH /v1/budget-spaces/{id}/transactions[...] (CBD-199, CBD-200, CBD-201). */
export interface WireTransactionMutation {
  previous: unknown;
  current: { version: { transactionId: string; revision: number; [field: string]: unknown }; allocations: readonly unknown[] };
}
/** GET /v1/budget-spaces/{id}/periods/{periodId}/progress (CBD-209). */
export interface WireProgress {
  budgetSpaceId: string; periodId: string; currencyCode: string; minorUnitPrecision: number;
  labels: Readonly<Record<string, string>>; calculationVersion: string;
  cells: readonly { categoryId: string; targetMinorUnits: number; settledActualMinorUnits: number; remainingAfterSettledMinorUnits: number }[];
}
/** GET /v1/budget-spaces/{id}/periods/{periodId}/progress/{categoryId} (CBD-211). */
export interface WireCategoryDetail {
  budgetSpaceId: string; periodId: string; categoryId: string; label: string | null; currencyCode: string; minorUnitPrecision: number;
  cell: WireProgress["cells"][number] | null;
  items: readonly { transactionId: string; accountId: string; budgetDate: string; description: string | null; amountMinorUnits: number }[];
}

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
 * The canonical error code a route returns is also the name of the field it is
 * about; this is the only place that correspondence is written down. The server
 * owns the code and the refusal -- nothing here re-validates -- and the view uses
 * the field so the message lands on the input the person must change.
 */
const FIELD_OF_CODE: Readonly<Record<string, string>> = Object.freeze({
  label_invalid: "label", label_taken: "label",
  account_type_unsupported: "accountType",
  currency_unsupported: "currencyCode", currency_precision_unsupported: "currencyCode", currency_mismatch: "accountId",
  amount_not_integer: "amount", amount_overflow: "amount",
  owner_invalid: "label",
  account_not_found: "accountId", account_archived: "accountId", account_not_archived: "accountId", account_inaccessible: "accountId",
  date_invalid: "budgetDate", period_not_found: "budgetDate", period_ambiguous: "budgetDate",
  description_invalid: "description",
  allocations_empty: "allocations", allocation_duplicate_category: "allocations",
  allocation_category_invalid: "allocations", allocation_sum_mismatch: "allocations",
  transaction_not_found: "transactionId", transaction_removed: "transactionId",
  version_conflict: "label", conflict: "label", constraint_violation: "label", invalid_request: "label",
});
/** The sentence shown next to the field. One per canonical code, so no refusal reaches a person as a code. */
const MESSAGE_OF_CODE: Readonly<Record<string, string>> = Object.freeze({
  label_invalid: "Enter a name between 1 and 120 characters.",
  label_taken: "Another live account already uses this name.",
  account_type_unsupported: "Choose one of the listed account types.",
  currency_unsupported: "Choose a supported currency.",
  currency_precision_unsupported: "This currency is not supported yet.",
  currency_mismatch: "This expense is not in the account's currency.",
  amount_not_integer: "Enter an amount with no more decimal places than the currency allows.",
  amount_overflow: "Enter a smaller amount.",
  owner_invalid: "The account owner is not valid.",
  account_not_found: "Choose an account from this budget.",
  account_archived: "This account is archived. Restore it first, or choose another.",
  account_not_archived: "This account is not archived.",
  account_inaccessible: "This account cannot be used.",
  date_invalid: "Enter a real date as YYYY-MM-DD.",
  period_not_found: "This date falls outside every budget period.",
  period_ambiguous: "This date falls in more than one period.",
  description_invalid: "Use 200 characters or fewer.",
  allocations_empty: "Split the expense across at least one category.",
  allocation_duplicate_category: "Each category may appear once.",
  allocation_category_invalid: "Choose categories from this budget.",
  allocation_sum_mismatch: "The category amounts must add up to the expense amount exactly.",
  transaction_not_found: "This expense no longer exists. Refresh and try again.",
  transaction_removed: "This expense has already been removed.",
  version_conflict: "Someone else changed this first. Refresh and try again.",
  conflict: "This change conflicts with the saved budget. Refresh and try again.",
  constraint_violation: "This change cannot be saved as entered.",
  invalid_request: "Check the values entered and try again.",
});
/** Turns a route's canonical `{ error }` body into the per-field error the form renders. */
export function fieldErrorFor(error: ApiError): FieldError {
  return { path: FIELD_OF_CODE[error.code] ?? "label", code: error.code, message: MESSAGE_OF_CODE[error.code] ?? "This change could not be saved." };
}
/** A refusal carrying no field errors of its own is given the one its canonical code names. */
function withField<T>(work: Promise<T>): Promise<T> {
  return work.catch((error: unknown) => {
    if (error instanceof ApiError && error.fieldErrors.length === 0 && FIELD_OF_CODE[error.code]) throw new ApiError(error.status, error.code, [fieldErrorFor(error)]);
    throw error;
  });
}
export function toAccount(wire: WireAccount): Account {
  return {
    id: wire.accountId, label: wire.label, accountType: wire.accountType, currencyCode: wire.currencyCode,
    minorUnitPrecision: wire.minorUnitPrecision, openingBalance: formatMinorUnits(wire.openingBalanceMinorUnits, wire.minorUnitPrecision),
    archived: wire.archivedAt !== null, version: wire.version,
  };
}
/** The signed API figure becomes a magnitude for "spent" and stays signed for "remaining". */
export function toProgressCell(cell: WireProgress["cells"][number], label: string, precision: number): ProgressCell {
  return {
    categoryId: cell.categoryId, label,
    target: formatMinorUnits(cell.targetMinorUnits, precision),
    spent: formatMinorUnits(Math.abs(cell.settledActualMinorUnits), precision),
    remaining: formatMinorUnits(Math.abs(cell.remainingAfterSettledMinorUnits), precision),
    over: cell.remainingAfterSettledMinorUnits < 0,
  };
}
export function toProgress(wire: WireProgress): Progress {
  return {
    budgetSpaceId: wire.budgetSpaceId, periodId: wire.periodId, currencyCode: wire.currencyCode, minorUnitPrecision: wire.minorUnitPrecision,
    cells: wire.cells.map(cell => toProgressCell(cell, wire.labels[cell.categoryId] ?? cell.categoryId, wire.minorUnitPrecision))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}
export function toCategoryDetail(wire: WireCategoryDetail): CategoryDetail {
  const label = wire.label ?? wire.categoryId;
  return {
    budgetSpaceId: wire.budgetSpaceId, periodId: wire.periodId, categoryId: wire.categoryId, label, currencyCode: wire.currencyCode,
    minorUnitPrecision: wire.minorUnitPrecision,
    cell: wire.cell ? toProgressCell(wire.cell, label, wire.minorUnitPrecision) : null,
    items: wire.items.map(item => ({
      transactionId: item.transactionId, accountId: item.accountId, budgetDate: item.budgetDate, description: item.description,
      amount: formatMinorUnits(Math.abs(item.amountMinorUnits), wire.minorUnitPrecision),
    })),
  };
}
/** A positive major-unit magnitude becomes the negative minor-unit amount the API stores for an expense. */
export function toExpenseBody(draft: ExpenseDraft, precision: number): Record<string, unknown> {
  const description = draft.description.trim();
  return {
    accountId: draft.accountId,
    amountMinorUnits: -parseMajorUnits(draft.amount, precision),
    budgetDate: draft.budgetDate,
    description: description === "" ? null : description,
    allocations: draft.allocations.map(allocation => ({ categoryId: allocation.categoryId, amountMinorUnits: -parseMajorUnits(allocation.amount, precision) })),
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
    confirmProposal: (id, binding, idempotency, acknowledgedDisclosure) => request(`/budget-creation-proposals/${encodeURIComponent(id)}/confirm`, "POST", { confirmationBinding: binding, acknowledgedDisclosure }, undefined, idempotency),
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
    listAccounts: async (id, signal) => (await request<WireAccountList>(`/budget-spaces/${encodeURIComponent(id)}/accounts`, "GET", undefined, signal)).accounts.map(toAccount),
    addAccount: async (id, draft) => toAccount((await withField(request<WireAccountMutation>(`/budget-spaces/${encodeURIComponent(id)}/accounts`, "POST", {
      accountType: draft.accountType, label: draft.label.trim(), currencyCode: draft.currencyCode,
      openingBalanceMinorUnits: parseMajorUnits(draft.openingBalance === "" ? "0" : draft.openingBalance, 2),
    }))).account),
    editAccount: async (id, accountId, draft) => toAccount((await withField(request<WireAccountMutation>(`/budget-spaces/${encodeURIComponent(id)}/accounts/${encodeURIComponent(accountId)}`, "PATCH", { label: draft.label.trim() }))).account),
    archiveAccount: async (id, accountId) => toAccount((await withField(request<WireAccountMutation>(`/budget-spaces/${encodeURIComponent(id)}/accounts/${encodeURIComponent(accountId)}/archive`, "POST", {}))).account),
    restoreAccount: async (id, accountId) => toAccount((await withField(request<WireAccountMutation>(`/budget-spaces/${encodeURIComponent(id)}/accounts/${encodeURIComponent(accountId)}/restore`, "POST", {}))).account),
    async recordExpense(id, draft, precision) {
      const result = await withField(request<WireTransactionMutation>(`/budget-spaces/${encodeURIComponent(id)}/transactions`, "POST", toExpenseBody(draft, precision)));
      return { transactionId: result.current.version.transactionId, revision: result.current.version.revision };
    },
    async editExpense(id, transactionId, draft, precision) {
      const result = await withField(request<WireTransactionMutation>(`/budget-spaces/${encodeURIComponent(id)}/transactions/${encodeURIComponent(transactionId)}`, "PATCH", toExpenseBody(draft, precision)));
      return { transactionId: result.current.version.transactionId, revision: result.current.version.revision };
    },
    async removeExpense(id, transactionId) {
      await withField(request<WireTransactionMutation>(`/budget-spaces/${encodeURIComponent(id)}/transactions/${encodeURIComponent(transactionId)}/remove`, "POST", {}));
    },
    progress: async (id, periodId, signal) => toProgress(await request<WireProgress>(`/budget-spaces/${encodeURIComponent(id)}/periods/${encodeURIComponent(periodId)}/progress`, "GET", undefined, signal)),
    categoryDetail: async (id, periodId, categoryId, signal) =>
      toCategoryDetail(await request<WireCategoryDetail>(`/budget-spaces/${encodeURIComponent(id)}/periods/${encodeURIComponent(periodId)}/progress/${encodeURIComponent(categoryId)}`, "GET", undefined, signal)),
    clear() { csrf = undefined; },
  };
}
