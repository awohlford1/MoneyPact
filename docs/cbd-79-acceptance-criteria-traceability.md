# CBD-79 — Acceptance Criteria Traceability and Completeness Report

| Field | Value |
| --- | --- |
| Status | **Candidate amendment v0.4**. Exact lifecycle semantics, later-bound specification-closure disposition and synthetic incorrect-alert QA route approved in `CBD13-LIFECYCLE-001`, `CBD81-BOUNDS-001` and `CBD13-CORRECTNESS-001`. This candidate awaits independent review; no whole-package approval, runtime proof, numerical release or Done claim. Prior decisions remain in force. |
| Document version | 0.4 |
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
| `docs/cbd-79-reliability-and-safety-metrics.md` | Reliability/safety metrics with operational responses, synthetic incorrect-alert QA disposition, lifecycle predicates and bound gates, and the unchanged CBD-78 boundary |
| `docs/cbd-79-acceptance-criteria-traceability.md` | This report |
| `scripts/audit-cbd-79.py` | Structural audit. Unlike CBD-77 and CBD-78 it validates `Class` and `Owner` against closed sets rather than constants, requires an operational response on every metric, and **keeps the safety exclusions and approved synthetic-QA disposition visible** |

## 2. Acceptance criteria

### CBD-79-AC01 — connection and synchronization success, latency, freshness, retry, terminal failure

**Status: Scoped definition amendment incorporated; independent review pending.** Five metrics remain, `MT-79-001` through `MT-79-005`. MT-79-003 now uses the authorized active snapshot population, committed successful-sync watermark and never-synced missing-age rule. The approved CBD81-BOUNDS-001 closure-stage exception leaves its classification bound unset; the rate remains unavailable with no baseline start/credit or healthy claim until bound/source/release gates pass.

**All five are `reliability-telemetry`, not `aggregate-state`**, and each `Data source` states that no connection, account or space identifier reaches the aggregate — `AN-92-003` allows service and version, coarse operation class, safe outcome class, duration bucket and aggregate health count, and nothing else.

**`MT-79-003` freshness is the one worth reading twice.** A connection that never errors but never refreshes passes `MT-79-001` and fails the customer, and freshness is the only metric here that would catch it.

### CBD-79-AC02 — notification `enqueued`, `delivered`, `failed`, `suppressed`, `duplicate`, `late`

**Status: Met.** `MT-79-006` reports all six as one distribution.

**`suppressed` stays in the denominator.** `AB-74-004` caps external delivery by transport contract and purpose, so a suppression is correct behaviour — removing it would flatter every other figure and hide a misconfiguration as a success.

### CBD-79-AC03 — alert quality distinguishes duplicate, late, incorrect, acknowledged, dismissed

**Status: Approved synthetic-QA and end-to-end timing definitions incorporated; candidate review pending.** `CBD13-CORRECTNESS-001` settles the incorrect-alert assessment route. No executed QA is claimed.

| State | Where |
| --- | --- |
| `duplicate` | `MT-79-007`, unchanged |
| `late` | `MT-79-008`: durable source revision first satisfying the applicable rule to mandatory authorized in-app availability; same delivered-instance denominator, unavailable pending classification/source/release gates |
| `acknowledged` | **CBD-78 `MT-78-007`**, by reference |
| `dismissed` | **CBD-78 `MT-78-008`**, by reference |
| `incorrect` | Synthetic QA against approved alert rules, separate from production metrics and customer/support data; metrics §3 and decided `OQ-79-002` |

The synthetic assessment compares implementation outcomes with the approved rules; a fixed rule does not prove its implementation correct. No new production metric, behavioral tracking or customer/support-data reuse is authorized. QA must still be assigned and executed against the candidate, with independent evidence. The approved CBD81-BOUNDS-001 exception permits specification closure with lateness classification unset; beta applicability and required evidence remain.

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

**Status: Approved lifecycle predicates incorporated; physical binding/runtime evidence and candidate review remain future.** MT-79-009/010 cover export, archival, budget-space deletion and personal-account deletion. Acceptance follows eligibility, authorization and required verification/confirmation, and includes subsequent queue delay. Source-specific completed endpoints and approved terminal failures share one population; valid cancellations/restorations and pending work are excluded from both the rate and elapsed distribution. Failed means an approved terminal unsuccessful outcome, not retry/grace/pending cleanup.

