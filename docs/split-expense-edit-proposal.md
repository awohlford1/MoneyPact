# Editing one share of a split expense — product proposal

| Field | Value |
| --- | --- |
| Status | **Proposed — product definition for the surface the Executive approved in `EXEC-FOLLOWUPS-003` item 3. The rebalance rule is the approved rule stated exactly; everything else is proposed. No code, migration, policy cell, rate-limit record, or Jira change exists because of this document; the Executive decisions it needs are in §11** |
| Document version | 0.1 |
| Proposal identifiers | user stories `US-SPLIT-01` through `US-SPLIT-05`; rule clauses `RB-01` through `RB-14`; acceptance criteria `SPLIT-EDIT-AC01` through `SPLIT-EDIT-AC14`; open questions `OQ-SPLIT-001` through `OQ-SPLIT-008` |
| Owner | Alexander Wohlford |
| Jira, as read on September 15, 2026 | [CBD-200](https://cobudget.atlassian.net/browse/CBD-200) (manual-transaction mutation lifecycle, In Review) and [CBD-211](https://cobudget.atlassian.net/browse/CBD-211) (category progress and drill-downs, In Review), both read from the `customfield_10066` acceptance-criteria field; parent stories CBD-32 and CBD-35; epic criterion [CBD-8](https://cobudget.atlassian.net/browse/CBD-8) `AC07` for the version consequence |
| Governing decision | `EXEC-FOLLOWUPS-003` item 3 (Executive, September 15, 2026): build the split-expense edit surface with shares rebalancing to keep the transaction total; a product packet defines the rule first, then an implementation packet after `PK-8` |
| Governing findings | `F-BFIX-01` (`PROTO-INCREMENT-B-FIX-001-RESULT`): the category detail refuses to edit a share of a split expense because the in-place form rewrites the whole transaction with one allocation; `F-WALK-01` (`PROTO-WALKTHROUGH-FIX-001-RESULT`): walkthrough step 15 asserts that refusal |
| Governing authorization contract | `docs/cbd-236-authorization-policy-contract.md` v0.12.1 — §8 row 9 (`9.edit_manual_transaction`), §8.6, §8.8.1 table, `resource.version` for a `transaction` target |
| Merged behaviour read | `apps/api/src/transactions/http.ts`, `apps/api/src/transactions/http.test.ts`, `packages/budget-application/src/transactions/application.ts`, `packages/budget-application/src/transactions/records.ts`, `packages/migrations/migrations/20260914T180002Z__create_transaction_allocation.sql`, `apps/api/src/sessions/budget-facts.ts`, `apps/web/src/app/(app)/budgets/spending.tsx`, `apps/web/src/api/client.ts`, `scripts/prototype-browser-walkthrough.mjs` |
| Milestone | `PROTOTYPE-SLICE-001` and `PROVIDERS-LOCAL-001` (Executive, September 12, 2026) |
| Repository baseline | `eec8f92` on `main` |
| Written by | Product, assignment `PROTO-SPLIT-EXPENSE-EDIT-PRODUCT-001`, September 15, 2026 |
| Last updated | September 15, 2026 |

> **Authority.** The Executive decided the rule: editing one share of a split expense rebalances the other shares proportionally so the transaction total is unchanged. This document states that rule exactly enough to implement and to test, and proposes the surface, the API shape, the authorization binding, and the acceptance criteria around it. It approves nothing. Where a clause below would widen an approved source — CBD-72, CBD-201's exact-sum rule, CBD-236 — the source wins and this document is wrong. The implementation packet that follows `PK-8` binds to the clauses marked **Proposed-binding** only once the §11 decisions are recorded.

## 1. The problem as merged

A manual expense is one `manual_transaction` version carrying a set of `transaction_allocation` rows, one per category, whose signed sum equals the version's signed amount exactly (`assertAllocationsSum`, `packages/budget-application/src/transactions/application.ts`; the deferred constraint trigger in `20260914T180002Z__create_transaction_allocation.sql`). An expense is negative at every layer (increment A decision 1). Editing is whole-version: `PATCH /v1/budget-spaces/:id/transactions/:transactionId` takes the full write request — account, amount, date, description, and every allocation — and `editManualTransaction` writes a new version at `revision + 1`, stamping the old one `superseded_at`. There is no per-allocation write and no "edit one share" concept anywhere in the application layer.

The category detail (`CategoryDetailView` in `apps/web/src/app/(app)/budgets/spending.tsx`) lists one allocation per row and offers an in-place amount edit that submits the whole transaction with a single allocation for the page's own category. For an expense with one allocation that is the whole expense and the edit is honest. For a share of a split expense it would silently drop every other category's share, so since `F-BFIX-01` the API reports `allocationCount` on every detail item (`itemizeCategory`, `apps/api/src/transactions/http.ts`) and the page withholds the edit when the count is not exactly one, rendering instead:

> This expense is split across 2 categories, so it cannot be changed from this page. Edit it where every category's amount is shown, so nothing is dropped.

with the only control being **Remove this whole expense**. The self-driving walkthrough (`scripts/prototype-browser-walkthrough.mjs`, the step logged as "The split share refuses the in-place edit", step 15 of the 21-step run recorded in `PROTO-WALKTHROUGH-FIX-001-RESULT`) asserts that exact copy, the absence of **Edit this expense**, and the presence of **Remove this whole expense**.

The copy points at a surface that does not exist: there is no page that shows every category's amount for one expense, and the recording form (`apps/web/src/app/(app)/budgets/spending.tsx`, the split-allocation fieldset with the hint "The category amounts must add up to the amount spent, exactly") creates but does not edit. A person who mis-entered one share of a split can today only remove the whole expense and record it again. That is the gap `EXEC-FOLLOWUPS-003` item 3 closes.

Two facts about the merged model shape everything below:

- A zero-amount allocation is representable. Neither `parseSignedMinorUnits` (`packages/budget-application/src/accounts/records.ts`) nor the allocation table's CHECKs forbid `amount_minor_units = 0`; only the exact-sum rule and the one-row-per-category uniqueness (`UNIQUE (transaction_version_id, category_id)`) constrain the set.
- The authorization target of an edit is the transaction identity, and its `resource.version` is the current version's `revision` (`apps/api/src/sessions/budget-facts.ts`, the `transaction` branch). A concurrent edit moves `revision`, which is what `recheck_at_commit` compares.

## 2. User stories

| Id | Story | Notes |
| --- | --- | --- |
| `US-SPLIT-01` | As a budget member looking at one category's transactions, I can change this category's share of a split expense from the row I am looking at, and the other categories' shares are rebalanced so the expense still costs what it cost. | The primary story. Replaces the refusal of `F-BFIX-01` with the surface it pointed at, in place. |
| `US-SPLIT-02` | Before I confirm, I see every category's share as it is now and as it will be after my change, and the unchanged total. | The rebalance moves money the person is not looking at; the preview is what makes that honest rather than silent. |
| `US-SPLIT-03` | I can move this category's whole share to the others by setting it to zero, or take the whole expense into this category by setting it to the total, without leaving the row. | The two ends of the range; both are ordinary cases of the rule, not exceptions. |
| `US-SPLIT-04` | If someone else changed this expense since I loaded it, my change is refused and I am told to reload, and nothing has moved. | CBD-200-AC04 applied to the rebalance, which depends on the current shares more than an ordinary edit does. |
| `US-SPLIT-05` | I can see in the expense's history that the share was changed and what every share was before and after. | The retained version chain already gives this (CBD-201-AC04); the rebalance must not weaken it. |

Not in this increment: pinning individual shares as fixed during a rebalance (`OQ-SPLIT-002`); a whole-expense editor that changes the total, the date, the account, or the set of categories of a split expense; editing a share to a value outside the expense's own range (`OQ-SPLIT-003`); Viewer or Accountability Partner visibility of the surface (those roles have no cells in `p5`, CBD-236 §8.8.1).

## 3. The rebalance rule (**Proposed-binding**, stating the approved rule)

All amounts are signed integers in the account's minor unit (`minor_unit_precision` 0, 2 or 3), exactly as stored. Nothing below rounds a stored value; rounding happens only in step `RB-06`, and only on the newly computed free shares.

**Definitions.**

- `T` — the signed amount of the current version (`manual_transaction.amount_minor_units`). Unchanged by this surface, always.
- `S` — the current allocation set: for each category `c`, its share `s(c)`. `|S| = n`, with `n >= 2` for the surface to apply (`RB-02`).
- `k` — the edited category; `s(k)` its current share; `s'(k)` the requested new share.
- `P` — the pinned set: categories other than `k` whose shares must not move. In this increment `P` is empty (`OQ-SPLIT-002`); the rule is stated with `P` so pinning can be added without restating it.
- `F` — the free set: every category other than `k` and not in `P`. `|F| = m`.
- `O = sum of s(c) for c in F` — what the free shares add up to now.
- `O' = T - s'(k) - sum of s(c) for c in P` — what the free shares must add up to afterwards.

**Clauses.**

| Id | Clause |
| --- | --- |
| `RB-01` | **The total is invariant.** The new version's `amount_minor_units` equals `T`, its account, budget date, period and description equal the current version's, and its allocation set sums to `T` exactly (CBD-201-AC02 unchanged). |
| `RB-02` | **Only a split is rebalanced.** The rule applies when the current version carries `n >= 2` allocations. A request against a version with one allocation is refused (`allocation_not_split`); a single-allocation expense keeps the existing whole-expense in-place edit, whose amount change is a change of `T` and is out of this rule's scope. |
| `RB-03` | **The edited share is taken as given.** `s'(k)` is an integer in minor units satisfying `parseSignedMinorUnits`; it is written exactly, never rounded. |
| `RB-04` | **Range.** `s'(k)` must lie on the closed segment between `0` and `T - sum of s(c) for c in P` (for an expense `T = -1250` with nothing pinned that is `-1250 <= s'(k) <= 0`). A value outside the segment would force the free shares to change sign, which is no longer a rebalance of the expense but a different expense; it is refused (`allocation_share_out_of_range`). `OQ-SPLIT-003` asks whether the Executive wants the wider behaviour. |
| `RB-05` | **Proportional to current amounts.** For each free category `c`, the exact new share is `r(c) = s(c) * O' / O` as a rational number, when `O != 0`. The proportion is to the free shares' current amounts, not to any earlier version, not to the count of shares, and not to targets. |
| `RB-06` | **Rounding to the minor unit.** Each `r(c)` is truncated toward zero to an integer `q(c)`; the residual `R = O' - sum of q(c)` is then an integer with the sign of `O'` and `|R| < m`. `|R|` free categories each receive one minor unit in the direction of `O'`: the categories are ranked by the magnitude of the discarded fraction `|r(c) - q(c)|` descending, ties broken by `category_id` ascending as a lowercase string; the first `|R|` in that ranking are adjusted. The result `s'(c) = q(c) + adjustment` is the written share. This is the largest-remainder method with a deterministic tie-break: two implementations given the same version produce byte-identical allocation sets, and the residual never lands on the edited share or a pinned share. |
| `RB-07` | **Sign and monotonicity.** Every free share keeps the sign of `O'` (or becomes zero); no free share changes sign, and a free share of zero stays zero (`0 * O'/O = 0`, no fraction, never adjusted). `|s'(c)|` moves in the same direction as `|O'|` relative to `|O|` for every free share. Under `RB-04` `O'` has the sign of `T` or is zero, so these follow from `RB-05` and `RB-06`; they are stated so a test can assert them directly. |
| `RB-08` | **All free shares zero.** When every `s(c)` for `c in F` is `0` (so `O = 0` and `RB-05` is undefined) and `O' != 0`, `O'` is split equally across `F`: `r(c) = O' / m` for each, then `RB-06` applies. This is the only case in which the proportion is not to current amounts, and it is the natural reading of "proportional" over shares that currently carry nothing. `OQ-SPLIT-006`. |
| `RB-09` | **Free shares cancelling.** When `O = 0` but some free share is non-zero (the free shares cancel, for example `+500` and `-500`), the proportion is undefined and there is no honest rebalance; the request is refused (`allocation_rebalance_undefined`). Under `RB-04` this state cannot be produced by this surface; it can only pre-exist from a whole-version write. |
| `RB-10` | **Share set to zero.** `s'(k) = 0` is a valid request under `RB-04`. The edited category's allocation row is retained in the new version with `amount_minor_units = 0` (the model admits it, §1), so the category still lists the expense at `0.00`, `allocationCount` is unchanged, and the person can move the share back from the same row. The alternative — dropping the row — is `OQ-SPLIT-001`. |
| `RB-11` | **Share set to the whole total.** `s'(k) = T - sum of s(c) for c in P` gives `O' = 0`, so every free share becomes `0` (`RB-05` with `O' = 0`, or `RB-08`'s equal split of zero). The free rows are retained at zero per `RB-10`. The expense is then, in effect, a single-category expense that still carries `n` allocation rows and is still edited through this rule (`RB-02` counts rows, not non-zero rows). |
| `RB-12` | **No change.** When `s'(k) = s(k)`, the computed set equals the current set; no new version is written and the current version is returned with `changed: false`. A version that differs from its predecessor in nothing would add a revision, a superseding stamp and an audit record for no financial change. `OQ-SPLIT-007`. |
| `RB-13` | **Nothing partial.** The rule is computed in full and every refusal is raised before any row is written; a refused request leaves no version, no allocation and no stamp (CBD-199-AC03, CBD-201-AC03 pattern). |
| `RB-14` | **All pinned.** If `P` covers every category other than `k` (`m = 0`) and `s'(k) != s(k)`, there is nowhere to rebalance to and the request is refused (`allocation_rebalance_no_free_share`). Unreachable while `P` is empty; stated for `OQ-SPLIT-002`. |

### 3.1 Worked examples

Expense amounts are negative. Category identifiers are shortened to `A`, `B`, `C` and are assumed to sort in that order.

**Example 1 — the walkthrough's expense, two shares.** `T = -1250`, `A = -800` (Groceries), `B = -450` (Rent). Edit `A` to `-700`. `F = {B}`, `O = -450`, `O' = -1250 - (-700) = -550`. `r(B) = -450 * -550 / -450 = -550`, exact. Result: `A = -700`, `B = -550`; sum `-1250`. With two shares the other share always absorbs the exact difference and no rounding ever occurs.

**Example 2 — three shares, no residual.** `T = -1250`, `A = -500`, `B = -450`, `C = -300`. Edit `A` to `-700`. `O = -750`, `O' = -550`. `r(B) = -450 * 550 / 750 = -330`, `r(C) = -300 * 550 / 750 = -220`, both exact. Result `A = -700`, `B = -330`, `C = -220`; sum `-1250`.

**Example 3 — three shares, residual of one unit.** `T = -1000`, `A = -333`, `B = -333`, `C = -334`. Edit `A` to `-500`. `O = -667`, `O' = -500`. `r(B) = -333 * 500 / 667 = -249.625...`, `r(C) = -334 * 500 / 667 = -250.374...`. Truncate toward zero: `q(B) = -249`, `q(C) = -250`; `sum = -499`; `R = -500 - (-499) = -1`. Rank by discarded fraction: `B` (`0.625`) before `C` (`0.374`); `B` receives one unit toward the sign of `O'`: `B = -250`. Result `A = -500`, `B = -250`, `C = -250`; sum `-1000`.

**Example 4 — tie-break.** `T = -1000`, `A = -100`, `B = -450`, `C = -450`. Edit `A` to `-301`. `O = -900`, `O' = -699`. `r(B) = r(C) = -349.5`; `q(B) = q(C) = -349`; `R = -1`. The discarded fractions tie at `0.5`; `category_id` ascending picks `B`. Result `A = -301`, `B = -350`, `C = -349`; sum `-1000`. Run again with `B` and `C` swapped in the request order: the same result, because the ranking is by identifier, not by request order.

**Example 5 — share to zero.** Example 1 with `A` set to `0`: `O' = -1250`, `B = -1250`, `A = 0` retained. Groceries' detail still lists the expense at `0.00` with `allocationCount 2`; Groceries' progress falls by `8.00`, Rent's rises by `8.00`.

**Example 6 — share to the whole total.** Example 2 with `A` set to `-1250`: `O' = 0`, `B = 0`, `C = 0`, all three rows retained.

**Example 7 — out of range.** Example 1 with `A` set to `-1300` or to `+50`: refused `allocation_share_out_of_range`, nothing written.

**Example 8 — stale base.** Two people load Example 2. The first edits `A` to `-700` (revision 2, `B = -330`, `C = -220`). The second, still holding revision 1, edits `B` to `-400` with `expectedRevision: 1`: refused `conflict` (409), nothing written. Had it been applied against revision 2 the proportion would have been computed over shares the second person never saw.

## 4. The surface

The surface is the category detail row itself (`CategoryDetailView`), the page the person is already on when they see the share, replacing the refusal of `F-BFIX-01`. No new page. The row for a split share offers **Edit this share** where a single-allocation row offers **Edit this expense**. Activating it opens, in the row, a form with:

1. one amount input for this category's share, pre-filled with the current share in major units, labelled `This category's share (USD)`;
2. a read-only preview table of every category in the split — label, current share, share after the change — recomputed as the person types, using the same rule (§3) as the server; and the total, shown once, unchanged;
3. **Save share** and **Cancel**.

The preview is computed client-side from the same pure function the API uses (§6), so what the person sees is what will be written; the server's answer is still the one displayed after save, and the page reloads its detail from the server as it does today. A preview that the client cannot compute (a state the rule refuses) shows the refusal text in place of the table and disables **Save share**.

Copy, proposed:

- Row notice (replaces the refusal): `This expense is split across 2 categories. Changing this category's share rebalances the other shares, so the expense still totals 12.50 USD.`
- Preview heading: `Shares after this change`.
- Out-of-range (`RB-04`): `A share must be between 0.00 and the expense total, 12.50 USD.`
- Stale (`RB-13`, 409 `conflict`): `This expense changed since you opened it. Reload to see the current shares.`
- Success status: `Share updated.` (parallel to the existing `Expense updated.`).
- Removal keeps its current label: **Remove this whole expense**.

Until the surface is built, the merged refusal copy stays as it is, but its second sentence should point at what is coming rather than at a page that does not exist: `This expense is split across 2 categories, so it cannot be changed from this page yet. Changing one share will rebalance the others once share editing is available.` Whether to change the interim copy at all is `OQ-SPLIT-008`; the recommendation is not to touch it before the implementation packet, because walkthrough step 15 asserts it verbatim and the change would be a second PR to a file the packet would then rewrite.

Walkthrough step 15 after the surface exists: the step "The split share refuses the in-place edit" becomes "The split share edits with rebalance": open the Groceries row of the 12.50 expense, activate **Edit this share**, see the preview `Groceries 8.00 -> 7.00, Rent 4.50 -> 5.50, total 12.50`, save, assert `Share updated.`, assert the aggregate reads Groceries spent `7.00` and Rent spent `5.50`, reload and see the same (the server's figures), then restore the share to `8.00` so the later steps' assertions on `Corner shop 8.00 USD` hold — or update those assertions. The step count changes; `docs/development.md`'s self-driving proof paragraph must be updated in the same change, as `F-WALK-01` did.

## 5. Authorization, audit, and version consequences

**Cell (Proposed-binding, existing).** The rebalance is a mutation of the transaction identity and binds the existing `9.edit_manual_transaction` cell, resource type `transaction`, target the transaction row, with the cell's obligations `audit`, `confirm`, `preserve`, `invalidate` and the universal `recheck_at_commit` (CBD-236 §8 row 9; §8.8.1 for Co-owner and Collaborator, Allow). No new permission is created: CBD-72 row 9 grants editing a manual transaction, and rebalancing the shares of one is editing it with a narrower input, not a different act. Consequently no `p6` is needed for this surface. The `p6` question the packet asks for is stated as `OQ-SPLIT-004` so that the Executive can say otherwise: a separate cell would be warranted only if some role were to be allowed to rebalance shares but not to edit the expense, which CBD-72 does not contemplate.

**Version.** The write is a new `manual_transaction` version at `revision + 1` through the same `appendVersion(version, allocations, supersede)` path as `editManualTransaction`; the transaction's `resource.version` therefore moves exactly as it does for any edit, and a request whose captured `targetVersion` is stale is denied `stale_version` at commit by the boundary (`recheck_at_commit`). That is the CBD-8-AC07-style consequence: the authorization version of the target increments on commit and every later decision against the old version fails closed. In addition the request carries `expectedRevision` (§6) so that a rebalance computed over shares the person no longer sees is refused at the handler with `conflict` before it reaches the policy recheck — the boundary protects against a race inside the commit window, `expectedRevision` protects against a stale screen, and the two are not the same guard (CBD-200-AC04).

**What does not move.** Category rows' `version` column (CBD-236 §8.6.1, moved by category edit, archive and restore) is not advanced by an allocation change; the aggregate and detail progress reads carry `bind_cache_key` with `targetVersion` of the category, so a future cache keyed on that dimension alone would not observe a rebalance. The prototype keeps no derived cache (`TransactionsAuthorizationStore` discharges `invalidate` structurally because every figure is recomputed from rows inside the transaction), so this is a note for the packet that introduces one, not a defect now.

**Audit.** The boundary's audit record for the allow (`apps/api/src/authorization/audit.ts`) is written as for any row-9 mutation. The customer-visible history is the retained version chain: `GET .../transactions/:transactionId/history` returns both versions with their allocations, which is the before/after of every share (`US-SPLIT-05`). No new audit table or record kind is proposed; the history response should carry enough for the web to render "share changed" rather than "edited", which `revision`, `recorded_by_subject_id` and the two allocation sets already allow. `preserve` holds unchanged: the superseded version keeps its identifiers, allocations and provenance.

**Rate limit.** A new route needs a registered record under the `cbd266` prototype record set (`apps/api/src/rate-limit/inventory.ts` is enforced by a test); the record is proposed as a mutation-class copy of the existing `PATCH transactions/:transactionId` record. Reusing the existing route (§6, option B) would need none.

## 6. API shape

Two shapes were weighed.

**Option A — the client computes the set and submits the existing whole-version `PATCH`.** No API change, no rate-limit record, no new route test. Rejected: the rule would live only in the web, the API could not refuse a set that breaks `RB-01` (the existing route deliberately allows the total to change), two clients could rebalance differently, and the audit trail could not say a share was rebalanced rather than the whole expense rewritten. The invariant the Executive chose would be a convention, not a property.

**Option B — a per-share command, server-side rule (recommended, Proposed-binding).**

```
PATCH /v1/budget-spaces/:budgetSpaceId/transactions/:transactionId/allocations/:categoryId
```

- Path: the transaction identity (policy target, as for the existing `PATCH`) and the category whose share is edited. The category is the stable key: allocation ids are re-minted on every version, category ids are not, and `UNIQUE (transaction_version_id, category_id)` makes the pair unambiguous.
- Body: `{ "amountMinorUnits": <signed integer>, "expectedRevision": <integer>, "pinnedCategoryIds": [] }`. `pinnedCategoryIds` is accepted as an empty array only in this increment (`OQ-SPLIT-002`); a non-empty array is refused `invalid_request` until pinning is approved, so the shape does not change when it is.
- Policy binding: the `9.edit_manual_transaction` cell with the transaction row as target, exactly as the existing `edit` route (§5). The route refuses the space id as the row id before authorization, as every row-targeted route does since `F-REVB-02`.
- Handler: load the current snapshot; refuse `transaction_removed` if tombstoned; refuse `conflict` if `expectedRevision` differs from the current revision; refuse `allocation_category_invalid` if the category is not in the current set; apply §3 through the pure function; write the new version through the same `appendVersion` path as `editManualTransaction`.
- Response: `200` with the same `TransactionMutation` shape the existing edit returns (`previous` and `current` snapshots), plus `changed: boolean` for `RB-12`. Status codes follow the existing `STATUS` map in `apps/api/src/transactions/http.ts`; the new codes are `400`: `allocation_not_split`, `allocation_share_out_of_range`, `allocation_rebalance_undefined`, `allocation_rebalance_no_free_share`.
- Rule location: a pure function `rebalanceAllocations({ total, shares, edited: { categoryId, amountMinorUnits }, pinned })` in `packages/budget-domain` (a new `allocations` module beside `progress`), exported for both the API handler and the web preview (`apps/web` already depends on `@cobudget/budget-domain`). Its unit tests are the §3.1 examples plus a property test that the sum is invariant and the ranking is order-independent.

`PATCH` on the allocation sub-resource rather than `PUT` on the allocation set: a `PUT` of every allocation is Option A with a different verb — it would have to accept a full set and could not know which share the person meant to change, so it could neither apply the proportion nor refuse a set that changes the total for the wrong reason.

## 7. Acceptance criteria (proposed)

| Id | Criterion | Verification |
| --- | --- | --- |
| `SPLIT-EDIT-AC01` | Rebalancing one share of a split expense writes exactly one new version whose amount, account, date, period and description equal the previous version's, whose allocation set sums to that amount exactly, and whose edited share equals the requested value; the previous version is superseded and retained with its allocations. | API route test through the real Fastify instance; live proof against the migrated database (the deferred sum trigger passes at commit). |
| `SPLIT-EDIT-AC02` | Every free share equals the §3 rule's output: proportional to its current amount (`RB-05`), truncated toward zero, residual assigned by largest discarded fraction then `category_id` ascending (`RB-06`), for precision 0, 2 and 3. | Unit tests on the pure function for §3.1 examples 1 to 4; a property test over random sets asserting `RB-01`, `RB-07` and order-independence. |
| `SPLIT-EDIT-AC03` | A share set to zero leaves the category's allocation row retained at zero and moves its whole amount to the free shares; a share set to the total leaves every free row retained at zero (`RB-10`, `RB-11`). | Unit and route tests for examples 5 and 6; the category detail lists the zero share at `0.00` with the unchanged `allocationCount`. |
| `SPLIT-EDIT-AC04` | A requested share outside `RB-04`'s segment is refused `400 allocation_share_out_of_range` and nothing is written. | Route test for example 7 asserting the body and that the repository call log is unchanged. |
| `SPLIT-EDIT-AC05` | A request against a version with one allocation is refused `400 allocation_not_split`; a request against a tombstoned transaction is refused `409 transaction_removed`; a category not in the current set is refused `400 allocation_category_invalid`; free shares that cancel are refused `400 allocation_rebalance_undefined`; nothing is written in any of these. | Route tests, one per code. |
| `SPLIT-EDIT-AC06` | `expectedRevision` that differs from the current revision is refused `409 conflict` with nothing written (CBD-200-AC04); a concurrent edit that lands inside the commit window denies `stale_version` at recheck with nothing committed. | Route test for example 8; live serializable-transaction test with two interleaved clients. |
| `SPLIT-EDIT-AC07` | A request whose share equals the current share writes no version and answers `200` with `changed: false` (`RB-12`). | Route test asserting revision unchanged and no `appendVersion` call. |
| `SPLIT-EDIT-AC08` | The route binds `9.edit_manual_transaction` with the transaction as target; a Viewer or a non-member is denied with the uniform external class; the space id as the row id is refused `404 transaction_not_found` before authorization. | Authorization inventory and route tests, mirroring the existing `edit` route's. |
| `SPLIT-EDIT-AC09` | After a rebalance, the aggregate progress and each affected category's detail agree on the new shares under one read, and categories outside the split are unchanged (CBD-200-AC02, CBD-211-AC03). | Live test: record example 2, rebalance, read aggregate and both details, assert the three agree and a fourth category's cell is byte-identical before and after. |
| `SPLIT-EDIT-AC10` | The transaction history shows both versions with both allocation sets (`US-SPLIT-05`). | Route test on `GET .../history` after a rebalance. |
| `SPLIT-EDIT-AC11` | The category detail offers **Edit this share** for a row with `allocationCount > 1`, shows the preview of every share before and after and the unchanged total as the person types, and disables saving when the preview is a refusal. | Browser suite (`apps/web/tests/browser.test.mjs`) and `scripts/prototype-qa-browser.mjs` CBD-211-AC01 case, rewritten from proving the refusal to proving the edit. |
| `SPLIT-EDIT-AC12` | The preview and the server produce the same allocation set for the same input (one function, two callers). | Web unit test importing the budget-domain function; the browser proof compares the preview figures to the post-save detail. |
| `SPLIT-EDIT-AC13` | The new route has a registered rate-limit record and the inventory test passes; `apps/worker` parity is untouched. | `npm run check`. |
| `SPLIT-EDIT-AC14` | Walkthrough step 15 proves the rebalance end to end (§4) and `docs/development.md` states the new step count and what the journey proves. | `node scripts/prototype-browser-walkthrough.mjs --db <scratch>` exits 0; documentation gate. |

## 8. Live criteria this touches

| Live criterion | Relation | Proposed handling |
| --- | --- | --- |
| CBD-200-AC02 — editing allocations atomically removes every prior effect and applies every new effect; unaffected periods/categories remain unchanged | Met by construction (one new version replaces one current version). "Unaffected categories" must be read as categories outside the split: every category inside the split is affected by design under the approved rule. | `SPLIT-EDIT-AC09` asserts a category outside the split is byte-identical. No wording change to CBD-200-AC02 proposed; the reading is recorded here. |
| CBD-200-AC03 — removal | Untouched; removal stays whole and labelled as whole. | None. |
| CBD-200-AC04 — a stale mutation commits nothing and returns reload-and-retry | Directly engaged: the rebalance is computed over the current shares, so staleness is more consequential than for a plain edit. The merged `PATCH` has no client-supplied expected revision; the boundary's `stale_version` covers the commit window only. | `expectedRevision` is required on the new route (`SPLIT-EDIT-AC06`). Whether the existing `PATCH` should gain the same field is `OQ-SPLIT-005`. |
| CBD-200-AC05 — replaying the same operation identity produces one revision | The merged routes carry no operation identity. `expectedRevision` makes a replay of a committed rebalance a `409 conflict` rather than a second revision, which satisfies the "one revision" outcome without an idempotency key. | Recorded as the mechanism; an idempotency key stays out of scope, as it is for the existing edit. |
| CBD-201-AC02 — signed sum equals the amount exactly | Preserved (`RB-01`); the deferred trigger remains the last line of defence. | `SPLIT-EDIT-AC01`. |
| CBD-201-AC04 — ordered history | Preserved; each rebalance is one revision in the chain. | `SPLIT-EDIT-AC10`. |
| CBD-211-AC03 — activating a category total opens itemized detail whose signed sum equals that value under the same snapshot | After a rebalance the aggregate and every affected detail must still reconcile; the zero-share row (`RB-10`) contributes `0` to both, so the identity holds. | `SPLIT-EDIT-AC09`. |
| CBD-211-AC05 — component and end-to-end tests cover aggregate/detail reconciliation | The rebalance adds a reconciliation case. | `SPLIT-EDIT-AC09`, `SPLIT-EDIT-AC11`, `SPLIT-EDIT-AC14`. |
| CBD-8-AC07 — a committed change increments the applicable authorization version and blocks subsequent stale access | The transaction's `revision` is its authorization version; it increments on every rebalance and stale captured versions deny. | §5; `SPLIT-EDIT-AC06`. |

Proposed Jira placement (Scrum to judge, no write here): the fourteen criteria belong on a new subtask under CBD-32 ("edit one share of a split expense") rather than as additions to CBD-200, which is In Review with its five criteria already traced; CBD-200-AC02 and AC04 are cited as parents. This is a proposal; CBD-200 and CBD-211 are not changed by this document.

## 9. Dependencies and sequencing

1. `PK-8` (the packet the Executive named as the predecessor) lands first; this proposal makes no assumption about its content beyond the merged baseline.
2. The pure function in `packages/budget-domain` is the first deliverable of the implementation packet, tested against §3.1 before the route exists, so the rule can be reviewed in isolation.
3. The route, its rate-limit record, and its tests follow in `apps/api/src/transactions/http.ts` (same module, same store, same `STATUS` map extended by four codes).
4. The web surface and preview follow in `apps/web/src/app/(app)/budgets/spending.tsx` and `apps/web/src/api/client.ts`, with the browser suite and `scripts/prototype-qa-browser.mjs` rewritten from proving the refusal to proving the edit.
5. Walkthrough step 15 and `docs/development.md` last, in the same change, because the walkthrough asserts the copy verbatim.

Nothing here needs a migration, a policy version, or a change to `packages/contracts`. Exclusions: code, and any change to CBD-200 or CBD-211 in Jira.

## 10. Alternatives considered and rejected

- **Change the total instead of the other shares.** Declined by the Executive (`EXEC-FOLLOWUPS-003`, alternatives considered).
- **Carry the other shares forward unchanged and change the total by the difference.** The `F-BFIX-01` alternative; declined for the same reason and because the existing single-allocation edit already covers "change what this expense cost" for the case where it is honest.
- **Equal split of the difference across the other shares.** Simpler to explain but not what was decided; also produces sign flips sooner than proportional scaling does.
- **A whole-expense editor page.** Where the merged refusal copy points. Larger scope, a new page, and still needs a rule for what happens to the other shares when one is typed; the rule is the hard part and this proposal delivers it in place.
- **Dropping the zero-share row.** Changes `n`, makes the expense vanish from the category the person was looking at, and cannot be undone from that page. `OQ-SPLIT-001`.

## 11. Open questions for the Executive, with recommendations

| Id | Question | Recommendation |
| --- | --- | --- |
| `OQ-SPLIT-001` | When a share is set to zero (or the free shares fall to zero under `RB-11`), is the zero-amount allocation row retained in the new version or dropped? | **Retain** (`RB-10`). The expense stays visible at `0.00` where the person is looking, `allocationCount` is stable, and the change is reversible from the same row. Dropping is a set change, which is the whole-expense editor's job. |
| `OQ-SPLIT-002` | May the person pin other shares as fixed during a rebalance in this increment? | **Not in this increment.** The rule is stated with the pinned set `P` (`RB-04`, `RB-14`) and the body reserves `pinnedCategoryIds`, so adding it later changes no clause and no shape. Ship two-and-three-share editing first; pinning is a preview-heavy interaction that needs its own browser proof. |
| `OQ-SPLIT-003` | May a share be set outside the segment `[0, T]` (a negative share within an expense, or a share larger than the total, forcing the others to flip sign)? | **Refuse** (`RB-04`, `allocation_share_out_of_range`). The model admits mixed signs, but "rebalance the others proportionally" has no honest meaning once they must change sign, and the existing whole-version `PATCH` remains the way to write such a set deliberately. |
| `OQ-SPLIT-004` | Authorization cell: reuse `9.edit_manual_transaction` (no `p6`), or define a distinct cell for share rebalancing in a `p6`? | **Reuse; no `p6`.** CBD-72 row 9 already grants the edit; a narrower input is not a new permission. A distinct cell would only matter if some role should rebalance but not edit, which CBD-72 does not define. |
| `OQ-SPLIT-005` | Should the existing whole-version `PATCH` also gain `expectedRevision` so that CBD-200-AC04 has the same stale-screen guard everywhere? | **Yes, in the same implementation packet**, as an optional field that is enforced when present, so the web can send it without breaking any caller that does not. Not required for this surface. |
| `OQ-SPLIT-006` | When every free share is currently zero, split the new remainder equally (`RB-08`) or refuse? | **Equal split.** Refusing would trap an expense whose shares were moved entirely into one category (`RB-11`) with no way back except removal. |

> **Note on the shared precondition shape** (`PROTO-CBD200-CONCURRENCY-IDEMPOTENCY-001`, September 16, 2026; the Executive's answer to `OQ-SPLIT-005` as merged). The whole-version `PATCH` and `POST .../remove` now accept an optional basis as `expectedTransactionVersionId` in the body or `If-Match` carrying the same version id, and refuse `409 {"error": "stale_version", "current": {"transactionVersionId", "revision"}}` with nothing written when it is not current. That is the one precondition shape; the share-edit route of §6 reuses it in place of `expectedRevision` (a body that states `expectedRevision` without `expectedTransactionVersionId` is refused `invalid_request`, not ignored), and `SPLIT-EDIT-AC06` and example 8 read `stale_version` where they say `conflict`. The version id is the basis rather than the revision because it is what the detail read and every mutation response already carry, and because a stale client learns the current version from the refusal itself. The same packet added `Idempotency-Key` to the three manual-transaction actions, which supersedes the "no operation identity" reading in §8 for CBD-200-AC05.
| `OQ-SPLIT-007` | A request that changes nothing: write a version anyway, or answer `changed: false` with no write (`RB-12`)? | **No write.** A revision that differs in nothing pollutes the history and the audit for no financial change. |
| `OQ-SPLIT-008` | Change the interim refusal copy now, before the surface exists? | **No.** Walkthrough step 15 asserts it verbatim; the implementation packet rewrites both together (§4, §9 item 5). |

## 12. Acceptance-criteria traceability for this packet

| Packet criterion | Where met |
| --- | --- |
| `SPLIT-P-01` — the rebalance rule stated exactly with every edge case and a worked example; acceptance criteria carry identifiers; the authorization cell and version consequences are named | §3 `RB-01`–`RB-14`, §3.1 examples 1–8, §7 `SPLIT-EDIT-AC01`–`AC14`, §5 |
| `SPLIT-P-02` — open questions carry recommendations; gates pass; PR opened | §11 `OQ-SPLIT-001`–`008`; the PR body carries the gate lines |

## 13. Revision history

| Version | Date | Author | Change |
| --- | --- | --- | --- |
| 0.1 | September 15, 2026 | Product, `PROTO-SPLIT-EXPENSE-EDIT-PRODUCT-001` | First proposal. |
