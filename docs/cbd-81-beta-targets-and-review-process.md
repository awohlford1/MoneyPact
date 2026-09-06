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
Source history: original baseline `f1903e780b7b4f984c210c2234af2e05ae570b6c`;
activation correction approved in `CBD13-ACTIVATION-001`, independently reviewed
in `CBD13-ACTIVATION-REVIEW-001`, and merged in PR #236 at
`c757f24bda56dcdf74f4a2eb16a531ec5d1a63f6`.
`CBD13-RETENTION-001` approves the Private MVP deferral below; the CBD-78
amendment was independently reviewed and merged in PR #237 at `01ca789cef216b4bc8ab9fa1c0318d37639190bc`.
`CBD81-PRIVACY-001` approves the reviewed generic-Withheld planning boundary.
`CBD13-PROFILE-001`, `CBD13-CATEGORY-001` and `CBD13-USABLE-TIME-001` approve
the usable-budget meanings and timing deferral. Their source candidate
`7754c5cf6efff4cdd7718dd9022fbb34bf75d2e4` passed CBD13-USABLE-REVIEW-001 and
merged in PR #239 at `8e3cbd76405d33ccd840e45153a485e5bbbd2b87`.
Lifecycle source `f7051ada2e73164814a689fdbf684edcf6b5511a` passed scoped Review
and Security and merged in PR #240 at `0b773c76266aeb462fd4d62f453afea240ddf7a5`.
CBD13-LIFECYCLE-001 and CBD81-BOUNDS-001 remain approved authorities.

CBD13-FINAL-REVIEW-001 requested changes at
`8dadd7cecbe9d912d194acda8086358f0d71d72d` for sent coverage and sync population
alignment. CBD13-INVITATION-SENT-001 and CBD13-SYNC-POPULATIONS-001 now approve
the exact decisions in sections 6.2/6.3; matching source amendments under
CBD13-FINAL-SOURCES-SPEC-001 are fixed at `ff93a9b1ab901b5b88ebc1cca855ab10916fe4af` and locally integrated; independent review and public merge remain pending.
The decisions are settled and correction candidates are present; final Review has not yet closed the two findings.
CBD13-FINAL-SECURITY-001 cleared integrated specification privacy only at that
same fixed candidate, not numerical release, runtime enforcement or final package
acceptance. No final Review approval is inferred from that Security disposition.

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
That decision settles DEC-81-001 only; the package remains Draft. Source validity,
exact numerical release policy, operating bounds and all other unresolved gates remain
pending. No observed comparison range or performance target is approved.

`B0` is the first Monday 00:00 UTC after the Product Owner authorizes the manual
beta and the relevant source, release controls and approved policy are ready.
Each metric records its actual start date in the authorized operational record;
an unavailable metric has no fictitious start. A definition or material source
change starts a new version and baseline; do not splice incompatible windows.
For the approved sync correction (section 6.2), pin the per-metric population,
terminal-day attribution, operational run identity, source mapping and bucket/bound
version before comparable D14 evidence starts. Do not mix supersession-filtered
and all-run populations or start-day and terminal-day records across versions;
unknown mappings block computation. New source semantics do not authorize
backfilling from unauthorized history or reusing invalid prior baseline credit.

| Profile | Start and duration | Minimum evidence and scheduled review | Next decision |
| --- | --- | --- | --- |
| W4 | First complete UTC calendar week at/after B0; four consecutive weeks | Four complete, comparable, releasable weekly records with eligible population; review on the first Monday after week four closes | Product Owner accepts the observed range as the provisional comparison baseline, explicitly chooses a justified target, or extends once for four weeks |
| D14 | First 00:00 UTC after the relevant capability and source are ready; fourteen complete UTC days | Fourteen complete, comparable, releasable daily records; review next UTC day after day fourteen closes | Owner proposes a baseline and operational bound if supported; Product Owner accepts, modifies, or extends once for fourteen days |
| R4 | First valid A week at/after B0; B starts four weeks after A starts | Two successive releasable named A/B pairs, requiring at least six complete weeks; review first Monday after the second B closes | Product Owner accepts a provisional comparison baseline or defers with reason and next review in four weeks |
| R8 | First valid A week at/after B0; B starts eight weeks after A starts | Two successive releasable named A/B pairs, requiring at least ten complete weeks; review first Monday after the second B closes | Product Owner accepts a provisional comparison baseline or defers with reason and next review in four weeks |