Metrics' Approved lifecycle measurement contract and CBD-80 MS-80-029/030 define export package-ready, atomic archival restrictions, irreversible budget-space purge, and personal account/profile terminal dispositions. Immediate authority shutdown and scheduled cleanup do not prove completion. Application-controlled completion requires approved per-class/custodian schedule evidence; processor/backup obligations remain separately tracked. FU-95-014/016/022 execution gates remain open, and no recipient-copy erasure claim is permitted.

**Its operational response says the metric deliberately cannot identify the failure.** Finding out which request failed is an `OP-92-003` exceptional-purpose action through the authorized path, not something this measure supports — which is the correct shape and worth stating so nobody adds a drill-down later.

### CBD-79-AC06 — each unhealthy condition has an initial threshold or baseline rule and an operational response

**Status: Approved closure-stage bounds disposition incorporated; independent review pending.**

Conventions §10 splits the criterion: **CBD-79 owns the condition and the response, CBD-81 owns the number.** That split was confirmed by the Product Owner's approval of the conventions on September 5, 2026, closing `OQ-13-002`.

The conventions record shape has no response field, so metrics §5 adds one, and **the audit fails a response of "investigate"** — an intention is not an action.

**Classification bounds and performance commitments are distinct.** CBD81-BOUNDS-001 permits specification closure with freshness/lateness bounds unset, not a beta applicability deferral. MT-79-003/008 cannot report a rate, healthy status, numerical release or baseline start/credit until classification/source/release gates pass; D14 then starts on valid comparable releasable rates. MT-79-010 may baseline duration after interval/terminal/source/bucket/release gates, but cannot claim SLA/compliance or near-breach without lifecycle-specific commitments and actionable approach rules. Restoration grace, export expiry and backup expiry are not SLOs. OQ-79-003 remains open for numerical selection; missing beta evidence follows the approved dated continuation/pause process.

## 3. Deliverables

| Deliverable | Status | Where |
| --- | --- | --- |
| Connection and synchronization metrics | **Met** — five metrics | Metrics §6 |
| Notification measures | **Met** — six states, one distribution | `MT-79-006` |
| Alert quality | **Definition amendment incorporated; review pending** — `duplicate`, `late`, `incorrect`, `acknowledged`, `dismissed`: two production definitions here, synthetic QA for correctness, two CBD-78 references; execution unproven | `MT-79-007`, `MT-79-008`, metrics §3, `OQ-79-002` |
| Safety measures | **Partially met and closed that way** — two of four measured, two barred and routed to `SRV-94-010` | `MT-79-011`, `MT-79-012`, metrics §4.2 |
| Export and deletion measures | **Definition amendment incorporated; review pending** — both deletion scopes plus export/archival, shared terminal population and source-specific endpoints; runtime gates remain | `MT-79-009`, `MT-79-010` |
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
* **Synthetic incorrect-alert QA is approved but not executed here.** It is separate from production metrics and customer/support data.
* **No numerical classification bound or lifecycle commitment is approved here.** Freshness/lateness rates remain unavailable, while duration baseline eligibility depends on its separate source/bucket/release gates.
* **Written and reviewed by the same person.**

## 6. Revision record

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 0.3 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | **`OQ-79-001` decided, and the answer is neither amendment.** `AN-92-006` sources four cross-cutting hard gates and `HG-102-003` restates it almost verbatim, so amending it would require re-measuring every candidate in six categories and reopen the approved CBD-102 catalog and CBD-108 selections. Amending the criterion would cost one ticket and **delete** a safety signal rather than defer it. Both barred signals are therefore barred **for the Private MVP phase**, with the question routed to `SRV-94-010`, whose scope is evidence gaps and residual decisions and which CBD-94 §11.8 makes a public-launch prerequisite. `CBD-79-AC04` is partially met and closes that way | Draft; Product Owner approval required |
| 0.2 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | **`OQ-13-007` decided.** The four `CBD-79-AC04` signals were treated as one blocked question and are not one: consent changes and revocation failures are measurable under approved contracts and become `MT-79-011` and `MT-79-012`; denied cross-space access and support incidents stay barred, the first because `AN-92-003` excludes a security-decision label **by name**. The criterion moves from not met to partially met, and §4.1 records the seam the two permitted measures turn on — whether an operation completed, not what it decided. Three new measurement sources are proposed, which CBD-80 must register | Draft; Product Owner approval required |
| 0.1 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | Initial package: ten metrics with operational responses, the `incorrect` unmeasurability finding at `OQ-79-002`, the `CBD-79-AC04` blocker at `OQ-79-001`, the unset bounds at `OQ-79-003`, structural audit, and this report | Superseded by 0.2 |

