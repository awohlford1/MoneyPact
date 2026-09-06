# CBD-77 — Activation and Onboarding Metrics

| Field | Value |
| --- | --- |
| Status | **Draft amendment v1.1 to approved v1.0**. Executive approved the exact activation semantics in `CBD13-ACTIVATION-001`; this candidate awaits independent review. Prior approvals and unrelated decisions remain in force; no whole-package approval, computation, release or closure is inferred |
| Document version | 1.1 |
| Owner | Alexander Wohlford |
| Reviewer | Independent review pending for this amendment; prior approved baseline review remains historical |
| Jira | [CBD-77](https://cobudget.atlassian.net/browse/CBD-77) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Governing measurement contract | CBD-92 `AN-92-001`–`AN-92-007`, approved |
| Governing schedule decisions | `docs/cbd-71-mvp-schedule-decision-register.md` — Document version **1.1**, approved |
| Governing account model | CBD-92 `CA-92-001`–`CA-92-012`, approved |
| Consuming packages | CBD-80 (measurement-source register); CBD-81 (targets and review) |
| Confluence page | **Not published.** Registration follows approval |
| Last updated | September 5, 2026 |

## 1. Purpose and authority

CBD-77 defines what activation means for the private beta and how it is measured. It defines eight metrics and nothing else: it proposes no target, assigns no threshold, and creates no measurement source register — those are CBD-81's and CBD-80's.

**Every rule of form comes from the approved conventions.** This document does not restate them; where it appears to decide a convention, the conventions control and this document is wrong.

### 1.1 A correction to the pinned scope source

The conventions name **CBD-76** as *"Governing scope source — supplies the stable Private-MVP scope that CBD-77, CBD-78, and CBD-79 measure against."*

**That is not the scope source for activation.** CBD-76's thirty classification rows are the CBD-12 oversight boundary — roles, invitations, alerts, notification privacy, export, archival, comments. **None of them is a budget period, a category, an allocation, a manual account, or a transaction**, which are the five things `CBD-77-AC03` requires this package to define.

The scope this package measures against is:

| Source | Supplies | Standing |
| --- | --- | --- |
| `docs/cbd-71-mvp-schedule-decision-register.md` v1.1 | Periods, cadences, anchors, category targets, transaction classification — 88 `SD-071-*` decisions consolidating CBD-67 through CBD-70 | **Approved** |
| CBD-92 `CA-92-001`–`CA-92-012` | The financial profile, its stewardship, and the budget-space account link | **Approved** |
| CBD-76 | The oversight capabilities CBD-78 and CBD-79 measure. Relevant to this package only through `PRO-76-*`, which no activation metric may measure toward | Approved |

`OQ-77-001` records the correction back to the conventions. **It changes no metric here**, because this package used the sources that actually define the states, and it matters for CBD-78 and CBD-79 as much as for this one.

## 2. What activation is not

Three statements, because activation is the metric family most likely to be built as a funnel.

**No metric here observes a person progressing through steps.** `AN-92-001` disables user journeys and funnels. Each metric counts a **state reached** in the system of record, and the difference is not cosmetic: a funnel needs a per-person attempt record, and a state count does not.

**No metric counts attempts.** `CBD-77-AC06` requires that abandonment and retry not inflate completion, and the conventions §6 make this a property of the derivation rather than a deduplication rule. A person who abandons and retries five times contributes **one** budget space in the denominator and **one** outcome in the numerator, because the derivation reads the space's current state and a space has one state.

**No metric is released segmented.** Decision 2 of the conventions releases global figures only during the beta. Every `Release form` below is `global`, and any other value is a defect.

## 3. The usable-budget condition

`CBD-77-AC02` requires first budget period creation and usable-budget completion to be defined **separately**, and `CBD-77-AC03` requires the usable-budget definition to state a minimum profile, period, category, allocation, and account or transaction.

**`UB-77-001` — a budget space is usable when all five hold simultaneously.**

| Limb | Condition | Approved source |
| --- | --- | --- |
| **Profile** | The account subject has one financial profile | `CA-92-012` — one financial profile per account subject for Private MVP |
| **Period** | The space has at least one materialized period whose boundaries are settled by its cadence | `SD-071-021` — initial weekly or monthly setup opens the complete current anchored period |
| **Category** | The space has at least one spending category | **Presupposed, not defined.** `SD-071-005`, `SD-071-014`, `SD-071-027` and `SD-071-041` all operate on categories — prorating their targets, recording their provisional impact — and none defines the entity. `SD-071-010` establishes that spending targets are a state distinct from actual spending. See `OQ-77-004` |
| **Allocation** | At least one category carries a target for the current period | `SD-071-005` / `SD-071-027` — category targets exist per period and prorate on transition |
| **Account or transaction** | At least one manual account exists, **or** at least one transaction is classified into a period | `CA-92-004` explicit budget-space link; `SD-071-035` — a reliable date, not transaction time, determines period classification |

**The disjunction in the fifth limb is deliberate.** `CBD-77-AC04` requires activation to be measurable before bank connectivity, and `SD-071-035` classifies a transaction on a reliable date rather than on a connection. A space with a manual account and no transaction is usable; so is a space with a classified transaction and no account record. Requiring both would make the metric unmeasurable during the manual-product beta, which is the failure `AC04` exists to prevent.

**`UB-77-001` is a state condition, not a sequence.** It does not say the limbs were satisfied in an order, and no metric here asserts one.

**One limb rests on a presupposition, and the approval review found it.** Four approved decisions operate on categories and none defines one; the defining specification is CBD-30, which is in Planning. The limb is sound — a category either exists in a space or does not, and the product cannot prorate a target for an entity it lacks — but it is the only limb of the five whose citation is inferential rather than definitional. `OQ-77-004` records it, and the audit did not catch it because it checks that a limb **cites** an approved source, not that the source **says** what the limb claims.

## 4. The metrics

Every metric below is `Class: aggregate-state`, `Release form: global`, `Boundary: worker`, and `Owner: product` unless stated. Those four are constant across this package and are not repeated per record.

### MT-77-001 — Space creation rate

| Field | Value |
| --- | --- |
| Purpose | Whether accounts that reach the product create a budget space at all. Supports the decision to change onboarding before, or instead of, changing the budget builder |
| Formula | spaces_created_subjects ÷ eligible_subjects |
| Numerator | Those same eligible subjects holding at least one extant associated budget space in any state immediately before C; archived-only success counts under the explicit subject-milestone exception in §5 |
| Denominator | Distinct account subjects existing immediately before C with creation time strictly before C minus 24 hours; creation exactly at the cutoff is excluded (§5) |
| Measurement source | `budget_space.subject_has_space_count` *(proposed)*, `account_subject.active_count` *(proposed)* |
| Interval basis | Opens when an account subject exists; closes when that subject has one budget space |
| Window | UTC calendar week [O,C), Monday boundaries; evaluate state immediately before exclusive close C (§5) |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, budget-space and account-subject tables |
| Collection method | Scheduled aggregate in the Worker; counts current state, retains no contributing rows |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | A materially smaller share of subjects hold a space than in the prior window, with no release or onboarding change to explain it |

### MT-77-002 — First budget period rate

| Field | Value |
| --- | --- |
| Purpose | Whether a created space reaches a materialized period. Separates *"made a space"* from *"has a budget"*, which `CBD-77-AC02` requires |
| Formula | spaces_with_period ÷ spaces_created |
| Numerator | Those same eligible spaces holding at least one materialized period immediately before C |
| Denominator | Distinct extant budget spaces created O <= creation < C and not archived immediately before C (§5) |
| Measurement source | `budget_period.space_has_period_count` *(proposed)*, `budget_space.created_count` *(proposed)* |
| Interval basis | Opens when a budget space exists; closes when that space holds one materialized period per `SD-071-021` |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, budget-period table |
| Collection method | Scheduled aggregate in the Worker; counts current state |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Spaces are created and do not reach a period, which points at the cadence step rather than at onboarding |

### MT-77-003 — Usable-budget completion rate

| Field | Value |
| --- | --- |
| Purpose | The headline activation measure. Whether a space reaches the state from which the product is usable at all — `UB-77-001` |
| Formula | spaces_meeting_UB_77_001 ÷ spaces_created |
| Numerator | Those same eligible spaces satisfying all five `UB-77-001` limbs simultaneously immediately before C; profile/category evidence dependencies remain open |
| Denominator | Distinct extant budget spaces created O <= creation < C and not archived immediately before C (§5) |
| Measurement source | `budget_space.usable_state_count` *(proposed)*, `budget_space.created_count` *(proposed)* |
| Interval basis | Opens when a budget space exists; closes when all five `UB-77-001` limbs hold simultaneously |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` — the fifth limb's disjunction is what makes this true (§3) |
| Data source | Application database; the derivation reads five tables and returns one boolean per space |
| Collection method | Scheduled aggregate in the Worker. **The five limbs are evaluated together at window close, not accumulated as they are met**, so no per-space progress record exists |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Spaces reach a period but not usability, which isolates the category or allocation step |

### MT-77-004 — Time to first budget period

| Field | Value |
| --- | --- |
| Purpose | Whether reaching a period is slow rather than rare. `MT-77-002` and this metric answer different questions and neither substitutes |
| Formula | p50 and p90 of (first period materialized at − space created at), in hours |
| Numerator | `n/a` — a distribution, not a rate |
| Denominator | `n/a` — the measured population is the numerator population |
| Measurement source | `budget_period.first_materialized_interval` *(proposed)* |
| Interval basis | Opens when a budget space exists; closes when its first period is materialized |
| Window | Calendar week, UTC, on spaces that reached a period within the window |
| Suppression | `withheld — population below release threshold`. **A percentile over a small population is itself a disclosure**, per conventions §8, so this metric is withheld at a higher population than the rate metrics |
| Connectivity | `MANUAL-OK` |
| Data source | Application database; both timestamps are already held for their own operational purposes |
| Collection method | Scheduled aggregate in the Worker; percentiles computed and released, contributing intervals not retained |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | p90 lengthens while `MT-77-002` holds steady, which means the step is completed but laboured |

### MT-77-005 — Time to usable budget

| Field | Value |
| --- | --- |
| Purpose | The elapsed cost of reaching `UB-77-001`. The measure most likely to justify changing the budget builder |
| Formula | p50 and p90 of (fifth `UB-77-001` limb satisfied at − space created at), in hours |
| Numerator | `n/a` — a distribution, not a rate |
| Denominator | `n/a` — the measured population is the numerator population |
| Measurement source | `budget_space.usable_interval` *(proposed)* |
| Interval basis | Opens when a budget space exists; closes when the last of the five `UB-77-001` limbs is satisfied |
| Window | Calendar week, UTC, on spaces that became usable within the window |
| Suppression | `withheld — population below release threshold`, at the same higher population as `MT-77-004` |
| Connectivity | `MANUAL-OK` |
| Data source | Application database |
| Collection method | Scheduled aggregate in the Worker. **The closing timestamp is the maximum of the five limb timestamps**, which is a computation over current state and not a progress log |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | p90 materially exceeds `MT-77-004`'s, isolating the cost to the steps after the period |

### MT-77-006 — Manual-account activation rate

| Field | Value |
| --- | --- |
| Purpose | Whether the manual product works without bank connectivity, which `CBD-77-AC04` requires to be measurable now rather than after CBD-47 |
| Formula | spaces_with_manual_account ÷ spaces_with_period |
| Numerator | Those same eligible spaces holding at least one currently linked manual account immediately before C; periodless account-bearing spaces do not count |
| Denominator | Distinct extant nonarchived budget spaces holding at least one materialized period immediately before C, regardless of creation week (§5) |
| Measurement source | `financial_account.space_manual_count` *(proposed)*, `budget_period.space_has_period_count` *(proposed)* |
| Interval basis | Opens when a space holds a period; closes when that space holds one manual account |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, financial-account table, filtered to manually created records |
| Collection method | Scheduled aggregate in the Worker |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Spaces hold periods but no accounts, which suggests the manual path is not discoverable |

### MT-77-007 — Manual-transaction activation rate

| Field | Value |
| --- | --- |
| Purpose | Whether a space records spending at all. The other half of `CBD-77-AC04`, and the limb that makes a budget consequential rather than configured |
| Formula | spaces_with_classified_transaction ÷ spaces_with_period |
| Numerator | Budget spaces holding at least one manually entered transaction classified into a period per `SD-071-035` |
| Denominator | Budget spaces holding at least one materialized period at window close |
| Measurement source | `transaction.space_manual_classified_count` *(proposed)*, `budget_period.space_has_period_count` *(proposed)* |
| Interval basis | Opens when a space holds a period; closes when that space holds one classified manual transaction |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, transaction table, filtered to manual entry |
| Collection method | Scheduled aggregate in the Worker. **The count is of transactions classified into a period**, not of transactions created, because `SD-071-035` makes classification the state that matters |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Accounts exist without transactions, which means the budget is configured and unused |

### MT-77-008 — Category-target completion rate

| Field | Value |
| --- | --- |
| Purpose | Isolates the allocation limb of `UB-77-001`. `MT-77-003` reports whether the whole condition is met; this reports whether the step most likely to be skipped is |
| Formula | spaces_with_category_target ÷ spaces_with_category |
| Numerator | Budget spaces where at least one category carries a target for the current period |
| Denominator | Budget spaces holding at least one spending category at window close |
| Measurement source | `category_target.space_has_target_count` *(proposed)*, `category.space_has_category_count` *(proposed)* |
| Interval basis | Opens when a space holds a category; closes when one category carries a current-period target |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, category and category-target tables |
| Collection method | Scheduled aggregate in the Worker. Reads the target for the **current** period, so a transition-prorated target per `SD-071-027` counts as present |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Categories exist without targets, which makes the budget descriptive rather than a plan |

## 5. Denominator rules

Stated once and applied by every metric above, per conventions §6. The activation correction in `CBD13-ACTIVATION-001` was approved by the Executive; this draft amendment awaits independent review and does not approve the whole package.

**Windows are UTC calendar weeks [O,C), with Monday 00:00 boundaries.** Evaluate operational state immediately before C. Creation exactly at C belongs to the next window. For MT-77-001/002/003/006, completion means qualifying state at close, not a separately tracked completion during the week. A late-created space is eligible for MT-77-002/003 if it exists and is not archived at close; there is no space grace period.

**`MT-77-001` alone has a grace interval.** Its denominator contains subjects existing immediately before C whose creation time is strictly before C minus 24 hours. The final 24-hour interval includes its opening cutoff, so a subject created exactly at C minus 24 hours is excluded. Its numerator is restricted to those same subjects. Older successful subjects count: this is a standing subject population, not a newly-created-subject population. No excluded count is separately released.

**Archived spaces leave space-based populations.** A space archived per `INC-76-010` before close is excluded from both numerator and denominator. MT-77-001 is explicitly excepted: an extant associated space in any state, including archived-only success, still proves the subject's space-creation milestone. A deleted, absent space does not prove success. MT-77-002/003 exclude older successful spaces and newly archived spaces from both sides; MT-77-006 includes older nonarchived period-holding spaces and excludes periodless spaces from both sides.

**Every rate numerator is a subset of its denominator.** Count distinct subjects for MT-77-001 and distinct spaces for space rates; multiple periods, accounts or joins never multiply membership. Compute the MT-77-002 creation-window intersection separately from the broad period-holding population MT-77-006/007 consume. Neither population membership nor contributing rows are persisted. A zero denominator uses the existing privacy-gated `no eligible population` disposition, never zero or 100 percent; where that disposition cannot safely be released, withhold it under the governing release policy.

**Retries and abandonment count once.** Each denominator counts distinct spaces or subjects. Abandoning and restarting within one space does not add membership. In space-based metrics a person creating two eligible spaces contributes two spaces, not retry records; MT-77-001 still counts that subject once.

**A zero denominator never becomes a percentage.** Release `no eligible population` only when permitted by the governing privacy policy; otherwise withhold the disposition as stated above.

## 6. What this package could not settle

| ID | Item | Effect |
| --- | --- | --- |
| `OQ-77-001` | **The conventions pin CBD-76 as the governing scope source, and it is not the scope source for activation.** CBD-76's thirty rows are the CBD-12 oversight boundary; none is a period, category, allocation, account or transaction. §1.1 records the sources actually used | Recorded against the conventions, which own the pin. **No metric here changes** — this package used `SD-071-*` and `CA-92-*`, which do define the states. It matters for CBD-78 and CBD-79 as much as for this package |
| `OQ-77-002` | **The suppression population is not a number.** Conventions §8 sets the rule and declines to set a minimum, because decision 2 releases no cells. Every `Suppression` field above therefore names the condition without a threshold, and `MT-77-004` and `MT-77-005` say only that theirs is *higher* | CBD-81 owns the number. Until it exists, no metric here can state when it releases rather than withholds, which makes the suppression rule unenforceable in practice |
| `OQ-77-003` | **`CBD-82` is the elaboration of the financial-profile model and is Draft v0.1.** The profile limb of `UB-77-001` rests on `CA-92-012`, which is approved, so the limb stands. What is not settled is the *observable* form of a profile — whether "has one financial profile" is a row, a completeness state, or a set of required fields | `MT-77-003` and `MT-77-005` depend on the answer through `UB-77-001`. Recorded rather than guessed; CBD-80 records the state of record per source and will need it |
| `OQ-77-004` | **The `UB-77-001` category limb has no defining approved source.** `SD-071-005`, `SD-071-014`, `SD-071-027` and `SD-071-041` presuppose categories; none defines the entity, and `SD-071-010` establishes only that spending targets are a distinct state. CBD-30 is the defining specification and is in Planning | The limb stands — the product cannot prorate a target for a category that does not exist — but it is inferential where the other four are definitional. **Found by the approval review, not by the audit**, which checks that a limb cites a source rather than that the source supports it |
| `OI-77-001` | **Eight metrics propose nine measurement sources and none exists.** Every source is marked `proposed` per conventions §3, and CBD-80 assigns the `MS-80-nnn` identifiers and may rename | Expected, not a defect: the conventions define the proposal-then-assign flow precisely so these two packages do not edit each other. It does mean **no metric here is computable until CBD-80 completes** |
| `OI-77-002` | **Nothing in this package has been measured.** The product is not built: budget spaces, periods, categories and manual transactions are approved designs, not running tables. Every `Data source` names where the state *will* live | The metrics are specifications, not results. A later reader should not mistake a defined metric for an observed one |


**Unresolved timing evidence for MT-77-005:** the maximum of the five current limb timestamps does not by itself prove the first time all limbs held simultaneously after replacement, deletion or current-period changes. The source owner must establish timestamp meanings and historical coexistence from already authorized operational state. Do not substitute `updated_at`, accumulate progress, retain measurement history, or claim this interval computable before that proof. No replacement timing semantics are approved by the activation correction. `OQ-77-003` and `OQ-77-004` also remain open.

## Activation amendment record

| Version | Basis | Change | Status |
| --- | --- | --- | --- |
| 1.1 | Approved baseline v1.0; Executive decision `CBD13-ACTIVATION-001`, September 5, 2026 | Correct MT-77-001/002/003/006 population intersections, exclusive-close UTC week, grace boundary, archived-space exception, consumer-specific period counts and privacy-gated empty population. Preserve source IDs and all other decisions | Draft amendment; independent review pending |
