# CBD-78 — Engagement and Retention Metrics

| Field | Value |
| --- | --- |
| Status | **Draft v0.2 — not approved.** Defines the eight engagement and retention metrics for the private beta, each as an `AN-92-005` aggregate over operational state. **Retention is computed without a cohort**, because `AN-92-001` names cohorts; §4 states how. §3 defines the activity condition every retention measure turns on, and §6 records the `AB-74-014` decision of September 5, 2026: both alert measures are released, on four conditions including a one-way ratchet that forecloses the rule's broader prohibition structurally |
| Document version | 0.2 |
| Owner | Alexander Wohlford |
| Jira | [CBD-78](https://cobudget.atlassian.net/browse/CBD-78) |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Governing conventions | `docs/cbd-13-measurement-conventions.md` — Document version **1.0.1**, approved |
| Governing measurement contract | CBD-92 `AN-92-001`–`AN-92-007`, approved |
| Governing alert model | `docs/cbd-74-accountability-alert-boundary-specification.md` — Document version **1.0.1**, approved |
| Governing invitation model | `docs/cbd-73-invitation-consent-lifecycle-specification.md`, approved |
| Governing schedule decisions | `docs/cbd-71-mvp-schedule-decision-register.md` — Document version **1.1**, approved |
| Consuming packages | CBD-80 (measurement-source register); CBD-81 (targets and review) |
| Confluence page | **Not published.** Registration follows approval |
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

**No metric observes a person's sequence of actions.** `AN-92-001` disables user journeys. Each metric counts a state reached or an action count held in the system of record, and retention is computed by comparing two window aggregates rather than by following anyone.

**No retention cohort exists.** §4 states the computation. There is no persisted membership list, no cohort identifier, and no drill-down, which is what makes the measure permitted rather than merely renamed.

**No metric is released segmented.** Conventions decision 2. `CBD-78-AC05` requires cadence segmentation and is deferred by the same decision — §6 records it as a criterion this package deliberately does not satisfy.

## 3. The activity condition

Every retention measure turns on what "active" means, and `CBD-78-AC04` requires it to be exact.

**`AD-78-001` — an account subject is active in a window when at least one holds.**

| Limb | Condition | Approved source |
| --- | --- | --- |
| **Collaboration** | The subject performed at least one action in the `collaboration-action` set — `viewing`, `editing`, `acknowledgement`, or `commenting` — in a space it belongs to | CBD-72 permission set; `AB-74-007` for acknowledgement's noninterference |
| **Transaction** | The subject classified at least one transaction into a period | `SD-071-035` — a reliable date, not transaction time, determines classification |
| **Budget change** | The subject created, confirmed, or changed a period, category, or target | `SD-071-026`, `SD-071-029` — schedule changes carry an effective date and at most one pending change |

**`viewing` is deliberately included and is the weakest limb.** A subject who only reads is engaged in the sense that matters for a private beta — they came back — and excluding reading would report a Viewer as inactive by construction, which `CBD-72`'s role model makes a category error rather than a measurement choice.

**`AD-78-001` is evaluated per window, not accumulated.** No per-subject activity history is retained: the derivation asks whether any qualifying state exists with a timestamp inside the window, and returns a boolean.

## 4. Retention without a cohort

`CBD-78-AC04` requires four- and eight-week active retention with exact activity definitions and **two named activity windows**, computed as an aggregate with no persisted membership. `AN-92-001` names cohorts as disabled, so this is how the measure is produced instead.

**`RT-78-001` — the computation.**

1. Name window **A**, a calendar week.
2. Name window **B**, the calendar week beginning four weeks (or eight) after A begins.
3. Count subjects satisfying `AD-78-001` in A. That is the denominator.
4. Count subjects satisfying `AD-78-001` in **both** A and B. That is the numerator.
5. Release the ratio. **Retain neither set.**

**Why this is not a cohort.** A cohort is a persisted membership with an identity that later analysis can re-enter. Step 5 keeps no list, and steps 3 and 4 are two counts over current state evaluated in the same pass. The intersection is computed and discarded; nothing can be drilled back into.

**Four-week and eight-week retention use the same `AD-78-001` and differ only in window B**, which the criterion requires and which makes the two figures comparable to each other rather than to nothing.

**The honest limitation.** Because no membership is retained, **a retention figure cannot be recomputed later against a corrected activity definition.** Changing `AD-78-001` changes every future figure and no past one, and the series is not comparable across the change. `OI-78-002` records it, and the alternative — retaining the sets — is what `AN-92-005` prohibits.

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
| Interval basis | Opens when an invitation is sent; closes when it reaches any terminal state |
| Window | Calendar week, UTC, on invitations reaching a terminal state within the window |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, invitation table |
| Collection method | Scheduled aggregate in the Worker |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Acceptance falls while invitations continue to be sent, which points at the invitation surface rather than at willingness |

### MT-78-003 — Invitation terminal-state distribution

| Field | Value |
| --- | --- |
| Purpose | Distinguishes the three ways an invitation fails. `expired`, `revoked` and `declined` have different causes and different fixes, and a single acceptance rate hides which is happening |
| Formula | count per terminal state ÷ invitations_reaching_a_terminal_state |
| Numerator | Invitations in each of `accepted`, `expired`, `revoked`, `declined`, reported as four figures |
| Denominator | Invitations reaching any terminal state, as `MT-78-002`. **`sent` is excluded on the same reasoning**: it is not a terminal state, and an invitation still open has not failed |
| Measurement source | `invitation.terminal_state_count` *(proposed)* |
| Interval basis | Opens when an invitation is sent; closes at its terminal state |
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
| Purpose | Whether shared spaces are used collaboratively or as single-user budgets with an audience. `CBD-78-AC03` requires the four action classes to be distinguished |
| Formula | spaces with at least one action in each class ÷ spaces with more than one member |
| Numerator | Multi-member spaces holding at least one `viewing`, `editing`, `acknowledgement`, and `commenting` action in the window, reported as four separate figures |
| Denominator | Budget spaces with more than one active member at window close. **Single-member spaces are excluded**, because they cannot collaborate and would report a structural fact as disengagement |
| Measurement source | `collaboration.space_action_class_count` *(proposed)*, `budget_space.multi_member_count` *(proposed)* |
| Interval basis | Opens when a space has more than one member; closes when that space holds one action of the class in the window |
| Window | Calendar week, UTC |
| Suppression | `withheld — population below release threshold`, applied per class |
| Connectivity | `MANUAL-OK` |
| Data source | Application database, authorization and comment tables |
| Collection method | Scheduled aggregate in the Worker. **Counts spaces holding an action, not actions**, so a prolific member does not make a space look collaborative |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | `viewing` alone is present across multi-member spaces, which means the product is being read rather than used together |

### MT-78-005 — Four-week active retention

| Field | Value |
| --- | --- |
| Purpose | Whether people come back. The single most informative private-beta measure, and the one most likely to end the beta |
| Formula | subjects active in both A and B ÷ subjects active in A, per `RT-78-001` |
| Numerator | Account subjects satisfying `AD-78-001` in window A and in window B |
| Denominator | Account subjects satisfying `AD-78-001` in window A |
| Measurement source | `account_subject.window_active_count` *(proposed)*, `account_subject.window_pair_active_count` *(proposed)* |
| Interval basis | Opens when a subject is active in window A; closes when the same subject is active in window B |
| Window | A is a calendar week; B is the calendar week beginning four weeks after A begins. Both UTC, both named in the released figure |
| Suppression | `withheld — population below release threshold` |
| Connectivity | `MANUAL-OK` |
| Data source | Application database; `AD-78-001` reads authorization, transaction, and schedule state |
| Collection method | Scheduled aggregate in the Worker. **Both counts are computed in one pass and neither set is retained** — `RT-78-001` step 5 |
| Review cadence | Weekly *(CBD-81 confirms)* |
| Unhealthy condition | Retention falls across consecutive window pairs, which no activation metric would show |

### MT-78-006 — Eight-week active retention

| Field | Value |
| --- | --- |
| Purpose | Whether returning survives the first month. Four-week retention can be an artefact of a monthly budget cadence; eight-week is not |
| Formula | subjects active in both A and B ÷ subjects active in A, per `RT-78-001` |
| Numerator | Account subjects satisfying `AD-78-001` in window A and in window B |
| Denominator | Account subjects satisfying `AD-78-001` in window A |
| Measurement source | `account_subject.window_active_count` *(proposed)*, `account_subject.window_pair_active_count` *(proposed)* |
| Interval basis | Opens when a subject is active in window A; closes when the same subject is active in window B |
| Window | A is a calendar week; B is the calendar week beginning eight weeks after A begins. Both UTC, both named |
| Suppression | `withheld — population below release threshold`. **Reached later than `MT-78-005`**: the first eight-week figure requires nine weeks of beta |
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

1. **Global only.** No member, space, or alert-category breakdown. `MT-78-004`'s per-class reporting is permitted because a collaboration action class is not a person; these two get no equivalent, because an alert-category breakdown at beta scale approaches a single recipient.
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

**A zero denominator is reported as `no eligible population`.** Common in the first windows and not a failure.

## 8. What this package could not settle

| ID | Item | Effect |
| --- | --- | --- |
| `OQ-78-001` | **The CBD-76 scope-source correction is half right for this package.** `OQ-77-001` says CBD-76 is not the scope source; for the collaboration half — invitations, alerts, comments — it is exactly the right one. The correction to the conventions should say *which half* rather than replacing one wrong pin with another | Recorded against the conventions. No metric changes |
| ~~`OQ-78-002`~~ | ~~Does an aggregate acknowledgement rate sit inside `AB-74-014`?~~ **Closed September 5, 2026.** Both metrics may be released on four conditions — three bounding who sees the figure and a fourth, the one-way ratchet, bounding what may be done with it. §6 carries the reasoning: the rule's three cited sources are member-facing, and its broader first sentence is answered by the ratchet rather than by intent | Closed. **`MT-78-007` and `MT-78-008` are authorized for release** under §6 |
| `OQ-78-003` | **`CBD-78-AC05` is deliberately not satisfied.** It requires cadence segmentation of retention; conventions decision 2 releases no segments during the beta, and the criterion was amended on September 5, 2026 to defer it | Recorded so the gap is visible from this document as well as from the ticket. CBD-81 owns the population decision that reopens it |
| `OI-78-001` | **Eleven measurement sources are proposed and none exists.** CBD-80 assigns the `MS-80-nnn` identifiers | No metric is computable until CBD-80 completes |
| `OI-78-002` | **A retention figure cannot be recomputed against a corrected `AD-78-001`.** `RT-78-001` retains neither window set, so changing the activity definition changes every future figure and no past one, and the series is not comparable across the change | Accepted, because retaining the sets is what `AN-92-005` prohibits. It means `AD-78-001` should be settled before the beta produces figures worth trusting |
| `OI-78-003` | **Nothing here has been measured**, and the product is not built. Every `Data source` names where state will live | The metrics are specifications, not results |
