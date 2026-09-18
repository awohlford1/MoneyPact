"use client";
/**
 * Savings goals (CBD-341 AC01-AC05; model CBD-338, ledger CBD-339, commands CBD-340; UI-BUILD-PLAN.md
 * section 4.5). Every figure this view renders is a pre-formatted string built once, in `../../../../../api/goals`,
 * from the API's own field (CBD-341-AC01). This module names no raw money field carried in the smallest currency
 * unit and applies no arithmetic to one -- `goals.test.ts`'s CBD-341-AC01 test greps this file's own source for
 * the wire vocabulary those fields share a suffix with, so this comment deliberately does not spell that suffix
 * out either. Every mutation body is built by a `goals.ts` helper (`goalDraftFromInputs`,
 * `contributionDraftFromInputs`) that takes plain strings in and hands an opaque draft out, and the target-
 * reduction check that decides whether an `ImpactConfirm` is owed (`wouldReduceBelowProgress`) lives there too.
 *
 * OQ-UI-16: this surface is mock-only. `mockMode` (the same flag `(app)/layout.tsx` already reads from
 * `@/api/runtime-mode` to show the "Local demonstration" banner) is the one existing mechanism this app uses to
 * tell a live build from the development mock at the route level, so the whole surface is gated on it before
 * either view makes a single network call: a live build never even constructs a `GoalsClient` or bootstraps its
 * CSRF value, and instead renders the honest, explicit "This part of MoneyPact is not connected yet." rather
 * than a 404 or an empty list that would imply there is nothing to show.
 */
