# CBD-80 — Acceptance Criteria Traceability and Completeness Report

| Field | Value |
| --- | --- |
| Status | **Candidate amendment v1.5**. Specific meanings approved in `CBD13-PROFILE-001`, `CBD13-CATEGORY-001` and `CBD13-USABLE-TIME-001`; CBD-80 also applies `CBD13-RETENTION-001`. Prior activation amendment independently reviewed and merged in PR #236; retention source amendment independently reviewed and merged in PR #237. This new candidate awaits independent review. Prior approvals remain in force; no whole-package approval, computation, release or closure is inferred |
| Document version | 1.5 |
| Owner | Alexander Wohlford |
| Reviewer | Independent review pending for this candidate; prior activation/retention reviews remain valid only for their reviewed amendments |
| Jira | [CBD-80](https://cobudget.atlassian.net/browse/CBD-80) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Companion | `docs/cbd-80-measurement-source-register.md`, which this report checks |
| Mechanical audit | `scripts/audit-cbd-80.py` — 431 checks, every guard proven by deliberate violation |
| Confluence page | **Not published.** Registration follows approval |
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
| CBD-80-AC03/04/05; CBD81-BASELINE-001 | Existing privacy rules, IDs, consumers, owners and destinations preserved; W4 and R4/R8 remain future applicable baselines for deferred metrics | Independent candidate review and CBD-81 applicability/exit follow-through; unchanged release/privacy gates |

CBD-81 follow-through must distinguish logical definition completion from physical-source readiness, apply the approved MT-77-005/MT-78-004/005/006 deferrals without successful baseline credit, and retain W4/R4/R8 for future applicability. R4/R8 still require two valid observation pairs with earliest reviews after six/ten weeks. No numerical privacy minimum, target, metric result or beta-success claim is added. This assignment does not edit CBD-81 or certify Jira Done. Structural checks and safe synthetic failure proofs are evidence of documentation integrity only; independent semantic review remains required.
