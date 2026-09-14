"use client";
// Editable drafts and render-bound confirmation are managed in browser memory.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CreationController } from "../../api/creation-controller";
import type { Draft } from "../../api/proposals";
import { useSession } from "../../session/SessionProvider";
import { Input } from "../../components/Input";
import { Select } from "../../components/Select";
import { Button } from "../../components/Button";
import { Alert } from "../../components/Alert";
import { Checkbox } from "../../components/Choice";

const initial: Draft = { name: "", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "monthly", anchor: { kind: "day-of-month", day: 1 } } };
const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const cadenceDefaults: Record<string, unknown> = {
  weekly: { cadence: "weekly", anchor: "monday" },
  monthly: initial.schedule,
  paycheck: { cadence: "paycheck", pattern: { kind: "weekly", weekday: "friday" }, businessDayPolicy: "previous-business-day" },
  "custom-fixed-length": { cadence: "custom-fixed-length", startBoundary: "", lengthInDays: 14 },
};
const patternDefaults: Record<string, unknown> = {
  weekly: { kind: "weekly", weekday: "friday" },
  "twice-per-week": { kind: "twice-per-week", weekdays: ["tuesday", "friday"] },
  "every-two-weeks": { kind: "every-two-weeks", weekday: "friday", recurrenceOrigin: "" },
  "twice-per-month": { kind: "twice-per-month", anchors: [{ kind: "day-of-month", day: 1 }, { kind: "day-of-month", day: 15 }] },
  monthly: { kind: "monthly", anchor: { kind: "last-day" } },
  "custom-weekly-interval": { kind: "custom-weekly-interval", weekday: "friday", everyWeeks: 3, recurrenceOrigin: "" },
};
function valueAt(object: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, object);
}
function withValue(draft: Draft, path: string, value: unknown): Draft {
  const copy = structuredClone(draft);
  const parts = path.split(".");
  let parent = copy as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) parent = parent[part] as Record<string, unknown>;
  parent[parts.at(-1)!] = value;
  return copy;
}
export function CreationForm() {
  const { api, session } = useSession();
  const subject = `${session.accountSubjectId}:${session.sessionRef}:${session.sessionVersion}`;
  const [controller] = useState(() => new CreationController(api, structuredClone(initial), subject));
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const router = useRouter();
  const draftKey = `cobudget.draft.creation.${session.sessionRef}`;
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(draftKey) ?? "null");
      if (stored && typeof stored === "object" && "name" in stored && "schedule" in stored && "timeZone" in stored && "currencyCode" in stored) controller.edit(stored as Draft);
    } catch { sessionStorage.removeItem(draftKey); }
    return () => controller.dispose();
  }, [controller, draftKey]);
  useEffect(() => {
    // Restoration can publish before this effect runs with the initial render's snapshot.
    try { sessionStorage.setItem(draftKey, JSON.stringify(controller.snapshot().draft)); } catch { /* In-memory draft still works when storage is unavailable. */ }
    if (state.stage !== "draft" || !state.draft.name) return;
    const timer = setTimeout(() => void controller.preview(), 400);
    return () => clearTimeout(timer);
  }, [controller, draftKey, state.draft, state.stage]);
  useEffect(() => {
    if (state.stage === "review" && state.proposal) controller.rendered(state.proposal.proposalId, subject);
  }, [controller, state.proposal, state.stage, subject]);
  useEffect(() => {
    const proposal = state.proposal;
    if (!proposal || state.stage !== "review") return;
    const expire = () => { controller.edit(controller.snapshot().draft); void controller.preview(); };
    const expiry = setTimeout(expire, Math.max(0, Date.parse(proposal.expiresAt) - Date.now()));
    const poll = setInterval(() => void controller.revalidate(), 15000);
    const resume = () => { controller.edit(controller.snapshot().draft); void controller.preview(); };
    window.addEventListener("pageshow", resume);
    window.addEventListener("focus", resume);
    return () => { clearTimeout(expiry); clearInterval(poll); window.removeEventListener("pageshow", resume); window.removeEventListener("focus", resume); };
  }, [controller, state.proposal, state.stage]);
  useEffect(() => {
    if (state.errors.length) document.getElementById(`field-${state.errors[0].path}`)?.focus();
  }, [state.errors]);
  const update = (path: string, value: unknown) => controller.edit(withValue(state.draft, path, value));
  const errorAt = (path: string) => state.errors.filter(error => error.path === path || error.path.startsWith(`${path}.`)).map(error => error.message).join(" ") || undefined;
  const errorTarget = (path: string) => {
    if (path === "schedule" || path === "schedule.anchor" || path === "schedule.pattern") return "field-schedule";
    if (path.startsWith("header.") || path === "supersedesProposalId") return "validation-errors";
    return `field-${path}`;
  };
  const input = (path: string, label: string, numeric = false, type = "text") => <Input key={path} id={`field-${path}`} label={label} value={String(valueAt(state.draft, path) ?? "")} type={type} inputMode={numeric ? "numeric" : undefined} error={errorAt(path)} onChange={event => update(path, numeric && event.target.value !== "" ? Number(event.target.value) : event.target.value)} />;
  const select = (path: string, label: string, choices: string[], change?: (value: string) => void) => <Select key={path} id={`field-${path}`} label={label} value={String(valueAt(state.draft, path) ?? "")} error={errorAt(path)} onChange={event => change ? change(event.target.value) : update(path, event.target.value)}>{choices.map(value => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}</Select>;
  const anchor = (path: string, label: string) => <div className="space-y-3" key={path}>{select(`${path}.kind`, `${label} rule`, ["day-of-month", "last-day"], value => update(path, value === "last-day" ? { kind: value } : { kind: value, day: 1 }))}{valueAt(state.draft, `${path}.kind`) === "day-of-month" && input(`${path}.day`, `${label} day (1–31)`, true)}</div>;
  const cadence = valueAt(state.draft, "schedule.cadence");
  const pattern = valueAt(state.draft, "schedule.pattern.kind");
  async function confirm() {
    // Drop the persisted draft when the confirmation is dispatched, not when it returns: a tab switch or
    // unmount while the server commits must not restore a draft that invites a second creation.
    // A stale or failed confirmation republishes state, and the draft effect persists it again.
    sessionStorage.removeItem(draftKey);
    const result = await controller.confirm(subject);
    if (result) { sessionStorage.removeItem(draftKey); router.replace(`/budgets/${encodeURIComponent(result.budgetSpaceId)}`); }
  }
  return <section className="space-y-6"><h1 className="font-display text-3xl font-semibold">Create a budget</h1>
    <p>Choose your schedule, then review the periods before creating your budget.</p>
    <form noValidate onSubmit={event => { event.preventDefault(); void controller.preview(); }}>
      <fieldset id="field-schedule" tabIndex={-1} disabled={state.stage === "confirming" || state.stage === "complete"} className="grid gap-5 sm:grid-cols-2"><legend className="mb-4 text-xl font-semibold">Budget and schedule</legend>
        {input("name", "Budget name")}{input("timeZone", "IANA time zone")}{input("currencyCode", "Currency code")}
        {select("schedule.cadence", "Cadence", ["monthly", "weekly", "paycheck", "custom-fixed-length"], value => update("schedule", structuredClone(cadenceDefaults[value])))}
        {cadence === "monthly" && anchor("schedule.anchor", "Monthly anchor")}
        {cadence === "weekly" && select("schedule.anchor", "Weekly anchor", weekdays)}
        {cadence === "custom-fixed-length" && <>{input("schedule.startBoundary", "Start boundary", false, "date")}{input("schedule.lengthInDays", "Period length in days (1–366)", true)}</>}
        {cadence === "paycheck" && <>
          {select("schedule.pattern.kind", "Paycheck pattern", Object.keys(patternDefaults), value => update("schedule.pattern", structuredClone(patternDefaults[value])))}
          {select("schedule.businessDayPolicy", "Non-business-day policy", ["previous-business-day", "next-business-day", "keep-original-date"])}
          {pattern === "twice-per-week" ? <>{select("schedule.pattern.weekdays.0", "First weekday", weekdays)}{select("schedule.pattern.weekdays.1", "Second weekday", weekdays)}</> : pattern === "twice-per-month" ? <>{anchor("schedule.pattern.anchors.0", "First monthly anchor")}{anchor("schedule.pattern.anchors.1", "Second monthly anchor")}</> : pattern === "monthly" ? anchor("schedule.pattern.anchor", "Paycheck anchor") : select("schedule.pattern.weekday", "Paycheck weekday", weekdays)}
          {(pattern === "every-two-weeks" || pattern === "custom-weekly-interval") && input("schedule.pattern.recurrenceOrigin", "Recurrence origin", false, "date")}
          {pattern === "custom-weekly-interval" && input("schedule.pattern.everyWeeks", "Interval in weeks (1–4)", true)}
        </>}
        <Button type="submit" disabled={state.stage === "loading"}>Preview schedule</Button>
      </fieldset>
    </form>
    {state.message && <Alert tone={state.stage === "error" ? "danger" : "neutral"} loading={state.stage === "loading" || state.stage === "confirming"}>{state.message}</Alert>}
    {state.errors.length > 0 && <ul id="validation-errors" tabIndex={-1} aria-label="Validation errors" className="space-y-2">{state.errors.map((error, index) => <li key={`${error.path}:${index}`}><a className="text-danger underline" href={`#${errorTarget(error.path)}`}>{error.message}</a></li>)}</ul>}
    {state.proposal && <section aria-labelledby="review-heading" className="space-y-4"><h2 id="review-heading" className="text-2xl font-semibold">Review your budget</h2>
      <p className="break-words font-semibold">{state.proposal.normalizedInputs.name}</p><p>{state.proposal.normalizedInputs.timeZone} · {state.proposal.normalizedInputs.currencyCode}</p><p>{state.proposal.preview.cadenceSummary}</p>
      <ol className="grid gap-3 sm:grid-cols-2">{state.proposal.preview.periods.map(period => <li key={period.ordinal} className="rounded-lg border border-border p-4"><h3 className="font-semibold">{period.relation === "current" ? "Complete current period" : `Following period ${period.ordinal}`}</h3><p>{period.start} through {period.end}</p><p>{period.lengthInDays} days · dates inclusive</p></li>)}</ol>
      {state.proposal.preview.warnings.map((warning, index) => <Alert key={`${warning.code}:${index}`}>{warning.message}</Alert>)}
    </section>}
    {/* CBD-236 (CBD236-CONSENT-SEMANTICS-001 item 1): the complete current-version Primary Owner
        self-disclosure is presented above the confirm control, and confirming is consent only after
        an explicit acknowledgement. The text and its version come from the server's approved
        registry; nothing here is hard-coded and no box is ticked by default. */}
    {state.proposal && <section aria-labelledby="disclosure-heading" className="space-y-4 rounded-lg border border-border p-4">
      <h2 id="disclosure-heading" className="text-2xl font-semibold">{state.proposal.currentDisclosure.text.heading}</h2>
      <ul className="list-disc space-y-2 pl-6">{state.proposal.currentDisclosure.text.items.map(item => <li key={item.id}>{item.text}</li>)}</ul>
      <Checkbox id="field-acknowledged-disclosure" checked={state.acknowledged}
        label={state.proposal.currentDisclosure.text.acknowledgement}
        disabled={state.stage !== "review"}
        onChange={event => controller.acknowledge(event.target.checked)} />
    </section>}
    <Button disabled={!controller.canConfirm()} onClick={() => void confirm()}>Confirm and create budget</Button>
  </section>;
}