Full MT-78-004 action breadth and MT-78-005/006 historical active retention are
Executive-deferred for Private MVP under `CBD13-RETENTION-001`. They are not
required evidence for current Private MVP success and receive no computation,
numeric release or baseline credit. Preserve their metric/source slots and
W4/R4/R8 periods for future applicability after an approved operational-source
contract proves actual actions, occurrence times and historical A/B evidence
under mutation/deletion. No proxy, activity history, audit-purpose reuse or
retained measurement membership is authorized. Deferred metrics' W4/R4/R8 clocks
do not start during deferral. AD-78-001 and RT-78-001 remain future definitions,
not proof of current computability. The separate cadence-segmentation deferral
remains unchanged.

MT-77-005 Time to usable budget is separately Executive-deferred under
`CBD13-USABLE-TIME-001`. It is not required evidence for current Private MVP
success: no computation, numerical release, baseline credit or successful timing
claim. Preserve MT-77-005/MS-80-007, its intended interval from space creation
to first simultaneous UB-77-001 satisfaction, aggregate destination and future
W4 profile; no baseline clock starts during deferral. Reopening requires an
approved operational-source contract proving that first simultaneous instant
under replacement, deletion and period changes. Never substitute maximum current
limb timestamps, updated_at, budget date or newly retained measurement history.
Current-state usable-budget completion MT-77-003 and all five limbs remain
required and applicable; the timing deferral does not waive them.

Under `CBD81-BOUNDS-001`, specification acceptance may leave the exact freshness
and alert-lateness classification bounds unset, pending evidence-based selection
and Executive approval. This explicit closure-stage exception is not a Private
MVP applicability deferral. MT-79-003/008 remain required beta evidence: no rate,
healthy status, numerical release, baseline start or credit until the bounds and
source/release prerequisites are approved and verified. Their D14 starts only
when valid comparable releasable rates can be observed; rate observations that
cannot yet be computed cannot supply their own classification bound.
MT-79-010 duration baseline may start only after interval, terminal-state, source,
bucket and release prerequisites pass. Compliance or near-breach judgments also
require approved lifecycle-specific commitments and actionable approach rules.
Missing applicable evidence follows the dated continuation/pause process and
blocks dependent expansion or successful beta evaluation exit. There are still
exactly four approved metric deferrals: MT-77-005 and MT-78-004/005/006.

The counts above are approved minimum *windows*, not a statistical power claim
or a population privacy threshold. Every constituent record must independently
pass the release policy in section 3. If evidence is insufficient at the scheduled
review, record only the permitted evidence status under section 3, decide the extension or pause, and record
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
does not invent one or describe a candidate number as safe. Exact numerical
release-policy approval and verification remain future gates under approved
`DEC-81-002` planning disposition (`CBD81-PRIVACY-001`); numerical releases remain withheld until those separately Security-reviewed, Executive-approved and implementation-verified gates pass.
Computation inside the authorized Worker grants no human access to intermediate
results or contributing records.

Every externally recorded availability state is a disclosure, including Product
Owner views and associated process records. Until a specific release policy
explicitly permits a distinction, empty populations, below-threshold populations,
concentrated contributions and unsafe related results all emit exactly
`Withheld`. Release no reason, transition detail, counts, percentiles, direction,
failure-present flag or value-derived action. Generic withholding earns no
baseline credit. Explanatory readiness facts may describe only implementation
or approval facts independent of customer data; they must not encode population
conditions or imply the concealed outcome.

| Permitted evidence state | Treatment and action |
| --- | --- |
| Releasable | Only after exact release-policy approval and verification, use the approved global figure, window and permitted state on the class's authorized destination; no drill-down |
| Withheld | Identical generic status for every population-dependent withheld condition; never zero, blank, a population-specific reason or a hidden-value action; no baseline credit |
| Unavailable — implementation/approval dependency | Explain only customer-independent readiness facts, such as a source contract awaiting approval, an unimplemented binding or approved Private MVP deferral; no computation/backfill from unauthorized sources and no baseline credit |

