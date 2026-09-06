# CBD-77 — Acceptance Criteria Traceability and Completeness Report

| Field | Value |
| --- | --- |
| Status | **Accepted specification v1.2** under CBD13-FINAL-ACCEPTANCE-001, with all recorded decisions and exceptions preserved. CBD13-FINAL-REVIEW-002 approves the integrated package and closes both prior findings; CBD13-FINAL-SECURITY-002 clears specification privacy only. No runtime measurement, numerical reporting, beta launch, deployment or Jira Done claimed |
| Document version | 1.2 |
| Owner | Alexander Wohlford |
| Reviewer | Independent CBD13-FINAL-REVIEW-002: approve; CBD13-FINAL-SECURITY-002: clear for specification privacy acceptance |
| Jira | [CBD-77](https://cobudget.atlassian.net/browse/CBD-77) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Companion | `docs/cbd-77-activation-and-onboarding-metrics.md`, which this report checks |
| Mechanical audit | `scripts/audit-cbd-77.py` — 215 checks, every guard proven by deliberate violation |
| Confluence page | **Unpublished to Confluence.** No verified target; future registration/publication readiness separately gated |
| Last updated | September 5, 2026 |

## 1. Package contents

| Document | Purpose |
| --- | --- |
| `docs/cbd-77-activation-and-onboarding-metrics.md` | Eight metrics, the `UB-77-001` usable-budget condition, the denominator rules, and what the package could not settle |
| `docs/cbd-77-acceptance-criteria-traceability.md` | This report |
| `scripts/audit-cbd-77.py` | Structural audit: required fields, package constants, event-model leakage, identifier sequence, `UB-77-001` limb citations |

## 2. Acceptance criteria

### CBD-77-AC01 — numerator, denominator, interval basis, time window

**Status: Prior activation correction independently reviewed and merged; predicate/timing specification independently reviewed and accepted under CBD13-FINAL-ACCEPTANCE-001.** Metrics §4 and §5 implement Executive decision `CBD13-ACTIVATION-001`: MT-77-001/002/003/006 numerators are restricted to their denominator membership; [O,C) and the strict 24-hour cutoff are explicit. MT-77-001 preserves archived-only success as an exception, MT-77-002/003 exclude old or archived spaces, and MT-77-006 retains older period-holding spaces. MT-77-005 is explicitly deferred/unavailable under `CBD13-USABLE-TIME-001` as recorded below; field presence is not proof of computability.

All eight metrics carry `Numerator`, `Denominator`, `Interval basis` and `Window`, and the audit fails on a missing field rather than trusting the author. **`MT-77-004` and `MT-77-005` record `n/a` with a reason for numerator and denominator**, because a percentile distribution has neither, and the conventions require `n/a` to carry a reason rather than be omitted — which the audit also checks.

**Every interval basis is a state condition, not an event pair.** That is the substance of the September 5, 2026 amendment to this criterion: `AN-92-001` names user journeys and funnels, so an activation interval opens on *"a budget space exists"* and closes on *"that space holds one materialized period"*.

### CBD-77-AC02 — first budget period and usable-budget completion defined separately

**Status: Met.**

| Measure | Metric | What it answers |
| --- | --- | --- |
| First budget period creation | `MT-77-002` | Whether a space reaches a materialized period at all |
| Usable-budget completion | `MT-77-003` | Whether a space reaches all five `UB-77-001` limbs |

They are separate metrics with separate numerators, and §3 of the metrics document defines usability independently of period creation. `MT-77-004` and `MT-77-005` carry the same separation into the elapsed-time measures, preserving the intended distinction between slow and rare; MT-77-005 timing is deferred/unavailable and earns no baseline credit or successful timing claim.

### CBD-77-AC03 — usable-budget minimum limbs and explicit timing deferral

**Status: Approved logical meanings and timing scope disposition independently reviewed and accepted under CBD13-FINAL-ACCEPTANCE-001.** Metrics §3 specifies the current active Primary Owner profile-existence test, active expense-category predicate and separate current-target/zero-target rule under `CBD13-PROFILE-001` / `CBD13-CATEGORY-001`. `OQ-77-003/004` retain physical binding and verification dependencies. `CBD13-USABLE-TIME-001` explicitly defers MT-77-005; MT-77-003 and all five limbs remain required/applicable. Future timing needs approved source proof under replacement/deletion/period changes; no current timestamp maximum, updated_at, budget date or newly retained measurement history substitutes.

`UB-77-001` states all five limbs. The audit checks citation presence, not whether a cited source proves an observable predicate:

| Limb | Approved source |
| --- | --- |
| Profile | `CBD13-PROFILE-001`; `PM-72-008`; `CA-92-012`; exact current-owner association, empty vs absent, invalid ambiguous/multiple state in metrics §3 |
| Period | `SD-071-021` |
| Category | `CBD13-CATEGORY-001`; active expense-category identity and exclusions in metrics §3; CBD-30 physical binding/proof remains future |
| Allocation | `CBD13-CATEGORY-001`; `SD-071-005` / `SD-071-027`; target on the same qualifying category set, stored zero qualifies and missing fails |
| Account or transaction | `CA-92-004`, `SD-071-035` |

**The fifth limb is a disjunction, and that is a decision this package made.** An account *or* a transaction satisfies it. Requiring both would make the condition unmeasurable during the manual-product beta, which is the outcome `CBD-77-AC04` exists to prevent — so the two criteria are read together rather than separately.

### CBD-77-AC04 — manual-account and manual-transaction activation measurable before bank connectivity

**Status: Met.**

`MT-77-006` and `MT-77-007` measure them separately, and **all eight metrics are marked `MANUAL-OK`**. No metric in this package requires a bank connection, which is a stronger result than the criterion asks for and follows from measuring state rather than provider events.

`SD-071-035` is what makes it true: a transaction is classified into a period on a reliable date rather than on connection activity, so a manually entered transaction is as measurable as a synchronized one.

### CBD-77-AC05 — required measurement sources and attributes, data source, metric owner, review cadence

**Status: Met.**

Every metric records `Measurement source`, `Data source`, `Review cadence`, and takes `Owner: product` from the package constants in §4. **Nine sources are proposed and none is assigned**: the conventions §3 give CBD-80 the `MS-80-nnn` identifiers, and the audit fails if this package pre-empts one.

This criterion was amended on September 5, 2026 from *"required events, properties"*. **The amendment was found by `scripts/check-an92-criteria.py`, not by review** — three hand sweeps of the family had missed it, and it would have had this package define events that `AN-92-001` disables.

### CBD-77-AC06 — abandonment and retry do not inflate completion rates

**Status: Prior activation correction independently reviewed and merged; current specification independently reviewed and accepted under CBD13-FINAL-ACCEPTANCE-001.** Metrics §5 requires distinct subjects/spaces and numerator membership within the same denominator. Multiple periods/accounts or join rows cannot multiply contributors. MT-77-001 counts a subject once even with several spaces; the following space-count rule applies to space-based metrics.

§5 states the rule and §2 states why it holds structurally rather than by deduplication: **every denominator counts spaces or subjects, each of which has exactly one current state.** A person who abandons and restarts within one space contributes one row because the space contributes one row.

**A person who creates a second space contributes two, and that is deliberate.** Two spaces were created and the second is a genuine further activation opportunity, so counting it once would understate the denominator rather than protect it.

### The suppression dependency

**Status: Partially met, and it affects every criterion above.**

Every metric names its `Suppression` behaviour — `withheld — population below release threshold`, never a zero and never a blank. **No metric can say when it withholds**, because the conventions §8 set the rule and decline to set a number, and CBD-81 owns it.

`MT-77-004` and `MT-77-005` are the sharpest case: both say their threshold is *higher* than the rate metrics, because a percentile over a small population is itself a disclosure, and neither can say how much higher. Recorded at `OQ-77-002`.

## 3. Deliverables

| Deliverable | Status | Where |
| --- | --- | --- |
| Activation and onboarding metric definitions | **Met** — eight metrics, every conventions §4 field populated | Metrics §4 |
| Usable-budget definition | **Met** — `UB-77-001`, five limbs, each with an approved citation | Metrics §3 |
| Denominator and eligibility rules | **Met** | Metrics §5 |
| Measurement sources | **Proposed, not assigned** — by design; CBD-80 owns the register | Metrics §4, `OI-77-001` |
| Structural audit | **Met** — 215 checks, seven guards each proven by deliberate violation | `scripts/audit-cbd-77.py` |
| Targets and thresholds | **Not this package** — CBD-81 owns every number | Conventions §10 |

## 4. Where the ticket's text no longer matches what exists

### 4.1 The pinned scope source is wrong for this package

The approved conventions name CBD-76 as the governing scope source for CBD-77, CBD-78 and CBD-79. **CBD-76's thirty classification rows are the CBD-12 oversight boundary** — roles, invitations, alerts, notification privacy, export, archival, comments — and not one is a period, category, allocation, account or transaction.

This package used `SD-071-*` and `CA-92-*`, which do define those states and are equally approved. **No metric changes**, and the correction is recorded at `OQ-77-001` against the document that owns the pin. It applies to CBD-78 and CBD-79 as much as to this package, so it should be settled before either is written.

### 4.2 `CBD-77-AC05` was written against a model that no longer exists

Recorded here because the amendment is four hours old and a reader of the ticket alone would not know why the criterion changed. The original required *"required events, properties"*; `AN-92-001` disables the event pipeline; the criterion now requires measurement sources and their attributes. Conventions §11 carries all nine such amendments.

## 5. What this package does not establish

* **No metric has been measured.** The product is not built. Budget spaces, periods, categories and manual transactions are approved designs, not running tables, and every `Data source` names where state *will* live.
* **No metric is computable.** Nine measurement sources are proposed and none is assigned; CBD-80 completes them.
* **No target, threshold, or guardrail is set**, and none may be inferred from an `Unhealthy condition`, which is deliberately qualitative.
* **No release has been authorized.** `AN-92-005` permits the aggregate; whether a released figure reaches a surface, and which, is `OQ-13-006` and belongs to CBD-80.
* **This package was written and reviewed by the same person**, and inherits that limitation from the conventions it rests on.

## 6. Revision record

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 1.0 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | **Approved.** The review checked every cited identifier against its approved source rather than trusting the citation, and found one: the `UB-77-001` category limb cited `SD-071-010`, which establishes that spending targets are a distinct state and not that a space holds categories. Four decisions presuppose categories and none defines the entity; the limb is restated as inferential and recorded at `OQ-77-004`. **The audit did not catch it**, because it checks that a limb cites an approved source rather than that the source supports the claim. No metric, denominator, or figure changes | **Approved v1.0** |
| 0.1 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | Initial package: eight metrics, `UB-77-001`, denominator rules, structural audit, and this report. Records the CBD-76 scope-source correction at `OQ-77-001` and the suppression-threshold dependency at `OQ-77-002` | Superseded by 1.0 |


## Activation correction validation and handoff

The focused candidate maps CBD-77-AC01/06 to metrics §4/§5 and the corresponding CBD-80 source derivations. CBD-77-AC03 now incorporates the approved logical meanings and explicit timing deferral; physical binding and verification remain future. The existing documentation audit checks structural integrity only; independent semantic review must verify creation at O/C, creation exactly at C minus 24 hours, older success, archived-only subject success, deleted absent spaces, periodless manual accounts, duplicate joins and zero-denominator privacy behavior against the approved decision. No implementation, release-control or production measurement proof is claimed. Prior audit counts below describe the historical baseline.

## Activation amendment record

| Version | Basis | Change | Status |
| --- | --- | --- | --- |
| 1.1 | Approved baseline v1.0; Executive decision `CBD13-ACTIVATION-001`, September 5, 2026 | Correct MT-77-001/002/003/006 population intersections, exclusive-close UTC week, grace boundary, archived-space exception, consumer-specific period counts and privacy-gated empty population. Preserve source IDs and all other decisions | Independently reviewed and merged in PR #236; current candidate review remains pending |

## Usable-definition amendment record

| Version | Authority | Change | Status |
| --- | --- | --- | --- |
| 1.2 | `CBD13-PROFILE-001`; `CBD13-CATEGORY-001`; `CBD13-USABLE-TIME-001`; shared `CBD13-RETENTION-001` follow-through; `CBD81-BASELINE-001` | Exact profile/category/target predicates; MT-77-008 matching set; MT-77-005 deferred with future slot/interval/W4; CBD-80 retention-source feasibility restrictions. Prior approved activation populations, IDs, owners, destinations, account OR transaction choice and privacy gates preserved | Candidate; independent review pending; no measured result or Done claim |

## Current amendment criterion evidence and CBD-81 handoff

| Criterion / decision | Definition and source evidence | Remaining gate |
| --- | --- | --- |
| CBD-77-AC03; CBD13-PROFILE-001 | CBD-77 §3 Profile; CBD-80 MS-80-005 and Approved usable predicates section: current active Primary Owner, exactly one extant active person-level profile; empty qualifies, absent fails, ambiguous/multiple invalidates source; excluded lifecycle states and no completeness requirement | CBD-82 feature owner physical association/lifecycle binding and proof; no new private access |
| CBD-77-AC03; CBD13-CATEGORY-001 | CBD-77 §3 Category/Allocation and MT-77-008; CBD-80 MS-80-010/011: current active expense entity, stable identity and exclusions; same qualifying set for target numerator and category denominator, stored zero qualifies, missing fails, approved proration qualifies | CBD-30 feature owner physical predicate/target binding and proof |
| CBD-77-AC01/02/03; CBD13-USABLE-TIME-001 | MT-77-005 and MS-80-007 explicitly deferred/unavailable; intended first-simultaneous interval and future W4 retained; MT-77-003 remains required with five limbs | Approved operational-source contract proving coexistence after replacement/deletion/period changes; no timestamp/history proxy, baseline credit or timing-success claim |
| CBD-80-AC01/06; CBD13-RETENTION-001 | MS-80-015/016/017 carry merged CBD-78 MT-78-004/005/006 deferral: permissions are not actions, occurrence times and historical A/B evidence unproven under mutation/deletion | Approved operational-source proof without behavioral events, retained measurement membership or audit-purpose reuse; no zero, baseline credit or measured success |
| CBD-80-AC03/04/05; CBD81-BASELINE-001 | Existing privacy rules, IDs, consumers, owners and destinations preserved; W4 and R4/R8 remain future applicable baselines for deferred metrics | Independent review and CBD-81 applicability/exit follow-through complete; unchanged release/privacy gates |

CBD-81 follow-through must distinguish logical definition completion from physical-source readiness, apply the approved MT-77-005/MT-78-004/005/006 deferrals without successful baseline credit, and retain W4/R4/R8 for future applicability. R4/R8 still require two valid observation pairs with earliest reviews after six/ten weeks. No numerical privacy minimum, target, metric result or beta-success claim is added. This assignment does not edit CBD-81 or certify Jira Done. Structural checks and safe synthetic failure proofs are evidence of documentation integrity only; independent semantic review is recorded in CBD13-FINAL-REVIEW-002.

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
merges and verification. Confluence remains unpublished with no verified target;
future target registration/publication readiness is separately gated.
