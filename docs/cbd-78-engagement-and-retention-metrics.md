# CBD-78 — Engagement and Retention Metrics

| Field | Value |
| --- | --- |
| Status | **Accepted specification v0.4** under CBD13-FINAL-ACCEPTANCE-001, with all recorded decisions and exceptions preserved. CBD13-FINAL-REVIEW-002 approves the integrated package and closes both prior findings; CBD13-FINAL-SECURITY-002 clears specification privacy only. No runtime measurement, numerical reporting, beta launch, deployment or Jira Done claimed |
| Document version | 0.4 |
| Owner | Alexander Wohlford |
| Jira | [CBD-78](https://cobudget.atlassian.net/browse/CBD-78) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Governing measurement contract | CBD-92 `AN-92-001`–`AN-92-007`, approved |
| Governing alert model | `docs/cbd-74-accountability-alert-boundary-specification.md` — Document version **1.0.1**, approved |
| Governing invitation model | `docs/cbd-73-invitation-consent-lifecycle-specification.md`, approved |
| Governing schedule decisions | `docs/cbd-71-mvp-schedule-decision-register.md` — Document version **1.1**, approved |
| Consuming packages | CBD-80 (measurement-source register); CBD-81 (targets and review) |
| Confluence page | **Unpublished to Confluence.** No verified target; future registration/publication readiness separately gated |
| Last updated | September 5, 2026 |

## 1. Purpose and authority

CBD-78 defines what engagement and retention mean for the private beta and how they are measured. It defines eight metrics and nothing else: no target, no threshold, no measurement-source register.

**Every rule of form comes from the approved conventions**, which control wherever this document appears to decide one.

### 1.1 Scope sources

`OQ-77-001` records that the conventions pin CBD-76 as the governing scope source and that it is not one for activation. **For this package it is half right**, which is worth stating precisely rather than repeating the correction wholesale:

| This package measures | Scope source | Standing |
| --- | --- | --- |
| Invitations, alerts, comments, collaboration | **CBD-76** `INC-76-002`, `INC-76-003`, `INC-76-012`; CBD-72; CBD-73; CBD-74 | Approved, and CBD-76 is genuinely the boundary here |
| Transactions and their classification | **CBD-71** `SD-071-*` | Approved. CBD-76 carries no transaction row |

So CBD-76 governs the collaboration half of this package and not the transaction half. `OQ-78-001` records that the correction to the conventions should say so rather than replacing one wrong pin with another.

## 2. What these metrics are not

**No behavioral tracking is authorized.** `AN-92-001` disables user journeys and behavioral events. Aggregation permission does not establish operational-source feasibility.

**No retained cohorts or measurement membership are authorized.** Avoiding persisted sets alone does not prove historical evidence. Full action breadth and active retention are deferred under §4, with no surviving-state proxy and no audit-purpose reuse (`AN-92-006`).
**No metric is released segmented.** Conventions decision 2. `CBD-78-AC05` requires cadence segmentation and is deferred by the same decision — §6 records it as a criterion this package deliberately does not satisfy.

## 3. The activity condition

The exact activity predicate below is retained for future applicability. Amended `CBD-78-AC04` accepts explicit Private MVP deferral, not computability.

**`AD-78-001` — an account subject is active in a window when at least one holds.**

| Limb | Future condition | Definition reference; not occurrence evidence |
| --- | --- | --- |
| **Collaboration** | The subject performed at least one action in the `collaboration-action` set — `viewing`, `editing`, `acknowledgement`, or `commenting` — in a space it belongs to | CBD-72 permission set; `AB-74-007` for acknowledgement's noninterference |
| **Transaction** | The subject classified at least one transaction into a period | `SD-071-035` — the reliable budget date determines classification but is not the classification action time |
| **Budget change** | The subject created, confirmed, or changed a period, category, or target | `SD-071-026`, `SD-071-029` — schedule changes carry an effective date, not an action occurrence time, and at most one pending change |

**All four collaboration action classes remain in the future definition:** `viewing`, `editing`, `acknowledgement`, and `commenting`. Permission is not evidence of action. Authorization tables cannot prove a view or edit occurred. Surviving comments, transactions, and schedule state cannot establish the full historical predicate under mutation/deletion. Budget dates, effective dates, and generic update timestamps cannot substitute for actual action occurrence times.

**`AD-78-001` is a future per-window predicate, not an implemented derivation.** Source feasibility remains unproven under mutation/deletion. No behavioral tracking, per-subject activity history, retained measurement membership, or measurement reuse of CBD-71 audit provenance is authorized.

## 4. Approved Private MVP deferral and future retention definition

**Executive decision `CBD13-RETENTION-001`, September 5, 2026: defer full `MT-78-004` action breadth and historical `MT-78-005`/`MT-78-006` active retention for Private MVP.** Amended `CBD-78-AC03`/`CBD-78-AC04` and `CBD-13-AC04` accept this specification disposition. It is not whole-package approval, release authorization, measured beta success, or successful retention. Deferred means unavailable, not zero; no numeric release or surviving-state proxy is substituted.

Reopening requires an approved operational-source contract proving actual actions and occurrence times for the full predicate, including historical A/B evidence under mutation/deletion, without behavioral tracking, retained cohorts or measurement membership, or audit-purpose reuse. Source assignment alone does not satisfy this gate.

**`RT-78-001` — future computation, conditional on source proof and release controls.**

1. Name window **A**, a calendar week, UTC.
2. Name window **B**, the calendar week beginning four weeks (or eight) after A begins, UTC.
3. Count subjects satisfying `AD-78-001` in A. That is the denominator.
4. Count subjects satisfying `AD-78-001` in **both** A and B. That is the numerator.
5. Only after reopening and applicable release controls, release the ratio. **Retain neither set.** No computation or release is authorized during the deferral.

**Why this is not a cohort authorization.** Discarding transient sets is a necessary privacy constraint, not proof that current operational state preserves historical membership. Both historical windows must be supportable; current surviving records cannot prove the required intersection.

**Four-week and eight-week retention preserve the same `AD-78-001` and differ only in window B.** Definitions and source slots remain reserved for future applicability.

**Settled baseline periods are preserved.** `CBD81-BASELINE-001` approved four complete weeks for product metrics, fourteen complete days for reliability, and two valid observation pairs for each retention horizon, with earliest retention reviews after six and ten weeks respectively. Only valid, releasable observations count. These periods do not start or complete a deferred measure; missing evidence requires a dated extension or pause decision, never automatic success. They are operating review periods, not statistical guarantees or numerical privacy minima.

**Destinations and package boundaries are preserved.** All metric/source IDs and existing 19/9 destination assignments remain unchanged. CBD-80 source applicability and CBD-81 baseline/exit applicability require separate scoped follow-through. Cadence segmentation remains separately deferred, and alert acknowledgement/dismissal decisions remain unchanged.

**The additional limitation remains.** No retained window sets are available for recomputation against a corrected activity definition; comparability across definition changes is not established (`OI-78-002`). This does not reduce the historical source-proof requirement.
## 5. The metrics

Every metric is `Class: aggregate-state`, `Release form: global`, `Boundary: worker`, and `Owner: product` unless stated. Those four are constant across the package.

### MT-78-001 — Transaction classification rate

| Field | Value |
| --- | --- |
| Purpose | Whether transactions entered into a space reach a budget period. An unclassified transaction is invisible to the budget, so this is the measure of whether the product does its job |
| Formula | classified_transactions ÷ eligible_transactions |
| Numerator | Transactions classified into a budget period per `SD-071-035` |
| Denominator | **Eligible transactions**: transactions held by a space at window close whose reliable date falls inside a materialized period. Excludes transactions whose date precedes the space's first period, which are not classifiable and would report a product failure that is a data-entry choice |
| Measurement source | `transaction.classified_count` *(proposed)*, `transaction.eligible_count` *(proposed)* |
| Interval basis | Opens when a transaction exists with a reliable date inside a materialized period; closes when it holds a period classification |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, transaction and budget-period tables |
| Collection method | Scheduled aggregate in the Worker; counts current classification state |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Eligible transactions accumulate without classification, which makes every budget figure understate spending |

### MT-78-002 — Invitation acceptance rate

| Field | Value |
| --- | --- |
| Purpose | Whether invitations become memberships. Collaboration is the product's premise, and an invitation that is never accepted is where that premise fails first |
| Formula | invitations_accepted ÷ invitations_reaching_a_terminal_state |
| Numerator | Invitations in the `accepted` state |
| Denominator | Invitations in any terminal state — `accepted`, `expired`, `revoked`, or `declined`. **`sent` is excluded**, because an invitation still open has not failed and counting it as unaccepted would report elapsed time as refusal |
| Measurement source | `invitation.terminal_state_count` *(proposed)* |
| Interval basis | Opening reference is the existing CBD-73 sent/pending projection, not dispatch/delivery proof; this metric counts only authoritative terminal invitation state and adds no production sent count |
| Window | Calendar week, UTC, on invitations reaching a terminal state within the window |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, invitation table |
| Collection method | Scheduled aggregate in the Worker |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Falling terminal acceptance may prompt synthetic invitation-flow investigation against CBD-73 within existing privacy limits; no production sending trend or recipient activity is inferred |

### MT-78-003 — Invitation terminal-state distribution

| Field | Value |
| --- | --- |
| Purpose | Distinguishes the three ways an invitation fails. `expired`, `revoked` and `declined` have different causes and different fixes, and a single acceptance rate hides which is happening |
| Formula | count per terminal state ÷ invitations_reaching_a_terminal_state |
| Numerator | Invitations in each of `accepted`, `expired`, `revoked`, `declined`, reported as four figures |
| Denominator | Invitations reaching any terminal state, as `MT-78-002`. **`sent` is excluded on the same reasoning**: it is not a terminal state, and an invitation still open has not failed |
| Measurement source | `invitation.terminal_state_count` *(proposed)* |
| Interval basis | Opening reference is the existing CBD-73 sent/pending projection, not dispatch/delivery proof; this metric counts only authoritative terminal invitation state and adds no production sent count |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold`. **This metric withholds as a whole, not per state** — releasing three of four figures would let the fourth be derived from `MT-78-002` |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, invitation table |
| Collection method | Scheduled aggregate in the Worker |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | `expired` dominates, which is an attention problem, or `declined` dominates, which is a framing problem. The two need opposite responses |

### MT-78-004 — Collaboration action breadth

| Field | Value |
| --- | --- |
| Private MVP disposition | **Deferred — unavailable, not zero or measured success.** All formula, source, interval, window, collection and interpretation fields below are future definitions only; §4 reopening gate applies |
| Purpose | Whether shared spaces are used collaboratively or as single-user budgets with an audience. `CBD-78-AC03` requires the four action classes to be distinguished |
| Formula | spaces with at least one action in each class ÷ spaces with more than one member |
| Numerator | Multi-member spaces holding at least one `viewing`, `editing`, `acknowledgement`, and `commenting` action in the window, reported as four separate figures |
| Denominator | Budget spaces with more than one active member at window close. **Single-member spaces are excluded**, because they cannot collaborate and would report a structural fact as disengagement |
| Measurement source | `collaboration.space_action_class_count` *(proposed)*, `budget_space.multi_member_count` *(proposed)* |
| Interval basis | Opens when a space has more than one member; closes when that space holds one action of the class in the window |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold`, applied per class |
| Connectivity | `MANUAL-OK` |
| Data source | Operational-source contract unproven; authorization is permission, not action evidence, and comments alone do not prove all four classes |
| Collection method | Future aggregate in the Worker, only after §4 reopening. **Counts spaces holding an action, not actions**, so a prolific member does not make a space look collaborative |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | `viewing` alone is present across multi-member spaces, which means the product is being read rather than used together |

### MT-78-005 — Four-week active retention

| Field | Value |
| --- | --- |
| Private MVP disposition | **Deferred — unavailable, not zero or measured success.** All formula, source, interval, window, collection and interpretation fields below are future definitions only; §4 reopening gate applies |
| Purpose | Whether people come back. Future definition only; no Private MVP exit or success claim is available from this deferred measure |
| Formula | subjects active in both A and B ÷ subjects active in A, per `RT-78-001` |
| Numerator | Account subjects satisfying `AD-78-001` in window A and in window B |
| Denominator | Account subjects satisfying `AD-78-001` in window A |
| Measurement source | `account_subject.window_active_count` *(proposed)*, `account_subject.window_pair_active_count` *(proposed)* |
| Interval basis | Opens when a subject is active in window A; closes when the same subject is active in window B |
| Window | A is a calendar week; B is the calendar week beginning four weeks after A begins. Both UTC, both named in the released figure |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Operational-source contract unproven for historical `AD-78-001` under mutation/deletion; current authorization, transaction, and schedule state is insufficient |
| Collection method | Future aggregate in the Worker, only after §4 reopening. **Both counts are computed in one pass and neither set is retained** — `RT-78-001` step 5 |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Retention falls across consecutive window pairs, which no activation metric would show |

### MT-78-006 — Eight-week active retention

| Field | Value |
| --- | --- |
| Private MVP disposition | **Deferred — unavailable, not zero or measured success.** All formula, source, interval, window, collection and interpretation fields below are future definitions only; §4 reopening gate applies |
| Purpose | Whether returning survives the first month. Future comparison uses the same definition and a later B window; freedom from cadence effects is not established |
| Formula | subjects active in both A and B ÷ subjects active in A, per `RT-78-001` |
| Numerator | Account subjects satisfying `AD-78-001` in window A and in window B |
| Denominator | Account subjects satisfying `AD-78-001` in window A |
| Measurement source | `account_subject.window_active_count` *(proposed)*, `account_subject.window_pair_active_count` *(proposed)* |
| Interval basis | Opens when a subject is active in window A; closes when the same subject is active in window B |
| Window | A is a calendar week; B is the calendar week beginning eight weeks after A begins. Both UTC, both named |
| Suppression | `withheld — population below release threshold`. Future first pair spans nine weeks; the approved baseline requires two valid pairs and earliest review after ten weeks, conditional on §4 reopening |
| Connectivity | `MANUAL-OK` |
| Data source | As `MT-78-005` |
| Collection method | As `MT-78-005`, differing only in window B |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Eight-week falls materially below four-week, which means the product survives novelty and not habit |

### MT-78-007 — Firm alert acknowledgement rate

| Field | Value |
| --- | --- |
| Purpose | Whether alerts land. An alert nobody acknowledges is either wrong, unhelpful, or invisible, and `CBD-81` cannot tune the catalog without knowing which |
| Formula | acknowledged_firm_instances ÷ delivered_firm_instances |
| Numerator | Firm in-app recipient instances in the acknowledged state |
| Denominator | **Delivered firm in-app instances.** `AB-74-002` makes exactly one mandatory in-app instance per eligible recipient per shared event, which is what makes this denominator exact. **Informational instances are excluded**, because `AB-74-009` gives them no acknowledgement operation and including them would report an impossibility as a failure |
| Measurement source | `alert_instance.firm_delivered_count` *(proposed)*, `alert_instance.firm_acknowledged_count` *(proposed)* |
| Interval basis | Opens when a firm instance is created for a recipient; closes when that instance holds acknowledgement state |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold`. **See §6: this metric carries four release conditions beyond suppression, including the one-way ratchet** |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, recipient-instance table |
| Collection method | Scheduled aggregate in the Worker. Counts instance state; retains no per-recipient row |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Acknowledgement falls across the whole firm catalog, which is a catalog problem rather than a member problem |
| **Permitted response** | Fix, soften, or remove the alert. **This figure may never justify sending more** — §6 condition 4 |

### MT-78-008 — Firm alert dismissal rate

| Field | Value |
| --- | --- |
| Purpose | Distinguishes *"seen and dealt with"* from *"cleared away"*. Rising dismissal with falling acknowledgement is the signature of an alert catalog that has become noise |
| Formula | dismissed_firm_instances ÷ delivered_firm_instances |
| Numerator | Firm in-app recipient instances in the archived or dismissed presentation state |
| Denominator | Delivered firm in-app instances, as `MT-78-007` |
| Measurement source | `alert_instance.firm_dismissed_count` *(proposed)*, `alert_instance.firm_delivered_count` *(proposed)* |
| Interval basis | Opens when a firm instance is created; closes when that instance holds dismissal state |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold`. **See §6: four release conditions, including the one-way ratchet** |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, recipient-instance table |
| Collection method | Scheduled aggregate in the Worker |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Dismissal rises while acknowledgement falls, which means alerts are being cleared rather than read |
| **Permitted response** | Reduce the catalog or soften the alerts being cleared. **This figure may never justify sending more** — §6 condition 4 |

## 6. `AB-74-014` and the two alert measures — decided September 5, 2026

**This was the sharpest question in the package and it is now answered.**

`AB-74-014` is approved and unambiguous:

> No alert behavior may be used to pressure, punish, or surveil. There is no escalation path that reports non-acknowledgement, no delivery receipt to another member, and **no visibility into whether another person read, acknowledged, or dismissed an instance.**

CBD-74 restates it twice more: *"no status visible to anyone else"* and *"No surface reports that a person dismissed, paused, or opted out."*

`CBD-78-AC06` requires an acknowledgement and dismissal rate. **Read carelessly, `AB-74-014` prohibits it.**

### What the rule's own sources are about

Every source `AB-74-014` cites is **member-facing**:

| Source | What it addresses |
| --- | --- |
| `CBD-12-AC22` | Coercion, unwanted access, and non-retaliatory messaging — *"no **member**, including a sole Primary"* |
| `CBD-12-AC24` | Collaboration **copy**, which must not imply *"surveillance entitlement"* |
| `RI-93-014` | One identified person's provisional overspend that *"**other members** see before that person can correct it"* |

None addresses aggregate measurement by the operator, and `AN-92-005` independently permits a coarse non-drillable aggregate for a product decision.

### The part the sources do not answer

**The rule's first sentence is broader than any of them.** *"No alert behavior may be used to pressure, punish, or surveil"* is not scoped to members. If an acknowledgement rate were used to tune the catalog toward higher compliance — more alerts, more often, more insistent — that would be alert behaviour used to pressure, by the operator rather than by a member.

**That risk is real and the member-facing sources do not dispose of it.**

### The decision, and the four conditions

**Both metrics may be released**, on four conditions. The first three bound who sees the figure; **the fourth bounds what may be done with it**, which is what the broader sentence actually requires.

1. **Global only.** No member, space, or alert-category breakdown. `MT-78-004`'s future per-class definition remains preserved (measurement is deferred under §4); a collaboration action class is not a person; these two get no equivalent, because an alert-category breakdown at beta scale approaches a single recipient.
2. **Never a member-visible surface.** Not a dashboard, not a space view, not a notification, not an export. Settled in the negative regardless of what `OQ-80-001` decided for other figures.
3. **No response may name, contact, or differentiate a member.** The `Unhealthy condition` on both is written as a catalog problem for exactly this reason.
4. **A one-way ratchet.** These figures may justify making alerts **fewer, softer, or less frequent**. They may **never** justify making them more numerous, more frequent, or more insistent.

### Why the ratchet, rather than a promise

Conditions 1 to 3 keep the figure away from members. **None of them stops the operator from using it to press harder**, and that is the reading `AB-74-014`'s first sentence actually forbids.

The ratchet forecloses it structurally. **A falling acknowledgement rate can mean the catalog is wrong, and the permitted answer to that is to fix or remove the alert — never to send more of it.** An alert nobody acknowledges is not solved by repetition, so the ratchet costs nothing a good response would have wanted.

**It is also checkable.** A change that increases alert frequency, volume, or insistence may not cite `MT-78-007` or `MT-78-008` as its justification, and the audit requires the condition to stay stated.

## 7. Denominator rules

Per conventions §6, and in addition to the per-metric rules above.

**Eligibility is evaluated at window close.** As CBD-77 §5.

**Terminal states, not elapsed time.** `MT-78-002` and `MT-78-003` exclude open invitations, because an invitation that has not expired has not been refused.

**Structural exclusions are stated, not silent.** Single-member spaces leave `MT-78-004`; unclassifiable transactions leave `MT-78-001`; informational instances leave `MT-78-007` and `MT-78-008`. Each exclusion removes a population that *cannot* produce the numerator, and leaving them in would report a structural fact as a product failure.

**Retries count once.** Each denominator counts an entity with one current state — a transaction, an invitation, a space, a subject, an instance.

**Deferred metrics remain unavailable, never zero or `no eligible population`. For applicable measures, a zero denominator is reported as `no eligible population`.** Common in the first windows and not a failure.

## 8. What this package could not settle

| ID | Item | Effect |
| --- | --- | --- |
| `OQ-78-001` | **The CBD-76 scope-source correction is half right for this package.** `OQ-77-001` says CBD-76 is not the scope source; for the collaboration half — invitations, alerts, comments — it is exactly the right one. The correction to the conventions should say *which half* rather than replacing one wrong pin with another | Recorded against the conventions. No metric changes |
| ~~`OQ-78-002`~~ | ~~Does an aggregate acknowledgement rate sit inside `AB-74-014`?~~ **Closed September 5, 2026.** Both metrics may be released on four conditions — three bounding who sees the figure and a fourth, the one-way ratchet, bounding what may be done with it. §6 carries the reasoning: the rule's three cited sources are member-facing, and its broader first sentence is answered by the ratchet rather than by intent | Closed. **`MT-78-007` and `MT-78-008` are authorized for release** under §6 |
| `OQ-78-003` | **`CBD-78-AC05` is deliberately not satisfied.** It requires cadence segmentation of retention; conventions decision 2 releases no segments during the beta, and the criterion was amended on September 5, 2026 to defer it | Recorded so the gap is visible from this document as well as from the ticket. CBD-81 owns the population decision that reopens it |
| `OI-78-001` | **Eleven measurement sources are proposed and none exists.** CBD-80 assigns the `MS-80-nnn` identifiers | Source assignment alone does not prove computability; §4 deferral and source-proof gate apply |
| `OI-78-002` | **A retention figure cannot be recomputed against a corrected `AD-78-001`.** `RT-78-001` retains neither window set, so changing the activity definition changes every future figure and no past one, and the series is not comparable across the change | Retained sets remain prohibited; historical source proof and definition comparability remain necessary before future applicability |
| `OI-78-003` | **Nothing here has been measured**, and the product is not built. Every `Data source` names where state will live | The metrics are specifications, not results |

## 9. Revision record

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 0.3 | September 5, 2026 | Codex Specification | Incorporates Executive-approved Private MVP action-breadth and historical-retention deferral; corrects evidence claims; preserves IDs, destinations, baselines, cadence and alert decisions | Deferral approved; remaining package Draft |
| 0.2 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | Existing alert decision and four conditions, preserved in §6 and companion revision history | Superseded by 0.3; alert decision retained |
## Approved invitation sent coverage

`CBD13-INVITATION-SENT-001` clarifies sent coverage as the existing CBD-73 §2/§4.5 privacy-preserving sent/pending customer projection plus defined synthetic lifecycle validation. It is not proof of dispatch, delivery, receipt or recipient activity. Ordinary Pending, internally Delivered, restricted Failed, privately terminal real records until `projection_inactive_at`, and synthetic non-delivering requests can share the same projection. `TR-73-02` durable real dispatch is a separate atomic Pending transition, not delivery proof; restricted delivery/security evidence cannot be reused to invent a send count.

MT-78-002/003 retain their authoritative terminal-only population and outputs: `accepted`, `expired`, `revoked`, `declined`. `sent` is excluded from terminal denominators. The projection does not create terminal measurement membership or add a sent count, rate, breakdown, tracking or retained measurement history. A falling acceptance rate may prompt synthetic invitation-flow investigation; it does not establish a production sending trend.

Synthetic validation must reference the existing CBD-73 negative/recovery inventory `INV-73-05`, `INV-73-13`, `INV-73-19` and `VER-73-11`, plus the §4.5 equivalence suite: `DCL-73-02` / `DCL-73-06` / `DCL-73-08` / `DCL-73-10` through `DCL-73-12` and `VT-94-009` through `VT-94-017`. Verify equivalent projections, controls and timing across ordinary, delivered, failed, privately terminal and synthetic requests; fixed expiry despite delayed processing or private causes; normalized cancellation/resend with one predecessor and one independently evaluated successor; and unchanged terminal metric populations/outputs. No customer/support or restricted evidence is repurposed. These are defined validation requirements, not executed tests or runtime proof; CBD-73 implementation/privacy and release gates remain.

## Final source-correction amendment record

| Version | Authority | Change | Status |
| --- | --- | --- | --- |
| 0.4 | `CBD13-INVITATION-SENT-001`; `CBD13-SYNC-POPULATIONS-001` | Sent projection/synthetic-validation clarification and metric-specific terminal-day synchronization populations, with corresponding shared source derivations; all unrelated decisions preserved | Candidate; independent review pending; no runtime or executed-QA claim |

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