A scheduled review without required releasable records still invokes the bounded
next decision in section 2. Its record must obey the same disclosure rule: no
population-dependent sufficiency reason or transition detail is released. The
owner may record the calendar deadline and customer-independent policy or
implementation dependency, never a hidden-value diagnosis. No withholding
reason is exposed merely because an older source names that reason.

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

For package interpretation, `CBD81-PRIVACY-001` and this section's generic
`Withheld` rule govern inherited CBD-77/78/79/80 population-specific suppression
wording; that wording does not authorize releasing a reason or hidden-failure
flag. CBD-79's individual-request/membership investigation prose likewise grants
no routine inspection authority: OP-92-003 requires a separately valid exceptional
purpose and all existing gates, even after a releasable failure. A withheld value
cannot trigger such access or a value-derived action. `CBD13-LIFECYCLE-SECURITY-001`
cleared the scoped lifecycle amendment, not this inherited prose. These explicit
restrictions remain controlling; source prose is not silently amended or waived.

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
All other rows retain `MANUAL-OK` connectivity classification; this does not
override the approved MT-77-005 and MT-78-004/005/006 deferrals or assert implementation readiness.
W4/D14/R4/R8 profile timing and bounded review rules are approved under
DEC-81-001. Trigger and guardrail proposals remain subject to their stated gates;
no performance target is approved.

