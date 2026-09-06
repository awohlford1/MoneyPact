# CBD-80 — Measurement Source Register and Privacy Rules

| Field | Value |
| --- | --- |
| Status | **Accepted specification v1.7** under CBD13-FINAL-ACCEPTANCE-001, with all recorded decisions and exceptions preserved. CBD13-FINAL-REVIEW-002 approves the integrated package and closes both prior findings; CBD13-FINAL-SECURITY-002 clears specification privacy only. No runtime measurement, numerical reporting, beta launch, deployment or Jira Done claimed |
| Document version | 1.7 |
| Owner | Alexander Wohlford |
| Reviewer | Independent CBD13-FINAL-REVIEW-002: approve; CBD13-FINAL-SECURITY-002: clear for specification privacy acceptance |
| Jira | [CBD-80](https://cobudget.atlassian.net/browse/CBD-80) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Governing measurement contract | CBD-92 `AN-92-001`–`AN-92-007`, approved |
| Governing operational contract | CBD-92 `OP-92-001`–`OP-92-008`, approved |
| Governing data inventory | `docs/cbd-91-private-mvp-data-inventory.md`, approved — `DI-91-042`, `EG-91-019` |
| Consuming packages | CBD-81 (targets and review process) |
| Confluence page | **Unpublished to Confluence.** No verified target; future registration/publication readiness separately gated |
| Last updated | September 5, 2026 |

## 1. Purpose and authority

CBD-80 assigns every measurement source a stable identifier and fixes the rules that govern all of them. It defines no metric — CBD-77, CBD-78 and CBD-79 do — and sets no target, which is CBD-81's.

**The register is the point where three concurrent packages become one vocabulary.** The conventions §3 gave those packages the right to *propose* a source name and gave this document the right to accept, rename, or merge. §4 records every decision of that kind rather than silently applying it, because a rename that is not recorded is a rename that breaks a citation.

## 2. What a measurement source is

**A named piece of operational state that already exists as a system of record, together with the rule for deriving a count from it.** It is not an event, nothing is emitted, and nothing is retained for measurement that the product does not already hold for its own operation.

`AN-92-001` disables the behavioural event pipeline for Private MVP, so there is no event catalog here and no `AE-80-nnn` identifier. The v0.1 conventions proposed both and were re-architected on September 5, 2026; conventions §11 records the nine criteria amended in consequence, two of which are this package's own.

### Required attributes

`CBD-80-AC01`, as amended. Every row in §5 carries all six:

| Attribute | Meaning |
| --- | --- |
| **Name** | The dotted state predicate, lowercase domain and snake_case, per conventions §3 |
| **State of record** | The operational data the derivation reads. **Not a table name** — the product is not built, so this names the state, and the schema will name the table |
| **Derivation** | How a count is produced from that state, stated so that two people would compute the same figure |
| **Refresh basis** | When the aggregate is recomputed |
| **Boundary** | `worker` for every source, per conventions decision 3 |
| **Owning metric** | The `MT-` identifiers that read it. A source no metric reads is not registered |

## 3. Privacy rules

These govern every source in §5 and are stated once.

### 3.1 Prohibited content — `CBD-80-AC03`

Never enters a source, a derivation, an aggregate, or a metric label:

* raw transaction values
* credentials
* provider tokens
* bank-account numbers
* sensitive transaction descriptions
* free text of any kind

### 3.2 Identifiers — `CBD-80-AC04`

**No identifier reaches a measurement surface at all**, which is stronger than minimization and is what the contracts require rather than a choice this document makes.

`AN-92-003` bars subject, space, resource, account, connection, destination and device references from reliability telemetry. `AN-92-005` bars persisting contributing customer-level records for aggregate state. **Between them, nothing identifying survives into a released figure**, pseudonymous or not — and `AN-92-002` states that pseudonymization does not make a prohibited mechanism permitted.

**Budget-space access rules are respected trivially, because no aggregate is scoped to a space.** A cross-space disclosure needs a space-scoped figure to disclose, and §6 releases only whole-population figures. `SG-93-022` adds that counterparty display names are third-party personal data and are never used in analytics; no source here reads them.

### 3.3 Purpose separation — `AN-92-006`

Reliability, security, support, audit and aggregate-measurement schemas, stores, access roles and retention stay distinct, and an identifier collected for one purpose is never joined or reused for another.

**Two consequences this register enforces:**

1. **No source reads a security-evidence store.** `AN-92-004` keeps restricted security telemetry single-purpose, and this is why CBD-79 defines no safety metric and why `OQ-13-007` is open. **The classes are `DI-91-053` and `DI-91-062`.** `AN-92-004` names a third, `DI-91-071`, and the approved inventory classifies it **S1** — *"Non-secret service/key version, rotation, and lifecycle metadata"* — which is not security evidence and not restricted. `OQ-80-004` records the discrepancy between the two approved documents.
2. **No source joins across streams.** A `reliability-telemetry` source and an `aggregate-state` source are never combined into one figure, because the join would give the reliability stream a purpose it was not collected for.

### 3.4 Retention, access, export and deletion — `CBD-80-AC05`

| Question | Rule |
| --- | --- |
| **What is retained** | The released aggregate only — a figure, its window, and its metric identifier. **No contributing record, no intermediate set, no drill-down**, per `AN-92-005` |
| **For how long** | Retained for the beta and its review, then deleted with the beta's operational records. A figure describing a population that no longer exists supports no decision |
| **Who may read it** | §6 |
| **Export** | An aggregate may be quoted in a decision record. **A figure withheld under suppression is never exported**, including into a document that reports it as zero |
| **Deletion** | A customer's deletion request under `INC-76-010` reaches no measurement store, because none holds anything about them. **This is a property of the design rather than a process**, and it is the strongest argument for the whole re-architecture |
| **Consent** | **None is recorded, and none can do the work.** `AN-92-002` states that consent does not make a prohibited mechanism permitted, so a consent basis here would imply the collection needed one and that refusing would stop it. Neither is true: nothing customer-identifying is collected |

## 4. Naming decisions

The conventions §3 give this register the right to accept, rename or merge a proposed name, and require every rename to be recorded.

**Thirty-one names are accepted as proposed.** Three decisions were made, all at v1.0; the three sources added at v1.1 were accepted unchanged:

| Decision | Proposed | Registered | Why |
| --- | --- | --- | --- |
| **Merged** | `account_subject.window_active_count` and `account_subject.window_pair_active_count`, proposed separately by `MT-78-005` and `MT-78-006` | **One deferred source slot**, `MS-80-017` | Both retention metrics preserve the same intended derivation and differ only in window B; `CBD13-RETENTION-001` defers computation pending approved historical-source proof. Two sources would let one drift from the other, and `RT-78-001` requires the same `AD-78-001` in both |
| **Renamed** | `transaction.classified_count` and `transaction.space_manual_classified_count` | `MS-80-024` and `MS-80-025`, names unchanged but **derivations explicitly distinguished** | The names are close enough to be confused. `MS-80-024` counts every classified transaction; `MS-80-025` counts only manually entered ones, and only at the space level. §5 states both derivations in full so the distinction survives the similarity |
| **Rejected** | `budget_space.usable_interval` as a distinct source from `budget_space.usable_state_count` | **Kept separate** as `MS-80-007` and `MS-80-005` | Considered merging, because both read the five `UB-77-001` limbs. Rejected: the interval needs proof of first simultaneous satisfaction and is deferred under `CBD13-USABLE-TIME-001`; the current-state count needs a boolean and remains applicable, and merging them would put a timestamp set in a source whose only consumer wants a count |

## 5. The register

Every source has `Boundary: worker`. Class is `aggregate-state` unless marked `reliability-telemetry`.

| ID | Name | State of record | Derivation | Refresh | Owning metric |
| --- | --- | --- | --- | --- | --- |
| `MS-80-001` | `account_subject.active_count` | Account subjects | Count distinct subjects existing immediately before C with creation strictly before C minus 24 hours; exactly at the cutoff is excluded | Weekly | `MT-77-001` |
| `MS-80-002` | `budget_space.subject_has_space_count` | Budget spaces, account subjects | Count only subjects eligible under MS-80-001 that hold an extant associated space in any state immediately before C; archived-only success counts, deleted absent spaces do not | Weekly | `MT-77-001` |
| `MS-80-003` | `budget_space.created_count` | Budget spaces | Count distinct extant spaces created O <= creation < C and not archived immediately before C | Weekly | `MT-77-002`, `MT-77-003` |
| `MS-80-004` | `budget_period.space_has_period_count` | Budget periods, budget spaces | Broad derivation: count distinct extant nonarchived spaces holding a materialized period per `SD-071-021` immediately before C, regardless of creation week, for MT-77-006/007. MT-77-002 instead counts only the intersection of that population with MS-80-003 eligibility; these are separate consumer-specific counts, not one interchangeable scalar | Weekly | `MT-77-002`, `MT-77-006`, `MT-77-007` |
| `MS-80-005` | `budget_space.usable_state_count` | Five `UB-77-001` limbs; approved profile/category predicates in CBD-77 §3 | Count only spaces eligible under MS-80-003 where all five limbs hold **simultaneously immediately before C**, evaluated together rather than accumulated. Apply `CBD13-PROFILE-001` / `CBD13-CATEGORY-001` exactly; physical binding and verification remain future | Weekly | `MT-77-003` |
| `MS-80-006` | `budget_period.first_materialized_interval` | Budget periods, budget spaces | Duration buckets of (first period materialized − space created), for spaces reaching a period in the window | Weekly | `MT-77-004` |
| `MS-80-007` | `budget_space.usable_interval` | Future approved operational-source contract for first simultaneous `UB-77-001` satisfaction | **Deferred/unavailable for Private MVP** under `CBD13-USABLE-TIME-001`. Preserve duration from space creation to first simultaneous satisfaction for future applicability; prove coexistence under replacement/deletion/period changes. No maximum current timestamps, `updated_at`, budget date or newly retained measurement history; no baseline credit or successful timing claim | Weekly | `MT-77-005` |
| `MS-80-008` | `financial_account.space_manual_count` | Financial accounts, budget periods, budget spaces | Count only spaces in the broad MS-80-004 period-holding population that hold at least one currently linked manual account immediately before C; periodless account-bearing spaces do not count | Weekly | `MT-77-006` |
| `MS-80-009` | `transaction.space_manual_classified_count` | Transactions | Count of spaces holding at least one **manually entered** transaction classified into a period | Weekly | `MT-77-007` |
| `MS-80-010` | `category.space_has_category_count` | Qualifying category identity, ownership and current usability per CBD-77 §3 | Count distinct extant nonarchived spaces with at least one qualifying Category-limb entity in `UB-77-001` immediately before C; `CBD13-CATEGORY-001` applies, without requiring spending or a target | Weekly | `MT-77-008` |
| `MS-80-011` | `category_target.space_has_target_count` | Current-period targets associated with the same qualifying category set as MS-80-010 | Count only MS-80-010-eligible spaces with a current-period target on a category in that same qualifying set. Explicitly stored zero and approved transition-prorated targets qualify; missing target does not, per `CBD13-CATEGORY-001` / `SD-071-027` | Weekly | `MT-77-008` |
| `MS-80-012` | `transaction.classified_count` | Transactions | Count of **all** transactions holding a period classification per `SD-071-035` | Weekly | `MT-78-001` |
| `MS-80-013` | `transaction.eligible_count` | Transactions, budget periods | Count of transactions whose reliable date falls inside a materialized period. Excludes dates preceding the space's first period | Weekly | `MT-78-001` |
| `MS-80-014` | `invitation.terminal_state_count` | Invitations | Count per terminal state — `accepted`, `expired`, `revoked`, `declined`. **`sent` is excluded**: it is not terminal. CBD13-INVITATION-SENT-001 covers sent only through the CBD-73 projection and synthetic validation below, not a production count or changed terminal population | Weekly | `MT-78-002`, `MT-78-003` |
| `MS-80-015` | `budget_space.multi_member_count` | Memberships at window close; historical eligibility proof remains future | **Deferred/unavailable for MT-78-004** under `CBD13-RETENTION-001`. Preserve intended count of multi-member spaces; current membership alone does not prove historical eligibility for the full four-class action predicate | Weekly | `MT-78-004` |
| `MS-80-016` | `collaboration.space_action_class_count` | Future approved operational-source contract proving actual four-class actions and occurrence times | **Deferred/unavailable for Private MVP** under `CBD13-RETENTION-001`. Intended count of multi-member spaces with actual `viewing`, `editing`, `acknowledgement`, `commenting` actions in the window, not action counts. Authorization records prove permission, not action; current comments do not prove the full predicate under mutation/deletion. No proxy substitution | Weekly | `MT-78-004` |
| `MS-80-017` | `account_subject.window_active_count` | Future approved operational-source contract proving historical `AD-78-001` evidence in windows A and B | **Deferred/unavailable for Private MVP** under `CBD13-RETENTION-001`. Preserve intended A-active count and A-and-B-active count for MT-78-005/006; one-pass calculation is not historical feasibility proof under mutation/deletion. No behavioral events, retained measurement membership, audit-purpose reuse or proxy substitution; no zero or successful retention claim | Weekly | `MT-78-005`, `MT-78-006` |
| `MS-80-018` | `alert_instance.firm_delivered_count` | Recipient instances | Count of **firm** in-app instances delivered per `AB-74-002`. Informational instances are excluded: `AB-74-009` gives them no acknowledgement operation | Weekly | `MT-78-007`, `MT-78-008` |
| `MS-80-019` | `alert_instance.firm_acknowledged_count` | Recipient instances | Count of firm instances in the acknowledged state. **Release constrained by `AB-74-014`** — §6 | Weekly | `MT-78-007` |
| `MS-80-020` | `alert_instance.firm_dismissed_count` | Recipient instances | Count of firm instances in the archived or dismissed state. **Release constrained by `AB-74-014`** — §6 | Weekly | `MT-78-008` |
| `MS-80-021` | `sync_run.outcome_class_count` — `reliability-telemetry` | Worker job telemetry | Consumer-specific Worker counts under R(D)/S(D) below: MT-79-001 uses success and denominator counts over R(D) minus S(D); MT-79-004/005 denominators use all R(D), including valid cancellations/supersession. Never reuse one supersession-filtered scalar for all consumers. No cancellation-as-success/failure or new released labels | Daily | `MT-79-001`, `MT-79-004`, `MT-79-005` |
| `MS-80-022` | `sync_run.duration_bucket_count` — `reliability-telemetry` | Worker job telemetry | Duration buckets over all R(D), including cancellations/supersession: terminal timestamp minus first Worker-attempt timestamp, including retries/backoff. **Buckets, not per-run timings**, per `AN-92-003`; terminal-day attribution | Daily | `MT-79-002` |
| `MS-80-023` | `connection.freshness_bucket_count` — `reliability-telemetry` | Authorized active-connection state and committed successful sync watermark; safe Worker telemetry binding remains future | Snapshot at T: count eligible connections currently authorized and active for sync, excluding orphaned, revoked, disconnected and lifecycle-stopped. Age = T minus last committed successful sync watermark; failed/superseded runs do not advance it. Never-synced eligible connections stay in denominator, cannot be fresh, missing age never zero. Classification bound/source/bucket/release gates required; no extra released label, rate, healthy claim or baseline start/credit before approval | Daily | `MT-79-003` |
| `MS-80-024` | `sync_run.retry_bucket_count` — `reliability-telemetry` | Worker job telemetry | Retry-count buckets over all R(D), including zero and subsequently cancelled/superseded runs; MT-79-004 numerator counts positive-retry runs once and denominator is all R(D), with terminal-day attribution | Daily | `MT-79-004` |
| `MS-80-025` | `sync_run.terminal_failure_class_count` — `reliability-telemetry` | Worker job telemetry | Safe failure-class counts for only terminal technical failures in R(D); MT-79-005 denominator comes from all R(D) in MS-80-021. Valid cancellations are not failures; MT-79-001/005 are not complements. **No provider message, payload, or identifier** | Daily | `MT-79-005` |
| `MS-80-026` | `notification.outcome_class_count` — `reliability-telemetry` | Worker delivery telemetry | Count per outcome class — `enqueued`, `delivered`, `failed`, `suppressed`, `duplicate`, `late`. **`suppressed` stays in the base** per `AB-74-004` | Daily | `MT-79-006` |
| `MS-80-027` | `alert_instance.dedup_outcome_count` — `reliability-telemetry` | Worker alert telemetry | Count of instance creation attempts per deduplication outcome | Daily | `MT-79-007` |
| `MS-80-028` | `alert_instance.delivery_latency_bucket_count` — `reliability-telemetry` | Durable source revision satisfying the applicable approved alert rule and mandatory recipient-instance authorized in-app availability; future approved Worker telemetry binding | End-to-end duration buckets from first rule satisfaction to authorized in-app availability; settlement only where the rule requires it, including evaluation/fan-out delay. Count each available instance once in the window; still-unavailable/failed excluded. Viewing, acknowledgement, external sends and quiet-hour expiry are not endpoints. Delivered-only rate cannot prove absence of dropped alerts. Bound/source/bucket/release gates required; no rate, healthy claim or baseline start/credit before approval | Daily | `MT-79-008` |
| `MS-80-029` | `data_request.terminal_state_count` | Accepted authorized verified export, archival, budget-space deletion and personal-account deletion requests; source-specific operational outcome bindings remain future | Count each accepted request once at its evidenced application-controlled terminal transition in the window: completed / (completed + failed), per the lifecycle contract below. Completed uses source-specific success; failed is an approved terminal unsuccessful outcome. Exclude rejected/verification attempts, pending/retrying/grace/cleanup and valid cancellation/restoration; do not invent cancellation. Processor/backup obligations separately tracked; no new released subtype/outcome labels | Weekly | `MT-79-009` |
| `MS-80-030` | `data_request.elapsed_bucket_count` | Same accepted lifecycle requests and completed-plus-failed terminal population as MS-80-029; authorized acceptance/terminal timestamps and safe bucket bindings remain future | Duration buckets from accepted eligible authorized request after verification/confirmation to evidenced source-specific completed or failed terminal outcome; queue delay included. Count once at the same terminal transition as MS-80-029, regardless of acceptance week; exclude pending and valid cancellation/restoration. Baseline only after interval/terminal/source/bucket/release gates; no SLA/compliance or near-breach claim without approved commitments and actionable approach rules | Weekly | `MT-79-010` |

| `MS-80-031` | `consent_record.subject_change_count` | Consent, disclosure and revocation evidence — `DI-91-007` | Count of account subjects whose consent record shows at least one version change in the window. **Version changes only; no disclosure text, scope or role** | Weekly | `MT-79-011` |
| `MS-80-032` | `consent_record.subject_active_count` | Consent, disclosure and revocation evidence — `DI-91-007` | Count of account subjects holding at least one active consent record at window close | Weekly | `MT-79-011` |
| `MS-80-033` | `revocation_run.outcome_class_count` — `reliability-telemetry` | Worker job telemetry | Count of revocation operations per terminal outcome class. **Whether the operation completed, never what it decided** — `AN-92-003` excludes a security-decision label by name | Daily | `MT-79-012` |
**33 sources for 34 proposals**, the difference being the retention merge at `MS-80-017`. Every `MT-` identifier in all three packages appears in the owning-metric column, and no source is registered that no metric reads.

**`MS-80-031` through `MS-80-033` were added at v1.1**, after the `OQ-13-007` decision of September 5, 2026 gave CBD-79 two safety metrics it had not been able to define. **The cross-package audit found them rather than a person did**: it failed on three unregistered proposals and two metrics no source served, which is what this register exists to catch and the reason its closure comment said reopening was predictable rather than a surprise.

## 6. The release surface — decided September 5, 2026

`OQ-13-006` and `OQ-80-001` are closed. **The 28 metrics do not share one answer**, and the v1.1 proposal treated them as though they did.

### The two destinations

| Class | Count | Destination |
| --- | --- | --- |
| `reliability-telemetry` | **9** | The **S1 reliability sink CBD-122 establishes**. Same purpose, so `AN-92-006` raises nothing — and `CBD-122-AC08` already emits terminal-state counts, which is the shape `MS-80-021` and `MS-80-025` produce |
| `aggregate-state` | **19** | A **periodic written record**, computed by the Worker on its refresh basis and consumed by CBD-81's review process |

**Nothing new is built for the reliability half.** `CBD-122-AC05` establishes three destinations with three access roles — reliability, restricted diagnostics, audit — and the reliability metrics belong in the first of them. The register had proposed a new surface for all 28 and missed that half the answer was already planned.

### Why the aggregate half is a record and not a surface

Nineteen figures reviewed weekly is a document, not a dashboard. The reasoning is not economy:

1. **There is no query interface, so there is no drill-down to grow one from.** A store with a read path can later be asked a question it was not built for; a written record cannot be asked anything.
2. **Retention is the record's own**, which §3.4 already governs, rather than a store's lifecycle that would need its own rule.
3. **`OP-92-001` is satisfied by construction.** No standing surface reads production, so no access role needs default-denying.

**What it costs is a trend view.** Comparing four weeks means reading four records, and `MT-78-005`'s and `MT-78-006`'s retention series are exactly the measures where a trend matters most. Accepted, and recorded at `OI-80-004` rather than discovered later.

### Where the record lives — decided September 5, 2026

**Not in this repository**, and that is a constraint rather than a preference. §3.4 requires released figures to be *"retained for the beta and its review, then deleted with the beta's operational records."* **A record committed here can never be deleted** — git history is permanent, and these documents publish to Confluence, which would carry the figures further still.

**The record lives in its own schema in the Cloud SQL instance CBD-108 selected**, with its own access role and its own retention.

| Property | How it is satisfied |
| --- | --- |
| **Deletable** | A schema is dropped. Deletion is bounded and immediate, which is what §3.4 requires and what version control cannot offer |
| **Separate** | `AN-92-006` requires *"reliability, security, support, audit and aggregate-measurement **schemas**, stores, access roles and retention"* to remain distinct. **It names schemas as the unit of separation**, so this is the shape the contract contemplates rather than a workaround around it |
| **No new exposure** | Cloud SQL is already in the approved composition and was assessed against `HG-102-013` at CBD-105. No new provider, no new subprocessor, no new gate |

**Object storage was the obvious answer and the corpus rules it out.** CBD-108 §4.38 records Google disclaiming any bound on lifecycle deletion timing — *"applications shouldn't rely on lifecycle actions occurring within a certain amount of time"* — and `OI-108-034` records that introducing object storage into any composition **reopens `HG-102-013`**, the one gate that could fail every candidate at once. A store whose deletion is unbounded cannot satisfy §3.4 either, so it fails twice over.

**What this decision does not do.** It names a store, not a schema design. The table shape, the access role's exact grants, and the drop procedure at beta end are build work, and `OQ-80-007` records that the drop must be a stated step rather than an assumption — a schema nobody drops is a schema retained forever, and §3.4 would then be satisfied on paper only.

### Who may read it

**The Product Owner**, as the only role `EX-102-001` permits to accept a residual and the only role CBD-81 assigns metric ownership to. For a solo project that is the whole answer; the record should not be shaped so that a second reader would require rebuilding it.

**`MS-80-019` and `MS-80-020` carry a further constraint on top**, from CBD-78 §6: never a member-visible surface under any reading. `OQ-78-002` remains open on whether they may be released at all.

## 7. What this package could not settle

| ID | Item | Effect |
| --- | --- | --- |
| ~~`OQ-80-001`~~ | ~~The release surface is proposed, not decided.~~ **Closed September 5, 2026.** Two destinations, not one: the nine `reliability-telemetry` metrics route to the S1 sink CBD-122 establishes, and the nineteen `aggregate-state` figures become a periodic written record consumed by CBD-81's review | Closed. §6 carries the decision and the reasoning |
| ~~`OQ-80-005`~~ | ~~Where does the periodic record live?~~ **Closed September 5, 2026: its own schema in the Cloud SQL instance CBD-108 selected**, with its own access role and retention. `AN-92-006` names schemas as the unit of separation, deletion is a bounded `DROP`, and the instance is already in the approved composition. Object storage was rejected — `OI-108-034` records that it reopens `HG-102-013`, and its deletion timing is unbounded | Closed. §6 carries the reasoning |
| `OQ-80-007` | **The drop at beta end must be a stated step, not an assumption.** §3.4 requires the figures deleted with the beta's operational records, and a schema nobody drops is retained forever | **§3.4 would then be satisfied on paper only.** The step belongs in whatever runbook CBD-63 produces for beta operations, and this register cannot put it there. Recorded so it is not lost between the decision and the build |
| `OQ-80-006` | **`CBD-122-AC01` fixes the S1 sink's trace attributes to a closed universe.** The nine reliability metrics emit counts that may or may not already be in it; `CBD-122-AC08` covers queue depth, dead-letter count, terminal-state counts, scheduler lag and watermark age, which is some of what CBD-79 needs and not obviously all | A dependency on CBD-122 rather than a defect here. If the universe needs extending, that is CBD-122's amendment and it should know before it builds |
| `OQ-80-002` | **No source has a schema, because the product has none.** Every `State of record` names operational state rather than a table, and the derivations are stated to be reproducible rather than implementable | Recorded so the register is not mistaken for a specification. Each source needs a schema binding when the owning feature is built, and that binding is where a derivation can quietly change meaning |
| `OQ-80-003` | **The refresh basis is a proposal.** Daily for `reliability-telemetry`, weekly for `aggregate-state`, on the reasoning that operations reach releasable volume faster than populations. CBD-81 confirms review cadence and may want a different refresh | Low consequence, but recorded because a refresh basis that disagrees with a review cadence produces figures nobody reads or reviews that outrun their data |
| `OQ-80-004` | **Two approved documents disagree about `DI-91-071`.** `AN-92-004` describes `DI-91-053/062/071` as *"S3 restricted security evidence"*; the CBD-91 inventory classifies `DI-91-071` as **S1** non-secret key-lifecycle metadata, and `DF-91-011` routes it to analytics and support systems. One of the two is wrong | **It narrows `OQ-13-007` rather than widening it.** The safety signals CBD-79-AC04 names map to `DI-91-053` and `DI-91-062`, both genuinely S3; `DI-91-071` was never the obstacle. Recorded against CBD-91 and CBD-92, which own the two statements. **Found by the approval review** — this register had restated `AN-92-004` faithfully and inherited its error |
| `OI-80-004` | **The written record costs a trend view.** Comparing four weeks means reading four records, and the retention series at `MT-78-005` and `MT-78-006` are where a trend matters most | Accepted as part of the September 5, 2026 decision rather than discovered afterwards. A store would have given trends and a query interface; the interface is what was declined |
| `OI-80-003` | **This register was reopened the day it closed.** `OQ-13-007` was decided after v1.0 merged, CBD-79 gained two safety metrics, and three sources needed registering. | **Recorded because it was predicted rather than discovered.** The v1.0 closure comment named the CBD-71 reopen-amend-re-close route and said closing was correct for the metrics that existed and not correct forever. It remains true: any further CBD-79 or CBD-81 work that defines a metric reopens this register again, and that is the cost of a register that is complete by construction rather than by assertion. |
| `OI-80-001` | **`MS-80-017` merges two proposed sources**, and the merge is a decision this register made rather than a name it accepted. Both retention metrics now read one derivation | If `MT-78-005` and `MT-78-006` ever need different activity definitions, this merge is the thing that must be undone first. `RT-78-001` currently requires they do not |
| `OI-80-002` | **Nothing here has been implemented or read.** Thirty sources are named against state that does not yet exist | The register is a specification. A later reader should not mistake a registered source for an available one |


## Activation population contract

For MS-80-001/002/003/004/005/008, use CBD-77 §5: UTC calendar week [O,C), Monday 00:00 boundaries, and operational state immediately before exclusive close C. Numerators count only members of the owning metric's denominator. Completion is qualifying state at close, not a separately observed in-week completion. Grace applies only to MT-77-001. Count distinct subjects or spaces, never joined rows; retain no contributing membership and release no excluded count. A zero denominator uses the existing privacy-gated `no eligible population` disposition, never zero or 100 percent; withhold that disposition when release is unsafe.

MS-80-004 is a shared derivation contract with separate consumer-specific counts: its broad population serves MT-77-006/007, while MT-77-002 intersects that population with MS-80-003 eligibility in the same authorized computation. Do not globally narrow it to creation-week spaces or reuse a broad scalar as the MT-77-002 numerator. No new source or retained intermediate set is introduced.

MS-80-005 uses the approved logical predicates from `CBD13-PROFILE-001` / `CBD13-CATEGORY-001`; CBD-77 `OQ-77-003/004` retain only physical binding and verification dependencies. MS-80-007 is deferred/unavailable under `CBD13-USABLE-TIME-001` until an approved operational-source contract proves first simultaneous satisfaction despite replacement, deletion and period changes. Current timestamps or new measurement history cannot substitute.

## Activation amendment record

| Version | Basis | Change | Status |
| --- | --- | --- | --- |
| 1.4 | Approved baseline v1.3; Executive decision `CBD13-ACTIVATION-001`, September 5, 2026 | Correct MT-77-001/002/003/006 population intersections, exclusive-close UTC week, grace boundary, archived-space exception, consumer-specific period counts and privacy-gated empty population. Preserve source IDs and all other decisions | Independently reviewed and merged in PR #236; current candidate review remains pending |

## Approved usable predicates and deferred-source applicability

`CBD13-PROFILE-001` and `CBD13-CATEGORY-001` govern MS-80-005/010/011 through CBD-77 §3. At window close, the measured space's current active Primary Owner (PM-72-008) has exactly one extant active person-level financial-profile authority domain (CA-92-012). An existing empty profile counts; no profile fails. Multiple active profiles or ambiguous association invalidate the source, not normal onboarding failure. Deletion-pending, terminated and retained-history-only profiles do not qualify. The profile limb requires no account, balance, connection, transaction, preference completion or positive value. Zero profiles before first use differs from an existing empty profile; no member gains private-profile access.

The space has at least one qualifying category: an extant stable-identity entity owned by the measured budget space, designated expense budgeting, currently usable for expense classification and category-target planning. Exclude income/transfer classifications, uncategorized placeholders, display groups, historical-only references and archived/deleted/replaced-only/inactive categories. Rename/reorder preserve identity; recreation creates a different identity. Neither actual spending nor a target is required. At least one qualifying category from the Category limb carries a current-period target. An explicitly stored zero qualifies; a missing target does not. Approved transition-prorated targets count. MS-80-011 is a subset of MS-80-010, preserving MT-77-008 numerator/denominator alignment.

CBD-82 and CBD-30 feature owners must provide authorized physical bindings and proof of these exact predicates; the product metric owner remains unchanged. `OQ-80-002` remains open. Names are future bindings, not permission to collect, read private profiles, alter lifecycle/retention or implement full domain features. Current usable completion MT-77-003 remains applicable with all five limbs and the account OR transaction choice intact.

`CBD13-USABLE-TIME-001` preserves MT-77-005/MS-80-007, intended interval, destination and W4 for future applicability. `CBD13-RETENTION-001` preserves MT-78-004/005/006 and MS-80-015/016/017, consumers and destinations; W4 for action breadth and R4/R8 for retention remain approved future baselines under `CBD81-BASELINE-001` (two valid observation pairs, earliest reviews after six/ten weeks). Deferred/unavailable earns no baseline credit, numerical release, measured success or successful retention. Approval of a specification disposition cannot certify beta success. Existing alert acknowledgement/dismissal metrics, separate cadence-segmentation deferral and privacy gates remain unchanged. No new tracking or retention is authorized.

## Usable-definition amendment record

| Version | Authority | Change | Status |
| --- | --- | --- | --- |
| 1.5 | `CBD13-PROFILE-001`; `CBD13-CATEGORY-001`; `CBD13-USABLE-TIME-001`; shared `CBD13-RETENTION-001` follow-through; `CBD81-BASELINE-001` | Exact profile/category/target predicates; MT-77-008 matching set; MT-77-005 deferred with future slot/interval/W4; CBD-80 retention-source feasibility restrictions. Prior approved activation populations, IDs, owners, destinations, account OR transaction choice and privacy gates preserved | Candidate; independent review pending; no measured result or Done claim |

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
| 1.6 | `CBD13-LIFECYCLE-001`; `CBD81-BOUNDS-001`; `CBD13-CORRECTNESS-001` | Freshness snapshot; end-to-end alert lateness; accepted lifecycle start, both deletion scopes and source-specific application-controlled endpoints; matching completed-plus-failed rate/elapsed populations; synthetic correctness QA and explicit later-bound closure exception | Candidate; independent review pending. Existing approvals preserved; no measurement or executed QA claimed |

## Approved invitation sent coverage

`CBD13-INVITATION-SENT-001` clarifies sent coverage as the existing CBD-73 §2/§4.5 privacy-preserving sent/pending customer projection plus defined synthetic lifecycle validation. It is not proof of dispatch, delivery, receipt or recipient activity. Ordinary Pending, internally Delivered, restricted Failed, privately terminal real records until `projection_inactive_at`, and synthetic non-delivering requests can share the same projection. `TR-73-02` durable real dispatch is a separate atomic Pending transition, not delivery proof; restricted delivery/security evidence cannot be reused to invent a send count.

MT-78-002/003 retain their authoritative terminal-only population and outputs: `accepted`, `expired`, `revoked`, `declined`. `sent` is excluded from terminal denominators. The projection does not create terminal measurement membership or add a sent count, rate, breakdown, tracking or retained measurement history. A falling acceptance rate may prompt synthetic invitation-flow investigation; it does not establish a production sending trend.

Synthetic validation must reference the existing CBD-73 negative/recovery inventory `INV-73-05`, `INV-73-13`, `INV-73-19` and `VER-73-11`, plus the §4.5 equivalence suite: `DCL-73-02` / `DCL-73-06` / `DCL-73-08` / `DCL-73-10` through `DCL-73-12` and `VT-94-009` through `VT-94-017`. Verify equivalent projections, controls and timing across ordinary, delivered, failed, privately terminal and synthetic requests; fixed expiry despite delayed processing or private causes; normalized cancellation/resend with one predecessor and one independently evaluated successor; and unchanged terminal metric populations/outputs. No customer/support or restricted evidence is repurposed. These are defined validation requirements, not executed tests or runtime proof; CBD-73 implementation/privacy and release gates remain.

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
| 1.7 | `CBD13-INVITATION-SENT-001`; `CBD13-SYNC-POPULATIONS-001` | Sent projection/synthetic-validation clarification and metric-specific terminal-day synchronization populations, with corresponding shared source derivations; all unrelated decisions preserved | Candidate; independent review pending; no runtime or executed-QA claim |

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
