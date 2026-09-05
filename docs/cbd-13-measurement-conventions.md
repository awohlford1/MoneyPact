# CBD-13 — Measurement and Event Conventions

| Field | Value |
| --- | --- |
| Status | **Draft v0.3 — not approved.** Fixes shared conventions so CBD-77, CBD-78, and CBD-79 can be written concurrently without inventing three incompatible vocabularies. It defines no metric, names no measurement source, and sets no target. **v0.2 re-architects the document onto `AN-92-005` aggregate measurement**: v0.1 was built on a behavioural event pipeline, which `AN-92-001` disables for Private MVP. §2 records the collision and the four Product Owner decisions of September 5, 2026 that resolve it. **v0.3 closes `OQ-13-001`, `OQ-13-004` and `OQ-13-005`**: this document is owned by **CBD-368**, the authorized operational boundary is the **Worker** deployment unit, and the four conflicting criteria are amended in Jira |
| Document version | 0.3 |
| Owner | Alexander Wohlford |
| Jira | [CBD-368](https://cobudget.atlassian.net/browse/CBD-368) — the subtask that owns this document and blocks CBD-77, CBD-78 and CBD-79 |
| Parent story | [CBD-13](https://cobudget.atlassian.net/browse/CBD-13) |
| Epic | [CBD-1](https://cobudget.atlassian.net/browse/CBD-1) |
| Governing constraint | CBD-92 System Flow and Technical Threat Model, approved — `AN-92-001` through `AN-92-007` (pinned in §1) |
| Governing scope source | CBD-76 MVP Boundary and Readiness Record, approved v1.0 (pinned in §1) |
| Consuming packages | CBD-77, CBD-78, CBD-79 (metric definitions); CBD-80 (measurement-source register and privacy rules); CBD-81 (targets and review process) |
| Review date | September 5, 2026 |

> **Convention boundary:** This document settles form, not content. A convention here never authorizes a metric, a measurement source, a threshold, or a data collection. Where it appears to decide a measurement question, the owning subtask's acceptance criteria control and this document is wrong — **except where those criteria conflict with an approved contract, which §11 records and which no subtask may override.**

## 1. Purpose and authority

CBD-77, CBD-78, and CBD-79 are unblocked concurrently and each must document the signals its metrics require. CBD-80 then owns the measurement-source register, its naming, and its privacy rules. Written independently, the three metric packages would produce three vocabularies and CBD-80 would become a reconciliation exercise rather than a consolidation.

Every rule below is derived from acceptance criteria or approved contracts that already exist. Nothing here is a new product decision except the two recorded at §2.3.

| Source | What it fixes here |
| --- | --- |
| `AN-92-001`–`AN-92-007` | **What may be measured at all** (§2). Binding, and above every acceptance criterion in this story family |
| CBD-13 parent criteria | The metric record fields; the bank-connectivity marker; the requirement that each unhealthy measure has a documented action |
| CBD-80 criteria | Source naming, required and optional attributes, the prohibited-content list, identifier minimization, duplicate handling |
| CBD-77 criteria | Numerator, denominator, interval, and window on every activation metric; abandonment and retry must not inflate completion |
| CBD-78 criteria | Explicit eligible-population denominators |
| CBD-79 criteria | Operational signal coverage; each unhealthy condition carries a response |

If a rule here conflicts with an owning subtask's acceptance criteria, the acceptance criteria win and this document is corrected. **If either conflicts with `AN-92-*`, the contract wins and the criterion is amended** — §11 lists the four criteria that are in that position today.

### Pinned sources

| Source | Document | Pinned version | Why it is pinned |
| --- | --- | --- | --- |
| CBD-92 technical threat model | `docs/cbd-92-system-flow-technical-threat-model.md` | Approved; `AN-92-001`–`AN-92-007` §2.11 | Fixes what measurement is permitted. The binding constraint on this whole story |
| CBD-91 data inventory | `docs/cbd-91-private-mvp-data-inventory.md` | Approved; `DI-91-042`, `EG-91-019` | Names the prohibited data class and records the analytics decision as closed |
| CBD-76 boundary record | `docs/cbd-76-mvp-boundary-and-readiness-record.md` | Document version **1.0.1** | Supplies the stable Private-MVP scope that CBD-77, CBD-78, and CBD-79 measure against |
| CBD-76 machine-readable boundary | `docs/cbd-76-mvp-boundary-register.json` | Normative with the record above | Included, Prohibited, Excluded, and Deferred rows decide which behavior is eligible to be measured |

## 2. What may be measured

**This section is the reason v0.2 exists.** v0.1 specified an analytics event catalog with per-event `actor_ref` and `space_ref`, activation funnels with start and end events, and retention cohorts. Each of those is named as disabled by an approved contract.

### 2.1 The prohibition

`AN-92-001` — *Product analytics collection is disabled*:

> Private MVP does not create, send, retain, or expose `DI-91-042` product analytics **or success-measure events**. No first- or third-party analytics SDK, behavioral event pipeline, user journey, funnel, cohort, attribution, advertising, or customer-level experimentation dataset is enabled.

`AN-92-002` adds that consent banners and pseudonymization **do not** make a prohibited mechanism permitted. `RV-92-005O` restates the whole `AN-92` block as limiting product measurement to *"coarse non-drillable aggregates without customer-level event retention"*. CBD-92 closes evidence gap `EG-91-019` on the same terms, so **whether analytics is enabled is a settled question, not an open one**.

The story's own title names *success metrics*, and `AN-92-001` names *success-measure events*. The prohibition is on the **mechanism**, not on the measurement.

### 2.2 What is permitted, and it is sufficient

`AN-92-005` — *Aggregate MVP measurement without behavioural events*:

> Product decisions may use global or sufficiently coarse aggregate service/account state computed inside an authorized operational boundary only when the released result cannot identify or single out a subject, space, relationship, financial behavior, protected action or small cohort. The aggregate process cannot persist contributing customer-level events or expose drill-down.

`AN-92-003` separately permits content-free reliability telemetry against an explicit **S1 allowlist**: service or component and deployed version, coarse operation class, safe outcome or error class, duration or capacity bucket, and aggregate health count — and nothing identifying a subject, space, resource, account, connection or destination.

**Together these are enough for this story.** A private-beta success metric is computed by aggregating the product's **own operational state** — budget spaces, periods, invitations, connections, notification outcomes — which already exists as the system of record. What is prohibited is standing up a parallel event pipeline to feed it.

**The distinction that governs every metric in CBD-77 through CBD-79:**

| Permitted | Prohibited |
| --- | --- |
| Counting the state of the record — how many spaces have a confirmed period today | Emitting and retaining an event each time a period is confirmed, keyed to a person |
| An aggregate computed inside the operational boundary and released as a number | A dataset from which that number could be drilled back to its contributors |
| Reliability telemetry on the `AN-92-003` S1 allowlist | Any telemetry carrying subject, space, account, connection or destination |
| Deriving that 12 of 30 accounts were active in a period | Retaining, per account, the events establishing that activity for measurement purposes |

### 2.3 Product Owner decisions, September 5, 2026

**Decision 1 — CBD-13 is re-scoped onto `AN-92-005` aggregates.** No analytics event pipeline is defined or built. Metrics are computed from operational state, no contributing customer-level events are persisted for measurement, and no drill-down is exposed. CBD-80 becomes a **measurement-source register** rather than an analytics event catalog. This needs no new approval, because it asks for nothing `AN-92-005` does not already permit.

**Decision 2 — global aggregates only during the beta.** No segmentation is released while the population is small. Every metric reports a whole-population figure. Segmentation is introduced when the population supports it, and not before.

The reason is arithmetic rather than cautious. The approved demand model puts Base at **30 monthly active users**. `AN-92-005` forbids a released result that singles out a subject, space, relationship or small cohort; four-way cadence segmentation of thirty people produces cells of one and two, and a cell of one is an identification. **No approved source sets a minimum cell size**, and rather than invent one, the beta reports no cells at all.

Decision 2 has a cost and it is recorded rather than absorbed: **`CBD-78-AC05` requires cadence segmentation of retention, and it cannot be satisfied during the beta.** §11 carries it, and it is amended in Jira as of the same day.

**Decision 3 — the authorized operational boundary is the Worker deployment unit.** `AN-92-005` requires the aggregate to be computed *"inside an authorized operational boundary"* and names none; the approved topology does.

`TD-103-001` fixes **two** deployment units, API and Worker, from one codebase and one image, and puts *"background domain calculators, scheduled work"* in the Worker. `TD-103-002` keeps the scheduler a managed trigger rather than a third unit, for a stated reason: *"the worker remains the only executor of domain effects, so `SA-92-*` authority is proven in exactly one place rather than two."*

A separate reporting process would be a third executor and would cost exactly that property. The database cannot self-trigger, so it needs the Worker regardless, and anything reading results directly from production is the routine staff path `OP-92-001` default-denies. **Every measurement source records `boundary: worker`** (§3), and a source that cannot be computed there is not defined.

**One constraint on the release surface, which is a different question from the boundary.** `OP-92-002` limits the routine support surface to allowlisted service-health state and safe status or error class, and bars it from disclosing *"customer/resource existence, counts, membership, lifecycle, destination, financial, security, or cross-space signals"* — **counts included**. `AN-92-005` authorizes releasing an aggregate for a product decision, so the figures are permitted; what is not permitted is putting them on the support surface. CBD-80 records the release surface per source and it is never that one.

**Decision 4 — the four conflicting criteria are amended as §11 proposes**, and `CBD-80`'s summary becomes *"Create the measurement-source register and privacy rules"*. Applied in Jira on September 5, 2026. Each amendment carries the amending sentence and the contract that forced it, so a later reader sees why the criterion changed rather than only that it did.

**Decision 5 — this document is owned by a subtask.** `CBD-368` *"Fix shared measurement and event conventions"* is created under CBD-13, carries seven acceptance criteria of its own, and **blocks CBD-77, CBD-78 and CBD-79**. It mirrors CBD-102's role for CBD-15: the conventions get an approval gate of their own, and the dependency is visible on the board rather than implied by a document nobody owns.

## 3. Measurement sources

Metric packages reference measurement sources; they do not create the register.

A **measurement source** is a named piece of operational state that already exists as a system of record, together with the rule for deriving a count from it. It is not an event, it is not emitted, and nothing is retained for measurement that the product does not already hold for its own operation.

- **Source name** — lowercase, dot-separated domain and snake_case state predicate: `budget_period.confirmed_count`, `invitation.accepted_count`, `connection.sync_failed_count`. The domain is the entity whose state is counted.
- **Register ID** — `MS-80-<nnn>`, assigned by CBD-80. `EV-` is in use by the CBD-102 evidence register and `AE-` was v0.1's analytics-event prefix, now withdrawn; neither is reused.
- **Provisional references** — CBD-77, CBD-78, and CBD-79 name sources before the register exists. Each writes the source name and marks it `proposed`. CBD-80 assigns the `MS-80-nnn` ID and either accepts the name or renames it, recording the rename.
- Two metric packages proposing the same source propose the same name. CBD-80 resolves any collision; neither metric package edits the other's document to fix it.

### Required attributes on every source

`source_name`, `register_id`, `state_of_record`, `derivation`, `refresh_basis`, `boundary`.

`boundary` names the authorized operational boundary inside which the aggregate is computed, which `AN-92-005` requires and which has no analogue in an event schema. **Its value is `worker` for every source**, per decision 3 — the field exists so that a source computed anywhere else is visibly wrong rather than silently permitted.

**There is no `actor_ref`, no `space_ref`, and no `idempotency_key`.** v0.1 required all three on every event. `AN-92-003` prohibits subject and space identifiers in telemetry, and `AN-92-005` prohibits persisting contributing customer-level records — so an identifier that would make duplicate detection possible is the identifier that makes the collection prohibited. Duplicate handling moves to §6, where it is a property of the derivation rather than of a retained record.

## 4. Metric record shape

Every metric in CBD-77, CBD-78, and CBD-79 is recorded with all of these fields. A field that does not apply is written `n/a` with a reason; it is never omitted.

| Field | Meaning |
| --- | --- |
| ID | `MT-<subtask>-<nnn>`, for example `MT-77-001`. Stable for the life of the metric |
| Name | Customer-neutral metric name. Not a copy string |
| Purpose | The decision this metric supports. A metric that supports no decision is not defined |
| Class | `aggregate-state` (`AN-92-005`) or `reliability-telemetry` (`AN-92-003`) — §5 |
| Formula | The full expression, stated once |
| Numerator | The counted population |
| Denominator | The eligible population, with inclusion and exclusion rules (§6) |
| Measurement source | The `MS-80-nnn` sources the formula reads, by reference |
| Interval basis | What opens and closes the measurement interval, expressed as a state condition rather than as a pair of events (§7) |
| Window | The time basis and interval (§7) |
| Release form | **`global` for every metric during the beta**, per decision 2. Any other value is a defect until the population decision is revisited |
| Suppression | What is reported when the aggregate cannot be released — never a zero, and never a blank (§8) |
| Connectivity | `CONN-REQUIRED` or `MANUAL-OK` (§5) |
| Owner | One of `product`, `security`, `synchronization`, `notifications` — the CBD-81 responsibility categories for a solo project |
| Data source | The system of record for the underlying state |
| Collection method | How the aggregate is computed, and inside which boundary |
| Review cadence | Proposed cadence. CBD-81 confirms or changes it |
| Unhealthy condition | The qualitative condition that makes this measure unhealthy. **Numeric thresholds are CBD-81's, not this record's** (§10) |

Duration metrics state the percentile they report. A bare mean is not an acceptable summary for a latency or time-to-outcome measure — and a percentile over a small population is itself a disclosure, so §8 applies to it.

## 5. Classification, prohibited content, and connectivity

### Class

Every metric declares one:

- **`aggregate-state`** — a coarse aggregate of service or account state under `AN-92-005`. Released only in the form §8 permits.
- **`reliability-telemetry`** — system health on the `AN-92-003` S1 allowlist. Never used to describe an individual's behavior, and never joined to anything under `AN-92-006`'s purpose separation.

A metric that appears to need both is split into two metrics rather than being marked as both. **`product-analytics` was v0.1's third class and is withdrawn**; nothing may be classified into it, because nothing may be collected for it.

### Prohibited content

The following never enter any source, attribute, dimension, aggregate, or metric label. The list is CBD-80's, restated here so all three metric packages apply it while writing rather than after review:

- raw transaction values
- credentials
- provider tokens
- bank-account numbers
- sensitive transaction descriptions
- free text of any kind

Beyond that list, `AN-92-003` and `AN-92-005` bar the identifiers themselves: no subject, space, resource, account, connection, destination, or device reference reaches a measurement surface, pseudonymous or not. `SG-93-022` adds that counterparty display names are third-party personal data and are never used in analytics.

`AN-92-006` requires purpose separation: reliability, security, support, audit, and aggregate-measurement schemas, stores, access roles, and retention stay distinct, and an identifier collected for one purpose is never joined or reused for another. A metric may not read a security-telemetry store, and `AN-92-004` keeps `DI-91-053`, `DI-91-062`, and `DI-91-071` single-purpose.

### Connectivity marker

Every metric is marked `CONN-REQUIRED` or `MANUAL-OK`. `MANUAL-OK` means the metric is computable during manual-product beta without bank connectivity. This satisfies the CBD-13 criterion that connectivity-dependent metrics are marked for later availability rather than blocking measurement.

## 6. Denominator discipline

Every rate metric names its eligible population explicitly. A denominator of "all users" is rejected unless that is genuinely the eligible set and the document says why.

- Inclusion and exclusion rules are stated as conditions, not prose.
- **Retries and abandonment do not inflate completion.** A person who abandons and retries counts once in the denominator. Because no per-person attempt record is retained, the derivation states which state the count reads — an outcome reached, not an attempt observed. That is a stronger guarantee than v0.1's duplicate handling, and it is a consequence of the constraint rather than an improvement on it.
- Where a denominator depends on a lifecycle state, the states are enumerated completely (§9).
- A metric whose denominator can be zero states what is reported in that case. It is not silently reported as zero percent.

## 7. Time, windows, and intervals

- **Time basis** — UTC. Any metric expressed in customer-local terms says so and names the local-date rule it uses, which is the schedule engine's, not a new one.
- **Windows** — stated as an explicit interval with both bounds. A window that follows the customer's budget cadence says so rather than assuming a calendar week.
- **Intervals** — expressed as **state conditions**, not as a start event and an end event. *"Spaces whose first confirmed period exists and whose profile is complete"* is an interval basis; *"time from `onboarding.started` to `budget_period.created` for one person"* is a journey, and `AN-92-001` names journeys.
- **Retention** — computed as an aggregate of account state across two windows: how many accounts active in window A were also active in window A+4. **The word cohort is not used**, because `AN-92-001` names cohorts and because the permitted computation is not one: no cohort is persisted, no member list exists, and the result cannot be drilled into. CBD-78 states the activity definition and both windows.
- **Segmentation** — none during the beta, per decision 2. The `budget-cadence` vocabulary in §9 stands as the naming to use when segmentation is introduced, and is not used before then.

## 8. Release form and suppression

**Every beta metric releases a single whole-population figure.** No breakdown, no segment, no percentile band that describes fewer people than the whole.

A metric that cannot be released in that form is **not released**. The `Suppression` field states which, in these terms:

- `withheld — population below release threshold`, never a zero and never a blank. A zero states that the measured thing did not happen; a withheld figure states that it may have.
- A withheld metric is still defined, still computed inside the boundary, and still reviewed by its owner under CBD-81. **Suppression governs release, not computation.**
- A metric whose value would be materially disclosive even as a global figure — where the population is small enough that one participant's behaviour moves it visibly — is withheld on the same rule. The owner judges this and records the judgment.

**No minimum cell size is set here.** Decision 2 makes one unnecessary for the beta by releasing no cells. When segmentation is introduced, a minimum belongs in that decision, and CBD-81 owns it.

## 9. Closed vocabularies

These sets are restated across CBD-77 through CBD-81. Naming some members but not all is a defect, which is what `scripts/check-doc-vocabulary.py` exists to catch. Each set is registered in `VOCABULARIES` scoped to exact filename globs — `cbd-13-*.md`, `cbd-77-*.md`, `cbd-78-*.md`, `cbd-79-*.md`, `cbd-80-*.md`, `cbd-81-*.md` — and never to a broad `cbd-7?-*` pattern, which would sweep in the approved CBD-73 through CBD-76 documents and report their correct text as broken.

| Vocabulary | Members | Owning section |
| --- | --- | --- |
| metric-class | `aggregate-state`, `reliability-telemetry` | §5 |
| connectivity-marker | `CONN-REQUIRED`, `MANUAL-OK` | §5 |
| budget-cadence | `weekly`, `monthly`, `paycheck`, `custom` | §7, from the approved CBD-67/CBD-68 cadences. **Not used during the beta** |
| invitation-state | `sent`, `accepted`, `expired`, `revoked`, `declined` | CBD-78 |
| notification-state | `enqueued`, `delivered`, `failed`, `suppressed`, `duplicate`, `late` | CBD-79 |
| alert-quality-state | `duplicate`, `late`, `incorrect`, `acknowledged`, `dismissed` | CBD-79, restated in the CBD-13 parent criteria |
| collaboration-action | `viewing`, `editing`, `acknowledgement`, `commenting` | CBD-78 |

The alert-quality set is the highest-risk one: it appears in CBD-79's criteria, in the CBD-13 parent criteria, and will appear again in CBD-80 and CBD-81. It is the exact shape of defect the vocabulary checker was written for.

## 10. Boundaries between the five packages

| Question | Settled by | Not settled by |
| --- | --- | --- |
| What is measured, and how it is computed | CBD-77, CBD-78, CBD-79 | CBD-80 |
| Source names, IDs, attributes, privacy and retention rules | CBD-80 | CBD-77–79, which propose only |
| Numeric targets, guardrails, baseline periods | CBD-81 | CBD-79 |
| The qualitative condition that makes a measure unhealthy, and the operational response | CBD-79 for reliability and safety measures; the owning package otherwise | CBD-81 |
| Review cadence | CBD-81 confirms | CBD-77–79 propose |
| When segmentation is introduced, and any minimum cell size it needs | CBD-81 | This document, which sets none |

**Known overlap.** CBD-79's criteria require *"an initial threshold or baseline rule and an operational response"* for each unhealthy condition, while CBD-81's require an initial target, guardrail, or baseline period for every beta metric. Read literally, both own the number. The split above gives CBD-79 the condition and the response and CBD-81 the number, so that a single change of target does not require reopening CBD-79. **This split is a proposal and needs Product Owner confirmation before CBD-79 is written.**

## 11. Acceptance criteria that conflict with an approved contract

Four subtask criteria were written against the v0.1 event model and could not be satisfied as worded. They are recorded here rather than quietly reinterpreted. **All four were amended in Jira on September 5, 2026, along with `CBD-80`'s summary** — the table below is kept as the record of what changed and why. The approved contract governed in every case.

Each amended criterion carries its amending sentence and the contract that forced it, so the Jira text explains itself without this document.

| Criterion | As written | Conflict | Proposed amendment |
| --- | --- | --- | --- |
| `CBD-77-AC01` | *"Every activation metric has an exact numerator, denominator, **start event, end event**, and time window."* | `AN-92-001` names user journeys and funnels. A per-person start and end event is a journey | Replace start and end event with **interval basis**, expressed as a state condition (§7) |
| `CBD-78-AC04` | *"Four- and eight-week active retention have exact activity and **cohort** definitions."* | `AN-92-001` names cohorts | Replace cohort with **two named activity windows**, computed as an aggregate with no persisted membership (§7) |
| `CBD-78-AC05` | Requires retention to be **segmented by cadence**, naming all four | Decision 2 releases no segments during the beta; at 30 monthly active users a four-way split produces cells of one | **Defer.** Restate as a post-beta capability, gated on the population decision CBD-81 owns. The criterion also spells one cadence *"paycheck-based"* where §9 fixes `paycheck`; the amendment adopts the vocabulary spelling |
| `CBD-80-AC02`, `AC05` | *"Product analytics and operational telemetry are distinguished"*; *"Retention, access, **consent**, export, and deletion expectations are documented for analytics data."* | `AN-92-001` disables product analytics, so there is no such class to distinguish or govern; `AN-92-002` states that consent does not make a prohibited mechanism permitted | Distinguish **`aggregate-state` from `reliability-telemetry`** (§5); drop the consent basis, which cannot do the work asked of it |

`CBD-80`'s summary was *"Create the analytics event catalog and privacy rules"* and is now **"Create the measurement-source register and privacy rules"**. The privacy half of the title survived intact.

## 12. Package conventions

Each of CBD-77, CBD-78, and CBD-79 produces:

- `docs/cbd-<n>-<topic>.md` — the metric definitions.
- `docs/cbd-<n>-acceptance-criteria-traceability.md` — the traceability and completeness report, matching the CBD-76 report's structure.
- `scripts/audit-cbd-<n>.py` — the structural audit.

Neither the metric documents nor the audit scripts modify `.github/workflows/ci.yml`. It is a shared surface that all three packages would otherwise touch; a single follow-up change wires the three audit steps after the three documents merge. `scripts/check-doc-vocabulary.py` carries this document's vocabularies already, scoped to `cbd-13-*.md`, and each package adds its own glob when it merges.

Version pins follow the repository convention: the pinned document's path in one table cell and `Document version **x.y**` in the next, so `scripts/check-jira-freshness.py` can compare the pin against the source.

## 13. Open questions

| ID | Question | Blocking |
| --- | --- | --- |
| ~~`OQ-13-001`~~ | ~~Does this document belong to a new CBD-13 subtask that blocks CBD-77–79?~~ **Closed September 5, 2026 — yes.** `CBD-368` owns it and blocks all three | Closed |
| `OQ-13-002` | Is the CBD-79 / CBD-81 threshold split in §10 correct? | CBD-79 |
| `OQ-13-003` | The approved CBD-76 traceability report records CBD-1-AC05 coverage as *"CBD-13 and CBD-77–80"* and does not name CBD-81. Is that omission deliberate? | Nothing; record for post-merge correction |
| ~~`OQ-13-004`~~ | ~~Are the four §11 amendments accepted as worded, and does `CBD-80`'s summary change with them?~~ **Closed September 5, 2026 — accepted as worded, and the summary changed.** Applied in Jira the same day | Closed |
| ~~`OQ-13-005`~~ | ~~What is the authorized operational boundary `AN-92-005` requires?~~ **Closed September 5, 2026 — the Worker deployment unit**, on `TD-103-001` and `TD-103-002`. §2.3 decision 3 carries the reasoning and the separate release-surface constraint | Closed |
| `OQ-13-006` | `OP-92-002` bars **counts** from the routine support surface, and `AN-92-005` permits releasing aggregates for product decisions. Which surface carries a released figure, and who may read it? | CBD-80, which must record the release surface per source. Raised by decision 3 |

## 14. Revision record

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 0.3 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | **Closes `OQ-13-001`, `OQ-13-004` and `OQ-13-005`.** The authorized operational boundary is the **Worker** deployment unit, on `TD-103-001`'s two units and `TD-103-002`'s *"exactly one place"* property; a separate reporting process would have been a third executor and cost it. The four conflicting criteria and `CBD-80`'s summary are amended in Jira. **`CBD-368` is created to own this document** and blocks CBD-77, CBD-78 and CBD-79, mirroring CBD-102's role for CBD-15. Raises `OQ-13-006`: `OP-92-002` bars counts from the routine support surface, so the release surface is a separate question from the boundary and CBD-80 records it per source. No metric, measurement source, threshold, or vocabulary changes | Draft; Product Owner approval required |
| 0.2 | September 5, 2026 | Claude with Alexander Wohlford as Product Owner | **Re-architected onto `AN-92-005`.** v0.1 specified an analytics event catalog, per-event `actor_ref` and `space_ref`, activation funnels with start and end events, a `product-analytics` stream, and retention cohorts — each named as disabled by `AN-92-001`, which `RV-92-005O` and `EG-91-019` confirm is settled rather than open. §2 records the collision and the two Product Owner decisions of September 5, 2026: re-scope to aggregate state, and release global figures only during the beta. §3 replaces events with measurement sources, §8 adds release and suppression rules, and §11 records the four subtask criteria that now need Jira amendment. The CBD-76 pin moves from 1.0 to 1.0.1 | Draft; Product Owner approval required |
| 0.1 | September 5, 2026 | Alexander Wohlford | Initial conventions draft: metric record shape, event naming, stream classification, denominator discipline, closed vocabularies, and package boundaries | Superseded by 0.2 |
