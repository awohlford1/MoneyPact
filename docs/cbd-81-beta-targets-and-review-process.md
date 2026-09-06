# CBD-81 — Beta targets and review process

Version 0.1, Draft for Product Owner review; September 5, 2026. No package approval,
measurement, implementation, beta launch or Jira completion is asserted.
Owner: Alexander Wohlford, Product Owner. Task: [CBD-81](https://cobudget.atlassian.net/browse/CBD-81).
Parent: [CBD-13](https://cobudget.atlassian.net/browse/CBD-13).

## 1. Authority and scope

This package proposes operating rules for the existing 28 metrics. Definitions,
formulas, denominators, exclusions and sources remain in
[CBD-77](cbd-77-activation-and-onboarding-metrics.md),
[CBD-78](cbd-78-engagement-and-retention-metrics.md),
[CBD-79](cbd-79-reliability-and-safety-metrics.md) and the
[CBD-80 register](cbd-80-measurement-source-register.md). The
[measurement conventions](cbd-13-measurement-conventions.md) govern form.
Source baseline: repository commit `f1903e780b7b4f984c210c2234af2e05ae570b6c`.
Live Jira criteria, including `customfield_10066`, links and comments, were read
on September 5, 2026. Jira owns issue fields; this document is the specification,
not a staging copy of those fields. Parent completion is assessed in the
[traceability report](cbd-81-acceptance-criteria-traceability.md).

All rules below are proposals unless explicitly identified as an existing
contract or an Executive-approved decision. The approved global-only release, Worker computation, alert response
restrictions and two storage destinations remain settled. No behavioral events,
customer-level measurement records, cohorts, segmentation, new metric or new
permission is introduced. A baseline is not permission to read an invalid source.

## 2. Approved baseline protocol

The Executive approved W4/D14/R4/R8 and their bounded review process in
`CBD81-BASELINE-001`, communicated through Manager on September 5, 2026.
This settles DEC-81-001 only; the package remains Draft. Source validity,
privacy release policy, operating bounds and all other unresolved gates remain
pending. No observed comparison range or performance target is approved.

`B0` is the first Monday 00:00 UTC after the Product Owner authorizes the manual
beta and the relevant source, release controls and approved policy are ready.
Each metric records its actual start date in the authorized operational record;
an unavailable metric has no fictitious start. A definition or material source
change starts a new version and baseline; do not splice incompatible windows.

| Profile | Start and duration | Minimum evidence and scheduled review | Next decision |
| --- | --- | --- | --- |
| W4 | First complete UTC calendar week at/after B0; four consecutive weeks | Four complete, comparable, releasable weekly records with eligible population; review on the first Monday after week four closes | Product Owner accepts the observed range as the provisional comparison baseline, explicitly chooses a justified target, or extends once for four weeks |
| D14 | First 00:00 UTC after the relevant capability and source are ready; fourteen complete UTC days | Fourteen complete, comparable, releasable daily records; review next UTC day after day fourteen closes | Owner proposes a baseline and operational bound if supported; Product Owner accepts, modifies, or extends once for fourteen days |
| R4 | First valid A week at/after B0; B starts four weeks after A starts | Two successive releasable named A/B pairs, requiring at least six complete weeks; review first Monday after the second B closes | Product Owner accepts a provisional comparison baseline or defers with reason and next review in four weeks |
| R8 | First valid A week at/after B0; B starts eight weeks after A starts | Two successive releasable named A/B pairs, requiring at least ten complete weeks; review first Monday after the second B closes | Product Owner accepts a provisional comparison baseline or defers with reason and next review in four weeks |

The counts above are approved minimum *windows*, not a statistical power claim
or a population privacy threshold. Every constituent record must independently
pass the release policy in section 3. If evidence is insufficient at the scheduled
review, record `insufficient evidence`, decide the extension or pause, and record
the next calendar date. At the end of the one extension, the Product Owner must
choose a bounded continuation with a written evidence plan, affected-capability
pause, or beta end. No automatic indefinite baseline or automatic success.

Before an accepted baseline exists, review available valid observations and
source contract violations; do not label an unavailable value healthy. After
baseline acceptance, two consecutive comparable windows moving adversely
outside its observed range trigger the row's investigation. This is a proposed
investigation trigger, not proof of regression or a release SLO. Known security,
privacy or product-contract violations trigger immediately, regardless of the
baseline. A new safe terminal-failure class also triggers immediately.

## 3. Release and missing-evidence rules

No numeric suppression minimum is approved in the pinned sources. This package
does not invent one or describe a candidate number as safe. Until decision
`DEC-81-002` is accepted and verified, numerical releases remain withheld. The
owner reviews the nonnumeric availability status and permitted implementation
evidence, never the concealed value. Computation inside the authorized Worker
does not grant a human access to intermediate results or contributing records.

| Evidence state | Treatment and action |
| --- | --- |
| Releasable | Use only the approved global figure and window on the class's authorized destination; no drill-down |
| Withheld — population below release threshold | Preserve suppression, never zero or blank; do not expose counts, percentiles, direction, failure-present flags or actions derived from the hidden value |
| Withheld — release policy pending | Record policy dependency and next decision date; no numeric release or baseline credit |
| No eligible population | Distinguish from measured zero; no rate or percentile and no baseline credit; publish this state only if the release policy permits it, otherwise withhold |
| Unavailable — capability/source not ready | Record the dependency and owner; do not compute or backfill from unauthorized sources; no baseline credit |
| Unavailable — source definition unresolved | Record `DEF-81-001`, `DEF-81-002` or affected definition issue; no computation or baseline credit until corrected source is approved |
| Insufficient evidence | A scheduled review occurred without the profile's required records; invoke the bounded next decision in section 2 |

No denominator manipulation, longer overlapping window, arithmetic subtraction,
repeated query, complementary count, per-class partial release, cross-metric
comparison or per-person contact may recover a suppressed value. Distributions
and related figures require joint disclosure review; a permitted marginal does
not make an inferable hidden cell permitted. Population *and* contribution
concentration matter: many operations may still belong to one person. Reliability
volume is not an automatic privacy exemption. Where source prose allows a
per-class release, the result must still pass the governing privacy contract.

Only nine `reliability-telemetry` metrics use CBD-122's existing S1 reliability
sink with its own allowed attributes, role and retention. Nineteen
`aggregate-state` metrics use the periodic written record in its separate Cloud
SQL schema selected by CBD-108, with its separate access role and retention.
The Product Owner consumes the aggregate record. Categorized ownership in
section 4 grants no additional reader access. No figures enter Git, Confluence,
Jira, a routine support surface or a member-visible surface. Do not join the two
streams into a figure or copy reliability readings into the aggregate schema.

An independent, authorized security incident or recovery signal may warrant
its existing operational response. Suppression does not turn off that separate
process. It also cannot be bypassed by inventing an incident from a withheld
metric. `OP-92-003` excludes ordinary troubleshooting, analytics and quality
review: individual-request inspection is not routinely authorized by this plan.

## 4. Complete metric operating matrix

All rows inherit sections 2–3. W means weekly review after the UTC week closes;
D means daily review after the UTC day closes; R means a release review when
changing the relevant capability, definition, source, policy or operational
bound. Weekly reviews occur Mondays and daily reviews the following UTC day;
the accountable owner records completion and the next due date. R reuses the
latest eligible evidence and never creates a shorter measurement window.
The solo Product Owner performs the categorized responsibilities below.

`MT-79-001` through `MT-79-005` are `CONN-REQUIRED`: pending bank availability,
their source readiness and D14 start are deferred without blocking manual beta.
All other rows are `MANUAL-OK`; this does not assert implementation readiness.
W4/D14/R4/R8 profile timing and bounded review rules are approved under
DEC-81-001. Trigger and guardrail proposals remain subject to their stated gates;
no performance target is approved.

| Exact metric ID and name | Owner | Profile; cadence | Trigger and actionable response |
| --- | --- | --- | --- |
| MT-77-001 — Space creation rate | product | W4; W/R; DEF-81-002 gate | No computation or baseline credit until grace and numerator eligibility are reconciled. Thereafter adverse decline: reproduce account-to-space onboarding using synthetic data; fix creation or copy failures; roll back the responsible change if reproducible |
| MT-77-002 — First budget period rate | product | W4; W/R; DEF-81-002 gate | No computation or baseline credit until numerator/denominator populations are reconciled. Thereafter adverse decline: check period materialization and schedule validation; repair or roll back the failing setup path |
| MT-77-003 — Usable-budget completion rate | product | W4; W/R; DEF-81-002 gate | No computation or baseline credit until numerator/denominator populations and required source predicates are resolved. Thereafter adverse decline: validate all five UB-77-001 limbs in synthetic fixtures; fix the failing manual setup path without redefining usable |
| MT-77-004 — Time to first budget period | product | W4; W/R | Adverse increase: reproduce setup delays and period scheduling; simplify or fix the affected step; preserve higher percentile release protection |
| MT-77-005 — Time to usable budget | product | W4; W/R | Adverse increase: validate maximum-of-limb timestamp logic and reproduce completion friction; repair the responsible step |
| MT-77-006 — Manual-account activation rate | product | W4; W/R; DEF-81-002 gate | No computation or baseline credit until manual-account numerator membership is reconciled with period-bearing denominator membership. Thereafter adverse decline: check account creation and linking to the period; fix the manual flow without requiring a bank connection |
| MT-77-007 — Manual-transaction activation rate | product | W4; W/R | Adverse decline: reproduce manual entry and reliable-date classification; repair validation or period assignment |
| MT-77-008 — Category-target completion rate | product | W4; W/R | Adverse decline: check current-period targets and transition prorating; fix target setup or explanation |
| MT-78-001 — Transaction classification rate | product | W4; W/R | Adverse decline: test eligible reliable-date boundaries against SD-071-035; fix classification or period coverage without widening the denominator |
| MT-78-002 — Invitation acceptance rate | product | W4; W/R | Adverse decline: review generic invitation/acceptance copy and synthetic lifecycle tests; fix expired or broken links without contacting inferred nonresponders |
| MT-78-003 — Invitation terminal-state distribution | product | W4; W/R | Adverse shift toward expired, revoked or declined: validate the lifecycle and neutral copy; fix the shared flow; withhold the entire unsafe distribution |
| MT-78-004 — Collaboration action breadth | product | W4; W/R; DEF-81-001 gate | A source cannot prove an action occurred from permission alone: keep unresolved classes unavailable; after valid definition, investigate adverse breadth using synthetic role/action tests, never activity surveillance |
| MT-78-005 — Four-week active retention | product | R4; W/R; DEF-81-001 gate | Unavailable until historical predicate is valid; after baseline, adverse decline prompts review of shared product friction and existing permitted feedback, without joining feedback to measurement or tracking people |
| MT-78-006 — Eight-week active retention | product | R8; W/R; DEF-81-001 gate | Same definition gate and response as four-week measure; preserve named eight-week window separation and never infer success before maturity |
| MT-78-007 — Firm alert acknowledgement rate | product | W4; W/R | Adverse decline: reduce, soften or remove problematic catalog behavior. Global and operator-only; never name/contact/differentiate a member or increase frequency, volume or insistence |
| MT-78-008 — Firm alert dismissal rate | product | W4; W/R | Adverse increase: make alerts fewer, softer or less frequent. Same no-member-access and no-contact restrictions; never optimize for compliance |
| MT-79-001 — Synchronization success rate | synchronization | D14; D/R | Adverse decline: inspect allowed safe outcome classes, reproduce the defect, reduce scheduled load or roll back affected sync code; retain valid structural exclusions |
| MT-79-002 — Synchronization latency | synchronization | D14; D/R | p90 moves adversely to a higher approved bucket: check allowed queue/capacity evidence and bounded delivery controls; tune only within approved caps or reduce scheduling frequency |
| MT-79-003 — Connection freshness | synchronization | D14; D/R; DEC-81-003 gate | Bound-dependent value unavailable until freshness bound is approved; thereafter deterioration triggers cursor and scheduler investigation alongside independently releasable sync outcomes; repair stale-success behavior |
| MT-79-004 — Synchronization retry rate | synchronization | D14; D/R | Adverse increase even with stable success: check bounded retry exhaustion/backoff, reduce schedule frequency or repair provider handling; never retry beyond approved bounds |
| MT-79-005 — Terminal synchronization failure rate | synchronization | D14; D/R | New safe failure class or adverse growth: map approved taxonomy to relinking or code defect; use the existing authorized relinking flow; an unresolved CoBudget defect blocks the affected release |
| MT-79-006 — Notification outcome distribution | notifications | D14; D/R | Adverse failed/late growth or unexplained suppressed growth: inspect queue, provider and transport caps; fix configuration or roll back. Correct suppression stays in denominator; no extra transport |
| MT-79-007 — Alert duplicate rate | notifications | D14; D/R | Adverse rise or unexplained zero: test both trigger and dedup guard; a suppressed duplicate attempt is not a delivered duplicate. Fix attempts or missing instrumentation; confirmed duplicate delivery violates AB-74-001 and pauses affected delivery |
| MT-79-008 — Alert lateness rate | notifications | D14; D/R; DEC-81-003 gate | Bound-dependent value unavailable until interval and lateness bound are approved; thereafter adverse rise triggers managed-scheduler versus Worker-capacity diagnosis; repair or roll back affected scheduling |
| MT-79-009 — Export and deletion completion rate | security | W4 plus zero-failure guardrail; W/R | Any *releasable* failed terminal state triggers investigation using permitted service evidence; block affected release pending resolution. Individual content inspection requires a separate valid OP-92-003 purpose and gates |
| MT-79-010 — Export and deletion elapsed time | security | W4; W/R; DEC-81-003 gate | Duration baseline may proceed only with valid interval/buckets; approaching an approved completion commitment triggers queue prioritization and release review. No completion-time compliance claim until lifecycle-specific bound is approved |
| MT-79-011 — Consent change rate | security | W4; W/R | Adverse increase with unchanged disclosure version: review generic CBD-73/75 copy; fix ambiguity without inspecting consent content or discouraging revocation. A disclosure change may explain the shift |
| MT-79-012 — Revocation completion rate | security | D14 plus zero-failure guardrail; D/R | Any *releasable* failed revocation triggers security incident triage and affected-access containment through existing authorized controls; investigate a membership only through the fully gated OP-92-003 path |

Zero-failure guardrails are responses to known violations, not evidence that
suppressed low-volume operations succeeded. All mitigation, rollback and
communication actions remain subject to their existing authority. Communication
uses established product incident/relinking paths, contains no measurement
figures or inferred recipient behavior, and is never automatically sent by this
specification. A proposed target cannot authorize raising an approved capacity
cap, widening telemetry attributes or changing an alert catalog rule.

## 5. Review record and decisions

The aggregate record contains only released metric identifier, named window
(two windows for retention), released figure and the permitted availability
state. This is a proposed format for CBD-80's existing periodic record, not a new
event schema or query surface. Baseline policy version, source version,
accountable role, scheduled review date, evidence sufficiency, decision,
remediation owner and next due date belong to the associated process record;
it must not carry customer data or reproduce figures outside their authorized
destination. Cross-stream decisions may cite metric IDs and policy evidence but
never join streams or calculate a combined figure. Do not place hidden counts,
contributor IDs, free-text customer material or intermediate sets in either.

Daily review decides whether to contain, investigate or continue the affected
service. Weekly review decides whether to accept/extend the baseline, fix
product friction or propose changing beta scope. Release review verifies source
and policy compatibility, open incidents, correction evidence and beta gates.
An owner records a missed review and escalates the decision before a dependent
release; silence is not acceptance. Product Owner signs decisions; reviewers
provide their own evidence and cannot have approval inferred from ownership.

| Decision | Proposed rule |
| --- | --- |
| Continue | Remain within the authorized beta scope; no unresolved privacy/security violation or relevant product-contract failure; each available metric is reviewed and each missing one has an owner, dated evidence plan and next review. Pending bank metrics do not stop manual measurement. Continuing with insufficient evidence must be explicit and time-bounded |
| Pause | Immediately stop the affected measurement release on privacy/source invalidity; stop the affected capability for confirmed unsafe access, failed revocation or contract-breaking delivery. Pause the whole beta when impact cannot be contained or security requires it. Evidence insufficiency blocks expansion and triggers an explicit continuation/pause decision at the baseline deadline |
| Expand | Separate Product Owner authorization after applicable baselines are accepted, defects remediated, operational bounds and release controls approved/verified, and no unresolved blocker relevant to expanded scope. No cadence segmentation or new source is authorized. Bank expansion additionally needs bank-path readiness and its deferred evidence plan |
| Exit review successfully | Conclude beta evaluation only after all applicable baseline profiles, including valid four/eight-week retention evidence, have matured; parent criterion gaps have approved dispositions; release/QA/security gates and lifecycle handoff evidence are complete. This is not permission for public launch, which retains CBD-94/95 and SRV-94-010 gates |
| End without success | Product Owner may stop beta despite missing evidence, explicitly recording an incomplete evaluation. Do not label this successful exit or parent acceptance |

At either end, CBD-63's authorized runbook must stop measurement jobs and
execute/verify deletion of the aggregate schema with beta operational-record
cleanup after review, preserving the separate S1 sink lifecycle. Require an
identified operator, trigger, verification evidence and recovery/backup handling
consistent with the governing retention rules. `OQ-80-007` stays open until that
runbook exists and is verified. This document authorizes no destructive action.

## 6. Decisions and source blockers to resolve

| ID | Decision brief and options | Evidence / owner / gate |
| --- | --- | --- |
| DEC-81-001 — approved | Executive accepted W4/D14/R4/R8 and their bounded review process: four complete product weeks, fourteen complete reliability days, two valid retention A/B pairs with earliest reviews at six/ten weeks; only valid releasable records count, and missing evidence requires a dated extension or pause decision | Decision source CBD81-BASELINE-001, explicit Executive selection communicated through Manager September 5, 2026. This approves operating review periods, not statistical/privacy guarantees, arbitrary performance targets, numerical privacy minima, source repairs, whole-package approval or CBD-13 closure. No automatic success |
| DEC-81-002 | Approve a privacy-reviewed population/concentration and joint-release policy, or continue without numerical metric release. Recommended: keep releases withheld pending that review; no numeric candidate is asserted safe | Security/Risk evaluates singling-out, repeated-window differencing, complementary counts, distributions, low-volume security operations and higher percentile protection; Product Owner decides exact policy before release. Number of operations alone is insufficient; post-beta segmentation requires its own later review |
| DEC-81-003 | Establish freshness, alert-lateness and request-completion bounds from their product commitments, or keep bound-dependent judgments unavailable. Recommended: approve lifecycle-specific definitions before numbers, then select bounds using scheduler/retry/delivery and lifecycle evidence | synchronization, notifications and security prepare evidence; Product Owner decides before dependent computation/health claim. MT-79-008 source prose differs on source-fact-settled versus creation start: reconcile that interval first. The 30-day restoration grace is not a generic export/deletion completion SLO; archival has no countdown. Do not reinterpret either |
| DEC-81-004 — settled | Executive approved technical correctness assessment through defined synthetic QA against approved alert rules, separate from production metrics, customer data and support data. CBD-13-AC05 and CBD-79-AC03 were clarified in live Jira; the other four alert measures remain unchanged | Manager communicated the explicit decision September 5, 2026. OQ-79-002 is resolved by this clarification; no new production metric, behavioral tracking or human reading of customer alerts. Defined synthetic QA and its execution evidence remain delivery requirements |
| DEF-81-001 | AD-78-001 includes viewing and assumes qualifying historical timestamps; permission records do not prove viewing. RT-78-001 requires A and B predicates from current state, but mutation/deletion can erase evidence of A. MT-78-004 has the same action-versus-permission concern | Product/Architecture must identify valid already-authorized operational predicates, including timestamp meaning and mutation/deletion semantics, or propose source/criterion correction for approval. MT-78-004 affected classes and MT-78-005/006 remain non-computable; no new activity history, event capture or cohort is invented. Blocks parent AC02/AC04 closure |
| DEF-81-002 | Activation eligibility is internally inconsistent. MT-77-001 excludes subjects created after window-open minus grace, while CBD-77 section 5 and MS-80-001 exclude the final 24 hours; its numerator/MS-80-002 does not state the matching eligibility restriction. MT-77-002/003 and MS-80-004/005 count successful spaces without the creation-window/non-archived restriction imposed on their denominator by MS-80-003, so numerator membership is not demonstrably a subset of denominator membership. MT-77-006/MS-80-008 counts all manual-account spaces, including potentially periodless spaces, while its MS-80-004 denominator requires a materialized period; no approved invariant establishes matching membership | Product/Architecture and the CBD-77/CBD-80 source owners must reconcile grace, population membership and lifecycle exclusions through an approved source correction; CBD-81 selects no replacement formula or filter and does not globally narrow shared MS-80-004. MT-77-001/002/003/006 remain unavailable for computation and receive no baseline credit until that correction is approved and independently verified. Blocks parent AC02/AC07 and CBD-81-AC06 confirmation |
| DEP-81-001 | CBD-122 must bind all nine reliability metrics to its closed attribute universe; CBD-80 must bind operational sources to actual schemas without changing meaning | Owning implementation packages and independent review; unavailable until binding and release-control verification. Source registration is not implementation evidence |

Activation source handoff also preserves `OQ-77-003`: CBD-82 must define the
observable financial-profile predicate used by UB-77-001 and MT-77-003/005.
`OQ-77-004` requires the CBD-30 category definition supporting that same usable
budget condition. These dependencies are not settled by fixing population
membership or by specifying a baseline. Affected computations remain unavailable
where these required predicates lack an approved, verifiable definition. Source
owners retain responsibility; this package neither invents the missing state
nor amends the approved source contracts.

Denied cross-space access and related support-incident signals remain barred for
Private MVP and routed to `SRV-94-010`; this settled disposition is not reopened
as an Executive choice here. The aggregate alert-release permission and one-way
response restriction also remain settled despite stale source prose suggesting
otherwise. Header/count/naming discrepancies in CBD-80 and older status prose
are outside this package's write scope; consult its actual register rows and
latest explicit decisions, and route reconciliation through Manager. No source
document is silently amended by this proposal.

## 7. Synthetic alert correctness assessment

The Executive-approved synthetic approach assesses technical correctness under
the clarified CBD-13-AC05 and CBD-79-AC03. It is separate QA evidence, not a
29th metric and not a population estimate of incorrect production alerts.

Before a release affecting alerts, notifications owns a fixture inventory
against the approved CBD-74 catalog and boundary rules. Each fixture specifies
synthetic input state, governing rule ID, expected instance and recipient scope,
expected permitted delivery, and expected no-alert condition where applicable.
Cover each catalog rule's positive/negative boundary, provisional versus settled
facts, deduplication/replay, source correction, stale work, permission or consent
loss, acknowledgement/dismissal noninterference, transport caps and lateness
interval boundaries. Use invented accounts and financial values only.

QA compares actual synthetic outcomes with those expectations, records fixture
ID, exact candidate revision, pass/fail and reproducible defect, and preserves
no production/customer/support material. A mismatch in rule, recipient, content
boundary or prohibited delivery blocks the affected release until repaired and
the failed case plus affected regression set pass. Independent QA evidence and
Review are required; a specification of these tests is not an executed pass.
The Product Owner reviews technical correctness alongside the four existing
quality measures without combining the results into a new metric.
