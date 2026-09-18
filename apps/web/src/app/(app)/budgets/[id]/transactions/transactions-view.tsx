"use client";
// CBD-202 (AC01-AC05): the manual transactions surface -- list, editor, per-category allocation and removal --
// against the one new read this packet stubs (`createTransactionsClient`) and the write endpoints that already
// exist (`recordExpense`/`editExpense`/`removeExpense`, PROTO-INCREMENT-B-001). Form state, cancellable reads,
// dialogs and status announcements require client state.
//
// Nothing here restates a rule the API owns: every refusal is the server's own canonical code, mapped through
// `fieldErrorFor`/`reportTransactionError`, and every figure shown is the API's own value, already a formatted
// string (`transactions.ts`'s `toTransactionRow`, `client.ts`'s `formatMinorUnits`) -- this module does no
// arithmetic on money (CBD-202 section 6.3 item 1). The word "Split" is never used for the per-category
// allocation list; the heading is "Categories for this transaction" (section 6.2, CBD-202-AC01).
//
// Deviations, recorded rather than silently chosen (section 6.4 item 4 -- silence is not permission):
//  - `AllocationSummary`'s "remainder" is the server's own `allocation_sum_mismatch` message, not a computed
//    number: the wire shape this packet stubs (and the write responses `client.ts` already surfaces) carries
//    no numeric remainder field, so a live client-computed total would be exactly the arithmetic-on-money rule
//    forbids. The summary shows the amounts already known (entered, or read back from the transaction) and,
//    once a submission is refused for not summing to the total, the server's own sentence.
//  - "Material-impact edit" (CBD-202-AC03) is read broadly: every edit changes the amount, the account, the
//    date or the categories a settled figure depends on, so every edit (not creation) and every removal goes
//    through `ImpactConfirm`. This is the more cautious reading and is reversible, not a narrowing.
//  - Client-side "valid" gating (submit disabled until every required field is present -- CBD-202-AC02) checks
//    presence only (a field is non-empty, at least one allocation row is filled): never a sum, which stays the
//    server's own check via `allocation_sum_mismatch`.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, SubmissionKey, directionOf, parseMajorUnits } from "../../../../../api/client";
import type { Account, AmountDirection, Category, ExpenseDraft } from "../../../../../api/client";
import { createTransactionsClient } from "../../../../../api/transactions";
import type { TransactionRow } from "../../../../../api/transactions";
import { reportTransactionError, transactionAnnouncement } from "../../../../../api/transactions-presentation";
import type { TransactionErrorReport } from "../../../../../api/transactions-presentation";
import { apiBase } from "@/api/runtime-mode";
import { useSession } from "../../../../../session/SessionProvider";
import { Alert } from "../../../../../components/Alert";
import { Button } from "../../../../../components/Button";
import { Input } from "../../../../../components/Input";
import { Select } from "../../../../../components/Select";
import { Table } from "../../../../../components/Table";
import type { Column } from "../../../../../components/Table";
// CBD-35: the polite live region and the uniform denied-access notice are shared shapes, not this module's own copies.
import { DeniedState, StatusRegion, classifyFailure } from "../../../../../ui/resource";

function useTransactionsClient() {
  return useMemo(() => createTransactionsClient(apiBase), []);
}

interface Loaded {
  periodId: string;
  currencyCode: string;
  precision: number;
  accounts: readonly Account[];
  categories: readonly Category[];
  transactions: readonly TransactionRow[];
}

/** One magnitude with its sign as a word, exactly as `spending.tsx`'s `itemAmount` already renders one (never a
 * bare minus -- section 1.4/6.2). */
function amountWords(amount: string, direction: AmountDirection, currencyCode: string): string {
  const word: Record<AmountDirection, string> = { spend: " spent", refund: " refund", zero: "" };
  return `${amount} ${currencyCode}${word[direction]}`;
}
function categoryLabel(categories: readonly Category[], categoryId: string): string {
  return categories.find(category => category.id === categoryId)?.name ?? categoryId;
}
function accountLabel(accounts: readonly Account[], accountId: string): string {
  return accounts.find(account => account.id === accountId)?.label ?? accountId;
}

/** The three distinct read failures (CBD-67 SS14.6, by analogy; CBD-202-AC02/AC03), plus the section's own
 * "no active period" fact -- there is nothing to record against yet, not a failure to retry. */
