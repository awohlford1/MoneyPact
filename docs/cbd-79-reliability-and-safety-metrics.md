# CBD-79 — Reliability and Safety Metrics

| Field | Value |
| --- | --- |
| Status | **Accepted specification v0.5** under CBD13-FINAL-ACCEPTANCE-001, with all recorded decisions and exceptions preserved. CBD13-FINAL-REVIEW-002 approves the integrated package and closes both prior findings; CBD13-FINAL-SECURITY-002 clears specification privacy only. No runtime measurement, numerical reporting, beta launch, deployment or Jira Done claimed |
| Document version | 0.5 |
| Owner | Alexander Wohlford |
| Jira | [CBD-79](https://cobudget.atlassian.net/browse/CBD-79) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Governing measurement contract | CBD-92 `AN-92-001`–`AN-92-007`, approved |
| Governing alert model | `docs/cbd-74-accountability-alert-boundary-specification.md` — Document version **1.0.1**, approved |
| Governing schedule decisions | `docs/cbd-71-mvp-schedule-decision-register.md` — Document version **1.1**, approved |
| Consuming packages | CBD-80 (measurement-source register); CBD-81 (targets and review) |
| Confluence page | **Unpublished to Confluence.** No verified target; future registration/publication readiness separately gated |
| Last updated | September 5, 2026 |

## 1. Purpose and authority

CBD-79 defines how the private beta knows whether the product is working. It defines ten metrics, the operational response for each, and two things it could not define.

**Most metrics here are `reliability-telemetry`, not `aggregate-state`**, and the distinction matters: `AN-92-003` permits an explicit S1 allowlist — service and version, coarse operation class, safe outcome class, duration bucket, aggregate health count — and **nothing carrying a subject, space, resource, account, connection or destination.** A reliability metric that needs one of those is not a reliability metric.

`AN-92-006` keeps the streams separate: reliability, security, support, audit and aggregate-measurement schemas, stores, access roles and retention stay distinct, and an identifier collected for one purpose is never reused for another. **That rule is why `CBD-79-AC04` is unsatisfied** (§4).

## 2. Boundary with CBD-78

`CBD-79-AC03` names `acknowledged` and `dismissed` among the alert-quality states. **`CBD-78-AC06` already owns both**, at `MT-78-007` and `MT-78-008`.

**This package does not redefine them.** Two metrics for one quantity is the defect the conventions §10 boundary exists to prevent, and CBD-78's versions carry the `AB-74-014` release constraint that any redefinition here would have to restate and could drift from. `CBD-79-AC03` is answered for those two states **by reference**, and this package defines only the states CBD-78 does not.

## 3. Synthetic incorrect-alert QA

`CBD13-CORRECTNESS-001` approves assessment of incorrect alerts through synthetic QA against approved alert rules, separate from production metrics and customer/support data. Compare synthetic alert outcomes with the expected result under the approved CBD-74 rules, including trigger conditions, rule-required settlement and eligible-recipient boundaries. An incorrect implementation can produce the wrong alert even when the rule itself is fixed; correctness is not reduced to perceived usefulness.

No new production metric, behavioral tracking or customer/support-data reuse is authorized. Duplicate and late metrics remain `MT-79-007` / `MT-79-008`; acknowledged and dismissed remain CBD-78's `MT-78-007` / `MT-78-008`. The lifecycle decision separately corrects the lateness interval. Synthetic QA must be assigned and executed against the approved rules and candidate; no executed QA or pass is claimed by this specification. `OQ-79-002` records the approved disposition.

## 4. `CBD-79-AC04` splits four ways

The criterion requires safety measures covering **denied cross-space access, consent changes, revocation failures, and related support incidents.**

**They are not one question.** Two are measurable today under contracts already approved, and two are barred by name. Treating the criterion as uniformly blocked — which this document did at v0.1 — left two measures unwritten for no contractual reason.

| Signal | Standing | Why |
| --- | --- | --- |
| **Consent changes** | **Measurable** — `MT-79-011` | `DI-91-007` is application-datastore consent evidence: a customer's own act recorded as versioned agreement. Counting version changes is `AN-92-005` aggregate state, and no security decision is involved |
| **Revocation failures** | **Measurable** — `MT-79-012` | An operation that failed to complete is a safe outcome class. `AN-92-003` permits operation and outcome class in reliability telemetry, and the metric counts **whether the operation completed, not what it decided** |
| **Denied cross-space access** | **Barred** | `AN-92-003` excludes a *"security-decision"* label from reliability telemetry **by name**; `AN-92-004` keeps the evidence single-purpose; `AN-92-006` bars reusing it. A denial is a security decision however it is counted |
| **Related support incidents** | **Barred** | Support is a distinct purpose under `AN-92-006`, and `OP-92-002` bars the routine support surface from disclosing counts |

### 4.1 The distinction the two permitted measures turn on

**Whether an operation completed is not the same fact as what it decided**, and `AN-92-003`'s exclusion list is written at exactly that seam. A revocation that errors is a reliability outcome; an access request that is refused is a security decision. The first is on the allowlist and the second is named in the exclusion.

`MT-79-012` is written to stay on the right side of that line: it counts terminal outcome classes of the revocation operation and carries no subject, space, membership, role or decision label. **A metric that counted refusals would be the same shape and would not be permitted**, which is why none is defined.

### 4.2 The two barred signals — decided September 5, 2026

**They are barred for the Private MVP phase, and the question of whether they should be goes to the independent security review.** Neither is amended, and neither is dropped.

#### What the alternatives cost

**Amending `AN-92-006` is far heavier than it looks.** The contract is the source of **four cross-cutting hard gates** — `HG-102-002`, `HG-102-003`, `HG-102-026` and `HG-102-033` — and `HG-102-003` is the contract restated almost verbatim as a gate. Those four were measured against every candidate in all six provider categories, and evidence register §3 requires re-measurement whenever a pass test changes. **It would reopen the approved CBD-102 catalog and the CBD-108 provider selections**, which is the same cascade `HG-102-013`'s amendment caused and which this package has no standing to start.

**Amending `CBD-79-AC04` is cheap and worse.** It touches one criterion and nothing else — and a criterion that no longer asks for denied cross-space access is a criterion nobody revisits. The signal would not be deferred; it would be deleted, quietly, by the document that could least afford to lose it.

#### Where the question goes instead

`SRV-94-010`, the **independent public-launch security review**, exists to *"independently challenge diagram completeness, boundary placement, STRIDE coverage, technical triage, **evidence-gap scope**, and resulting CBD-94 mitigations/**residual decisions**."*

**This is an evidence-gap scope question and a residual decision, which is exactly what that review is for.** CBD-94 §11.8 makes it a public-launch prerequisite rather than a Private MVP one, so the beta runs without these two measures under every option except amending the contract — and the review reaches the question before it can matter.

**`CBD-79-AC04` is partially met and closes that way.** Two of four signals are measured; the two that are not are named, each with the contract that bars it, and routed to a review that must consider them. **The gap is recorded rather than resolved, and recorded is the honest state.**

## 5. Metric record extension

`CBD-79-AC06` requires that each unhealthy condition carry **an initial threshold or baseline rule and an operational response.** Conventions §10 splits that: **CBD-79 owns the condition and the response; CBD-81 owns the number.**

The conventions §4 record shape has an `Unhealthy condition` field and no response field, so every record below adds one:

| Field | Meaning |
| --- | --- |
| **Operational response** | What is done when the condition holds. A named action, not an intention. A metric whose response is *"investigate"* has no response |

The §4 fields remain required and none is dropped.

## 6. The metrics

Every metric is `Release form: global` and `Boundary: worker`. `Class` and `Owner` vary and are stated per record.

### MT-79-001 — Synchronization success rate

| Field | Value |
| --- | --- |
| Class | `reliability-telemetry` |
| Owner | `synchronization` |
| Purpose | Whether provider synchronization completes. The first measure that would show CBD-52's work failing in production |
| Formula | successful runs in R(D) minus S(D) / count(R(D) minus S(D)) |
| Numerator | Successful runs in the same R(D) minus S(D) population; cancellation is never success or relabeled failure |
| Denominator | Distinct attempted runs terminal in D, excluding evidenced terminal supersession cancellations S(D); other approved cancellations remain unless explicitly excluded. R(D)/S(D) are defined below under CBD13-SYNC-POPULATIONS-001 and TD-103-007/008/010 |
| Measurement source | `sync_run.outcome_class_count` *(proposed)* |
| Interval basis | First Worker attempt to evidenced terminal outcome; bounded retries remain part of one operational run |
| Window | UTC terminal day D = [00:00, next 00:00); attribute each distinct attempted run once by its evidenced terminal transition, not first-attempt day |
| Suppression | `withheld — population below release threshold`. **Runs, not people**, so this reaches releasable volume before any `aggregate-state` metric |
| Connectivity | `CONN-REQUIRED` — there is no synchronization without a provider connection |
| Data source | Worker job telemetry, on the `AN-92-003` S1 allowlist. **No connection, account, or space identifier** |
| Collection method | Scheduled aggregate in the Worker over outcome classes |
| Review cadence | Daily *(CBD-81 confirms)* |
| Unhealthy condition | Success falls below its baseline across consecutive days, or any single day shows a step change |
| **Operational response** | Read the terminal-failure distribution at `MT-79-005`, then the provider status page. If provider-side, record and wait; if CoBudget-side, roll back the most recent worker deploy |

### MT-79-002 — Synchronization latency

| Field | Value |
| --- | --- |
| Class | `reliability-telemetry` |
| Owner | `synchronization` |
| Purpose | Whether synchronization is slow before it is failing. Latency degrades first |
| Formula | p50 and p90 of (terminal timestamp - first Worker-attempt timestamp), in seconds, over all R(D) |
| Numerator | `n/a` — a distribution, not a rate |
| Denominator | `n/a` — distribution over all R(D), including cancellations and supersession; not a success-only population |
| Measurement source | `sync_run.duration_bucket_count` *(proposed)* |
| Interval basis | First Worker attempt to terminal outcome, including retries and backoff; time to terminal outcome, not success-only latency |
| Window | UTC terminal day D = [00:00, next 00:00); attribute each distinct attempted run once by its evidenced terminal transition, not first-attempt day |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `CONN-REQUIRED` |
| Data source | Worker job telemetry. **Duration buckets, per `AN-92-003`, not per-run timings** |
| Collection method | Scheduled aggregate over duration buckets in the Worker |
| Review cadence | Daily *(CBD-81 confirms)* |
| Unhealthy condition | p90 crosses into a higher duration bucket and stays there for consecutive windows |
| **Operational response** | Check queue depth and the delivery controls `HG-102-018` requires. If concurrency caps are binding, raise them; if the provider is slow, reduce scheduled frequency rather than retry harder |

### MT-79-003 — Connection freshness

| Field | Value |
| --- | --- |
| Class | `reliability-telemetry` |
| Owner | `synchronization` |
| Purpose | Whether the data a person sees is current. A connection that never errors but never refreshes is the failure most likely to go unnoticed |
| Formula | fresh_eligible_connections / eligible_connections at observation T; unavailable until the classification bound is approved |
| Numerator | Those same eligible connections whose T minus last committed successful sync watermark satisfies the approved freshness bound; never-synced connections cannot be fresh |
| Denominator | Connections currently authorized and active for synchronization at T; exclude orphaned, revoked, disconnected and lifecycle-stopped connections. Never-synced eligible connections remain included |
| Measurement source | `connection.freshness_bucket_count` *(proposed)* |
| Interval basis | Snapshot age at T = T minus last committed successful sync watermark; failed or superseded runs do not advance it. Never-synced age is missing, never zero |
| Window | Calendar day, UTC; observe snapshot at window close T |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `CONN-REQUIRED` |
| Data source | Worker job telemetry, bucketed. **No connection identifier reaches the aggregate** |
| Collection method | Scheduled Worker computation from authorized operational watermark/eligibility state to safe freshness buckets; physical source and bucket bindings remain future, with no retained membership |
| Review cadence | Daily; D14 cannot start or earn credit until valid comparable releasable rates exist under CBD81-BOUNDS-001 |
| Unhealthy condition | Unavailable without approved classification bound and source/release proof; no rate or healthy status may be claimed. Once valid, a growing stale share while MT-79-001 is healthy warrants review |
| **Operational response** | Compare against `MT-79-005`. A stale-but-succeeding population points at cursor handling, so inspect the sync cursor logic rather than the connection |

### MT-79-004 — Synchronization retry rate

| Field | Value |
| --- | --- |
| Class | `reliability-telemetry` |
| Owner | `synchronization` |
| Purpose | Whether the system is working harder for the same result. Retries are invisible in a success rate and expensive in provider cost |
| Formula | runs in R(D) consuming at least one retry / count(R(D)) |
| Numerator | Distinct runs in R(D) consuming at least one retry; one count per run even with multiple retries, including subsequently cancelled/superseded work |
| Denominator | All R(D), including valid cancellations and supersession; never-attempted queued and pending nonterminal work excluded |
| Measurement source | `sync_run.retry_bucket_count` *(proposed)* |
| Interval basis | First Worker attempt to terminal outcome; retry count covers all bounded retries in that one operational run, including zero |
| Window | UTC terminal day D = [00:00, next 00:00); attribute each distinct attempted run once by its evidenced terminal transition, not first-attempt day |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `CONN-REQUIRED` |
| Data source | Worker job telemetry |
| Collection method | Scheduled aggregate in the Worker |
| Review cadence | Daily *(CBD-81 confirms)* |
| Unhealthy condition | Retry rate rises while success holds steady, which is a cost and latency problem before it is a correctness one |
| **Operational response** | Check the bounded-exhaustion behaviour `HG-102-019` requires. A rising retry rate with a stable terminal-failure rate means backoff is absorbing a provider problem, so reduce frequency |

### MT-79-005 — Terminal synchronization failure rate

| Field | Value |
| --- | --- |
| Class | `reliability-telemetry` |
| Owner | `synchronization` |
| Purpose | Whether failures are being surfaced rather than silently dropped, which `HG-102-019` requires of every background path |
| Formula | terminal technical failures in R(D) / count(R(D)); safe failure-class distribution over only the failed subset |
| Numerator | Terminal technical failures in R(D), by approved safe failure class; cancellation is not failure |
| Denominator | All R(D), including valid cancellations and supersession; MT-79-001/005 are not complements |
| Measurement source | `sync_run.terminal_failure_class_count` *(proposed)* |
| Interval basis | First Worker attempt to evidenced terminal outcome; failure-class membership requires an approved terminal technical failure mapping |
| Window | UTC terminal day D = [00:00, next 00:00); attribute each distinct attempted run once by its evidenced terminal transition, not first-attempt day |
| Suppression | `withheld — population below release threshold`, applied to the whole distribution rather than per class |
| Connectivity | `CONN-REQUIRED` |
| Data source | Worker job telemetry. **Safe error classes only**, per the `AN-92-003` allowlist — no provider message, no payload, no identifier |
| Collection method | Scheduled aggregate in the Worker |
| Review cadence | Daily *(CBD-81 confirms)* |
| Unhealthy condition | Any terminal failure class appears that was not present in the prior window, or a class grows materially |
| **Operational response** | Match the class against the connection-error taxonomy CBD-50 defines. A class needing customer action goes to the relinking path; a class needing none is a CoBudget defect and blocks the next release |

### MT-79-006 — Notification outcome distribution

| Field | Value |
| --- | --- |
| Class | `reliability-telemetry` |
| Owner | `notifications` |
| Purpose | Whether notifications reach people. `CBD-79-AC02` requires all six outcome states, and they fail for different reasons |
| Formula | count per outcome ÷ notifications_enqueued |
| Numerator | Notifications in each of `enqueued`, `delivered`, `failed`, `suppressed`, `duplicate`, `late`, reported as six figures |
| Denominator | Notifications enqueued in the window. **`suppressed` stays in the denominator**: `AB-74-004` caps external delivery by transport contract and purpose, so a suppression is correct behaviour that must remain visible rather than removed from the base |
| Measurement source | `notification.outcome_class_count` *(proposed)* |
| Interval basis | Opens at enqueue; closes at a terminal outcome class |
| Window | Calendar day, UTC |
| Suppression | `withheld — population below release threshold`, applied to the whole distribution |
| Connectivity | `MANUAL-OK` — in-app instances need no provider |
| Data source | Worker delivery telemetry. **No destination, recipient, or space identifier**, per `AN-92-003` |
| Collection method | Scheduled aggregate in the Worker over outcome classes |
| Review cadence | Daily *(CBD-81 confirms)* |
| Unhealthy condition | `failed` or `late` grows, or `suppressed` grows without a corresponding transport-policy change |
| **Operational response** | For `failed`, check the provider selected at CBD-108 and its terminal state handling. For `late`, check queue depth. For `suppressed`, confirm the transport cap is the intended one rather than a misconfiguration |

### MT-79-007 — Alert duplicate rate

| Field | Value |
| --- | --- |
| Class | `reliability-telemetry` |
| Owner | `notifications` |
| Purpose | Whether deduplication works. `AB-74-001` makes deduplication fixed product behaviour, so a duplicate is a defect rather than a preference |
| Formula | duplicate_suppressed_instances ÷ instance_creation_attempts |
| Numerator | Instance creations rejected by the deduplication rule |
| Denominator | Instance creation attempts in the window |
| Measurement source | `alert_instance.dedup_outcome_count` *(proposed)* |
| Interval basis | Opens at an instance creation attempt; closes at its dedup outcome |
| Window | Calendar day, UTC |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Worker alert telemetry, outcome classes only |
| Collection method | Scheduled aggregate in the Worker |
| Review cadence | Daily *(CBD-81 confirms)* |
| Unhealthy condition | The rate rises, meaning duplicates are being generated; or falls to zero, which more likely means the rule stopped running than that duplicates stopped occurring |
| **Operational response** | A rise is a trigger-condition defect and goes to the alert catalog. **A fall to zero is investigated as a monitoring failure first**, because a silent guard looks identical to a solved problem |

### MT-79-008 — Alert lateness rate

| Field | Value |
| --- | --- |
| Class | `reliability-telemetry` |
| Owner | `notifications` |
| Purpose | Whether alerts arrive while they still matter. A late budget alert is not a smaller version of a timely one; it is a different product |
| Formula | instances delivered outside the lateness bound ÷ instances delivered |
| Numerator | Those same delivered recipient instances whose end-to-end interval from durable source revision first satisfying the applicable approved rule to authorized in-app availability exceeds the approved lateness bound |
| Denominator | Mandatory recipient instances becoming available through the authorized in-app surface in the window, counted once; still-unavailable and failed instances excluded |
| Measurement source | `alert_instance.delivery_latency_bucket_count` *(proposed)* |
| Interval basis | Durable source revision first satisfying the applicable approved rule to mandatory recipient-instance availability; settlement only where the rule requires it. Includes evaluation and fan-out; viewing, acknowledgement, external sends and quiet-hour expiry are not endpoints |
| Window | Calendar day, UTC |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Worker alert telemetry, bucketed |
| Collection method | Scheduled Worker aggregation over approved end-to-end duration buckets; exact timestamp/source bindings and release proof remain future. Delivered-only denominator cannot prove absence of dropped alerts |
| Review cadence | Daily; unavailable without approved classification bound and source/release prerequisites; no baseline start or credit under CBD81-BOUNDS-001 until valid comparable releasable rates exist |
| Unhealthy condition | No rate or healthy status without approved bound and source/release proof. After those gates pass, a rising lateness share warrants review |
| **Operational response** | Check scheduler tick delivery and queue depth. `TD-103-002` makes the scheduler a managed trigger, so a missed tick is a provider question and a slow worker is a capacity one; the two need opposite responses |

### MT-79-009 — Export and deletion completion rate

| Field | Value |
| --- | --- |
| Class | `aggregate-state` |
| Owner | `security` |
| Purpose | Whether accepted export, archival, budget-space deletion and personal-account deletion requests reach their approved success predicates in the lifecycle contract below |
| Formula | completed_requests / (completed_requests + failed_requests) |
| Numerator | Accepted requests reaching evidenced applicable success at their terminal transition in the window, per the source-specific success predicates below |
| Denominator | The same accepted requests reaching completed or approved terminal failed outcomes in the window; count each once. Rejected/verification attempts, pending/retrying/grace/cleanup and valid cancellation/restoration are excluded |
| Measurement source | `data_request.terminal_state_count` *(proposed)* |
| Interval basis | Accepted eligible authorized request after required verification/confirmation to its completed or failed terminal outcome; queue delay included. Inactivity archival acceptance follows approved objection conditions, not proposal time |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold`. **This will withhold for most of the beta**, and that is correct: request volume is low and each request belongs to one identifiable person |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, request table. **Counts only; no request, subject or space identifier reaches the aggregate** |
| Collection method | Scheduled Worker aggregate over evidenced application-controlled terminal dispositions; processor/backup obligations separately tracked under approved contracts, not counted as proven expiry. No new tracking or released lifecycle breakdown |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Any failed terminal state at all. This is not a rate to optimise — one failure is a finding |
| **Operational response** | Investigate the individual request through the authorized operational path, not through this metric. **The metric says a failure happened; it deliberately cannot say which**, and finding out is an `OP-92-003` exceptional-purpose action |

### MT-79-010 — Export and deletion elapsed time

| Field | Value |
| --- | --- |
| Class | `aggregate-state` |
| Owner | `security` |
| Purpose | Duration from accepted eligible authorized request to completed or failed terminal outcome for export, archival, budget-space deletion and personal-account deletion; no performance SLO is inferred from restoration grace or expiry |
| Formula | p50 and p90 of (terminal outcome at - accepted eligible authorized request at), in hours |
| Numerator | `n/a` — a distribution, not a rate |
| Denominator | `n/a` — a distribution over exactly the same completed-plus-failed terminal population as MT-79-009; cancellation/restoration and unfinished requests excluded |
| Measurement source | `data_request.elapsed_bucket_count` *(proposed)* |
| Interval basis | Accepted eligible authorized request after required verification/confirmation to the source-specific evidenced completed or failed terminal outcome; queue delay included, not request creation or verification time |
| Window | Calendar week, UTC, assigned by the same terminal transition as MT-79-009, regardless of acceptance week |
| Suppression | `withheld — population below release threshold`, at a higher population than the rate metrics because a percentile over few requests describes individuals |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, bucketed |
| Collection method | Scheduled Worker aggregate over the matching terminal population, using approved acceptance/terminal timestamps and safe elapsed buckets; physical binding and runtime evidence remain future |
| Review cadence | Weekly; duration baseline may proceed only after interval, terminal-state, source, bucket and release prerequisites pass, per CBD81-BOUNDS-001 |
| Unhealthy condition | No SLA/compliance or near-breach claim without approved lifecycle-specific commitments and actionable approach rules; restoration grace, export expiry and backup expiry are not performance SLOs |
| **Operational response** | After commitments and approach rules are approved, use their authorized escalation and queue response. Until then, obtain the interval/source/bucket/release evidence for a duration baseline and route missing commitments to CBD-81; do not report a near-miss |

### MT-79-011 — Consent change rate

| Field | Value |
| --- | --- |
| Class | `aggregate-state` |
| Owner | `security` |
| Purpose | Whether people are changing their consent, and how often. A rising rate with no disclosure change behind it points at copy people did not understand the first time, which `CBD-73` and `CBD-75` can fix and no other measure would surface |
| Formula | subjects_with_consent_change ÷ subjects_with_active_consent |
| Numerator | Account subjects whose consent record shows at least one version change in the window |
| Denominator | Account subjects holding at least one active consent record at window close |
| Measurement source | `consent_record.subject_change_count` *(proposed)*, `consent_record.subject_active_count` *(proposed)* |
| Interval basis | Opens when a subject holds an active consent record; closes when that record's version changes |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Application datastore, consent records — `DI-91-007`. **The count is of version changes, not of their content**: no disclosure text, no scope, no role, and nothing about what was consented to |
| Collection method | Scheduled aggregate in the Worker over consent-record versions |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | The rate rises while the governing disclosure version is unchanged, which means people are revising decisions the copy led them to make |
| **Operational response** | Compare against the disclosure version in force under `CBD-73`. If it has not changed, route the copy to the `CBD-75` review; if it has, the rise is expected and is recorded rather than acted on |

### MT-79-012 — Revocation completion rate

| Field | Value |
| --- | --- |
| Class | `reliability-telemetry` |
| Owner | `security` |
| Purpose | Whether revocation completes. **A revocation that fails silently leaves access in place**, which is the outcome `CBD-73`'s revocation lifecycle exists to prevent and the one nobody would notice |
| Formula | completed_revocations ÷ attempted_revocations |
| Numerator | Revocation operations reaching a success outcome class |
| Denominator | Revocation operations attempted in the window |
| Measurement source | `revocation_run.outcome_class_count` *(proposed)* |
| Interval basis | Opens when a revocation is initiated; closes at its terminal outcome class |
| Window | Calendar day, UTC |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Worker job telemetry on the `AN-92-003` S1 allowlist. **Operation class and outcome class only.** This counts whether the operation completed, **not what it decided** — the distinction §4.1 turns on, and the reason this metric is permitted where a denial count is not |
| Collection method | Scheduled aggregate in the Worker over outcome classes |
| Review cadence | Daily *(CBD-81 confirms)* |
| Unhealthy condition | **Any failed revocation at all.** Like `MT-79-009` this is not a rate to optimise: one failure means one person retains access they revoked |
| **Operational response** | Treat as a security incident. Verify the specific membership through the `OP-92-003` exceptional-purpose path — **the metric says a failure happened and deliberately cannot say which**, and that is the correct shape |

## 7. Denominator rules

Per conventions §6.

**Runs and requests, not people.** Most denominators here count operations, which reach releasable volume faster than any population metric and are why reliability can be reviewed daily while engagement cannot.

**Cancellation rules are metric-specific.** MT-79-001 excludes only evidenced supersession S(D); MT-79-002/004/005 use all R(D), including valid cancellations. Cancellations are never successes or technical failures. The Approved synchronization terminal-day populations contract governs these distinctions under CBD13-SYNC-POPULATIONS-001 and TD-103-007/008/010. Suppressed notifications remain in MT-79-006 as already defined.

**Structural exclusions are metric-specific.** MT-79-003 uses the authorized active snapshot population and retains never-synced eligible connections. MT-79-008 counts available recipient instances only. MT-79-009/010 share completed-plus-failed accepted requests and exclude verification attempts, pending work and valid cancellations/restorations; the Approved lifecycle measurement contract defines the exact boundaries.

**A zero denominator is reported as `no eligible population`.**

## 8. What this package could not settle

| ID | Item | Effect |
| --- | --- | --- |
| ~~`OQ-79-001`~~ | ~~The two barred signals need an `AN-92-006` disposition or an amendment to the criterion.~~ **Closed September 5, 2026: neither.** Denied cross-space access and support incidents are **barred for the Private MVP phase**, and whether they should be goes to `SRV-94-010`, the independent public-launch security review, whose scope covers evidence gaps and residual decisions. Amending `AN-92-006` would change the source of four cross-cutting hard gates and reopen the approved CBD-102 catalog and CBD-108 selections; amending the criterion would delete a safety signal rather than defer it | Closed. **`CBD-79-AC04` is partially met and closes that way** — two of four signals measured, two named and routed. §4.2 carries the reasoning |
| ~~`OQ-79-002`~~ | **Definition disposition approved by `CBD13-CORRECTNESS-001`.** Incorrect-alert assessment uses synthetic QA against approved alert rules (§3), separate from production metrics and customer/support data | No new metric or executed QA is claimed. QA assignment, fixtures, execution and independent evidence remain future |
| `OQ-79-003` | **Closure-stage disposition approved by `CBD81-BOUNDS-001`; numeric values remain unset.** Freshness/lateness classification bounds require evidence-based selection and Executive approval | Rates unavailable with no baseline start/credit or healthy claim until bound/source/release gates pass; D14 then starts on valid comparable releasable rates. Duration baseline may proceed after interval/terminal/source/bucket/release gates; no compliance/near-breach claim without commitments. Metrics remain applicable beta requirements, not deferred |
| `OI-79-001` | **`acknowledged` and `dismissed` are answered by reference to CBD-78**, not redefined. §2 states why: two metrics for one quantity is what the conventions boundary exists to prevent, and CBD-78's carry the `AB-74-014` constraint | Means `CBD-79-AC03` cannot be read alone. A reader checking this package for five alert-quality states finds two, four, and a citation |
| `OI-79-002` | **Ten metrics propose ten measurement sources and none exists.** CBD-80 assigns the `MS-80-nnn` identifiers | No metric is computable until CBD-80 completes |
| `OI-79-003` | **Nothing here has been measured**, and neither the product nor its provider connections exist. Every `Data source` names where telemetry will live | The metrics are specifications, not results |

## Approved lifecycle measurement contract

The exact semantics below are approved by `CBD13-LIFECYCLE-001`. They define logical operational predicates, not new runtime collection, retention, released dimensions or customer access. Physical bindings, authorized timestamp availability, safe buckets and runtime evidence remain future. No historical feasibility follows from naming a source; no audit-purpose reuse or measurement history is authorized.

### Freshness snapshot

At observation T (daily window close), eligibility means currently authorized and active for synchronization. Exclude orphaned, revoked, disconnected and lifecycle-stopped connections. For an eligible connection with a last committed successful sync watermark, freshness age is T minus that watermark. Failed or superseded runs do not advance it. A never-synced eligible connection remains in the denominator, cannot be fresh, and has missing age, never zero. Do not silently drop it from the rate because it cannot enter an elapsed-age bucket. The classification bound and its comparison rule must be approved before classifying fresh; no numeric value or extra released missing-age label is established here. Sources: `TD-103-010`; `SA-92-001`; CBD-72 §6.5.

### End-to-end alert interval

Start at the durable source revision first satisfying the applicable approved alert rule; settlement is required only where that rule requires it. End when the mandatory recipient instance becomes available through the authorized in-app surface. The interval includes rule evaluation and fan-out delay. Viewing, acknowledgement, external sends and quiet-hour expiry are not endpoints. Count each recipient instance once when it becomes available in the window; the numerator uses those same delivered instances. Still-unavailable and failed instances are excluded, so this rate cannot prove absence of dropped alerts. Sources: CBD-74 §4.1 and §5.3; `AB-74-002` / `AB-74-003` / `AB-74-012`.

### Accepted request and success predicates

The lifecycle population covers export, archival, budget-space deletion and personal-account deletion without adding a released breakdown. Start at the accepted eligible authorized request after required verification/confirmation. Rejected requests and verification attempts are excluded; queue delay after acceptance is included. For inactivity archival, bind acceptance only after the approved objection conditions are satisfied, not at proposal time. Exact acceptance/terminal-state bindings require source-owner proof.

| Operation | Completed only when evidenced | Authority and remaining binding |
| --- | --- | --- |
| Export | The correctly scoped, recipient-bound protected package is ready for authorized retrieval; download and expiry are not completion endpoints | CBD-72 permissions 20a/20b/21 and §5.7/§5.8; `INC-76-005` / `INC-76-009`; `FU-95-016` remains an execution gate |
| Archival | The archived state and its restrictions are atomically committed; archival erases nothing | CBD-72 §6.5; `INC-76-010`; inactivity archival follows §6.3 objection conditions |
| Budget-space deletion | After the restoration window, the defined financial payload, planning/reconciliation history, interactions and imports are irreversibly purged to the minimal nonfinancial tombstone | CBD-72 §6.4; `INC-76-010`; approved per-class/custodian schedule and `FU-95-014` proof required. Valid cancellation restores archived-without-pending-deletion |
| Personal-account deletion | After the restoration window, irreversible account/profile termination and approved private-data/shared-history dispositions are applied; necessary shared facts are pseudonymized and the minimal non-resurrection ledger remains | `PA-92-003` through `PA-92-008`; `INC-76-013`; approved per-class/custodian schedule and `FU-95-022` proof required. Immediate authority shutdown is not completion; restoration does not resurrect authority |

Deletion completion is the evidenced application-controlled terminal disposition against the approved per-class/custodian schedule. Merely scheduling cleanup is insufficient. Processor and backup obligations remain separately tracked under their approved operational contracts; this metric endpoint does not certify their expiry or erasure of recipient-held copies. No new tracking, retention or remote-deletion promise is introduced. `FU-95-014` / `FU-95-022` execution and claim gates remain open.

### Outcome and population alignment

These are logical distinctions for derivation, not a new released outcome-label catalog:

| Outcome | Treatment |
| --- | --- |
| Completed | Evidenced applicable success predicate above; included in numerator and denominator |
| Failed | Approved terminal unsuccessful outcome; included only in denominator |
| Cancelled/restored | Valid source-authorized cancellation/restoration is neither success nor failure and is excluded from both metrics; do not invent cancellation where the source contract provides none |
| Pending | Retrying, restoration grace and pending cleanup are not terminal outcomes; unfinished requests are excluded, never treated as completed or failed |

Completion rate is completed / (completed + failed). The elapsed distribution uses the same completed-plus-failed terminal population and measures acceptance to terminal outcome, not success-only time. Count each accepted request once at its terminal transition in the window, regardless of acceptance week. Repeated attempts and joined records do not multiply it. Unfinished requests are excluded and cannot imply success or absence of failures. Excluded populations and lifecycle subtypes are not separately released; existing suppression and purpose-separation rules continue to govern.

### Later-bound specification disposition

`CBD81-BOUNDS-001` permits specification closure with freshness/lateness classification bounds explicitly unset pending evidence-based selection and Executive approval. This is a closure-stage exception, not a Private MVP applicability deferral. MT-79-003/008 remain applicable beta evidence requirements but unavailable until classification bounds and source/release prerequisites are approved and verified: no rate, healthy status, numerical release, baseline start or credit. D14 starts only when valid comparable releasable rates can be observed.

MT-79-010 may establish its duration baseline only after interval, terminal-state, source, bucket and release prerequisites pass. No SLA/compliance or near-breach claim is permitted without approved lifecycle-specific commitments and actionable approach rules. No numeric value is chosen; restoration grace, export expiry and backup expiry are not performance SLOs. Metric/source IDs, owners, destinations and approved baseline periods remain unchanged. Applicable beta evaluation still requires these metrics; no expansion or successful evaluation exit without required evidence. Missing evidence follows the approved dated continuation/pause process in CBD-81.

## Lifecycle amendment record

| Version | Authority | Change | Status |
| --- | --- | --- | --- |
| 0.4 | `CBD13-LIFECYCLE-001`; `CBD81-BOUNDS-001`; `CBD13-CORRECTNESS-001` | Freshness snapshot; end-to-end alert lateness; accepted lifecycle start, both deletion scopes and source-specific application-controlled endpoints; matching completed-plus-failed rate/elapsed populations; synthetic correctness QA and explicit later-bound closure exception | Candidate; independent review pending. Existing approvals preserved; no measurement or executed QA claimed |

## Approved synchronization terminal-day populations

`CBD13-SYNC-POPULATIONS-001` supplies the measurement choices below. `TD-103-007` supplies current-state execution authority and duplicate/reordered-effect convergence; `TD-103-008` bounded attempts, backoff and terminal outcomes; `TD-103-010` committed watermark and recovery behavior. Those operational contracts do not independently authorize a new metric population. `SA-92-001` and `AN-92-003` / `AN-92-005` / `AN-92-006` preserve authority and purpose/privacy boundaries.

R(D) is the set of distinct operational sync runs with a first Worker attempt and an evidenced terminal transition in UTC day D = [00:00, next 00:00). Bounded retries belong to one run. Never-attempted queued work is excluded. S(D) is the subset of R(D) terminally cancelled because superseded, evidenced by the operational contract, never inferred from a later run.

| Metric | Population and derivation |
| --- | --- |
| MT-79-001 | Successful runs in R(D) minus S(D), divided by count(R(D) minus S(D)); the explicit supersession exclusion applies only here |
| MT-79-002 | Duration distribution over all R(D), including cancellations/supersession: terminal timestamp minus first Worker-attempt timestamp, including retry/backoff; time to terminal outcome, not success-only latency |
| MT-79-004 | Runs in R(D) consuming at least one retry divided by count(R(D)); one count per run even with multiple retries, including subsequently cancelled/superseded work |
| MT-79-005 | Terminal technical failures in R(D) divided by count(R(D)); safe failure-class distribution covers only the failed subset; valid cancellations remain in the denominator and are not failures |

Cancellation is never success or relabeled failure. Other approved cancellations remain unless an explicit metric exclusion exists. MT-79-001/005 are not complements. Unknown outcome or operational-identity mappings block computation, never imply success/failure. MT-79-003 remains the separately approved authorized active-connection snapshot and is unchanged.

A run first attempted Monday 23:58, retried Tuesday 00:02 and terminal Tuesday 00:05 contributes once on Tuesday with seven-minute duration, and nothing on Monday. Exact midnight belongs to the new day. Pending work receives no terminal credit and cannot imply success. Duplicate delivery adds no contribution. Postterminal replay requires an approved operational identity rule; no retained measurement membership is introduced to resolve it.

Physical run identity, first-attempt/terminal timestamps, retry count, terminal and supersession mappings, approved safe buckets and release controls require implementation evidence. Preserve closed release schemas: no new cancellation-reason labels, identifiers, per-run timing releases, tracking or retained measurement history. Existing owners, source consumers, destinations and baseline periods remain; no numerical release or runtime feasibility is claimed.

## Final source-correction amendment record

| Version | Authority | Change | Status |
| --- | --- | --- | --- |
| 0.5 | `CBD13-INVITATION-SENT-001`; `CBD13-SYNC-POPULATIONS-001` | Sent projection/synthetic-validation clarification and metric-specific terminal-day synchronization populations, with corresponding shared source derivations; all unrelated decisions preserved | Candidate; independent review pending; no runtime or executed-QA claim |

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
merges and verification. Confluence remains unpublished with no verified target;
future target registration/publication readiness is separately gated.