| Exact metric ID and name | Owner | Profile; cadence | Trigger and actionable response |
| --- | --- | --- | --- |
| MT-77-001 — Space creation rate | product | W4; W/R | Adverse decline after valid source binding and release controls: reproduce account-to-space onboarding using synthetic data; fix creation or copy failures; roll back the responsible change if reproducible |
| MT-77-002 — First budget period rate | product | W4; W/R | Adverse decline after valid source binding and release controls: check period materialization and schedule validation; repair or roll back the failing setup path |
| MT-77-003 — Usable-budget completion rate | product | W4; W/R; binding/release gates | Current-state completion and all five limbs remain applicable. Profile/category meanings approved; CBD-77/80 sources independently reviewed and merged in PR #239; exact physical bindings and release controls remain required before computation/baseline credit. Thereafter adverse decline: validate all five UB-77-001 limbs in synthetic fixtures; fix the failing manual setup path without redefining usable |
| MT-77-004 — Time to first budget period | product | W4; W/R | Adverse increase: reproduce setup delays and period scheduling; simplify or fix the affected step; preserve higher percentile release protection |
| MT-77-005 — Time to usable budget | product | Future W4; W/R; Private MVP deferred | Deferred/unavailable under CBD13-USABLE-TIME-001; not current Private MVP success evidence. No computation, numerical release, baseline credit or successful timing claim. Preserve MS-80-007 and intended first-simultaneous interval; future source-proof gate in section 2. After reopening and baseline, reproduce completion friction and repair the responsible step |
| MT-77-006 — Manual-account activation rate | product | W4; W/R | Adverse decline after valid source binding and release controls: check account creation and linking to the period; fix the manual flow without requiring a bank connection |
| MT-77-007 — Manual-transaction activation rate | product | W4; W/R | Adverse decline: reproduce manual entry and reliable-date classification; repair validation or period assignment |
| MT-77-008 — Category-target completion rate | product | W4; W/R | Adverse decline: check current-period targets and transition prorating; fix target setup or explanation |
| MT-78-001 — Transaction classification rate | product | W4; W/R | Adverse decline: test eligible reliable-date boundaries against SD-071-035; fix classification or period coverage without widening the denominator |
| MT-78-002 — Invitation acceptance rate | product | W4; W/R | Adverse decline: review generic invitation/acceptance copy and synthetic lifecycle tests; fix expired or broken links without contacting inferred nonresponders |
| MT-78-003 — Invitation terminal-state distribution | product | W4; W/R | Adverse shift toward expired, revoked or declined: validate the lifecycle and neutral copy; fix the shared flow; withhold the entire unsafe distribution |
| MT-78-004 — Collaboration action breadth | product | Future W4; W/R; Private MVP deferred | Full four-class action breadth unavailable under CBD13-RETENTION-001; no computation, numeric release or baseline credit and not required for current Private MVP success. Future source-proof gate DEF-81-001; after reopening and valid baseline, investigate adverse breadth using synthetic role/action tests, never activity surveillance |
| MT-78-005 — Four-week active retention | product | Future R4; W/R; Private MVP deferred | Historical active retention unavailable under CBD13-RETENTION-001; no computation, numeric release or baseline credit and not required for current Private MVP success. Future source-proof gate DEF-81-001; after reopening and baseline, review shared product friction and permitted feedback without joining feedback to measurement or tracking people |
| MT-78-006 — Eight-week active retention | product | Future R8; W/R; Private MVP deferred | Same approved deferral and future gates as four-week retention; preserve eight-week separation and future ten-week earliest baseline review. Unavailable never means measured success or successful retention |
| MT-78-007 — Firm alert acknowledgement rate | product | W4; W/R | Adverse decline: reduce, soften or remove problematic catalog behavior. Global and operator-only; never name/contact/differentiate a member or increase frequency, volume or insistence |
| MT-78-008 — Firm alert dismissal rate | product | W4; W/R | Adverse increase: make alerts fewer, softer or less frequent. Same no-member-access and no-contact restrictions; never optimize for compliance |
| MT-79-001 — Synchronization success rate | synchronization | D14; D/R; sync source gate | Approved successful R(D) minus S(D) divided by count(R(D) minus S(D)), per section 6.2. Source correction locally integrated at ff93a9b; independent review/public merge pending; no computation/baseline credit before mapping and release proof. Thereafter adverse decline: inspect allowed safe outcomes, reproduce defect, reduce scheduled load or roll back affected sync code; retain exact supersession exclusion |
| MT-79-002 — Synchronization latency | synchronization | D14; D/R; sync source gate | Approved all-R(D) terminal-minus-first-Worker-attempt duration, including retry/backoff and cancellations/supersession; not success-only latency. Source/bucket/release proof and version comparability required. Thereafter adverse p90 bucket rise: inspect permitted queue/capacity evidence, tune within approved caps or reduce scheduling frequency |
| MT-79-003 — Connection freshness | synchronization | D14; D/R; classification/source/release gates | Approved watermark and eligible-connection meaning in section 6.1. Required beta evidence, not deferred: no rate, healthy status, numeric release, baseline start or credit until classification bound and source/release prerequisites are approved and verified. Thereafter deterioration triggers cursor/scheduler investigation alongside independently releasable sync outcomes; repair stale-success behavior |
| MT-79-004 — Synchronization retry rate | synchronization | D14; D/R; sync source gate | Approved runs in R(D) consuming at least one retry divided by count(R(D)); cancelled/superseded runs included, one contribution per run. Source correction locally integrated at ff93a9b; independent review/public merge pending. After mapping/release proof and baseline, adverse increase triggers bounded retry/backoff investigation, reduced schedule frequency or provider repair; no retry beyond approved bounds |
| MT-79-005 — Terminal synchronization failure rate | synchronization | D14; D/R; sync source gate | Approved terminal technical failures in R(D) divided by count(R(D)); valid cancellations remain denominator, not failures; only failed subset supplies safe failure classes. Not the complement of MT-79-001. After valid mapping/release proof, new safe class or adverse growth routes to existing relinking or code-defect response; unresolved CoBudget defect blocks affected release |
| MT-79-006 — Notification outcome distribution | notifications | D14; D/R | Adverse failed/late growth or unexplained suppressed growth: inspect queue, provider and transport caps; fix configuration or roll back. Correct suppression stays in denominator; no extra transport |
| MT-79-007 — Alert duplicate rate | notifications | D14; D/R | Adverse rise or unexplained zero: test both trigger and dedup guard; a suppressed duplicate attempt is not a delivered duplicate. Fix attempts or missing instrumentation; confirmed duplicate delivery violates AB-74-001 and pauses affected delivery |
| MT-79-008 — Alert lateness rate | notifications | D14; D/R; classification/source/release gates | Approved qualifying-source-to-in-app-availability interval in section 6.1. Required beta evidence, not deferred: no rate, healthy status, numeric release, baseline start or credit until classification bound and source/release prerequisites are approved and verified. Thereafter adverse rise triggers evaluation/fan-out/scheduler/Worker diagnosis and repair or rollback; excluded unavailable instances mean this rate cannot prove absence of dropped alerts |
| MT-79-009 — Export and deletion completion rate | security | W4 plus zero-failure guardrail; W/R | Use approved accepted-request and source-specific terminal population in section 6.1; completion is completed/(completed+failed), counting each accepted request once at terminal transition. Valid cancellation/restoration and unfinished states are neither success nor failure. Any releasable failed terminal outcome triggers investigation and blocks affected release pending resolution; individual content inspection retains separate OP-92-003 purpose and gates |
| MT-79-010 — Export and deletion elapsed time | security | W4; W/R; duration evidence/commitment gates | Elapsed distribution is time from accepted eligible request to terminal outcome over the same completed/failed population as MT-79-009. Baseline only after interval, terminal-state, source, bucket and release proof; no compliance or near-breach claim without approved lifecycle-specific commitment and actionable approach rules. Once authorized, approaching that commitment triggers queue prioritization and release review |
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
remediation owner and next due date belong to the associated process record,
subject to section 3 disclosure controls;
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
| Continue | Remain within the authorized beta scope; no unresolved privacy/security violation or relevant product-contract failure; each available metric is reviewed and each applicable missing one has an owner, dated evidence plan and next review using only section 3 permitted disclosures. Approved deferred metrics retain a future source handoff without a current baseline deadline. Pending bank metrics do not stop manual measurement. Continuing with insufficient evidence must be explicit and time-bounded |
| Pause | Immediately stop the affected measurement release on privacy/source invalidity; stop the affected capability for confirmed unsafe access, failed revocation or contract-breaking delivery. Pause the whole beta when impact cannot be contained or security requires it. Evidence insufficiency blocks expansion and triggers an explicit continuation/pause decision at the baseline deadline |
| Expand | Separate Product Owner authorization after applicable baselines are accepted, defects remediated, operational bounds and release controls approved/verified, and no unresolved blocker relevant to expanded scope. No cadence segmentation or new source is authorized. MT-79-003/008/010 retain applicable evidence requirements under DEC-81-003; no expansion dependent on them without that evidence. Bank expansion additionally needs bank-path readiness and its deferred evidence plan |
| Exit review successfully | Conclude beta evaluation only after all applicable baseline profiles have matured, including valid MT-79-003/008/010 evidence when applicable; the DEC-81-003 specification-closure exception does not waive beta evidence. Approved-deferred MT-77-005 and MT-78-004/005/006 evidence is not required for current Private MVP success and is never labeled measured success, successful timing or successful retention; parent criterion gaps have approved dispositions; release/QA/security gates and lifecycle handoff evidence are complete. This is not permission for public launch, which retains CBD-94/95 and SRV-94-010 gates |
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
| DEC-81-002 — approved planning disposition | Executive accepted the reviewed generic-Withheld specification boundary, including process records, under CBD81-PRIVACY-001. All population-dependent withheld conditions have identical status, without hidden reasons, transition details, value-derived actions or baseline credit | CBD81-SECURITY-002 and CBD81-REVIEW-004 assessed candidate a5a25fc6d8740483ee484f839ac271c75dc6b354 within their stated scope. Exact numerical release policy still requires separate Security review, Executive approval and implementation verification: exact outputs/windows, populations, contribution checks, related outputs, repeat/revision rules, access, bindings, retention and synthetic inference tests. No numerical release, runtime enforcement, measurement waiver or final package/process approval. Review singling-out, complementary counts, repeated-window differencing, distributions, low-volume operations and higher percentile protection; volume alone is insufficient and later segmentation needs separate review |
| DEC-81-003 — approved specification-closure disposition | CBD81-BOUNDS-001 permits specification acceptance with exact freshness/lateness classification bounds unset pending evidence-based selection and Executive approval. This is a closure-stage exception, not a beta applicability deferral. CBD13-LIFECYCLE-001 approves the lifecycle meanings in section 6.1 | MT-79-003/008 require verified classification bounds plus source/release prerequisites before any rate, healthy status, numeric release, D14 start or credit. MT-79-010 duration baseline requires interval, terminal-state, source, bucket and release proof; compliance/near-breach claims require approved lifecycle-specific commitments and actionable approach rules. Applicable beta evidence is still required for expansion/successful exit. No numerical value approved; 30-day grace, 24-hour export expiry and backup expiry are not SLOs. Source amendments independently reviewed at f7051ad and merged in PR #240; final process/package approval remains pending |
| DEC-81-004 — settled | Executive approved technical correctness assessment through defined synthetic QA against approved alert rules, separate from production metrics, customer data and support data. CBD-13-AC05 and CBD-79-AC03 were clarified in live Jira; the other four alert measures remain unchanged | Manager communicated the explicit decision September 5, 2026. OQ-79-002 is resolved by this clarification; no new production metric, behavioral tracking or human reading of customer alerts. Defined synthetic QA and its execution evidence remain delivery requirements |
| DEF-81-001 — approved deferral; future source gate | Permission does not prove action or viewing; budget/effective dates do not prove occurrence times; mutation/deletion can erase historical A/B evidence. Executive approved full MT-78-004 and MT-78-005/006 Private MVP deferral in CBD13-RETENTION-001 | Approved criterion disposition, not a current retention/breadth success requirement or evidence of computability. CBD-78 amendment merged in PR #237 at 01ca789; CBD-80 deferred-source follow-through is included in reviewed candidate 7754c5c, merged in PR #239. Future reopening requires an approved operational-source contract proving actual actions, occurrence times and historical A/B evidence under mutation/deletion, without behavioral events, activity history, retained membership or audit-purpose reuse; implementation and release gates remain |
| DEF-81-002 — resolved population correction | CBD13-ACTIVATION-001 approved distinct populations, state immediately before exclusive UTC close, final-24-hour subject grace, matching rate membership and consumer-specific source intersections; broad shared MS-80-004 preserved | Independently approved in CBD13-ACTIVATION-REVIEW-001 and merged in PR #236 at c757f24. Prior MT-77-001/002/003/006 population inconsistency is resolved, not a remaining baseline blocker. This establishes source semantics only: profile/category meanings and MT-77-005 deferral are now approved separately; their source amendments are independently reviewed and merged in PR #239; actual bindings and release verification remain gates, with first-simultaneous timestamp proof required before future timing applicability |
| DEP-81-001 | CBD-122 must bind all nine reliability metrics to its closed attribute universe; CBD-80 must bind operational sources to actual schemas without changing meaning | Owning implementation packages and independent review; unavailable until binding and release-control verification. Source registration is not implementation evidence |

