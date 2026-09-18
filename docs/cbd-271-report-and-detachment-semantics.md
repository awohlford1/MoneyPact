# CBD-271 — Report and Subject-Controlled Detachment Semantics for Shared Comments

| Field | Value |
| --- | --- |
| Status | **Draft** — not approved. Written to close the two-remedy delegation CBD-270 §2 makes to this package. Approval authority is the Product Owner, with the qualified safety and privacy review CBD-273 obtains and the abuse-case exercise CBD-272 runs. Neither is complete, so `EG-93-009` and `RG-94-011` remain open and shared comments remain unshippable. |
| Document version | 0.1 |
| Owner | Alexander Wohlford |
| Reviewer | Pending — Product Owner, plus the qualified reviewer CBD-273 engages |
| Jira | [CBD-271](https://cobudget.atlassian.net/browse/CBD-271) |
| Parent | [CBD-131](https://cobudget.atlassian.net/browse/CBD-131) — Establish the platform-safety operating model for shared comments |
| Companions | CBD-270 platform-safety operating model; CBD-272 abuse-case exercise; CBD-273 qualified safety and privacy review |
| Confluence page | Not registered. `config/confluence-publication.json` needs the entry recorded in §12.1 before publication. |
| Repository baseline | `7cd0241` |
| Last updated | September 17, 2026 |

**What this document is.** CBD-270 is the operating model for the platform
safety process. It deliberately does not specify the two remedies `RI-93-008`
decided — the report action and subject-controlled detachment — and says so at
§2: *"`RI-93-008` decided that they exist; CBD-271 decides audience behaviour,
association semantics, copy fields, and failure cases."* This document is that
specification. It is written so that the shared-comments feature can implement
both remedies without inventing behaviour, and so that a reader can verify
mechanically that neither remedy grants anybody a power the approved sources
deny.

**Conditional decisions.** Nothing in this document depends on the platform
content power `OQ-270-006` leaves open. Both remedies here are self-regarding
or platform-directed and exist whether or not that power is ever granted. Where
a CBD-270 decision that *is* conditional touches a remedy — the `PS-270-033`
interim measure and the `PS-270-053` author notice — this document states the
interaction and grants nothing.

## 1. Purpose and authority

`RI-93-008` decided, on August 16, 2026, that *"a targeted person may detach the
association from their own attributed record/presentation without editing,
globally hiding, or deleting the preserved authored content/evidence. The
action creates no financial effect or general moderation authority. Exact
audience behavior, copy, evidence access, retaliation/failure cases, and
platform response remain gated by `EG-93-009`/`RG-94-011`."* CBD-270 wrote the
platform response. This document writes the rest of that sentence: audience
behaviour, association semantics, copy fields, evidence access, and the
retaliation and failure cases, for both the report and the detachment.

The problem both remedies answer is `AB-93-034`: a person harassed through
comments on their own transactions has no in-product remedy, because
`DL-76-020` denies every role — Primary Owner included — the authority to edit,
remove, hide, or moderate another author's contribution. The remedies must
therefore give the harassed person something real **without** giving anyone the
power `DL-76-020` withholds. That constraint is the whole design, and §3 states
it as a rule the audit script enforces.

Every decision carries a stable `PS-271-*` key and cites the approved source
that forces it, following CBD-270's `PS-270-*` convention. `PS-271-*` and
`OQ-271-*` numbers are never reused or renumbered; a revision that adds a
decision appends the next free number and places it in the section it belongs
to. Stability is of the number, not of the text behind it, and §14 records
every change.

### 1.1 Authoritative inputs and pinned versions

CBD-270 is the immediate authority and is pinned at its current version. The
eight source documents below — the six approved packages CBD-91, 92, 93, 94,
95, and 76 — are pinned at **exactly the versions CBD-270 §1.1 states**, so
that the two documents cannot read different text. The audit
script (§11.3 check 2) reads CBD-270 §1.1 and fails if any version here
differs from it.

| Source | Pinned version | What it binds here |
| --- | --- | --- |
| `docs/cbd-270-platform-safety-operating-model.md` | Document version **0.5.2** | The whole operating model. Directly: `PS-270-016` (what the report is for), `PS-270-017` (the submission is the evidence), `PS-270-018` (intake notifies no one), `PS-270-023` (intake disclosures and the item-4 election), `PS-270-040`–`PS-270-044` (case record, exclusion, independence, retention shape), `PS-270-052` (what the reporter receives), `PS-270-054` (indistinguishability), `PS-270-075` and `PS-270-078` (the remedy set and the no-proposal rule), `PS-270-076` (machine-mediated resolution); `OQ-270-001`, `OQ-270-004`, `OQ-270-005`, `OQ-270-006`, `OQ-270-008`, `OQ-270-009` as the questions this document inherits |
| `docs/cbd-91-private-mvp-data-inventory.md` | Document version **1.0.5** | `DI-91-001` account subject, `DI-91-026` comment bodies, `DI-91-028` recipient-personal state as the pattern for detachment state, `DI-91-029` notification destinations, `DI-91-038` security evidence, `DI-91-043` support submissions, `DI-91-063` case routing metadata; `EG-91-002` and `EG-91-009` as the open gaps this document reports into |
| `docs/cbd-92-system-flow-technical-threat-model.md` | Document version **1.0.1** | `OP-92-001`–`OP-92-003`, `OP-92-005`, `OP-92-007` staff boundary; `AN-92-001`, `AN-92-003`, `AN-92-006` purpose separation; `RL-92-001`, `RL-92-003`, `RL-92-005` ceilings and anti-oracle rules; `SA-92-007` audit; `PA-92-001`–`PA-92-005` deletion lifecycle; `EM-92-003` and `NT-92-001` channel ceilings; `XSP-02` |
| `docs/cbd-93-privacy-coercion-abuse-analysis.md` | Document version **1.1.2** | `AB-93-023`–`AB-93-032`, `AB-93-034`, `AB-93-074`; `SG-93-024`, `SG-93-037`–`SG-93-039`, `SG-93-084`, `SG-93-086`, `SG-93-088`, `SG-93-091`–`SG-93-094`; `EG-93-009` |
| `docs/cbd-94-risk-mitigation-requirement-register.md` | Document version **1.0.4** | `RK-94-014`, `RK-94-015`; `SR-94-063`–`SR-94-065`, `SR-94-067`, `SR-94-072`, `SR-94-074`, `SR-94-090`, `SR-94-097`–`SR-94-099`, `SR-94-101`–`SR-94-104`, `SR-94-130`, `SR-94-131`; `RG-94-009`, `RG-94-011` |
| `docs/cbd-94-verification-review-inventory.md` | Document version **1.0** | Pinned for parity with CBD-270 §1.1; no `VT-94-*` row is cited directly here |
| `docs/cbd-95-cbd-12-reconciliation-matrix.md` | Document version **1.0.4** | `RI-93-008` report plus subject-controlled detachment; `RI-93-016` cross-cutting copy standard; `RI-93-017` support refusal with a safe answer; `RC-95-020` noninterference |
| `docs/cbd-95-architecture-roadmap-follow-up-register.md` | Document version **1.0.11** | `FU-95-025`, which routes this work and states the boundary; `FU-95-017` and `FU-95-021`, which own exact strings |
| `docs/cbd-76-mvp-boundary-and-readiness-record.md` | Document version **1.0.1** | `DL-76-020` and `INC-76-012` — the approved non-moderation rule neither remedy may weaken |

CBD-72 §5.6 items 1, 2, 4, 5, 6, 7, 8 and 9, §5.7 item 3, and permissions 11a,
11b, 11c, and 11d are cited from the approved collaboration permission model
at document version **0.1.55**. CBD-270 §1.1 cites the same rows at 0.1.54;
the 0.1.55 amendment (September 15, 2026) added row 36 for manual accounts
and changed nothing in §5.6, §5.7, or rows 11a–11d, so the two citations read
identical text. Permission 11d is the row both remedies live under:
*"Budget-space ownership grants no editorial or moderation authority over
another person's contribution. Serious abuse, unlawful content, or accidental
disclosure uses a separate platform safety/support process outside
budget-space role permissions."*

### 1.2 What CBD-270 delegates here, and the Jira criteria that bind

CBD-270 delegates to this document at four sites, each quoted so that the
delegation's edges are visible:

* §2: *"It does not specify the report action or the detachment semantics.
  `RI-93-008` decided that they exist; CBD-271 decides audience behaviour,
  association semantics, copy fields, and failure cases. §5 here defines only
  what intake must deliver to the process."*
* `PS-270-016`: *"CBD-271 specifies the action; this decision fixes what it is
  for. Anyone who can currently read the target may report."*
* `PS-270-042`: *"A detachment therefore changes presentation and leaves case
  evidence intact. ... CBD-271 owns the exact association semantics."*
* `PS-270-075` remedy table, row 1: *"Subject-controlled detachment — detach
  the comment's association from your own attributed record, without editing,
  hiding, or deleting the authored content — `RI-93-008`, decided; CBD-271
  specifies it — the reporter, directly, in product."*

The Jira issue's acceptance criteria are binding and are quoted verbatim from
the Acceptance Criteria field (`customfield_10066`), read September 17, 2026:

| Criterion | Text |
| --- | --- |
| `CBD-271-AC01` | The specification states what a report captures, how long it is retained, who may read it, and that it lives as isolated S3 text under SR-94-072. (Supports: CBD-131-AC03, AC04) |
| `CBD-271-AC02` | Detachment semantics state what detaching removes from the subject's attributed record, what it preserves, and what the author and every other member see afterwards. (Supports: CBD-131-AC03) |
| `CBD-271-AC03` | Confidentiality limits and the CBD-91 data-class assignment for report records are recorded. (Supports: CBD-131-AC04) |
| `CBD-271-AC04` | The specification states that neither remedy edits or deletes another author's content, grants any role moderation authority, or changes any financial state. (Supports: CBD-131-AC03) |
| `CBD-271-AC05` | The dependency on a shared-comments feature story is recorded and raised with the Product Owner, and completion records the PR and merge SHA. (Supports: CBD-131-AC09; CBD-2-AC27) |

The description body's four **Deliverables** bullets are binding too, and are
the same four things in prose:

* *"What a report captures, how long it is retained, who may read it, and where
  it lives as isolated S3 text under `SR-94-072`."*
* *"Detachment semantics: what detaching removes from the subject's attributed
  record, what it preserves (the authored content and the evidence), and what
  the author and every other member see afterwards."*
* *"Confidentiality limits and the data-class assignment for report records."*
* *"A statement that neither remedy edits or deletes another author's content,
  grants any role moderation authority, or changes any financial state."*

§13 maps each criterion to the sections that satisfy it. One criterion is met
only in part, and the reason is stated at `PS-271-014` rather than papered
over: a retention *period* is the one thing `CBD-271-AC01` asks for that no
approved source allows this document to set.

## 2. What this document does not decide

* It sets no retention period, deletion rule, redaction rule, or legal-hold
  rule for report records. `PS-270-044` records that `DI-91-043` leaves them
  unknown and `EG-91-009` owns them; `OQ-270-004` routes the value. §5 states
  the retention *shape* and nothing else.
* It grants no platform content power and asserts none. `OQ-270-006` is open,
  and every CBD-270 decision that presupposes the power stays conditional.
  Detachment is not a content power: it acts on the subject's own presentation
  and on nothing the author wrote.
* It approves no strings. Copy is specified as semantic fields with `RI-93-016`
  constraints; exact wording, localization, and accessibility evidence are
  `FU-95-017` and `FU-95-021` work under CBD-367.
* It gives no non-user standing. A person named in a comment who has no account
  has no report and no detachment path; `OQ-270-005` owns the question.
* It does not decide what happens to a report, a case, or a detachment state
  when the reporter or the author deletes their account under
  `PA-92-001`–`PA-92-005`. `OQ-270-008` and `EG-91-002` own that, and
  `OQ-271-004` records the detachment half.
* It does not create the shared-comments feature story. `CBD-271-AC05` asks
  that the dependency be recorded and raised; §10 records it, and raising it is
  a Manager and Product Owner action.
* It closes no gate. `EG-93-009`, `RG-94-009`, and `RG-94-011` stay open.

## 3. The `RI-93-008` boundary

This section is `CBD-271-AC04`. It is stated first because every later
decision is bounded by it, and it is stated as literal sentences because §11.3
check 3 asserts them and scans every decision body for a grant that would
contradict them.

`PS-271-001` — **Neither remedy acts on another author's content or on
financial state, and neither grants any power to anyone.**

Stated as the rule the audit enforces, in six sentences:

1. The report action **never edits**, never hides, never deletes, and **never
   alters authored content**. It creates a customer submission about a comment
   and changes nothing about the comment itself.
2. Subject-controlled detachment **never hides** a comment from anyone but the
   person who detached it, **never deletes** it, never edits it, and never
   alters authored content. It changes one person's own presentation and
   nothing else.
3. Each remedy **never alters financial state**, in the sense `SR-94-090` and
   CBD-72 §5.6 item 1 require: no transaction value, category, schedule,
   reconciliation relationship, acknowledgement, alert, or derived indicator
   changes because a report was filed or a comment was detached.
4. Each remedy **grants no editorial, moderation, membership, role, or
   lifecycle power** to any person, role, or process — the phrase is the one
   check 3 asserts. A reporting Primary Owner and a reporting Viewer receive
   identical remedies. The platform safety process receives no power from this
   document it did not already hold under CBD-270, and CBD-270 holds none over
   content (`PS-270-075`).
5. The author's own authority is untouched: permission 11b (edit own) and 11c
   (remove own) are unchanged by a report and unchanged by a detachment.
6. The prohibition in `PS-270-078` binds every customer-facing field this
   document specifies: nothing proposes, recommends, or describes as available
   any membership, role, scope, invitation, archival, or other lifecycle
   action.

The mechanical shape of this rule is §11.3 check 3: the six bold phrases above
must appear in this decision verbatim, and no decision body in this document
may pair a granting form with a content-power verb except where an explicit
allowlist entry quotes the sentence.

**Source:** `RI-93-008`; `FU-95-025`; `DL-76-020`; `INC-76-012`; permission
11d; CBD-72 §5.6 items 1 and 4; `SR-94-090`, `SR-94-102`; `PS-270-001`,
`PS-270-008`, `PS-270-075`, `PS-270-078`.

`PS-271-002` — **Both remedies are self-regarding or platform-directed. Neither
acts on the other person, and neither is a route to something that does.**

`PS-270-075` lists the three remedies that survive the absent content power and
records why a fourth — telling a reporting owner that their membership powers
remain — was struck: it acted on the other person. The two remedies specified
here are the first of those three and the intake to the process that holds the
other two. A report asks the platform to look at a submission; a detachment
changes what the subject sees. Nothing in either reaches the author's content,
the author's membership, the author's standing, or the author's notifications,
and no field in either surface points toward a product surface that could.

**Source:** `PS-270-075`, `PS-270-078`; `DL-76-020`; `SG-93-093`.

`PS-271-003` — **Detachment state is personal, non-authorizing presentation
state on the `DI-91-028` pattern. It is not a lifecycle state of the comment.**

CBD-91 already has a class for one person's private relationship to a shared
fact: `DI-91-028`, recipient-personal alert instances and acknowledgements,
where *"the shared fact remains independently visible by policy"* and the
personal state is *"recipient only"*. Detachment is the same shape applied to
a comment. The comment's own lifecycle — created, edited, removed, tombstoned,
frozen with its target — is `DI-91-026` state governed by CBD-72 §5.6, and
detachment does not enter it. A detached comment is not "removed", not
"hidden", and carries no flag any other reader's view consults.

**Source:** `DI-91-028`, `DI-91-026`; CBD-72 §5.6 items 6 and 7; `SR-94-098`.

## 4. Actors and eligibility

`PS-271-004` — **Anyone who can currently read the target may report the
comment. Being the comment's subject is not adjudicated.**

`PS-270-016` fixes this and it is restated here because the alternative is
worse than it looks. A rule that admitted only "the person the comment is
about" would require the product to decide who a comment is about — which is
reading and characterizing content, forbidden to the process by `OP-92-003`
and to every role by `DL-76-020`. Eligibility is therefore the same
authorization check CBD-72 §5.6 item 2 already performs for every comment
operation: can this actor read this target right now. The reporter's
statement may say why they are reporting; the product does not verify it.

**Source:** `PS-270-016`; CBD-72 §5.6 item 2; `SG-93-037`; `OP-92-003`.

`PS-271-005` — **Anyone who can currently read the target may detach the
comment from their own presentation. The "targeted person" of `RI-93-008` is
self-declared, and the rule is recorded as `OQ-271-001` for confirmation.**

The same reasoning applies: subject-hood cannot be adjudicated without reading
content, and a detachment is self-regarding, so admitting every reader costs
nothing and denies no one. A reader who detaches a comment that is not about
them has changed their own view and nothing else. The one substantive question
is whether the Product Owner intends the narrower reading of "targeted person",
and `OQ-271-001` asks it rather than settling it here.

**Source:** `RI-93-008`; `SG-93-037`; CBD-72 §5.6 item 2; `PS-270-016` as the
precedent.

`PS-271-006` — **Neither action is offered against the actor's own comment. The
author's remedies are permissions 11b and 11c.**

A person reporting or detaching their own comment is asking for something the
role model already gives them. The composition surface shows the author their
own affordances under permissions 11b and 11c and not the report or detach
affordances. A request that reaches the service anyway is acknowledged with the
uniform outcome (`PS-271-037`) and has no effect — it opens no case and
records no detachment — because the only fact it would reveal, that the actor
authored the comment, is one the actor already holds.

**Source:** permissions 11b and 11c; CBD-72 §5.6 item 4; `PS-270-013`.

`PS-271-007` — **No role receives different remedies, different weight, or
different visibility.**

Primary Owner, Co-owner, Collaborator, Accountability Partner, and Viewer file
the same report, see the same acknowledgement, and detach the same way.
`PS-270-008` denies a reporting owner any additional standing, and `PS-270-022`
denies volume any weight; both bind the surfaces specified here. A Viewer,
who cannot comment under permission 11a, can read supported targets and may
therefore report and detach — the remedies follow readability, not authorship.

**Source:** `PS-270-008`, `PS-270-022`; permission 11a; `DL-76-020`;
`SR-94-102`.

## 5. The report action

This section is the first half of `CBD-271-AC01` and `CBD-271-AC03`. It
specifies what a report captures, where it lives, who may read it, the
retention shape, and what everyone sees afterwards. It does not repeat
CBD-270's process: severity, response targets, escalation, appeal, and audit
belong to `PS-270-024` onward and are cited, not restated.

`PS-271-008` — **A report is accepted only from an authenticated actor whose
read authorization on the target and the comment is confirmed at request
time, and every failing check yields the uniform outcome.**

The check is the one CBD-72 §5.6 item 2 already requires for every comment
operation, run again at submission — not at page render — so that a reader who
lost access between opening the thread and pressing submit is refused. The
refusal is indistinguishable from a non-resolving reference: same outcome
class, same latency class, same record shape. `PS-270-076` constraint 1 states
why this gate must run before anything else, and the reason holds here: without
it the report action is an unsolicited-notification primitive and an existence
oracle.

**Source:** CBD-72 §5.6 item 2; `PS-270-076`; `PS-270-013`; `RL-92-003`;
CBD-72 `XSP-02`.

`PS-271-009` — **A report captures exactly the fields below, each assigned a
CBD-91 data class, and nothing else.**

| Field | Captured how | Class | Sensitivity |
| --- | --- | --- | --- |
| Case reference | Minted by the service; opaque, unguessable, unique per case; carries no space, target, comment, or party information in its form | `DI-91-063` | S2 |
| Target reference | Opaque reference to the comment's target resource, as held by the reporter's authorized session | `DI-91-063` | S2 |
| Comment reference | Opaque reference to the one comment reported | `DI-91-063` | S2 |
| Captured copy of the comment body | Taken by the service from the reporter's own read of the target at submission — the read `PS-271-008` just checked — byte-for-byte as rendered to the reporter. The reporter does not retype, trim, or annotate it. The copy carries the body text and the comment's edited indicator; it carries **no** author display name, avatar, or profile field | `DI-91-043` | S3 |
| Capture-time integrity evidence | A digest over the captured bytes, stored with the submission so that later change to the submission is detectable under `SR-94-064`. It is evidence about the submission, not a key into the stored comment — see `OQ-271-003` | `DI-91-043` | S3 |
| Case class | Optional. One of the three `PS-270-002` classes — harassment, unlawful content, accidental disclosure — chosen by the reporter. Non-binding: `PS-270-025` assigns severity and fails upward regardless | `DI-91-063` | S2 |
| Reporter statement | Optional bounded free text, entered after the `PS-270-023` item-2 warning is shown | `DI-91-043` | S3 |
| Item-4 election | Required explicit choice, never preselected: apply, or decline, any measure that notifies the reported author. Stored under the `PS-270-023` fixed-field discipline and rendered to no person | `DI-91-043` | S3 |
| Reporter subject identifier | The authenticated account subject, for routing status back to the reporter and for the per-reporter ceilings `PS-270-020` and `PS-270-033` name | `DI-91-063` | S2 |
| Submission timestamp | Service time, at the granularity the audit taxonomy fixes | `DI-91-063` | S2 |
| Space-scoped party tokens and the comment-scoped duplicate key | Minted system-side by the `PS-270-076` resolution step, under its eight constraints; the author's subject identifier and destination are resolved by that step and are **not** written into the report | `DI-91-063` | S2 |

**Not captured, and the list is closed:** any other comment in the thread; any
reply; the target's financial fields; the space's membership or roles; the
author's identity, display name, or notification destination; any other
reader's state; device, network, or location telemetry beyond what the
`DI-91-038` security evidence class already collects for every authenticated
request; and whether the reporter has detached the comment (`PS-271-026`).

**Source:** `PS-270-017`, `PS-270-040`, `PS-270-023`, `PS-270-076`;
`DI-91-043`, `DI-91-063`; `SR-94-064`; `OP-92-002`.

`PS-271-010` — **The captured copy is the reporter's submission in the
`OP-92-002` sense, and the platform does not compare it to the stored
comment.**

The copy is what lets the process function inside `OP-92-001` (`PS-270-017`).
It is captured rather than retyped so that the reporter cannot change it and
so that the author's foreseeable contest — "that is not what I wrote" — is
about provenance, not transcription. That contest is still `PS-270-048`
territory: no approved row lets anyone in the process read the stored comment
to settle it, and no approved row lets a machine compare the two on the
process's behalf. The integrity digest in `PS-271-009` therefore proves that
the *submission* is unchanged since capture; whether it may ever be compared
machine-side against the stored body is `OQ-271-003`, which travels with
`OQ-270-001` and `OQ-270-009`.

**Source:** `OP-92-001`, `OP-92-002`, `OP-92-003`; `PS-270-017`, `PS-270-048`;
`SR-94-064`.

`PS-271-011` — **The report record has the three parts `PS-270-040` defines,
and every field in `PS-271-009` belongs to exactly one of them.**

| Part | Fields | Class | Boundary |
| --- | --- | --- | --- |
| Reporter submission | Captured copy, integrity evidence, reporter statement, item-4 election | `DI-91-043`, S3 free text | Restricted support-content boundary, isolated per `SR-94-072`. The election sits inside this boundary but outside the handler's view: it is read by the two `PS-270-053` machine gates and rendered to no person |
| Case routing and correlation | Case reference, target and comment references, case class, reporter subject identifier, submission timestamp, party tokens, duplicate key | `DI-91-063`, S2 | Separate metadata record; safe category, status, and opaque correlation only; no bodies |
| Decision record | Created later by the process under `PS-270-040`; this document adds no field to it | `DI-91-038`-adjacent | `OP-92-007` pattern |

**Source:** `PS-270-040`; `DI-91-043`, `DI-91-063`, `DI-91-038`; `SR-94-072`;
`OP-92-007`.

`PS-271-012` — **The submission lives in an isolated store inside the
restricted support-content boundary, not in the application datastore, and is
joined to nothing.**

`SR-94-072` requires that abuse and support submissions be *"isolated S3 free
text, excluded from all budget-member/admin exports and customer history, and
accessible only through the approved operating purpose."* Concretely:

* The submission store is separate from the datastore that holds `DI-91-026`
  comments, targets, memberships, and financial records. There is no foreign
  key from a submission to a comment row, a target row, or a member row; the
  link is the opaque reference, resolvable only through the `PS-270-076` step.
* No export — budget-member, administrative-history, personal-data, or
  operator — includes a submission or a routing record. CBD-72 §5.7 item 3
  already excludes support notes from the administrative-history export, and
  `PS-270-041` generalizes it.
* No analytics, reliability telemetry, or search index receives a submission,
  a statement, or a case identifier (`PS-270-043`; `AN-92-001`, `AN-92-003`,
  `AN-92-006`).
* A submission the service cannot write into this boundary is not accepted.
  There is no fallback to any other store; see `PS-271-018` row 10.

**Source:** `SR-94-072`; `PS-270-041`, `PS-270-043`; CBD-72 §5.7 item 3;
`AN-92-006`; `AB-93-074`.

`PS-271-013` — **Who may read a report is a closed set, and the reported
author is not in it.**

| Reader | What they may read | Under |
| --- | --- | --- |
| The reporter | Their own submission — captured copy, statement, class — and the case status and outcome class `PS-270-052` allows, through the authenticated in-app surface only | `PS-270-042` ("the reporter's own submission is theirs"); `PS-270-051` |
| The assigned case handler | The submission and the routing record for the one case assigned to them; never the election, never the author's identity or destination, never any other case by person | `PS-270-046`, `PS-270-047`, `PS-270-076` |
| The `PS-270-077` standing independent reviewer | The same, for post-use review of the handler's access and decision. **The function is unfilled** (`OQ-270-003`) | `OP-92-007`; `PS-270-050` |
| Jurisdiction-scoped counsel | The submission, on a `PS-270-057` row-3 escalation of an unlawful-content case | CBD-94 §3.6 |
| **Nobody else** | Not the reported author; not any member or Primary Owner of the space; not routine support, whose surface is content-free; not analytics; not a subprocessor absent the `PS-270-038` approval | `OP-92-001`, `OP-92-002`; `SR-94-067`; `PS-270-012`, `PS-270-038` |

The two machine gates in `PS-270-053` consult the election; no reader does.

**Source:** `PS-270-046`, `PS-270-047`, `PS-270-050`, `PS-270-052`,
`PS-270-077`; `OP-92-001`, `OP-92-002`, `OP-92-007`; `SR-94-067`;
`DI-91-043`.

`PS-271-014` — **Retention has the `PS-270-044` shape and no value. The value
is `OQ-270-004`, and `CBD-271-AC01` is met in part until it is answered.**

The shape required of the implementation: a defined period for each of the
three `PS-271-011` parts; a deletion path that removes the submission and
routing record together, so that a case reference can never outlive the
submission it names; a legal-hold exception with a named authority, since
`PS-270-057` row 3 places a submission in counsel's hands; and no
indefinite default. Whether a `Withdrawn` case shortens the period is part of
the same answer (`OQ-271-006`). This document sets no period, because
`DI-91-043` records support retention as unknown, `EG-91-009` owns it, and
`PS-270-044` already declined to invent one; a number written here would be a
false closure that `check-jira-freshness` could not catch. §11.3 check 7 fails
this decision if a duration ever appears in it.

**Source:** `PS-270-044`; `DI-91-043`; `EG-91-009`; `OQ-270-004`; `SR-94-063`.

`PS-271-015` — **Filing a report changes nothing anyone else can see, and
notifies no one.**

`PS-270-018` fixes the rule and this decision states its observable shape. On
submission: the comment is unchanged for every reader including the reporter;
no count, ordering, indicator, or tombstone changes; the reported author, the
Primary Owner, and every member receive no notice, no badge, no digest line,
and no email; the reporter's own presentation is unchanged, because a report
is not a detachment (`PS-271-026`). The reporter receives the case reference
and acknowledgement. The composition surface offers detachment beside the
report as a separate, independent action, so that a reporter who wants the
comment out of their own view does not have to believe that reporting achieves
it.

**Source:** `PS-270-018`, `PS-270-052`; `AB-93-034`; `RK-94-015`.

`PS-271-016` — **What the reporter receives afterwards is `PS-270-052`'s
table, and the terminal outcome class is the closed set `Actioned`,
`No action`, `Out of scope`, `Escalated`, `Withdrawn`.**

The reporter's case view shows the case reference, the status class, the
applicable `PS-270-029`-family target, the terminal outcome class, and the
appeal route against a no-action outcome. It never shows the severity, the
decision record, the handler, or anything about the reported author. `Actioned`
is unreachable while `OQ-270-006` is open; a case that would have been
`Actioned` terminates as `Escalated`, and the reporter is told the remedies
that apply on the `PS-270-048` pattern. The reporter may withdraw an open case
from the same view; withdrawal produces `Withdrawn`, notifies no one, and does
not re-attach a detached comment (`PS-271-026`).

**Source:** `PS-270-052`, `PS-270-048`, `PS-270-075`; CBD-270 §17.2;
`SG-93-086`.

`PS-271-017` — **Repeat and duplicate reports are idempotent per reporter,
grouped per comment, and never weighted.**

* The same reporter submitting the same comment while their case is open
  receives the same case reference; no second case opens. The reporter already
  knows they filed, so this reveals nothing.
* Different reporters submitting the same comment produce separate submissions
  grouped by the comment-scoped duplicate key for handling and counted once
  for the outcome (`PS-270-022`). No reporter learns that another exists.
* A report submitted after a prior case on the same comment closed opens a new
  case. Whether it can trigger a `PS-270-033` interim measure is governed by
  axis 7's non-refiring rule, not by this document.
* Filing carries the `PS-270-020` ceiling in `RL-92-001`'s protected-action
  class. A ceiling response is indistinguishable from an accepted one
  (`RL-92-003`), and reaching it never prevents a different person from
  reporting (`RL-92-005`). Values are `RF-92-012` work.

**Source:** `PS-270-020`, `PS-270-021`, `PS-270-022`, `PS-270-033`;
`RL-92-001`, `RL-92-003`, `RL-92-005`.

`PS-271-018` — **Report failure and edge cases, each with its observable
outcome.**

| # | Case | Behaviour | Observable to the reporter | Observable to anyone else |
| --- | --- | --- | --- | --- |
| 1 | Unauthenticated request | Refused before any check | The ordinary authentication outcome | Nothing |
| 2 | Target unreadable, non-existent, or a guessed reference | `PS-271-008` fails; nothing is resolved or recorded | The uniform outcome | Nothing |
| 3 | Comment removed by its author between render and submit | The read check fails, because a removed body has left ordinary access | The uniform outcome | Nothing |
| 4 | Comment changed by its author between render and submit | The copy captured is the body as the service reads it at submission, which is the current one; the edited indicator is captured with it | The ordinary acknowledgement | Nothing |
| 5 | Filing ceiling reached | Denied without state change; audited under `SA-92-007` | Indistinguishable from acceptance | Nothing |
| 6 | Same reporter, same comment, case open | Idempotent | The existing case reference | Nothing |
| 7 | Reporter loses target access after filing | The case continues on the submission. The case view is an account-level surface and needs no space access. The reporter's copy is still theirs | Unchanged case view | Nothing |
| 8 | Author removes the comment after filing | The case continues on the submission; the handler learns nothing, because the process has no read on the stored comment. The reporter may withdraw | Unchanged case view; the thread shows the ordinary 11c artifact | The ordinary 11c artifact |
| 9 | Reporter's or author's account is deleted | **Not decided here.** `OQ-270-008` | — | — |
| 10 | Submission store unavailable | Fail closed: no case, no partial record, no write to any other store; the request is safe to retry under a client idempotency key | A uniform "try again" error class that carries no case reference | Nothing |
| 11 | Report against the actor's own comment | `PS-271-006`: no effect | The uniform outcome | Nothing |
| 12 | Report arrives out of band — email, letter, demand | `PS-270-019`: triaged, converted or refused, never a content read | Not this surface | Nothing |
| 13 | Non-user named in a comment | No path exists. `OQ-270-005` | — | — |

**Source:** `PS-270-013`, `PS-270-019`, `PS-270-020`, `PS-270-048`;
`RL-92-003`, `RL-92-005`; `SA-92-007`; CBD-72 §5.6 items 2 and 6.

## 6. Subject-controlled detachment

This section is `CBD-271-AC02`. It defines the association, what detaching
removes, what it preserves, what every other person sees, and every
interaction with the comment's own lifecycle.

`PS-271-019` — **The association detached is a per-person presentation
association between one reader and one comment. It is distinct from the
comment's attachment to its target, which detachment never touches.**

Three things are in play and must not be confused:

| Thing | What it is | Owned by | Touched by detachment? |
| --- | --- | --- | --- |
| The comment's attachment to its target | `DI-91-026` linkage: this comment is on this transaction, in this thread, with these replies | The comment's lifecycle, CBD-72 §5.6 | **No** |
| The subject's attributed record | Every presentation of the target that the subject sees as their own: the thread as rendered to them, their reports and exports, their digests and notifications, their search results, their counts | The subject's authorized view | **Yes** — this is what "detach from your own attributed record" means |
| The presentation association | A per-(reader, comment) record with two states, `attached` (the default, which need not be materialized) and `detached` | The reader, as `DI-91-028`-pattern personal state | **Yes** — this is the record detachment writes |

"Attributed record" is read as `RI-93-008` wrote it — *"their own attributed
record/presentation"* — and is the subject's presentation, not the target
resource. A subject who is not the target's actor may still detach; a subject
who is the target's actor detaches from their own view and not from the
target. The target itself remains attributed as it was, and the comment
remains attached to it for every other reader.

**Source:** `RI-93-008`; `DI-91-026`, `DI-91-028`; `PS-270-042`; CBD-72 §5.6
item 1.

`PS-271-020` — **What detaching removes: the comment from every path that
renders or reproduces its body to the subject, and only to the subject.**

The path list is the one `PS-270-033` axis 6 names, applied to one reader.
After detachment, the subject's presentation excludes the comment body on:

* the rendered **thread** on the target;
* any **cache** of that thread held for the subject, which is invalidated when
  the detachment takes effect;
* any **export** or **report** the subject generates that would have included
  the comment under CBD-72 §5.6 item 8;
* any **digest** generated for the subject after the detachment;
* the subject's **search index** and the results it serves them;
* the body of any **in-app notification** and of any **email** generated for
  the subject after the detachment about that comment. Email is already
  confined to the `EM-92-003` action class; the rule is that no new artifact
  addressed to the subject carries the body.

Derived counts the subject sees exclude the detached comment. Where reply
context requires an artifact in the position the comment occupied, the
subject's view renders **exactly what a permission-11c removal would render to
them**: the neutral tombstone where CBD-72 §5.6 item 6 calls for one, and
nothing otherwise. Reusing the approved artifact rather than defining a
detached-specific one means a shoulder-surfer on the subject's device sees the
same thing they would see for any removed comment.

An artifact delivered to the subject before the detachment — a notification
already sent, a digest already generated, an export already downloaded — is
beyond reach, and `SG-93-091` forbids any copy from suggesting otherwise
(`PS-271-033`).

**Source:** `RI-93-008`; `PS-270-033` axis 6 path list; `PS-270-054`; CBD-72
§5.6 items 6 and 8; `EM-92-003`; `SG-93-091`.

`PS-271-021` — **What detaching preserves: everything that is not the
subject's own presentation.**

| Preserved, unchanged | Under |
| --- | --- |
| The comment body, its attribution, its creation and edit timestamps, its edited indicator, and its edit history | `DI-91-026`; CBD-72 §5.6 item 5; `SR-94-099` |
| The comment's attachment to its target, its position in the thread, and its reply linkage | CBD-72 §5.6 items 1 and 6 |
| The comment's lifecycle state — active, edited, removed, tombstoned, frozen with an archived target | CBD-72 §5.6 items 6 and 7 |
| The author's permission-11b and 11c authority over their own comment | Permissions 11b, 11c |
| Every other reader's presentation of the comment, byte-for-byte | `PS-271-022` |
| Any case submission that quotes the comment, and any case record | `PS-270-042` ("neither destroys the other") |
| Every financial and reconciliation fact on the target, every acknowledgement, every alert, every derived indicator | CBD-72 §5.6 item 1; `SR-94-090`, `SR-94-098` |
| The `SA-92-007` audit record of the comment's own events | `PS-270-066` |

Nothing in the comment's row changes. The only write is the presentation
association in `PS-271-019`.

**Source:** `RI-93-008`; `FU-95-025`; `PS-270-042`; CBD-72 §5.6; `SR-94-090`,
`SR-94-099`.

`PS-271-022` — **What the author and every other member see afterwards:
exactly what they saw before, byte-for-byte, with no notice.**

This is a negative test in the `PS-270-054` sense, not a copy guideline. For
the author and for every reader other than the subject, a detachment must be
unobservable on every path — the **thread**, any **cache**, any **export** or
**report**, any **digest**, the **search index**, and the body of any
**in-app notification** or **email** — and through every signal: no
indicator, no count change, no ordering or position change, no tombstone, no
"seen by" or read-state surface, no reply-count change, no timing artifact.
No notice of any kind is sent to the author or to any member when a detachment
or a re-attachment occurs, and no customer-facing audit or history view
available to another member records it (`SR-94-065`; `PS-271-028`). The rule
that detachment *exists* is public — it is stated at comment composition
(`PS-271-035`) — and its exercise by any particular person is private.

The reason is `PS-270-012`'s: in a small space, an author who learns that
someone detached their comment has identified who, and retaliation follows.
CBD-93 §5.3's premise is that these people know each other; the only safe
observable state is none.

**Source:** `PS-270-012`, `PS-270-018`, `PS-270-054`; `SR-94-065`;
`AB-93-034`; CBD-93 §5.3; `RK-94-015`.

`PS-271-023` — **What the subject sees afterwards: the paths in `PS-271-020`
without the comment, and a personal list from which they can re-attach.**

The subject's thread view shows the permission-11c artifact rule applied to the
detached comment. The subject's personal, account-level list of detached
comments is the surface for review and re-attachment. Each entry shows the
target reference as the subject may currently read it and the detachment
time — never the comment body, never the author's name, and never any
indication of whether a report exists (`PS-271-026`). An entry whose target
the subject can no longer read is not shown, per CBD-72 §5.6 item 2's
non-disclosure rule, and reappears if access is restored. The list is
`DI-91-028`-pattern personal state and carries the shared-device residual
`PS-271-039` states.

**Source:** `DI-91-028`; CBD-72 §5.6 items 2 and 6; `PS-270-054`;
`SG-93-094`.

`PS-271-024` — **Detachment is reversible by the subject alone, at any time,
and re-attachment is as silent as detachment.**

"Subject-controlled" runs both ways. Re-attachment restores the subject's
presentation to the ordinary rules, notifies no one, and changes nothing for
any other reader. Because the action is reversible, `SG-93-094`'s pre-action
irreversibility disclosure does not apply to detachment itself; it applies to
the one fact a subject might wrongly believe, that detachment makes the comment
go away for others, and `PS-271-033` requires that fact be stated before the
action. Both transitions are idempotent and both are audited (`PS-271-028`).

**Source:** `RI-93-008`; `SG-93-094`; `PS-271-022`.

`PS-271-025` — **Detachment is per comment, bound to the comment's identity,
and survives edits.**

One action detaches one comment. There is no per-author, per-target, or
per-space bulk detachment in this specification; a personal per-author filter
is a different thing with its own safety profile and is recorded as
`OQ-271-002`, undecided. The association is keyed on the comment's stable
identity, not on a version, so an author changing a detached comment does not
re-attach it, and the subject's view does not surface the change. The author
may edit or remove their own comment under permissions 11b and 11c exactly as
before; the detachment is indifferent to both.

**Source:** `RI-93-008` ("the comment"); permissions 11b, 11c; CBD-72 §5.6
item 5.

`PS-271-026` — **Report and detachment are independent. Neither requires,
implies, triggers, withdraws, or records the other.**

`PS-270-042` says preservation and detachment are independent; this decision
extends it to the report itself. A subject may detach without reporting, report
without detaching, or do both in either order. Detaching does not file,
withdraw, or amend a case; withdrawing a case does not re-attach. The case
record and the routing metadata carry no field stating whether the reporter
detached, and the detached-comments list carries no field stating whether a
report exists: coupling them would let a handler infer the reporter's
exposure choices, and would let a shared-device observer of the personal list
learn that a report was filed.

**Source:** `PS-270-042`; `PS-270-023` item 4's reasoning; `SG-93-088`.

`PS-271-027` — **Interactions with the comment's lifecycle, the interim
measure, and membership, each stated.**

| Event | Effect on a detached comment | Effect on the subject's view | Effect on anyone else |
| --- | --- | --- | --- |
| Author edits the comment (11b) | Edit applies; association persists (`PS-271-025`) | Unchanged — still detached | The ordinary edited indicator |
| Author removes the comment (11c) | Removal applies; the body leaves ordinary access for everyone; the association persists and is moot | Unchanged — the 11c artifact was already what they saw | The ordinary 11c artifact |
| `PS-270-033` interim measure takes effect (conditional on `OQ-270-006`) | The measure withholds from every reader; the association persists beneath it | Unchanged — the withheld rendering is byte-for-byte the 11c artifact under `PS-270-054`, which is what a detached subject already sees | The withheld rendering |
| Interim measure expires or is reversed | Ordinary rendering resumes for every reader | Unchanged — still detached | Ordinary rendering |
| Target archived or recoverably removed (§5.6 item 7) | The comment freezes with its target; the association persists | The target's own visibility rule governs | The target's own visibility rule governs |
| Target restored | The comment's visibility restores under current authorization | Still detached | Ordinary rendering |
| Subject loses target access | Nothing changes on the comment; the association persists and is moot; the personal-list entry is not shown | Nothing readable | Nothing |
| Subject regains target access | The association applies again | Still detached; the entry reappears | Nothing |
| Subject re-attaches | The association ends | Ordinary rendering | Nothing |
| Subject's or author's personal account is deleted | **Not decided here.** `OQ-271-004` with `OQ-270-008` | — | — |

**Source:** permissions 11b, 11c; CBD-72 §5.6 items 6 and 7; `PS-270-033`,
`PS-270-054`; `PA-92-001`.

`PS-271-028` — **Detachment and re-attachment are audited under `SR-94-063`
with no payload, visible to the subject and to operational audit, and to
nobody else.**

The event carries: actor (the subject), action (`detached` or `re-attached`),
the comment and target references, the time, and integrity evidence. It carries
no body, no author identifier, and no case reference. It appears in the
subject's own personal history on the `DI-91-028` pattern, and in the
`SA-92-007` operational audit stream under its approved evidence purpose. It
does **not** appear in the space's administrative-history export, in any other
member's history, in the author's history, in a case record, or in any
customer-facing surface another member can read — `SR-94-065` forbids exposing
*"another subject's personal state"* through customer audit views, and this is
exactly that. It is not a `PS-270-066` case event.

**Source:** `SR-94-063`, `SR-94-065`; `SA-92-007`; `DI-91-028`; `AN-92-006`;
`PS-270-066`.

`PS-271-029` — **Detachment failure and edge cases, each with its observable
outcome.**

| # | Case | Behaviour | Observable to the subject | Observable to anyone else |
| --- | --- | --- | --- | --- |
| 1 | Unauthenticated request | Refused before any check | The ordinary authentication outcome | Nothing |
| 2 | Target unreadable, non-existent, or a guessed reference | The read check fails; nothing is written | The uniform outcome | Nothing |
| 3 | Comment already removed by its author | The read check fails, because the body has left ordinary access; nothing is written | The uniform outcome | Nothing |
| 4 | Detach an already-detached comment, or re-attach an attached one | Idempotent; the audit event still records the request | The ordinary acknowledgement | Nothing |
| 5 | Concurrent detach and re-attach by the subject | Last write wins on the association; both requests are audited in order | The final state | Nothing |
| 6 | Author edits or removes the comment concurrently | `PS-271-027` rows 1 and 2; no conflict, because the two writes touch different records | Per `PS-271-027` | Per `PS-271-027` |
| 7 | Interim measure live on the comment | The detachment is accepted and recorded; the subject's rendering is unchanged (`PS-271-027` row 3) | The ordinary acknowledgement | Nothing |
| 8 | Presentation-state store unavailable | Fail closed: the association is not written, the presentation is unchanged, and the request is safe to retry | A uniform "try again" error class | Nothing |
| 9 | Per-actor ceiling reached | Denied without state change. Detachment is a self-regarding write, and whether it sits in `RL-92-001`'s protected class or the ordinary class is `OQ-271-005`; the value is `RF-92-012` work | Indistinguishable from acceptance | Nothing |
| 10 | Detach the actor's own comment | `PS-271-006`: no effect | The uniform outcome | Nothing |
| 11 | Personal account deleted | **Not decided here.** `OQ-271-004` | — | — |

**Source:** `PS-270-013`; `RL-92-001`, `RL-92-003`, `RL-92-005`; `SA-92-007`;
CBD-72 §5.6 items 2 and 6.

`PS-271-030` — **Noninterference: no financial, reconciliation, alert, or
indicator state depends on a report or a detachment.**

CBD-72 §5.6 item 1 makes a comment incapable of changing financial state, and
`SR-94-090` forbids any safeguard or interaction from granting money movement,
spending approval, transaction blocking, or lockout. Both remedies inherit
that. No transaction value, category, schedule, reconciliation relationship,
acknowledgement, alert eligibility, alert state, or derived indicator reads
the report store or the presentation association, for any reader. The one
count that changes is the subject's own comment count on the target
(`PS-271-020`), which is a presentation figure and not a financial one.

**Source:** CBD-72 §5.6 item 1; `SR-94-090`, `SR-94-098`, `SR-94-104`;
`RK-94-014`; `RC-95-020`.

## 7. Copy fields

Copy is specified as fields with semantic constraints. `PS-270-055` binds
every string to `RI-93-016`, and exact wording, localization equivalence, and
accessibility evidence are `FU-95-017` and `FU-95-021` work under CBD-367. No
string in this section is approved.

`PS-271-031` — **The report composition surface carries the `PS-270-023`
disclosures as distinct fields, in this order, before the submit control.**

| # | Field | Must state | Must not |
| --- | --- | --- | --- |
| 1 | Limitation | What the process can and cannot do, in `SG-93-086`'s honest-response sense; that the platform currently holds no power to remove or withhold the comment (`PS-270-075`) | Promise removal, review speed beyond §7 of CBD-270, protection, or monitoring |
| 2 | Remedies | The `PS-270-075` set as available remedies: detachment (offered here, as its own action), preservation of the submission as evidence usable outside the product, and the counsel route for unlawful content | Name, describe, or point to any membership, role, scope, invitation, archival, or lifecycle action (`PS-270-078`) |
| 3 | Severity consequence | That describing a safety situation raises severity but currently buys no content action (`PS-270-023` item 2), placed immediately before the statement field | Lead the person into writing a safety disclosure uninformed |
| 4 | Disclosure timing | When the other person may find out — the same business day, where a `PS-270-033` measure applies | Say "may eventually" where "will be told today" is the fact |
| 5 | Election | A required, unpreselected choice to apply or decline any measure that notifies the reported author (`PS-270-023` item 4) | Preselect either value; describe the choice as affecting handling or severity |
| 6 | Class | An optional choice among the three `PS-270-002` classes | Make it required, or describe it as binding |
| 7 | Statement | An optional, bounded free-text field | Suggest that more detail buys more action |
| 8 | Captured copy | That the comment as the reporter currently sees it will be sent with the report, unchanged | Offer any way to change the copy |
| 9 | Confidentiality | That the reported author is never told who reported, is never shown the statement, and is never told how many reports exist (`PS-270-012`); that intake notifies no one (`PS-270-018`) | Claim confidentiality the product does not provide, in `RI-93-016`'s sense — a shared device or a two-person space is named as a residual, not eliminated |

Every field obeys `RI-93-016`: no characterization of the author or their
motives, no implied authority, safety, confidentiality, or compliance the
product does not provide, and every irreversible consequence stated before the
action.

**Source:** `PS-270-023`, `PS-270-055`, `PS-270-075`, `PS-270-078`;
`RI-93-016`; `SG-93-086`, `SG-93-088`, `SG-93-094`; `FU-95-017`.

`PS-271-032` — **Report acknowledgement and status copy carries the
`PS-270-052` left column and nothing from the right column.**

Fields: case reference; acknowledgement of receipt; current status class and
the applicable target; terminal outcome class from the closed set; the appeal
route against a no-action outcome; and, on `Escalated` and `No action`, the
applicable remedies restated on the `PS-270-048` pattern. No field carries the
author's identity or state, whether the author was contacted, the severity,
the decision record, staff identity, or confirmation of any space, membership,
or resource the reporter could not already see. `SG-93-091` binds the outcome
copy: nothing suggests that a delivered notification, screenshot, or export
has been recalled.

**Source:** `PS-270-052`, `PS-270-048`, `PS-270-055`; `SG-93-091`,
`SG-93-092`; `RL-92-003`.

`PS-271-033` — **Detachment copy: the affordance, the pre-action statement,
the confirmation, the personal list, and the re-attach control.**

| Field | Must state | Must not |
| --- | --- | --- |
| Affordance | That the action removes the comment from the subject's own view only | Use a verb that implies deletion, removal for others, blocking, or muting the author |
| Pre-action statement | Before the action, in plain language: that the comment stays visible to everyone else who can read the target; that the author is not told; that it can be undone at any time; that anything already delivered — a notification, a digest, an export — is not recalled (`SG-93-091`) | Characterize the author; imply the author will or will not act; suggest a report is required, implied, or filed |
| Confirmation | That the comment is now out of the subject's view and where to undo it | Reference any case, report, or the author |
| Personal list entry | Target reference as currently readable, detachment time, and the undo control | The comment body; the author's name; any report state |
| Re-attach control | That undoing restores the comment to the subject's view and notifies no one | Anything else |

**Source:** `RI-93-016`; `SG-93-091`, `SG-93-092`, `SG-93-093`, `SG-93-094`;
`PS-270-055`; `PS-271-022`, `PS-271-024`.

`PS-271-034` — **There is no author-facing copy for either remedy.**

No field exists that addresses the reported author about a report, and no
field exists that addresses the author about a detachment, ever. The one
notice an author can receive is `PS-270-053`'s, which is conditional on
`OQ-270-006`, is sent only when an interim measure or an action lands, and is
owned by CBD-270. This document adds no author-facing string and no trigger for
one.

**Source:** `PS-270-012`, `PS-270-018`, `PS-270-053`; `RK-94-015`.

`PS-271-035` — **Comment composition states that any reader may detach a
comment from their own view, beside the `SG-93-039` disclosures and the
report route.**

`PS-270-056` requires composition copy stating that comments are attributed,
persistent, visible to everyone who can read the target, and removable only
by their author, and names the report route there. Detachment is added to that
list as a generic product rule — *a reader may take this out of their own
view; you will not be told* — so that the rule is public and no later
invisibility can be read as a signal. This is a copy-field addition inside
this document's delegation, not an amendment of `SG-93-039`.

**Source:** `SG-93-039`, `SG-93-024`; `PS-270-056`; `PS-271-022`.

## 8. Confidentiality limits

This section is the second half of `CBD-271-AC03`.

`PS-271-036` — **Who may learn what, as a closed matrix.**

| Fact | Reporter / subject | Reported author | Other members and the Primary Owner | Case handler | `PS-270-077` reviewer | Counsel (on escalation) | Routine support | Analytics |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| That a report exists | Yes, their own | **Never** | Never | Yes, the one assigned | Yes, on review | Yes | Never | Never |
| Who reported | — | **Never** | Never | Only as an opaque routing identifier, never resolved to a person | Same | Same | Never | Never |
| The reporter's submission text | Yes, their own | **Never** | Never | Yes | Yes | Yes | Never | Never |
| How many reports exist about a comment | Never | **Never** | Never | As a duplicate-key group, not a count of persons | Same | Same | Never | Never |
| The item-4 election | Their own choice, at submission | Never | Never | **Never** | **Never** | Never | Never | Never |
| The author's identity or destination | Whatever they could already see in the thread | — | Whatever they could already see | **Never** | Never | Only through the `PS-270-057` row-3 route counsel itself governs | Never | Never |
| Case status and outcome class | Yes, their own | Never, except the conditional `PS-270-053` notice | Never | Yes | Yes | Yes | Never | Never |
| That a detachment exists, and its state | Yes, their own | **Never** | Never | Never | Never | Never | Never | Never |
| Whether a reporter detached | Yes, their own | Never | Never | **Never** | Never | Never | Never | Never |
| Any financial fact on the target | Whatever they could already read | Whatever they could already read | Whatever they could already read | **Never** | Never | Never | Never | Never |

**Source:** `PS-270-012`, `PS-270-013`, `PS-270-018`, `PS-270-046`,
`PS-270-052`, `PS-270-076`; `OP-92-001`, `OP-92-002`; `SR-94-067`,
`SR-94-072`; `AN-92-001`.

`PS-271-037` — **Every refusal is uniform, and neither surface is an oracle.**

The uniform outcome for both actions has one status, one body, one error class,
one header set, and one latency class regardless of whether the target exists,
the comment exists, the actor is authorized, the ceiling is reached, or the
actor authored the comment. No counter, quota, or remaining-attempt hint
varies with real state. `RL-92-003` and CBD-72 `XSP-02` require this of every
surface; `PS-270-013` requires it of the case channel; and `PS-270-076`
constraint 1 shows what a non-uniform report action becomes.

**Source:** `RL-92-003`; CBD-72 `XSP-02`; `PS-270-013`, `PS-270-076`;
`SR-94-065`.

`PS-271-038` — **Nothing here correlates a person across spaces.**

Reports are space-scoped through the `PS-270-076` party tokens, which are
derived per space and are never joinable. Detachment state is keyed per
comment and therefore per space. The reporter's account-level case view lists
only their own cases and shows for each only what they submitted; it offers no
cross-space search, report, or export, per `SR-94-130` and `SR-94-131`. The
subject's personal detached-comments list is likewise their own state and
carries no cross-space insight beyond the entries themselves.

**Source:** `SR-94-130`, `SR-94-131`; `PS-270-046`, `PS-270-076`; `DI-91-001`.

`PS-271-039` — **Residuals, stated as `SR-94-101` requires and not described
as eliminated.**

| Residual | Why it is not closable here |
| --- | --- |
| Behavioural inference | An author who notices that the subject stopped replying to a comment may infer a detachment or a report. No product surface discloses it; the inference comes from the people, not the product. Same class as `PS-270-033` axis 6's timing residual |
| Shared or observed device | The personal detached-comments list and the reporter's case view are personal state on a device the abuser may also use or watch. `AB-93-023`–`AB-93-032` name the class; the `PS-271-020` reuse of the 11c artifact limits what the thread itself shows, and the list itself is the residual |
| Two-person space | `PS-270-012`'s withholding of reporter identity is nominal where the set of possible reporters is a singleton. The item-4 election is the control CBD-270 gives; this document adds no surface that widens the leak |
| Delivered copies | A notification, digest, export, screenshot, or printout that already carries the comment is beyond recall (`SG-93-091`). Detachment and report both leave them where they are |
| The reporter's own copy | The reporter holds their captured copy and may use it outside the product (`PS-270-075` row 2). That is the remedy, and it is also an exposure the reporter controls |

**Source:** `SR-94-101`; `SG-93-091`; `AB-93-023`, `AB-93-032`;
`PS-270-012`, `PS-270-023`, `PS-270-033`.

## 9. Record and data-class register

`PS-271-040` — **Every record this document creates or writes, in one table.**

| Record | Written by | Class | Sensitivity | Readers | Retention owner |
| --- | --- | --- | --- | --- | --- |
| Reporter submission (captured copy, integrity evidence, statement) | Report action | `DI-91-043` | S3 | `PS-271-013` reader set | `OQ-270-004` |
| Item-4 election | Report action | `DI-91-043`, fixed-field, rendered to no person | S3 | The two `PS-270-053` machine gates | `OQ-270-004` |
| Case routing and correlation record | Report action, then the process | `DI-91-063` | S2 | Handler, reviewer, process services with opaque correlation only | `OQ-270-004` |
| Party tokens and duplicate key | `PS-270-076` resolution step | `DI-91-063`-class opaque correlation | S2 | System-side; the duplicate key to the handler | `OQ-270-004` |
| Report audit events (intake, withdrawal) | Report action | `SA-92-007` audit taxonomy, no payload | Per taxonomy | Operational audit; the reporter's own history for their own events | `SR-94-063` allowlist and `OQ-270-004` |
| Presentation association | Detachment | `DI-91-028`-pattern personal state | S3 | The subject; the rendering services for the subject's own view | Personal-account and membership retention, per `DI-91-028`; `OQ-271-004` for deletion |
| Detachment audit events | Detachment | `SA-92-007` audit taxonomy, no payload | Per taxonomy | The subject's own history; operational audit | `SR-94-063` allowlist |

No record here is joined to `DI-91-026` comment rows, to financial records, or
to analytics, and none reaches an export or a customer history another member
can read.

**Source:** `DI-91-028`, `DI-91-043`, `DI-91-063`; `SA-92-007`; `SR-94-063`,
`SR-94-072`; `AN-92-006`; `PS-270-040`, `PS-270-076`.

## 10. Dependencies and implementation routing

`PS-271-041` — **Implementation lands with the shared-comments feature story,
which does not yet exist in Jira. The dependency is recorded here and is
raised with the Product Owner by Manager.**

The Jira description says so directly: *"Its implementation lands with the
shared-comments feature story, which does not yet exist in Jira; creating that
story is recorded as a dependency to raise with the Product Owner."* This
document is not blocked by that story's absence; its implementation is. The
same story inherits every gate CBD-270 records: `SR-94-074` keeps shared
comments unshippable until `EG-93-009` closes, `RK-94-014` records comments as
Blocking on it, and `RG-94-011` requires exercised cases. The implementation
needs, beyond the story: the isolated submission store (`PS-271-012`), the
presentation-association store and its application on every `PS-271-020`
path, the `PS-270-076` resolution step, the two `PS-270-053` machine gates,
and the negative-test fixtures CBD-272 will run against `PS-271-022`.

Raising the dependency is a Manager and Product Owner action outside this
change; `CBD-271-AC05`'s PR and merge SHA are recorded at merge.

**Source:** CBD-271 description; `SR-94-074`; `RK-94-014`; `RG-94-011`;
`FU-95-025`.

## 11. Open questions, inherited questions, and mechanical checks

### 11.1 Open questions this document raises

None of these is answered here. Each names the authority that must answer it.

| ID | Question | Why this document cannot answer it | Authority |
| --- | --- | --- | --- |
| `OQ-271-001` | Is reader-based detachment eligibility (`PS-271-005`) the intended reading of `RI-93-008`'s "targeted person", or is a narrower rule wanted? The narrower rule cannot be evaluated without reading content. | `RI-93-008` is an approved decision whose wording admits both readings; choosing is product intent | Product Owner |
| `OQ-271-002` | Is a personal per-author filter — every comment by one author out of one reader's view — wanted, and if so with what safety profile? `PS-271-025` scopes detachment to one comment and decides nothing about a filter. | A filter has a different threat profile (silent blanket non-reading in a shared financial space) and no approved source asks for it | Product Owner, with the CBD-273 qualified input |
| `OQ-271-003` | May the capture-time integrity digest (`PS-271-009`) ever be compared machine-side against the stored comment body, to settle an author's provenance contest without a person reading either? | It is a machine-mediated read of stored content in `OP-92-001`'s denied class, and belongs with `OQ-270-001` and `OQ-270-009` in the same CBD-92 amendment | Product Owner and Security, through the focused change to CBD-92 |
| `OQ-271-004` | Does a presentation association survive the subject's personal-account deletion and restoration under `PA-92-001`–`PA-92-005`, and does the author's deletion end it? | The `PA-92-*` lifecycle's interaction with personal presentation state is addressed by no source; `EG-91-002` owns the per-class disposition | The `EG-91-002` owner with Data Lifecycle; alongside `OQ-270-008` |
| `OQ-271-005` | Does detachment sit in `RL-92-001`'s protected-action class or the ordinary class, and what are the ceilings? | Class assignment is a Security decision under `RL-92-001`; values are `RF-92-012` work | Security |
| `OQ-271-006` | Does a `Withdrawn` case shorten the submission's retention period, and may the reporter delete their own submission before the period ends? | Retention is `OQ-270-004`, and a withdrawal rule is part of its answer | The `EG-91-009` owner, with `OQ-270-004` |

### 11.2 CBD-270 open questions: resolved here versus left open

This document resolves **none** of CBD-270's open questions; each belongs to
an authority this package does not hold. It depends on six of them, as
follows.

| CBD-270 question | Relationship to this document |
| --- | --- |
| `OQ-270-001` | Left open. `PS-271-010` builds on the reporter-submission-only model it questions; `OQ-271-003` is a further instance of the same amendment |
| `OQ-270-002` | Not touched |
| `OQ-270-003` | Left open. `PS-271-013` lists the standing reviewer as a reader and records that the function is unfilled |
| `OQ-270-004` | Left open, and it is why `CBD-271-AC01` is met in part (`PS-271-014`). `OQ-271-006` attaches to it |
| `OQ-270-005` | Left open. `PS-271-018` row 13 records that a non-user has no path |
| `OQ-270-006` | Left open and not depended on. Neither remedy requires the content power; `PS-271-027` states the interaction with the conditional interim measure |
| `OQ-270-007` | Not touched |
| `OQ-270-008` | Left open. `PS-271-018` row 9 and `PS-271-029` row 11 defer to it; `OQ-271-004` adds the detachment half |
| `OQ-270-009` | Left open. `PS-271-009` relies on the `PS-270-076` step it questions, for the party tokens and duplicate key |

### 11.3 Mechanical checks this package needs

These are implemented in `scripts/audit-cbd-271.py`, on the shape of
`scripts/audit-cbd-233.py`, and are run as part of the documentation gate.

1. **Identifier integrity.** Every `PS-271-*` and `OQ-271-*` identifier is
   defined exactly once, the `PS-271-*` set is dense from `001` to its
   highest number, and every identifier is referenced at least once outside
   its own defining heading or row.
2. **Pins agree with CBD-270 §1.1.** §1.1 pins
   `docs/cbd-270-platform-safety-operating-model.md` at the version that
   document currently states, and pins each of the eight source documents
   CBD-270 §1.1 lists at exactly the version CBD-270 §1.1 states for it. The expected
   values are read from CBD-270, not retyped in the script, so a CBD-270
   re-pin fails this check until this document follows.
3. **The `RI-93-008` boundary.** Two halves. **Positive assertions:**
   `PS-271-001` contains, verbatim, "never edits", "never hides",
   "never deletes", "never alters authored content",
   "never alters financial state", and "grants no editorial, moderation,
   membership, role, or lifecycle power". **Negative scan:** over decision
   bodies only — from each `PS-271-*` heading line through the end of its
   **Source** line — every sentence or table cell, read with its line wrapping
   collapsed to single spaces, that contains **both** a granting form and a
   content-power verb is a hit. Granting forms: *may*, *can*, *could*,
   *grant*, *grants*, *granted*, *allow*, *allows*, *allowed*, *permit*,
   *permits*, *permitted*, *enable*, *enables*, *enabled*, *authorize*,
   *authorizes*, *authorized* — except where the form is immediately followed
   by *not*, *never*, *no*, *neither*, *nothing*, *nobody*, or *none*, which
   is a literal token rule and not a sense rule. Content-power verbs: *edit*,
   *edits*, *edited*, *editing*, *delete*, *deletes*, *deleted*, *deleting*,
   *deletion*, *hide*, *hides*, *hid*, *hidden*, *hiding*, *moderate*,
   *moderates*, *moderated*, *moderating*, *moderation*, *alter*, *alters*,
   *altered*, *altering*, *alteration*. Every hit must carry an allowlist
   entry — decision id plus exact quoted string, below — or the check fails.
   A hit's sense is never inferred. The allowlist is complete for v0.1;
   editing an exempted sentence re-arms the check, and an allowlist row whose
   string no longer appears in its decision fails the check too.

   | Decision | Exact exempted string | Why exempt |
   | --- | --- | --- |
   | `PS-271-025` | "The author may edit or remove their own comment under permissions 11b and 11c exactly as before" | Restates the author's own approved permissions; grants nothing new |

   Per `CLAUDE.md`, the check is not finished until a deliberate violation
   has failed it. The violation staged for v0.1: insert the sentence *"The
   handler may delete the comment."* into `PS-271-013`, watch check 3 fail,
   restore, watch it pass; and remove every occurrence of "never hides" from
   `PS-271-001`, watch the positive assertion fail, restore. Both were staged
   on September 17, 2026 and both failed as required.
4. **Acceptance-criteria mapping.** §13 has exactly one subsection for each of
   `CBD-271-AC01` through `CBD-271-AC05`, in order; each carries a
   **Status:** line whose value begins with *Met*, *Met in part*, or *Not
   met*; each cites at least one `PS-271-*` identifier that resolves; and
   §1.2 quotes all five criteria verbatim against the text the script holds
   from the September 17, 2026 read of `customfield_10066`.
5. **Path completeness.** `PS-271-020` and `PS-271-022` each name every path
   in the closed list — thread, cache, export, report, digest, search index,
   in-app notification, email — so that the detachment's reach and the
   non-observability requirement cover the same surfaces `PS-270-033` axis 6
   names.
6. **Observability assertions.** `PS-271-022` contains "byte-for-byte" and
   "no notice"; `PS-271-015` contains "notifies no one"; `PS-271-034`
   contains "no author-facing copy".
7. **No invented retention value.** `PS-271-014` contains no duration literal
   — no number followed by day, days, week, weeks, month, months, year, or
   years.
8. **Outcome vocabulary completeness.** Every enumeration of the
   `platform-safety-case-outcome` set in this document names all five members.
   `check-doc-vocabulary.py` scopes that vocabulary to `cbd-270-*.md` and does
   not scan this file; §12.2 proposes widening it, and until that lands this
   check stands in.
9. **Revision history.** §14 is the last section, its table has the columns
   Version, Date, Author, Change, Status, its first data row's version equals
   the header table's Document version, and that row's date equals the
   header's Last updated.
10. **Cross-document citations resolve.** Every `PS-270-*` and `OQ-270-*`
    cited here exists in CBD-270, and every source-family identifier cited —
    `OP-92`, `AN-92`, `RL-92`, `SA-92`, `PA-92`, `EM-92`, `NT-92`, `RF-92`;
    `SG-93`, `AB-93`, `EG-93`; `SR-94`, `RK-94`, `RG-94`; `RI-93`, `RC-95`,
    `FU-95`; `DI-91`, `EG-91`; `DL-76`, `INC-76` — exists in the document that
    owns its family.
11. **Structure.** One level-one title; no BOM; LF line endings; final
    newline; no trailing whitespace; no unresolved placeholder markers; no
    duplicate headings; Status is **Draft**.

## 12. Publication, vocabulary, and change control

### 12.1 Publication manifest entry required

This document sits at depth 1 under `docs/`, so `scripts/publication.py`'s
manifest-coverage rule requires an entry in `config/confluence-publication.json`
before `npm run check:publication` passes. That file is a single-writer shared
surface and is deliberately not edited by this change. The entry it needs, as
an `unpublished` disposition on the CBD-270 precedent:

```json
{
  "path": "docs/cbd-271-report-and-detachment-semantics.md",
  "disposition": "unpublished",
  "rationale": "CBD-271 report and detachment semantics held repository-only because no approved Confluence target exists and the document is an unapproved draft; this change creates no pages.",
  "authority": "CBD-115 out-of-scope page creation rule and AGENTS.md scoped publication policy, matching the docs/cbd-270-platform-safety-operating-model.md precedent in this manifest.",
  "reopen_when": "The Product Owner approves this exact document and a verified existing Confluence target in a focused merged change."
}
```

### 12.2 Vocabulary registration proposed, not applied

`scripts/check-doc-vocabulary.py` is a single-writer shared surface this change
does not edit. Two registrations are proposed as a separate change:

| Proposal | Change | Why |
| --- | --- | --- |
| Widen the two CBD-270 vocabularies | Add `cbd-271-*.md` to `applies_to` for `platform-safety-case-outcome` and `platform-safety-appeal-outcome` | This document enumerates the outcome set at `PS-271-016`; until the glob widens, §11.3 check 8 is the only guard on it |
| Register `comment-presentation-association-state` | Members `attached`, `detached`; canonical this document §6, `PS-271-019`; applies to `cbd-271-*.md` | A closed two-member set; a restatement naming one is a defect |

### 12.3 Change control

This document is a draft and binds nothing until the Product Owner approves it.
An approved version changes only through a focused revision recording the
reason, the affected identifiers, and the approval. Any change to §3, to the
`PS-271-022` non-observability rule, or to the `PS-271-013` reader set reopens
the CBD-272 exercise and the CBD-273 review.

## 13. Acceptance-criteria check

No separate traceability document is created; the mapping is recorded here, on
the CBD-270 §18 precedent. Decisions by section, in document order:

| Section | Decisions |
| --- | --- |
| §3 The `RI-93-008` boundary | `PS-271-001`, `PS-271-002`, `PS-271-003` |
| §4 Actors and eligibility | `PS-271-004`, `PS-271-005`, `PS-271-006`, `PS-271-007` |
| §5 The report action | `PS-271-008`, `PS-271-009`, `PS-271-010`, `PS-271-011`, `PS-271-012`, `PS-271-013`, `PS-271-014`, `PS-271-015`, `PS-271-016`, `PS-271-017`, `PS-271-018` |
| §6 Subject-controlled detachment | `PS-271-019`, `PS-271-020`, `PS-271-021`, `PS-271-022`, `PS-271-023`, `PS-271-024`, `PS-271-025`, `PS-271-026`, `PS-271-027`, `PS-271-028`, `PS-271-029`, `PS-271-030` |
| §7 Copy fields | `PS-271-031`, `PS-271-032`, `PS-271-033`, `PS-271-034`, `PS-271-035` |
| §8 Confidentiality limits | `PS-271-036`, `PS-271-037`, `PS-271-038`, `PS-271-039` |
| §9 Record and data-class register | `PS-271-040` |
| §10 Dependencies | `PS-271-041` |

### 13.1 `CBD-271-AC01` — what a report captures, how long it is retained, who may read it, isolated S3 text under `SR-94-072`

**Status: Met in part.** Three of four limbs are met; the fourth is routed.

* What a report captures: `PS-271-009`, a closed field list with a data class
  per field, and the closed not-captured list; `PS-271-010` for the captured
  copy's standing.
* Who may read it: `PS-271-013`, a closed reader set that excludes the
  reported author, every member, routine support, and analytics.
* Isolated S3 text under `SR-94-072`: `PS-271-011` and `PS-271-012` — the
  submission is `DI-91-043` S3, in a separate store, joined to nothing,
  excluded from every export and history.
* **How long it is retained: not set.** `PS-271-014` states the retention
  shape and records that the value is `OQ-270-004`, owned by `EG-91-009`.
  `CBD-131-AC04`'s "recorded retention period" is therefore not yet
  supported, and this document says so rather than inventing a period.

### 13.2 `CBD-271-AC02` — what detaching removes, what it preserves, what the author and every other member see afterwards

**Status: Met.**

* What detaching removes: `PS-271-019` defines the association and the
  attributed record; `PS-271-020` lists every path.
* What it preserves: `PS-271-021`, a closed table covering the authored
  content, the evidence, and financial state; `PS-271-026` for the
  independence from the report.
* What the author and every other member see afterwards: `PS-271-022`,
  byte-for-byte unchanged with no notice, as a negative test; `PS-271-023`
  for the subject's own view; `PS-271-027` for every lifecycle interaction.

### 13.3 `CBD-271-AC03` — confidentiality limits and the CBD-91 data-class assignment for report records

**Status: Met.**

* Data-class assignment: `PS-271-009` per field, `PS-271-011` per record
  part, `PS-271-040` for every record this document creates.
* Confidentiality limits: `PS-271-013` (reader set), `PS-271-036` (the
  observer-by-fact matrix), `PS-271-037` (uniform outcomes), `PS-271-038`
  (no cross-space correlation), `PS-271-039` (residuals stated).

### 13.4 `CBD-271-AC04` — neither remedy edits or deletes another author's content, grants any role moderation authority, or changes any financial state

**Status: Met, and enforced mechanically.**

`PS-271-001` states the rule in the criterion's own terms and in the six
phrases §11.3 check 3 asserts; `PS-271-002` states why both remedies are
self-regarding; `PS-271-003` places detachment state outside the comment's
lifecycle; `PS-271-021` and `PS-271-030` state what is preserved and that no
financial state depends on either remedy. Check 3's negative scan fails the
document if any decision body pairs a granting form with a content-power verb
outside the allowlist.

### 13.5 `CBD-271-AC05` — the shared-comments feature story dependency recorded and raised; completion records the PR and merge SHA

**Status: Met in part — the record is here; raising and merge are outside this change.**

`PS-271-041` records the dependency and its consequences. Raising it with the
Product Owner is a Manager action; the PR and merge SHA are recorded at merge,
on the CBD-270 §18.4 pattern.

### 13.6 What this document does not close

| Gate or gap | State after this document |
| --- | --- |
| `EG-93-009` | Open. The remedies are specified; exercised cases and qualified review do not exist |
| `RG-94-011` | Open |
| `RG-94-009` | Open. The isolated store, the presentation association, and the tool-enforced reader set are unbuilt |
| `SR-94-074` | Open. Shared comments remain unshippable |
| `CBD-131-AC03` | Supported to the extent a specification supports it; "implemented" awaits the feature story (`PS-271-041`) |
| `CBD-131-AC04` | Supported except for the retention period (`PS-271-014`, `OQ-270-004`) |
| `PS-271-022` non-observability | **Unverified.** A negative test with no fixture; CBD-272 territory beside the `PS-270-054` tombstone fixture |
| `PS-271-013` reader set | Stated, not enforced. `PS-270-015` tooling is unbuilt and `PS-270-077` is unfilled |
| `RI-93-008` | Unchanged and now specified. Its "exact audience behavior, copy, evidence access, retaliation/failure cases" are §6, §7, §5 and §8, and §5–§6 respectively; "platform response" remains CBD-270's |
| `FU-95-025` | Open. This is the second of its required pieces |

## 14. Revision history

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 0.1 | September 17, 2026 | Claude | Initial draft against `CBD-271-AC01`–`AC05` and the CBD-270 §2 delegation. Defines 41 `PS-271-*` decisions across the `RI-93-008` boundary, actors, the report action, subject-controlled detachment, copy fields, confidentiality limits, the record register, and dependencies; registers six open questions; resolves no CBD-270 question. Pins CBD-270 at 0.5.2 and the eight CBD-270 §1.1 source documents at identical versions. Sets no retention period (`PS-271-014`, `OQ-270-004`), so `CBD-271-AC01` is met in part. Paired with `scripts/audit-cbd-271.py`. | Draft; Product Owner approval required, and `EG-93-009` also requires the CBD-272 exercises and the CBD-273 review |
