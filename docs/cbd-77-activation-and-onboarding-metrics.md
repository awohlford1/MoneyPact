# CBD-77 — Activation and Onboarding Metrics

| Field | Value |
| --- | --- |
| Status | **Draft v0.1 — not approved.** Defines the eight activation and onboarding metrics for the private beta, each as an `AN-92-005` aggregate over operational state. **No analytics event is proposed, because `AN-92-001` disables the behavioural event pipeline for Private MVP.** Every metric is `global` release form under decision 2, computed inside the Worker boundary. §3 states the usable-budget condition the criteria turn on; §6 records the two places this package could not rest on an approved source |
| Document version | 0.1 |
| Owner | Alexander Wohlford |
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
| **Category** | The space has at least one spending category | `SD-071-010` — spending targets, expected income, actual income, current cash and pending activity are the period's stated quantities |
| **Allocation** | At least one category carries a target for the current period | `SD-071-005` / `SD-071-027` — category targets exist per period and prorate on transition |
| **Account or transaction** | At least one manual account exists, **or** at least one transaction is classified into a period | `CA-92-004` explicit budget-space link; `SD-071-035` — a reliable date, not transaction time, determines period classification |

**The disjunction in the fifth limb is deliberate.** `CBD-77-AC04` requires activation to be measurable before bank connectivity, and `SD-071-035` classifies a transaction on a reliable date rather than on a connection. A space with a manual account and no transaction is usable; so is a space with a classified transaction and no account record. Requiring both would make the metric unmeasurable during the manual-product beta, which is the failure `AC04` exists to prevent.

**`UB-77-001` is a state condition, not a sequence.** It does not say the limbs were satisfied in an order, and no metric here asserts one.

## 4. The metrics

Every metric below is `Class: aggregate-state`, `Release form: global`, `Boundary: worker`, and `Owner: product` unless stated. Those four are constant across this package and are not repeated per record.

### MT-77-001 — Space creation rate

| Field | Value |
| --- | --- |
| Purpose | Whether accounts that reach the product create a budget space at all. Supports the decision to change onboarding before, or instead of, changing the budget builder |
| Formula | spaces_created_subjects ÷ eligible_subjects |
| Numerator | Account subjects with at least one budget space in any state |
| Denominator | Account subjects whose account exists at window close, excluding subjects created after the window opened minus the grace interval (§5) |
| Measurement source | `budget_space.subject_has_space_count` *(proposed)*, `account_subject.active_count` *(proposed)* |
| Interval basis | Opens when an account subject exists; closes when that subject has one budget space |
| Window | Calendar week, UTC, both bounds inclusive of the window's own days |
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
| Numerator | Budget spaces holding at least one materialized period |
| Denominator | Budget spaces created in the window and not archived at window close (§5) |
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
| Numerator | Budget spaces satisfying all five `UB-77-001` limbs at window close |
| Denominator | Budget spaces created in the window and not archived at window close (§5) |
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
| Numerator | Budget spaces holding at least one manual account |
| Denominator | Budget spaces holding at least one materialized period at window close. **Not all created spaces** — a space with no period has no context in which an account is meaningful |
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

Stated once and applied by every metric above, per conventions §6.

**Eligibility is evaluated at window close, not at window open.** A budget space created on the last day of a window is in that window's denominator. This is a choice, and the alternative — a grace interval excluding late entrants — is rejected because it would make the denominator depend on a per-space age, which is a per-subject property the release form does not carry.

**`MT-77-001` is the exception and states its grace interval explicitly.** An account subject that exists for minutes before window close has not declined to create a space. Its denominator excludes subjects created within the final 24 hours of the window, and the excluded count is not released separately.

**Archived spaces leave the denominator.** A space archived per `INC-76-010` before window close is excluded from both numerator and denominator. Retaining it would report the archival as an activation failure, which it is not.

**Retries and abandonment count once.** Each denominator counts **spaces or subjects**, both of which have one current state, so a person who abandons and restarts within one space contributes one row. A person who creates a second space contributes two, and that is correct: two spaces were created and the second is genuinely a further activation opportunity.

**A zero denominator is reported as `no eligible population`, not as zero percent.** During the first windows of the beta this will be common and must not read as a failure.

## 6. What this package could not settle

| ID | Item | Effect |
| --- | --- | --- |
| `OQ-77-001` | **The conventions pin CBD-76 as the governing scope source, and it is not the scope source for activation.** CBD-76's thirty rows are the CBD-12 oversight boundary; none is a period, category, allocation, account or transaction. §1.1 records the sources actually used | Recorded against the conventions, which own the pin. **No metric here changes** — this package used `SD-071-*` and `CA-92-*`, which do define the states. It matters for CBD-78 and CBD-79 as much as for this package |
| `OQ-77-002` | **The suppression population is not a number.** Conventions §8 sets the rule and declines to set a minimum, because decision 2 releases no cells. Every `Suppression` field above therefore names the condition without a threshold, and `MT-77-004` and `MT-77-005` say only that theirs is *higher* | CBD-81 owns the number. Until it exists, no metric here can state when it releases rather than withholds, which makes the suppression rule unenforceable in practice |
| `OQ-77-003` | **`CBD-82` is the elaboration of the financial-profile model and is Draft v0.1.** The profile limb of `UB-77-001` rests on `CA-92-012`, which is approved, so the limb stands. What is not settled is the *observable* form of a profile — whether "has one financial profile" is a row, a completeness state, or a set of required fields | `MT-77-003` and `MT-77-005` depend on the answer through `UB-77-001`. Recorded rather than guessed; CBD-80 records the state of record per source and will need it |
| `OI-77-001` | **Eight metrics propose nine measurement sources and none exists.** Every source is marked `proposed` per conventions §3, and CBD-80 assigns the `MS-80-nnn` identifiers and may rename | Expected, not a defect: the conventions define the proposal-then-assign flow precisely so these two packages do not edit each other. It does mean **no metric here is computable until CBD-80 completes** |
| `OI-77-002` | **Nothing in this package has been measured.** The product is not built: budget spaces, periods, categories and manual transactions are approved designs, not running tables. Every `Data source` names where the state *will* live | The metrics are specifications, not results. A later reader should not mistake a defined metric for an observed one |