The measurement meanings in `OQ-77-003/004` are settled by
`CBD13-PROFILE-001` and `CBD13-CATEGORY-001`:

- At window close, use the measured space's current active Primary Owner
  (PM-72-008). The profile limb requires exactly one extant active person-level
  financial-profile authority domain (CA-92-012). An existing empty profile
  counts; no profile fails. Multiple active profiles or ambiguous association
  invalidate the source, not normal onboarding failure. Deletion-pending,
  terminated and retained-history-only profiles do not qualify. No account,
  balance, connection, transaction, preference completion or positive value is
  required by this limb. Zero profiles before first use differs from an empty
  existing profile; no member gains private-profile access.
- A qualifying category is an extant stable-identity entity owned by the measured
  budget space, designated expense budgeting and currently usable for expense
  classification and category-target planning. Exclude income/transfer classes,
  uncategorized placeholders, display groups, historical-only references and
  archived/deleted/replaced-only/inactive categories. Rename/reorder preserve
  identity; recreation creates a different identity. At least one qualifies
  without actual spending or a target. The separate allocation limb requires
  a current-period target on a qualifying category: explicitly stored zero
  qualifies, missing target does not, and approved transition-prorated targets
  count. MT-77-008 numerator and denominator use the same qualifying set.

All five UB-77-001 limbs remain simultaneous, including the separate period limb
and the account OR transaction choice. The decisions do not approve full CBD-82
or CBD-30 designs, physical schemas, permissions, lifecycle mechanics or retention
changes. Source candidate `7754c5cf6efff4cdd7718dd9022fbb34bf75d2e4` implements
these meanings and the MT-77-005 deferral; `CBD13-USABLE-REVIEW-001` independently
approved it. It is merged in PR #239. CBD-82/CBD-30 and CBD-77/CBD-80
owners still owe authorized bindings and verification of exact association,
lifecycle, category identity and current-target predicates. These are integration
and implementation dependencies, not undecided measurement meanings. MT-77-005
first-simultaneous source proof remains a future reopening gate under the approved
deferral in section 2. No runtime evidence or successful measurement is asserted.