function TransactionsFailure({ error, retry }: { error: unknown; retry(): void }) {
  if (error instanceof ApiError && error.status === 409 && error.code === "no_active_period") {
    return <Alert title="No active period">This budget has no active period, so there is nothing to record against yet.</Alert>;
  }
  const kind = classifyFailure(error);
  if (kind === "denied") return <DeniedState>
    <p>Your current session cannot open the transactions for this budget.</p>
  </DeniedState>;
  return <Alert tone="danger" title={kind === "terminal" ? "Transactions unavailable" : "Unable to load transactions"}>
    <p>{kind === "terminal" ? "The transactions for this budget cannot be opened from this link." : "We could not load the transactions for this budget."}</p>
    {kind !== "terminal" && <Button variant="secondary" onClick={retry}>Try again</Button>}
  </Alert>;
}

// NEW-UIP03-A: `baseAmount` is `parseMajorUnits`'s own field name for a client-side amount refusal (negative,
// too many decimals, or non-numeric text) -- distinct from the server's `amount` (e.g. `amount_overflow`).
// Without an entry here, `focusFirstInvalid` matched nothing and moved no focus for that one refusal shape.
const FIELD_SUFFIX: Readonly<Record<string, string>> = Object.freeze({ accountId: "account", budgetDate: "date", amount: "amount", baseAmount: "amount", description: "description" });
/** Moves focus to the first invalid field, leaving every other entered value untouched (CBD-202-AC02). */
function focusFirstInvalid(prefix: string, fields: Readonly<Record<string, string>>): void {
  for (const path of Object.keys(FIELD_SUFFIX)) if (fields[path]) { document.getElementById(`transaction-${prefix}-${FIELD_SUFFIX[path]}`)?.focus(); return; }
  if (fields.allocations) document.getElementById(`transaction-${prefix}-allocations`)?.focus();
}
/** REV-UIP03-2 (the same pattern UI-P02's second correction round established): the stable focus target after
 * any completed `ImpactConfirm` action -- success or denial, edit or removal. Every one of those unmounts the
 * dialog's own trigger control (via `onDone()`/`refresh()`), so the platform's own focus-return-to-trigger has
 * nothing left to land on; `#transactions-heading` is rendered in every branch of `TransactionsView` (loading,
 * error, populated) and survives the reload, exactly like `accounts-heading` does for `AccountsView`. */
function focusTransactionsHeading(): void { document.getElementById("transactions-heading")?.focus(); }
/** Best-effort minor-units parse of a user-typed amount: `null`, never a thrown validation error, so a summary
 * built mid-typing (an incomplete or invalid amount) degrades to "no sign" rather than crashing the dialog. */
function safeParseAmount(amount: string, precision: number): number | null {
  if (amount.trim() === "") return null;
  try { return -parseMajorUnits(amount, precision); } catch { return null; }
}

/** A draft's presence check only -- never a sum (section 6.3 item 1). Blocks submission until every field an
 * empty request would be refused for is actually filled (CBD-202-AC02). */
function isDraftComplete(draft: { accountId: string; amount: string; budgetDate: string; allocationAmounts: readonly string[] }): boolean {
  return draft.accountId !== "" && draft.amount.trim() !== "" && draft.budgetDate.trim() !== "" && draft.allocationAmounts.some(amount => amount.trim() !== "");
}

interface TransactionSummary {
  description: string | null;
  amount: string;
  direction: AmountDirection;
  currencyCode: string;
  categories: readonly { label: string; amount: string; direction: AmountDirection }[];
}

function ImpactSummaryBody({ summary }: { summary: TransactionSummary }) {
  return <dl className="space-y-2 text-on-surface-muted">
    <div><dt className="font-semibold">Description</dt><dd>{summary.description ?? "No description"}</dd></div>
    <div><dt className="font-semibold">Amount</dt><dd>{amountWords(summary.amount, summary.direction, summary.currencyCode)}</dd></div>
    <div>
      <dt className="font-semibold">Categories for this transaction</dt>
      <dd><ul>{summary.categories.map(category => <li key={category.label}>{category.label}: {amountWords(category.amount, category.direction, summary.currencyCode)}</li>)}</ul></dd>
    </div>
  </dl>;
}

/** A `Dialog` naming the transaction, its amount and its categories before a removal or a material-impact edit
 * (CBD-202-AC03): every value shown here is one the caller already entered or already read, never a new one
 * ("exposing no value the caller could not already read"). The trigger button, the dialog and the confirmed
 * action are one component, following `accounts-view.tsx`'s `ConfirmDialog` precedent. */
