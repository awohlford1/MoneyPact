"use client";
// CBD-198 (AC01-AC05), verification concerns CBD-195: the manual accounts lifecycle -- list, detail,
// create/edit and archive/restore with confirmation, against the API and mock that already exist
// (`listAccounts`/`addAccount`/`editAccount`/`archiveAccount`/`restoreAccount`; PROTO-INCREMENT-B-001).
// Form state, cancellable reads, dialogs and status announcements require client state.
//
// Nothing here restates a rule the API owns: every refusal is the server's own canonical code, mapped
// through `fieldErrorFor`/`reportAccountError`, and every figure shown is the API's own value, already a
// formatted string on `Account` (`formatMinorUnits` in `client.ts`) -- this module does no arithmetic on
// money (CBD-198-AC01).
//
// CBD-198 deviation, recorded rather than silently chosen: the dashboard's embedded "Accounts and
// spending" section (`spending.tsx`, UI-P01/dashboard territory, out of this packet's scope) already lets
// a person add, rename, archive and restore an account inline. This route is the dedicated CBD-198
// surface the ticket asks for and covers every state its acceptance criteria name (all-archived-empty,
// stale/409 as a conflict rather than a validation error, permission-denied with controls absent,
// focus management); the two surfaces are not reconciled here, and it is possible for either to be used
// for the same accounts. Recorded as a finding for the Manager, not treated as a defect to fix by editing
// `spending.tsx`, which is off-limits to this packet.
import { useCallback, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import NextLink from "next/link";
import type { Account } from "../../../../../api/client";
import { ACCOUNT_TYPES, accountAnnouncement, accountStateLabel, accountTypeLabel, reportAccountError } from "../../../../../api/accounts-presentation";
import type { AccountErrorReport, AccountType } from "../../../../../api/accounts-presentation";
import { useSession } from "../../../../../session/SessionProvider";
import { Alert } from "../../../../../components/Alert";
import { Button } from "../../../../../components/Button";
import { Checkbox } from "../../../../../components/Choice";
import { Input } from "../../../../../components/Input";
import { Link } from "../../../../../components/Link";
import { Select } from "../../../../../components/Select";
import { Table } from "../../../../../components/Table";
import type { Column } from "../../../../../components/Table";
// CBD-35: the polite live region, the uniform denied-access notice and the failure classifier are shared
// shapes, not this module's own copies.
import { DeniedState, EmptyState, StatusRegion, classifyFailure, useResource } from "../../../../../ui/resource";

function accountsRoute(id: string): string {
  return `/budgets/${encodeURIComponent(id)}/accounts`;
}
function accountRoute(id: string, accountId: string): string {
  return `${accountsRoute(id)}/${encodeURIComponent(accountId)}`;
}

/** The three distinct read failures (CBD-67 SS14.6, by analogy; CBD-198-AC03): permission-denied removes
 * every control on this surface rather than disabling it, a terminal failure names the accounts as
 * unavailable, and a recoverable one offers "Try again". Copy of its own, not `ui/resource`'s `Failure`,
 * because that component's wording is the budget's, not the accounts surface's. */
function AccountsFailure({ error, retry }: { error: unknown; retry(): void }) {
  const kind = classifyFailure(error);
  if (kind === "denied") return <DeniedState>
    <p>Your current session cannot open the accounts for this budget.</p>
  </DeniedState>;
  return <Alert tone="danger" title={kind === "terminal" ? "Accounts unavailable" : "Unable to load accounts"}>
    <p>{kind === "terminal" ? "The accounts for this budget cannot be opened from this link." : "We could not load the accounts for this budget."}</p>
    {kind !== "terminal" && <Button variant="secondary" onClick={retry}>Try again</Button>}
  </Alert>;
}

const FIELD_ID: Readonly<Record<string, string>> = Object.freeze({
  label: "account-create-label", accountType: "account-create-type", currencyCode: "account-create-currency", amount: "account-create-opening",
});
/** Moves focus to the first invalid field and leaves every other entered value untouched (CBD-198-AC02). Looked
 * up by element id rather than a ref, so a field that a validation error never touches keeps its own focus. */
function focusFirstInvalid(fields: Readonly<Record<string, string>>, idOf: Readonly<Record<string, string>> = FIELD_ID): void {
  for (const path of Object.keys(idOf)) if (fields[path]) { document.getElementById(idOf[path]!)?.focus(); return; }
}

function CreateAccountForm({ id, announce, created }: { id: string; announce(message: string): void; created(): void }) {
  const { api } = useSession();
  const [label, setLabel] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("checking");
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setErrors({});
    try {
      const account = await api.addAccount(id, { label, accountType, currencyCode, openingBalance });
      setLabel(""); setAccountType("checking"); setOpeningBalance("0");
      announce(accountAnnouncement("added", account.label));
      created();
    } catch (error) {
      const report = reportAccountError(error);
      setErrors(report.fields); announce(report.summary);
      focusFirstInvalid(report.fields);
    } finally { setBusy(false); }
  }

  return <form aria-labelledby="add-account-heading" className="space-y-4 rounded-lg border border-border p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h2 id="add-account-heading" className="text-xl font-semibold">Add a manual account</h2>
    <p>A manual account is one you add yourself, to record spending against it. MoneyPact does not connect to a bank or move money for any account here.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <Input id="account-create-label" label="Account name" value={label} onChange={event => setLabel(event.target.value)} error={errors.label} />
      <Select id="account-create-type" label="Account type" value={accountType} onChange={event => setAccountType(event.target.value as AccountType)} error={errors.accountType}>
        {ACCOUNT_TYPES.map(type => <option key={type} value={type}>{accountTypeLabel(type)}</option>)}
      </Select>
      <Select id="account-create-currency" label="Currency" value={currencyCode} onChange={event => setCurrencyCode(event.target.value)} error={errors.currencyCode}>
        <option value="USD">USD</option>
      </Select>
      <Input id="account-create-opening" label="Opening balance" inputMode="decimal" value={openingBalance} onChange={event => setOpeningBalance(event.target.value)} error={errors.amount} />
    </div>
    <Button type="submit" loading={busy}>Add account</Button>
  </form>;
}

