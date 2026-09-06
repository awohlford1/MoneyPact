# CBD-81 — Acceptance criteria traceability

Version 0.1, proposed; September 5, 2026. Companion to the
[targets and review process](cbd-81-beta-targets-and-review-process.md).
Repository baseline: `f1903e780b7b4f984c210c2234af2e05ae570b6c`.
The live amended criteria on [CBD-81](https://cobudget.atlassian.net/browse/CBD-81)
and [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) were read, including
status, links, subtasks and comments, on September 5, 2026. Jira remains the
authority for their wording and workflow. This report assesses evidence; it
does not mirror issue administration or claim acceptance.

## 1. CBD-81 coverage

| Criterion | Package evidence | Disposition |
| --- | --- | --- |
| CBD-81-AC01 | Process sections 2–4: exact 28-row inventory; W4/D14/R4/R8 timing, start triggers, minimum windows, review dates and bounded next decisions; pending-bound and zero-failure guardrails | Proposed coverage, pending DEC-81-001/002/003. No measurement or target approval claimed |
| CBD-81-AC02 | Section 4: every metric assigned exactly one product, synchronization, notifications or security owner; solo Product Owner carries responsibilities without expanding access | Covered by proposal |
| CBD-81-AC03 | Sections 2, 4–5: daily service decisions, weekly product/baseline decisions and relevant release reviews; no shortened or extra measurement windows | Covered by proposal |
| CBD-81-AC04 | Section 4: action for every unhealthy metric; sections 3 and 5 constrain suppression, access, rollback and communication | Covered by proposal; implementation and authorization of actions remain separate |
| CBD-81-AC05 | Section 5: continuation, affected/full pause, expansion, successful evaluation exit and incomplete beta end; deletion handoff | Covered by proposal; approvals and operational evidence pending |
| CBD-81-AC06 | Section 2 below reviews all eight parent criteria | **Not complete.** DEF-81-001 and pending proposal/privacy/bound decisions prevent confirmation |

## 2. Parent criterion review

| Criterion | Existing definition evidence and CBD-81 contribution | Closure assessment |
| --- | --- | --- |
| CBD-13-AC01 | CBD-77 activation; CBD-78 engagement; CBD-79 reliability and permitted safety measures; process section 4 includes all 28 IDs | Categories present. Denied-access/support signals retain their approved Private MVP exclusion and SRV-94-010 routing |
| CBD-13-AC02 | CBD-77/78/79 metric records supply name, purpose, formula, denominator, source and collection method; process section 4 fixes proposed ownership/cadence | **Blocked:** formal fields exist, but DEF-81-001 leaves action/history predicates unproven. Source binding and independent verification remain required; fields alone are not evidence of computability |
| CBD-13-AC03 | CBD-79 MT-79-001–005 CONN-REQUIRED; process section 4 explicitly defers bank start without blocking manual measurement | Covered at specification level; no bank availability claimed |
| CBD-13-AC04 | CBD-78 AD-78-001/RT-78-001 and MT-78-005/006; process section 2 names R4/R8 evidence maturity and section 6 carries DEF-81-001 | **Blocked:** historical predicates and viewing evidence need approved resolution. Amended criterion defers cadence segmentation; no requirement to produce beta segments is reinstated |
| CBD-13-AC05 | CBD-79 MT-79-007/008 duplicate/late; CBD-78 MT-78-007/008 acknowledged/dismissed; process sections 4, 6 and 7 | Executive clarification accepted: technical correctness uses defined synthetic QA against approved alert rules, separate from production/customer/support data. No new production metric. Synthetic specification is present; actual QA execution remains a delivery gate |
| CBD-13-AC06 | CBD-80 register sections 2–6: attributes, prohibited content, retention and separate destinations; process sections 3 and 5 operationalize review and cleanup handoff | Specification coverage exists under amended no-event-catalog criterion. Actual schema binding, release checks, CBD-122 compatibility and CBD-63 cleanup evidence remain dependencies |
| CBD-13-AC07 | Process sections 2–6: all 28 baseline/guardrail dispositions, response actions, deadlines and decisions | Proposed coverage; DEC-81-001/003 acceptance pending. A missing bound is explicitly unavailable, never silently healthy |
| CBD-13-AC08 | Conventions; CBD-91 inventory; CBD-92 AN-92-001–007 and OP-92-*; CBD-80 privacy rules; process section 3 and alert ratchet in section 4 | Design constraints preserved. DEC-81-002, source-predicate resolution and independent Security/Risk assessment required before release/closure claims |

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
   none may count as success or baseline evidence.
3. Check joint suppression, complementary/repeated-window inference and
   contribution concentration; no hidden-value flags or human access bypass.
   Exercise whole-distribution withholding and higher percentile protection.
4. Verify nine metrics remain in the S1 reliability destination and nineteen
   in the separate Cloud SQL aggregate record; no figures in Git/Confluence/Jira,
   support surfaces, member views or cross-stream joins. Verify deletion handoff
   and sink-specific retention before operational exit readiness.
5. Deliberately invalid proposed alert-response fixture must fail if it increases
   frequency, volume or insistence, contacts an inferred member or reveals alert
   behavior. Valid fewer/softer/less-frequent fixture must pass. Use isolated
   test artifacts; never corrupt authoritative sources.
6. Independently resolve DEF-81-001 through source evidence, including viewing,
   mutated/deleted state and both historical windows. No cohort/event history
   may be introduced as an implementation convenience. Verify interval and
   lifecycle meanings before DEC-81-003 values are accepted.
7. Re-fetch live criteria immediately before any Jira proposal/update or closure
   claim. Verify the Executive correctness decision actually exists and does
   not imply ordinary customer-content access. Verify approved restrictions
   remain effective despite stale prose in a source package.

Independent Review and Security/Risk dispositions are pending; this author
cannot approve their own material proposal. Product Owner decisions
DEC-81-001 through DEC-81-003 are pending. DEC-81-004 is settled by the Executive
synthetic-QA clarification. DEF-81-001 is a substantive source
definition blocker, not merely a future table-binding task. DEP-81-001 and
OQ-80-007 are implementation/operational handoffs. No outside document was
changed to resolve these dependencies, and no Jira or Confluence write is
authorized by this draft.