Denied cross-space access and related support-incident signals remain barred for
Private MVP and routed to `SRV-94-010`; this settled disposition is not reopened
as an Executive choice here. The aggregate alert-release permission and one-way
response restriction also remain settled despite stale source prose suggesting
otherwise. Header/count/naming discrepancies in CBD-80 and older status prose
are outside this package's write scope; consult its actual register rows and
latest explicit decisions, and route reconciliation through Manager. No source
document is silently amended by this proposal.

## 6.1 Approved lifecycle meanings and source handoff

`CBD13-LIFECYCLE-001` approves these meanings for CBD-79 and matching CBD-80
MS-80-023/028/029/030. Source revision
`f7051ada2e73164814a689fdbf684edcf6b5511a` is independently reviewed and merged in PR #240. The fixed local CBD-79
approved lifecycle contract and CBD-80 approved lifecycle derivation contract
carry these meanings. Scoped review/clearance is distinct from final integrated
package acceptance, physical binding and runtime proof.

- **Freshness:** at observation T, age is T minus the last committed successful
  sync watermark. Eligible connections are currently authorized and active for
  sync; exclude orphaned, revoked, disconnected and lifecycle-stopped connections.
  Eligible never-synced connections remain in the denominator, cannot be fresh,
  and have missing age, never zero. Failed/superseded runs do not advance the
  watermark. No freshness rate is computable until its classification bound is
  approved and all source/release prerequisites are verified.
