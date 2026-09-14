import type { ProposalApi } from "./proposals";
/** Transport boundary. Unsettled prototype routes are documented in API-ASSUMPTIONS.md. */
export interface Session {
  accountSubjectId: string;
  sessionRef: string;
  sessionVersion: number;
  csrf?: string;
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
  baseAmount: string;
  periodAmount: string;
  version: number;
}
export interface Plan {
  budgetSpaceId: string;
  periodId: string;
  currencyCode: string;
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
  saveTarget(id: string, categoryId: string, amount: string, version: number): Promise<void>;
  clear(): void;
}

/** Session cookies stay HttpOnly. Read the separate CSRF cookie at mutation time. */
export function createHttpClient(base = "/v1", fetcher: typeof fetch = fetch, cookies = () => typeof document === "undefined" ? "" : document.cookie): ApiClient {
  async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal, idempotency?: string): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotency) headers["Idempotency-Key"] = idempotency;
    if (method !== "GET" && path !== "/identity/begin") {
      const csrf = cookies().split(";").map(part => part.trim()).find(part => part.startsWith("__Host-cobudget_csrf="))?.slice("__Host-cobudget_csrf=".length);
      if (!csrf) throw new ApiError(401, "unauthenticated");
      headers["x-csrf-token"] = csrf;
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
    begin: async () => (await request<{ navigateTo: string }>("/identity/begin", "POST", { ceremony: "sign_in", postResultDestinationId: "home" })).navigateTo,
    async me(signal) {
      try {
        const session = await request<Session>("/identity/me", "GET", undefined, signal);
        return session;
      } catch (error) {
        if (error instanceof ApiError && [401, 403].includes(error.status)) return null;
        throw error;
      }
    },
    async logout() { await request("/identity/logout", "POST"); },
    listBudgets: (signal) => request("/budget-spaces", "GET", undefined, signal),
    budget: (id, signal) => request(`/budget-spaces/${encodeURIComponent(id)}`, "GET", undefined, signal),
    plan: (id, periodId, signal) => request(`/budget-spaces/${encodeURIComponent(id)}/plan?periodId=${encodeURIComponent(periodId)}`, "GET", undefined, signal),
    addCategory: (id, name) => request(`/budget-spaces/${encodeURIComponent(id)}/categories`, "POST", { name }),
    saveTarget: (id, categoryId, amount, version) => request(`/budget-spaces/${encodeURIComponent(id)}/targets/${encodeURIComponent(categoryId)}`, "PUT", { baseAmount: amount, expectedVersion: version }),
    clear() { /* No credentials are cached by this client. */ },
  };
}
