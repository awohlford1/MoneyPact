# CBD-82 — Acceptance-Criteria Traceability and Review Record

| Field | Value |
| --- | --- |
| Status | **Draft v0.2 — Product Owner review and approval required** |
| Document version | 0.2 |
| Owner | Alexander Wohlford |
| Jira | [CBD-82](https://cobudget.atlassian.net/browse/CBD-82) |
| Parent | [CBD-22](https://cobudget.atlassian.net/browse/CBD-22) |
| Model | `docs/cbd-82-financial-profile-and-account-ownership-model.md` |
| Scenario catalog | `docs/cbd-82-account-lifecycle-scenario-catalog.md` |
| Mechanical audit | `python3 scripts/audit-cbd-82.py` |
| Last updated | September 12, 2026 |

## 1. Purpose

What CBD-82 delivered against each of its twelve acceptance criteria, what it found while being written, and what it deliberately did not decide.

## 2. Governing sources

| Source | Version consumed | What is taken from it |
| --- | --- | --- |
| `docs/cbd-92-system-flow-technical-threat-model.md` | v1.0.1 | `CA-92-001`–`CA-92-013` account contracts; `PA-92-006`/`PA-92-007` deletion semantics; `RF-92-006`. **v0.2 correction: v0.1 consumed only `CA-92-001`–`CA-92-012`.** See finding 5 |
| `docs/cbd-72-collaboration-permission-model.md` | v0.1.54 | §2.1 membership model; §2.2 role boundaries; §5.2 derived-value rule; §6 ownership transfer |
| `docs/cbd-91-private-mvp-data-inventory.md` | v1.0.5 | `DI-91-013`, `DI-91-046`, `EG-91-001`, `EG-91-012`, `EG-91-021`, §2.1 sensitivity classes, and §7.2 retained-history policy |
| `docs/cbd-93-privacy-coercion-abuse-analysis.md` | v1.1.2 | `AB-93-019` connection authority under coercion; `AB-93-045` membership loss invalidating the link rather than the connection; §4.12 `AB-93-084`–`AB-93-086`, the analysis of budget-scoped joint projection: the normal unanimous `CA-92-010` ceremony, the coerced confirmation in which every `CA-92-010` protection holds and none establishes willingness, and the unilateral `CA-92-011` dissolution recorded as an accepted residual; candidate safeguards `SG-93-096` and `SG-93-097` and the `RI-93-019` referral |
| `docs/cbd-94-risk-mitigation-requirement-register.md` | v1.0.4 | The verification-inventory route for deterministic fixtures |
| `docs/cbd-95-threat-model-package-manifest.md` | v1.0.7 | The package manifest that governs which CBD-91–94 outputs are baseline, and the `FU-95-*` follow-up route for anything this package defers |
| `docs/cbd-107-connection-and-provenance-boundary-specification.md` | v1.0 | The `FC-107-*` connection contracts and their `CA-92-013` dependency; the provider-side half of the boundary whose profile-side half is `HO-82-05` |
| `docs/cbd-67-weekly-monthly-cadence-workflow-specification.md` | v1.3 | The cadence model that "future routing" attributes into (`HO-82-06`) |
| `docs/cbd-71-mvp-schedule-decision-register.md` | v1.1.3 | The §4 `SD-071-*` atomic decisions bounding what a period boundary may be when routing stops: `SD-071-020` weekly and monthly anchors, `SD-071-026` schedule changes and transition periods, `SD-071-034` and `SD-071-035` the derived budget date, `SD-071-042` a late settlement never moves an ended period's boundaries, `SD-071-045` completed periods retain their dates and schedule-version references |

CBD-93, CBD-95, CBD-107, CBD-67, and CBD-71 are new in §2 in v0.2. All five are named dependencies of CBD-82. CBD-67, CBD-71, CBD-93, and CBD-95 were cited nowhere in the v0.1 package; CBD-107 was cited once, in `OI-82-004` of the v0.1 model, without a version or a contract identifier.

This package does not pin its sources by content hash. It consumes a closed set of numbered contracts whose identifiers the audit checks directly, which catches the drift that matters without failing on unrelated edits to large documents.

## 3. Per-criterion mapping

| Criterion | Requirement | Delivered by | Verified by | Disposition |
| --- | --- | --- | --- | --- |
| `CBD-82-AC01` | Logical schema states every entity, identifier, owner, state, cardinality rule, and prohibited relation; no implementation decision is left implicit | §3 `EN-82-01`–`EN-82-12` with a lifecycle-state column; §3.1 `FD-82-001`–`FD-82-064` field schema; §4; §8.3 state machines; §9; §11 `HO-82-01`–`HO-82-06` state per consumer what it must not decide, and §11 makes a missing decision a defect here rather than a local choice | `audit-cbd-82.py` pins all twelve entities and twelve cardinality rules | **Met at the logical level, which is the criterion's scope.** Physical schema, indexes, and migration are excluded by the ticket's own OUT OF SCOPE and stay at `OI-82-001` |
| `CBD-82-AC02` | Proves one profile per subject, one profile per connection and account, one space per link and projection | §4 `CD-82-01`–`CD-82-12`, including the prohibited relations | `CANON`, `JOINT`, `ISO` scenarios; `LNK-82-T05`, `LNK-82-T06` | **Met** |
| `CBD-82-AC03` | Authority matrix proves connection management belongs only to the authorizer and is independent of budget role, ownership transfer, account visibility, and joint-projection participation | §5 `AU-82-01`–`AU-82-10`: `AU-82-01` and `AU-82-08` for role, `AU-82-02` for transfer, `AU-82-04` and `LK-82-04` for visibility granting no connection control, `AU-82-04` and `CR-82-02` for projection authority granting no connection access, `AU-82-09` rechecking role at commit; `CR-82-03` keeps correction authority with the profile subject | `AUTH-82-T01`–`T03`, `AUTH-82-T06`, `CORR-82-T02`, `CORR-82-T03` | **Met.** Joint-projection independence rests on `AU-82-04` and `CR-82-02`, which state that dissolving a projection grants no connection access; no rule names projection participation as an input to connection authority because none exists |
| `CBD-82-AC04` | Link contract: current authority, default-deny, versioned, revocable, no wider grant | §6 `LK-82-01`–`LK-82-07`; `FD-82-038` version and `FD-82-039` disclosure version | `LNK-82-T01`–`T07`, `AUTH-82-T04`, `ISO-82-T01`, `DERIV-82-T02` | **Met** |
| `CBD-82-AC05` | Joint behavior: matching and confirmation paths, reversible edges, no authority merging, correction rights | §7 `AS-82-04`–`AS-82-08`; §7.1 `CR-82-01`, `CR-82-02`, `CR-82-08` state the contributor, owner, and non-association correction rights | `JOINT-82-T01`–`T08`, `CORR-82-T01`, `CORR-82-T02`, `CORR-82-T07` | **Partly gated.** The explicit-confirmation path and every correction right are fully specified. "Reliable provider matching" has a defined shape and no concrete test until `EG-91-012` closes, so `AS-82-01` cannot be made concrete here. Open under `OI-82-004`; until it closes, `CA-92-010` unanimous confirmation is the only available path. v0.1 claimed this row outright and named a correction right it never stated |
| `CBD-82-AC06` | Weak identifiers never auto-merge; confirm, decline, non-association, split, stale, retry, correction outcomes specified | §7 `AS-82-01`–`AS-82-03`, `AS-82-07`, `AS-82-08`; `PB-82-05`; §7.1 `CR-82-04` stale, `CR-82-05` retry idempotence, `CR-82-06` retry after termination, `CR-82-07` correction observation | `CANON-82-T01`–`T06`, `CORR-82-T04`–`T06`, `JOINT-82-T03`, `JOINT-82-T08` | **Met at rule level.** Deterministic fixtures remain test-design scope under `OI-82-002`. v0.1 listed retry in this row with no rule and no scenario behind it; correction appeared in the v0.1 `CBD-82-AC05` row, equally unbacked |
| `CBD-82-AC07` | Lifecycle matrix distinguishes seven events with exact visibility, sync, history, provenance, notice, and audit effects | §8.1 scope effects and §8.2 record effects across `OC-82-01`–`OC-82-07`; `LC-82-01`–`LC-82-04`; §8.3 state machines | `LIFE-82-T01`–`T08`, `DEL-82-T01`, `DEL-82-T02` | **Met.** v0.1 had no provenance, notice, or audit column |
| `CBD-82-AC08` | One unlink stops one space only, without revoking the connection or changing any other space; multi-space and shared-account scenarios are explicit | `OC-82-01`; `LC-82-01`; `LK-82-04`; `DS-82-03` removes the residue; for a shared account, `LK-82-06` recomputes projections on removal and the §8.3 projection row dissolves a projection left with fewer than two sources | `LIFE-82-T01`, `AUTH-82-T04`, `AUTH-82-T05`, `LNK-82-T05`, `DERIV-82-T03` | **Met for the rule; one scenario gap.** The multi-space case is explicit in `LNK-82-T05` and `LIFE-82-T01`. Unlinking one source of a live joint projection is delivered as a rule at `LK-82-06` and the §8.3 projection row, and `JOINT-82-T07` covers source removal without unlink, but no scenario exercises the unlink path through a projection. That gap is recorded here and no scenario is added in this revision; the catalog stays at 59 |
| `CBD-82-AC09` | Authorizer membership loss preserves, never transfers, never auto-activates | `OC-82-04` and `LC-82-02`, both rewritten in v0.2 against `CA-92-013` and now carrying the orphan label, joint-projection recomputation, rejoin, and restoration rules | `LIFE-82-T03`, `LIFE-82-T04` | **Met in v0.2.** v0.1 was written against `CA-92-002` and CBD-12 and omitted `CA-92-013` entirely, so the rejoin and restoration behavior was absent. See finding 5 |
| `CBD-82-AC10` | Cross-profile and cross-space identifiers, counts, timing, cache, search, report, provenance, concurrency, duplicates, stale reactivation, lost revocation, and silent re-merge have deterministic outcomes | §3 identifier rule; `PB-82-06`; `LC-82-04`; §8.4 `DS-82-01`–`DS-82-07` for cache, index, count, lost revocation, idempotence, and silent re-merge | `ISO-82-T01`–`T07`, `LIFE-82-T08`, `AUTH-82-T06`, `CANON-82-T05`, `DEL-82-T02`, `DERIV-82-T01`–`T06` | **Met in v0.2.** v0.1 claimed cache and lost revocation against `PB-82-06`, `LC-82-04`, and the identifier rule, none of which addresses either. The word "cache" appeared nowhere in the model or the catalog |
| `CBD-82-AC11` | Every retained field and event has purpose, audience, sensitivity, and a retention rule or named gate; copy promises no impossible deletion | §10 `DR-82-01`–`DR-82-04`, `AE-82-01`–`AE-82-03`; §3.1 field inventory, 64 fields; §10.1 event inventory, 21 events | `DEL-82-T03`, `DEL-82-T04` | **Met, with periods gated.** Every field and event carries all four attributes. Where the fourth is a gate rather than a rule it names `EG-91-001`, `OI-82-003`, or CBD-91 §7.2; no retention period is set here and none may be inferred. v0.1 asserted the obligation in `DR-82-01` and enumerated nothing |
| `CBD-82-AC12` | Traceability maps every decision and scenario to CBD-72, CBD-67/71, CBD-91–95, and CBD-107; open decisions have a disposition or follow-up; siblings need no invented authority | This record §2 and §3; §3.1 reverse map; §4 findings; §6 gates; model §11 `HO-82-01`–`HO-82-06` | `audit-cbd-82.py` | **Met in v0.2, with one honest limit.** CBD-67, CBD-71, CBD-93, and CBD-95 were cited zero times in v0.1 and CBD-107 once. All are now mapped in both directions. The limit: the CBD-214, CBD-216, CBD-219, and CBD-49 ticket bodies were not read while writing this, so `HO-82-02` and `HO-82-04` state the contract those consumers inherit rather than a mapping onto their own acceptance criteria. Recorded as finding 7 |

### 3.1 Reverse map: source to decision

AC12 asks for the mapping in both directions. §3 reads criterion to delivery; this table reads source contract to the CBD-82 decision that implements it, so an amendment upstream can be traced down without rereading the model.

| Source item | CBD-82 decisions implementing it |
| --- | --- |
| `CA-92-001`, `CA-92-005` | Model §2 stewardship answer to `EG-91-021`; `EN-82-11` overlay ownership |
| `CA-92-002` | `AU-82-01`, `AU-82-02`, `CD-82-03`, `FD-82-008`, `PB-82-02`, `PB-82-08` |
| `CA-92-003` | `EN-82-06`, `CD-82-06`, `AS-82-02`, `FD-82-031`–`FD-82-033` |
| `CA-92-004` | `EN-82-07`, `CD-82-07`, `CD-82-08`, §6 in full |
| `CA-92-006` | `CR-82-04` stale observation; `CANON-82-T05` |
| `CA-92-007` | `LC-82-01`; the §8.1 and §8.2 split of unlink from disconnect |
| `CA-92-008` | `EN-82-08`, `CD-82-09`–`CD-82-11`, `AS-82-04` |
| `CA-92-009` | `AU-82-03`, `AU-82-07`, `AU-82-08`, `LK-82-02` |
| `CA-92-010` | `EN-82-12`, `AS-82-05`, `AS-82-06`, `FD-82-057`–`FD-82-064`, `EV-82-16` |
| `CA-92-011` | `AS-82-08`, `EN-82-10`, `CD-82-12`, `CR-82-08` |
| `CA-92-012` | `CD-82-01`, `CD-82-02`, `CD-82-05`, `HO-82-01` |
| `CA-92-013` | `OC-82-04`, `OC-82-07`, `LC-82-02`, `EV-82-18`; **new in v0.2** |
| `PA-92-006`, `PA-92-007` | `EN-82-01`, `OC-82-07`, `FD-82-001`, `FD-82-002`, `EV-82-20`, `DEL-82-T01` |
| CBD-72 §2.1, §2.2 | `AU-82-03`–`AU-82-06`, `AU-82-09` |
| CBD-72 §5.2 | `ISO-82-T02` non-revealing derived values; `DS-82-03` |
| CBD-72 §6 | `AU-82-02`, `AUTH-82-T03` ownership transfer moves no authority |
| CBD-91 `DI-91-013`, `DI-91-046` | §3.1 field inventory audience and sensitivity columns |
| CBD-91 §2.1 | The `S0`–`S4` classes used throughout §3.1 and §10.1 |
| CBD-91 §7.2 | `DR-82-04`, and every retention cell resting on it |
| CBD-91 `EG-91-001`, `EG-91-012`, `EG-91-021` | `OI-82-003`, `OI-82-004`, model §2 |
| CBD-93 `AB-93-019` | `AU-82-01`, `AU-82-02`, `PB-82-02` — connection authority is not coercible through a budget role |
| CBD-93 `AB-93-045` | `LC-82-02` — membership loss invalidates the link, not the connection |
| CBD-93 §4.12 `AB-93-084`–`AB-93-086` | `AS-82-05`, `AS-82-06` implement the unanimous, versioned, atomic ceremony `AB-93-084` models; `AS-82-07`, `FD-82-062`, `JOINT-82-T03`, `JOINT-82-T04` keep a decline and an expiry indistinguishable and unrevealed, the property `AB-93-085` relies on; `CR-82-01`, `CORR-82-T01` are the `CA-92-011` self-removal `AB-93-084` and `AB-93-085` name; `AU-82-04`, `CR-82-02`, `CORR-82-T02` are the unilateral owner dissolution `AB-93-086` records as an accepted residual. The `SG-93-096` disclosure content and the `SG-93-097` notice are candidates under CBD-93 §6.14, and the `RI-93-019` objection position is referred to CBD-12; none of the three is decided here. See finding 6 |
| CBD-94 verification inventory | `OI-82-002`; the rule-level-only status of every scenario |
| CBD-95 `FU-95-*` | The follow-up route for `OI-82-001`–`OI-82-004` and for narrowing `RF-92-006` |
| CBD-107 `FC-107-*` | `HO-82-05`; `FD-82-006`–`FD-82-016` connection fields; `OI-82-004` |
| CBD-67; CBD-71 `SD-071-020`, `SD-071-026`, `SD-071-034`, `SD-071-035`, `SD-071-042`, `SD-071-045` | `HO-82-06`; the meaning of "future routing" in §8: attribution into the periods those decisions define, with `OC-82-01` stopping future routing and `SD-071-042` and `SD-071-045` keeping already-attributed periods intact |

## 4. Discrepancy register

| # | Finding | Status |
| --- | --- | --- |
| 1 | `RF-92-006` names five unresolved things, and only one of them is decidable without a selected provider. Treating it as a single open decision made it look larger and more blocked than it is. | **Recorded.** §13 of the model states which part this package closes and which four remain, and proposes narrowing `RF-92-006` rather than closing it, in the same way `CR-91-008` was narrowed. |
| 2 | `EG-91-021` asks which domain is the authoritative steward for canonical accounts. The answer already existed, distributed across `CA-92-001` and `CA-92-005`, but had never been stated as one decision, which is why the gap stayed open. | **Answered in §2 of the model.** The financial profile stewards connections, accounts, and provenance; the budget space stewards its own overlays and visibility; the link is the only bridge. No new decision was required. |
| 3 | CBD-82's twelve acceptance criteria lived in the Jira description while the Acceptance Criteria field was empty, unlike CBD-12 and CBD-75. | **Resolved upstream, not by this package.** A live read on September 12, 2026 shows `customfield_10066` populated with all twelve criteria, matching the description text exactly. The v0.1 finding is retained for history and needs no further action. |
| 4 | CBD-82 cannot move to In Progress. Its parent story CBD-22 has no available transition, and above that the epic CBD-4 is in Planning. | **Recorded.** CBD-82 is Ready, assigned, and dated. Opening a story and an epic to satisfy a workflow rule is a larger decision than starting one subtask, so it was left for the Product Owner. |
| 5 | **v0.1 was written against a stale governing set.** It stated the CBD-92 account contracts as `CA-92-001`–`CA-92-012`. `CA-92-013` exists, governs membership loss, permanent subject loss, and orphan history, and is cited by CBD-93, CBD-102, and four of the six CBD-107 documents: the connection-and-provenance boundary specification, the acceptance-criteria traceability, the candidate shortlist and gate evaluation, and the operational and cost assessment. `LC-82-02` was therefore written against `CA-92-002` and CBD-12 instead of the contract that actually decides the case, and v0.1 omitted the rejoin rule, the orphan label, joint-projection recomputation on membership loss, and the restoration-by-another-member path. | **Corrected in v0.2.** The header, §2 of this record, `OC-82-04`, the §8.2 record-effects row, and `LC-82-02` now cite and implement `CA-92-013`. `scripts/audit-cbd-82.py` was re-pinned in this same revision at `6dcf212` by Guard, as a separate single-writer change: `EXPECTED_CA` now closes at `CA-92-013` (`range(1, 14)`), and the audit asserts that every contract in that set is defined in CBD-92. See finding 8. |
| 6 | **The first v0.2 draft misread CBD-93.** It recorded a CBD-93 §13 coverage gap for `CA-92-008`, `CA-92-010`, and `CA-92-011` joint projection and asked the Product Owner to route it. CBD-93 v1.0.1 did record that gap, and CBD-93 v1.1, the version this package pins as v1.1.2, closed it: §13 states that "§4.12 models budget-scoped joint-account projection in `AB-93-084`–`AB-93-086`, including the `CA-92-010` unanimous confirmation ceremony as a coercive-posture case and the `CA-92-011` create/dissolve asymmetry as an accepted residual". | **Corrected in this revision; no routing needed.** §2 and §3.1 now cite §4.12 and map it. What CBD-82 inherits from it and does not decide: `AB-93-085`'s standing limit that a confirmation which is "explicit, versioned, atomic, and attributable" still does not establish willingness; `AB-93-086`'s accepted residual that "creation is unanimous; destruction is unilateral", which `AU-82-04` and `CR-82-02` implement from `CA-92-011`; and the `RI-93-019` objection-position question, referred to CBD-12 by `SG-93-097`. CBD-93 §12 still carries a v1.0.1 sentence describing the projection as "uncovered and recorded as a §13 gap"; that stale sentence in an approved document is reported for its owner, not corrected here. |
| 7 | The CBD-214, CBD-216, CBD-219, and CBD-49 ticket bodies were not read while writing v0.2. | **Recorded.** `HO-82-02` and `HO-82-04` state the contract those consumers inherit from this model, which is what the criterion requires of CBD-82. They do not claim a mapping onto those tickets' own acceptance criteria, and no such claim should be read into them. |
| 8 | The v0.1 `scripts/audit-cbd-82.py` pinned `DOCUMENT_VERSION = "0.1"`, eleven register sets as closed, the scenario total at 46, and `EXPECTED_CA` at `CA-92-012`. A v0.2 revision that closes the seven gaps necessarily breaks those pins: run unchanged against the v0.2 documents it reports 144 checks and 8 failures. | **Re-pinned in this same revision, at `6dcf212`.** The audit is CI-wired and single-writer, so the specification change at `52c59bc` reported the broken pins and Guard re-pinned in the following commit rather than in the same one: `DOCUMENT_VERSION = "0.2"`, sixteen closed register sets adding `CR`, `DS`, `EV`, `FD`, and `HO`, `SCENARIO_TOTAL = 59` with `EXPECTED_SCENARIOS` pinned as a closed identifier set, and `EXPECTED_CA` at `CA-92-001`–`CA-92-013`. The same commit fixed two checks that were not checking: `SCENARIO_ROW` now matches the backtick every scenario row wraps its identifier in, and a `rows_seen` assertion proves the row scan visited all 59. The audit now reports 252 checks and 0 failures. |

## 5. What this package does not decide

Physical schema, indexes, and migrations. Provider association signals and identity-verification implementation, both of which wait on the CBD-15 selection. The final per-class deletion disposition, which is `EG-91-001`. Retention periods, which stay with CBD-91 §7.2. Deterministic fixtures, which are test-design scope.

A sibling task that finds itself making a product, authority, or lifecycle decision has found a defect here, and the fix belongs in the model rather than in the implementation.

## 6. Evidence gates

| Gate | Required evidence | Status |
| --- | --- | --- |
| Physical model | Approved schema, indexes, partitioning, migration plan | **OPEN — `OI-82-001`** |
| Provider identity reliability | CBD-15 selection and `EG-91-012` evidence for what makes provider identity reliable | **OPEN — `OI-82-004`** |
| Deterministic fixtures | Negative tests for every isolation scenario, under the CBD-94 verification inventory | **OPEN — `OI-82-002`** |
| Retention | `EG-91-001` per-class schedule and CBD-91 §7.2 disposition | **OPEN — `OI-82-003`** |
| Product Owner approval | Approval naming this exact version | **OPEN** |

## 7. Revision history

| Version | Date | Author | Change | Approval |
| --- | --- | --- | --- | --- |
| 0.2 | September 12, 2026 | Claude with Alexander Wohlford as Product Owner | Closed the seven criterion-level gaps found in review and removed the overclaim pattern behind three of them: v0.1 restated "retry", "correction", and "cache" from the criteria in this record while the cited sections contained no such rule and the catalog no such scenario. Every criterion row now carries an explicit disposition, and `CBD-82-AC05` and `CBD-82-AC06` say what remains gated instead of claiming completion. Added §3.1, a reverse map from every source contract to the decisions implementing it, making the traceability bidirectional. Added CBD-93, CBD-95, CBD-107, CBD-67, and CBD-71 to §2, all named CBD-82 dependencies; four were cited nowhere in v0.1 and CBD-107 once, without a version. Recorded findings 5 to 8: the stale `CA-92-012` governing set, the CBD-93 §4.12 joint-projection analysis and what this package inherits from it, the unread consumer tickets, and the audit pins this revision broke and Guard re-pinned at `6dcf212`. Marked finding 3 resolved upstream. **Correction round after the first independent review, same version:** the first v0.2 draft recorded a CBD-93 §13 coverage gap that v1.1 had closed and asked for Product Owner routing; finding 6, §2, and §3.1 now cite §4.12 `AB-93-084`–`AB-93-086` instead. Findings 5 and 8 state the audit re-pin rather than requesting it. The register table is one table again. CBD-71 is cited as `SD-071-*` decisions, not `RF-71-*` review findings. "Every CBD-107 document" is now four of six, named. The v0.1 citation statement counts the one `OI-82-004` mention of CBD-107. `AUTH-82-T04`, `AUTH-82-T06`, `DEL-82-T01`, and `DEL-82-T02` are mapped into §3, so every one of the 59 scenarios now appears in a Verified-by cell. The AC01, AC03, and AC08 restatements carry the clauses they had dropped, and AC08 records the unlink-through-a-projection scenario gap without adding a scenario. The `CBD-82-AC06` note no longer attributes "correction" to the v0.1 AC06 row. No open issue was closed and no evidence gate moved. | Draft; Product Owner review required |
| 0.1 | September 3, 2026 | Claude with Alexander Wohlford as Product Owner | Initial record for the CBD-82 v0.1 draft. Twelve criteria mapped, four findings, five evidence gates open. | Draft; Product Owner review required |
