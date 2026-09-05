# CBD-77 — Acceptance Criteria Traceability and Completeness Report

| Field | Value |
| --- | --- |
| Status | **Approved v1.0** — Product Owner approved this exact package on September 5, 2026. Maps each CBD-77 acceptance criterion to the exact section that answers it and states plainly where the answer is *"met"*, *"partially met"*, or *"not met"*. **Five of six criteria are met and one is partially met**, because the suppression rule it depends on has no number until CBD-81 sets one. §4 records where the ticket's own text no longer matches what exists |
| Document version | 1.0 |
| Owner | Alexander Wohlford |
| Reviewer | Alexander Wohlford — Product Owner. **Approved September 5, 2026** after a review that corrected one citation |
| Jira | [CBD-77](https://cobudget.atlassian.net/browse/CBD-77) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Companion | `docs/cbd-77-activation-and-onboarding-metrics.md`, which this report checks |
| Mechanical audit | `scripts/audit-cbd-77.py` — 215 checks, every guard proven by deliberate violation |
| Confluence page | **Not published.** Registration follows approval |
| Last updated | September 5, 2026 |

## 1. Package contents

| Document | Purpose |
| --- | --- |
| `docs/cbd-77-activation-and-onboarding-metrics.md` | Eight metrics, the `UB-77-001` usable-budget condition, the denominator rules, and what the package could not settle |
| `docs/cbd-77-acceptance-criteria-traceability.md` | This report |
| `scripts/audit-cbd-77.py` | Structural audit: required fields, package constants, event-model leakage, identifier sequence, `UB-77-001` limb citations |

## 2. Acceptance criteria

### CBD-77-AC01 — numerator, denominator, interval basis, time window

**Status: Met.**

All eight metrics carry `Numerator`, `Denominator`, `Interval basis` and `Window`, and the audit fails on a missing field rather than trusting the author. **`MT-77-004` and `MT-77-005` record `n/a` with a reason for numerator and denominator**, because a percentile distribution has neither, and the conventions require `n/a` to carry a reason rather than be omitted — which the audit also checks.

**Every interval basis is a state condition, not an event pair.** That is the substance of the September 5, 2026 amendment to this criterion: `AN-92-001` names user journeys and funnels, so an activation interval opens on *"a budget space exists"* and closes on *"that space holds one materialized period"*.

### CBD-77-AC02 — first budget period and usable-budget completion defined separately

**Status: Met.**

| Measure | Metric | What it answers |
| --- | --- | --- |
| First budget period creation | `MT-77-002` | Whether a space reaches a materialized period at all |
| Usable-budget completion | `MT-77-003` | Whether a space reaches all five `UB-77-001` limbs |

They are separate metrics with separate numerators, and §3 of the metrics document defines usability independently of period creation. `MT-77-004` and `MT-77-005` carry the same separation into the elapsed-time measures, which is what makes *"slow"* distinguishable from *"rare"*.

### CBD-77-AC03 — time-to-usable-budget defines the minimum profile, period, category, allocation, and account or transaction

**Status: Met.**

`UB-77-001` states all five limbs, each citing an approved source, and the audit fails a limb that cites none:

| Limb | Approved source |
| --- | --- |
| Profile | `CA-92-012` |
| Period | `SD-071-021` |
| Category | `SD-071-010` |
| Allocation | `SD-071-005`, `SD-071-027` |
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

**Status: Met.**

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
