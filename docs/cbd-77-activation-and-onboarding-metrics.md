# CBD-77 — Activation and Onboarding Metrics

| Field | Value |
| --- | --- |
| Status | **Accepted specification v1.2** under CBD13-FINAL-ACCEPTANCE-001, with all recorded decisions and exceptions preserved. CBD13-FINAL-REVIEW-002 approves the integrated package and closes both prior findings; CBD13-FINAL-SECURITY-002 clears specification privacy only. No runtime measurement, numerical reporting, beta launch, deployment or Jira Done claimed |
| Document version | 1.2 |
| Owner | Alexander Wohlford |
| Reviewer | Independent CBD13-FINAL-REVIEW-002: approve; CBD13-FINAL-SECURITY-002: clear for specification privacy acceptance |
| Jira | [CBD-77](https://cobudget.atlassian.net/browse/CBD-77) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Governing measurement contract | CBD-92 `AN-92-001`–`AN-92-007`, approved |
| Governing schedule decisions | `docs/cbd-71-mvp-schedule-decision-register.md` — Document version **1.1**, approved |
| Governing account model | CBD-92 `CA-92-001`–`CA-92-012`, approved |
| Consuming packages | CBD-80 (measurement-source register); CBD-81 (targets and review) |
| Confluence page | [CBD-77 — Activation and Onboarding Metrics](https://cobudget.atlassian.net/wiki/spaces/CBD/pages/20774913) |
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
| **Profile** | At window close, the measured space's current active Primary Owner (PM-72-008) has exactly one extant active person-level financial-profile authority domain (CA-92-012). An existing empty profile counts; no profile fails. Multiple active profiles or ambiguous association invalidate the source, not normal onboarding failure. Deletion-pending, terminated and retained-history-only profiles do not qualify | `CBD13-PROFILE-001`; `PM-72-008`; `CA-92-012` |
| **Period** | The space has at least one materialized period whose boundaries are settled by its cadence | `SD-071-021` — initial weekly or monthly setup opens the complete current anchored period |
| **Category** | The space has at least one qualifying category: an extant stable-identity entity owned by the measured budget space, designated expense budgeting, currently usable for expense classification and category-target planning. Exclude income/transfer classifications, uncategorized placeholders, display groups, historical-only references and archived/deleted/replaced-only/inactive categories. Rename/reorder preserve identity; recreation creates a different identity. Neither actual spending nor a target is required | `CBD13-CATEGORY-001` defines the logical predicate; `SD-071-005` / `SD-071-027` support targets, not the complete category predicate |
| **Allocation** | At least one qualifying category from the Category limb carries a current-period target. An explicitly stored zero qualifies; a missing target does not. Approved transition-prorated targets count | `CBD13-CATEGORY-001`; `SD-071-005` / `SD-071-027` |
| **Account or transaction** | At least one manual account exists, **or** at least one transaction is classified into a period | `CA-92-004` explicit budget-space link; `SD-071-035` — a reliable date, not transaction time, determines period classification |

**The disjunction in the fifth limb is deliberate.** `CBD-77-AC04` requires activation to be measurable before bank connectivity, and `SD-071-035` classifies a transaction on a reliable date rather than on a connection. A space with a manual account and no transaction is usable; so is a space with a classified transaction and no account record. Requiring both would make the metric unmeasurable during the manual-product beta, which is the failure `AC04` exists to prevent.

**`UB-77-001` is a state condition, not a sequence.** It does not say the limbs were satisfied in an order, and no metric here asserts one.

**Logical meanings are settled; physical bindings remain future.** `CBD13-PROFILE-001` and `CBD13-CATEGORY-001` settle `OQ-77-003/004` only at the measurement-definition level. The profile limb requires no account, balance, connection, transaction, preference completion or positive value. Zero profiles before first use differs from an existing empty profile. No member gains private-profile access. CBD-82/CBD-30 feature owners must supply authorized schema bindings and proof of the exact association, lifecycle, category identity and current-target predicates; CBD-80 records those dependencies. No full feature design, permission, collection or retention change is approved.

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
| Numerator | Those same eligible spaces satisfying all five `UB-77-001` limbs simultaneously immediately before C; approved profile/category logical predicates apply; physical binding and verification dependencies remain open |
| Denominator | Distinct extant budget spaces created O <= creation < C and not archived immediately before C (§5) |
| Measurement source | `budget_space.usable_state_count` *(proposed)*, `budget_space.created_count` *(proposed)* |
| Interval basis | Opens when a budget space exists; closes when all five `UB-77-001` limbs hold simultaneously |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` — the fifth limb's disjunction is what makes this true (§3) |
| Data source | Authorized operational state for the five limbs; physical schema bindings remain future, and the derivation returns one boolean per space |
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
| Formula | p50 and p90 of (first simultaneous `UB-77-001` satisfaction at − space created at), in hours |
| Numerator | `n/a` — a distribution, not a rate |
| Denominator | `n/a` — the measured population is the numerator population |
| Measurement source | `budget_space.usable_interval` *(proposed)* |
| Interval basis | Opens when a budget space exists; closes at first simultaneous satisfaction of all five `UB-77-001` limbs; preserved for future applicability |
| Window | Calendar week, UTC, on spaces that became usable within the window |
| Suppression | `withheld — population below release threshold`, at the same higher population as `MT-77-004` |
| Connectivity | `MANUAL-OK` |
| Data source | Future approved operational-source contract proving first simultaneous satisfaction under replacement, deletion and period changes; unavailable during Private MVP |
| Collection method | **Deferred/unavailable for Private MVP** under `CBD13-USABLE-TIME-001`. No maximum of current timestamps, `updated_at`, budget date or newly retained measurement history may substitute for first simultaneous satisfaction. Source-owner proof and an approved operational-source contract are required before future computation |
| Review cadence | Weekly and W4 baseline preserved for future applicability; no baseline credit or successful timing claim while deferred |
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
| Numerator | Those same denominator-eligible spaces where at least one category in the same qualifying set carries a current-period target; explicitly stored zero and approved transition-prorated targets qualify, missing target does not |
| Denominator | Distinct extant nonarchived budget spaces holding at least one qualifying Category-limb entity from `UB-77-001` immediately before C |
| Measurement source | `category_target.space_has_target_count` *(proposed)*, `category.space_has_category_count` *(proposed)* |
| Interval basis | Opens when a space holds a qualifying category; closes when a category in that same qualifying set carries a current-period target |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, category and category-target tables |
| Collection method | Scheduled aggregate in the Worker. Reads the target for the **current** period, so a transition-prorated target per `SD-071-027` counts as present |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Categories exist without targets, which makes the budget descriptive rather than a plan |

## 5. Denominator rules

Stated once and applied by every metric above, per conventions §6. The activation correction in `CBD13-ACTIVATION-001` was approved by the Executive; the prior activation amendment was independently reviewed and merged in PR #236; the predicate/timing specification is independently reviewed and accepted under CBD13-FINAL-ACCEPTANCE-001; implementation/release gates remain.

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
| `OQ-77-003` | **Logical meaning settled by `CBD13-PROFILE-001`.** Current active Primary Owner association and exactly one extant active profile; empty differs from absent (§3) | CBD-82 feature owner must bind and verify authorized physical state, association and lifecycle evidence. No completeness fields or private-profile access are added. MT-77-003 remains applicable; MT-77-005 is deferred |
| `OQ-77-004` | **Logical meaning settled by `CBD13-CATEGORY-001`.** Active expense-category identity and separate current-target/zero-target predicates are explicit in §3 | CBD-30 feature owner must bind and verify the predicate and target association in authorized operational state. Schedule sources alone did not establish the full definition. MT-77-008 uses the same qualifying set on both sides |
| `OI-77-001` | **Eight metrics propose nine measurement sources and none exists.** Every source is marked `proposed` per conventions §3, and CBD-80 assigns the `MS-80-nnn` identifiers and may rename | Expected, not a defect: the conventions define the proposal-then-assign flow precisely so these two packages do not edit each other. It does mean **no metric here is computable until CBD-80 completes** |
| `OI-77-002` | **Nothing in this package has been measured.** The product is not built: budget spaces, periods, categories and manual transactions are approved designs, not running tables. Every `Data source` names where the state *will* live | The metrics are specifications, not results. A later reader should not mistake a defined metric for an observed one |


**Approved timing scope disposition:** `CBD13-USABLE-TIME-001` defers MT-77-005 until an approved operational-source contract proves first simultaneous satisfaction under replacement/deletion/period changes. The metric, proposed source, intended interval, existing destination and future W4 baseline are preserved. Deferred/unavailable means no baseline credit or successful timing claim. Never substitute maximum current timestamps, `updated_at`, budget date or newly retained measurement history. Current-state MT-77-003 and all five limbs remain required/applicable; the profile/category logical questions are settled while physical binding and verification remain future.

## Activation amendment record

| Version | Basis | Change | Status |
| --- | --- | --- | --- |
| 1.1 | Approved baseline v1.0; Executive decision `CBD13-ACTIVATION-001`, September 5, 2026 | Correct MT-77-001/002/003/006 population intersections, exclusive-close UTC week, grace boundary, archived-space exception, consumer-specific period counts and privacy-gated empty population. Preserve source IDs and all other decisions | Independently reviewed and merged in PR #236; current candidate review remains pending |

## Usable-definition amendment record

| Version | Authority | Change | Status |
| --- | --- | --- | --- |
| 1.2 | `CBD13-PROFILE-001`; `CBD13-CATEGORY-001`; `CBD13-USABLE-TIME-001`; shared `CBD13-RETENTION-001` follow-through; `CBD81-BASELINE-001` | Exact profile/category/target predicates; MT-77-008 matching set; MT-77-005 deferred with future slot/interval/W4; CBD-80 retention-source feasibility restrictions. Prior approved activation populations, IDs, owners, destinations, account OR transaction choice and privacy gates preserved | Candidate; independent review pending; no measured result or Done claim |

## Final specification acceptance record

CBD13-FINAL-ACCEPTANCE-001 accepts the reviewed package at
`d4fc13ca47837c9b2faf83f4998aab2147bd5656`, including factual status updates.
CBD13-FINAL-REVIEW-002 approves source `ff93a9b1ab901b5b88ebc1cca855ab10916fe4af`
and the integrated package, closing both sent/sync findings. CBD13-FINAL-SECURITY-002 clears
specification privacy only. Earlier draft/candidate revision entries describe
history; this record establishes current acceptance without changing versions,
definitions, approved exceptions or future implementation/release gates.
Prior PRs #236/#237/#239/#240 are merged. Final source PR #242 merged at `1d1b2a8970f4f5bb5d7f72e98c462de0eb91e996` after required CI and verified GitHub readback. Its transport head 4d8aeaa added only already-merged CI wiring to reviewed source documents. The CBD-81 public PR is pending. Jira specification
evidence and Executive acceptance are ready; workflow closure awaits authorized
merges and verification. This document is published to Confluence from the
repository after merge under CBD-115; each run requires manual environment
approval and the repository remains the source.
