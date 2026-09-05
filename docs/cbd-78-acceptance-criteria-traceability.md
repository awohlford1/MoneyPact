# CBD-78 — Acceptance Criteria Traceability and Completeness Report

| Field | Value |
| --- | --- |
| Status | **Draft v0.1 — not approved.** Maps each CBD-78 acceptance criterion to the section that answers it. **Four of six criteria are met, one is met but not authorized for release, and one is deliberately not satisfied.** §2 states which is which and why, rather than reporting five of six and leaving a reader to find the gap |
| Document version | 0.1 |
| Owner | Alexander Wohlford |
| Jira | [CBD-78](https://cobudget.atlassian.net/browse/CBD-78) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Companion | `docs/cbd-78-engagement-and-retention-metrics.md`, which this report checks |
| Mechanical audit | `scripts/audit-cbd-78.py` — 219 checks, every CBD-78-specific guard proven by deliberate violation |
| Confluence page | **Not published.** Registration follows approval |
| Last updated | September 5, 2026 |

## 1. Package contents

| Document | Purpose |
| --- | --- |
| `docs/cbd-78-engagement-and-retention-metrics.md` | Eight metrics, the `AD-78-001` activity condition, the `RT-78-001` retention computation, the `AB-74-014` release constraint, and what could not be settled |
| `docs/cbd-78-acceptance-criteria-traceability.md` | This report |
| `scripts/audit-cbd-78.py` | Structural audit, including the two guards specific to this package: `RT-78-001` must keep neither window set, and both alert metrics must carry the `AB-74-014` constraint |

## 2. Acceptance criteria

### CBD-78-AC01 — transaction categorization uses an explicit eligible-transaction denominator

**Status: Met.**

`MT-78-001` states the denominator as a condition rather than a population name: transactions held by a space at window close **whose reliable date falls inside a materialized period**, per `SD-071-035`.

**The exclusion is the substance of the criterion.** A transaction dated before the space's first period is not classifiable, and counting it would report a data-entry choice as a product failure. Naming the eligible set is what stops that.

### CBD-78-AC02 — invitation states are measurable

**Status: Met.**

`MT-78-002` measures acceptance and `MT-78-003` the terminal-state distribution across `accepted`, `expired`, `revoked` and `declined`. **`sent` is excluded from both denominators**, because an invitation still open has not been refused and counting elapsed time as refusal would make the rate a function of when it was measured.

The three failure states are reported separately at `MT-78-003` because they need opposite responses — `expired` is an attention problem, `declined` a framing one — and a single acceptance rate hides which is happening.

### CBD-78-AC03 — collaboration usage distinguishes viewing, editing, acknowledgement, commenting

**Status: Met.**

`MT-78-004` reports the four classes separately. Two design points that the criterion does not state and that change what the number means:

**It counts spaces holding an action, not actions.** One prolific member would otherwise make a space look collaborative.

**Single-member spaces leave the denominator.** They cannot collaborate, and including them would report a structural fact as disengagement.

### CBD-78-AC04 — four- and eight-week retention, exact activity definitions, two named windows, no persisted membership

**Status: Met.**

`AD-78-001` defines activity across three limbs, each citing an approved source, and the audit fails a limb that cites none. `RT-78-001` states the computation in five steps ending *"Retain neither set"*, and the audit fails if that sentence disappears — it is what makes the measure permitted rather than a cohort renamed.

**`viewing` is included deliberately.** Excluding reading would report a Viewer as inactive by construction, which CBD-72's role model makes a category error rather than a measurement choice.

**The limitation is recorded rather than hidden.** Because neither window set is retained, a retention figure **cannot be recomputed against a corrected `AD-78-001`** — changing the definition changes every future figure and no past one. `OI-78-002`. The alternative is what `AN-92-005` prohibits, so the constraint is accepted rather than solved.

### CBD-78-AC05 — cadence segmentation of retention

**Status: Deliberately not satisfied.**

The criterion was amended on September 5, 2026 to defer segmentation. Conventions decision 2 releases global figures only during the beta, because at Base demand of 30 monthly active users a four-way cadence split produces cells of one, which `AN-92-005` forbids.

**This is a gap, not a completion.** `OQ-78-003` records it so it is visible from this package and not only from the ticket, and CBD-81 owns the population decision that reopens it.

### CBD-78-AC06 — alert acknowledgement and dismissal rates with a clearly defined delivered-alert denominator

**Status: Met, and not authorized for release.**

The denominator is exact because `AB-74-002` makes **exactly one mandatory in-app instance per eligible recipient per shared event**. Informational instances are excluded: `AB-74-009` gives them no acknowledgement operation, so including them would report an impossibility as a failure.

**The criterion runs against an approved anti-surveillance boundary.** `AB-74-014` prohibits *"visibility into whether another person read, acknowledged, or dismissed an instance"*, and CBD-74 restates it as *"no status visible to anyone else"*.

Metrics §6 states the reading that reconciles them — `AB-74-014` governs member-visible surfaces and cross-member behaviour, `AN-92-005` permits a coarse non-drillable aggregate — and the three conditions it depends on. **`OQ-78-002` puts that reading to the Product Owner**, because it is a construction of an approved boundary rather than a measurement decision.

Until it is confirmed, `MT-78-007` and `MT-78-008` are **defined and not authorized for release**. The audit enforces that the claim stands in §6 and in the open-items table, so neither can be dropped quietly.

## 3. Deliverables

| Deliverable | Status | Where |
| --- | --- | --- |
| Engagement and retention metric definitions | **Met** — eight metrics, every conventions §4 field populated | Metrics §5 |
| Activity condition | **Met** — `AD-78-001`, three limbs, each with an approved citation | Metrics §3 |
| Retention computation without a cohort | **Met** — `RT-78-001`, five steps, neither set retained | Metrics §4 |
| Cadence segmentation | **Deferred** — conventions decision 2 | `OQ-78-003` |
| Structural audit | **Met** — 219 checks; seven CBD-78-specific guards each proven by deliberate violation | `scripts/audit-cbd-78.py` |
| Targets and thresholds | **Not this package** — CBD-81 owns every number | Conventions §10 |

## 4. Where the ticket's text no longer matches what exists

### 4.1 The scope-source correction is half right here

`OQ-77-001` found that the conventions pin CBD-76 as the governing scope source and that it is not one for activation. **For this package it is genuinely the boundary for the collaboration half** — `INC-76-002` invitations, `INC-76-003` alerts, `INC-76-012` comments — and not for the transaction half, which CBD-71 governs.

`OQ-78-001` records that the correction to the conventions should say *which half*, rather than replacing one wrong pin with another. Neither package changes a metric over it.

### 4.2 Two criteria were amended on September 5, 2026

`CBD-78-AC04` replaced cohorts with two named activity windows; `CBD-78-AC05` deferred segmentation. Both were found by the §11 sweep of the conventions, and a reader of the ticket alone would not know why the wording changed — each amendment carries the contract that forced it.

## 5. What this package does not establish

* **No metric has been measured.** The product is not built.
* **No metric is computable** — eleven measurement sources proposed, none assigned. CBD-80 owns that.
* **Two metrics are not authorized for release**, pending `OQ-78-002`.
* **No target or threshold is set**, and none may be inferred from an `Unhealthy condition`.
* **A retention series is not comparable across a change to `AD-78-001`**, and nothing in the package can make it so.
* **Written and reviewed by the same person**, inheriting that limitation from the conventions.

## 6. Revision record

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 0.1 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | Initial package: eight metrics, `AD-78-001`, `RT-78-001`, the `AB-74-014` release constraint at metrics §6, structural audit, and this report. Records `OQ-78-001` on the half-right scope source, `OQ-78-002` on the anti-surveillance reading, and `OQ-78-003` on the deferred segmentation | Draft; Product Owner approval required |
