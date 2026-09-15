"use client";
/**
 * Manual accounts, manual expenses and budget progress on the budget dashboard
 * (CBD-196, CBD-200, CBD-209, CBD-211; PROTO-INCREMENT-B-001).
 *
 * Everything shown here is the API's own figure. Nothing is computed in the
 * browser: `spent` is the magnitude of the API's signed
 * `settledActualMinorUnits`, `remaining` is its `remainingAfterSettledMinorUnits`,
 * and an overspent cell is the one whose remaining is negative -- the client
 * formats and labels, it does not arithmetic. Every refusal a form shows is the
 * server's canonical code mapped to the field it names (`fieldErrorFor`), so no
 * rule is restated here that the API could disagree with.
 *
 * **Read cost.** Every request this section makes counts against the CBD-266
 * authenticated-read surface, which admits 60 a minute per actor for the whole
 * surface, so the section is deliberately frugal: it takes the budget the
 * dashboard above it already read rather than reading it again, and it takes
 * the category set, the currency and the precision from the progress response
 * rather than reading the plan a second time. One dashboard load therefore
 * costs the detail and plan the dashboard already paid for, plus exactly two
 * more: the account list and the period progress.
 *
 * Accessibility: one labelled region per concern, a heading per region, every
 * control labelled, each form's outcome announced through a polite live region
 * that the mutation writes and the reload clears, and no colour-only signal --
 * "over" is a word before it is a style.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import NextLink from "next/link";
import { ApiError, fieldErrorFor } from "../../../api/client";
import type { Account, BudgetDetail, CategoryDetail, Category, ExpenseDraft, Progress } from "../../../api/client";
import { useSession } from "../../../session/SessionProvider";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { Input } from "../../../components/Input";
import { Select } from "../../../components/Select";

const ACCOUNT_TYPES = ["checking", "savings", "cash", "credit-card", "other"] as const;

/** The canonical code's field, or the generic message when the refusal names no field this form owns. */
function errorsOf(error: unknown): { fields: Record<string, string>; summary: string } {
  if (error instanceof ApiError) {
    const reported = error.fieldErrors.length ? error.fieldErrors : [fieldErrorFor(error)];
    const fields: Record<string, string> = {};
    for (const field of reported) fields[field.path] = field.message;
    return { fields, summary: reported[0]!.message };
  }
  return { fields: {}, summary: "We could not save this change. Try again." };
}

interface Loaded {
  accounts: readonly Account[];
  categories: readonly Category[];
  progress: Progress;
  periodId: string;
  currencyCode: string;
  precision: number;
}

