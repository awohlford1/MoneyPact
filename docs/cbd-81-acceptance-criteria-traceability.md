# CBD-81 — Acceptance criteria traceability

Version 0.1, proposed; September 5, 2026. Companion to the
[targets and review process](cbd-81-beta-targets-and-review-process.md).
Repository baseline: `f1903e780b7b4f984c210c2234af2e05ae570b6c`.
Source follow-through: activation decision `CBD13-ACTIVATION-001`, independent
review `CBD13-ACTIVATION-REVIEW-001`, merged PR #236 at
`c757f24bda56dcdf74f4a2eb16a531ec5d1a63f6`.
`CBD13-RETENTION-001` approves Private MVP deferral; CBD-78 source candidate
`71cb6d6cd17c3c472933ea4894a80e14e4614bec` awaits integration. This report uses
the Manager's decision record for the approved amended criteria and makes no
fresh Jira workflow or closure assertion.
The live amended criteria on [CBD-81](https://cobudget.atlassian.net/browse/CBD-81)
and [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) were read, including
status, links, subtasks and comments, on September 5, 2026. Jira remains the
authority for their wording and workflow. This report assesses evidence; it
does not mirror issue administration or claim acceptance.

## 1. CBD-81 coverage

| Criterion | Package evidence | Disposition |
| --- | --- | --- |
| CBD-81-AC01 | Process sections 2–4: exact 28-row inventory; approved W4/D14/R4/R8 timing and bounded decisions, current versus future applicability, generic-Withheld rules and pending-bound/zero-failure guardrails | DEC-81-001 approved under CBD81-BASELINE-001; retention/breadth deferral approved under CBD13-RETENTION-001. Remaining process/package approval, DEC-81-002/003 and source/release gates pending; no measurement or performance-target approval |
| CBD-81-AC02 | Section 4: every metric assigned exactly one product, synchronization, notifications or security owner; solo Product Owner carries responsibilities without expanding access | Covered by proposal |
| CBD-81-AC03 | Sections 2, 4–5: daily service decisions, weekly product/baseline decisions and relevant release reviews; no shortened or extra measurement windows | Covered by proposal |
| CBD-81-AC04 | Section 4: action for every unhealthy metric; sections 3 and 5 constrain suppression, access, rollback and communication | Covered by proposal; implementation and authorization of actions remain separate |
| CBD-81-AC05 | Section 5: continuation, affected/full pause, expansion, successful evaluation exit and incomplete beta end; approved Private MVP deferral and deletion handoff | Covered by proposal within approved scope reduction; deferred metrics are not current success evidence and never counted as measured success. Remaining process approvals and operational evidence pending |
| CBD-81-AC06 | Section 2 below reviews all eight parent criteria | Not complete. Activation population correction and retention/breadth scope decision settled; profile/category/timestamp evidence, pending privacy/bound/process decisions and source integration/implementation gates remain |

## 2. Parent criterion review

| Criterion | Existing definition evidence and CBD-81 contribution | Closure assessment |
| --- | --- | --- |
| CBD-13-AC01 | CBD-77 activation; CBD-78 engagement; CBD-79 reliability and permitted safety measures; process section 4 includes all 28 IDs | Categories present. Denied-access/support signals retain their approved Private MVP exclusion and SRV-94-010 routing |
| CBD-13-AC02 | CBD-77/78/79 records plus process sections 4/6; approved activation correction merged in PR #236 at c757f24; approved full MT-78-004/005/006 Private MVP deferral | Prior DEF-81-002 population inconsistency resolved. OQ-77-003/004 observable-profile/category definitions and MT-77-005 first-simultaneous timestamp proof remain gaps. Deferred metrics retain future source-proof requirements under DEF-81-001, not current computability requirements. CBD-78 source follow-through awaits integration; applicable source bindings and independent verification remain |
| CBD-13-AC03 | CBD-79 MT-79-001–005 CONN-REQUIRED; process section 4 explicitly defers bank start without blocking manual measurement | Covered at specification level; no bank availability claimed |
| CBD-13-AC04 | CBD13-RETENTION-001 approved deferral; process sections 2/4/5/6 retain MT-78-005/006 and future R4/R8 periods without requiring current Private MVP retention evidence | Approved specification disposition under amended criterion; CBD-78 source candidate 71cb6d6 awaits integration. No measured success, zero or successful retention asserted. Historical source proof and release/implementation controls required before future applicability; separate cadence-segmentation deferral preserved |
| CBD-13-AC05 | CBD-79 MT-79-007/008 duplicate/late; CBD-78 MT-78-007/008 acknowledged/dismissed; process sections 4, 6 and 7 | Executive clarification accepted: technical correctness uses defined synthetic QA against approved alert rules, separate from production/customer/support data. No new production metric. Synthetic specification is present; actual QA execution remains a delivery gate |
| CBD-13-AC06 | CBD-80 register sections 2–6: attributes, prohibited content, retention and separate destinations; process sections 3 and 5 operationalize review and cleanup handoff | Specification coverage exists under amended no-event-catalog criterion. Actual schema binding, release checks, CBD-122 compatibility and CBD-63 cleanup evidence remain dependencies |
| CBD-13-AC07 | Process sections 2–6: all 28 baseline/guardrail dispositions, actions, deadlines and current/future applicability | DEC-81-001 timing/process and CBD13-RETENTION-001 scope deferral approved; remaining process/package and DEC-81-003 decisions pending. DEF-81-002 population correction resolved; OQ-77-003/004 and MT-77-005 timestamp source proof still gate affected baseline credit. Missing bounds/evidence remain unavailable, never silently healthy |
| CBD-13-AC08 | Conventions; CBD-91; CBD-92 AN-92-001–007 and OP-92-*; CBD-80; process section 3 generic-Withheld boundary and section 4 alert ratchet; synthetic expectations below | Corrected specification awaiting independent Security/Risk verification and pending DEC-81-002 plan privacy disposition. Exact numerical release-policy approval/verification remains a future gate; no release, runtime control or closure claim |

CBD-81 drafting does not mark CBD-13 Done. Specification completion must be
distinguished from later measured beta success: the former needs approved,
coherent definitions and criterion dispositions; the latter additionally needs
actual evidence under this process. Neither has been asserted here.

## 3. Reverse traceability and inventory

| Process section | Criteria served |
| --- | --- |
| 1 — authority and scope | CBD-13-AC01/AC06/AC08; CBD-81-AC06 |
| 2 — baseline protocol | CBD-81-AC01/AC03/AC05; CBD-13-AC04/AC07 |
| 3 — release and missing evidence | CBD-81-AC01/AC04/AC05; CBD-13-AC06/AC08 |
| 4 — metric matrix | CBD-81-AC01/AC02/AC03/AC04; CBD-13-AC01/AC02/AC03/AC05/AC07 |
| 5 — records and beta decisions | CBD-81-AC03/AC04/AC05; CBD-13-AC06/AC07/AC08 |
| 6 — decision briefs and blockers | CBD-81-AC01/AC06; CBD-13-AC02/AC04/AC05/AC07/AC08 |
| 7 — synthetic correctness assessment | CBD-13-AC05; CBD-81-AC04/AC06 |
| Companion section 5 — SYN-81-001–004 disclosure expectations for process section 3 | CBD-13-AC08; CBD-81-AC01/AC04/AC05/AC06 |

The inventory is exactly eight CBD-77, eight CBD-78 and twelve CBD-79 metrics.
Nineteen aggregate-state metrics are CBD-77's eight, CBD-78's eight and
MT-79-009/010/011. Nine reliability-telemetry metrics are MT-79-001 through
MT-79-008 plus MT-79-012. Only MT-79-001 through MT-79-005 require connectivity.
CBD-80's actual owning-metric rows, not stale count/naming prose, provide source
coverage. This package defines no additional metric or source.

## 4. Required independent checks and unresolved gates

The following are check requirements for Manager routing, not claims that a
guard is implemented, scheduled or passing:

1. Exact metric-set equality against CBD-77/78/79 headings: 28 unique matrix
   rows, no duplicate, missing or invented IDs; every row has one valid owner,
   a baseline/guardrail disposition, cadence and action; verify 19/9 classes and
   five bank-dependent IDs against CBD-80 actual rows.
2. Every profile has a start, duration, minimum releasable evidence, calculable
   review date and explicit next decision. Exercise missing, zero-denominator,
   withheld, pending-bound, delayed-connectivity and insufficient-evidence cases;
   none may count as success or baseline evidence. Verify approved-deferred
   MT-78-004/005/006 have no current baseline clock or success-evidence requirement,
   while W4/R4/R8 periods, source slots and future reopening gates remain intact.
3. Check joint suppression, complementary/repeated-window inference and
   contribution concentration; no hidden-value flags or human access bypass.
   Exercise whole-distribution withholding and higher percentile protection.
   All external states, including Product Owner views and process records, are
   disclosures. The synthetic expectations below require identical emitted
   `Withheld`, with no reasons, transition details or value-derived actions.
4. Verify nine metrics remain in the S1 reliability destination and nineteen
   in the separate Cloud SQL aggregate record; no figures in Git/Confluence/Jira,
   support surfaces, member views or cross-stream joins. Verify deletion handoff
   and sink-specific retention before operational exit readiness.
5. Deliberately invalid proposed alert-response fixture must fail if it increases
   frequency, volume or insistence, contacts an inferred member or reveals alert
   behavior. Valid fewer/softer/less-frequent fixture must pass. Use isolated
   test artifacts; never corrupt authoritative sources.
6. Verify the approved DEF-81-001 deferral and CBD-78 source integration without
   reopening the Executive scope decision. Future reopening needs approved
   evidence of actual actions/occurrence times, including viewing, mutated/deleted
   state and both historical windows. No cohort/event history or audit-purpose
   reuse may be introduced. Verify interval and lifecycle meanings before
   DEC-81-003 values are accepted.
7. Re-fetch live criteria immediately before any Jira proposal/update or closure
   claim. Verify the Executive correctness decision actually exists and does
   not imply ordinary customer-content access. Verify approved restrictions
   remain effective despite stale prose in a source package.
8. Preserve the independently reviewed, merged DEF-81-002 correction in PR #236.
   Future implementation fixtures must exercise the exclusive close and exact
   C-minus-24-hour cutoff, older eligible subjects versus creation-window spaces,
   archived-only subject milestone, newly archived spaces, duplicate joins and
   zero denominator. Two periodless manual-account spaces are excluded from
   MT-77-006 numerator and denominator; one period-bearing space supplies the
   denominator and counts in the numerator only if it holds a linked manual
   account. No credited 200% rate; broad shared MS-80-004 remains unchanged.
   Population definitions are settled; these are future implementation checks,
   not a reopened definition defect or runtime pass. Carry OQ-77-003/004 and
   MT-77-005 first-simultaneous timestamp proof to source owners. Exercise limb
   replacement, deletion and current-period changes: maximum current timestamps
   or generic updated_at cannot substitute for proof of the first simultaneous
   usable-budget state. Affected computations remain unavailable without that
   source evidence and approved observable profile/category predicates.

Independent Review and Security/Risk dispositions are pending; this author
cannot approve their own material proposal. Product Owner decisions
DEC-81-002's bounded plan privacy disposition and DEC-81-003 are pending, as is
remaining process/package approval. Exact numerical release-policy approval and
verification remain future gates even if the proposed privacy disposition is
accepted. DEC-81-001 is approved under
CBD81-BASELINE-001; this does not approve the whole package or remove source or
release gates. DEC-81-004 is settled by the Executive
synthetic-QA clarification. DEF-81-001 has an approved Private MVP deferral with
CBD-78 source integration pending and a future source-proof gate. DEF-81-002's
activation population correction is resolved and merged. OQ-77-003/004 and
MT-77-005 first-simultaneous timestamp evidence remain substantive definition
handoffs to CBD-82/CBD-30 and the CBD-77/CBD-80 owners, not mere table bindings.
DEP-81-001 and
OQ-80-007 are implementation/operational handoffs. No outside document was
changed to resolve these dependencies, and no Jira or Confluence write is
authorized by this draft.

## 5. Synthetic disclosure expectations

These specification scenarios use invented conditions only. They are not runtime
test evidence, implemented suppression, an enforced control or Security clearance.
Until a specific approved release policy permits distinctions, every scenario
must have identical released status across metric and associated process records:

| Scenario | Synthetic internal condition | Expected external result |
| --- | --- | --- |
| SYN-81-001 | Empty eligible population | `Withheld`; no reason, transition detail, figure, value-derived action or baseline credit |
| SYN-81-002 | Population below a hypothetical test-policy threshold; no threshold is approved here | `Withheld`; no reason, transition detail, figure, value-derived action or baseline credit |
| SYN-81-003 | Many operations concentrated in one contributor | `Withheld`; no reason, transition detail, figure, value-derived action or baseline credit |
| SYN-81-004 | Related results permit unsafe complementary or repeated-window inference | `Withheld`; no reason, transition detail, figure, value-derived action or baseline credit |

Run all four with identical customer-independent implementation/approval readiness
facts; the external record must not reveal which internal condition occurred.
Switch among the four conditions without emitting a reason or transition detail.
Only customer-independent implementation/approval facts may explain readiness.
Manager should route exact-output and cross-record comparison checks to Guard/QA
and independent Security verification before treating the boundary as enforced.
