"use client";
// Shared UI-state helpers (CBD-35, named by CBD-202 and CBD-198 as the owner of "shared interface-state
// conventions"). `useResource` and `Failure` were moved verbatim out of `(app)/journey.tsx`, the single source of
// truth every later view reads from instead of keeping its own copy. `EmptyState`, `StatusRegion`, `DeniedState`,
// `StaleNotice` and `PartialNotice` generalize the states that already recurred at more than one call site --
// see the three "distinct emptinesses" convention (CBD-67 SS14.6) and the uniform-denial convention (CBD-243-AC07).
//
// `useResource` and the failure classifier (`classifyFailure`) build no JSX. They live in `./resource-state.ts`
// and are only re-exported here, so they can be unit-tested directly under this workspace's plain `node --test`,
// which has no JSX transform and cannot load this file at all (it uses `next/link`, resolvable only through a
// bundler's own resolver).
import type { ReactNode } from "react";
import NextLink from "next/link";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { classifyFailure, useResource } from "./resource-state.ts";

export { classifyFailure, useResource };

/** Denials are uniform and uninformative (CBD-243-AC07, CBD-306-AC05, CBD-341-AC05): a denial never distinguishes
 * "does not exist" from "you may not see it". Every call site that reports a denial wraps its own sentence in this. */
export function DeniedState({ title = "Access unavailable", children }: { title?: string; children: ReactNode }) {
  return <Alert tone="danger" title={title}>{children}</Alert>;
}

/** UI-P07: the one sentence a route-level boundary ever shows for "this is not here" -- whether that is
 * literally true (an unmatched route, `not-found.tsx`) or a permission-shaped denial (a thrown 401/403 a
 * page's own read surfaced, caught by `error.tsx`). CBD-306-AC05 and CBD-243-AC07 require the two to be
 * indistinguishable, so both boundaries render this exact component rather than each writing its own
 * wording -- the same reasoning `DeniedState` already applies per-resource, generalized to "no route
 * matched here at all". */
export function PageUnavailable() {
  return <Alert tone="danger" title="Page unavailable">
    <p>This page is not here, or it is not yours to open.</p>
  </Alert>;
}

/** The polite live region rendered in every branch of a mutating section, so a re-render cannot swallow an
 * announcement. `id` names the section (`spending`, `detail`, ...); the testid keeps its existing shape, `${id}-status`. */
export function StatusRegion({ id, message }: { id: string; message: string }) {
  return <p aria-live="polite" role="status" className="text-on-surface-muted" data-testid={`${id}-status`}>{message}</p>;
}

/** The true-empty state (CBD-67 SS14.6): "there is nothing here yet" plus the action that creates the first one.
 * Never used for a permission-restricted or unavailable read, which are `DeniedState` and `Failure` respectively. */
export function EmptyState({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return <Alert title={title}>{children}{action}</Alert>;
}

/** Extracted from `BudgetContent`: the budget was read successfully, but its snapshot is not current. */
export function StaleNotice({ updatedAt }: { updatedAt: string }) {
  return <Alert title="Saved budget snapshot">Budget details were last updated {updatedAt}. They may have changed. Refresh before editing.</Alert>;
}

/** Extracted from `BudgetContent`: the budget was read successfully, but some section of it is missing. */
export function PartialNotice() {
  return <Alert title="Budget details are incomplete">Some budget details are unavailable. The category plan is withheld until a complete response is available.</Alert>;
}

/** Classifies a failed read into denied / terminal / recoverable and renders the matching uniform notice. */
export function Failure({ error, retry }: { error: unknown; retry(): void }) {
  const kind = classifyFailure(error);
  const backToBudgets = <NextLink className="ml-3 underline" href="/budgets">Back to budgets</NextLink>;
  if (kind === "denied") return <DeniedState>
    <p>Your current session cannot open this budget.</p>
    <NextLink className="underline" href="/sign-in">Sign in again</NextLink>
    {backToBudgets}
  </DeniedState>;
  return <Alert tone="danger" title={kind === "terminal" ? "Budget unavailable" : "Unable to load this budget"}>
    <p>{kind === "terminal" ? "This budget cannot be opened from this link." : "We could not refresh the budget. You can try again."}</p>
    {kind !== "terminal" && <Button variant="secondary" onClick={retry}>Try again</Button>}
    {backToBudgets}
  </Alert>;
}
