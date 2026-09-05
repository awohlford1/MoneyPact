# CBD-80 — Measurement Source Register and Privacy Rules

| Field | Value |
| --- | --- |
| Status | **Draft v0.1 — not approved.** Assigns `MS-80-nnn` identifiers to the **31** sources CBD-77, CBD-78 and CBD-79 proposed, and states the privacy, retention and release rules that govern them. §6 proposes the answer to `OQ-13-006` — which surface carries a released figure — as a construction of approved constraints rather than a new decision, and puts it to the Product Owner. **No source is implemented and none has been read** |
| Document version | 0.1 |
| Owner | Alexander Wohlford |
| Jira | [CBD-80](https://cobudget.atlassian.net/browse/CBD-80) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Governing measurement contract | CBD-92 `AN-92-001`–`AN-92-007`, approved |
| Governing operational contract | CBD-92 `OP-92-001`–`OP-92-008`, approved |
| Governing data inventory | `docs/cbd-91-private-mvp-data-inventory.md`, approved — `DI-91-042`, `EG-91-019` |
| Consuming packages | CBD-81 (targets and review process) |
| Confluence page | **Not published.** Registration follows approval |
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

1. **No source reads a security-evidence store.** `AN-92-004` keeps `DI-91-053`, `DI-91-062` and `DI-91-071` single-purpose. This is why CBD-79 defines no safety metric and why `OQ-13-007` is open.
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

**Twenty-eight names are accepted as proposed.** Three decisions were made:

| Decision | Proposed | Registered | Why |
| --- | --- | --- | --- |
| **Merged** | `account_subject.window_active_count` and `account_subject.window_pair_active_count`, proposed separately by `MT-78-005` and `MT-78-006` | **One source**, `MS-80-020` | Both retention metrics read the same derivation and differ only in window B. Two sources would let one drift from the other, and `RT-78-001` requires the same `AD-78-001` in both |
| **Renamed** | `transaction.classified_count` and `transaction.space_manual_classified_count` | `MS-80-024` and `MS-80-025`, names unchanged but **derivations explicitly distinguished** | The names are close enough to be confused. `MS-80-024` counts every classified transaction; `MS-80-025` counts only manually entered ones, and only at the space level. §5 states both derivations in full so the distinction survives the similarity |
| **Rejected** | `budget_space.usable_interval` as a distinct source from `budget_space.usable_state_count` | **Kept separate** as `MS-80-013` and `MS-80-014` | Considered merging, because both read the five `UB-77-001` limbs. Rejected: the interval needs the maximum of five limb timestamps and the count needs a boolean, and merging them would put a timestamp set in a source whose only consumer wants a count |

## 5. The register

Every source has `Boundary: worker`. Class is `aggregate-state` unless marked `reliability-telemetry`.

| ID | Name | State of record | Derivation | Refresh | Owning metric |
| --- | --- | --- | --- | --- | --- |
| `MS-80-001` | `account_subject.active_count` | Account subjects | Count of subjects whose account exists at window close, less those created inside the final 24 hours | Weekly | `MT-77-001` |
| `MS-80-002` | `budget_space.subject_has_space_count` | Budget spaces, account subjects | Count of subjects holding at least one budget space in any state | Weekly | `MT-77-001` |
| `MS-80-003` | `budget_space.created_count` | Budget spaces | Count of spaces created in the window and not archived at window close | Weekly | `MT-77-002`, `MT-77-003` |
| `MS-80-004` | `budget_period.space_has_period_count` | Budget periods | Count of spaces holding at least one materialized period per `SD-071-021` | Weekly | `MT-77-002`, `MT-77-006`, `MT-77-007` |
| `MS-80-005` | `budget_space.usable_state_count` | Five `UB-77-001` limbs | Count of spaces where all five limbs hold **simultaneously at window close**, evaluated together rather than accumulated | Weekly | `MT-77-003` |
| `MS-80-006` | `budget_period.first_materialized_interval` | Budget periods, budget spaces | Duration buckets of (first period materialized − space created), for spaces reaching a period in the window | Weekly | `MT-77-004` |
| `MS-80-007` | `budget_space.usable_interval` | Five `UB-77-001` limbs | Duration buckets of (**maximum of the five limb timestamps** − space created), for spaces becoming usable in the window | Weekly | `MT-77-005` |
| `MS-80-008` | `financial_account.space_manual_count` | Financial accounts | Count of spaces holding at least one manually created account | Weekly | `MT-77-006` |
| `MS-80-009` | `transaction.space_manual_classified_count` | Transactions | Count of spaces holding at least one **manually entered** transaction classified into a period | Weekly | `MT-77-007` |
| `MS-80-010` | `category.space_has_category_count` | Categories | Count of spaces holding at least one spending category | Weekly | `MT-77-008` |
| `MS-80-011` | `category_target.space_has_target_count` | Category targets | Count of spaces where at least one category carries a **current-period** target, including a transition-prorated one per `SD-071-027` | Weekly | `MT-77-008` |
| `MS-80-012` | `transaction.classified_count` | Transactions | Count of **all** transactions holding a period classification per `SD-071-035` | Weekly | `MT-78-001` |
| `MS-80-013` | `transaction.eligible_count` | Transactions, budget periods | Count of transactions whose reliable date falls inside a materialized period. Excludes dates preceding the space's first period | Weekly | `MT-78-001` |
| `MS-80-014` | `invitation.terminal_state_count` | Invitations | Count per terminal state — `accepted`, `expired`, `revoked`, `declined`. **`sent` is excluded**: it is not terminal | Weekly | `MT-78-002`, `MT-78-003` |
| `MS-80-015` | `budget_space.multi_member_count` | Memberships | Count of spaces with more than one active member at window close | Weekly | `MT-78-004` |
| `MS-80-016` | `collaboration.space_action_class_count` | Authorization records, comments | Count of multi-member spaces holding at least one action per class — `viewing`, `editing`, `acknowledgement`, `commenting`. **Counts spaces, not actions** | Weekly | `MT-78-004` |
| `MS-80-017` | `account_subject.window_active_count` | `AD-78-001` limbs | Count of subjects satisfying `AD-78-001` in a named window, and the count satisfying it in **both** of a named pair. **Both figures are produced in one pass and neither set is retained** — `RT-78-001` step 5 | Weekly | `MT-78-005`, `MT-78-006` |
| `MS-80-018` | `alert_instance.firm_delivered_count` | Recipient instances | Count of **firm** in-app instances delivered per `AB-74-002`. Informational instances are excluded: `AB-74-009` gives them no acknowledgement operation | Weekly | `MT-78-007`, `MT-78-008` |
| `MS-80-019` | `alert_instance.firm_acknowledged_count` | Recipient instances | Count of firm instances in the acknowledged state. **Release constrained by `AB-74-014`** — §6 | Weekly | `MT-78-007` |
| `MS-80-020` | `alert_instance.firm_dismissed_count` | Recipient instances | Count of firm instances in the archived or dismissed state. **Release constrained by `AB-74-014`** — §6 | Weekly | `MT-78-008` |
| `MS-80-021` | `sync_run.outcome_class_count` — `reliability-telemetry` | Worker job telemetry | Count per safe outcome class, excluding runs cancelled by a superseding run | Daily | `MT-79-001`, `MT-79-004`, `MT-79-005` |
| `MS-80-022` | `sync_run.duration_bucket_count` — `reliability-telemetry` | Worker job telemetry | Count per duration bucket. **Buckets, not per-run timings**, per `AN-92-003` | Daily | `MT-79-002` |
| `MS-80-023` | `connection.freshness_bucket_count` — `reliability-telemetry` | Worker job telemetry | Count per freshness bucket for active connections, excluding orphaned connections per `INC-76-011` | Daily | `MT-79-003` |
| `MS-80-024` | `sync_run.retry_bucket_count` — `reliability-telemetry` | Worker job telemetry | Count per retry-count bucket | Daily | `MT-79-004` |
| `MS-80-025` | `sync_run.terminal_failure_class_count` — `reliability-telemetry` | Worker job telemetry | Count per safe error class. **No provider message, payload, or identifier** | Daily | `MT-79-005` |
| `MS-80-026` | `notification.outcome_class_count` — `reliability-telemetry` | Worker delivery telemetry | Count per outcome class — `enqueued`, `delivered`, `failed`, `suppressed`, `duplicate`, `late`. **`suppressed` stays in the base** per `AB-74-004` | Daily | `MT-79-006` |
| `MS-80-027` | `alert_instance.dedup_outcome_count` — `reliability-telemetry` | Worker alert telemetry | Count of instance creation attempts per deduplication outcome | Daily | `MT-79-007` |
| `MS-80-028` | `alert_instance.delivery_latency_bucket_count` — `reliability-telemetry` | Worker alert telemetry | Count per latency bucket of (instance available − source fact settled) | Daily | `MT-79-008` |
| `MS-80-029` | `data_request.terminal_state_count` | Export, deletion and archival requests | Count per terminal state. **Requests in verification are excluded**: the customer holds that step | Weekly | `MT-79-009` |
| `MS-80-030` | `data_request.elapsed_bucket_count` | Export, deletion and archival requests | Count per elapsed-duration bucket, request created to terminal state | Weekly | `MT-79-010` |

**Thirty sources for thirty-one proposals**, the difference being the retention merge at `MS-80-017`. Every `MT-` identifier in all three packages appears in the owning-metric column, and no source is registered that no metric reads.

## 6. The release surface — `OQ-13-006`

**This section proposes an answer and does not take it.** The question is which surface carries a released figure and who may read it, and it is a construction of approved constraints rather than a measurement decision.

### What the constraints exclude

| Surface | Why not |
| --- | --- |
| **The customer product** | `AB-74-014` prohibits visibility into whether another person acknowledged or dismissed. A member-visible figure is exactly that for `MS-80-019` and `MS-80-020`, and offers nothing for the rest |
| **The routine support surface** | `OP-92-002` limits it to allowlisted service-health state, public version information, safe status or error class, and a customer-provided correlation identifier — and bars it from disclosing *"customer/resource existence, **counts**, membership, lifecycle, destination, financial, security, or cross-space signals."* **A released aggregate is a count** |
| **The security-evidence store** | `AN-92-004` keeps it single-purpose; `AN-92-006` bars the join |
| **A general operator console reading production** | `OP-92-001` default-denies routine staff access to customer content. A console that can compute an aggregate on demand can usually also read what it aggregates |

### What is left, and it is a positive answer rather than a residue

**A measurement surface distinct from all four**, holding only released aggregates: a figure, its window, its metric identifier, and its suppression state. It reads no production data at request time, because the Worker computes the aggregate on its refresh basis and writes only the result.

Three properties follow, and each is a consequence of `AN-92-006`'s purpose separation rather than an addition to it:

1. **It cannot answer a question it was not built to answer.** There is no query interface over customer state, so no drill-down exists to be requested.
2. **Its store is separate from reliability, security, support and audit**, with its own retention — §3.4 — and no identifier that could join it to any of them.
3. **A customer deletion request reaches it and finds nothing**, because it holds no customer-level record. §3.4 records this as a property of the design rather than a process to run.

### Who may read it

**The Product Owner**, as the only role `EX-102-001` permits to accept a residual and the only role CBD-81 assigns metric ownership to. For a solo project that is the whole answer; for a larger one it would need a role, and the surface should not be built in a way that assumes one reader forever.

**`MS-80-019` and `MS-80-020` carry a further constraint on top**, from CBD-78 §6: never a member-visible surface under any reading, regardless of what is decided here. `OQ-78-002` remains open on whether they may be released at all.

**`OQ-80-001` puts this to the Product Owner.** Until it is answered, every metric in CBD-77 through CBD-79 is defined, computable in principle, and **released nowhere**.

## 7. What this package could not settle

| ID | Item | Effect |
| --- | --- | --- |
| `OQ-80-001` | **The release surface is proposed, not decided.** §6 derives it from `OP-92-001`, `OP-92-002`, `AN-92-004`, `AN-92-006` and `AB-74-014`, which between them exclude every surface the product otherwise has | **No figure is released anywhere until it is answered.** The sources may be built and the aggregates computed; nothing may be read |
| `OQ-80-002` | **No source has a schema, because the product has none.** Every `State of record` names operational state rather than a table, and the derivations are stated to be reproducible rather than implementable | Recorded so the register is not mistaken for a specification. Each source needs a schema binding when the owning feature is built, and that binding is where a derivation can quietly change meaning |
| `OQ-80-003` | **The refresh basis is a proposal.** Daily for `reliability-telemetry`, weekly for `aggregate-state`, on the reasoning that operations reach releasable volume faster than populations. CBD-81 confirms review cadence and may want a different refresh | Low consequence, but recorded because a refresh basis that disagrees with a review cadence produces figures nobody reads or reviews that outrun their data |
| `OI-80-001` | **`MS-80-017` merges two proposed sources**, and the merge is a decision this register made rather than a name it accepted. Both retention metrics now read one derivation | If `MT-78-005` and `MT-78-006` ever need different activity definitions, this merge is the thing that must be undone first. `RT-78-001` currently requires they do not |
| `OI-80-002` | **Nothing here has been implemented or read.** Thirty sources are named against state that does not yet exist | The register is a specification. A later reader should not mistake a registered source for an available one |
