# CBD-270 — Platform-Safety Operating Model for Shared Comments

| Field | Value |
| --- | --- |
| Status | **Draft** — not approved. Written to close the `EG-93-009` element list. Approval authority is the Product Owner, with the qualified safety and privacy review CBD-273 obtains and the abuse-case exercise CBD-272 runs. Neither is complete, so `EG-93-009` and `RG-94-011` remain open and shared comments remain unshippable. |
| Document version | 0.3 |
| Owner | Alexander Wohlford |
| Reviewer | Pending — Product Owner, plus the qualified reviewer CBD-273 engages |
| Jira | [CBD-270](https://cobudget.atlassian.net/browse/CBD-270) |
| Parent | [CBD-131](https://cobudget.atlassian.net/browse/CBD-131) — Establish the platform-safety operating model for shared comments |
| Companions | CBD-271 report and subject-controlled detachment semantics; CBD-272 abuse-case exercise; CBD-273 qualified safety and privacy review |
| Confluence page | Not registered. `config/confluence-publication.json` needs the entry recorded in §17.1 before publication. |
| Repository baseline | `ba1c1d3` |
| Last updated | September 12, 2026 |

**Conditional decisions.** Several decisions in §9 through §13 depend on a
platform content-removal power that no approved source grants. Each is marked
**Conditional on `OQ-270-006`** at its head. A decision so marked specifies how
a capability would be bounded if it is granted; it does not assert that the
capability exists.

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
renumbered. A revision that adds a decision therefore appends the next free
number and places it in the section it belongs to, so a section's decisions are
a set rather than a contiguous range. §18.1 lists each section's set in
document order. Stability is of the **number**, not of the text behind it: a
revision may rewrite or reverse a decision, and §19 records every such change,
so an identifier cited from an earlier revision must be read against §19.

### 1.1 Authoritative inputs and pinned versions

| Source | Pinned version | What it binds here |
| --- | --- | --- |
| `docs/cbd-91-private-mvp-data-inventory.md` | Document version **1.0.5** | `DI-91-026` comment bodies, `DI-91-038` security evidence, `DI-91-043` support submissions and operator notes, `DI-91-063` case routing metadata; `EG-91-009` as the open staff-access gap this model reports into |
| `docs/cbd-92-system-flow-technical-threat-model.md` | Document version **1.0.1** | `OP-92-001`–`OP-92-008` staff boundary, `AN-92-001`–`AN-92-006` purpose separation, `EM-92-003` and `NT-92-001` channel ceilings, `SA-92-007`/`SA-92-008` audit obligations, `RL-92-003` and `RL-92-005` anti-oracle and non-weaponization rules |
| `docs/cbd-93-privacy-coercion-abuse-analysis.md` | Document version **1.1.2** | `AB-93-034` and `AB-93-071`–`AB-93-074`; `SG-93-037`–`SG-93-039`, `SG-93-050`, `SG-93-083`–`SG-93-088`, `SG-93-091`–`SG-93-094`; the `EG-93-009` closure contract |
| `docs/cbd-94-risk-mitigation-requirement-register.md` | Document version **1.0.4** | `RK-94-009`, `RK-94-014`, `RK-94-015`, `RK-94-020`; `SR-94-063`–`SR-94-074`, `SR-94-102`–`SR-94-103`; §3.6 acceptance authority, §3.8 escalation and stop-ship, `RG-94-009` and `RG-94-011` |
| `docs/cbd-94-verification-review-inventory.md` | Document version **1.0** | `MON-94-008`'s alarm classes and the `VT-94-112`–`VT-94-132` verification family, which `PS-270-070` and `PS-270-050` depend on and which resolve here rather than in the register |
| `docs/cbd-95-cbd-12-reconciliation-matrix.md` | Document version **1.0.4** | `RI-93-008` report plus subject-controlled detachment, `RI-93-016` cross-cutting copy standard, `RI-93-017` hard support-transfer refusal with a safe answer |
| `docs/cbd-95-architecture-roadmap-follow-up-register.md` | Document version **1.0.11** | `FU-95-025`, which routes this work and states the boundary: no role gains global moderation authority, and detachment cannot edit, delete, or alter authored content or financial state |
| `docs/cbd-76-mvp-boundary-and-readiness-record.md` | Document version **1.0.1** | `DL-76-020` and `INC-76-012` — the approved non-moderation rule this model must not weaken |

CBD-72 §5.6 items 4 and 9, §5.7 item 3, §6.3, and permissions 11a, 11b, 11c,
and **11d** are cited from the approved collaboration permission model at
document version **0.1.54**. Permission 11d is the most on-point approved row
in the corpus and states both halves of this document's problem at once:
*"Budget-space ownership grants no editorial or moderation authority over
another person's contribution. Serious abuse, unlawful content, or accidental
disclosure uses a separate platform safety/support process outside budget-space
role permissions."*

## 2. What this document does not decide

* It does not specify the report action or the detachment semantics.
  `RI-93-008` decided *that* they exist; CBD-271 decides audience behaviour,
  association semantics, copy fields, and failure cases. §5 here defines only
  what intake must deliver to the process.
* It runs no abuse-case exercise. CBD-272 owns that, and `EG-93-009` is not
  closed by a written model alone.
* It obtains no qualified safety or privacy review. CBD-273 owns that one-time
  chartered review, and CBD-94 §3.6 makes it mandatory for coercion,
  surveillance, and survivor-safety residuals. **This document does not widen
  CBD-273's scope.** The continuous per-case reviewer that §8, §10, and §13
  require is a separate, unfilled function defined at `PS-270-077` and routed
  at `OQ-270-003`.
* It grants itself no power over content. `PS-270-075` records that two
  approved rows prohibit staff moderation today, and every decision that
  presupposes a content power is marked conditional.
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

`PS-270-075` — **No approved source grants this process the power to remove or
withhold another author's content, and two approved sources currently prohibit
staff moderation. The power is proposed under `OQ-270-006`; it is not held.**

v0.1 recorded this as a silence in the sources. It is not a silence. Two
approved rows prohibit it in terms:

* `EG-91-009`'s recorded interim position, in the very gap §18.5 says this
  document reports into: *"No silent support access, reassignment, or
  cross-author moderation; refuse support-mediated ownership transfer until an
  identity-verified procedure is approved and security-reviewed."*
* `SR-94-067`: *"Routine staff support MUST be technically limited to the
  `OP-92-002` content-free allowlist and an opaque customer-provided correlation
  value; staff MUST NOT browse content, impersonate, moderate, or infer resource
  existence."*

The delegation that would justify the power is equally specific, and stronger
than v0.1 argued. Permission **11d** denies moderation to every role and routes
serious abuse, unlawful content, and accidental disclosure to *"a separate
platform safety/support process outside budget-space role permissions"* — this
process, named as the destination. `RI-93-008` then delegates the platform
response here explicitly: *"Exact audience behavior, copy, evidence access,
retaliation/failure cases, and platform response remain gated by
`EG-93-009`/`RG-94-011`."*

So the sources route the problem to a process and simultaneously prohibit the
process from acting on content. That is a contradiction to be resolved by an
approval, not by a specification. Two rules follow:

1. **Until `OQ-270-006` closes, this process holds no removal or withholding
   power.** `SR-94-067`'s prohibition binds routine staff support and
   `EG-91-009`'s interim position binds cross-author moderation generally. An
   unlawful-content or Critical case that requires content action therefore
   escalates under `PS-270-057` with no platform content action available.

   **That is not a dead end, and it must never be communicated as one.** An
   honest "nothing" that omits the remedies which do exist reads as
   abandonment to the person receiving it, and abandonment is itself a harm
   this model is supposed to prevent. Four remedies survive the absence of the
   content power, and the reporter is told about each that applies to them:

   | Remedy | Basis | Who acts |
   | --- | --- | --- |
   | **Subject-controlled detachment** — detach the comment's association from your own attributed record, without editing, hiding, or deleting the authored content | `RI-93-008`, decided; CBD-271 specifies it | The reporter, directly, in product |
   | **The ordinary membership remedy** — where the reporter is the Primary Owner, the approved role and lifecycle powers over membership remain fully available and are unaffected by this process | CBD-72 role model; `PS-270-001` leaves it untouched | The reporter, directly, in product |
   | **Preservation of the submission as evidence** — the case record preserves what was reported, usable outside the product where the person chooses to use it | `PS-270-040`, `PS-270-042` | The platform, on the reporter's behalf |
   | **The counsel route** — an unlawful-content case reaches a jurisdiction-scoped disposition that is not bounded by this document's internal limits | `PS-270-057` row 3; CBD-94 §3.6 | Counsel |

   What the platform cannot do is act on the content itself. The difference
   between that and "nothing" is the whole of `SG-93-086`'s honest response,
   and `PS-270-023` and `PS-270-048` restate this set at the two points a
   person actually encounters it.

1a. **Shared comments do not ship while `OQ-270-006` is open.** This is the
   forcing function, and it belongs here rather than being left to §18.5 and
   inference. `SR-94-074` makes shared comments unshippable until `EG-93-009`
   closes with the full operating model, and `RK-94-014` records comments as
   Blocking on exactly that gate. A process with no terminal action for its
   most serious case class is tolerable **only** because the surface it governs
   is not live. If comments were to ship in this state, the no-power position
   would stop being the safe reading of the sources and become an unremedied
   harm. Whoever closes `OQ-270-006` is deciding what ships, not only what
   staff may do.
2. **Every decision that presupposes the power is marked Conditional on
   `OQ-270-006`.** At decision level: `PS-270-010`, `PS-270-033`,
   `PS-270-049`, `PS-270-053`, `PS-270-060`, `PS-270-062`, `PS-270-063` —
   seven. At row level: **row 1 of `PS-270-057`'s trigger table**, which is
   marked in the row itself because the rest of that decision is
   unconditional. Row 2 of the same table, the Critical-*finding* surface
   stop, is deliberately **not** marked: suspending a defective surface is an
   operations action on a control, not an action on content, so
   `OQ-270-006` does not gate it. The `Actioned` member of the
   `platform-safety-case-outcome` vocabulary in §17.2 is flagged there for the
   same reason. Marked decisions specify how the capability would be bounded
   if granted. They do not assert it exists.

The decisions are retained rather than deleted deliberately. Removing them
would leave a document that cannot satisfy `SR-94-074`, which requires the full
operating model including *"tool boundaries"* and *"escalation/appeal rules"*,
and would leave CBD-272 with no enforcement behaviour to exercise.

**Source:** `EG-91-009`; `SR-94-067`; permission 11d; `RI-93-008`;
`SR-94-074`; `RK-94-014`; `SG-93-086`; `OQ-270-006`.

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

`PS-270-010` — **Conditional on `OQ-270-006`. No rewriting. Where an
enforcement power exists at all, it removes or withholds; it never edits.**

Where an enforcement action affects content, the only permitted effects are
withholding it from display and removing it, each recorded. No one may alter the
text of another person's comment, author content in a person's name, or change
an attribution. A rewritten comment is indistinguishable from a forged one, and
attribution is what makes the record honest.

Note that this decision constrains a power `PS-270-075` records as unheld. It
bounds the shape of a capability under consideration; it does not grant one.

**Source:** permission 11b; `SG-93-040`; `SR-94-064`; `PS-270-075`.

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

`PS-270-023` — **Intake states the limitation, the remedies, the disclosure
timing, and the severity consequence before the report is filed, and lets the
reporter decline any measure that notifies the reported author.**

The composition surface says what the process can and cannot do, in the
`SG-93-086` sense of a documented honest response. It does not promise removal,
review speed beyond §7, protection, or monitoring. `SG-93-094` requires that
irreversible consequences be stated before the action, in plain language.

Four things must be stated, and the fourth is a control rather than a
disclosure:

1. **What survives the absent content power.** The `PS-270-075` remedy set —
   subject-controlled detachment, the ordinary membership remedy where the
   reporter holds it, preservation of the submission as evidence, and the
   counsel route — stated as available remedies, not as consolation for a
   refusal.
2. **That describing a safety situation raises severity but currently buys no
   content action.** `PS-270-025` fails severity upward on ambiguity, so a
   person who explains that they are frightened of the author will move the
   case to Critical — and Critical currently has no terminal content action
   (`PS-270-075`). Without this warning the model invites a victim to write
   down their most dangerous fact, creating exactly the `SG-93-088` free text
   that is the most sensitive content in the system, in exchange for nothing.
   They may still choose to write it; they must not be led into it uninformed.
3. **When the other person may find out, not merely that they might.** Where
   a `PS-270-033` interim measure applies, `PS-270-053` notifies the reported
   author **the same business day**. "They may eventually learn of this" and
   "they will be told today" are different facts and a survivor plans around
   the second, not the first.
4. **An election to decline any measure that notifies the reported author.**
   The reporter may file the report and decline the interim measure. In a
   two-person space `PS-270-012`'s withholding of reporter identity is nominal
   — the set of possible reporters is a singleton — so a same-day notice to a
   cohabiting abuser identifies the reporter by elimination and can be acted on
   within hours. A person must not have to choose between reporting and
   controlling that. The election is offered before submission, defaults to
   nothing being applied until the reporter chooses, and **must not affect case
   handling, severity assignment, triage order, or outcome** in any way; it is
   recorded on the case so that a handler cannot read it as a signal about the
   report's merit. This mirrors the subject-control principle `RI-93-008`
   already establishes for detachment: the person at risk decides what happens
   to their own exposure.

**Source:** `SG-93-086`, `SG-93-088`, `SG-93-094`; `RI-93-016`; `RI-93-008`;
`PS-270-012`, `PS-270-025`, `PS-270-033`, `PS-270-053`, `PS-270-075`.

## 6. Severity model

`PS-270-024` — **Severity uses the CBD-94 §3.8 scale — Critical, High, Medium,
Low — rather than a parallel one, so that a platform-safety case escalates
through the register's existing rules.**

Inventing a second severity language would leave the two sets to drift, and
CBD-94's stop-ship rules are keyed to these four words.

**A higher severity currently buys the reporter no content action, and intake
says so** (`PS-270-023` item 2). Severity governs triage order, response
targets, escalation route, and specialist involvement. It does not unlock a
removal or withholding power, because `PS-270-075` records that no such power
is held. A person describing a safety situation will raise their case to
Critical and should know, before they write it, that the effect is a faster
and more senior escalation rather than the content coming down.

| Severity | Platform-safety definition |
| --- | --- |
| **Critical** | A credible threat of physical harm; content whose possession is itself unlawful; disclosure of a person's location where a safety risk is stated or evident; disclosure of an authentication factor or a live financial credential. |
| **High** | Targeted harassment of an identifiable person; content unlawful in an applicable jurisdiction other than a Critical class; disclosure of another person's sensitive personal data — account number, medical, immigration, or similar — in a comment. |
| **Medium** | Content whose subject is the reporter and which shames, degrades, or pressures them without a threat. This is `AB-93-034`'s core case and the most common one the model expects. Also repeated unwanted commenting after a detachment. |
| **Low** | Content the reporter finds unwelcome but which is within ordinary disagreement, or a mistaken disclosure the author can remedy themselves under permission 11c. |

**Source:** CBD-94 §3.8; `AB-93-034`; permission 11c; `PS-270-023`,
`PS-270-075`.

`PS-270-025` — **Ambiguity raises severity. It never lowers it.**

`OP-92-003` fixes the direction for the staff boundary — an ambiguous purpose
fails closed — and the same discipline applies to triage. Where the submission
supports two readings, the higher severity is assigned and the case is escalated
rather than resolved on a favourable interpretation.

**This rule is only as safe as `PS-270-033`'s bounds, and three of those bounds
are not operable today.** Raising severity on ambiguity, combined with an
unbounded and unappealable Critical response, would hand an abuser a
one-submission route to silencing the person they are targeting — faster and
more reliably than harassment achieves it, and with the platform as the
instrument. A severity that fails upward must not be wired to a consequence
that fails broad.

v0.2 claimed this rule was "safe because `PS-270-033` bounds" the consequence.
That claim is withdrawn as unsupported. What actually holds today is narrower:
the measure's **scope**, **reporter-observability**, and **non-refiring** bounds
are properties of the action and hold now; its **appeal** and **counter-abuse**
bounds require `PS-270-077` and an extension of `PS-270-071`, neither of which
exists. So a fail-upward severity is currently wired to a consequence that is
narrow and time-boxed but effectively uncontestable inside its two-day life.

Two things follow. The residual is real and is not accepted here — it is an
input to `OQ-270-003` and to CBD-273's review. And the fail-upward rule and
`PS-270-033` are read together: neither may be revised without the other, and
widening the consequence while this rule stands would reopen the silencing path
directly.

**Source:** `OP-92-003`; CBD-94 §3.8; `PS-270-033`; `PS-270-077`; `OQ-270-003`.

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

`PS-270-033` — **Conditional on `OQ-270-006` for its content half. A Critical
*case* takes the narrowest interim measure, time-boxed and appealable. Only a
Critical *finding* stops a release surface, and the two are not the same
trigger.**

v0.1 mapped an individual abuse case onto CBD-94 §3.8's Critical stop-ship rule
in one sentence. That was a category shift and it is withdrawn. §3.8's trigger
is *"New or failed **Critical** finding"* — a defect in the product's own
controls — and its remedy is stopping a **release surface**. An abuse case is
not a finding about a control, and a report is not evidence that the comment
surface is defective.

The two are separated:

| Trigger | What it is | Response |
| --- | --- | --- |
| Critical **case** | One report meeting the `PS-270-024` Critical definition | The narrowest interim measure below. Never a target-wide or product-wide suspension. |
| Critical **finding** | A defect in this process's controls — a prohibited power exercised, the tool boundary bypassed, evidence altered | CBD-94 §3.8 applies unchanged: stop the affected release surface, preserve evidence, notify the accountable owner, Security, and the Product Owner same business day. Routed as a security incident under `PS-270-057`. |

**The interim measure on a Critical case** is bounded on seven axes. Three are
enforceable today. Four are not, and saying so is the point — v0.2 presented
five as live bounds when two of them depend on a function §8 records as
unfilled.

| # | Axis | Enforceable today? |
| --- | --- | --- |
| 1 | Scope | **Yes** — a property of the action |
| 2 | Duration | **Yes** — automatic expiry |
| 3 | Appeal | **No** — requires `PS-270-077`, unfilled |
| 4 | Voice | Partly — the notice can be sent; it exists to enable axis 3, which cannot be heard |
| 5 | Counter-abuse | **No** — `PS-270-071`'s scope does not reach it |
| 6 | Reporter-observability | **Yes** — a property of the action |
| 7 | Non-refiring | **Yes** — a property of the action |

1. **Scope.** It withholds from display only the specific reported comment. It
   never suspends the reported author's ability to comment, never affects the
   author's other content, never affects the target's other comments, and never
   suspends the comment surface for a target, a space, or the product. Only
   this decision may specify a suspension at all, and only on a Critical
   finding.
2. **Duration.** It expires automatically at the `PS-270-029` Critical terminal
   milestone — two business days — unless a terminal decision has replaced it.
   It does not renew by default, and an expiry is an audited event.
3. **Appeal.** It is appealable by the reported author under §13 from the
   moment it takes effect, and the appeal is heard on the interim measure
   itself rather than deferred to the terminal decision. `PS-270-062`'s rule
   that an appeal does not suspend a Critical enforcement action applies to a
   terminal action, not to this measure. **This axis is not operable today.**
   §13's appeal route for a Critical measure runs to the `PS-270-077` standing
   independent reviewer, which is unfilled, so in the current state the measure
   is unappealable in practice and its two-business-day life expires before any
   independent person has considered it.
4. **Voice.** The `PS-270-053` notice is sent when the measure takes effect,
   not when the case closes, so the author learns of it in time to appeal
   within its two-day life. **This axis exists only to enable axis 3.** With
   axis 3 inoperable, the notice tells the author something has happened and
   gives them nowhere to take it. It is retained because notice without remedy
   is still better than a silent measure, not because it is sufficient.
5. **Counter-abuse.** Repeated Critical-severity reports against one author
   that do not survive triage are an abuse signal and are recorded as such.
   **The review that would act on the signal does not currently exist.**
   `PS-270-071`'s stated scope is closed cases, missed targets, and
   prohibited-power alarms; a pattern of non-surviving Critical reports is none
   of those, so recording the signal today routes it nowhere. `PS-270-020`'s
   rate ceiling does not bound the pattern either, because one submission
   suffices. Extending `PS-270-071`'s scope, or building a distinct review, is
   a `RG-94-011` readiness input and is unbuilt.
6. **Reporter-observability.** The measure withholds the comment from **every
   reader except the reporter**, who continues to see it exactly as before.
   Otherwise the reporter watches the comment vanish and has real-time
   confirmation that their submission graded Critical — precisely the
   state-dependent response `PS-270-013` and `RL-92-003` forbid, and a
   calibration signal for anyone tuning submissions until one lands.
7. **Non-refiring.** Once a Critical report against a specific comment has
   failed to survive triage, **no further report against that same comment may
   trigger an interim measure**, by any reporter, at any severity, unless a
   materially new fact is recorded and the `PS-270-057` row-1 authority
   approves it specifically. Without this rule the two-day measure can be
   re-fired indefinitely on the same content. `PS-270-022`'s duplicate grouping
   does not close the gap — it governs outcome weighting, not measure
   triggering — and `PS-270-059`'s reopening triggers do not cover it.

**The measure's protective value depends on the reader count, and below a
threshold it has none.** In a two-person space the only other reader is the
reported author, who has already read what they wrote. Withholding the comment
from them protects nobody, while delivering the full silencing effect an abuser
wants. The protective purpose of this measure therefore **does not apply in a
space whose readership, excluding the reporter and the reported author, is
empty**, and the measure is not applied there. What remains available in that
case is `PS-270-075`'s enumerated remedy set. Whether a higher threshold is
warranted is a Product Owner decision this document does not take.

**The divergence from CBD-94 §3.8 is recorded, not hidden.** This document
declines to apply the release-surface stop-ship rule to case handling, and
states why. If the Product Owner and Security prefer the §3.8 mapping, that is
a decision to take knowingly, against the coercion analysis in §15 and
CBD-93 §5.3.

Where `OQ-270-006` leaves the withholding power unheld, the interim measure is
unavailable and a Critical case escalates under `PS-270-057` with no in-product
measure at all.

**Source:** CBD-94 §3.8; `PS-270-024`, `PS-270-025`, `PS-270-029`; `AB-93-034`;
CBD-93 §5.3; `PS-270-075`.

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

Two consequences bind, and both fall on the **standing independent reviewer**
that `PS-270-077` defines — not on CBD-273:

* A Critical case, an account-level action, and any case in the `PS-270-028`
  class may not be closed on the operational owner's judgement alone. Each
  requires the standing independent reviewer's disposition in the case record.
* An appeal against a decision the operational owner made is decided by someone
  else, which in Private MVP means the same standing function (§13).

**Source:** `OP-92-004`; CBD-94 §3.6; `SR-94-069`; `PS-270-077`.

`PS-270-077` — **The standing independent reviewer is a continuous operational
function. It is not CBD-273, it is unfilled, and naming who holds it is an open
staffing question.**

v0.1 conflated two different things under the name CBD-273, and the conflation
would have redefined a sibling subtask's scope without its knowledge. They are
separated here:

| | CBD-273 qualified safety and privacy review | Standing independent reviewer |
| --- | --- | --- |
| Shape | One-time chartered review of this operating model and its package | Continuous per-case function |
| Volume | Bounded, one engagement | Unbounded; scales with case volume |
| What it produces | A disposition on the model, feeding `EG-93-009` and `RG-94-011` | A per-case disposition, a post-use review of every case access and enforcement execution (`PS-270-050`), and appeal decisions (`PS-270-061`) |
| Status | Chartered, and CBD-273 can begin against this document | **Unfilled.** No person or function is named |

CBD-273's charter is unchanged by this document and its scope is not widened
by it. The standing function is what `OP-92-004`, `OP-92-007`, and `SR-94-069`
actually require of day-to-day operation, and with one named individual (§8)
nobody holds it. Who does — a second employee, a retained external reviewer, or
an explicit Product Owner acceptance of the gap — is recorded at `OQ-270-003`
and is a `RG-94-011` readiness input. Nothing in §8, §10, or §13 is operable
until it is answered.

**Source:** `OP-92-004`, `OP-92-007`; `SR-94-069`; CBD-94 §3.6; `RG-94-011`;
`OQ-270-003`.

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

`PS-270-047` — **The reporter's submission is the complete *content* boundary
of an ordinary case. It is not the complete data boundary, and `PS-270-076`
states the difference.**

v0.1 said "nothing else is read", which its own decisions contradict:
`PS-270-053` delivers a notice to the reported author, `PS-270-021` recognizes
reciprocal parties, and `PS-270-046` prohibits searching cases by counterparty,
which presupposes a counterparty field exists. Each requires resolving an
opaque comment reference to an author identity and a delivery destination —
exactly two of the classes `OP-92-001` denies by name. The claim is corrected
rather than repeated.

**Source:** `OP-92-001`, `OP-92-003`; `PS-270-017`; `PS-270-076`.

`PS-270-076` — **A minimum non-content resolution step exists, is
machine-mediated, and returns no content to any person.**

Identity and routing are not content, but that distinction has to be stated and
bounded rather than assumed. The step resolves the opaque comment reference the
reporter supplied, and only that reference:

| Resolved | Class | Who sees it |
| --- | --- | --- |
| Comment author's internal subject identifier | `DI-91-001` account subject reference | **Nobody.** Held by the service; never rendered to a case handler |
| Author's notification destination | `DI-91-029` destination, S3 | **Nobody.** Consumed by the notification service to address the `PS-270-053` notice; never rendered, exported, or written into the case record |
| A **space-scoped** opaque counterparty token for `PS-270-021` and `PS-270-046` | `DI-91-063`-class opaque correlation, S2 | The case handler, as an opaque token that supports "same party **within this space**" and nothing else |
| Whether the reference resolves at all | Boolean, internal | **Nobody.** A non-resolving reference produces the same uniform outcome as any other, per `PS-270-013` |

Seven constraints bind the step:

1. **Gated on the reporter's read authorization, checked first.** Resolution
   executes **only after** an authorization check confirms the reporter could
   currently read the referenced target and comment. Without this gate the step
   is two primitives at once: an **unsolicited-notification primitive**, where
   a crafted or guessed reference delivers a safety notice to an author the
   submitter has no relationship with, and an **existence oracle**, where the
   fact that a notice went out confirms the reference was real. A failing
   authorization check must be **indistinguishable from a non-resolving
   reference** — same outcome, same latency class, same record shape, per
   `PS-270-013` and `RL-92-003`.
2. **Machine-mediated, never staff-visible.** No person in this process sees a
   name, an email address, a phone number, a membership graph, or a space. The
   resolution is a service call whose outputs address a notice and mint a
   token.
3. **Reference-scoped.** It resolves the one comment reference in the
   submission. It enumerates nothing, walks no membership graph, and answers no
   question that was not asked by that reference.
4. **No content.** It never returns comment bodies, financial data, role or
   lifecycle state, or any other person's data.
5. **The counterparty token is derived per space, never globally.** A token
   stable across spaces is a cross-space identity graph: it would let a handler
   see, without searching, that two cases concern the same person in different
   spaces — which `PS-270-046` prohibits — and that two cases are reciprocal,
   which `PS-270-021` says must never be cross-referenced. `DI-91-001` and
   `SR-94-130`–`SR-94-135` forbid exactly that correlation. The token is
   therefore derived per space, or per space-pair where a case genuinely spans
   two, and tokens minted in different spaces are not joinable by any party.

   **This weakens axis-5 counter-abuse across spaces, and the trade is made
   deliberately.** A person who files non-surviving Critical reports against
   the same author in three different spaces presents as three unrelated
   counterparties, so `PS-270-033`'s non-refiring and counter-abuse bounds
   operate only within a space. The alternative — a global token — buys
   cross-space abuse detection at the price of building the surveillance graph
   the sources prohibit, in a product whose whole threat model is people who
   know each other. Cross-space abuse detection, if it is wanted, needs its own
   decision with privacy input; it is not smuggled in through a token
   derivation an implementer would otherwise settle silently toward the global
   form.
6. **Audited with a fixed field set that is identical whether or not the
   reference resolves.** See below.
7. **Not currently enforceable.** As with `PS-270-045` and `PS-270-050`, this
   decision states a design, not a control that exists. "Never staff-visible"
   is enforced by tooling `PS-270-015` requires and that is unbuilt;
   `RG-94-009` is open on exactly that evidence; and `PS-270-077`, the function
   that would independently review each resolution, is unfilled. Until all
   three close, the separation described here rests on nobody looking rather
   than on nobody being able to look.

**The audit record's shape must not leak what its fields do not.** v0.2 said
the resolution event records "the outputs' classes — never their values", which
still discloses the resolution boolean the table says nobody sees: a
non-resolving reference produces a shorter class list than a resolving one, and
shape is disclosure. The event therefore carries a **fixed field set, identical
in both cases** — no field whose presence, absence, length, or count varies
with the outcome.

These fields are prohibited in the resolution audit record, and the list is
exhaustive rather than illustrative:

| Prohibited | Why |
| --- | --- |
| The resolved subject identifier | It is the identity the step exists to avoid exposing |
| The destination, or **any transformation of it** — hash, prefix, domain, last-four, or length | Each is a selector or a fingerprint; a domain alone narrows the population |
| The comment body or any excerpt of it | `PS-270-047`; it is content |
| The resolution boolean, or any field implying it | The existence oracle in constraint 1 |
| The token in any cross-space-joinable form | Constraint 5 |
| Any handler-readable join key between the case and a space, target, or membership | It reconstructs the graph the token derivation was scoped to prevent |
| The reporter's identity in the same record as the resolved author | Co-location of the two is the retaliation disclosure `PS-270-012` forbids |

**This is a narrowing of `OP-92-001`, not an exception the sources grant.**
`OP-92-001` names notification destinations and membership graphs among the
classes routine staff receive no path to, and it does not distinguish
machine-mediated resolution from staff access. The construction above is
designed to honour the rule's purpose — no person learns anything — but it is
**not authorized by any approved row**, and this document does not claim it is.
It is routed as a further open question at `OQ-270-009` alongside `OQ-270-001`,
because the same amendment conversation settles both.

**Source:** `OP-92-001`; `DI-91-001`, `DI-91-029`, `DI-91-063`;
`SR-94-130`–`SR-94-135`; `RL-92-003`; `PS-270-012`, `PS-270-013`, `PS-270-015`,
`PS-270-021`, `PS-270-046`, `PS-270-053`, `PS-270-077`; `RG-94-009`;
`OQ-270-009`.

`PS-270-048` — **A case that cannot be decided from the submission escalates and
is not decided.**

The foreseeable instances are: the author contests that the submitted copy is
what they wrote; an unlawful-content class requires acting on the stored record
rather than on a copy; or an appeal turns on the state of the content at a past
time. In each, the model has no approved way to look, so the case does not get
decided by looking. It goes to §12 with the question stated, and the honest
outcome may be that the platform cannot resolve it — which the reporter is told,
under `SG-93-086`.

**Told with the remedies, never as a bare refusal.** The message states which
of the `PS-270-075` remedies apply: subject-controlled detachment, the ordinary
membership remedy where the reporter holds it, preservation of the submission
as evidence they may use outside the product, and the counsel route for an
unlawful-content class. "We cannot act on this content" and "there is nothing
you can do" are different statements, and only the first is true.

**Source:** `OP-92-003`; `SG-93-086`; `PS-270-075`; `OQ-270-001`.

`PS-270-049` — **Conditional on `OQ-270-006`. Enforcement execution, where a
power to execute exists, is mediated, narrow, and preserves every ordinary
invariant.**

Where an approved enforcement action affects stored content, it runs through a
narrow service workflow on the `OP-92-005` pattern: no general database access,
no bulk operation, no impersonation, and preservation of ordinary authorization,
lifecycle, integrity, and audit invariants. The workflow performs the specific
action and returns; it is not a content-browsing tool with an action attached.

**Source:** `OP-92-005`; `SR-94-068`; `PS-270-075`.

`PS-270-050` — **Every access to a case and every enforcement execution is
attributable, time-bound, and independently reviewed.**

Attribution follows `OP-92-007`: strong authentication, the decision, the
approved scope, the actions taken, the result, and an independent post-use
review. With one operator, the reviewer is the standing independent function in
`PS-270-077`, which is unfilled — so this decision states a requirement that is
not currently satisfiable, and `RG-94-009` stays open on it.

**Source:** `OP-92-007`; `SR-94-070`; `PS-270-077`; `RG-94-009`.

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
`No action`, `Out of scope`, `Escalated`, `Withdrawn`. `Actioned` is reachable
only if `OQ-270-006` grants the content power; until then every case that would
have been `Actioned` terminates as `Escalated`.

**Source:** `PS-270-013`; `SR-94-065`; `RL-92-003`.

`PS-270-053` — **Conditional on `OQ-270-006`. What the reported author
receives: notice at the point an action or an interim measure lands, stating it
and the appeal route.**

The notice states which content is affected, what changed, when it took effect,
when an interim measure expires, and how to appeal. It never names or
characterizes the reporter, never quotes the reporter's submission, never
states how many reports were made, and never describes any person's
circumstances. For a `PS-270-033` interim measure the notice is sent when the
measure takes effect, so that the author can appeal inside its two-business-day
life.

Addressing this notice requires the `PS-270-076` resolution step, which is
itself unrouted under `OQ-270-009`.

**Source:** `PS-270-012`; `SG-93-092`; the `RI-93-015` notice-field pattern;
`PS-270-033`, `PS-270-076`.

`PS-270-054` — **A third party whose visible state changes receives only what
the ordinary rules already allow.**

If an enforcement action changes what other readers of a target can see, they
see the ordinary consequence — a neutral tombstone where the approved lifecycle
rules call for one — and receive no notice that a platform-safety case exists.
Inventing a new disclosure here would make every enforcement action an
announcement inside the space.

**Indistinguishability is the requirement, not neutrality of wording.** Any
artifact a platform withhold or removal leaves behind must be **byte-for-byte
indistinguishable** from the artifact a permission-11c author self-removal
leaves behind: same presence or absence, same text, same metadata, same
ordering and position, same timing granularity, same behaviour on reload and in
any export or report that renders it. A tombstone that reads differently, that
appears where a self-removal leaves none, or that carries a distinguishable
timestamp or actor class, tells every reader that *the platform acted* — and in
a small space the reporter follows by elimination, which is the retaliation
disclosure `PS-270-012` exists to prevent. This is a negative test, not a copy
guideline: the two cases must be indistinguishable to a reader who is looking
for the difference.

The same requirement binds the `PS-270-033` interim measure, whose
reporter-visible asymmetry (axis 6) must not be inferable by any other reader.

**Source:** permission 11c tombstone rule; `DI-91-026`; `SR-94-065`;
`PS-270-012`, `PS-270-033`; `RL-92-003` uniformity principle.

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

`PS-270-057` — **Six triggers escalate, and each names the authority that must
act. A Critical *case* and a Critical *finding* are different rows, and only
the finding stops a surface.**

v0.2 left row 1 of this table saying *"Stop the affected surface"* on a Critical
case, citing `PS-270-033` as its authority while `PS-270-033` had been rewritten
to forbid exactly that. §12 is the runbook a handler reads under time pressure,
so the stale row was the operative instruction and the rewrite was decoration.
The row is corrected here, and the surface-stopping action is moved to its own
trigger where it belongs.

| Trigger | Mandatory action | Authority |
| --- | --- | --- |
| Critical **case** severity assigned — **Conditional on `OQ-270-006`** | Apply the `PS-270-033` interim measure and nothing wider: withhold the one reported comment, time-boxed, never a target-, space- or product-wide suspension. Preserve evidence. Notify Security and the Product Owner same business day. Where `OQ-270-006` is open, no measure is available and the case escalates with none. | Product Owner, on the `PS-270-077` standing independent reviewer's recommendation. **That function is unfilled (§8), so this authority does not currently exist and the case cannot be closed.** |
| Critical **finding** — a defect in this process's own controls | CBD-94 §3.8 applies unchanged: stop the affected release surface, preserve safe evidence, notify the accountable owner, Security, and the Product Owner same business day. This is an operations action on a defective control, not an action against any person, and it is **not** gated by `OQ-270-006`. | Security and the Product Owner; CBD-94 §3.8 |
| Coercion, surveillance, or survivor-safety class (`PS-270-028`) | Route for qualified advocacy or privacy input before any terminal disposition | Product Owner after qualified input; CBD-94 §3.6 |
| Legal process, regulator demand, or an unlawful-content class | Do not answer internally; do not confirm or deny existence; obtain a jurisdiction-scoped disposition | Counsel. CBD-94 §3.6 states this cannot be accepted by internal product or engineering judgement alone |
| The case cannot be decided from the submission (`PS-270-048`) | State the question; do not obtain content access; record the limitation | Product Owner and Security, jointly, under `OQ-270-001` |
| A control failure — a prohibited power exercised, evidence altered, a boundary bypassed | Treat as a security incident **and** as a Critical finding under row 2; preserve evidence; the `OP-92-003` incident path applies to the incident, never to the original case | Security; `MON-94-008` |

**Only `PS-270-033` may specify a suspension of a surface, a target, or a
space, and only on a Critical finding.** No other decision in this document
authorizes one, and §16.1 check 8 enforces that mechanically. §4 does not
prohibit suspension — it is an operations action, not one of the staff powers
§4 governs — so nothing else in the document would have caught the stale row.

**Source:** CBD-94 §3.6, §3.8; `MON-94-008`; `OP-92-003`; `PS-270-033`,
`PS-270-077`.

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

`PS-270-060` — **Conditional on `OQ-270-006` for its first two rows. Three
parties may appeal, and each appeals one thing.**

| Appellant | May appeal |
| --- | --- |
| The author whose content was removed or withheld | The enforcement action against their content, **and separately the `PS-270-033` interim measure, from the moment it takes effect** |
| The account holder subject to an account-level action | That action |
| The reporter | A terminal no-action outcome on their case |

The interim measure is appealable in its own right rather than folded into the
terminal decision, because a two-business-day silencing that can only be
contested after it has expired is not appealable in any sense that matters.

**Source:** `SG-93-050`, which requires that a person may contest a shared record
that describes them; `RI-93-008`; CBD-94 §3.6; `PS-270-033`; `PS-270-075`.

`PS-270-061` — **An appeal is decided by someone other than the original
decider, which in Private MVP means the external route.**

`OP-92-007` requires post-use review *"by a person independent of the
requester"*. With one operational owner, internal independence does not exist
(`PS-270-036`), so an appeal against a Critical decision, an account-level
decision, or a `PS-270-033` interim measure is decided by the standing
independent reviewer in `PS-270-077` — **not** by CBD-273, whose charter is a
one-time review of this model. An appeal against a Medium or Low content
decision may be decided by the operational owner only where it raises a fact
the original decision did not consider; otherwise it escalates.

The standing function is unfilled, so this appeal route does not currently
exist. That is the limitation, stated as one, and it is why `OQ-270-003` is a
`RG-94-011` readiness input rather than a note.

**Source:** `OP-92-007`; `SR-94-069`; `PS-270-036`, `PS-270-077`; `OQ-270-003`.

`PS-270-062` — **Conditional on `OQ-270-006`. One appeal per decision, within a
stated window, with a closed outcome set.**

The outcome set is `Upheld`, `Reversed`, `Modified`, `Out of scope`. The window
is 30 days from the notice of the decision, and a late appeal is recorded and
refused rather than silently dropped.

An appeal does not suspend a terminal Critical enforcement action. It **does**
apply to a `PS-270-033` interim measure, which is not a terminal action: an
appeal against the measure is heard inside the measure's two-business-day life,
and where it cannot be, the measure expires on schedule rather than being
extended to await the appeal.

**Source:** `SR-94-063`; CBD-94 §3.8; `PS-270-033`; `PS-270-075`.

`PS-270-063` — **Conditional on `OQ-270-006`. A reversal restores the content
and records the reversal; it does not erase the case.**

`SR-94-064` requires that selective deletion be detectable. A reversed decision
leaves both decisions in the record.

**Source:** `SR-94-064`; `PS-270-045`; `PS-270-075`.

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
| `OQ-270-003` | **Who holds the `PS-270-077` standing independent reviewer function?** It is continuous and unbounded in volume — a disposition on every Critical, account-level and `PS-270-028` case, a post-use review of every case access and enforcement execution, and every appeal against the operational owner. CBD-273 is a one-time chartered review and is **not** this function; v0.1 wrongly used it as one. The candidates are a second named individual, a retained external reviewer under a standing engagement, or an explicit Product Owner acceptance of the gap with a narrowed scope for what the process may do without it. **The retained-external-reviewer candidate is not free of the `PS-270-038` constraint**: a standing external reviewer sees `DI-91-043` S3 case content including `SG-93-088` safety disclosures, which places that content in a subprocessor's custody and requires the same new Product Owner and privacy approval, subprocessor evidence, access, retention, and deletion rules that `PS-270-038` demands of an outsourced queue. Choosing it is choosing that approval, not avoiding it. Until this is answered, §8, §10 and §13 are not operable, and `PS-270-033` axes 3 and 5 do not function. | `SR-94-069` requires organizational and technical separation, and `OP-92-007` requires an independent post-use reviewer. This document cannot create a person or widen a sibling subtask's charter | Product Owner and Security; a `RG-94-011` readiness input |
| `OQ-270-004` | Retention, deletion, redaction, and legal-hold rules for `DI-91-043` case content and `DI-91-063` metadata. | `DI-91-043` records them as unknown and `EG-91-009` owns them. Inventing a period would be a false closure | The `EG-91-009` owner, with legal input where hold or deletion claims are implicated |
| `OQ-270-005` | A non-user third party named in a comment — a merchant counterparty, an ex-partner, a child — has no account and therefore no intake path. Does one exist, and what would it disclose? | CBD-93 §7.1 records that free text is frequently about someone other than its author; no approved source gives a non-user standing | Product Owner, with privacy and legal input; interacts with `EG-93-002` |
| `OQ-270-006` | **Does the platform hold any power to remove or withhold an author's content? Proposed amendment, pending.** Not a silence in the sources but a live contradiction between them. **Prohibiting:** `EG-91-009`'s interim position — *"No silent support access, reassignment, or cross-author moderation"* — and `SR-94-067` — *"staff MUST NOT browse content, impersonate, moderate, or infer resource existence."* **Delegating:** permission 11d routes serious abuse, unlawful content, and accidental disclosure to *"a separate platform safety/support process outside budget-space role permissions"*, and `RI-93-008` leaves the *"platform response"* to this document. The amendment sought is a bounded platform content power, scoped to the unlawful-content and Critical classes, shaped by `PS-270-010`, `PS-270-033`, and `PS-270-049`, and recorded as a closure of the moderation limb of `EG-91-009`. Without it the process has no terminal action and `SR-94-074` cannot be satisfied. | `EG-91-009` is the owning gap and is not this package's to close; permission 11d and `DL-76-020` are approved product decisions. Asserting the power here would settle product intent by specification | The Product Owner **and the accountable security decision-maker**, who `EG-91-009` names jointly with CBD-93/94 as its disposition authority |
| `OQ-270-009` | **Is the `PS-270-076` machine-mediated resolution step permitted, and under what record?** It resolves a comment reference to an author identifier and a notification destination — two classes `OP-92-001` denies by name — without rendering either to any person. The construction honours the rule's purpose but is authorized by no approved row. The same amendment conversation as `OQ-270-001` settles it, and the two should be taken together. **Proposed amendment, pending.** | `OP-92-001` draws no distinction between machine-mediated resolution and staff access, and CBD-92 belongs to another package | Product Owner and Security, through the same focused change to CBD-92 as `OQ-270-001` |
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
6. Every decision `PS-270-075` lists as conditional at decision level carries
   the literal marker **Conditional on `OQ-270-006`** in its own heading, and
   no decision carries the marker without appearing in that list. The one
   row-level marker — `PS-270-057` row 1 — is enumerated in the same list and
   is checked as a row. The sets must not drift, because the marker is what
   tells a reader, and the Guard registering the §17.2 vocabulary, that the
   capability is undecided.
7. `Actioned` is the only `platform-safety-case-outcome` member reachable
   solely through a conditional decision, and §17.2 says so.
8. **No decision other than `PS-270-033` *authorizes* a suspension, stop, or
   disabling of a surface, a target, a space, or the product.** Check 5 is
   blind to this: it tests the §4 prohibited-power list, and §4 does not
   prohibit suspension, because suspension is an operations action rather than
   one of the staff powers §4 governs. This check is what would have caught
   the stale `PS-270-057` row that survived the v0.2 rewrite of `PS-270-033`.

   The discriminator is **authorizing** language, and the check must encode it
   or it will be noisy enough to ignore — the failure mode
   `scripts/check-doc-vocabulary.py` documents for itself. Four constructions
   currently match a naive keyword scan and none is a defect, so the check
   exempts them explicitly:

   | Construction | Example in this document | Why exempt |
   | --- | --- | --- |
   | Prohibitive | `PS-270-033` axis 1, *"never suspends the comment surface for a target, a space, or the product"* | It forbids the thing being scanned for |
   | Suspending an **action**, not a surface | `PS-270-062`, *"an appeal does not suspend a terminal Critical enforcement action"* | A different sense of the word |
   | Explanatory prose about the rule itself | `PS-270-075` item 2, on why the Critical-finding row is unmarked | It describes the boundary rather than crossing it |
   | §19 revision history | the v0.3 entry, which quotes the stale row it removed | Rewriting it would falsify the record |

   The check fails on an authorizing construction — imperative or permissive —
   naming a surface, target, space, or product, anywhere outside `PS-270-033`
   and the two `PS-270-057` rows that cite it.
9. Every decision `PS-270-033` marks as not enforceable today still says so —
   axes 3, 4, and 5 — and none has quietly become a claimed control.

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

**Both sets are complete as written, and one member is not yet reachable.**
`Actioned` depends on the content power `OQ-270-006` has not granted; until it
does, a case that would be `Actioned` terminates as `Escalated`
(`PS-270-052`). The member stays in the registered set — removing it would make
the vocabulary drift the moment the question closes — but whoever registers it
should know the capability behind it is undecided. The whole
`platform-safety-appeal-outcome` set is likewise reachable only through
`PS-270-062`, which is conditional.

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
| 2 | Prohibited staff powers | §4 | `PS-270-006`, `PS-270-007`, **`PS-270-075`**, `PS-270-008`–`PS-270-015` |
| 3 | Intake | §5 | `PS-270-016`–`PS-270-023` |
| 4 | Severity model | §6 | `PS-270-024`–`PS-270-028` |
| 5 | Response targets | §7 | `PS-270-029`–`PS-270-034` |
| 6 | Staffing and on-call ownership | §8 | `PS-270-035`, `PS-270-036`, **`PS-270-077`**, `PS-270-037`–`PS-270-039` |
| 7 | Evidence handling | §9 | `PS-270-040`–`PS-270-045` |
| 8 | Access controls | §10 | `PS-270-046`, `PS-270-047`, **`PS-270-076`**, `PS-270-048`–`PS-270-050` |
| 9 | User communication | §11 | `PS-270-051`–`PS-270-056` |
| 10 | Escalation | §12 | `PS-270-057`–`PS-270-059` |
| 11 | Appeals | §13 | `PS-270-060`–`PS-270-065` |
| 12 | Audit | §14 | `PS-270-066`–`PS-270-071` |
| 13 | Training | §15 | `PS-270-072`–`PS-270-074` |

The order is the criterion's order. Decisions are listed in the order they
appear in the section, which is not always numeric: the bold decisions were
added in later revisions and appended at the next free number rather than
renumbering, then placed where they belong. §1 records the convention.

**The property that holds is that no number has been reused or renumbered — not
that meanings are unchanged.** v0.2 claimed `PS-270-001`–`074` keep their v0.1
meanings, which its own revision history contradicts: `PS-270-033` was rewritten
and its conclusion reversed, `PS-270-047` now asserts the opposite of its v0.1
text, and `PS-270-025`, `036`, `050`, `052`, `053`, `060`, `061`, and `062` all
changed substantively. v0.3 changes more of them again. A reader resolving a
`PS-270-*` reference from an earlier revision must read §19 to see what that
identifier meant at the time; the number is stable, the content is versioned.

`CBD-131-AC01` is supported to the extent a written model supports it; it is
not closed, because `EG-93-009` also requires exercised cases from CBD-272 and
the qualified review from CBD-273.

### 18.2 `CBD-270-AC02` — prohibited powers explicit, no role gains moderation authority, process inside `OP-92-001` and `OP-92-002`

**Status: Met in part, with a structural finding. The residue is routed, not
closed.**

v0.1 marked this **Met**. That was wrong: it was graded against `OP-92-001` and
`OP-92-002`, which the criterion names, while `SR-94-067`'s staff-moderation
prohibition and `EG-91-009`'s interim cross-author-moderation position went
unaddressed even though the document cited `SR-94-067` five times. A criterion
is not met by satisfying the two rows it names while leaving a third prohibition
in the same boundary unexamined.

What is met:

* Prohibited powers are explicit and closed: `PS-270-006`–`PS-270-014` and
  `PS-270-075`, with `PS-270-015` requiring tool enforcement.
* No budget-space role gains moderation authority: `PS-270-001` and `PS-270-008`
  restate `DL-76-020`, permission 11d, and `SR-94-102`, and add nothing to any
  role. `PS-270-008` also closes the owner-reporting question, which would
  otherwise be the back door.
* The process stays inside `OP-92-001` and `OP-92-002`: `PS-270-006` leaves
  default-deny intact, and `PS-270-017` builds intake on the `OP-92-002`
  customer-submission rule rather than on any staff read.

What is not met, and where it goes:

* **`OP-92-003` excludes moderation** from the exceptional-purpose list, so no
  approved path reaches stored content. `PS-270-007` records it, `PS-270-048`
  states what happens to a case that needs it, `OQ-270-001` routes the
  amendment.
* **`SR-94-067` and `EG-91-009` prohibit staff moderation outright.**
  `PS-270-075` quotes both, holds the removal power unheld, and marks seven
  dependent decisions conditional. `OQ-270-006` routes the amendment to the
  Product Owner and the accountable security decision-maker jointly.
* **`PS-270-076`'s resolution step narrows `OP-92-001` without authorization**
  from any approved row. `OQ-270-009` routes it.

Staying inside the boundary is therefore achieved by narrowing what the process
does and by naming three amendments it would take to do more — not by claiming
an access or a power the sources do not grant.

### 18.3 `CBD-270-AC03` — a named operational owner is recorded

**Status: Met, with the separation-of-duties consequence recorded.**

`PS-270-035` names Alexander Wohlford as Platform Safety Owner. `PS-270-036`
records that one person cannot satisfy `OP-92-004` and `SR-94-069`, and states
the two consequences that follow. `PS-270-077` separates the continuous
independent-reviewer function from CBD-273's one-time chartered review — v0.1
conflated them and would have redefined a sibling subtask's scope — and
`OQ-270-003` routes the question of who holds the standing function.

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
| `EG-91-009` | Unchanged, and now correctly characterized. Its interim position actively prohibits cross-author moderation, so it is not merely the gap this document reports into — it is the gap that must close before §9 through §13 are operable. `OQ-270-006` seeks the closure of its moderation limb. |
| `SR-94-067` | Open on its moderation limb. The technical-limitation half is answered by `PS-270-015`; the *"staff MUST NOT ... moderate"* half is honoured by holding the power unheld (`PS-270-075`) and is not closed. |
| `PS-270-077` standing independent reviewer | **Unfilled.** `OP-92-004`, `OP-92-007`, and `SR-94-069` require it continuously; nobody holds it, so §8, §10, and §13 are not operable, `PS-270-033` axis 3 does not function, and `PS-270-057` row 1 has no authority that exists. `OQ-270-003`. |
| `PS-270-033` axes 3, 4, 5 | **Not operable.** Appeal needs `PS-270-077`; voice exists only to serve appeal; counter-abuse needs a review `PS-270-071`'s scope does not cover. Axes 1, 2, 6, and 7 hold today. A `RG-94-011` readiness input. |
| `PS-270-071` scope | **Too narrow for axis 5.** Closed cases, missed targets, and prohibited-power alarms do not include a pattern of non-surviving Critical reports. Extending it, or building a distinct review, is unbuilt. |
| `PS-270-054` tombstone indistinguishability | **Unverified.** It is a negative test against permission-11c self-removal, and no fixture exists. CBD-272 territory; named in §16.1. |
| `RI-93-008` | Unchanged and respected. CBD-271 owns the semantics. |
| `FU-95-025` | Open. This is the first of its four required pieces. |

## 19. Revision history

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 0.3 | September 12, 2026 | Claude | Independent review and security assessment of `654c18c` returned request_changes and remediate, converging on one central defect. **Critical:** `PS-270-057` row 1 still ordered *"Stop the affected surface"* on a Critical case, citing `PS-270-033` as authority while `PS-270-033` had been rewritten in v0.2 to forbid it — and §12 is the runbook a handler actually reads, so the stale row was the operative instruction. Suspension is an operations action, so `OQ-270-006` did not gate it and no conditional marker covered it: the one outcome an abuser most wants was the one action §12 mandated. Row 1 rewritten to the interim measure and marked conditional at row level; surface-stopping moved to its own Critical-**finding** row, correctly unmarked; the stale `PS-270-036` authority corrected to the unfilled `PS-270-077`; new §16.1 check 8 added, because check 5 tests the §4 power list and §4 does not prohibit suspension. **B6/N2:** `PS-270-033`'s five axes presented as live bounds when three are not; now seven axes with an enforceability column, and axes 3, 4, 5 marked not operable with the reason. `PS-270-025`'s "safe because `PS-270-033` bounds" claim withdrawn as unsupported. **B2:** interim measure now withholds from every reader **except the reporter**, closing the real-time Critical-grading confirmation; reader-count condition added — below a threshold the measure protects nobody while delivering full silencing value. **B4:** non-refiring rule added as axis 7. **B5:** `PS-270-023` now lets a reporter decline any measure that notifies the reported author, with no effect on handling or severity, because in a two-person space `PS-270-012` is nominal and a same-day notice reaches a cohabiting abuser. **M1:** `PS-270-075` enumerates the four remedies that survive the absent content power, restated at `PS-270-023` and `PS-270-048`. **M2:** `PS-270-075` now carries the forcing function — comments do not ship while `OQ-270-006` is open. **T1/T2/N3:** `PS-270-076` gated on the reporter's read check, failing check indistinguishable from non-resolution; counterparty token derived per space with the cross-space counter-abuse cost stated; audit record given a fixed field set and an exhaustive prohibited-field list; unenforceability recorded. **Also:** `PS-270-054` tombstone indistinguishability as a negative test; `PS-270-023`/`024` warn that describing a safety situation raises severity but buys no content action; `OQ-270-003` cross-references `PS-270-038` subprocessor custody; §1.1 pins the CBD-94 verification inventory. **N4:** the §18.1 stability claim corrected — numbers are stable, text is versioned. No approved source amended; `OQ-270-001`, `003`, `006`, `009` left open. | Draft; Product Owner approval required, and `EG-93-009` also requires the CBD-272 exercises and the CBD-273 review |
| 0.2 | September 12, 2026 | Claude | Independent review of `01a8eac` returned five blockers; all five are addressed. **F1:** v0.1 recorded the platform content power as a silence in the sources. It is a contradiction between them. Added `PS-270-075` quoting `EG-91-009`'s interim prohibition on cross-author moderation and `SR-94-067`'s *"staff MUST NOT ... moderate"* — the half of a row this document cited five times while quoting only its technical-limitation clause — against permission 11d's explicit routing of serious abuse to this process and `RI-93-008`'s delegation of the platform response. Restated `OQ-270-006` as a proposed amendment naming `EG-91-009` as the owning gap and the accountable security decision-maker alongside the Product Owner. Marked `PS-270-010`, `PS-270-033`, `PS-270-049`, `PS-270-053`, `PS-270-060`, `PS-270-062`, `PS-270-063` conditional, and flagged the `Actioned` vocabulary member. Added permission 11d to §1.1. **F2:** `PS-270-047`'s "nothing else is read" contradicted three of this document's own decisions; corrected, and added `PS-270-076` specifying the minimum machine-mediated resolution step, its four data classes, its four constraints, and that it narrows `OP-92-001` without authorization — routed at the new `OQ-270-009`. **F3:** withdrew the mapping of an individual abuse case onto CBD-94 §3.8's Critical stop-ship rule, which is scoped to a *finding* about a control stopping a *release surface*. Rewrote `PS-270-033` to separate Critical case from Critical finding and to bound the interim measure on scope, duration, appeal, voice, and counter-abuse, closing the one-submission silencing path that `PS-270-025`'s fail-upward rule opened. Recorded the divergence rather than hiding it. **F4:** downgraded `CBD-270-AC02` to Met in part with the residue routed. **F5:** added `PS-270-077` separating the continuous independent-reviewer function from CBD-273's one-time chartered review, which v0.1 conflated and would have silently widened; the standing function is unfilled and `OQ-270-003` now asks who holds it. Three decisions appended at the next free numbers rather than renumbering, so `PS-270-001`–`074` keep their v0.1 meanings. No approved source amended. | Draft; Product Owner approval required, and `EG-93-009` also requires the CBD-272 exercises and the CBD-273 review |
| 0.1 | September 12, 2026 | Claude | Initial draft against the `CBD-270-AC01`–`AC04` criteria and the `EG-93-009` closure element list. Defines 74 `PS-270-*` decisions across the thirteen required elements and registers eight open questions. Records the `OP-92-003` moderation exclusion as the structural constraint the model is built around, names the operational owner, and states the single-operator separation-of-duties gap rather than assuming it away. Amends no approved source; proposes one CBD-92 amendment that remains pending under `OQ-270-001`. | Draft; Product Owner approval required, and `EG-93-009` also requires the CBD-272 exercises and the CBD-273 review |
