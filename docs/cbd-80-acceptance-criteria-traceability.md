# CBD-80 — Acceptance Criteria Traceability and Completeness Report

| Field | Value |
| --- | --- |
| Status | **Accepted specification v1.7** under CBD13-FINAL-ACCEPTANCE-001, with all recorded decisions and exceptions preserved. CBD13-FINAL-REVIEW-002 approves the integrated package and closes both prior findings; CBD13-FINAL-SECURITY-002 clears specification privacy only. No runtime measurement, numerical reporting, beta launch, deployment or Jira Done claimed |
| Document version | 1.7 |
| Owner | Alexander Wohlford |
| Reviewer | Independent CBD13-FINAL-REVIEW-002: approve; CBD13-FINAL-SECURITY-002: clear for specification privacy acceptance |
| Jira | [CBD-80](https://cobudget.atlassian.net/browse/CBD-80) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Companion | `docs/cbd-80-measurement-source-register.md`, which this report checks |
| Mechanical audit | `scripts/audit-cbd-80.py` — 431 checks, every guard proven by deliberate violation |
| Confluence page | [CBD-80 — Acceptance Criteria Traceability and Completeness Report](https://cobudget.atlassian.net/wiki/spaces/CBD/pages/20807741) |
| Last updated | September 5, 2026 |

## 1. Package contents

| Document | Purpose |
| --- | --- |
| `docs/cbd-80-measurement-source-register.md` | Thirty-three registered sources, the naming decisions, the privacy and retention rules, and the release-surface proposal |
| `docs/cbd-80-acceptance-criteria-traceability.md` | This report |
| `scripts/audit-cbd-80.py` | Structural audit. **Unlike its siblings this one is cross-package**: it checks that every proposal in CBD-77, CBD-78 and CBD-79 is registered and that every metric there has a source |

## 2. Acceptance criteria

### CBD-80-AC01 — each source has a stable name, state of record, derivation, refresh basis, boundary, and owning metric

**Status: Prior activation correction independently reviewed and merged; current source candidate review pending.** Register MS-80-001/002/003/004/005/008 and its Activation population contract implement `CBD13-ACTIVATION-001`. MS-80-002 intersects subject eligibility; MS-80-005 intersects created-space eligibility; MS-80-008 intersects period-holding eligibility. MS-80-004 preserves broad MT-77-006/007 counts and a separate MT-77-002 creation-window intersection. Source IDs and consumers are unchanged. Profile/category logical meanings are now approved; physical binding and verification remain open. MS-80-007 timing is explicitly deferred, and MS-80-015/016/017 carry the merged retention deferral. A registered derivation is not an implemented source.

All thirty-three rows carry all six, and the audit fails a row with a missing column or an empty cell rather than trusting the table to look complete.

**`Boundary` is `worker` for every source**, per conventions decision 3. The field is kept rather than collapsed into a package constant precisely so a source computed elsewhere is visibly wrong.

This criterion was amended on September 5, 2026 from *"Each **event** has a stable name, trigger, source…"*. It was one of the three that `scripts/check-an92-criteria.py` found after three hand sweeps had missed them.

### CBD-80-AC02 — aggregate-state and reliability telemetry are distinguished

**Status: Met.** Class is marked per row; ten sources are `reliability-telemetry` and the rest `aggregate-state`.

**The distinction does work rather than labelling.** Register §3.3 forbids joining across the two streams, because a join would give the reliability stream a purpose it was not collected for — `AN-92-006`. The classes exist to make that rule expressible.

### CBD-80-AC03 — prohibited content

**Status: Met.** Register §3.1 lists six classes, including free text of any kind, and the audit fails if the list is removed.

### CBD-80-AC04 — identifiers minimized or pseudonymous, budget-space access rules respected

**Status: Met, and by a stronger route than the criterion asks.**

The criterion asks for minimization or pseudonymity. **The register gives neither, because the contracts give something stronger**: `AN-92-003` bars subject, space, account, connection and device references from reliability telemetry, and `AN-92-005` bars persisting contributing customer-level records. **No identifier reaches a measurement surface at all**, so there is nothing to pseudonymise.

`AN-92-002` is why this matters rather than being a pleasant surplus: pseudonymization *would not have been sufficient* — it says plainly that pseudonymization does not make a prohibited mechanism permitted.

**Budget-space access rules are respected trivially.** A cross-space disclosure needs a space-scoped figure to disclose, and every release is a whole-population figure.

### CBD-80-AC05 — retention, access, export and deletion expectations

**Status: Met.** Register §3.4 states all four, plus the consent position.

**The deletion row is the one worth reading.** A customer deletion request under `INC-76-010` reaches the measurement store and finds nothing, because it holds no customer-level record. **That is a property of the design, not a process someone must run** — and it is the strongest argument for the whole `AN-92-005` re-architecture, which was adopted to satisfy a prohibition rather than to make deletion easy.

**No consent basis is recorded**, per the September 5, 2026 amendment. `AN-92-002` states that consent does not make a prohibited mechanism permitted, so recording one would imply the collection needed it and that refusal would stop it. Neither is true.

### CBD-80-AC06 — duplicate counting prevented by the derivation

**Status: Prior activation correction independently reviewed and merged; current source candidate review pending.** The Activation population contract counts distinct eligible subjects/spaces rather than joined rows, forbids persisting contributing membership, and keeps each numerator within its owning denominator. The broad MS-80-004 count is not interchangeable with its MT-77-002 intersection.

Every derivation counts an **outcome reached in the state of record**, not an attempt observed. A space has one state, an invitation has one terminal state, an instance has one acknowledgement state — so a repeated action contributes one row because the entity contributes one row.

This criterion was amended on September 5, 2026 from *"Duplicate **event** handling and **idempotency** requirements"*. §3 of the conventions withdrew `idempotency_key` for a reason worth restating: **the identifier that would make duplicate detection possible is the identifier `AN-92-005` prohibits persisting.** The constraint and the solution are the same fact.

## 3. Deliverables

| Deliverable | Status | Where |
| --- | --- | --- |
| Measurement source register | **Met** — thirty-three sources, thirty-four proposals, the difference recorded | Register §5 |
| Naming decisions | **Met** — one merge, one clarified pair, one rejected merge, each with its reason | Register §4 |
| Privacy rules | **Met** — prohibited content, identifiers, purpose separation | Register §3 |
| Retention, access, export, deletion | **Met** | Register §3.4 |
| Release surface | **Decided September 5, 2026** — two destinations; the aggregate half is a written record | Register §6 |
| Structural audit | **Met** — 431 checks, eight guards proven by deliberate violation | `scripts/audit-cbd-80.py` |

## 4. What the cross-package check found

The audit compares this register against all three sibling packages in both directions, and that is the guard this package exists to provide.

**34 proposals, 33 sources.** The difference is `MS-80-017`, which merges the two retention sources CBD-78 proposed separately — both read the same `AD-78-001` derivation and differ only in window B, so two sources would let one drift from the other. `OI-80-001` records that if the two retention metrics ever need different activity definitions, this merge must be undone first.

**Every metric in CBD-77 through CBD-79 has at least one source, and every source has at least one metric.** A metric with no source is not computable; a source no metric reads should not be registered. Both directions are checked, because only checking one would let either kind of orphan through.

**No proposal was silently dropped.** The audit fails if a proposed name is neither registered nor recorded in §4 as merged or renamed — proven by renaming a proposal in CBD-77 and watching the build fail.

## 5. `OQ-80-001`, decided

Register §6 worked through the surfaces the product has and found that approved constraints exclude every one: the customer product by `AB-74-014`, the routine support surface by `OP-92-002`'s bar on counts, the security store by `AN-92-004` and `AN-92-006`, and a general operator console by `OP-92-001`'s default-deny.

**The v1.1 proposal then treated all 28 metrics as needing one new surface, and that was wrong.** `CBD-122-AC05` already establishes three destinations with three access roles, and `CBD-122-AC08` already emits terminal-state counts — so the nine `reliability-telemetry` metrics have a destination that is being built anyway, for the same purpose, raising no `AN-92-006` question.

**Only the nineteen `aggregate-state` figures needed an answer, and it is a written record rather than a surface.** The reasoning is not economy: a record has no query interface, so there is no drill-down for one to grow later; its retention is the record's own; and `OP-92-001` is satisfied by construction because nothing stands reading production.

**It costs a trend view**, recorded at `OI-80-004`. Comparing four weeks means reading four records, and the retention series are where that matters most.

**Implementing the decision surfaced a constraint the proposal had not**, and it is now also settled. §3.4 requires released figures to be deleted with the beta's operational records, and **a record committed to this repository can never be deleted** — git history is permanent, and these documents publish to Confluence.

**The record lives in its own schema in the Cloud SQL instance CBD-108 selected**, with its own access role and retention. `AN-92-006` names *schemas* as the unit of separation, so this is the shape the contract contemplates rather than a workaround; deletion is a bounded `DROP`; and the instance is already in the approved composition, so there is no new provider and no new gate.

**Object storage was the obvious answer and the corpus rules it out twice.** `OI-108-034` records that introducing it into a composition reopens `HG-102-013` — the one gate that could fail every candidate at once — and Google disclaims any bound on its lifecycle deletion timing, which §3.4 cannot accept either.

**What remains is `OQ-80-007`**: the drop at beta end must be a stated step in the CBD-63 beta-operations runbook. A schema nobody drops is retained forever, and §3.4 would be satisfied on paper only.

## 6. What this package does not establish

* **No source is implemented and none has been read.** Thirty-three sources are named against operational state that does not yet exist.
* **No source has a schema**, because the product has none — `OQ-80-002`. Each needs a binding when its owning feature is built, and that binding is where a derivation can quietly change meaning.
* **The drop at beta end is not scheduled anywhere.** `OQ-80-007` — the store is named and its emptying is not, which CBD-63's runbook must carry.
* **`MS-80-019` and `MS-80-020` may not be releasable at all**, pending `OQ-78-002` on `AB-74-014`.
* **No safety source exists**, because CBD-79 defines no safety metric pending `OQ-13-007`.
* **Written and reviewed by the same person.**

## 7. Revision record

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 1.3 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | **`OQ-80-005` decided.** The periodic record lives in its own schema in the Cloud SQL instance CBD-108 selected, with its own access role and retention — `AN-92-006` names schemas as the unit of separation, so the contract contemplates this shape rather than tolerating it, deletion is a bounded `DROP`, and no new provider or gate is introduced. **Object storage was rejected on the corpus rather than on preference**: `OI-108-034` records that it reopens `HG-102-013`, and Google disclaims any bound on its lifecycle deletion timing, so it fails §3.4 as well. Raises `OQ-80-007`, that the drop at beta end must be a stated step in CBD-63's runbook rather than an assumption | **Approved v1.3** |
| 1.2 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | **`OQ-80-001` decided.** Two destinations rather than one: the nine `reliability-telemetry` metrics route to the S1 sink `CBD-122-AC05` already establishes — half the answer the v1.1 proposal had missed — and the nineteen `aggregate-state` figures become a periodic written record consumed by CBD-81's review, chosen because a record has no query interface for a drill-down to grow from. Implementing it surfaced `OQ-80-005`: §3.4 requires the figures to be deleted and **this repository cannot delete**, so the record must live in an operational store outside version control. `OQ-80-006` records a dependency on `CBD-122-AC01`'s closed attribute universe. `OI-80-004` accepts the lost trend view | **Approved v1.2** |
| 1.1 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | **Reopened and amended the day it closed.** The `OQ-13-007` decision gave CBD-79 two safety metrics — consent changes and revocation failures — and three sources needed registering: `MS-80-031`, `MS-80-032` and `MS-80-033`, all accepted as proposed. **The cross-package audit found them, not a person**: it failed on three unregistered proposals and two metrics no source served. The v1.0 closure comment predicted this and named the route, so it is the register working rather than the register breaking. No rule, naming decision, or existing source changes | **Approved v1.1** |
| 1.0 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | **Approved.** The review checked every cited identifier against its source and found that this register had restated `AN-92-004` faithfully and inherited its error: `AN-92-004` groups `DI-91-071` with S3 restricted security evidence, and the approved CBD-91 inventory classifies it **S1** non-secret key-lifecycle metadata. §3.3 now names only `DI-91-053` and `DI-91-062`, and `OQ-80-004` records the discrepancy against the two documents that own it. It narrows `OQ-13-007` rather than widening it. No source, derivation, or rule changes | **Approved v1.0** |
| 0.1 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | Initial package: thirty registered sources, the naming decisions at §4, the privacy and retention rules at §3, the release-surface proposal at §6, a cross-package structural audit, and this report | Superseded by 1.0 |


## Activation correction validation and handoff

CBD-80-AC01/06 corrections support CBD-13-AC02/07 and later CBD-81 source-gate review. The existing cross-package audit checks source registration, fields and structural consistency; it cannot prove population semantics or authorized timestamp availability. The prior independent activation review compared the six amended source rows and the Activation population contract with CBD-77 §4/§5 and the exact Executive decision. No new release policy, source, metric, destination, schema, retention or baseline period is introduced. Prior audit counts elsewhere in this report describe the historical baseline. Whole-package approval and source implementation remain separate gates.

## Activation amendment record

| Version | Basis | Change | Status |
| --- | --- | --- | --- |
| 1.4 | Approved baseline v1.3; Executive decision `CBD13-ACTIVATION-001`, September 5, 2026 | Correct MT-77-001/002/003/006 population intersections, exclusive-close UTC week, grace boundary, archived-space exception, consumer-specific period counts and privacy-gated empty population. Preserve source IDs and all other decisions | Independently reviewed and merged in PR #236; current candidate review remains pending |

## Usable-definition amendment record

| Version | Authority | Change | Status |
| --- | --- | --- | --- |
| 1.5 | `CBD13-PROFILE-001`; `CBD13-CATEGORY-001`; `CBD13-USABLE-TIME-001`; shared `CBD13-RETENTION-001` follow-through; `CBD81-BASELINE-001` | Exact profile/category/target predicates; MT-77-008 matching set; MT-77-005 deferred with future slot/interval/W4; CBD-80 retention-source feasibility restrictions. Prior approved activation populations, IDs, owners, destinations, account OR transaction choice and privacy gates preserved | Candidate; independent review pending; no measured result or Done claim |

## Current amendment criterion evidence and CBD-81 handoff

| Criterion / decision | Definition and source evidence | Remaining gate |
| --- | --- | --- |
| CBD-77-AC03; CBD13-PROFILE-001 | CBD-77 §3 Profile; CBD-80 MS-80-005 and Approved usable predicates section: current active Primary Owner, exactly one extant active person-level profile; empty qualifies, absent fails, ambiguous/multiple invalidates source; excluded lifecycle states and no completeness requirement | CBD-82 feature owner physical association/lifecycle binding and proof; no new private access |
| CBD-77-AC03; CBD13-CATEGORY-001 | CBD-77 §3 Category/Allocation and MT-77-008; CBD-80 MS-80-010/011: current active expense entity, stable identity and exclusions; same qualifying set for target numerator and category denominator, stored zero qualifies, missing fails, approved proration qualifies | CBD-30 feature owner physical predicate/target binding and proof |
| CBD-77-AC01/02/03; CBD13-USABLE-TIME-001 | MT-77-005 and MS-80-007 explicitly deferred/unavailable; intended first-simultaneous interval and future W4 retained; MT-77-003 remains required with five limbs | Approved operational-source contract proving coexistence after replacement/deletion/period changes; no timestamp/history proxy, baseline credit or timing-success claim |
| CBD-80-AC01/06; CBD13-RETENTION-001 | MS-80-015/016/017 carry merged CBD-78 MT-78-004/005/006 deferral: permissions are not actions, occurrence times and historical A/B evidence unproven under mutation/deletion | Approved operational-source proof without behavioral events, retained measurement membership or audit-purpose reuse; no zero, baseline credit or measured success |
| CBD-80-AC03/04/05; CBD81-BASELINE-001 | Existing privacy rules, IDs, consumers, owners and destinations preserved; W4 and R4/R8 remain future applicable baselines for deferred metrics | Independent review and CBD-81 applicability/exit follow-through complete; unchanged release/privacy gates |

CBD-81 follow-through must distinguish logical definition completion from physical-source readiness, apply the approved MT-77-005/MT-78-004/005/006 deferrals without successful baseline credit, and retain W4/R4/R8 for future applicability. R4/R8 still require two valid observation pairs with earliest reviews after six/ten weeks. No numerical privacy minimum, target, metric result or beta-success claim is added. This assignment does not edit CBD-81 or certify Jira Done. Structural checks and safe synthetic failure proofs are evidence of documentation integrity only; independent semantic review is recorded in CBD13-FINAL-REVIEW-002.

## Lifecycle amendment record

| Version | Authority | Change | Status |
| --- | --- | --- | --- |
| 1.6 | `CBD13-LIFECYCLE-001`; `CBD81-BOUNDS-001`; `CBD13-CORRECTNESS-001` | Freshness snapshot; end-to-end alert lateness; accepted lifecycle start, both deletion scopes and source-specific application-controlled endpoints; matching completed-plus-failed rate/elapsed populations; synthetic correctness QA and explicit later-bound closure exception | Candidate; independent review pending. Existing approvals preserved; no measurement or executed QA claimed |

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

CBD-81 integration must distinguish rates needing approved classification bounds from a duration baseline that can proceed after interval/terminal/source/bucket/release gates. Retain all approved metric/source slots, destinations and baseline periods. Do not use restoration grace, export expiry or backup expiry as SLOs. Runtime feasibility, synthetic QA execution, numerical classification/commitment selection and release controls remain future; independent CBD13-FINAL-REVIEW-002 approves the specification, accepted under CBD13-FINAL-ACCEPTANCE-001. Jira workflow closure remains pending authorized merges; no runtime certification follows.

## Final source-correction amendment record

| Version | Authority | Change | Status |
| --- | --- | --- | --- |
| 1.7 | `CBD13-INVITATION-SENT-001`; `CBD13-SYNC-POPULATIONS-001` | Sent projection/synthetic-validation clarification and metric-specific terminal-day synchronization populations, with corresponding shared source derivations; all unrelated decisions preserved | Candidate; independent review pending; no runtime or executed-QA claim |

## Final source-correction traceability and CBD-81 handoff

| Criterion / decision | Scoped evidence | Remaining gate |
| --- | --- | --- |
| CBD-78-AC02; CBD13-INVITATION-SENT-001 | CBD-78 Approved invitation sent coverage and CBD-80 MS-80-014: existing sent/pending projection plus defined synthetic validation; terminal-only MT-78-002/003 unchanged; no production send count or trend claim | Existing CBD-73 scenario/implementation/privacy evidence and release gates; synthetic execution is future |
| CBD-79-AC01; CBD13-AC02; CBD13-SYNC-POPULATIONS-001 | CBD-79 MT-79-001/002/004/005 and Approved synchronization terminal-day populations: exact R(D)/S(D), terminal-day attribution, per-metric cancellations/retries/failures and duration; MT-79-003 snapshot unchanged | Operational run identity, first-attempt/terminal timestamps, retry and outcome mappings, safe buckets and release evidence |
| CBD-80-AC01/06; CBD13-SYNC-POPULATIONS-001 | MS-80-021 separate consumer counts; MS-80-022 all-R duration; MS-80-024 all-R retry buckets including zero; MS-80-025 failed subset with all-R denominator | Do not share one filtered scalar, infer supersession, count duplicate delivery, or reuse measurement membership for replay identity |
| CBD-81 source/baseline integration | Both exact decisions resolve the two inherited source-definition gaps identified in CBD13-FINAL-REVIEW-001, closed by independent CBD13-FINAL-REVIEW-002 | CBD-81 source-version and criterion traceability are integrated and accepted; applicable baseline/release/bounds, four prior metric deferrals and executed-QA gates remain |

The selected meanings and package are Executive-accepted under CBD13-FINAL-ACCEPTANCE-001, following independent CBD13-FINAL-REVIEW-002 approval. Definitions do not establish observed synchronization, dispatch/delivery, synthetic QA execution, source feasibility, numerical release or successful beta evaluation. All prior lifecycle, profile/category, activation, retention, usable-timing, privacy and bounds decisions remain in force. No new source IDs, metrics, owners, destinations, release labels, tracking or retained measurement history are added.

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