- **Alert lateness:** from the durable source revision first satisfying the
  applicable approved rule to the mandatory recipient instance becoming available
  through its authorized in-app surface. Settlement applies only where the rule
  requires it. Viewing, acknowledgement, external sends and quiet-hour expiry
  are not endpoints. Count each instance becoming available in the window once;
  still-unavailable/failed instances are excluded, so the metric cannot prove
  absence of dropped alerts. The interval includes evaluation and fan-out delay.
- **Request start and population:** accepted eligible authorized request after
  required verification/confirmation; exclude rejection and verification attempts,
  include queue delay. Count each accepted request once at terminal transition.
  Inactivity archival starts at accepted binding after approved objection
  conditions, not at proposal timestamp. Completion rate is
  completed/(completed+failed); elapsed distribution uses the same population
  and measures time to terminal outcome. Completed means evidenced applicable
  success; failed means an approved terminal unsuccessful outcome. Retrying,
  grace and pending cleanup are neither. Valid cancellation/restoration is
  distinct, neither success nor failure; invent no cancellation absent from the
  source contract. Excluded unfinished requests imply neither success nor no
  failures. Existing generic-Withheld rules govern every disclosed state.
- **Export and archival success:** export is the correctly scoped, recipient-bound
  protected package ready for authorized retrieval, not download or expiry.
  Archival is atomic archived state plus committed restrictions, with no erasure.
- **Both deletion flows:** budget-space deletion succeeds after its restoration
  window when defined payload/history/interactions/imports are irreversibly
  purged to a minimal nonfinancial tombstone; cancellation returns to archived
  without pending deletion. Personal-account deletion succeeds at irreversible
  account/profile termination and approved private-data/shared-history dispositions:
  necessary shared facts pseudonymized and minimal non-resurrection ledger
  retained. Immediate authority shutdown is not completion; restoration does
  not resurrect authority. Distinct source predicates do not create a released
  breakdown.
- **Deletion terminal boundary:** evidenced application-controlled terminal
  disposition against the approved per-class/custodian schedule. Merely scheduling
  cleanup is insufficient. Processor/backup obligations remain separately tracked
  under their existing authorized contracts, not added measurement history or
  labels. Neither endpoint claims erasure of recipient-held copies. FU-95-014/022
  execution gates remain open; these metric definitions authorize no deletion.

