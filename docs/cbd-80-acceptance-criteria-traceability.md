# CBD-80 — Acceptance Criteria Traceability and Completeness Report

| Field | Value |
| --- | --- |
| Status | **Draft v0.1 — not approved.** All six acceptance criteria are met. **One thing is proposed and not decided**: `OQ-80-001`, the release surface, which §6 of the register derives from approved constraints and puts to the Product Owner. Until it is answered every metric in CBD-77 through CBD-79 is defined, computable in principle, and **released nowhere** |
| Document version | 0.1 |
| Owner | Alexander Wohlford |
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
| `docs/cbd-80-measurement-source-register.md` | Thirty registered sources, the naming decisions, the privacy and retention rules, and the release-surface proposal |
| `docs/cbd-80-acceptance-criteria-traceability.md` | This report |
| `scripts/audit-cbd-80.py` | Structural audit. **Unlike its siblings this one is cross-package**: it checks that every proposal in CBD-77, CBD-78 and CBD-79 is registered and that every metric there has a source |

## 2. Acceptance criteria

### CBD-80-AC01 — each source has a stable name, state of record, derivation, refresh basis, boundary, and owning metric

**Status: Met.**

All thirty rows carry all six, and the audit fails a row with a missing column or an empty cell rather than trusting the table to look complete.

**`Boundary` is `worker` for every source**, per conventions decision 3. The field is kept rather than collapsed into a package constant precisely so a source computed elsewhere is visibly wrong.

This criterion was amended on September 5, 2026 from *"Each **event** has a stable name, trigger, source…"*. It was one of the three that `scripts/check-an92-criteria.py` found after three hand sweeps had missed them.

### CBD-80-AC02 — aggregate-state and reliability telemetry are distinguished

**Status: Met.** Class is marked per row; nine sources are `reliability-telemetry` and the rest `aggregate-state`.

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
| Measurement source register | **Met** — thirty sources, thirty-one proposals, the difference recorded | Register §5 |
| Naming decisions | **Met** — one merge, one clarified pair, one rejected merge, each with its reason | Register §4 |
| Privacy rules | **Met** — prohibited content, identifiers, purpose separation | Register §3 |
| Retention, access, export, deletion | **Met** | Register §3.4 |
| Release surface | **Proposed, not decided** | Register §6, `OQ-80-001` |
| Structural audit | **Met** — 431 checks, eight guards proven by deliberate violation | `scripts/audit-cbd-80.py` |

## 4. What the cross-package check found

The audit compares this register against all three sibling packages in both directions, and that is the guard this package exists to provide.

**Thirty-one proposals, thirty sources.** The difference is `MS-80-017`, which merges the two retention sources CBD-78 proposed separately — both read the same `AD-78-001` derivation and differ only in window B, so two sources would let one drift from the other. `OI-80-001` records that if the two retention metrics ever need different activity definitions, this merge must be undone first.

**Every metric in CBD-77 through CBD-79 has at least one source, and every source has at least one metric.** A metric with no source is not computable; a source no metric reads should not be registered. Both directions are checked, because only checking one would let either kind of orphan through.

**No proposal was silently dropped.** The audit fails if a proposed name is neither registered nor recorded in §4 as merged or renamed — proven by renaming a proposal in CBD-77 and watching the build fail.

## 5. `OQ-80-001` — what is proposed, and why it is not taken here

Register §6 works through the surfaces the product has and finds that **approved constraints exclude every one of them**: the customer product by `AB-74-014`, the routine support surface by `OP-92-002`'s bar on counts, the security store by `AN-92-004` and `AN-92-006`, and a general operator console by `OP-92-001`'s default-deny.

What is left is a **measurement surface holding only released aggregates**, reading no production data at request time. Three properties follow from `AN-92-006` rather than being added to it: it cannot answer a question it was not built to answer, its store is separate with its own retention, and a deletion request finds nothing in it.

**It is proposed and not taken because it creates a surface**, and that is a product decision rather than a construction of existing rules. The register states the reasoning so the decision can be made on stated terms rather than by default.

## 6. What this package does not establish

* **No source is implemented and none has been read.** Thirty sources are named against operational state that does not yet exist.
* **No source has a schema**, because the product has none — `OQ-80-002`. Each needs a binding when its owning feature is built, and that binding is where a derivation can quietly change meaning.
* **No figure may be released anywhere** until `OQ-80-001` is answered.
* **`MS-80-019` and `MS-80-020` may not be releasable at all**, pending `OQ-78-002` on `AB-74-014`.
* **No safety source exists**, because CBD-79 defines no safety metric pending `OQ-13-007`.
* **Written and reviewed by the same person.**

## 7. Revision record

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 0.1 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | Initial package: thirty registered sources, the naming decisions at §4, the privacy and retention rules at §3, the release-surface proposal at §6, a cross-package structural audit, and this report | Draft; Product Owner approval required |