/** One read of everything the section shows, so a mutation refreshes all of it at once and nothing can disagree. */
export function Spending({ budget }: { budget: BudgetDetail }) {
  const { api, session } = useSession();
  const id = budget.id;
  const periodId = budget.activePeriod?.id;
  const [state, setState] = useState<{ value?: Loaded; error?: unknown }>();
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const abort = new AbortController();
    const request = ++sequence.current;
    void (async () => {
      try {
        if (!periodId) { if (request === sequence.current) setState({ error: new ApiError(409, "no_active_period") }); return; }
        // Two reads, not four: the category set, the currency and the precision are all in the
        // progress response, and the budget detail was read by the dashboard above.
        const [accounts, progress] = await Promise.all([
          api.listAccounts(id, abort.signal),
          api.progress(id, periodId, abort.signal),
        ]);
        if (abort.signal.aborted || request !== sequence.current) return;
        setState({ value: {
          accounts, progress, periodId,
          categories: progress.cells.map(cell => ({ id: cell.categoryId, name: cell.label })),
          currencyCode: progress.currencyCode, precision: progress.minorUnitPrecision,
        } });
      } catch (error) {
        if (!abort.signal.aborted && request === sequence.current) setState({ error });
      }
    })();
    return () => { abort.abort(); };
  }, [api, id, periodId, revision, session.sessionRef]);
  const reload = useCallback(() => { sequence.current++; setState(undefined); setRevision(value => value + 1); }, []);
  // The live region belongs to this component and not to the forms below it: a mutation reloads the
  // section, which unmounts its forms, and an announcement held inside one would disappear before it
  // was read. It is rendered in every branch for the same reason.
  const [status, setStatus] = useState("");
  const announce = useCallback((message: string) => { setStatus(message); }, []);
  const heading = <>
    <h2 id="spending-heading" className="text-2xl font-semibold">Accounts and spending</h2>
    <p aria-live="polite" role="status" className="text-on-surface-muted" data-testid="spending-status">{status}</p>
  </>;

  if (state?.error) {
    const code = state.error instanceof ApiError ? state.error.status : 503;
    return <section aria-labelledby="spending-heading" className="space-y-4">
      {heading}
      <Alert tone="danger" title={code === 409 ? "No active period" : "Unable to load accounts and spending"}>
        <p>{code === 409 ? "This budget has no active period, so there is nothing to record against yet." : "We could not load the accounts and spending for this budget."}</p>
        {code !== 409 && <Button variant="secondary" onClick={reload}>Try again</Button>}
      </Alert>
    </section>;
  }
  if (!state?.value) {
    return <section aria-labelledby="spending-heading" className="space-y-4">{heading}<Alert loading>Loading accounts and spending…</Alert></section>;
  }
  const loaded = state.value;
  return <section aria-labelledby="spending-heading" className="space-y-8">
    {heading}
    <AccountsSection id={id} loaded={loaded} reload={reload} announce={announce} />
    <ExpenseSection id={id} loaded={loaded} reload={reload} announce={announce} />
    <ProgressSection id={id} loaded={loaded} />
  </section>;
}