## Lifecycle amendment record

| Version | Authority | Change | Status |
| --- | --- | --- | --- |
| 0.4 | `CBD13-LIFECYCLE-001`; `CBD81-BOUNDS-001`; `CBD13-CORRECTNESS-001` | Freshness snapshot; end-to-end alert lateness; accepted lifecycle start, both deletion scopes and source-specific application-controlled endpoints; matching completed-plus-failed rate/elapsed populations; synthetic correctness QA and explicit later-bound closure exception | Candidate; independent review pending. Existing approvals preserved; no measurement or executed QA claimed |

## Lifecycle amendment traceability and CBD-81 handoff

| Criterion / decision | Exact specification evidence | Remaining gate |
| --- | --- | --- |
| CBD-79-AC01; CBD13-LIFECYCLE-001 | MT-79-003 / MS-80-023 and Freshness snapshot: currently authorized active connections, committed successful watermark, exclusions, never-synced retained in denominator with missing age | Physical eligibility/watermark and safe bucket proof; approved classification bound and release controls |
| CBD-79-AC03; CBD13-LIFECYCLE-001 | MT-79-008 / MS-80-028 and End-to-end alert interval: first durable rule satisfaction through authorized recipient-instance availability, evaluation/fan-out included, delivered-only matching population | Exact timestamp/bucket proof; classification bound and release controls; no dropped-alert coverage claim |
| CBD-79-AC05; CBD-80-AC01/06; CBD13-LIFECYCLE-001 | MT-79-009/010 / MS-80-029/030 and Accepted request / Outcome sections: accepted authorized verified start, export package-ready, atomic archival, both deletion scopes, source-specific app-controlled endpoints, completed/(completed+failed) and same terminal elapsed population | FU-95-014/016/022 and source-specific class/custodian schedules, timestamp and runtime evidence; processor/backup obligations separately tracked |
| CBD-79-AC03; CBD13-CORRECTNESS-001 | CBD-79 §3 and decided OQ-79-002: incorrect alerts assessed by synthetic QA against approved rules, separate from production metrics and customer/support data | QA assignment/execution and independent evidence; no new production metric or pretend pass |
| CBD-79-AC01/02/03/06; CBD13-AC02/05/07; CBD81-AC01/06; CBD81-BOUNDS-001 | Later-bound specification disposition: closure exception with freshness/lateness bounds unset; MT-79-003/008 remain applicable but unavailable, no baseline start/credit or healthy claim; duration baseline separately gated | CBD-81 must preserve required beta evidence, D14 validity and dated continuation/pause process; no performance number or successful evaluation exit inferred |
| CBD-80-AC03/04/05 | Existing privacy, purpose separation, source IDs, owners and destinations retained; lifecycle distinctions grant no new released subtype/outcome labels or tracking | Existing implementation and release gates; no access, retention or customer-data permission expanded |

Manager reports fresh Jira read-back verification of the scoped closure exception in CBD-79-AC01/02/03/06, CBD-13-AC02/05/07 and CBD-81-AC01/06. Jira remains authoritative; this report maps the approved semantics and does not stage or apply Jira updates. The exception affects specification closure only, not Private MVP metric applicability. No expansion or successful beta evaluation exit is permitted without required evidence.

CBD-81 integration must distinguish rates needing approved classification bounds from a duration baseline that can proceed after interval/terminal/source/bucket/release gates. Retain all approved metric/source slots, destinations and baseline periods. Do not use restoration grace, export expiry or backup expiry as SLOs. Runtime feasibility, synthetic QA execution, numerical classification/commitment selection and release controls remain future; independent review of this candidate is pending. No whole-package approval or Jira Done certification follows from these amendments.