import { useCallback, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import NextLink from "next/link";
import { ApiError } from "../../../../../api/client";
import {
  CONTRIBUTION_INTENT_SENTENCE, contributionDraftFromInputs, createGoalsClient, formatGoalTargetForEditing, goalDraftFromInputs,
  reportGoalError, toGoalRow, toLedgerRow, wouldReduceBelowProgress,
} from "../../../../../api/goals";
import type { GoalErrorReport, GoalRow, LedgerRow, WireGoal, WireGoalDetail } from "../../../../../api/goals";
import { mockMode, apiBase } from "@/api/runtime-mode";
import { useSession } from "../../../../../session/SessionProvider";
import { Alert } from "../../../../../components/Alert";
import { Button } from "../../../../../components/Button";
import { Input } from "../../../../../components/Input";
import { Table } from "../../../../../components/Table";
import type { Column } from "../../../../../components/Table";
import { DeniedState, EmptyState, StatusRegion, classifyFailure, useResource } from "../../../../../ui/resource";

// This surface's only currency today is USD at two decimal places, the same fixed precision
// `CreateAccountForm` assumes for an opening balance; a person never chooses it here.
const PRECISION = 2;
const STALE_AFTER_MS = 5 * 60 * 1000;

function goalsRoute(id: string): string { return `/budgets/${encodeURIComponent(id)}/goals`; }
function goalRoute(id: string, goalId: string): string { return `${goalsRoute(id)}/${encodeURIComponent(goalId)}`; }

function useGoalsClient() {
  return useMemo(() => createGoalsClient(apiBase), []);
}

/** Moves focus to the first invalid field, in the order `idOf` states, leaving every other entered value
 * untouched (section 6.1.5) -- the same one-line pattern `accounts-view.tsx`'s `focusFirstInvalid` uses,
 * reused here rather than re-derived, with each form supplying its own path-to-element-id map. */
function focusFirstInvalid(fields: Readonly<Record<string, string>>, idOf: Readonly<Record<string, string>>): void {
  for (const path of Object.keys(idOf)) if (fields[path]) { document.getElementById(idOf[path]!)?.focus(); return; }
}
const CREATE_GOAL_FIELD_ID: Readonly<Record<string, string>> = Object.freeze({ label: "goal-create-label", target: "goal-create-target", targetDate: "goal-create-target-date" });
const EDIT_GOAL_FIELD_ID: Readonly<Record<string, string>> = Object.freeze({ label: "goal-edit-label", target: "goal-edit-target", targetDate: "goal-edit-target-date" });
const CONTRIBUTION_FIELD_ID: Readonly<Record<string, string>> = Object.freeze({ amount: "contribution-amount", note: "contribution-note" });

/** True only for a lost response (no server answer at all) while the browser itself reports no connection --
 * never for an ordinary 4xx/5xx, which already has its own uniform state. Section 6.2.10: "offline" never means
 * cached data, so this branch renders no stale content of its own, only the fact and a retry/sign-out pair. */
function isOffline(error: unknown): boolean {
  return !(error instanceof ApiError) && typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine;
}

// ---------------------------------------------------------------------------
// OQ-UI-16: the mock-only unavailable state.
// ---------------------------------------------------------------------------

function UnavailableSurface() {
  return <section className="space-y-6">
    <h1 tabIndex={-1} className="font-display text-3xl font-semibold">Goals</h1>
    <Alert title="Not connected">This part of MoneyPact is not connected yet.</Alert>
  </section>;
}

// ---------------------------------------------------------------------------
// Shared failure/offline rendering.
// ---------------------------------------------------------------------------

function OfflineNotice({ retry, onSignOut }: { retry(): void; onSignOut(): void }) {
  return <Alert tone="danger" title="You appear to be offline">
    <p>Current financial information is unavailable while you are offline. Nothing you enter here is queued or sent until you are back online.</p>
    <div className="mt-2 flex flex-wrap gap-3">
      <Button variant="secondary" onClick={retry}>Try again</Button>
      <Button variant="secondary" onClick={onSignOut}>Sign out</Button>
    </div>
  </Alert>;
}

function GoalsFailure({ error, retry, onSignOut, label }: { error: unknown; retry(): void; onSignOut(): void; label: string }) {
  if (isOffline(error)) return <OfflineNotice retry={retry} onSignOut={onSignOut} />;
  const kind = classifyFailure(error);
  if (kind === "denied") return <DeniedState><p>Your current session cannot open {label}.</p></DeniedState>;
  return <Alert tone="danger" title={kind === "terminal" ? `${label} unavailable` : `Unable to load ${label}`}>
    <p>{kind === "terminal" ? `${label} cannot be opened from here. This may depend on something that changed or no longer exists.` : `We could not load ${label}. You can try again.`}</p>
    {kind !== "terminal" && <Button variant="secondary" onClick={retry}>Try again</Button>}
  </Alert>;
}

/** `dataAsOf` older than the threshold: a fact stated in text, not implied (section 6.2, "stale"). */
function isStale(dataAsOf: string | undefined): boolean {
  if (!dataAsOf) return false;
  const parsed = Date.parse(dataAsOf);
  return Number.isFinite(parsed) && Date.now() - parsed > STALE_AFTER_MS;
}
function StaleNotice({ dataAsOf }: { dataAsOf: string }) {
  return <Alert title="This may be out of date">This goal&rsquo;s figures were read as of {dataAsOf} and may not reflect a very recent change. Refresh to check.</Alert>;
}

// ---------------------------------------------------------------------------
// The list surface.
// ---------------------------------------------------------------------------
// REV-UIP05-2: no decorative progress bar. The plan's own text progress statement ("142.00 of 500.00 USD
// saved; 358.00 USD remaining") already satisfies section 4.5's requirement, and a bar would need a genuine
// server-computed proportion to avoid showing a fabricated figure to a sighted person -- the mock does not
// have one, and inventing a fixed 50%/100% split (as an earlier draft of this file did) is exactly the false
// claim about a money figure this surface exists to avoid making.

function CreateGoalForm({ id, announce, created }: { id: string; announce(message: string): void; created(): void }) {
  const api = useGoalsClient();
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const idempotency = useRef<string | undefined>(undefined);

  async function submit() {
    setBusy(true); setErrors({});
    idempotency.current ??= crypto.randomUUID();
    try {
      const draft = goalDraftFromInputs(label, target, targetDate, PRECISION);
      const goal = await api.create(id, draft, idempotency.current);
      idempotency.current = undefined;
      setLabel(""); setTarget(""); setTargetDate("");
      announce(`${goal.label} added.`);
      created();
    } catch (error) {
      if (error instanceof ApiError) idempotency.current = undefined;
      const report = reportGoalError(error);
      setErrors(report.fields); announce(report.summary);
      focusFirstInvalid(report.fields, CREATE_GOAL_FIELD_ID);
    } finally { setBusy(false); }
  }

  return <form aria-labelledby="add-goal-heading" className="space-y-4 rounded-lg border border-border p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h2 id="add-goal-heading" className="text-xl font-semibold">Add a savings goal</h2>
    <p>A savings goal tracks intent toward a target you choose. MoneyPact does not move money toward it, and nothing here draws automatically from income, balance or any category.</p>
    <div className="grid gap-4 sm:grid-cols-3">
      <Input id="goal-create-label" label="Goal name" value={label} onChange={event => setLabel(event.target.value)} error={errors.label} />
      <Input id="goal-create-target" label="Target amount" inputMode="decimal" value={target} onChange={event => setTarget(event.target.value)} error={errors.target} />
      <Input id="goal-create-target-date" label="Target date (optional)" type="date" value={targetDate} onChange={event => setTargetDate(event.target.value)} error={errors.targetDate} />
    </div>
    <Button type="submit" loading={busy}>Add goal</Button>
  </form>;
}

function GoalCard({ id, row, announce, refresh, focusHeading }: {
  id: string; row: GoalRow; announce(message: string): void; refresh(): void; focusHeading(): void;
}) {
  return <li className="space-y-3 rounded-lg border border-border p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-xl font-semibold"><NextLink className="text-interactive underline" href={goalRoute(id, row.goalId)}><bdi>{row.label}</bdi></NextLink></h3>
      <span className="font-semibold">{row.stateLabel}</span>
    </div>
    <p>{row.statement}</p>
    <dl className="grid grid-cols-2 gap-2 text-on-surface-muted sm:grid-cols-4">
      <div><dt className="font-semibold text-on-surface">Target</dt><dd>{row.target}</dd></div>
      <div><dt className="font-semibold text-on-surface">Saved</dt><dd>{row.progress}</dd></div>
      {row.remaining && <div><dt className="font-semibold text-on-surface">Remaining</dt><dd>{row.remaining}</dd></div>}
      {row.excess && <div><dt className="font-semibold text-on-surface">Excess</dt><dd>{row.excess}</dd></div>}
      <div><dt className="font-semibold text-on-surface">Target date</dt><dd>{row.targetDate ?? "No target date set"}</dd></div>
    </dl>
    <div className="flex flex-wrap gap-3">
      <NextLink className="text-interactive underline" href={goalRoute(id, row.goalId)}>Open {row.label}</NextLink>
      <ArchiveRestoreControl id={id} row={row} announce={announce} refresh={refresh} focusHeading={focusHeading} />
    </div>
  </li>;
}

function GoalsBody({ id, rows, announce, refresh, focusHeading }: {
  id: string; rows: readonly GoalRow[]; announce(message: string): void; refresh(): void; focusHeading(): void;
}) {
  return <section aria-labelledby="goals-list-heading" className="space-y-4">
    <h2 id="goals-list-heading" className="text-2xl font-semibold">Your goals</h2>
    {rows.length === 0
      ? <EmptyState title="No savings goals yet">No savings goals yet. Add one below to start tracking intent toward it.</EmptyState>
      : <ul className="space-y-4">{rows.map(row => <GoalCard key={row.goalId} id={id} row={row} announce={announce} refresh={refresh} focusHeading={focusHeading} />)}</ul>}
    <CreateGoalForm id={id} announce={announce} created={refresh} />
  </section>;
}

export function GoalsView({ id }: { id: string }) {
  if (!mockMode) return <UnavailableSurface />;
  return <GoalsViewConnected id={id} />;
}

function GoalsViewConnected({ id }: { id: string }) {
  const { session, logout } = useSession();
  const api = useGoalsClient();
  const load = useCallback((signal: AbortSignal) => api.list(id, signal), [api, id]);
  const list = useResource(`${session.sessionRef}:${session.sessionVersion}:${id}`, load);
  const [status, setStatus] = useState("");
  const announce = useCallback((message: string) => setStatus(message), []);
  const focusHeading = useCallback(() => document.getElementById("goals-heading")?.focus(), []);
  const rows = useMemo(() => list.value ? list.value.goals.map(toGoalRow) : [], [list.value]);

  return <section className="space-y-6">
    <h1 id="goals-heading" tabIndex={-1} className="font-display text-3xl font-semibold">Goals</h1>
    <StatusRegion id="goals" message={list.refreshed && !status ? "Goals refreshed." : status} />
    {list.error ? <GoalsFailure error={list.error} retry={list.refresh} onSignOut={() => void logout()} label="your goals" />
      : !list.value ? <>
        <Alert loading>Loading goals…</Alert>
        <Table caption="Your goals" columns={[{ key: "label", label: "Goal" }]} rows={[]} loading />
      </>
      : <GoalsBody id={id} rows={rows} announce={announce} refresh={list.refresh} focusHeading={focusHeading} />}
  </section>;
}

// ---------------------------------------------------------------------------
// Archive / restore (shared by the card and the detail page), with ImpactConfirm.
// ---------------------------------------------------------------------------

function ImpactConfirmDialog({ triggerLabel, title, children, confirmLabel, confirmVariant = "primary", act, onSuccess, onReport, refresh }: {
  triggerLabel: string; title: string; children: ReactNode; confirmLabel: string; confirmVariant?: "primary" | "danger";
  act(): Promise<void>; onSuccess(): void; onReport(report: GoalErrorReport): void; refresh(): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<GoalErrorReport>();

  async function confirm() {
    setBusy(true); setReport(undefined);
    try {
      await act();
      ref.current?.close();
      onSuccess();
    } catch (error) {
      const failure = reportGoalError(error);
      if (failure.kind === "revoked" || failure.kind === "denied") { ref.current?.close(); onReport(failure); refresh(); }
      else setReport(failure);
    } finally { setBusy(false); }
  }

  return <>
    <Button variant="secondary" onClick={() => { setReport(undefined); ref.current?.showModal(); }}>{triggerLabel}</Button>
    <dialog ref={ref} aria-labelledby={titleId} className="m-auto w-[min(100%,28rem)] rounded-lg border border-border bg-surface-raised p-6 text-on-surface shadow-overlay backdrop:bg-on-surface/60">
      <h2 id={titleId} className="mb-3 font-display text-xl font-semibold">{title}</h2>
      <div className="mb-4 space-y-3 text-on-surface-muted">{children}</div>
      {report && <p role="alert" className="mb-4 font-semibold text-danger">{report.summary}</p>}
      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => ref.current?.close()}>Cancel</Button>
        {report?.kind === "conflict" && <Button type="button" variant="secondary" onClick={() => { refresh(); ref.current?.close(); }}>Refresh and review the current goal</Button>}
        <Button type="button" variant={confirmVariant} loading={busy} onClick={() => void confirm()}>{confirmLabel}</Button>
      </div>
    </dialog>
  </>;
}

function ArchiveRestoreControl({ id, row, announce, refresh, focusHeading }: {
  id: string; row: GoalRow; announce(message: string): void; refresh(): void; focusHeading(): void;
}) {
  const api = useGoalsClient();
  const onSuccess = () => { focusHeading(); refresh(); };
  const onReport = (report: GoalErrorReport) => { announce(report.summary); focusHeading(); };
  if (row.archivedAt !== null) {
    return <ImpactConfirmDialog
      triggerLabel={`Restore ${row.label}`} title={`Restore ${row.label}?`} confirmLabel="Restore goal"
      refresh={refresh} onSuccess={onSuccess} onReport={onReport}
      act={async () => { const restored = await api.restore(id, row.goalId, row.version); announce(`${restored.label} restored.`); }}
    >
      <p>Restoring <bdi>{row.label}</bdi> brings it back to ordinary views. Its contribution history is kept exactly as it was.</p>
    </ImpactConfirmDialog>;
  }
  return <ImpactConfirmDialog
    triggerLabel={`Archive ${row.label}`} title={`Archive ${row.label}?`} confirmLabel="Archive goal" confirmVariant="danger"
    refresh={refresh} onSuccess={onSuccess} onReport={onReport}
    act={async () => { const archived = await api.archive(id, row.goalId, row.version); announce(`${archived.label} archived. Its contribution history is kept, and you can restore it later.`); }}
  >
    <p>Archiving <bdi>{row.label}</bdi> removes it from ordinary views. Its contribution history is kept, and you can restore it later. Nothing about a linked account, category or balance changes.</p>
  </ImpactConfirmDialog>;
}

// ---------------------------------------------------------------------------
// The detail surface: editor, contribution form, ledger.
// ---------------------------------------------------------------------------

function GoalEditor({ id, goal, announce, refresh }: { id: string; goal: WireGoal; announce(message: string): void; refresh(): void }) {
  const api = useGoalsClient();
  const [label, setLabel] = useState(goal.label);
  const [target, setTarget] = useState(formatGoalTargetForEditing(goal));
  const [targetDate, setTargetDate] = useState(goal.targetDate ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingReduction, setPendingReduction] = useState(false);
  const idempotency = useRef<string | undefined>(undefined);
  const reductionRef = useRef<HTMLDialogElement>(null);

  async function save() {
    setBusy(true); setErrors({});
    idempotency.current ??= crypto.randomUUID();
    try {
      const draft = goalDraftFromInputs(label, target, targetDate, PRECISION);
      const updated = await api.edit(id, goal.goalId, draft, goal.version, idempotency.current);
      idempotency.current = undefined;
      announce(`${updated.label} updated.`);
      refresh();
    } catch (error) {
      if (error instanceof ApiError) idempotency.current = undefined;
      const report = reportGoalError(error);
      setErrors(report.fields); announce(report.summary);
      if (report.kind === "revoked" || report.kind === "denied" || report.kind === "conflict") refresh();
      else focusFirstInvalid(report.fields, EDIT_GOAL_FIELD_ID);
    } finally { setBusy(false); }
  }

  function submit() {
    if (wouldReduceBelowProgress(goal, target)) { setPendingReduction(true); reductionRef.current?.showModal(); return; }
    void save();
  }

  if (goal.archivedAt !== null) return <p>This goal is archived. Restore it to change its name, target or target date.</p>;
  const row = toGoalRow(goal);

  return <form aria-labelledby="edit-goal-heading" className="space-y-4 rounded-lg border border-border p-4" onSubmit={event => { event.preventDefault(); submit(); }}>
    <h2 id="edit-goal-heading" className="text-2xl font-semibold">Edit this goal</h2>
    <div className="grid gap-4 sm:grid-cols-3">
      <Input id="goal-edit-label" label="Goal name" value={label} onChange={event => setLabel(event.target.value)} error={errors.label} />
      <Input id="goal-edit-target" label="Target amount" inputMode="decimal" value={target} onChange={event => setTarget(event.target.value)} error={errors.target} />
      <Input id="goal-edit-target-date" label="Target date (optional)" type="date" value={targetDate} onChange={event => setTargetDate(event.target.value)} error={errors.targetDate} />
    </div>
    <Button type="submit" loading={busy}>Save goal</Button>
    {/* ImpactConfirm for a target reduction below current progress (section 4.5's "target reduction below
       progress" state): a genuine modal, opened via `showModal`, so focus is trapped and Escape returns focus
       to the field that opened it, same as `ImpactConfirmDialog`'s own dialogs. */}
    <dialog ref={reductionRef} aria-label="Confirm a target below current progress" onClose={() => setPendingReduction(false)} className="m-auto w-[min(100%,28rem)] rounded-lg border border-border bg-surface-raised p-6 text-on-surface shadow-overlay backdrop:bg-on-surface/60">
      {pendingReduction && <>
        <h3 className="mb-3 font-display text-xl font-semibold">Set a lower target than what is already saved?</h3>
        <p className="mb-4 text-on-surface-muted">This goal already shows {row.progress} saved. Setting a lower target changes how this goal is described (it may show as completed or as exceeding its target); nothing about the recorded contributions themselves changes.</p>
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" onClick={() => reductionRef.current?.close()}>Cancel</Button>
          <Button type="button" onClick={() => { reductionRef.current?.close(); void save(); }}>Set the lower target</Button>
        </div>
      </>}
    </dialog>
  </form>;
}

function ContributionForm({ id, goal, announce, refresh }: { id: string; goal: WireGoal; announce(message: string): void; refresh(): void }) {
  const api = useGoalsClient();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const idempotency = useRef<string | undefined>(undefined);

  async function submit() {
    setBusy(true); setErrors({});
    idempotency.current ??= crypto.randomUUID();
    try {
      const draft = contributionDraftFromInputs(amount, note, PRECISION);
      const result = await api.contribute(id, goal.goalId, draft, goal.version, idempotency.current);
      idempotency.current = undefined;
      setAmount(""); setNote("");
      const updatedRow = toGoalRow(result.goal);
      announce(`Contribution recorded. ${updatedRow.progress} of ${updatedRow.target} saved.`);
      refresh();
    } catch (error) {
      if (error instanceof ApiError) idempotency.current = undefined;
      const report = reportGoalError(error);
      setErrors(report.fields); announce(report.summary);
      if (report.kind === "revoked" || report.kind === "denied" || report.kind === "conflict") refresh();
      else focusFirstInvalid(report.fields, CONTRIBUTION_FIELD_ID);
    } finally { setBusy(false); }
  }

  if (goal.archivedAt !== null) return null;

  return <form aria-labelledby="contribution-heading" className="space-y-4 rounded-lg border border-border p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <h2 id="contribution-heading" className="text-2xl font-semibold">Record a contribution</h2>
    {/* CBD-341-AC02, verbatim -- never paraphrased. */}
    <p>{CONTRIBUTION_INTENT_SENTENCE}</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <Input id="contribution-amount" label="Amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} error={errors.amount} />
      <Input id="contribution-note" label="Note (optional)" value={note} onChange={event => setNote(event.target.value)} error={errors.note} />
    </div>
    <Button type="submit" loading={busy}>Record a contribution</Button>
  </form>;
}

const LEDGER_COLUMNS: readonly Column[] = [
  { key: "amount", label: "Amount", numeric: true },
  { key: "recordedAt", label: "Recorded" },
  { key: "note", label: "Note" },
  { key: "state", label: "State" },
  { key: "actions", label: "Actions" },
];

function ReverseControl({ id, goal, entry, announce, refresh }: {
  id: string; goal: WireGoal; entry: LedgerRow; announce(message: string): void; refresh(): void;
}) {
  const api = useGoalsClient();
  // REV-UIP05-3: an archived goal refuses a reversal (consistent with edit/contribute), so the control is
  // absent here rather than present-and-failing.
  if (entry.reversed || goal.archivedAt !== null) return null;
  const row = toGoalRow(goal);
  return <ImpactConfirmDialog
    triggerLabel="Reverse" title="Reverse this contribution?" confirmLabel="Reverse contribution" confirmVariant="danger"
    refresh={refresh}
    onSuccess={() => { refresh(); }}
    onReport={report => { announce(report.summary); refresh(); }}
    act={async () => {
      const result = await api.reverseContribution(id, goal.goalId, entry.contributionId, goal.version, crypto.randomUUID());
      const updatedRow = toGoalRow(result.goal);
      announce(`Contribution of ${entry.amount} reversed. Progress before: ${row.progress}. Progress after: ${updatedRow.progress} of ${updatedRow.target}.`);
    }}
  >
    <p>Reversing this {entry.amount} contribution changes this goal&rsquo;s progress from {row.progress} back toward its target. The contribution stays in the ledger below, marked reversed -- it is not deleted.</p>
  </ImpactConfirmDialog>;
}

function Ledger({ id, goal, entries, announce, refresh }: {
  id: string; goal: WireGoal; entries: readonly LedgerRow[]; announce(message: string): void; refresh(): void;
}) {
  const rows = entries.map(entry => ({
    amount: entry.amount, recordedAt: entry.recordedAt, note: entry.note ?? "No note",
    state: entry.reversed ? `Reversed ${entry.reversedAt}` : "Recorded",
    actions: <ReverseControl id={id} goal={goal} entry={entry} announce={announce} refresh={refresh} />,
  }));
  return <section aria-labelledby="ledger-heading" className="space-y-4">
    <h2 id="ledger-heading" className="text-2xl font-semibold">Contribution ledger</h2>
    <Table caption={`Contributions recorded for ${goal.label}`} columns={LEDGER_COLUMNS} rows={rows} emptyMessage="No contributions recorded yet." />
  </section>;
}

function GoalDetailBody({ id, detail, announce, refresh }: { id: string; detail: WireGoalDetail; announce(message: string): void; refresh(): void }) {
  const row = toGoalRow(detail.goal);
  const ledgerRows = detail.ledger.map(entry => toLedgerRow(entry, detail.goal));
  const focusHeading = useCallback(() => document.getElementById("goal-detail-heading")?.focus(), []);
  return <>
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <p className="font-semibold">{row.stateLabel}</p>
      {isStale(row.dataAsOf) && <StaleNotice dataAsOf={row.dataAsOf} />}
    </div>
    <p>{row.statement}</p>
    <dl className="grid gap-3 rounded-lg border border-border p-5 sm:grid-cols-2">
      <div><dt className="font-semibold">Target</dt><dd>{row.target}</dd></div>
      <div><dt className="font-semibold">Saved</dt><dd>{row.progress}</dd></div>
      {row.remaining && <div><dt className="font-semibold">Remaining</dt><dd>{row.remaining}</dd></div>}
      {row.excess && <div><dt className="font-semibold">Excess</dt><dd>{row.excess}</dd></div>}
      <div><dt className="font-semibold">Target date</dt><dd>{row.targetDate ?? "No target date set"}</dd></div>
      <div><dt className="font-semibold">Goal identity</dt><dd className="break-all">{row.goalId}</dd></div>
    </dl>
    <GoalEditor id={id} goal={detail.goal} announce={announce} refresh={refresh} />
    <ContributionForm id={id} goal={detail.goal} announce={announce} refresh={refresh} />
    <div className="flex flex-wrap gap-3">
      <ArchiveRestoreControl id={id} row={row} announce={announce} refresh={refresh} focusHeading={focusHeading} />
    </div>
    <Ledger id={id} goal={detail.goal} entries={ledgerRows} announce={announce} refresh={refresh} />
  </>;
}

export function GoalDetailView({ id, goalId }: { id: string; goalId: string }) {
  if (!mockMode) return <UnavailableSurface />;
  return <GoalDetailViewConnected id={id} goalId={goalId} />;
}

function GoalDetailViewConnected({ id, goalId }: { id: string; goalId: string }) {
  const { session, logout } = useSession();
  const api = useGoalsClient();
  const load = useCallback((signal: AbortSignal) => api.detail(id, goalId, signal), [api, id, goalId]);
  const detail = useResource(`${session.sessionRef}:${session.sessionVersion}:${id}:${goalId}`, load);
  const [status, setStatus] = useState("");
  const announce = useCallback((message: string) => setStatus(message), []);

  return <section className="space-y-6">
    <h1 id="goal-detail-heading" tabIndex={-1} className="font-display text-3xl font-semibold">Goal detail</h1>
    <NextLink className="text-interactive underline" href={goalsRoute(id)}>Back to goals</NextLink>
    <StatusRegion id="goal-detail" message={detail.refreshed && !status ? "Goal refreshed." : status} />
    {detail.error ? <GoalsFailure error={detail.error} retry={detail.refresh} onSignOut={() => void logout()} label="this goal" />
      : !detail.value ? <Alert loading>Loading this goal…</Alert>
      : <GoalDetailBody id={id} detail={detail.value} announce={announce} refresh={detail.refresh} />}
  </section>;
}
