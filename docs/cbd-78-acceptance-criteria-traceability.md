# CBD-78 — Acceptance Criteria Traceability and Completeness Report

| Field | Value |
| --- | --- |
| Status | **Draft v0.3 — package not approved.** AC01/02/06 retain their definition dispositions. AC03/04 have an Executive-approved Private MVP deferral, not measured fulfillment. AC05 remains separately deferred. No package approval or measured beta success is established |
| Document version | 0.3 |
| Owner | Alexander Wohlford |
| Jira | [CBD-78](https://cobudget.atlassian.net/browse/CBD-78) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Companion | `docs/cbd-78-engagement-and-retention-metrics.md`, which this report checks |
| Mechanical audit | `scripts/audit-cbd-78.py` — 232 checks; eight deferral checks validated with safe synthetic violations |
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

**Status: Approved deferral for Private MVP; specification disposition only.**

`MT-78-004` preserves `viewing`, `editing`, `acknowledgement`, and `commenting` as four distinct future figures, counting multi-member spaces holding an action rather than total actions. Single-member spaces remain excluded. Full action breadth is unavailable, not zero or measured success. Permission is not evidence of action; authorization and surviving comments cannot prove all four classes and occurrence times under mutation/deletion.

Reopening requires the approved operational-source contract in metrics §4. No behavioral tracking, retained measurement membership, audit-purpose reuse, or surviving-state proxy is authorized. Source IDs and destination assignments remain unchanged.

### CBD-78-AC04 — four- and eight-week historical retention explicitly deferred for Private MVP

**Status: Approved deferral for Private MVP; specification disposition only.**

`AD-78-001` preserves the exact future activity predicate and `RT-78-001` preserves named UTC A/B windows, four/eight-week offsets, numerator, denominator and the requirement to retain neither set. These are not source proof or authority to compute. Mutable/deleted records cannot currently establish historical A/B evidence; budget dates and schedule effective dates are not action occurrence times.

Executive decision `CBD13-RETENTION-001` approves unavailability pending the §4 source-proof gate. This implements amended `CBD-78-AC04` and the relevant `CBD-13-AC04` disposition, without certifying measured retention or beta success. `CBD81-BASELINE-001` remains settled: product four complete weeks, reliability fourteen complete days, retention two valid pairs and earliest reviews after six/ten weeks. Deferred periods do not establish completion; only valid releasable observations count, and missing evidence needs a dated extension or pause. CBD-80 source and CBD-81 applicability/exit follow-through remain outside this package.
### CBD-78-AC05 — cadence segmentation of retention

**Status: Deliberately not satisfied.**

The criterion was amended on September 5, 2026 to defer segmentation. Conventions decision 2 releases global figures only during the beta, because at Base demand of 30 monthly active users a four-way cadence split produces cells of one, which `AN-92-005` forbids.

**This is a gap, not a completion.** `OQ-78-003` records it so it is visible from this package and not only from the ticket, and CBD-81 owns the population decision that reopens it.

### CBD-78-AC06 — alert acknowledgement and dismissal rates with a clearly defined delivered-alert denominator

**Status: Met, and authorized for release on four conditions.**

The denominator is exact because `AB-74-002` makes **exactly one mandatory in-app instance per eligible recipient per shared event**. Informational instances are excluded: `AB-74-009` gives them no acknowledgement operation, so including them would report an impossibility as a failure.

**The criterion runs against an approved anti-surveillance boundary**, and the Product Owner settled it on September 5, 2026.

`AB-74-014` prohibits *"visibility into whether another person read, acknowledged, or dismissed an instance"*. **Its three cited sources are all member-facing** — `CBD-12-AC22`'s coercion rules, `CBD-12-AC24`'s copy rules, and `RI-93-014`'s finding about other members seeing one person's provisional overspend — and none reaches aggregate measurement by the operator.

**The rule's first sentence is broader than its sources**, and that is what needed answering: *"No alert behavior may be used to pressure, punish, or surveil"* is not scoped to members, so an acknowledgement rate used to tune the catalog toward compliance would breach it even with no member ever seeing the figure.

**Four conditions, and the fourth is the one that matters.** Three bound who sees the figure — global only, never a member-visible surface, no member-differentiating response. The fourth is a **one-way ratchet**: these figures may justify making alerts fewer, softer or less frequent, and may never justify making them more insistent.

**The ratchet costs nothing a good response would have wanted.** An alert nobody acknowledges is not solved by repetition, so the permitted answers — fix, soften, remove — are the ones that would have been right anyway. What it removes is the option that would have made the metric an instrument of pressure.

## 3. Deliverables

| Deliverable | Status | Where |
| --- | --- | --- |
| Engagement and retention metric definitions | **Met** — eight metrics, every conventions §4 field populated | Metrics §5 |
| Activity condition | **Future definition retained; measurement deferred** — references define semantics, not occurrence evidence | Metrics §3 |
| Retention computation without a cohort | **Approved Private MVP deferral** — future `RT-78-001`, five conditional steps, neither set retained; historical source proof outstanding | Metrics §4 |
| Cadence segmentation | **Deferred** — conventions decision 2 | `OQ-78-003` |
| Structural audit | **Met** — 232 checks; eight added deferral checks validated with safe synthetic violations | `scripts/audit-cbd-78.py` |
| Targets and thresholds | **Not this package** — CBD-81 owns every number | Conventions §10 |

## 4. Where the ticket's text no longer matches what exists

### 4.1 The scope-source correction is half right here

`OQ-77-001` found that the conventions pin CBD-76 as the governing scope source and that it is not one for activation. **For this package it is genuinely the boundary for the collaboration half** — `INC-76-002` invitations, `INC-76-003` alerts, `INC-76-012` comments — and not for the transaction half, which CBD-71 governs.

`OQ-78-001` records that the correction to the conventions should say *which half*, rather than replacing one wrong pin with another. Neither package changes a metric over it.

### 4.2 Criteria amendments on September 5, 2026

`CBD-78-AC04` replaced cohorts with two named activity windows; `CBD-78-AC05` deferred segmentation. These decisions remain preserved. Executive-approved `CBD13-RETENTION-001` subsequently amended CBD-78 AC03/04 and CBD-13 AC04 to permit explicit Private MVP deferral pending lawful operational-source proof; this records specification disposition without claiming measurement.

## 5. What this package does not establish

* **No metric has been measured.** The product is not built.
* **No metric is computable** — eleven measurement sources proposed, source binding is owned by CBD-80 and does not itself prove historical feasibility. Existing 19/9 destination assignments remain preserved.
* **Three metrics are deferred:** full `MT-78-004` and historical `MT-78-005`/`MT-78-006`. Existing alert authorization under closed `OQ-78-002` remains subject to all four settled conditions.
* **No target or threshold is set**, and none may be inferred from an `Unhealthy condition`.
* **A retention series is not comparable across a change to `AD-78-001`**, and nothing in the package can make it so.
* **Written and reviewed by the same person**, inheriting that limitation from the conventions.

## 6. Revision record

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 0.3 | September 5, 2026 | Codex Specification | Approved Private MVP action-breadth and historical-retention deferral; corrected evidence claims; preserved IDs, destinations, baselines and alert/cadence decisions | Deferral approved; remaining package Draft |
| 0.2 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | **`OQ-78-002` decided.** Both alert measures are authorized for release on four conditions. The three that bound who sees the figure were already stated; the fourth is new and is what the rule's broader first sentence required — **a one-way ratchet**: these figures may justify making alerts fewer, softer or less frequent and may never justify making them more insistent. The three sources `AB-74-014` cites are all member-facing and do not dispose of that sentence; the ratchet forecloses it structurally rather than by intent. `CBD-78-AC06` moves from met-but-unreleasable to met | Draft; Product Owner approval required |
| 0.1 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | Initial package: eight metrics, `AD-78-001`, `RT-78-001`, the `AB-74-014` release constraint at metrics §6, structural audit, and this report. Records `OQ-78-001` on the half-right scope source, `OQ-78-002` on the anti-surveillance reading, and `OQ-78-003` on the deferred segmentation | Superseded by 0.2 |
