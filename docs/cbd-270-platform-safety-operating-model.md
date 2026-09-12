# CBD-270 — Platform-Safety Operating Model for Shared Comments

| Field | Value |
| --- | --- |
| Status | **Draft** — not approved. Written to close the `EG-93-009` element list. Approval authority is the Product Owner, with the qualified safety and privacy review CBD-273 obtains and the abuse-case exercise CBD-272 runs. Neither is complete, so `EG-93-009` and `RG-94-011` remain open and shared comments remain unshippable. |
| Document version | 0.1 |
| Owner | Alexander Wohlford |
| Reviewer | Pending — Product Owner, plus the qualified reviewer CBD-273 engages |
| Jira | [CBD-270](https://cobudget.atlassian.net/browse/CBD-270) |
| Parent | [CBD-131](https://cobudget.atlassian.net/browse/CBD-131) — Establish the platform-safety operating model for shared comments |
| Companions | CBD-271 report and subject-controlled detachment semantics; CBD-272 abuse-case exercise; CBD-273 qualified safety and privacy review |
| Confluence page | Not registered. `config/confluence-publication.json` needs the entry recorded in §17.1 before publication. |
| Repository baseline | `ba1c1d3` |
| Last updated | September 12, 2026 |

## 1. Purpose and authority

`EG-93-009` names the thing that does not exist: *"scope, authority, staffing,
and timeline of the platform safety process that CBD-72 §5.6 item 9 depends on
for harassment, unlawful content, and accidental disclosure."* CBD-93's closure
contract widens that to thirteen elements, and `SR-94-074` makes the complete
set a release condition. This document writes the model, element by element.

The reason it is needed is `AB-93-034`. Comments are attributed, persistent, and
visible to everyone who can read the target. `DL-76-020` denies every
budget-space role — Primary Owner included — the authority to edit, remove,
hide, or moderate another author's contribution. A person harassed through
comments on their own transactions therefore has **no in-product remedy at all**
unless something outside the role model supplies one. CBD-72 §5.6 item 9 routes
serious abuse to a platform safety process. This is that process.

Every decision carries a stable `PS-270-*` key and cites the approved source
that forces it, following the convention CBD-103 established with `TD-103-*` and
CBD-130 continued with `PN-130-*`. `PS-270-*` numbers are never reused or
renumbered.

### 1.1 Authoritative inputs and pinned versions

| Source | Pinned version | What it binds here |
| --- | --- | --- |
| `docs/cbd-91-private-mvp-data-inventory.md` | Document version **1.0.5** | `DI-91-026` comment bodies, `DI-91-038` security evidence, `DI-91-043` support submissions and operator notes, `DI-91-063` case routing metadata; `EG-91-009` as the open staff-access gap this model reports into |
| `docs/cbd-92-system-flow-technical-threat-model.md` | Document version **1.0.1** | `OP-92-001`–`OP-92-008` staff boundary, `AN-92-001`–`AN-92-006` purpose separation, `EM-92-003` and `NT-92-001` channel ceilings, `SA-92-007`/`SA-92-008` audit obligations, `RL-92-003` and `RL-92-005` anti-oracle and non-weaponization rules |
| `docs/cbd-93-privacy-coercion-abuse-analysis.md` | Document version **1.1.2** | `AB-93-034` and `AB-93-071`–`AB-93-074`; `SG-93-037`–`SG-93-039`, `SG-93-050`, `SG-93-083`–`SG-93-088`, `SG-93-091`–`SG-93-094`; the `EG-93-009` closure contract |
| `docs/cbd-94-risk-mitigation-requirement-register.md` | Document version **1.0.4** | `RK-94-009`, `RK-94-014`, `RK-94-015`, `RK-94-020`; `SR-94-063`–`SR-94-074`, `SR-94-102`–`SR-94-103`; §3.6 acceptance authority, §3.8 escalation and stop-ship, `RG-94-009` and `RG-94-011` |
| `docs/cbd-95-cbd-12-reconciliation-matrix.md` | Document version **1.0.4** | `RI-93-008` report plus subject-controlled detachment, `RI-93-016` cross-cutting copy standard, `RI-93-017` hard support-transfer refusal with a safe answer |
| `docs/cbd-95-architecture-roadmap-follow-up-register.md` | Document version **1.0.11** | `FU-95-025`, which routes this work and states the boundary: no role gains global moderation authority, and detachment cannot edit, delete, or alter authored content or financial state |
| `docs/cbd-76-mvp-boundary-and-readiness-record.md` | Document version **1.0.1** | `DL-76-020` and `INC-76-012` — the approved non-moderation rule this model must not weaken |

CBD-72 §5.6 items 4 and 9, §5.7 item 3, §6.3, and permissions 11a, 11b, and 11c
are cited from the approved collaboration permission model at document version
**0.1.54**.

## 2. What this document does not decide

* It does not specify the report action or the detachment semantics.
  `RI-93-008` decided *that* they exist; CBD-271 decides audience behaviour,
  association semantics, copy fields, and failure cases. §5 here defines only
  what intake must deliver to the process.
* It runs no abuse-case exercise. CBD-272 owns that, and `EG-93-009` is not
  closed by a written model alone.
* It obtains no qualified safety or privacy review. CBD-273 owns that, and
  CBD-94 §3.6 makes it mandatory for coercion, surveillance, and
  survivor-safety residuals.
* It amends no approved source. §16 records where this model is in tension with
  an approved contract and proposes amendments that remain pending.
* It sets no retention period, no jurisdiction list, and no exact
  customer-facing string. Those are owned by `EG-91-009`, `EG-93-002` with
  `RG-94-013`, and `FU-95-017` with `FU-95-021`, and all are open.
* It closes no gate. `EG-93-009`, `RG-94-009`, and `RG-94-011` stay open.

## 3. Scope

`PS-270-001` — **The process is a platform function, not a budget-space role,
and it acts on content and accounts, never on budget-space authority.**

This is the load-bearing separation. `DL-76-020` and `SR-94-102` deny every role
moderation authority, and nothing here creates one. The process is a separate
actor with its own narrow powers, and those powers exclude everything the role
model governs: it cannot add or remove a member, change a role, transfer
ownership, grant or revoke connection authority, alter a financial record, or
change what any member can read.

**Source:** CBD-72 §5.6 item 4; `DL-76-020`; `SR-94-102`; `FU-95-025`.

`PS-270-002` — **Three case classes are in scope, and they are the three
`EG-93-009` names: harassment, unlawful content, and accidental disclosure.**

| Class | What it covers |
| --- | --- |
| Harassment | Comment content directed at a person who can read the target, which degrades, threatens, shames, or pressures them, including repeated unwanted commenting. `AB-93-034` is the canonical case. |
| Unlawful content | Content whose publication or possession is unlawful in an applicable jurisdiction. The jurisdiction set is not approved — see `OQ-270-007`. |
| Accidental disclosure | A comment that exposes another person's sensitive data — an account number, a credential, a medical or immigration fact, a home address — whether or not the author intended it. The author may remove their own comment under permission 11c; this class exists for when they do not. |

**Source:** `EG-93-009`; CBD-72 §5.6 item 9; permission 11c; CBD-93 §7.1.

`PS-270-003` — **In scope: `DI-91-026` comment and note bodies on a target the
reporter can currently read.**

Comment bodies are the only content class this process acts on. It is not a
general content-review function. Category names, goal purposes, bill payees,
manual-transaction descriptions, and overlay reason text are in the same CBD-93
§7.2 sensitive-content family, but they are authored inside the budget model and
are governed by role permissions, not by this process.

**Source:** `DI-91-026`; CBD-93 §7.2; `INC-76-012`.

`PS-270-004` — **Out of scope, explicitly, and each with the path that does own
it.**

| Not in scope | Owned by |
| --- | --- |
| Budget disagreements, spending disputes, and alert or acknowledgement conflicts | No process. Acknowledgement is personal and non-authorizing; the product does not adjudicate between members. |
| Account or session recovery | The authorized in-product recovery path. Support may point to it and nothing more (`SG-93-084`). |
| Ownership, role, membership, or connection-authority transfer | **Hard denied.** `SG-93-085` and `SR-94-071` make refusal a product rule with no escalation override. This process is not a route around it. |
| Routine product problems | The `OP-92-002` content-free support surface. |
| A security incident, or backup, key, and recovery work | The `OP-92-003`–`OP-92-008` exceptional-access path, which this process does not use (`PS-270-007`). |
| An emergency or a threat requiring immediate physical intervention | Emergency services. The product makes no protection claim and offers no monitoring (`PS-270-034`). |

**Source:** `SG-93-084`, `SG-93-085`; `SR-94-071`; `RI-93-017`; `OP-92-002`,
`OP-92-003`.

`PS-270-005` — **Scope does not widen at public launch by default.** Any
extension — new content classes, proactive review, an automated classifier, an
external queue — requires a new Product Owner and security decision with its own
evidence, on the `AN-92-007` pattern. Silence is not approval.

**Source:** `AN-92-007` as the approved precedent; `RG-94-015`.

## 4. Prohibited staff powers

This section is `CBD-270-AC02`. The list is closed and negative on purpose: it
states what no person holding a case may do, whatever their title, whatever the
case, and whatever the customer asks for.

`PS-270-006` — **`OP-92-001` default-deny is unchanged. Holding a
platform-safety case grants no standing access to customer content.**

No one in this process may browse the datastore, search comments, open a budget
space, read a membership graph, view a financial record, inspect a notification
destination, or read another person's profile. Case assignment is not authority.
`OP-92-001` already says employment, ticket assignment, product administration,
and a customer request do not create customer-data authority; a report does not
either.

**Source:** `OP-92-001`; `SR-94-067`.

`PS-270-007` — **This process may not use the `OP-92-003` exceptional-access
path, because `OP-92-003` excludes moderation from its closed purpose list.**

The exclusion is verbatim: *"Ordinary troubleshooting, convenience, analytics,
product research, quality review, moderation, sales, and customer-requested
content lookup are excluded."* An ambiguous or unlisted purpose fails closed.
There is therefore no approved mechanism by which platform-safety staff may read
stored comment content. The model is built around that constraint rather than
against it — see §5 and §10 — and §16 records the amendment it would take to
change it. Until such an amendment is approved, a case that cannot be decided
from the reporter's own submission escalates; it is never self-served.

**Source:** `OP-92-003`; `SG-93-083`.

`PS-270-008` — **No budget-space role acquires any power from this process.**

Primary Owner, Co-owner, Collaborator, Accountability Partner, and Viewer are
unchanged. A Primary Owner cannot invoke this process against a member's comment
on their own behalf as an owner; they may report as any reader may report, and
they receive no additional standing, no visibility into the case, and no
influence over the outcome. Owner-side silencing of a supporter or contributor
is the harm `DL-76-020` exists to prevent, and a reporting channel that gave
owners privileged weight would reintroduce it.

**Source:** `DL-76-020`; `SR-94-102`; CBD-72 §5.6 item 4.

`PS-270-009` — **No impersonation, and no authority mutation.**

Prohibited without exception: impersonating a customer; bypassing a password or
factor; changing a notification destination; cancelling or triggering a
protected action; initiating a lifecycle request; creating, accepting, or
revoking an invitation; transferring ownership, a role, or connection authority.
`OP-92-005` prohibits the first group, `SG-93-084` the second, and `SR-94-071`
makes the transfer refusal a denied product action. Successful identity
verification does not create any of these powers.

**Source:** `OP-92-005`; `SG-93-084`; `SR-94-071`.

`PS-270-010` — **No rewriting. Enforcement removes or withholds; it never
edits.**

Where an enforcement action affects content, the only permitted effects are
withholding it from display and removing it, each recorded. No one may alter the
text of another person's comment, author content in a person's name, or change
an attribution. A rewritten comment is indistinguishable from a forged one, and
attribution is what makes the record honest.

**Source:** permission 11b; `SG-93-040`; `SR-94-064`.

`PS-270-011` — **No mediation, no introduction, no contact between members.**

Staff may not identify one member to another, pass a message between them,
contact a person who is not the reporter about the report, characterize any
person's circumstances or motives, or recommend that the reporter contact the
other person. `RI-93-017` settles this for the support surface and the same rule
binds here, for the same reason: suggesting contact with an abuser is dangerous
advice delivered with the product's authority.

**Source:** `RI-93-017`; `SG-93-092`; `RI-93-016`.

`PS-270-012` — **No disclosure of who reported.**

The reported author is never told the reporter's identity, is never shown the
reporter's submitted text, and is never told how many reports exist. Retaliation
inside a shared budget space is the predictable consequence of disclosure, and
the members of a space already know each other.

**Source:** `AB-93-034`; `SG-93-088`; `RK-94-015`.

`PS-270-013` — **No confirmation of anything the requester could not already
see.**

A case response confirms no space, membership, role, resource, lifecycle state,
or other person's state. Outcomes are uniform across "no such content", "content
exists but no action", and "not authorized to ask", exactly as `RL-92-003` and
CBD-72 `XSP-02` require of every other surface. A case is not an oracle.

**Source:** `RL-92-003`; CBD-72 `XSP-02`; `SR-94-065`.

`PS-270-014` — **No escalation path overrides any rule in this section, and no
missing tool is permission for manual access.**

CBD-93 §6.14 states the second half directly for the operational safeguards:
*"missing tooling is not permission for manual access."* A supervisor, an urgent
case, a distressed customer, and a legal threat are each insufficient. The only
response to a case this model cannot resolve is escalation under §12.

**Source:** CBD-93 §6.14; `SG-93-085`; `OP-92-003`.

`PS-270-015` — **The boundary is enforced by the tool, not by this document.**

`SR-94-067` requires that routine staff capability be *technically* limited.
Before comments ship, the case tool must make `PS-270-006`–`PS-270-013`
unavailable rather than merely forbidden, and `RG-94-009` requires that
evidence. A policy a person can violate by clicking is not the control.

**Source:** `SR-94-067`; `RG-94-009`.

## 5. Intake

`PS-270-016` — **One authenticated in-product report action on a readable
target is the only intake that creates a platform-safety case.**

`SG-93-037` names the minimum remedy as *"report to the platform, and detach the
comment from their own attributed record"*, and `RI-93-008` decided both.
CBD-271 specifies the action; this decision fixes what it is for. Anyone who can
currently read the target may report. The subject of a comment may report
whether or not they are the author of the target, and whether or not they are
the person the comment names.

**Source:** `SG-93-037`; `RI-93-008`; CBD-271.

`PS-270-017` — **The reporter's own submission is the evidence. This is what
lets the process function inside `OP-92-001`.**

The report carries a reporter-supplied copy of the content complained of, an
opaque reference to the target and comment, and the reporter's statement. That
submission is a **customer submission** in the `DI-91-043` sense — `OP-92-002`
already establishes that customer-supplied ticket text and attachments *"remain
separately access-controlled customer submissions and are not automatically
joined to internal customer records."* The process reads what the reporter chose
to send it. It does not reach into the space to fetch more.

This is the structural answer to `PS-270-007`. It is not a workaround: it is the
only construction under which a safety process and a default-deny staff boundary
can both hold. Its limits are real and are recorded at `OQ-270-001`.

**Source:** `OP-92-002`; `DI-91-043`; `SR-94-072`; `OP-92-001`.

`PS-270-018` — **Reporting notifies no one else at intake.**

The reported author, the space's Primary Owner, and every other member learn
nothing when a report is filed. Notification happens only when an enforcement
action lands, under §11. An intake notice would convert the remedy into a
retaliation trigger.

**Source:** `AB-93-034`; `PS-270-012`; `RK-94-015`.

`PS-270-019` — **Out-of-band contact is triaged but creates no content access,
and is converted into a case or refused.**

An email to support, a letter, a regulator or law-enforcement demand, and a
third-party complaint all arrive outside the product. Each is recorded with a
case identifier and routed under §12. None causes anyone to look at customer
content, and none is answered by confirming or denying that a person, space, or
comment exists. A demand with legal force is not decided internally at all —
CBD-94 §3.6 puts jurisdiction-scoped counsel in that seat.

**Source:** `OP-92-002`; CBD-94 §3.6; `RG-94-013`.

`PS-270-020` — **Intake is bounded and cannot be weaponized.**

Report submission carries a ceiling in `RL-92-001`'s protected-action class.
`RL-92-005` binds its shape: reaching a ceiling must not let one person prevent
another from reporting, and throttled and unthrottled responses must be
indistinguishable under `RL-92-003`. Values are `RF-92-012` and CBD-94 work, not
decided here.

**Source:** `RL-92-001`, `RL-92-003`, `RL-92-005`; `RF-92-012`.

`PS-270-021` — **A report against a reporter is a separate case and is never
merged, cross-referenced, or weighed against theirs.**

Counter-reporting is a known abuse pattern between people who know each other.
Two cases with reciprocal parties are decided independently, on their own
submissions, and neither decision cites the other.

**Source:** `AB-93-034`; CBD-93 §5.3.

`PS-270-022` — **Duplicate reports about the same content are grouped for
handling and counted once for the outcome.**

Grouping is an operational convenience and carries no weight: volume is not
evidence. Ten reports from members of one space about a person's comment do not
raise severity, because the people in a shared budget space are precisely the
people with an interest in silencing each other.

**Source:** `AB-93-034`; CBD-93 §5.3; `DL-76-020`.

`PS-270-023` — **Intake states the limitation before the report is filed.**

The composition surface says what the process can and cannot do, in the
`SG-93-086` sense of a documented honest response. It does not promise removal,
review speed beyond §7, protection, monitoring, or that the other person will
not find out at the point an action lands. `SG-93-094` requires that
irreversible consequences be stated before the action, in plain language.

**Source:** `SG-93-086`, `SG-93-094`; `RI-93-016`.

## 6. Severity model

`PS-270-024` — **Severity uses the CBD-94 §3.8 scale — Critical, High, Medium,
Low — rather than a parallel one, so that a platform-safety case escalates
through the register's existing rules.**

Inventing a second severity language would leave the two sets to drift, and
CBD-94's stop-ship rules are keyed to these four words.

| Severity | Platform-safety definition |
| --- | --- |
| **Critical** | A credible threat of physical harm; content whose possession is itself unlawful; disclosure of a person's location where a safety risk is stated or evident; disclosure of an authentication factor or a live financial credential. |
| **High** | Targeted harassment of an identifiable person; content unlawful in an applicable jurisdiction other than a Critical class; disclosure of another person's sensitive personal data — account number, medical, immigration, or similar — in a comment. |
| **Medium** | Content whose subject is the reporter and which shames, degrades, or pressures them without a threat. This is `AB-93-034`'s core case and the most common one the model expects. Also repeated unwanted commenting after a detachment. |
| **Low** | Content the reporter finds unwelcome but which is within ordinary disagreement, or a mistaken disclosure the author can remedy themselves under permission 11c. |

**Source:** CBD-94 §3.8; `AB-93-034`; permission 11c.

`PS-270-025` — **Ambiguity raises severity. It never lowers it.**

`OP-92-003` fixes the direction for the staff boundary — an ambiguous purpose
fails closed — and the same discipline applies to triage. Where the submission
supports two readings, the higher severity is assigned and the case is escalated
rather than resolved on a favourable interpretation.

**Source:** `OP-92-003`; CBD-94 §3.8.

`PS-270-026` — **Severity is assigned from the submission alone, and the
assignment is recorded with its reason.**

There is no investigation step that reaches into customer content, because there
is no authority for one (`PS-270-007`). Where severity genuinely cannot be
assigned from the submission, the case escalates under `PS-270-048`.

**Source:** `PS-270-007`, `PS-270-017`; `SR-94-063`.

`PS-270-027` — **Severity may not be raised to justify access, and may not be
lowered because a case is inconvenient, contested, or expensive.**

Both directions of pressure are foreseeable. A raised severity does not unlock
`OP-92-003`, which is closed to this process by purpose and not by rank. Every
change of severity after assignment is a separately audited event with an author
and a reason.

**Source:** `OP-92-003`; `SR-94-064`.

`PS-270-028` — **Coercion, surveillance, and survivor-safety cases carry a
mandatory specialist route regardless of severity.**

CBD-94 §3.6 places that class beyond internal product judgement: acceptance
requires *"qualified advocacy/privacy input; legal input where notice,
preservation, deletion, or customer claims are implicated."* A Medium harassment
case between intimate partners is still in that class. It is not closed on
internal judgement alone.

**Source:** CBD-94 §3.6; `RG-94-014`; CBD-273.

## 7. Response targets

`PS-270-029` — **Targets are measured from report submission to the stated
milestone, in the operational owner's business days.**

| Severity | Triage started | Terminal outcome communicated |
| --- | --- | --- |
| Critical | Same business day | 2 business days, or an escalation record stating why not |
| High | 1 business day | 5 business days |
| Medium | 2 business days | 10 business days |
| Low | 5 business days | 15 business days |

Critical's same-business-day triage is the CBD-94 §3.8 Critical deadline, and
High's is its two-business-day triage rule applied to the first milestone. The
remaining rows are set here.

**Source:** CBD-94 §3.8.

`PS-270-030` — **These are targets, not commitments, and no customer-facing
surface may state or imply more than the process can deliver.**

`RI-93-016` prohibits copy that implies safety, confidentiality, or protection
the product does not provide. The honest statement is that a person will receive
a response, not that they will receive protection.

**Source:** `RI-93-016`; `SG-93-093`; `RG-94-012`.

`PS-270-031` — **Private MVP has business-hours coverage only, and a Critical
case can arrive outside them.**

The model states this rather than hiding it. With a single operational owner
(§8), there is no out-of-hours path, and a credible threat reported on a Friday
evening is not triaged until Monday. Whether comments may ship on that basis is
a Product Owner decision with qualified input, recorded at `OQ-270-002`. It is
not decided here, and this document does not assert that the arrangement is
adequate.

**Source:** `PS-270-036`; CBD-94 §3.6; `OQ-270-002`.

`PS-270-032` — **A missed target is an audited event with a reason, not a silent
lapse.**

Each miss is recorded against the case and reviewed under §14. Aggregate target
performance is one of the readiness inputs `RG-94-011` needs.

**Source:** `SR-94-063`; `RG-94-011`; CBD-94 §3.8.

`PS-270-033` — **A Critical case stops the affected surface first and decides
afterwards.**

CBD-94 §3.8 requires, for a new or failed Critical finding, that the affected
release surface stop immediately, safe evidence be preserved, and the accountable
owner, Security, and Product Owner be notified. For this process the affected
surface is the comment surface, and stopping it may mean suspending commenting
on the affected target, or across the product, for as long as triage needs.
Suspension is not an enforcement action against any person and is not appealable
under §13.

**Source:** CBD-94 §3.8; `RG-94-011`.

`PS-270-034` — **The product claims no monitoring and no protection.**

Nothing in this process watches content proactively. There is no classifier, no
scanning, and no review of anything nobody reported — consistent with
`AN-92-002`'s prohibition on behavioural capture and with the read-side
monitoring position in `SR-94-073`. Copy must not imply otherwise.

**Source:** `AN-92-002`; `SR-94-073`; `RI-93-016`.

## 8. Staffing and on-call ownership

`PS-270-035` — **The named operational owner of this process is Alexander
Wohlford, as Platform Safety Owner.**

This satisfies `CBD-270-AC03` and `EG-93-009`'s *"operational owner with
`EG-91-009`"*. It also records the only name the approved corpus contains: every
approved CBD document carries Alexander Wohlford as Owner and as Product Owner,
and CBD-94 §7 assigns `RG-94-011` to the Product Owner and `RK-94-020` to
Operations without naming a person for either.

**Source:** `EG-93-009`; `EG-91-009`; CBD-94 §7.

`PS-270-036` — **There is one person, and the separation of duties CBD-94
requires is therefore not met inside the organization.**

This is a finding, not an arrangement. The same individual is Product Owner,
Platform Safety Owner, the decider on a case, and the person who would hear its
appeal. `OP-92-004` requires distinct requester and approver identities for the
analogous exceptional-access decision. CBD-94 §3.6 requires Product Owner
acceptance *"after written accountable-security recommendation"* for Critical
risk, and qualified advocacy or privacy input for the coercion and
survivor-safety class. None of those is satisfiable by one person acting alone.

Two consequences bind:

* A Critical case, an account-level action, and any case in the `PS-270-028`
  class may not be closed on the operational owner's judgement alone. Each
  routes to the qualified reviewer CBD-273 engages, and the reviewer's
  disposition is part of the case record.
* An appeal against a decision the operational owner made is decided by someone
  else, which in Private MVP means the same external route (§13).

**Source:** `OP-92-004`; CBD-94 §3.6; `SR-94-069`; CBD-273.

`PS-270-037` — **On-call is the operational owner, in business hours, with no
named deputy.**

No deputy exists to name. Naming a fictitious one would be worse than recording
the gap, so the gap is recorded and routed: a named backup, or an explicit
Product Owner decision to ship without one, is a `RG-94-011` readiness input.

**Source:** `RG-94-011`; `OQ-270-002`.

`PS-270-038` — **No vendor, contractor, or outsourced moderation queue operates
in Private MVP, and introducing one requires a new approval.**

An external queue would place `DI-91-043` S3 free text — including safety
disclosures under `SG-93-088` — in a third party's custody. `AN-92-007`
establishes the pattern for this kind of extension: a new Product Owner and
privacy approval with subprocessor evidence, access, retention, and deletion
rules. Silence or a vendor default is not approval.

**Source:** `AN-92-007`; `SG-93-088`; `SR-94-072`.

`PS-270-039` — **A person may hold a case only after the §15 training is
recorded, and case access ends when the role does.**

Assignment is revoked on role change or departure at the same time as every
other authority, under the ordinary lifecycle rules.

**Source:** `SR-94-067`; `OP-92-004`.

## 9. Evidence handling

`PS-270-040` — **A case record has exactly three parts, each with its own
classification and its own handling.**

| Part | Class | Handling |
| --- | --- | --- |
| Reporter submission — the copy of the content, the reporter's statement | `DI-91-043`, S3 free text | Restricted support-content boundary. Isolated per `SR-94-072`. Never joined automatically to internal customer records. |
| Case routing, status, severity, and opaque correlation | `DI-91-063`, S2 | Safe metadata only: category, status, case and subject identifiers, opaque correlation. No bodies. |
| Decision record — severity, decision, authority, reason class, action taken | `DI-91-038`-adjacent operational evidence | Durably attributable without copying customer payload into it, on the `OP-92-007` pattern. |

**Source:** `DI-91-043`, `DI-91-063`, `DI-91-038`; `SR-94-072`; `OP-92-007`.

`PS-270-041` — **Case content never enters a customer-facing export, audit,
status, or correlation surface.**

`SG-93-088` requires this for safety disclosures specifically and `SR-94-072`
generalizes it: abuse and support submissions and operator notes are excluded
from all budget-member and admin exports and from customer history. CBD-72 §5.7
item 3 already excludes support notes and internal reasons from the customer
administrative-history export, and `AB-93-074` records why it matters — a
subject disclosing abuse to the platform creates the most dangerous free text in
the system.

**Source:** `SG-93-088`; `SR-94-072`; `SR-94-065`; CBD-72 §5.7 item 3;
`AB-93-074`.

`PS-270-042` — **Preservation and detachment are independent, and neither
destroys the other.**

`RI-93-008` gives the subject the power to detach a comment's association from
their own attributed record *"without editing, globally hiding, or deleting the
preserved authored content/evidence."* A detachment therefore changes
presentation and leaves case evidence intact. Symmetrically, a preserved case
record must not become a surface through which anyone reads content they could
not otherwise read — the reporter's own submission is theirs, and nothing more
is added to it. CBD-271 owns the exact association semantics.

**Source:** `RI-93-008`; `FU-95-025`; CBD-271.

`PS-270-043` — **No case content reaches analytics, reliability telemetry, or
any secondary purpose.**

`AN-92-001` disables product analytics, `AN-92-003` makes reliability telemetry
content-free, and `AN-92-006` forbids joining or reusing an identifier collected
for one purpose in another. A case identifier is a support-purpose identifier
and stays one.

**Source:** `AN-92-001`, `AN-92-003`, `AN-92-006`.

`PS-270-044` — **Retention is minimum-necessary and its value is not set here.**

`DI-91-043` records support retention, deletion, redaction, and legal-hold rules
as unknown, and `EG-91-009` owns closing them. Inventing a period in this
document would create a false closure. The requirement stated here is the shape:
a defined period per part, a deletion path, a legal-hold exception with a named
authority, and no indefinite default. The value is `OQ-270-004`.

**Source:** `DI-91-043`; `EG-91-009`; `SR-94-063`.

`PS-270-045` — **Evidence integrity is required and, with one operator, is not
currently achievable by organizational means.**

`SR-94-064` requires that omission, reordering, overwrite, selective deletion,
forgery, and correlation loss be detectable, and that *"no single operational
actor may silently alter evidence."* One person holds every role (§8). The
control must therefore be technical — append-only storage with independent
integrity evidence — and its absence is a `RG-94-009` blocker rather than an
accepted residual.

**Source:** `SR-94-064`; `SR-94-069`; `RG-94-009`.

## 10. Access controls

`PS-270-046` — **Case access is bound to one assigned case. There is no queue
browse and no cross-case search by person.**

A person handling a case sees that case. They may not search cases by subject,
by space, or by counterparty, and may not correlate a person's cases across
spaces — the `AB-93-063`–`AB-93-066` cross-space correlation harm applies to
internal records as much as to customer ones, and `SR-94-130`–`SR-94-135`
prohibit cross-space correlation generally.

**Source:** `SR-94-072`; `RK-94-018`; `SR-94-065`.

`PS-270-047` — **The reporter's submission is the complete content boundary of
an ordinary case.**

Nothing else is read. This follows from `PS-270-007` and `PS-270-017` and is
restated here because it is the access rule, not merely the intake rule.

**Source:** `OP-92-001`, `OP-92-003`; `PS-270-017`.

`PS-270-048` — **A case that cannot be decided from the submission escalates and
is not decided.**

The foreseeable instances are: the author contests that the submitted copy is
what they wrote; an unlawful-content class requires acting on the stored record
rather than on a copy; or an appeal turns on the state of the content at a past
time. In each, the model has no approved way to look, so the case does not get
decided by looking. It goes to §12 with the question stated, and the honest
outcome may be that the platform cannot resolve it — which the reporter is told,
under `SG-93-086`.

**Source:** `OP-92-003`; `SG-93-086`; `OQ-270-001`.

`PS-270-049` — **Enforcement execution is mediated, narrow, and preserves every
ordinary invariant.**

Where an approved enforcement action affects stored content, it runs through a
narrow service workflow on the `OP-92-005` pattern: no general database access,
no bulk operation, no impersonation, and preservation of ordinary authorization,
lifecycle, integrity, and audit invariants. The workflow performs the specific
action and returns; it is not a content-browsing tool with an action attached.

**Source:** `OP-92-005`; `SR-94-068`.

`PS-270-050` — **Every access to a case and every enforcement execution is
attributable, time-bound, and independently reviewed.**

Attribution follows `OP-92-007`: strong authentication, the decision, the
approved scope, the actions taken, the result, and an independent post-use
review. With one operator, the independent reviewer is the external route in
`PS-270-036`.

**Source:** `OP-92-007`; `SR-94-070`; `PS-270-036`.

## 11. User communication

`PS-270-051` — **The authenticated in-app surface carries every detail, and the
external channels carry their approved ceilings and nothing more.**

Email may state only the `EM-92-003` action class, whether action is required,
and a deadline. Push and SMS carry only the fixed `NT-92-001` body. A safety
notice is precisely the case where a shared or monitored device makes a preview
dangerous, which is what the `AB-93-023`–`AB-93-032` notification-leakage rows
establish and why the ceiling exists.

**Source:** `EM-92-003`; `NT-92-001`; `SG-93-018`.

`PS-270-052` — **What the reporter receives: acknowledgement, status class,
outcome class, and nothing about another person.**

| Reporter receives | Reporter never receives |
| --- | --- |
| Case reference and acknowledgement of receipt | The identity or any state of the reported author |
| Current status class and the applicable §7 target | Whether the author was contacted, warned, or acted against |
| Terminal outcome class, and that an action was taken where one was | The internal reason, the severity assigned, the decision record, or staff identity |
| The appeal route against a no-action outcome (§13) | Confirmation of any space, membership, or resource they could not already see |

The terminal outcome class is one of the closed set in §17.2: `Actioned`,
`No action`, `Out of scope`, `Escalated`, `Withdrawn`.

**Source:** `PS-270-013`; `SR-94-065`; `RL-92-003`.

`PS-270-053` — **What the reported author receives: notice at the point an
action lands, stating the action and the appeal route.**

The notice states which content is affected, what changed, when it took effect,
and how to appeal. It never names or characterizes the reporter, never quotes
the reporter's submission, never states how many reports were made, and never
describes any person's circumstances.

**Source:** `PS-270-012`; `SG-93-092`; the `RI-93-015` notice-field pattern.

`PS-270-054` — **A third party whose visible state changes receives only what
the ordinary rules already allow.**

If an enforcement action changes what other readers of a target can see, they
see the ordinary consequence — a neutral tombstone where the approved lifecycle
rules call for one — and receive no notice that a platform-safety case exists.
Inventing a new disclosure here would make every enforcement action an
announcement inside the space.

**Source:** permission 11c tombstone rule; `DI-91-026`; `SR-94-065`.

`PS-270-055` — **All case copy obeys the approved cross-cutting semantic
standard, and this document approves no strings.**

`RI-93-016` binds: no claim that consent was free, no claim of sole channel
control, no claim that a delivered or downloaded copy can be recalled, no
characterization of another person, and no implied authority, safety,
confidentiality, or compliance the product does not provide. `SG-93-091` applies
directly and often — removing a comment does not retract a notification already
delivered, a screenshot, or a printout, and no outcome message may suggest it
does. Exact strings, localization equivalence, and accessibility evidence are
`FU-95-017` and `FU-95-021` work under CBD-367.

**Source:** `RI-93-016`; `SG-93-091`, `SG-93-092`, `SG-93-093`; `FU-95-017`,
`FU-95-021`.

`PS-270-056` — **Comment composition states the audience and the permanence
before the person writes, and names this route.**

`SG-93-039` requires composition copy stating that comments are attributed,
persistent, visible to everyone who can read the target, and removable only by
their author. `SG-93-024` requires that audience be stated at creation time.
This process is the answer to the question those disclosures raise, so the
report route is named there too.

**Source:** `SG-93-039`; `SG-93-024`; `SG-93-086`.

## 12. Escalation

`PS-270-057` — **Five triggers escalate, and each names the authority that must
act.**

| Trigger | Mandatory action | Authority |
| --- | --- | --- |
| Critical severity assigned | Stop the affected surface (`PS-270-033`); preserve evidence; notify Security and the Product Owner same business day | Product Owner, after the `PS-270-036` external recommendation |
| Coercion, surveillance, or survivor-safety class (`PS-270-028`) | Route for qualified advocacy or privacy input before any terminal disposition | Product Owner after qualified input; CBD-94 §3.6 |
| Legal process, regulator demand, or an unlawful-content class | Do not answer internally; do not confirm or deny existence; obtain a jurisdiction-scoped disposition | Counsel. CBD-94 §3.6 states this cannot be accepted by internal product or engineering judgement alone |
| The case cannot be decided from the submission (`PS-270-048`) | State the question; do not obtain content access; record the limitation | Product Owner and Security, jointly, under `OQ-270-001` |
| A control failure — a prohibited power exercised, evidence altered, a boundary bypassed | Treat as a security incident; preserve evidence; the `OP-92-003` incident path applies to the incident, never to the original case | Security; `MON-94-008` |

**Source:** CBD-94 §3.6, §3.8; `MON-94-008`; `OP-92-003`.

`PS-270-058` — **Escalation moves a decision upward. It never moves a
prohibition aside.**

No escalation grants content access, support-mediated transfer, impersonation,
or any other `PS-270-006`–`PS-270-014` power. `SG-93-085` states the pattern for
the transfer refusal — *"a product rule that denies the action, not a staff
policy"* — and it holds for every prohibition in §4.

**Source:** `SG-93-085`; `PS-270-014`.

`PS-270-059` — **Reopening is mandatory on the CBD-94 §3.8 triggers.**

A closed case reopens where the product authority or lifecycle changed, the
operating tool changed, a control failed, a new affected population appeared, or
the evidence no longer covers what was released. A prior closure is not
permanent evidence.

**Source:** CBD-94 §3.8 reopening rules.

## 13. Appeals

`PS-270-060` — **Three parties may appeal, and each appeals one thing.**

| Appellant | May appeal |
| --- | --- |
| The author whose content was removed or withheld | The enforcement action against their content |
| The account holder subject to an account-level action | That action |
| The reporter | A terminal no-action outcome on their case |

**Source:** `SG-93-050`, which requires that a person may contest a shared record
that describes them; `RI-93-008`; CBD-94 §3.6.

`PS-270-061` — **An appeal is decided by someone other than the original
decider, which in Private MVP means the external route.**

`OP-92-007` requires post-use review *"by a person independent of the
requester"*. With one operational owner, internal independence does not exist
(`PS-270-036`), so an appeal against a Critical or account-level decision is
decided through the CBD-273 qualified route. An appeal against a Medium or Low
content decision may be decided by the operational owner only where it raises a
fact the original decision did not consider; otherwise it escalates. This is a
limitation, stated as one.

**Source:** `OP-92-007`; `SR-94-069`; `PS-270-036`.

`PS-270-062` — **One appeal per decision, within a stated window, with a closed
outcome set.**

The outcome set is `Upheld`, `Reversed`, `Modified`, `Out of scope`. The window
is 30 days from the notice of the decision, and a late appeal is recorded and
refused rather than silently dropped. An appeal does not suspend a Critical
enforcement action.

**Source:** `SR-94-063`; CBD-94 §3.8.

`PS-270-063` — **A reversal restores the content and records the reversal; it
does not erase the case.**

`SR-94-064` requires that selective deletion be detectable. A reversed decision
leaves both decisions in the record.

**Source:** `SR-94-064`; `PS-270-045`.

`PS-270-064` — **There is no appeal against a product rule.**

Refusal of support-mediated ownership, role, membership, or connection-authority
transfer is not a discretionary decision and is not appealable — `SG-93-085` and
`SR-94-071` make it a denied product action with no escalation override. Neither
is the absence of a role-based moderation power: `DL-76-020` is an approved
product decision, and a request to have an owner remove someone else's comment
is out of scope rather than refused on the merits.

**Source:** `SG-93-085`; `SR-94-071`; `DL-76-020`.

`PS-270-065` — **Appealing costs the appellant no disclosure about anyone
else.**

An appeal outcome discloses nothing new about the reporter, the subject, or any
other member, and an author who appeals is not told who reported them.

**Source:** `PS-270-012`, `PS-270-013`.

## 14. Audit

`PS-270-066` — **Every case event is recorded under the approved audit taxonomy,
with no customer payload in the audit record.**

`SR-94-063` requires event and field allowlists, actor, subject, target,
decision and policy versions, correlation, order, integrity, audience,
retention, deletion, and prohibited content. The case events are: intake,
severity assignment and every change, assignment to a handler, escalation,
decision, enforcement execution, notice sent, appeal filed, appeal decision,
reopening, and closure. Content bodies live in the `PS-270-040` submission
record, never in the audit stream.

**Source:** `SR-94-063`; `SA-92-007`, `SA-92-008`; `OP-92-007`.

`PS-270-067` — **The audit record is tamper-evident, and no single operational
actor may silently alter it.**

Stated again from `PS-270-045` because it is an audit requirement as well as an
evidence one, and because it is currently unmet.

**Source:** `SR-94-064`; `SR-94-069`.

`PS-270-068` — **Platform-safety records are not in the customer
administrative-history surface.**

`SR-94-065` prohibits support notes, another subject's personal state, and
hidden-resource gaps in customer audit views, and CBD-72 §5.7 item 3 already
excludes support notes and internal reasons. A Primary Owner's administrative
history does not show that a member was reported, reported someone, or was acted
against.

**Source:** `SR-94-065`; `SR-94-072`; CBD-72 §5.7 item 3.

`PS-270-069` — **A person subject to an enforcement action receives a safe
record of that action, and the broader self-record question stays open.**

The `PS-270-053` notice is the record. Whether a person is entitled to a durable
customer-visible record of actions taken against them more generally is
`RI-93-007`, an unapproved candidate, and this document does not decide it.

**Source:** `RI-93-007`; `SR-94-136`–`SR-94-140`; `RK-94-019`.

`PS-270-070` — **Monitoring alarms already cover this process under
`MON-94-008`.**

The alarm classes that apply — exceptional-purpose denial or bypass,
self-approval, excessive or expired grant, impersonation, moderation attempt,
evidence mutation, and a missed post-use review or notice — are exactly the
failure modes of §4 and §10. `MON-94-008` names *"impersonation/moderation/
transfer attempt"* explicitly, so an attempt to exercise a prohibited power is an
alarm rather than a discovery.

**Source:** `MON-94-008`; `VT-94-112`–`VT-94-132`.

`PS-270-071` — **Closed cases, missed targets, and every prohibited-power alarm
are reviewed periodically by the accountable owner, and the review output is a
`RG-94-011` input.**

The review covers outcome distribution, target performance, escalation
frequency, appeal reversals, and every alarm. It does not re-read case content.

**Source:** `RG-94-011`; `RG-94-009`; `SR-94-070`.

## 15. Training

`PS-270-072` — **No person holds a case before recorded completion of the
required curriculum.**

| Topic | Why it is mandatory |
| --- | --- |
| The `OP-92-001` and `OP-92-002` boundary and the §4 prohibited powers | `SR-94-067` requires the limitation; a handler who does not know the boundary cannot stay inside it |
| `OP-92-003`'s exclusion of moderation, and what to do instead | The single most likely well-intentioned violation is looking at the content |
| CBD-93 §5.3, the structural pattern, and the coercion and surveillance model | The abuse surface is between people who know each other; an anonymous-spam model produces wrong decisions |
| The hard denials: `SG-93-085`, `SR-94-071`, `DL-76-020` | These are the requests a distressed person will make most persuasively |
| `SG-93-088` safety-disclosure handling | The most dangerous free text in the system arrives through this process |
| `RI-93-016` and `RI-93-017` copy and response standards | What staff may say is as bounded as what they may do |
| The §12 escalation triggers and the §13 appeal route | An escalation not taken is a decision taken |

**Source:** `SR-94-067`; CBD-93 §5.3; `SG-93-088`; `RI-93-016`, `RI-93-017`.

`PS-270-073` — **Completion is recorded, and re-training is triggered by change,
not by calendar alone.**

A change to the staff boundary, to an approved product rule this process cites,
to the case tool, or any control failure or incident, requires re-training
before further case handling. The record is `DI-91-038`-class operational
evidence and names no customer.

**Source:** CBD-94 §3.8 reopening triggers; `SR-94-063`.

`PS-270-074` — **Training is not the control, and completing it closes no
gate.**

`SR-94-067` requires technical limitation, and `PS-270-015` puts the boundary in
the tool. Training explains a boundary the tool already imposes. Separately, the
abuse-case exercise `EG-93-009` requires is CBD-272's work and is not satisfied
by training completion — `RG-94-011` needs the *"`EG-93-009` operating model and
exercised cases"*.

**Source:** `SR-94-067`; `RG-94-011`; CBD-272.

## 16. Open questions and proposed source amendments

None of these is answered here. Each names the authority that must answer it.

| ID | Question | Why this document cannot answer it | Authority |
| --- | --- | --- | --- |
| `OQ-270-001` | `OP-92-003`'s closed purpose list excludes moderation, so no approved path lets platform-safety staff read stored comment content. Is the reporter-submission-only model in `PS-270-017` the final position, or does `OP-92-003` gain a further purpose class with its own dual approval and notice rules? | CBD-92 is approved and belongs to another package. **Proposed amendment, pending.** | Product Owner and Security, through a focused change to CBD-92 |
| `OQ-270-002` | May comments ship with business-hours-only coverage for Critical cases, given one operational owner and no named deputy? | A staffing and risk-acceptance decision in CBD-94 §3.6's Critical class, requiring a written accountable-security recommendation | Product Owner, after the CBD-273 qualified input |
| `OQ-270-003` | The operational owner, the Product Owner, the case decider, and the appeal authority are one person. Is the external CBD-273 route a sufficient standing substitute for `OP-92-004` and `SR-94-069` separation, or is a second named individual required before launch? | `SR-94-069` requires organizational and technical separation; this document cannot create a person | Product Owner and Security |
| `OQ-270-004` | Retention, deletion, redaction, and legal-hold rules for `DI-91-043` case content and `DI-91-063` metadata. | `DI-91-043` records them as unknown and `EG-91-009` owns them. Inventing a period would be a false closure | The `EG-91-009` owner, with legal input where hold or deletion claims are implicated |
| `OQ-270-005` | A non-user third party named in a comment — a merchant counterparty, an ex-partner, a child — has no account and therefore no intake path. Does one exist, and what would it disclose? | CBD-93 §7.1 records that free text is frequently about someone other than its author; no approved source gives a non-user standing | Product Owner, with privacy and legal input; interacts with `EG-93-002` |
| `OQ-270-006` | **Does the platform have authority to remove an author's content at all?** CBD-72 §5.6 item 4 denies every *role* that authority and §5.6 item 9 routes serious abuse here, but no approved source states that the platform itself may remove a comment. This model assumes such a power exists for the unlawful-content and Critical classes and specifies its limits; the power itself is undecided. | It is a product decision about the approved permission model, not a specification detail. Settling it here would be inventing product intent | Product Owner; touches CBD-72 §5.6 and `DL-76-020` |
| `OQ-270-007` | Which jurisdictions define "unlawful content" for `PS-270-002`? | `RG-94-013` and `EG-93-002` are open; no jurisdiction set is approved | Counsel, per CBD-94 §3.6 |
| `OQ-270-008` | Does a report or a case record survive the reporter's personal-account deletion under `PA-92-001`–`PA-92-005`, and does the reported author's deletion end an open case? | The `PA-92-*` lifecycle is approved but its interaction with an operational case record is addressed by no source, and the `EG-91-002` per-class terminal disposition is open | The `EG-91-002` and `EG-91-009` owners, with Data Lifecycle |

### 16.1 Mechanical checks this package needs

Named so that Manager can route them to Guard. They are not written here.

1. Every `PS-270-*` and `OQ-270-*` identifier resolves, is unique, and is
   referenced at least once outside its defining row.
2. Every identifier this document cites in a **Source** line — the `OP-92-*`,
   `SG-93-*`, `SR-94-*`, `RI-93-*`, `DI-91-*`, `RK-94-*`, `RG-94-*`, `AB-93-*`,
   `DL-76-*`, `AN-92-*`, `RL-92-*`, `EM-92-*`, `NT-92-*`, `MON-94-*`, `VT-94-*`,
   `PA-92-*`, `SA-92-*`, `INC-76-*`, `FU-95-*` and `EG-*` families — resolves in
   the document that owns it.
3. The thirteen `CBD-270-AC01` elements each have exactly one section, in the
   criterion's order, and §18.1's restatement is derived from the headings
   rather than retyped.
4. The two closed vocabularies in §17.2 are complete wherever they are
   enumerated, once registered.
5. No `PS-270-*` decision grants a power §4 prohibits — a keyword check over the
   decision bodies against the prohibited-power list.

## 17. Publication, vocabulary, and change control

### 17.1 Publication manifest entry required

This document sits at depth 1 under `docs/`, so `scripts/check-publication.py`
requires an entry in `config/confluence-publication.json`. That file is a
single-writer shared surface and is deliberately not edited by this change. The
entry it needs, as an `unpublished` disposition because no approved Confluence
target exists and this document is an unapproved draft:

```json
{
  "path": "docs/cbd-270-platform-safety-operating-model.md",
  "disposition": "unpublished",
  "rationale": "cbd-270-platform-safety-operating-model is held repository-only because no approved page target is registered and the document is an unapproved draft; this task does not create pages.",
  "authority": "CBD-115 out-of-scope page creation rule and AGENTS.md scoped publication policy.",
  "reopen_when": "The Product Owner approves this exact document and a verified existing Confluence target in a focused merged change."
}
```

`CBD-270-AC04` requires publication to Confluence after merge. That converts the
entry to `registered` with a target, page id, expected title, doc set, order,
and approved hash, and it happens only after Product Owner approval and with
explicit authorization for that specific change. It is not part of this change.

### 17.2 New vocabulary requiring registration

Two closed sets are defined here. Neither is registered in
`scripts/check-doc-vocabulary.py`, which is a single-writer shared surface this
change does not edit. Both are reported for registration:

| Vocabulary | Members | Canonical section |
| --- | --- | --- |
| `platform-safety-case-outcome` | `Actioned`, `No action`, `Out of scope`, `Escalated`, `Withdrawn` | this document §11, `PS-270-052` |
| `platform-safety-appeal-outcome` | `Upheld`, `Reversed`, `Modified`, `Out of scope` | this document §13, `PS-270-062` |

Severity deliberately reuses CBD-94 §3.8's Critical, High, Medium, and Low
rather than defining a parallel set, so it needs no registration of its own.

### 17.3 Change control

This document is a draft and binds nothing until the Product Owner approves it.
An approved version changes only through a focused revision recording the
reason, the affected identifiers, and the approval. Any change to the staff
boundary, the prohibited-power list, or the escalation triggers reopens the
CBD-272 exercise and the CBD-273 review.

## 18. Acceptance-criteria check

No separate traceability document is created. `CBD-270-AC01`–`AC04` do not call
for one, unlike CBD-103 through CBD-130, whose criteria name a traceability
record as a deliverable. The mapping is therefore recorded here, and the package
carries one publication-manifest entry instead of two. The deviation is reported
to Manager.

### 18.1 `CBD-270-AC01` — thirteen elements, each as its own section

**Status: Met.**

| # | Required element | Section | Decisions |
| --- | --- | --- | --- |
| 1 | Scope | §3 | `PS-270-001`–`PS-270-005` |
| 2 | Prohibited staff powers | §4 | `PS-270-006`–`PS-270-015` |
| 3 | Intake | §5 | `PS-270-016`–`PS-270-023` |
| 4 | Severity model | §6 | `PS-270-024`–`PS-270-028` |
| 5 | Response targets | §7 | `PS-270-029`–`PS-270-034` |
| 6 | Staffing and on-call ownership | §8 | `PS-270-035`–`PS-270-039` |
| 7 | Evidence handling | §9 | `PS-270-040`–`PS-270-045` |
| 8 | Access controls | §10 | `PS-270-046`–`PS-270-050` |
| 9 | User communication | §11 | `PS-270-051`–`PS-270-056` |
| 10 | Escalation | §12 | `PS-270-057`–`PS-270-059` |
| 11 | Appeals | §13 | `PS-270-060`–`PS-270-065` |
| 12 | Audit | §14 | `PS-270-066`–`PS-270-071` |
| 13 | Training | §15 | `PS-270-072`–`PS-270-074` |

The order is the criterion's order. `CBD-131-AC01` is supported to the extent a
written model supports it; it is not closed, because `EG-93-009` also requires
exercised cases from CBD-272 and the qualified review from CBD-273.

### 18.2 `CBD-270-AC02` — prohibited powers explicit, no role gains moderation authority, process inside `OP-92-001` and `OP-92-002`

**Status: Met, with one structural finding recorded rather than resolved.**

* Prohibited powers are explicit and closed: `PS-270-006`–`PS-270-014`, with
  `PS-270-015` requiring tool enforcement.
* No budget-space role gains moderation authority: `PS-270-001` and `PS-270-008`
  restate `DL-76-020` and `SR-94-102` and add nothing to any role. `PS-270-008`
  also closes the owner-reporting question, which would otherwise be the back
  door.
* The process stays inside the staff boundary: `PS-270-006` leaves `OP-92-001`
  default-deny intact, and `PS-270-017` builds intake on the `OP-92-002`
  customer-submission rule rather than on any staff read.
* **The finding:** `OP-92-003` excludes moderation from the exceptional-purpose
  list, so there is no approved path to stored content for this process at all.
  `PS-270-007` records that, `PS-270-048` states what happens to a case that
  needs it, and `OQ-270-001` routes the amendment. Staying inside the boundary
  is therefore achieved by narrowing what the process does, not by claiming an
  access the sources do not grant.

### 18.3 `CBD-270-AC03` — a named operational owner is recorded

**Status: Met, with the separation-of-duties consequence recorded.**

`PS-270-035` names Alexander Wohlford as Platform Safety Owner. `PS-270-036`
records that one person cannot satisfy `OP-92-004` and `SR-94-069`, states the
two consequences that follow, and `OQ-270-003` routes the question of whether
the external CBD-273 route is a sufficient standing substitute.

### 18.4 `CBD-270-AC04` — merged to main, published to Confluence after merge, PR and merge SHA recorded

**Status: Not met — outside this change, and correctly so.**

Merge, publication, and the completion record are Manager and Product Owner
actions. §17.1 supplies the exact manifest entry required, which must be added
by whoever owns `config/confluence-publication.json`; adding it here would
collide with concurrent work on that single-writer file. Publication also
requires explicit authorization for that specific change.

### 18.5 What this document does not close

| Gate or gap | State after this document |
| --- | --- |
| `EG-93-009` | Open. The operating model exists in draft; exercised cases and qualified review do not. |
| `RG-94-011` | Open. It requires the *"`EG-93-009` operating model and exercised cases"*. |
| `RG-94-009` | Open. Tool-enforced boundary, dual control, and tamper-evident evidence are unbuilt (`PS-270-015`, `PS-270-045`). |
| `SG-93-038` | Specified, not satisfied. Intake, triage, authority, timeline, and outcome are now written; the operational readiness gate still needs evidence. |
| `SR-94-074` and `SR-94-103` | Open. Shared comments remain unshippable, and the process that `SR-94-103` requires to own escalation now exists only on paper. |
| `EG-91-009` | Unchanged. This document reports a platform-safety process into it and closes none of its unknowns. |
| `RI-93-008` | Unchanged and respected. CBD-271 owns the semantics. |
| `FU-95-025` | Open. This is the first of its four required pieces. |

## 19. Revision history

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 0.1 | September 12, 2026 | Claude | Initial draft against the `CBD-270-AC01`–`AC04` criteria and the `EG-93-009` closure element list. Defines 74 `PS-270-*` decisions across the thirteen required elements and registers eight open questions. Records the `OP-92-003` moderation exclusion as the structural constraint the model is built around, names the operational owner, and states the single-operator separation-of-duties gap rather than assuming it away. Amends no approved source; proposes one CBD-92 amendment that remains pending under `OQ-270-001`. | Draft; Product Owner approval required, and `EG-93-009` also requires the CBD-272 exercises and the CBD-273 review |
