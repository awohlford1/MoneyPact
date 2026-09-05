# CBD-79 — Reliability and Safety Metrics

| Field | Value |
| --- | --- |
| Status | **Draft v0.1 — not approved.** Defines ten reliability metrics, mostly `AN-92-003` reliability telemetry. **Two criteria are not satisfied and say so**: `CBD-79-AC04`'s safety measures are blocked on `OQ-13-007`, and `CBD-79-AC03`'s `incorrect` limb has **no measurable referent** — §3 establishes that no approved source defines an alert as incorrect, and correctness is a judgment rather than a state. §7 adds the operational response `CBD-79-AC06` requires, which the conventions record shape does not carry |
| Document version | 0.1 |
| Owner | Alexander Wohlford |
| Jira | [CBD-79](https://cobudget.atlassian.net/browse/CBD-79) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Governing measurement contract | CBD-92 `AN-92-001`–`AN-92-007`, approved |
| Governing alert model | `docs/cbd-74-accountability-alert-boundary-specification.md` — Document version **1.0.1**, approved |
| Governing schedule decisions | `docs/cbd-71-mvp-schedule-decision-register.md` — Document version **1.1**, approved |
| Consuming packages | CBD-80 (measurement-source register); CBD-81 (targets and review) |
| Confluence page | **Not published.** Registration follows approval |
| Last updated | September 5, 2026 |

## 1. Purpose and authority

CBD-79 defines how the private beta knows whether the product is working. It defines ten metrics, the operational response for each, and two things it could not define.

**Most metrics here are `reliability-telemetry`, not `aggregate-state`**, and the distinction matters: `AN-92-003` permits an explicit S1 allowlist — service and version, coarse operation class, safe outcome class, duration bucket, aggregate health count — and **nothing carrying a subject, space, resource, account, connection or destination.** A reliability metric that needs one of those is not a reliability metric.

`AN-92-006` keeps the streams separate: reliability, security, support, audit and aggregate-measurement schemas, stores, access roles and retention stay distinct, and an identifier collected for one purpose is never reused for another. **That rule is why `CBD-79-AC04` is unsatisfied** (§4).

## 2. Boundary with CBD-78

`CBD-79-AC03` names `acknowledged` and `dismissed` among the alert-quality states. **`CBD-78-AC06` already owns both**, at `MT-78-007` and `MT-78-008`.

**This package does not redefine them.** Two metrics for one quantity is the defect the conventions §10 boundary exists to prevent, and CBD-78's versions carry the `AB-74-014` release constraint that any redefinition here would have to restate and could drift from. `CBD-79-AC03` is answered for those two states **by reference**, and this package defines only the states CBD-78 does not.

## 3. `incorrect` has no measurable referent

`CBD-79-AC03` requires alert quality to distinguish `duplicate`, `late`, `incorrect`, `acknowledged`, and `dismissed`. Four of those are states the system holds. **`incorrect` is not.**

**No approved source defines an alert as incorrect.** The word appears nowhere in the CBD-74 alert boundary specification. What CBD-74 does define is a **closed built-in category set** (`AB-74-001`) with fixed thresholds, system-owned cooldown and deduplication, and content derived from settled facts — so an alert that fires is, by construction, an alert whose trigger condition held.

**Correctness is a judgment about whether the alert was useful, and that is not a state.** Three routes were considered and none works:

| Route | Why not |
| --- | --- |
| Infer from behaviour — treat dismissal without action as incorrect | A behavioural inference about an individual, which `AN-92-001` disables and `AB-74-014` prohibits reading |
| Collect a human report | Support data under `DI-91-*`, governed by `OP-92-002`, which bars the routine support surface from disclosing counts and keeps ticket text separately access-controlled. It is not measurement, and `AN-92-006` bars joining it to one |
| Define a correctness rule in the product | Would make the product judge its own alerts, and `AB-74-001` fixes the catalog so there is no rule to vary |

**So `MT-79-007` measures `duplicate` and `MT-79-008` measures `late`. `incorrect` is recorded as unmeasurable at `OQ-79-002`.** It is a real gap in an approved criterion, not an omission in this package, and the honest options are to amend the criterion or to accept that alert correctness is assessed by reading alerts rather than by counting them.

## 4. `CBD-79-AC04` is blocked, not deferred

The criterion requires safety measures covering **denied cross-space access, consent changes, revocation failures, and related support incidents.**

Every one of those signals is `AN-92-004` **restricted security telemetry at S3**, held under `DI-91-053`, `DI-91-062` and `DI-91-071`, and `AN-92-004` says it *"remains S3 restricted security evidence… never product analytics."* `AN-92-006` adds that an event collected for one purpose *"cannot be joined, enriched, exported, sold, shared, or reused for another."*

**Computing a safety metric from that evidence is a second purpose for it.** Whether that is the reuse `AN-92-006` prohibits is `OQ-13-007`, raised at the CBD-368 approval review and unanswered.

**No metric is defined for this criterion**, and that is deliberate rather than incomplete. Defining metrics against a source that may be prohibited would either be wasted or, worse, would look authoritative and get built. The two honest routes are:

1. **A separate operational source.** Denied access and revocation failures could be counted from the authorization layer's own operational state rather than from the security-evidence store — a different source for the same fact, which `AN-92-006` does not bar because nothing is reused.
2. **An explicit `AN-92-006` disposition** permitting aggregate measurement over security evidence under stated conditions, which is a CBD-92 amendment.

Route 1 is available without an amendment and is probably right. **This package does not take it**, because choosing between them decides what the safety measures *are*, and `CBD-79-AC06` requires each to carry an operational response — which cannot be written before the measure exists.

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
| Formula | successful_sync_runs ÷ attempted_sync_runs |
| Numerator | Sync runs reaching a success outcome class |
| Denominator | Sync runs attempted in the window, excluding runs cancelled by a superseding run — `SD-071-*` makes a stale run's cancellation correct behaviour, not a failure |
| Measurement source | `sync_run.outcome_class_count` *(proposed)* |
| Interval basis | Opens when a sync run starts; closes when it reaches a terminal outcome class |
| Window | Calendar day, UTC |
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
| Formula | p50 and p90 of sync run duration, in seconds |
| Numerator | `n/a` — a distribution, not a rate |
| Denominator | `n/a` — the measured population is the numerator population |
| Measurement source | `sync_run.duration_bucket_count` *(proposed)* |
| Interval basis | Opens when a sync run starts; closes at its terminal outcome |
| Window | Calendar day, UTC |
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
| Formula | share of connections whose last successful sync falls inside the freshness bound |
| Numerator | Connections with a successful sync inside the bound |
| Denominator | Connections in an active state at window close, excluding orphaned connections, which `INC-76-011` makes permanently read-only and never synchronized again |
| Measurement source | `connection.freshness_bucket_count` *(proposed)* |
| Interval basis | Opens when a connection becomes active; closes when its last successful sync leaves the freshness bound |
| Window | Calendar day, UTC |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `CONN-REQUIRED` |
| Data source | Worker job telemetry, bucketed. **No connection identifier reaches the aggregate** |
| Collection method | Scheduled aggregate in the Worker over freshness buckets |
| Review cadence | Daily *(CBD-81 confirms)* |
| Unhealthy condition | A growing share sits outside the bound while `MT-79-001` looks healthy, which means runs succeed without refreshing |
| **Operational response** | Compare against `MT-79-005`. A stale-but-succeeding population points at cursor handling, so inspect the sync cursor logic rather than the connection |

### MT-79-004 — Synchronization retry rate

| Field | Value |
| --- | --- |
| Class | `reliability-telemetry` |
| Owner | `synchronization` |
| Purpose | Whether the system is working harder for the same result. Retries are invisible in a success rate and expensive in provider cost |
| Formula | retried_sync_runs ÷ attempted_sync_runs |
| Numerator | Sync runs that consumed at least one retry attempt |
| Denominator | Sync runs attempted in the window |
| Measurement source | `sync_run.retry_bucket_count` *(proposed)* |
| Interval basis | Opens when a sync run starts; closes at its terminal outcome, with retry count as a bucket |
| Window | Calendar day, UTC |
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
| Formula | terminal_failures ÷ attempted_sync_runs, and the distribution across safe error classes |
| Numerator | Sync runs reaching a terminal failure state, by safe error class |
| Denominator | Sync runs attempted in the window |
| Measurement source | `sync_run.terminal_failure_class_count` *(proposed)* |
| Interval basis | Opens when a sync run starts; closes when it reaches a terminal failure state |
| Window | Calendar day, UTC |
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
| Numerator | In-app instances whose creation-to-availability interval exceeds the bound |
| Denominator | In-app instances delivered in the window |
| Measurement source | `alert_instance.delivery_latency_bucket_count` *(proposed)* |
| Interval basis | Opens when the source fact settles; closes when the instance is available to its recipient |
| Window | Calendar day, UTC |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Worker alert telemetry, bucketed |
| Collection method | Scheduled aggregate in the Worker |
| Review cadence | Daily *(CBD-81 confirms)* |
| Unhealthy condition | The rate rises, or the bound is crossed by a growing share while `MT-79-006` reports delivery as healthy |
| **Operational response** | Check scheduler tick delivery and queue depth. `TD-103-002` makes the scheduler a managed trigger, so a missed tick is a provider question and a slow worker is a capacity one; the two need opposite responses |

### MT-79-009 — Export and deletion completion rate

| Field | Value |
| --- | --- |
| Class | `aggregate-state` |
| Owner | `security` |
| Purpose | Whether export and deletion requests complete. `INC-76-005`, `INC-76-009` and `INC-76-010` all promise an outcome, and a request that never completes is a broken promise rather than a slow one |
| Formula | completed_requests ÷ requests_reaching_a_terminal_state |
| Numerator | Requests in a completed state, across export, deletion and archival |
| Denominator | Requests reaching any terminal state — completed or failed. **Requests still in verification are excluded**, because identity reverification is a step the customer holds and elapsed time there is not a product failure |
| Measurement source | `data_request.terminal_state_count` *(proposed)* |
| Interval basis | Opens when a request is created; closes at a terminal state |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold`. **This will withhold for most of the beta**, and that is correct: request volume is low and each request belongs to one identifiable person |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, request table. **Counts only; no request, subject or space identifier reaches the aggregate** |
| Collection method | Scheduled aggregate in the Worker |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Any failed terminal state at all. This is not a rate to optimise — one failure is a finding |
| **Operational response** | Investigate the individual request through the authorized operational path, not through this metric. **The metric says a failure happened; it deliberately cannot say which**, and finding out is an `OP-92-003` exceptional-purpose action |

### MT-79-010 — Export and deletion elapsed time

| Field | Value |
| --- | --- |
| Class | `aggregate-state` |
| Owner | `security` |
| Purpose | Whether requests complete within the window `INC-76-010` promises — the 30-day restore window makes elapsed time a commitment rather than a preference |
| Formula | p50 and p90 of (terminal state reached at − request created at), in hours |
| Numerator | `n/a` — a distribution, not a rate |
| Denominator | `n/a` — the measured population is the numerator population |
| Measurement source | `data_request.elapsed_bucket_count` *(proposed)* |
| Interval basis | Opens when a request is created; closes at a terminal state |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold`, at a higher population than the rate metrics because a percentile over few requests describes individuals |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, bucketed |
| Collection method | Scheduled aggregate in the Worker |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | p90 approaches any committed window. **Approaching is the condition, not exceeding** — a commitment measured only on breach is measured too late |
| **Operational response** | Raise the request path's priority in the worker queue before the commitment is missed, and record the near-miss in the release review |

## 7. Denominator rules

Per conventions §6.

**Runs and requests, not people.** Most denominators here count operations, which reach releasable volume faster than any population metric and are why reliability can be reviewed daily while engagement cannot.

**Correct behaviour stays in the denominator.** `suppressed` notifications and cancelled superseded sync runs are correct outcomes; removing them would flatter every rate and hide a misconfiguration.

**Structural exclusions are stated.** Orphaned connections leave `MT-79-003` because `INC-76-011` makes them permanently unsynchronized; requests in verification leave `MT-79-009` because the customer holds that step.

**A zero denominator is reported as `no eligible population`.**

## 8. What this package could not settle

| ID | Item | Effect |
| --- | --- | --- |
| `OQ-79-001` | **`CBD-79-AC04` is blocked on `OQ-13-007`.** Denied cross-space access, consent changes and revocation failures are `AN-92-004` restricted security telemetry at S3, and `AN-92-006` bars reuse across purposes. §4 states the two honest routes: a separate operational source, which needs no amendment, or an explicit `AN-92-006` disposition, which does | **No safety metric is defined.** The criterion is not met and this package does not pretend otherwise. Choosing the route decides what the measures are, and `AC06` requires each to carry a response that cannot be written first |
| `OQ-79-002` | **`incorrect` has no measurable referent.** It appears nowhere in the approved CBD-74 specification, and §3 rejects all three routes to measuring it: behavioural inference is disabled by `AN-92-001`, human reports are support data `AN-92-006` bars joining, and a product-side correctness rule contradicts `AB-74-001`'s closed catalog | **`CBD-79-AC03` is met for four of five states.** The criterion needs amendment, or acceptance that alert correctness is assessed by reading alerts rather than counting them. A gap in an approved criterion, not an omission here |
| `OQ-79-003` | **Three bounds are named and none is a number**: the freshness bound (`MT-79-003`), the lateness bound (`MT-79-008`), and the committed windows (`MT-79-010`). Conventions §10 gives CBD-81 the numbers | Every unhealthy condition here is qualitative by design, and none is actionable until CBD-81 supplies the bound |
| `OI-79-001` | **`acknowledged` and `dismissed` are answered by reference to CBD-78**, not redefined. §2 states why: two metrics for one quantity is what the conventions boundary exists to prevent, and CBD-78's carry the `AB-74-014` constraint | Means `CBD-79-AC03` cannot be read alone. A reader checking this package for five alert-quality states finds two, four, and a citation |
| `OI-79-002` | **Ten metrics propose ten measurement sources and none exists.** CBD-80 assigns the `MS-80-nnn` identifiers | No metric is computable until CBD-80 completes |
| `OI-79-003` | **Nothing here has been measured**, and neither the product nor its provider connections exist. Every `Data source` names where telemetry will live | The metrics are specifications, not results |