function ImpactConfirm({ triggerLabel, triggerDisabled, title, summary, confirmLabel, confirmVariant = "primary", act, onSuccess, onDenied, onInvalid, refresh }: {
  triggerLabel: string; triggerDisabled?: boolean; title: string; summary: TransactionSummary;
  confirmLabel: string; confirmVariant?: "primary" | "danger";
  act(): Promise<void>; onSuccess(): void; onDenied(message: string): void;
  /** REV-UIP03-1: a 400 the underlying form can fix by changing a named field. Called only after the dialog
   * is fully closed, so the field it names is reachable -- a modal `<dialog>` makes everything behind it inert,
   * and `.focus()` on an inert element is silently refused (worse than doing nothing: the field then cannot
   * even be reached by Tab until something else moves focus first). */
  onInvalid?(report: TransactionErrorReport): void;
  refresh(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<TransactionErrorReport>();

  async function confirm() {
    setBusy(true); setReport(undefined);
    try {
      await act();
      ref.current?.close();
      onSuccess();
    } catch (error) {
      const failure = reportTransactionError(error);
      if (failure.kind === "denied") {
        // REV-UIP02-6/7's fix, followed here: a denied mutation's re-read can succeed even though the write
        // did not, and that re-read can unmount this dialog before its own report is ever painted. Report it
        // through the caller's page-level status region instead.
        ref.current?.close();
        onDenied(failure.summary);
      } else if (failure.kind === "validation" && onInvalid) {
        // REV-UIP03-1: close first, exactly like the `denied` branch above, so the field `onInvalid` focuses
        // is no longer behind an inert modal.
        ref.current?.close();
        onInvalid(failure);
      } else {
        setReport(failure);
      }
    } finally { setBusy(false); }
  }

  return <>
    <Button variant="secondary" disabled={triggerDisabled} onClick={() => { setReport(undefined); ref.current?.showModal(); }}>{triggerLabel}</Button>
    <dialog ref={ref} aria-label={title} className="m-auto w-[min(100%,32rem)] rounded-lg border border-border bg-surface-raised p-6 text-on-surface shadow-overlay backdrop:bg-on-surface/60">
      <h2 className="mb-3 font-display text-xl font-semibold">{title}</h2>
      <div className="mb-4"><ImpactSummaryBody summary={summary} /></div>
      {/* CBD-200-AC04, no-overwrite: a stale version and any other conflict are reviewed, never resubmitted
         over silently. "Review the current version" reloads everything below (closing this dialog with it);
         "Try again" only clears this report so the same values may be confirmed again. */}
      {report && <p role="alert" className="mb-4 font-semibold text-danger">{report.summary}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => ref.current?.close()}>Cancel</Button>
        {(report?.kind === "stale" || report?.kind === "conflict") && <Button type="button" variant="secondary" onClick={() => { refresh(); ref.current?.close(); }}>Review the current version</Button>}
        {report?.kind === "stale" && <Button type="button" variant="secondary" onClick={() => setReport(undefined)}>Try again</Button>}
        <Button type="button" variant={confirmVariant} loading={busy} onClick={() => void confirm()}>{confirmLabel}</Button>
      </div>
    </dialog>
  </>;
}

interface EditorDraftState {
  accountId: string; amount: string; budgetDate: string; description: string; allocations: Record<string, string>;
}
/** REV-UIP03-7: the same `directionOf` the list rows already use (`transactions.ts`'s `toTransactionRow`),
 * applied to the same negation `toExpenseBody` will actually submit -- never a hardcoded "spend" and never a
 * fabricated "0.00" for an amount not yet (or no longer) typed. `precision` is needed to parse the typed
 * major-unit string the same way the write itself will. */
function summaryOf(state: EditorDraftState, categories: readonly Category[], currencyCode: string, precision: number): TransactionSummary {
  const parsedAmount = safeParseAmount(state.amount, precision);
  return {
    description: state.description.trim() === "" ? null : state.description,
    amount: state.amount, direction: parsedAmount === null ? "zero" : directionOf(parsedAmount), currencyCode,
    categories: categories
      .filter(category => (state.allocations[category.id] ?? "").trim() !== "")
      .map(category => {
        const raw = state.allocations[category.id]!;
        const parsed = safeParseAmount(raw, precision);
        return { label: category.name, amount: raw, direction: parsed === null ? "zero" as const : directionOf(parsed) };
      }),
  };
}
function draftOf(state: EditorDraftState, categories: readonly Category[]): ExpenseDraft {
  return {
    accountId: state.accountId, amount: state.amount, budgetDate: state.budgetDate, description: state.description,
    allocations: categories
      .filter(category => (state.allocations[category.id] ?? "").trim() !== "")
      .map(category => ({ categoryId: category.id, amount: state.allocations[category.id]! })),
  };
}

/** The amount/date/account/description/allocation fields shared by create and edit (CBD-202-AC01). */
function TransactionFields({ prefix, loaded, live, state, setState, errors }: {
  prefix: string; loaded: Loaded; live: readonly Account[]; state: EditorDraftState; setState(update: (current: EditorDraftState) => EditorDraftState): void; errors: Record<string, string>;
}) {
  return <>
    <div className="grid gap-4 sm:grid-cols-2">
      <Select id={`transaction-${prefix}-account`} label="Account" value={state.accountId} onChange={event => setState(current => ({ ...current, accountId: event.target.value }))} error={errors.accountId}>
        {live.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}
      </Select>
      <Input id={`transaction-${prefix}-date`} label="Budget date (YYYY-MM-DD)" value={state.budgetDate} onChange={event => setState(current => ({ ...current, budgetDate: event.target.value }))} error={errors.budgetDate} />
      <Input id={`transaction-${prefix}-amount`} label={`Amount (${loaded.currencyCode})`} inputMode="decimal" value={state.amount} onChange={event => setState(current => ({ ...current, amount: event.target.value }))} error={errors.amount} />
      <Input id={`transaction-${prefix}-description`} label="Description (optional)" value={state.description} onChange={event => setState(current => ({ ...current, description: event.target.value }))} error={errors.description} />
    </div>
    {/* AllocationSummary: the entered/known amounts, plus the server's own remainder -- its refusal message
       when the categories do not add up to the amount, never a client-computed total (see the module header). */}
    <fieldset id={`transaction-${prefix}-allocations`} tabIndex={-1} className="space-y-3 rounded-lg border border-border p-4">
      <legend className="font-semibold">Categories for this transaction</legend>
      <p id={`transaction-${prefix}-allocations-hint`}>Allocating spreads this transaction across categories. Allocating is not reconciliation.</p>
      {errors.allocations && <p role="alert" className="font-semibold text-danger">{errors.allocations}</p>}
      <div className="flex flex-wrap items-end gap-3">
        {loaded.categories.map(category => <Input key={category.id} id={`transaction-${prefix}-allocation-${category.id}`} label={`${category.name} (${loaded.currencyCode})`} inputMode="decimal"
          aria-describedby={`transaction-${prefix}-allocations-hint`} value={state.allocations[category.id] ?? ""}
          onChange={event => setState(current => ({ ...current, allocations: { ...current.allocations, [category.id]: event.target.value } }))} />)}
      </div>
    </fieldset>
  </>;
}

/** Creation: no `ImpactConfirm` (section 6.4's binding note above -- only an edit or a removal shows one),
 * submitted directly like `spending.tsx`'s `ExpenseSection`. */
function CreateTransactionForm({ id, loaded, announce, refresh }: { id: string; loaded: Loaded; announce(message: string): void; refresh(): void }) {
  const { api } = useSession();
  const live = loaded.accounts.filter(account => !account.archived);
  const [state, setState] = useState<EditorDraftState>({ accountId: live[0]?.id ?? "", amount: "", budgetDate: "", description: "", allocations: {} });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submissionKey = useRef(new SubmissionKey()).current;
  const complete = isDraftComplete({ accountId: state.accountId, amount: state.amount, budgetDate: state.budgetDate, allocationAmounts: Object.values(state.allocations) });

  async function submit() {
    setBusy(true); setErrors({}); announce("");
    const key = submissionKey.next();
    try {
      await api.recordExpense(id, draftOf(state, loaded.categories), loaded.precision, key);
      submissionKey.settle(true);
      setState({ accountId: live[0]?.id ?? "", amount: "", budgetDate: "", description: "", allocations: {} });
      announce(transactionAnnouncement("recorded"));
      refresh();
    } catch (error) {
      submissionKey.settle(error instanceof ApiError);
      const report = reportTransactionError(error);
      setErrors(report.fields); announce(report.summary);
      focusFirstInvalid("create", report.fields);
    } finally { setBusy(false); }
  }

  if (live.length === 0) return <Alert>Add a live account before recording a transaction.</Alert>;
  if (loaded.categories.length === 0) return <Alert>Add a category to the plan before recording a transaction.</Alert>;
  return <form aria-labelledby="transaction-create-heading" className="space-y-4 rounded-lg border border-border p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h3 id="transaction-create-heading" className="text-xl font-semibold">Record a transaction</h3>
    <TransactionFields prefix="create" loaded={loaded} live={live} state={state} setState={setState} errors={errors} />
    <Button type="submit" loading={busy} disabled={!complete}>Record transaction</Button>
  </form>;
}

/** Edit: every submission goes through `ImpactConfirm` (this packet's broad reading of "material-impact edit",
 * recorded in the module header). Basis is the version this view was built from (CBD-200-AC04); a stale
 * refusal is reviewed, never overwritten. */
function EditTransactionForm({ id, loaded, basis, onDone, announce, refresh }: {
  id: string; loaded: Loaded; basis: TransactionRow; onDone(): void; announce(message: string): void; refresh(): void;
}) {
  const { api } = useSession();
  const live = loaded.accounts.filter(account => !account.archived || account.id === basis.accountId);
  const [state, setState] = useState<EditorDraftState>({
    accountId: basis.accountId, amount: basis.amount, budgetDate: basis.budgetDate, description: basis.description ?? "",
    allocations: Object.fromEntries(basis.allocations.map(allocation => [allocation.categoryId, allocation.amount])),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submissionKey = useRef(new SubmissionKey()).current;
  const complete = isDraftComplete({ accountId: state.accountId, amount: state.amount, budgetDate: state.budgetDate, allocationAmounts: Object.values(state.allocations) });

  return <div aria-labelledby="transaction-edit-heading" className="space-y-4 rounded-lg border border-border p-4">
    <h3 id="transaction-edit-heading" className="text-xl font-semibold">Edit this transaction</h3>
    <TransactionFields prefix="edit" loaded={loaded} live={live} state={state} setState={setState} errors={errors} />
    <div className="flex flex-wrap gap-3">
      <ImpactConfirm
        triggerLabel="Save changes" triggerDisabled={!complete} title="Save changes to this transaction?"
        summary={summaryOf(state, loaded.categories, loaded.currencyCode, loaded.precision)}
        confirmLabel="Confirm and save changes"
        act={async () => {
          const key = submissionKey.next();
          try {
            await api.editExpense(id, basis.transactionId, draftOf(state, loaded.categories), loaded.precision, basis.transactionVersionId, key);
            submissionKey.settle(true);
          } catch (error) {
            submissionKey.settle(error instanceof ApiError);
            throw error;
          }
        }}
        onSuccess={() => { setErrors({}); announce(transactionAnnouncement("updated")); focusTransactionsHeading(); onDone(); refresh(); }}
        onDenied={message => { announce(message); focusTransactionsHeading(); onDone(); refresh(); }}
        onInvalid={report => { setErrors(report.fields); announce(report.summary); focusFirstInvalid("edit", report.fields); }}
        refresh={refresh}
      />
      <Button variant="secondary" onClick={onDone}>Cancel</Button>
    </div>
  </div>;
}

function RemoveTransactionControl({ id, transaction, loaded, announce, refresh }: {
  id: string; transaction: TransactionRow; loaded: Loaded; announce(message: string): void; refresh(): void;
}) {
  const { api } = useSession();
  const summary: TransactionSummary = {
    description: transaction.description, amount: transaction.amount, direction: transaction.direction, currencyCode: loaded.currencyCode,
    categories: transaction.allocations.map(allocation => ({ label: categoryLabel(loaded.categories, allocation.categoryId), amount: allocation.amount, direction: allocation.direction })),
  };
  return <ImpactConfirm
    triggerLabel={`Remove ${transaction.description ?? "this transaction"}`}
    title="Remove this transaction?"
    summary={summary}
    confirmLabel="Remove transaction"
    confirmVariant="danger"
    act={() => api.removeExpense(id, transaction.transactionId, transaction.transactionVersionId)}
    onSuccess={() => { announce(transactionAnnouncement("removed")); focusTransactionsHeading(); refresh(); }}
    onDenied={message => { announce(message); focusTransactionsHeading(); refresh(); }}
    refresh={refresh}
  />;
}

const COLUMNS: readonly Column[] = [
  { key: "date", label: "Date" },
  { key: "description", label: "Description" },
  { key: "account", label: "Account" },
  { key: "categories", label: "Categories" },
  { key: "amount", label: "Amount", numeric: true },
  { key: "actions", label: "Actions" },
];

function TransactionsBody({ id, loaded, announce, refresh }: { id: string; loaded: Loaded; announce(message: string): void; refresh(): void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const active = loaded.transactions.filter(transaction => !transaction.removed);
  const editing = editingId ? active.find(transaction => transaction.transactionId === editingId) ?? null : null;
  const rows = active.map(transaction => ({
    date: transaction.budgetDate,
    description: transaction.description ?? "No description",
    account: accountLabel(loaded.accounts, transaction.accountId),
    categories: transaction.allocations.map(allocation => `${categoryLabel(loaded.categories, allocation.categoryId)}: ${amountWords(allocation.amount, allocation.direction, loaded.currencyCode)}`).join(", "),
    amount: amountWords(transaction.amount, transaction.direction, loaded.currencyCode),
    actions: <div className="flex flex-wrap gap-3">
      <Button variant="secondary" onClick={() => setEditingId(transaction.transactionId)}>Edit {transaction.description ?? "this transaction"}</Button>
      <RemoveTransactionControl id={id} transaction={transaction} loaded={loaded} announce={announce} refresh={refresh} />
    </div>,
  }));
  return <section className="space-y-8">
    <section aria-labelledby="transactions-list-heading" className="space-y-4">
      <h2 id="transactions-list-heading" className="text-2xl font-semibold">Transactions this period</h2>
      {active.length === 0
        ? <Alert title="No transactions yet">No transactions yet. Record one below.</Alert>
        : <Table caption="Manual transactions for this budget and period" columns={COLUMNS} rows={rows} emptyMessage="No transactions this period." />}
    </section>
    {editing
      ? <EditTransactionForm key={editing.transactionId} id={id} loaded={loaded} basis={editing} onDone={() => setEditingId(null)} announce={announce} refresh={refresh} />
      : <CreateTransactionForm id={id} loaded={loaded} announce={announce} refresh={refresh} />}
  </section>;
}

export function TransactionsView({ id }: { id: string }) {
  const { api, session } = useSession();
  const transactionsApi = useTransactionsClient();
  const [state, setState] = useState<{ value?: Loaded; error?: unknown }>();
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  // Inlined exactly as `spending.tsx`'s `CategoryDetailView` reads its own data (never a `useCallback` the
  // effect then invokes): an extracted callback whose body calls `setState` is what
  // `react-hooks/set-state-in-effect` flags as a synchronous-in-effect update, even though this one is no
  // more synchronous than `useResource`'s own `load(signal).then(...)`. The IIFE form avoids the false
  // positive without changing the cancellation semantics below.
  useEffect(() => {
    const abort = new AbortController();
    const request = ++sequence.current;
    void (async () => {
      try {
        const budget = await api.budget(id, abort.signal);
        const periodId = budget.activePeriod?.id;
        if (!periodId) { if (request === sequence.current) setState({ error: new ApiError(409, "no_active_period") }); return; }
        const [accounts, plan, list] = await Promise.all([
          api.listAccounts(id, abort.signal),
          api.plan(id, periodId, abort.signal),
          transactionsApi.list(id, periodId, abort.signal),
        ]);
        if (abort.signal.aborted || request !== sequence.current) return;
        setState({ value: { periodId, currencyCode: plan.currencyCode, precision: plan.minorUnitPrecision, accounts, categories: plan.categories, transactions: list.transactions } });
      } catch (error) {
        if (!abort.signal.aborted && request === sequence.current) setState({ error });
      }
    })();
    return () => abort.abort();
  }, [api, id, transactionsApi, revision, session.sessionRef, session.sessionVersion]);
  const refresh = useCallback(() => { sequence.current++; setState(undefined); setRevision(value => value + 1); }, []);

  const [status, setStatus] = useState("");
  const announce = useCallback((message: string) => setStatus(message), []);

  return <section className="space-y-6">
    <h1 id="transactions-heading" tabIndex={-1} className="font-display text-3xl font-semibold">Transactions</h1>
    <StatusRegion id="transactions" message={status} />
    {state?.error ? <TransactionsFailure error={state.error} retry={refresh} />
      : !state?.value ? <>
        <Alert loading>Loading transactions…</Alert>
        <Table caption="Manual transactions for this budget and period" columns={COLUMNS} rows={[]} loading />
      </>
      : <TransactionsBody id={id} loaded={state.value} announce={announce} refresh={refresh} />}
  </section>;
}