No new labels, behavioral events, measurement history, retained membership or
purpose reuse is authorized. Grace, export expiry and backup expiry are not
performance SLOs; archival has no invented countdown. Exact numerical thresholds,
commitments, bindings and release verification remain future requirements under
the approved section 2/DEC-81-003 disposition.

## 6.2 Approved sync populations and source-version handoff

CBD13-SYNC-POPULATIONS-001 approves the following exact measurement choices.
Matching CBD-79/80 corrections are fixed at
`ff93a9b1ab901b5b88ebc1cca855ab10916fe4af` and locally integrated. Independent
review and public merge remain pending; no runtime implementation is claimed.

R(D) is the distinct operational sync runs with a first Worker attempt and an
evidenced terminal transition in UTC day D=[00:00,next 00:00). Bounded retries
belong to one run; never-attempted queued work is excluded. S(D) is the subset
terminally cancelled because superseded, evidenced by the operational contract,
never inferred merely from a later run. MT-79-001 uses successful runs in
R(D) minus S(D) over count(R(D) minus S(D)). MT-79-002 uses durations for all R(D),
terminal timestamp minus first Worker-attempt timestamp including retry/backoff.
MT-79-004 uses runs in R(D) consuming at least one retry over count(R(D)), once
per run even with multiple retries. MT-79-005 uses terminal technical failures
in R(D) over count(R(D)); safe failure classes come only from the failed subset.

MT-79-002/004/005 include cancelled/superseded work. Valid cancellation is never
success or relabeled technical failure; other approved cancellations stay unless
an explicit exclusion applies. MT-79-001/005 are not complements. Unknown outcome
or identity mappings block computation, not inferred success/failure. MT-79-003
remains the separately approved authorized-active-connection snapshot.

MS-80-021 needs consumer-specific Worker counts: supersession-excluded for
MT-79-001, all-R(D) denominators for MT-79-004/005; a single filtered scalar
cannot serve all three. MS-80-022 duration buckets cover all R(D); MS-80-024 retry
buckets cover all R(D), including zero; MS-80-025 safe classes cover only failed
runs. CBD-103 TD-103-007/008/010 and CBD-92 SA-92-001/AN-92-003/005/006 establish
operational lifecycle/privacy authority; the explicit Executive decision supplies
these measurement choices. No blanket schedule citation substitutes for them.

Monday 23:58 first attempt, Tuesday 00:02 retry and Tuesday 00:05 terminal
transition contribute once Tuesday with seven-minute duration, nothing Monday.
Exact midnight belongs to the new day. Pending work has no terminal credit and
cannot imply success. Duplicate delivery adds no contribution; postterminal replay
needs an operational identity rule, never retained measurement membership. These
are specification expectations, not executed tests. Preserve the existing closed
release schema: no cancellation-reason/ID disclosure, per-run timings, tracking,
retained measurement history or new source/metric/destination.

## 6.3 Approved invitation sent coverage

CBD13-INVITATION-SENT-001 covers sent through CBD-73's existing privacy-preserving
sent/pending customer projection and defined synthetic lifecycle checks, not a
production sent measure. Projection is not proof of dispatch, delivery, receipt
or recipient activity. MT-78-002/003 and MS-80-014 retain their terminal-only
populations and outputs; sent is excluded. No sent count, rate, breakdown,
tracking or retained measurement history is added. Falling acceptance can prompt
synthetic flow investigation but cannot establish a production sending trend.

The defined synthetic requirements reference INV-73-05/13/19, VER-73-11 and
CBD-73 section 4.5: ordinary Pending, internally Delivered/restricted Failed,
privately terminal real records until projection_inactive_at, and synthetic
non-delivering requests may share equivalent sent/pending projections. Verify
equivalent projections, controls and timing; fixed expiry despite delayed
processing/private causes; normalized cancellation/resend predecessor-successor
behavior; unchanged terminal metric populations/outputs. TR-73-02 durable dispatch
is the separate atomic Pending transition, not delivery proof. Restricted evidence
cannot be reused to manufacture a send count. These synthetic checks are required
delivery evidence, not execution claimed here. CBD-78/80 source corrections are
fixed at ff93a9b and locally integrated; independent review/public merge remain
pending. This package does not edit CBD-73 or assert runtime implementation.

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
