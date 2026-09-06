# CBD-79 — Acceptance Criteria Traceability and Completeness Report

| Field | Value |
| --- | --- |
| Status | **Draft v0.2 — not approved.** **Three of six criteria are met, and three are partial in different ways.** `CBD-79-AC04` is partially met — two of its four signals are measured and two are barred by name. `CBD-79-AC03` is met for four of five states, because `incorrect` has no measurable referent. `CBD-79-AC06` owns the response half and CBD-81 the numbers. §2 says which is which |
| Document version | 0.3 |
| Owner | Alexander Wohlford |
| Jira | [CBD-79](https://cobudget.atlassian.net/browse/CBD-79) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Companion | `docs/cbd-79-reliability-and-safety-metrics.md`, which this report checks |
| Mechanical audit | `scripts/audit-cbd-79.py` — every CBD-79-specific guard proven by deliberate violation |
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

**Status: Partially met — two of four signals measured.**

**The four signals do not behave alike**, and v0.1 treated them as one blocked question. The Product Owner decision of September 5, 2026 split them.

| Signal | Standing |
| --- | --- |
| Consent changes | **`MT-79-011`** — `DI-91-007` application-datastore consent evidence, counted as `AN-92-005` aggregate state |
| Revocation failures | **`MT-79-012`** — an operation that failed to complete is a safe outcome class under `AN-92-003` |
| Denied cross-space access | **Barred.** `AN-92-003` excludes a *"security-decision"* label **by name** |
| Related support incidents | **Barred.** Support is a distinct purpose under `AN-92-006`; `OP-92-002` bars counts on that surface |

**The seam is whether an operation completed versus what it decided.** A revocation that errors is a reliability outcome; an access request refused is a security decision, and `AN-92-003`'s exclusion list is written at exactly that line. `MT-79-012` counts terminal outcome classes and carries no decision label — **a metric counting refusals would be the same shape and would not be permitted.**

**The two barred signals were decided on September 5, 2026, and the answer is neither amendment.**

`AN-92-006` is the source of **four cross-cutting hard gates** — `HG-102-002`, `HG-102-003`, `HG-102-026`, `HG-102-033` — and `HG-102-003` restates the contract almost verbatim. All four were measured against every candidate in six provider categories, and a changed pass test requires re-measurement, so amending the contract would **reopen the approved CBD-102 catalog and the CBD-108 selections**.

Amending this criterion would cost one ticket and delete a safety signal. **A criterion that no longer asks for denied cross-space access is a criterion nobody revisits.**

So both signals are **barred for the Private MVP phase**, and the question goes to `SRV-94-010`, the independent public-launch security review, whose scope is *"evidence-gap scope, and resulting CBD-94 mitigations/residual decisions."* CBD-94 §11.8 makes that review a public-launch prerequisite, so the beta runs without these measures under every option except amending the contract — and the review reaches the question before it can matter.

**This criterion is partially met and closes that way.** The gap is recorded and routed rather than resolved, and recorded is the honest state.

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
| Safety measures | **Partially met and closed that way** — two of four measured, two barred and routed to `SRV-94-010` | `MT-79-011`, `MT-79-012`, metrics §4.2 |
| Export and deletion measures | **Met** — two metrics | `MT-79-009`, `MT-79-010` |
| Operational responses | **Met** — one per metric, checked mechanically | Metrics §5 |
| Thresholds and bounds | **Not this package** — CBD-81 | `OQ-79-003` |
| Structural audit | **Met** — eight CBD-79-specific guards proven by deliberate violation | `scripts/audit-cbd-79.py` |

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
| 0.3 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | **`OQ-79-001` decided, and the answer is neither amendment.** `AN-92-006` sources four cross-cutting hard gates and `HG-102-003` restates it almost verbatim, so amending it would require re-measuring every candidate in six categories and reopen the approved CBD-102 catalog and CBD-108 selections. Amending the criterion would cost one ticket and **delete** a safety signal rather than defer it. Both barred signals are therefore barred **for the Private MVP phase**, with the question routed to `SRV-94-010`, whose scope is evidence gaps and residual decisions and which CBD-94 §11.8 makes a public-launch prerequisite. `CBD-79-AC04` is partially met and closes that way | Draft; Product Owner approval required |
| 0.2 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | **`OQ-13-007` decided.** The four `CBD-79-AC04` signals were treated as one blocked question and are not one: consent changes and revocation failures are measurable under approved contracts and become `MT-79-011` and `MT-79-012`; denied cross-space access and support incidents stay barred, the first because `AN-92-003` excludes a security-decision label **by name**. The criterion moves from not met to partially met, and §4.1 records the seam the two permitted measures turn on — whether an operation completed, not what it decided. Three new measurement sources are proposed, which CBD-80 must register | Draft; Product Owner approval required |
| 0.1 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | Initial package: ten metrics with operational responses, the `incorrect` unmeasurability finding at `OQ-79-002`, the `CBD-79-AC04` blocker at `OQ-79-001`, the unset bounds at `OQ-79-003`, structural audit, and this report | Superseded by 0.2 |
