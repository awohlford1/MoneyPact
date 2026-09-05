# CBD-79 — Acceptance Criteria Traceability and Completeness Report

| Field | Value |
| --- | --- |
| Status | **Draft v0.1 — not approved.** **Three of six criteria are met, one is met for four of its five states, one is met by reference, and one is not met.** `CBD-79-AC04` is blocked on `OQ-13-007` and no safety metric is defined; `CBD-79-AC03`'s `incorrect` state has no measurable referent. Both are gaps in approved criteria rather than omissions here, and §2 says which is which |
| Document version | 0.1 |
| Owner | Alexander Wohlford |
| Jira | [CBD-79](https://cobudget.atlassian.net/browse/CBD-79) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Companion | `docs/cbd-79-reliability-and-safety-metrics.md`, which this report checks |
| Mechanical audit | `scripts/audit-cbd-79.py` — 330 checks, every CBD-79-specific guard proven by deliberate violation |
| Confluence page | **Not published.** Registration follows approval |
| Last updated | September 5, 2026 |

## 1. Package contents

| Document | Purpose |
| --- | --- |
| `docs/cbd-79-reliability-and-safety-metrics.md` | Ten metrics with operational responses, the `incorrect` finding, the `CBD-79-AC04` blocker, and the CBD-78 boundary |
| `docs/cbd-79-acceptance-criteria-traceability.md` | This report |
| `scripts/audit-cbd-79.py` | Structural audit. Unlike CBD-77 and CBD-78 it validates `Class` and `Owner` against closed sets rather than constants, requires an operational response on every metric, and **keeps the two unsatisfied criteria visible** |

## 2. Acceptance criteria

### CBD-79-AC01 — connection and synchronization success, latency, freshness, retry, terminal failure

**Status: Met.** Five metrics, one per aspect: `MT-79-001` through `MT-79-005`.

**All five are `reliability-telemetry`, not `aggregate-state`**, and each `Data source` states that no connection, account or space identifier reaches the aggregate — `AN-92-003` allows service and version, coarse operation class, safe outcome class, duration bucket and aggregate health count, and nothing else.

**`MT-79-003` freshness is the one worth reading twice.** A connection that never errors but never refreshes passes `MT-79-001` and fails the customer, and freshness is the only metric here that would catch it.

### CBD-79-AC02 — notification `enqueued`, `delivered`, `failed`, `suppressed`, `duplicate`, `late`

**Status: Met.** `MT-79-006` reports all six as one distribution.

**`suppressed` stays in the denominator.** `AB-74-004` caps external delivery by transport contract and purpose, so a suppression is correct behaviour — removing it would flatter every other figure and hide a misconfiguration as a success.

### CBD-79-AC03 — alert quality distinguishes duplicate, late, incorrect, acknowledged, dismissed

**Status: Met for four of five states.**

| State | Where |
| --- | --- |
| `duplicate` | `MT-79-007` |
| `late` | `MT-79-008` |
| `acknowledged` | **CBD-78 `MT-78-007`**, by reference |
| `dismissed` | **CBD-78 `MT-78-008`**, by reference |
| `incorrect` | **No measurable referent** — metrics §3 |

**`incorrect` is not a state the system holds.** The word appears nowhere in the approved CBD-74 specification. What CBD-74 defines is a closed catalog with fixed thresholds and system-owned deduplication, so an alert that fires is one whose trigger condition held; whether it was *useful* is a judgment.

Metrics §3 rejects all three routes to measuring it — behavioural inference is disabled by `AN-92-001`, human reports are support data `AN-92-006` bars joining to a measurement, and a product-side correctness rule would contradict `AB-74-001`'s closed catalog. `OQ-79-002`.

**The two states answered by reference are deliberate.** Redefining them here would create two metrics for one quantity and would drop the `AB-74-014` release constraint CBD-78 attaches to them. The audit fails if this package defines an acknowledgement or dismissal rate of its own.

### CBD-79-AC04 — safety measures: denied cross-space access, consent changes, revocation failures, support incidents

**Status: Not met, and blocked rather than deferred.**

Every named signal is `AN-92-004` restricted security telemetry at S3, held under `DI-91-053` and `DI-91-062`. (`AN-92-004` also names `DI-91-071`, which the inventory classifies S1; `OQ-80-004` records the discrepancy, which narrows this blocker rather than widening it.) `AN-92-006` says an event collected for one purpose *"cannot be joined, enriched, exported, sold, shared, or reused for another."* **Computing a safety metric from it is a second purpose**, and whether that is the prohibited reuse is `OQ-13-007`.

**No metric is defined**, and that is a choice. Defining measures against a source that may be prohibited would either be wasted or would look authoritative enough to get built.

Metrics §4 states the two honest routes: a **separate operational source** counting denied access from the authorization layer's own state, which needs no amendment and is probably right, or an **explicit `AN-92-006` disposition**, which is a CBD-92 amendment. Choosing decides what the measures are, and `AC06` requires each to carry a response that cannot be written before the measure exists.

### CBD-79-AC05 — export and deletion: request, verification, completion, failure, elapsed time

**Status: Met.** `MT-79-009` covers request, completion and failure; `MT-79-010` covers elapsed time; verification is handled as a denominator exclusion rather than a metric, because it is a step the customer holds and elapsed time there is not a product failure.

**`MT-79-009`'s unhealthy condition is "any failed terminal state at all."** This is not a rate to optimise. `INC-76-005`, `INC-76-009` and `INC-76-010` each promise an outcome, and one broken promise is a finding.

**Its operational response says the metric deliberately cannot identify the failure.** Finding out which request failed is an `OP-92-003` exceptional-purpose action through the authorized path, not something this measure supports — which is the correct shape and worth stating so nobody adds a drill-down later.

### CBD-79-AC06 — each unhealthy condition has an initial threshold or baseline rule and an operational response

**Status: Met for the response half; the threshold half is CBD-81's.**

Conventions §10 splits the criterion: **CBD-79 owns the condition and the response, CBD-81 owns the number.** That split was confirmed by the Product Owner's approval of the conventions on September 5, 2026, closing `OQ-13-002`.

The conventions record shape has no response field, so metrics §5 adds one, and **the audit fails a response of "investigate"** — an intention is not an action.

**Three bounds are named and none is a number** — freshness, lateness, and the committed windows. `OQ-79-003` records that every unhealthy condition here is qualitative until CBD-81 supplies them.

## 3. Deliverables

| Deliverable | Status | Where |
| --- | --- | --- |
| Connection and synchronization metrics | **Met** — five metrics | Metrics §6 |
| Notification measures | **Met** — six states, one distribution | `MT-79-006` |
| Alert quality | **Four of five states** — two here, two by reference, one unmeasurable | `MT-79-007`, `MT-79-008`, `OQ-79-002` |
| Safety measures | **Not met** — blocked on `OQ-13-007` | Metrics §4, `OQ-79-001` |
| Export and deletion measures | **Met** — two metrics | `MT-79-009`, `MT-79-010` |
| Operational responses | **Met** — one per metric, checked mechanically | Metrics §5 |
| Thresholds and bounds | **Not this package** — CBD-81 | `OQ-79-003` |
| Structural audit | **Met** — 330 checks; eight CBD-79-specific guards proven by deliberate violation | `scripts/audit-cbd-79.py` |

## 4. Where this package differs from its siblings

**`Class` and `Owner` are not package constants here.** CBD-77 and CBD-78 are wholly `aggregate-state` and `product`-owned; CBD-79 spans both measurement classes and three owner categories, because reliability is telemetry and export completion is state. The audit validates both against the closed sets instead of against a constant — a difference in the package, matched by a difference in its guard.

**Most denominators count operations, not people.** Runs and requests reach releasable volume far faster than any population measure, which is why reliability can be reviewed daily while engagement cannot. `MT-79-009` and `MT-79-010` are the exceptions and will withhold for most of the beta, correctly: request volume is low and each request belongs to one identifiable person.

## 5. What this package does not establish

* **No metric has been measured**, and neither the product nor its provider connections exist.
* **No metric is computable** — ten sources proposed, none assigned.
* **No safety measure exists**, pending `OQ-13-007`.
* **Alert correctness is not measured and cannot be** by any route this package could find.
* **No bound is a number**, so no unhealthy condition is actionable until CBD-81 supplies one.
* **Written and reviewed by the same person.**

## 6. Revision record

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 0.1 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | Initial package: ten metrics with operational responses, the `incorrect` unmeasurability finding at `OQ-79-002`, the `CBD-79-AC04` blocker at `OQ-79-001`, the unset bounds at `OQ-79-003`, structural audit, and this report | Draft; Product Owner approval required |
