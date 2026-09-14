"use client";
// Data requests, cancellation, editing, and status announcements require client state.
import { useCallback, useEffect, useRef, useState } from "react";
import NextLink from "next/link";
import { ApiError } from "../../api/client";
import type { BudgetDetail, Category, Plan, Target } from "../../api/client";
import { useSession } from "../../session/SessionProvider";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";

function useResource<T>(identity: string, load: (signal: AbortSignal) => Promise<T>) {
  const [result, setResult] = useState<{ identity: string; value?: T; error?: unknown; refreshed?: boolean }>();
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const abort = new AbortController();
    const request = ++sequence.current;
    load(abort.signal).then(value => {
      if (!abort.signal.aborted && request === sequence.current) setResult({ identity, value, refreshed: revision > 0 });
    }, error => {
      if (!abort.signal.aborted && request === sequence.current) setResult({ identity, error });
    });
    return () => { abort.abort(); };
  }, [identity, load, revision]);
  const refresh = () => { sequence.current++; setResult(undefined); setRevision(value => value + 1); };
  return { ...(result?.identity === identity ? result : {}), refresh };
}
function Failure({ error, retry }: { error: unknown; retry(): void }) {
  const status = error instanceof ApiError ? error.status : 503;
  const denied = status === 401 || status === 403;
  const terminal = status === 404 || status === 410 || status === 502;
  return <Alert tone="danger" title={denied ? "Access unavailable" : terminal ? "Budget unavailable" : "Unable to load this budget"}>
    <p>{denied ? "Your current session cannot open this budget." : terminal ? "This budget cannot be opened from this link." : "We could not refresh the budget. You can try again."}</p>
    {!denied && !terminal && <Button variant="secondary" onClick={retry}>Try again</Button>}
    {denied && <NextLink className="underline" href="/sign-in">Sign in again</NextLink>}
    <NextLink className="ml-3 underline" href="/budgets">Back to budgets</NextLink>
  </Alert>;
}
export function BudgetNavigation() {
  const { logout } = useSession();
  return <nav aria-label="Budgets" className="flex flex-wrap items-center justify-between gap-4">
    <NextLink className="text-interactive underline" href="/budgets">Your budgets</NextLink>
    <Button variant="secondary" onClick={() => void logout()}>Sign out</Button>
  </nav>;
}
export function BudgetList() {
  const { api, session } = useSession();
  const load = useCallback((signal: AbortSignal) => api.listBudgets(signal), [api]);
  const result = useResource(session.sessionRef, load);
  return <section className="space-y-6"><h1 className="font-display text-3xl font-semibold">Your budgets</h1>
    <NextLink className="text-interactive underline" href="/budgets/new">Create a budget</NextLink>
    {result.error ? <Failure error={result.error} retry={result.refresh} /> : !result.value ? <Alert loading>Loading your budgets…</Alert> : result.value.length === 0 ? <Alert>No budgets yet. Create a budget to start your plan.</Alert> : <ul className="grid gap-4 sm:grid-cols-2">{result.value.map(budget => <li key={budget.id} className="rounded-lg border border-border bg-surface-raised p-6"><NextLink href={`/budgets/${encodeURIComponent(budget.id)}`} className="break-words text-xl font-semibold text-interactive underline">{budget.name}</NextLink><p>{budget.currencyCode} · {budget.timeZone}</p></li>)}</ul>}
  </section>;
}
export function Dashboard({ id, editing = false }: { id: string; editing?: boolean }) {
  const { api, session } = useSession();
  const load = useCallback(async (signal: AbortSignal) => {
    const budget = await api.budget(id, signal);
    if (budget.id !== id) throw new ApiError(502, "identity_mismatch");
    return budget;
  }, [api, id]);
  const result = useResource(`${session.sessionRef}:${session.sessionVersion}:${id}`, load);
  return <section className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="break-words font-display text-3xl font-semibold">{result.value?.name ?? "Budget dashboard"}{editing ? " · Category plan" : ""}</h1><Button variant="secondary" onClick={result.refresh}>Refresh budget</Button></div>
    {result.error ? <Failure error={result.error} retry={result.refresh} /> : !result.value ? <Alert loading>Loading the active budget period…</Alert> : <BudgetContent budget={result.value} refreshed={Boolean(result.refreshed)} editing={editing} />}
  </section>;
}
function BudgetContent({ budget, refreshed, editing }: { budget: BudgetDetail; refreshed: boolean; editing: boolean }) {
  const period = budget.activePeriod;
  return <>
    {budget.freshness === "stale" && <Alert title="Saved budget snapshot">Budget details were last updated {budget.updatedAt}. They may have changed. Refresh before editing.</Alert>}
    {budget.completeness === "partial" && <Alert title="Budget details are incomplete">Some budget details are unavailable. The category plan is withheld until a complete response is available.</Alert>}
    {!period ? <Alert title="No active period">This budget has no active period to display.</Alert> : <>
      {budget.freshness === "current" && budget.completeness === "complete" && <Alert>{refreshed ? "Budget refreshed. The current active period is shown." : "The active budget period is ready."}</Alert>}
      <dl className="grid gap-3 rounded-lg border border-border p-5 sm:grid-cols-2">
        <div><dt className="font-semibold">Budget identity</dt><dd className="break-all">{budget.id}</dd></div>
        <div><dt className="font-semibold">Active period identity</dt><dd className="break-all">{period.id}</dd></div>
        <div><dt className="font-semibold">Inclusive dates</dt><dd>{period.start} through {period.end} · {period.lengthInDays} days</dd></div>
        <div><dt className="font-semibold">Time zone and currency</dt><dd>{budget.timeZone} · {budget.currencyCode}</dd></div>
      </dl>
      {budget.completeness === "complete" && budget.freshness === "current" && <PlanView key={`${budget.id}:${period.id}:${budget.updatedAt}`} budget={budget} editing={editing} />}
      {!editing && <NextLink className="text-interactive underline" href={`/budgets/${encodeURIComponent(budget.id)}/plan`}>Edit category plan</NextLink>}
    </>}
  </>;
}
function PlanView({ budget, editing }: { budget: BudgetDetail; editing: boolean }) {
  const { api } = useSession();
  const periodId = budget.activePeriod!.id;
  const load = useCallback(async (signal: AbortSignal) => {
    const plan = await api.plan(budget.id, periodId, signal);
    if (plan.budgetSpaceId !== budget.id || plan.periodId !== periodId) throw new ApiError(502, "identity_mismatch");
    return plan;
  }, [api, budget.id, periodId]);
  const result = useResource(`${budget.id}:${periodId}`, load);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true); setError("");
    try { await api.addCategory(budget.id, name); setName(""); result.refresh(); }
    catch (error) { setError(error instanceof ApiError && error.fieldErrors[0] ? error.fieldErrors[0].message : "We could not add this category. Try again."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4" aria-labelledby="plan-heading"><h2 id="plan-heading" className="text-2xl font-semibold">Category plan</h2>
    {result.error ? <Failure error={result.error} retry={result.refresh} /> : !result.value ? <Alert loading>Loading category targets…</Alert> : <>
      {result.value.categories.length === 0 && <Alert>No categories yet. Add a category to start planning.</Alert>}
      <ul className="space-y-4">{result.value.categories.map(category => <TargetRow key={`${category.id}:${result.value!.targets.find(target => target.categoryId === category.id)?.baseAmount ?? ""}`} category={category} target={result.value!.targets.find(target => target.categoryId === category.id)} plan={result.value!} editing={editing} saved={result.refresh} />)}</ul>
    </>}
    {editing && <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void add(); }}><Input id="category-name" label="Category name" value={name} onChange={event => setName(event.target.value)} error={error || undefined} /><Button type="submit" disabled={busy}>Add category</Button></form>}
  </section>;
}
function TargetRow({ category, target, plan, editing, saved }: { category: Category; target?: Target; plan: Plan; editing: boolean; saved(): void }) {
  const { api } = useSession();
  const [amount, setAmount] = useState(target?.baseAmount ?? "0");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError("");
    try { await api.saveTarget(plan.budgetSpaceId, category.id, amount, plan.minorUnitPrecision); saved(); }
    catch (error) { setError(error instanceof ApiError && error.fieldErrors[0] ? error.fieldErrors[0].message : "We could not save this target. Refresh the plan and try again."); }
    finally { setBusy(false); }
  }
  return <li className="space-y-3 rounded-lg border border-border p-4"><h3 className="break-words font-semibold">{category.name}</h3><p>Period target: {target ? `${target.periodAmount} ${plan.currencyCode}` : "Not set"}</p>
    {editing ? <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void save(); }}><Input id={`target-${category.id}`} label={`Base target for ${category.name} (${plan.currencyCode})`} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} error={error || undefined} /><Button type="submit" disabled={busy}>Save target</Button></form> : <p>Base target: {target ? `${target.baseAmount} ${plan.currencyCode}` : "Not set"}</p>}
  </li>;
}
