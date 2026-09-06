# CBD-81 — Acceptance criteria traceability

Version 0.1, proposed; September 5, 2026. Companion to the
[targets and review process](cbd-81-beta-targets-and-review-process.md).
Repository baseline: `f1903e780b7b4f984c210c2234af2e05ae570b6c`.
Source follow-through: activation decision `CBD13-ACTIVATION-001`, independent
review `CBD13-ACTIVATION-REVIEW-001`, merged PR #236 at
`c757f24bda56dcdf74f4a2eb16a531ec5d1a63f6`.
`CBD13-RETENTION-001` approves Private MVP deferral; CBD-78 source amendment
merged in PR #237 at `01ca789cef216b4bc8ab9fa1c0318d37639190bc`. `CBD81-PRIVACY-001` approves the reviewed
privacy planning boundary. Approved profile/category meanings and MT-77-005
deferral are implemented in independently approved CBD-77/80 source candidate
`7754c5cf6efff4cdd7718dd9022fbb34bf75d2e4` (`CBD13-USABLE-REVIEW-001`), now locally integrated with public publication/merge pending. This report uses
the Manager's decision record for the approved amended criteria and makes no
fresh Jira workflow or closure assertion. `CBD13-LIFECYCLE-001` approves lifecycle
meanings, and `CBD81-BOUNDS-001` approves the later-bound specification-closure
exception. Lifecycle source revision `f7051ada2e73164814a689fdbf684edcf6b5511a`
was approved in `CBD13-LIFECYCLE-REVIEW-001` and cleared for the scoped lifecycle
specification in `CBD13-LIFECYCLE-SECURITY-001`. Both source revisions are
included in fixed local base `69bb28a4bdbed3b033c9944f63e14ed753f9e6e6`;
public publication/merge remains pending. Source references below resolve to
that local candidate, not a claim that public main includes these amendments.
The live amended criteria on [CBD-81](https://cobudget.atlassian.net/browse/CBD-81)
and [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) were read, including
status, links, subtasks and comments, on September 5, 2026. Jira remains the
authority for their wording and workflow. This report assesses evidence; it
does not mirror issue administration or claim acceptance.

## 1. CBD-81 coverage

| Criterion | Package evidence | Disposition |
| --- | --- | --- |
| CBD-81-AC01 | Process sections 2–4/6.1: 28 metrics, four approved profiles and four metric deferrals, generic-Withheld planning boundary, lifecycle definitions and explicit later-bound exception | DEC-81-001/002/003 planning dispositions approved. CBD81-BOUNDS-001 permits specification closure with freshness/lateness bounds unset; MT-79-003/008 remain required beta evidence with no rate, healthy status, baseline start or credit before verified bound/source/release prerequisites. Remaining final process/package approval and delivery gates remain |
| CBD-81-AC02 | Section 4: every metric assigned exactly one product, synchronization, notifications or security owner; solo Product Owner carries responsibilities without expanding access | Covered by proposal |
| CBD-81-AC03 | Sections 2, 4–5: daily service decisions, weekly product/baseline decisions and relevant release reviews; no shortened or extra measurement windows | Covered by proposal |
| CBD-81-AC04 | Section 4: action for every unhealthy metric; sections 3 and 5 constrain suppression, access, rollback and communication | Covered by proposal; implementation and authorization of actions remain separate |
| CBD-81-AC05 | Section 5 continuation/pause/expansion/exit plus sections 2/6.1 current applicability and lifecycle handoff | Four approved metric deferrals preserved. Later-bound specification exception does not waive MT-79-003/008/010 beta evidence or permit expansion/successful exit without applicable evidence. Final process approval and operational evidence remain pending |
| CBD-81-AC06 | Section 2 reviews all eight parent criteria and approved closure-stage exceptions | Not complete. Lifecycle meanings and later-bound disposition now settled alongside prior decisions. CBD81-REVIEW-005 approved cumulative reconciliation at e8bb34c; usable/lifecycle sources are independently reviewed and locally integrated. Final integrated package review, public publication/merge and final process/package acceptance remain; numerical release and implementation evidence are later gates, with no measured-success claim |

## 2. Parent criterion review

| Criterion | Existing definition evidence and CBD-81 contribution | Closure assessment |
| --- | --- | --- |
| CBD-13-AC01 | CBD-77 activation; CBD-78 engagement; CBD-79 reliability and permitted safety measures; process section 4 includes all 28 IDs | Categories present. Denied-access/support signals retain their approved Private MVP exclusion and SRV-94-010 routing |
| CBD-13-AC02 | Process sections 2/4/6/6.1 and approved population/profile/category/lifecycle meanings; four Private MVP deferrals; CBD81-BOUNDS-001 explicit closure-stage exception | Exact classification values may remain unset at specification acceptance under approved exception. MT-79-003/008 remain required beta evidence and unavailable without verified bounds/source/release prerequisites. CBD-77/80 candidate 7754c5c and lifecycle source f7051ad independently reviewed and locally integrated; public publication/merge pending. Applicable physical bindings and independent verification remain; no computability claim |
| CBD-13-AC03 | CBD-79 MT-79-001–005 CONN-REQUIRED; process section 4 explicitly defers bank start without blocking manual measurement | Covered at specification level; no bank availability claimed |
| CBD-13-AC04 | CBD13-RETENTION-001 approved deferral; process sections 2/4/5/6 retain MT-78-005/006 and future R4/R8 periods without current Private MVP retention-evidence requirement | Approved specification disposition; CBD-78 amendment merged in PR #237 at 01ca789. CBD-80 source follow-through from reviewed candidate 7754c5c is locally integrated; public publication/merge pending. No measured success, zero or successful retention asserted. Historical source proof and release/implementation controls required before future applicability; cadence-segmentation deferral preserved |
| CBD-13-AC05 | Existing duplicate/late/acknowledged/dismissed measures; approved synthetic correctness QA; process sections 2/4/6.1/7 | Synthetic QA approach settled; execution remains a delivery gate. Alert lateness interval is qualifying durable source revision to authorized in-app availability, including evaluation/fan-out. Classification bound may remain unset at specification closure under CBD81-BOUNDS-001; no lateness rate or baseline credit until verified prerequisites, and required beta evidence is not waived. Unavailable/failed instances excluded; rate cannot prove no dropped alerts |
| CBD-13-AC06 | CBD-80 register sections 2–6: attributes, prohibited content, retention and separate destinations; process sections 3 and 5 operationalize review and cleanup handoff | Specification coverage exists under amended no-event-catalog criterion. Actual schema binding, release checks, CBD-122 compatibility and CBD-63 cleanup evidence remain dependencies |
| CBD-13-AC07 | Process sections 2–6.1: baseline dispositions, approved meanings, actions, dated missing-evidence decisions and closure-versus-beta distinction | DEC-81-001/002/003 dispositions and four metric deferrals approved. MT-79-003/008 have no rate, healthy state, baseline start or credit before verified classification/source/release prerequisites. MT-79-010 duration baseline requires interval/terminal/source/bucket/release proof; compliance/near-breach needs approved commitment and approach rules. Final integrated review, process/package acceptance and public publication/merge remain; beta evidence is not waived |
| CBD-13-AC08 | Conventions; CBD-91; CBD-92 AN-92-001–007 and OP-92-*; CBD-80; process section 3 and section 4 alert ratchet; synthetic expectations below | CBD81-PRIVACY-001 accepts DEC-81-002 planning boundary after scoped Security clearance CBD81-SECURITY-002 and Review CBD81-REVIEW-004 on a5a25fc6d8740483ee484f839ac271c75dc6b354. Numerical release policy still needs separate Security review, Executive approval and implementation verification. CBD81-REVIEW-005 approved cumulative reconciliation at e8bb34c; final integrated review still required. Process section 3 explicitly controls inherited suppression/investigation prose; no runtime, final package or measured-success claim |

CBD-81 drafting does not mark CBD-13 Done. Specification completion must be
distinguished from later measured beta success: the former needs approved,
coherent definitions and criterion dispositions, including the approved explicit later-bound exception; the latter additionally needs
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
| 6.1 — approved lifecycle meanings and source handoff | CBD-13-AC02/AC05/AC06/AC07/AC08; CBD-81-AC01/AC04/AC05/AC06 |
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
   MT-77-005 and MT-78-004/005/006 have no current baseline clock or success-evidence requirement,
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
6. Preserve the approved DEF-81-001 deferral and merged CBD-78 amendment; preserve the independently reviewed, locally integrated CBD-80 source follow-through without
   reopening the Executive scope decision. Future reopening needs approved
   evidence of actual actions/occurrence times, including viewing, mutated/deleted
   state and both historical windows. No cohort/event history or audit-purpose
   reuse may be introduced. Verify interval and lifecycle meanings before
   exact numerical values under the approved DEC-81-003 later-bound disposition are accepted.
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
   not a reopened definition defect or runtime pass. Verify approved profile,
   category and target predicates from process section 6: empty versus absent
   profile; multiple/ambiguous profiles invalidate the source; excluded profile
   lifecycles; current Primary Owner association; qualifying category identity
   and exclusions; rename/reorder versus recreation; explicit zero versus missing
   target; transition-prorated target; MT-77-008 matching numerator/denominator.
   Preserve all five simultaneous UB-77-001 limbs and account OR transaction.
   CBD13-USABLE-REVIEW-001 approved source candidate 7754c5c; verify integration
   and exact physical bindings separately. Do not treat settled OQ-77-003/004
   meanings as still requiring a product decision. MT-77-005 is explicitly
   deferred: future source proof must handle replacement/deletion/period changes;
   maximum current timestamps, updated_at, budget date or new measurement history
   cannot substitute. MT-77-003 remains applicable despite the timing deferral.

9. Preserve reviewed lifecycle source f7051ad against approved process section 6.1.
   CBD13-LIFECYCLE-REVIEW-001 and CBD13-LIFECYCLE-SECURITY-001 establish scoped
   review/clearance, and the source is locally integrated. Public integration,
   physical bindings and runtime evidence remain separate. Synthetic checks must
   cover eligible never-synced
   connections retained in the denominator with missing age and not fresh;
   revoked/orphaned/disconnected/lifecycle-stopped exclusions; failed/superseded
   runs not advancing watermark; qualifying rule revision with settlement only
   where required; in-app availability endpoint; once-per-window instance count;
   exclusion of still-unavailable/failed instances and no dropped-alert inference.
10. Exercise accepted-request start after verification/confirmation, queue delay,
    rejection/verification-attempt exclusion, accepted inactivity-archival binding,
    export ready versus downloaded/expired, archival restrictions versus erasure,
    both approved deletion flows and distinct source success predicates. Check
    application-controlled terminal evidence versus merely scheduled cleanup;
    separately tracked processor/backup obligations; immediate authority shutdown
    versus completion; restoration without resurrected authority; valid cancellation
    excluded from success/failure; retry/grace/pending cleanup excluded; each
    accepted request counted once at terminal transition. Completion denominator
    is completed+failed, shared by elapsed time-to-terminal-outcome distribution.
    These checks define expectations, not executed QA or permission for new
    released lifecycle labels, tracking, history or purpose reuse.
11. Verify exact classification bounds remain unset without Executive approval.
    Missing bounds must block MT-79-003/008 rates, healthy states, release, D14
    start and credit; they are not additional deferred metrics. Verify MT-79-010
    baseline requires interval/terminal/source/bucket/release proof and that no
    compliance/near-breach claim occurs without an approved commitment/approach
    rule. Exercise specification acceptance with the approved later-bound exception
    separately from beta exit: missing applicable evidence must prevent dependent
    expansion/successful exit and invoke the dated continuation/pause process.
    Grace, export expiry and backup expiry must never supply an invented SLO.

CBD81-SECURITY-002 cleared the availability correction and planning boundary;
CBD81-REVIEW-004 approved the scoped draft at
`a5a25fc6d8740483ee484f839ac271c75dc6b354`. These dispositions are limited to
that candidate and scope. CBD81-REVIEW-005 independently approved cumulative
reconciliation at `e8bb34cbef98438ddd2ad774d19b95feb787ca6f`. Source review and
local integration are now complete as recorded above; final integrated package
review/acceptance remains pending for this status reconciliation.
DEC-81-002 planning disposition is approved under `CBD81-PRIVACY-001`; exact
numerical release policy requires separate Security review, Executive approval
and implementation verification. DEC-81-003 specification-closure disposition
is approved under CBD81-BOUNDS-001, and lifecycle meanings are approved under
CBD13-LIFECYCLE-001. Exact numerical bounds/commitments and remaining final
process/package approval are pending; no numerical value is selected here.
DEC-81-001 baseline timing and DEC-81-004 synthetic-QA approach remain settled.

DEF-81-001 retention/breadth deferral is approved, with CBD-78 merged in PR #237;
CBD-80 follow-through from reviewed source candidate 7754c5c is locally integrated, with public publication/merge pending. DEF-81-002 population correction remains merged.
`CBD13-PROFILE-001` and `CBD13-CATEGORY-001` settle OQ-77-003/004 measurement
meanings; authorized physical bindings and verification remain with the feature
and source owners. `CBD13-USABLE-TIME-001` explicitly defers MT-77-005, preserving
MS-80-007, intended interval, destination and future W4; historical timestamp
proof is a reopening gate, not current timing-success evidence. These source
amendments were independently approved in `CBD13-USABLE-REVIEW-001` at
`7754c5cf6efff4cdd7718dd9022fbb34bf75d2e4` and are locally integrated, with public publication/merge pending.
Lifecycle source `f7051ada2e73164814a689fdbf684edcf6b5511a` separately received
CBD13-LIFECYCLE-REVIEW-001 approval and CBD13-LIFECYCLE-SECURITY-001 scoped
clearance and is locally integrated, with public publication/merge pending.
Inherited source headers/revision records still saying candidate review is pending
are historical status prose; the exact independent results above establish the
reviewed scope. Their out-of-scope source wording remains unchanged here.
Inherited population-specific suppression and individual-request investigation
prose is not independently cleared: process section 3 states the controlling
CBD81-PRIVACY-001 generic-Withheld and OP-92-003 restrictions. No hidden-value
flag, routine individual inspection or access escalation is authorized. Final
integrated review must assess that precedence; this report does not waive it.
DEP-81-001 and OQ-80-007 remain implementation/operational handoffs. No outside
document is changed by this reconciliation; no runtime enforcement, successful
measurement, final package approval or Jira Done is asserted.

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