/** Confirmation for archive and restore (CBD-198-AC02, CBD-72 row 36). A native `<dialog>`, matching the
 * shared `Dialog` component's shell, built locally because a confirmation needs its own confirm action and
 * busy/error state that `Dialog`'s fixed single dismiss button does not carry. `showModal`/`close` are the
 * platform's, including returning focus to the button that opened it when the dialog closes -- cancelling
 * or a successful confirm both close it, so that holds for every exit. */
function ConfirmDialog({ triggerLabel, title, children, confirmLabel, confirmVariant = "primary", act, onConflictRefresh }: {
  triggerLabel: string; title: string; children: ReactNode; confirmLabel: string; confirmVariant?: "primary" | "danger";
  act(): Promise<void>; onConflictRefresh(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<AccountErrorReport>();

  async function confirm() {
    setBusy(true); setReport(undefined);
    try { await act(); ref.current?.close(); }
    catch (error) { setReport(reportAccountError(error)); }
    finally { setBusy(false); }
  }

  return <>
    <Button variant="secondary" onClick={() => { setReport(undefined); ref.current?.showModal(); }}>{triggerLabel}</Button>
    <dialog ref={ref} aria-labelledby={titleId} className="m-auto w-[min(100%,28rem)] rounded-lg border border-border bg-surface-raised p-6 text-on-surface shadow-overlay backdrop:bg-on-surface/60">
      <h2 id={titleId} className="mb-3 font-display text-xl font-semibold">{title}</h2>
      <div className="mb-4 space-y-3 text-on-surface-muted">{children}</div>
      {/* CBD-198-AC02/AC03 stale/409: the mock's account routes send no client-stated version precondition,
         so every 409 is a fact that changed underneath this dialog -- never a value to correct and resubmit --
         and the review offered is "refresh and look", never a silent overwrite. */}
      {report && <p role="alert" className="mb-4 font-semibold text-danger">{report.summary}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => ref.current?.close()}>Cancel</Button>
        {report?.kind === "conflict" && <Button type="button" variant="secondary" onClick={() => { onConflictRefresh(); ref.current?.close(); }}>Refresh and review the current account</Button>}
        <Button type="button" variant={confirmVariant} loading={busy} onClick={() => void confirm()}>{confirmLabel}</Button>
      </div>
    </dialog>
  </>;
}

/** Archive when live, restore when archived -- never both, since an account is exactly one of the two (CBD-72
 * row 36). Shared by the list row and the detail page, so the two never word the confirmation differently. */
function ArchiveOrRestoreControl({ id, account, announce, refresh }: { id: string; account: Account; announce(message: string): void; refresh(): void }) {
  const { api } = useSession();
  if (account.archived) {
    return <ConfirmDialog
      triggerLabel={`Restore ${account.label}`}
      title={`Restore ${account.label}?`}
      confirmLabel="Restore account"
      onConflictRefresh={refresh}
      act={async () => { const restored = await api.restoreAccount(id, account.id); announce(accountAnnouncement("restored", restored.label)); refresh(); }}
    >
      <p>Restoring <bdi>{account.label}</bdi> brings it back to ordinary views, search, reports and totals.</p>
    </ConfirmDialog>;
  }
  return <ConfirmDialog
    triggerLabel={`Archive ${account.label}`}
    title={`Archive ${account.label}?`}
    confirmLabel="Archive account"
    confirmVariant="danger"
    onConflictRefresh={refresh}
    act={async () => { const archived = await api.archiveAccount(id, account.id); announce(accountAnnouncement("archived", archived.label)); refresh(); }}
  >
    <p>Archiving <bdi>{account.label}</bdi> removes it from ordinary views, search, reports and totals. Its transaction and audit history is kept, and you can restore it later.</p>
  </ConfirmDialog>;
}

function AccountRowActions({ id, account, announce, refresh }: { id: string; account: Account; announce(message: string): void; refresh(): void }) {
  return <div className="flex flex-wrap gap-3">
    {!account.archived && <Link href={accountRoute(id, account.id)}>Edit {account.label}</Link>}
    <ArchiveOrRestoreControl id={id} account={account} announce={announce} refresh={refresh} />
  </div>;
}

const COLUMNS: readonly Column[] = [
  { key: "label", label: "Label" },
  { key: "type", label: "Type" },
  { key: "currency", label: "Currency" },
  { key: "opening", label: "Opening balance", numeric: true },
  { key: "state", label: "State" },
  { key: "actions", label: "Actions" },
];

function AccountsBody({ id, accounts, showArchived, setShowArchived, announce, refresh }: {
  id: string; accounts: readonly Account[]; showArchived: boolean; setShowArchived(value: boolean): void;
  announce(message: string): void; refresh(): void;
}) {
  // Three distinct emptinesses (CBD-67 SS14.6, applied by analogy): true-empty (no account was ever added),
  // all-archived (every account exists but none is live -- never rendered as the same "nothing here" as
  // true-empty), and populated. All-archived forces the toggle on, per the plan's states table, so the
  // person immediately sees the accounts the message is about rather than an empty table underneath it.
  const allArchived = accounts.length > 0 && accounts.every(account => account.archived);
  const effectiveShowArchived = showArchived || allArchived;
  const visible = effectiveShowArchived ? accounts : accounts.filter(account => !account.archived);
  const rows = visible.map(account => ({
    label: <NextLink className="text-interactive underline" href={accountRoute(id, account.id)}><bdi className="break-words">{account.label}</bdi></NextLink>,
    type: accountTypeLabel(account.accountType),
    currency: account.currencyCode,
    opening: `${account.openingBalance} ${account.currencyCode}`,
    state: accountStateLabel(account),
    actions: <AccountRowActions id={id} account={account} announce={announce} refresh={refresh} />,
  }));
  return <section aria-labelledby="accounts-list-heading" className="space-y-4">
    <h2 id="accounts-list-heading" className="text-2xl font-semibold">Your accounts</h2>
    {accounts.length > 0 && <Checkbox id="accounts-show-archived" label="Show archived accounts" checked={effectiveShowArchived} disabled={allArchived} onChange={event => setShowArchived(event.target.checked)} />}
    {accounts.length === 0
      ? <EmptyState title="No manual accounts yet">No manual accounts yet. Add one below to record spending against it.</EmptyState>
      : <>
        {/* All-archived is distinct from true-empty (CBD-67 SS14.6 by analogy): the account list is not
           empty, so the table below still shows every one of them -- the toggle above is already on -- and
           this notice says why none of them is available to record against right now. */}
        {allArchived && <Alert title="Every account here is archived">Every account here is archived. Restore one to record against it again.</Alert>}
        <Table caption={`Manual accounts in this budget${effectiveShowArchived ? ", including archived accounts" : ""}`} columns={COLUMNS} rows={rows} emptyMessage="No active accounts. Show archived accounts to see the ones you have archived." />
      </>}
    <CreateAccountForm id={id} announce={announce} created={refresh} />
  </section>;
}

export function AccountsView({ id }: { id: string }) {
  const { api, session } = useSession();
  const load = useCallback((signal: AbortSignal) => api.listAccounts(id, signal), [api, id]);
  const list = useResource(`${session.sessionRef}:${session.sessionVersion}:${id}`, load);
  const [showArchived, setShowArchived] = useState(false);
  // The live region belongs to this component, not to the table or forms below it: a mutation reloads the
  // list, which unmounts `AccountsBody` while the read is in flight, and an announcement held inside it
  // would disappear before it was read. Rendered in every branch for the same reason (CBD-198-AC02).
  const [status, setStatus] = useState("");
  const announce = useCallback((message: string) => setStatus(message), []);

  return <section className="space-y-6">
    <h1 className="font-display text-3xl font-semibold">Manual accounts</h1>
    <StatusRegion id="accounts" message={status} />
    {list.error ? <AccountsFailure error={list.error} retry={list.refresh} />
      : !list.value ? <>
        <Alert loading>Loading accounts…</Alert>
        <Table caption="Manual accounts in this budget" columns={COLUMNS} rows={[]} loading />
      </>
      : <AccountsBody id={id} accounts={list.value} showArchived={showArchived} setShowArchived={setShowArchived} announce={announce} refresh={list.refresh} />}
  </section>;
}

function AccountEditor({ id, account, announce, refresh }: { id: string; account: Account; announce(message: string): void; refresh(): void }) {
  const { api } = useSession();
  const [label, setLabel] = useState(account.label);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setErrors({});
    try {
      const updated = await api.editAccount(id, account.id, { label });
      announce(accountAnnouncement("edited", updated.label));
      refresh();
    } catch (error) {
      const report = reportAccountError(error);
      setErrors(report.fields); announce(report.summary);
      if (report.fields.label) document.getElementById("account-edit-label")?.focus();
    } finally { setBusy(false); }
  }

  return <form aria-labelledby="edit-account-heading" className="space-y-4 rounded-lg border border-border p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h2 id="edit-account-heading" className="text-2xl font-semibold">Edit this account</h2>
    {/* CBD-198-AC01: only the name is sent to the API, because `editAccount` accepts only `label` (client.ts).
       The type, currency and opening balance are not restated as editable here -- that would be a client
       rule the API does not have. */}
    <p>Only the name can be changed here. The account type, currency and opening balance are set when an account is created and cannot be changed afterward.</p>
    <Input id="account-edit-label" label="Account name" value={label} onChange={event => setLabel(event.target.value)} error={errors.label} />
    <Button type="submit" loading={busy}>Save name</Button>
  </form>;
}

function AccountDetailBody({ id, account, announce, refresh }: { id: string; account: Account; announce(message: string): void; refresh(): void }) {
  return <>
    <dl className="grid gap-3 rounded-lg border border-border p-5 sm:grid-cols-2">
      <div><dt className="font-semibold">Label</dt><dd className="break-words"><bdi>{account.label}</bdi></dd></div>
      <div><dt className="font-semibold">Type</dt><dd>{accountTypeLabel(account.accountType)}</dd></div>
      <div><dt className="font-semibold">Currency</dt><dd>{account.currencyCode}</dd></div>
      <div><dt className="font-semibold">Opening balance</dt><dd>{account.openingBalance} {account.currencyCode}</dd></div>
      <div><dt className="font-semibold">State</dt><dd>{accountStateLabel(account)}</dd></div>
      <div><dt className="font-semibold">Account identity</dt><dd className="break-all">{account.id}</dd></div>
    </dl>
    {account.archived
      ? <p>This account is archived. Restore it to change its name.</p>
      : <AccountEditor id={id} account={account} announce={announce} refresh={refresh} />}
    <div className="flex flex-wrap gap-3">
      <ArchiveOrRestoreControl id={id} account={account} announce={announce} refresh={refresh} />
    </div>
  </>;
}

export function AccountDetailView({ id, accountId }: { id: string; accountId: string }) {
  const { api, session } = useSession();
  const load = useCallback((signal: AbortSignal) => api.listAccounts(id, signal), [api, id]);
  const list = useResource(`${session.sessionRef}:${session.sessionVersion}:${id}`, load);
  const [status, setStatus] = useState("");
  const announce = useCallback((message: string) => setStatus(message), []);

  return <section className="space-y-6">
    <h1 className="font-display text-3xl font-semibold">Account detail</h1>
    <NextLink className="text-interactive underline" href={accountsRoute(id)}>Back to accounts</NextLink>
    <StatusRegion id="account-detail" message={status} />
    {list.error ? <AccountsFailure error={list.error} retry={list.refresh} />
      : !list.value ? <Alert loading>Loading this account…</Alert>
      : (() => {
        const account = list.value.find(entry => entry.id === accountId);
        // Denials are uniform (CBD-243-AC07): whether this account never existed, belongs to another
        // budget, or was never in this list, the sentence is the same "no longer here", never a distinct
        // "not found" that would tell an unauthorized caller which is true.
        return account
          ? <AccountDetailBody id={id} account={account} announce={announce} refresh={list.refresh} />
          : <Alert tone="danger" title="Account unavailable"><p>This account is no longer here, or it is not yours to open.</p></Alert>;
      })()}
  </section>;
}