function AccountsSection({ id, loaded, reload, announce }: { id: string; loaded: Loaded; reload(): void; announce(message: string): void }) {
  const { api } = useSession();
  const [label, setLabel] = useState("");
  const [accountType, setAccountType] = useState<string>("checking");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");

  async function run(message: string, work: () => Promise<unknown>) {
    setBusy(true); setErrors({}); announce("");
    try { await work(); announce(message); reload(); }
    catch (error) { const reported = errorsOf(error); setErrors(reported.fields); announce(reported.summary); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="accounts-heading" className="space-y-4">
    <h3 id="accounts-heading" className="text-xl font-semibold">Accounts</h3>
    {loaded.accounts.length === 0
      ? <Alert>No accounts yet. Add an account to record an expense against it.</Alert>
      : <ul className="space-y-3" aria-label="Accounts in this budget">{loaded.accounts.map(account => <li key={account.id} className="space-y-2 rounded-lg border border-border p-4" data-testid="account-row">
        <h4 className="break-words font-semibold">{account.label}{account.archived ? " · Archived" : ""}</h4>
        <p>{account.accountType} · opening balance {account.openingBalance} {account.currencyCode}</p>
        {renaming === account.id
          ? <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void run(`Renamed ${newLabel.trim()}.`, async () => { await api.editAccount(id, account.id, { label: newLabel }); setRenaming(null); }); }}>
            <Input id={`account-label-${account.id}`} label={`New name for ${account.label}`} value={newLabel} onChange={event => setNewLabel(event.target.value)} error={errors.label} />
            <Button type="submit" disabled={busy}>Save name</Button>
            <Button type="button" variant="secondary" onClick={() => { setRenaming(null); setErrors({}); }}>Cancel</Button>
          </form>
          : <div className="flex flex-wrap gap-3">
            {!account.archived && <Button variant="secondary" disabled={busy} onClick={() => { setRenaming(account.id); setNewLabel(account.label); setErrors({}); }}>Rename {account.label}</Button>}
            {account.archived
              ? <Button variant="secondary" disabled={busy} onClick={() => void run(`Restored ${account.label}.`, () => api.restoreAccount(id, account.id))}>Restore {account.label}</Button>
              : <Button variant="secondary" disabled={busy} onClick={() => void run(`Archived ${account.label}.`, () => api.archiveAccount(id, account.id))}>Archive {account.label}</Button>}
          </div>}
      </li>)}</ul>}
    <form className="flex flex-wrap items-end gap-3" aria-label="Add an account" onSubmit={event => { event.preventDefault(); void run(`Added ${label.trim()}.`, async () => { await api.addAccount(id, { label, accountType, currencyCode: loaded.currencyCode, openingBalance }); setLabel(""); setOpeningBalance("0"); }); }}>
      <Input id="account-name" label="Account name" value={label} onChange={event => setLabel(event.target.value)} error={errors.label} />
      <Select id="account-type" label="Account type" value={accountType} onChange={event => setAccountType(event.target.value)} error={errors.accountType}>
        {ACCOUNT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
      </Select>
      <Input id="account-opening" label={`Opening balance (${loaded.currencyCode})`} inputMode="decimal" value={openingBalance} onChange={event => setOpeningBalance(event.target.value)} error={errors.amount} />
      <Button type="submit" disabled={busy}>Add account</Button>
    </form>
  </section>;
}

function ExpenseSection({ id, loaded, reload, announce }: { id: string; loaded: Loaded; reload(): void; announce(message: string): void }) {
  const { api } = useSession();
  const live = loaded.accounts.filter(account => !account.archived);
  const [accountId, setAccountId] = useState(live[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [budgetDate, setBudgetDate] = useState("");
  const [description, setDescription] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const draft = (): ExpenseDraft => ({
    accountId: accountId || live[0]?.id || "",
    amount, budgetDate, description,
    allocations: loaded.categories
      .filter(category => (allocations[category.id] ?? "").trim() !== "")
      .map(category => ({ categoryId: category.id, amount: allocations[category.id]! })),
  });

  async function submit() {
    setBusy(true); setErrors({}); announce("");
    try {
      await api.recordExpense(id, draft(), loaded.precision);
      setAmount(""); setDescription(""); setAllocations({});
      announce("Expense recorded. Spent and remaining are updated below.");
      reload();
    } catch (error) {
      const reported = errorsOf(error);
      setErrors(reported.fields); announce(reported.summary);
    } finally { setBusy(false); }
  }

  return <section aria-labelledby="expense-heading" className="space-y-4">
    <h3 id="expense-heading" className="text-xl font-semibold">Record an expense</h3>
    {live.length === 0
      ? <Alert>Add a live account before recording an expense.</Alert>
      : loaded.categories.length === 0
        ? <Alert>Add a category to the plan before recording an expense.</Alert>
        : <form className="space-y-4" aria-label="Record an expense" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <div className="flex flex-wrap items-end gap-3">
            <Select id="expense-account" label="Account" value={accountId} onChange={event => setAccountId(event.target.value)} error={errors.accountId}>
              {live.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}
            </Select>
            <Input id="expense-date" label="Date (YYYY-MM-DD)" value={budgetDate} onChange={event => setBudgetDate(event.target.value)} error={errors.budgetDate} />
            <Input id="expense-amount" label={`Amount spent (${loaded.currencyCode})`} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} error={errors.amount} />
            <Input id="expense-description" label="Description (optional)" value={description} onChange={event => setDescription(event.target.value)} error={errors.description} />
          </div>
          <fieldset className="space-y-3 rounded-lg border border-border p-4">
            <legend className="font-semibold">Split across categories</legend>
            <p id="allocation-hint">The category amounts must add up to the amount spent, exactly.</p>
            {errors.allocations && <p role="alert" className="text-danger">{errors.allocations}</p>}
            <div className="flex flex-wrap items-end gap-3">
              {loaded.categories.map(category => <Input key={category.id} id={`allocation-${category.id}`} label={`${category.name} (${loaded.currencyCode})`} inputMode="decimal"
                aria-describedby="allocation-hint" value={allocations[category.id] ?? ""} onChange={event => setAllocations(current => ({ ...current, [category.id]: event.target.value }))} />)}
            </div>
          </fieldset>
          <Button type="submit" disabled={busy}>Record expense</Button>
        </form>}
  </section>;
}

function ProgressSection({ id, loaded }: { id: string; loaded: Loaded }) {
  return <section aria-labelledby="progress-heading" className="space-y-4">
    <h3 id="progress-heading" className="text-xl font-semibold">Spent and remaining this period</h3>
    {loaded.progress.cells.length === 0
      ? <Alert>No categories yet. Add a category to the plan to see spending against it.</Alert>
      : <ul className="space-y-3" aria-label="Spending by category">{loaded.progress.cells.map(cell => <li key={cell.categoryId} className="space-y-1 rounded-lg border border-border p-4" data-testid="progress-row">
        <h4 className="break-words font-semibold">
          <NextLink className="text-interactive underline" href={`/budgets/${encodeURIComponent(id)}/categories/${encodeURIComponent(cell.categoryId)}`}>{cell.label}</NextLink>
        </h4>
        <p data-testid={`spent-${cell.categoryId}`}>Spent {cell.spent} {loaded.progress.currencyCode} of {cell.target} {loaded.progress.currencyCode}</p>
        <p data-testid={`remaining-${cell.categoryId}`}>{cell.over ? `Over by ${cell.remaining} ${loaded.progress.currencyCode}` : `Remaining ${cell.remaining} ${loaded.progress.currencyCode}`}</p>
      </li>)}</ul>}
  </section>;
}

/**
 * CBD-211: the itemized transactions behind one category's figure for the
 * active period, with the edit and removal of one expense in place. The read
 * is a separate route bound to `14.view_progress_detail` with the category as
 * its target, so a category from another budget is refused by the API.
 *
 * **What this page may edit.** A row here is one allocation, not necessarily a
 * whole expense. The edit below submits the whole transaction with a single
 * allocation, so it is offered only for an item the API reports as carrying
 * exactly one allocation (`allocationCount`). A share of a split expense is
 * shown with a statement of why it cannot be changed here, because the
 * alternative -- rewriting it as a single-category expense -- would silently
 * take the other categories' amounts away and lower their `spent` without the
 * person ever being told (F-REVB-01).
 */
export function CategoryDetailView({ id, categoryId }: { id: string; categoryId: string }) {
  const { api, session } = useSession();
  const [state, setState] = useState<{ value?: { detail: CategoryDetail; accounts: readonly Account[]; precision: number }; error?: unknown }>();
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const abort = new AbortController();
    const request = ++sequence.current;
    void (async () => {
      try {
        const budget = await api.budget(id, abort.signal);
        const period = budget.activePeriod;
        if (!period) { if (request === sequence.current) setState({ error: new ApiError(409, "no_active_period") }); return; }
        // The detail response carries its own precision, so no plan read is needed.
        const [detail, accounts] = await Promise.all([
          api.categoryDetail(id, period.id, categoryId, abort.signal),
          api.listAccounts(id, abort.signal),
        ]);
        if (abort.signal.aborted || request !== sequence.current) return;
        setState({ value: { detail, accounts, precision: detail.minorUnitPrecision } });
      } catch (error) {
        if (!abort.signal.aborted && request === sequence.current) setState({ error });
      }
    })();
    return () => { abort.abort(); };
  }, [api, id, categoryId, revision, session.sessionRef]);
  const reload = () => { sequence.current++; setState(undefined); setRevision(value => value + 1); };

  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (state?.error) {
    const status = state.error instanceof ApiError ? state.error.status : 503;
    const denied = status === 401 || status === 403;
    return <section className="space-y-4"><h1 className="font-display text-3xl font-semibold">Category detail</h1>
      <Alert tone="danger" title={denied ? "Access unavailable" : "Unable to load this category"}>
        <p>{denied ? "Your current session cannot open this category." : "We could not load the transactions behind this figure."}</p>
        {!denied && <Button variant="secondary" onClick={reload}>Try again</Button>}
        <NextLink className="ml-3 underline" href={`/budgets/${encodeURIComponent(id)}`}>Back to the budget</NextLink>
      </Alert>
    </section>;
  }
  if (!state?.value) {
    return <section className="space-y-4"><h1 className="font-display text-3xl font-semibold">Category detail</h1><Alert loading>Loading this category…</Alert></section>;
  }
  const { detail, accounts, precision } = state.value;
  const cell = detail.cell;

  async function run(announce: string, work: () => Promise<unknown>) {
    setBusy(true); setErrors({}); setStatus("");
    try { await work(); setStatus(announce); reload(); }
    catch (error) { const reported = errorsOf(error); setErrors(reported.fields); setStatus(reported.summary); }
    finally { setBusy(false); }
  }

  return <section className="space-y-6">
    <h1 className="break-words font-display text-3xl font-semibold">{detail.label}</h1>
    <NextLink className="text-interactive underline" href={`/budgets/${encodeURIComponent(id)}`}>Back to the budget</NextLink>
    <p aria-live="polite" role="status" className="text-on-surface-muted" data-testid="detail-status">{status}</p>
    {cell && <dl className="grid gap-3 rounded-lg border border-border p-5 sm:grid-cols-3">
      <div><dt className="font-semibold">Target</dt><dd>{cell.target} {detail.currencyCode}</dd></div>
      <div><dt className="font-semibold">Spent</dt><dd data-testid="detail-spent">{cell.spent} {detail.currencyCode}</dd></div>
      <div><dt className="font-semibold">{cell.over ? "Over by" : "Remaining"}</dt><dd data-testid="detail-remaining">{cell.remaining} {detail.currencyCode}</dd></div>
    </dl>}
    <section aria-labelledby="items-heading" className="space-y-4">
      <h2 id="items-heading" className="text-2xl font-semibold">Transactions in this category</h2>
      {detail.items.length === 0
        ? <Alert>Nothing has been recorded against this category for the active period.</Alert>
        : <ul className="space-y-3" aria-label="Transactions in this category">{detail.items.map(item => {
          const account = accounts.find(entry => entry.id === item.accountId);
          return <li key={item.transactionId} className="space-y-2 rounded-lg border border-border p-4" data-testid="detail-item">
            <h3 className="break-words font-semibold">{item.description ?? "No description"}</h3>
            <p>{item.budgetDate} · {item.amount} {detail.currencyCode} · {account?.label ?? item.accountId}</p>
            {item.allocationCount !== 1
              // A share of a split expense. The form below rewrites the whole transaction with one
              // allocation, which would silently discard every other category's share, so this page
              // refuses the edit rather than performing it (F-REVB-01). Removal is still whole and
              // still honest: it removes the whole expense, and it says so.
              ? <div className="space-y-2">
                <p data-testid="detail-split-notice">
                  This expense is split across {item.allocationCount ?? "several"} categories, so it cannot be changed from this page.
                  Edit it where every category&rsquo;s amount is shown, so nothing is dropped.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button variant="secondary" disabled={busy} onClick={() => void run("Expense removed.", () => api.removeExpense(id, item.transactionId))}>Remove this whole expense</Button>
                </div>
              </div>
              : editing === item.transactionId
              ? <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
                event.preventDefault();
                void run("Expense updated.", async () => {
                  await api.editExpense(id, item.transactionId, {
                    accountId: item.accountId, amount, budgetDate: item.budgetDate, description: item.description ?? "",
                    allocations: [{ categoryId: detail.categoryId, amount }],
                  }, precision);
                  setEditing(null);
                });
              }}>
                <Input id={`edit-amount-${item.transactionId}`} label={`New amount (${detail.currencyCode})`} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} error={errors.amount ?? errors.allocations} />
                <Button type="submit" disabled={busy}>Save expense</Button>
                <Button type="button" variant="secondary" onClick={() => { setEditing(null); setErrors({}); }}>Cancel</Button>
              </form>
              : <div className="flex flex-wrap gap-3">
                <Button variant="secondary" disabled={busy} onClick={() => { setEditing(item.transactionId); setAmount(item.amount); setErrors({}); }}>Edit this expense</Button>
                <Button variant="secondary" disabled={busy} onClick={() => void run("Expense removed.", () => api.removeExpense(id, item.transactionId))}>Remove this expense</Button>
              </div>}
          </li>;
        })}</ul>}
    </section>
  </section>;
}
