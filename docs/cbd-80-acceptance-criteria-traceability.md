# CBD-80 — Acceptance Criteria Traceability and Completeness Report

| Field | Value |
| --- | --- |
| Status | **Approved v1.2** — Product Owner approved v1.0 on September 5, 2026, and two amendments the same day. All six acceptance criteria are met. **The release decision is taken** — §6, September 5, 2026: the nine `reliability-telemetry` metrics route to the S1 sink CBD-122 establishes, and the nineteen `aggregate-state` figures become a periodic written record. What remains is `OQ-80-005`, **where that record lives**, because §3.4 requires deletion and this repository cannot delete |
| Document version | 1.2 |
| Owner | Alexander Wohlford |
| Reviewer | Alexander Wohlford — Product Owner. **Approved September 5, 2026** after a review that corrected one citation |
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

**Status: Met.**

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

**Status: Met.**

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

**Implementing the decision surfaced a constraint the proposal had not.** §3.4 requires released figures to be deleted with the beta's operational records, and **a record committed to this repository can never be deleted** — git history is permanent, and these documents publish to Confluence. `OQ-80-005` carries where the record lives; the shape is settled and the place is not.

## 6. What this package does not establish

* **No source is implemented and none has been read.** Thirty-three sources are named against operational state that does not yet exist.
* **No source has a schema**, because the product has none — `OQ-80-002`. Each needs a binding when its owning feature is built, and that binding is where a derivation can quietly change meaning.
* **The figures have a form and no place** until `OQ-80-005` names a deletable store outside version control.
* **`MS-80-019` and `MS-80-020` may not be releasable at all**, pending `OQ-78-002` on `AB-74-014`.
* **No safety source exists**, because CBD-79 defines no safety metric pending `OQ-13-007`.
* **Written and reviewed by the same person.**

## 7. Revision record

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 1.2 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | **`OQ-80-001` decided.** Two destinations rather than one: the nine `reliability-telemetry` metrics route to the S1 sink `CBD-122-AC05` already establishes — half the answer the v1.1 proposal had missed — and the nineteen `aggregate-state` figures become a periodic written record consumed by CBD-81's review, chosen because a record has no query interface for a drill-down to grow from. Implementing it surfaced `OQ-80-005`: §3.4 requires the figures to be deleted and **this repository cannot delete**, so the record must live in an operational store outside version control. `OQ-80-006` records a dependency on `CBD-122-AC01`'s closed attribute universe. `OI-80-004` accepts the lost trend view | **Approved v1.2** |
| 1.1 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | **Reopened and amended the day it closed.** The `OQ-13-007` decision gave CBD-79 two safety metrics — consent changes and revocation failures — and three sources needed registering: `MS-80-031`, `MS-80-032` and `MS-80-033`, all accepted as proposed. **The cross-package audit found them, not a person**: it failed on three unregistered proposals and two metrics no source served. The v1.0 closure comment predicted this and named the route, so it is the register working rather than the register breaking. No rule, naming decision, or existing source changes | **Approved v1.1** |
| 1.0 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | **Approved.** The review checked every cited identifier against its source and found that this register had restated `AN-92-004` faithfully and inherited its error: `AN-92-004` groups `DI-91-071` with S3 restricted security evidence, and the approved CBD-91 inventory classifies it **S1** non-secret key-lifecycle metadata. §3.3 now names only `DI-91-053` and `DI-91-062`, and `OQ-80-004` records the discrepancy against the two documents that own it. It narrows `OQ-13-007` rather than widening it. No source, derivation, or rule changes | **Approved v1.0** |
| 0.1 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | Initial package: thirty registered sources, the naming decisions at §4, the privacy and retention rules at §3, the release-surface proposal at §6, a cross-package structural audit, and this report | Superseded by 1.0 |
