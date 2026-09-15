# CBD-73 — Exhaustive Review Findings

| Field | Value |
| --- | --- |
| Status | **Remediation verified v1.0.1 — 27 of 29 findings closed; `RV-73-021` and `RV-73-025` retain source-alignment and audit-rebaseline gates. `RV-73-006` and `RV-73-013` closed with the August 18, 2026 Product Owner decisions; `RV-73-026` closed on publication** |
| Document version | 1.0.4 |
| Owner | Alexander Wohlford |
| Jira | [CBD-73](https://cobudget.atlassian.net/browse/CBD-73) |
| Reviewed repository baseline | `c096928a903dd5446b26ba21eaf7eaa2d84ce936` on `main` (PR #64 merge) |
| v0.1 finding-baseline commit | `8f1636d957534b09549f7c5e44d1b4147174f30c` |
| v0.1 finding-baseline blobs | Traceability `b70cf485`; messages `a467064e`; lifecycle specification `9a1ff4cd`; tests `86282881` |
| v0.2 remediation parent | `9a7a3fe1f8202d0aa8a25aaa6738c7015044af91`; the candidate is the exact remediation commit/tree produced from this branch, which approval/PR evidence must capture externally because a Git object cannot self-pin |
| Audit branch | `codex/cbd-73-audit` |
| Live Jira snapshot | August 18, 2026: `Ready`; 17 acceptance criteria; due August 24; blocked by CBD-72 (Done); blocks CBD-74 (Ready) |
| Method | Independent lifecycle/security, cross-source/traceability, validation/tooling, and repeated v0.2 adversarial reviews; live Jira and Confluence read; repeatable manifest-based documentation audit plus Mermaid rendering |
| Last updated | August 18, 2026 |

## 1. Scope, method, and verdict

This review re-executed the CBD-73 package claims against all four v0.1
finding-baseline documents and the coordinated v0.2 branch candidate, the live Jira issue, the approved CBD-72 permission model, the
CBD-91 data inventory, the CBD-93 decisions as dispositioned in CBD-95, and the
CBD-94 security/privacy requirements. It checked the invitation and code state
model, ceremony ordering, consent evidence, role/scope changes, revocation and
removal, notification routing, audit placement, data classes, negative tests,
stable identifiers, source versions, dependency direction, and publication
state.

The original v0.1 package was mechanically well formed but was **not ready for
Product Owner approval or implementation handoff**. The v0.2 remediation now
defines deterministic rules and evidence for 22 of the 27 findings raised
against v0.1. A later independent completeness review of the merged package
raised `RV-73-028` and `RV-73-029`, both remediated in v0.2.1, bringing the
package to 24 fixed of 29 findings. The Product Owner then closed the two
blocking questions on August 18, 2026: `RV-73-006`/`OI-73-001` by requiring the
inviter to confirm the specific accepting account, and `RV-73-013`/`OI-73-008`
by settling `Failed` as active restricted delivery metadata. `RV-73-026` closed
when the package published to Confluence. Twenty-seven of 29 findings are now
closed; `RV-73-021` and `RV-73-025` retain narrower source-alignment and
audit-rebaseline gates. The specification is approved. It is not implemented,
fixture-backed, specialist-reviewed, or released. All twelve `OI-73-*` items remain binding at the exact stage
stated in the canonical traceability register.

Severity means:

- **P1** — resolve before package approval or implementation handoff.
- **P2** — explicitly disposition before Jira synchronization; normally
  resolve before implementation of the affected path.
- **P3** — provenance, robustness, or publication work that does not by itself
  establish an unsafe product rule.

This is a documentation audit, not runtime verification, penetration testing,
privacy/legal advice, accessibility validation, usability evidence, or proof
that any implementation is secure. No Jira or Confluence content was changed.

## 2. Mechanical and live-state results

| Check | Result |
| --- | --- |
| Package files, headings, metadata, Markdown fences | Pass |
| Stable definitions | 21 `IC`, 45 `TR`, 14 `RC`, 12 `DR`, 31 `AE`, 44 `MSG`, and 12 canonical `OI`; no internal duplicates or orphan `TR`/`AE`/`MSG` definitions |
| Scenarios | 97 total after the v0.2.1 review: INV 18, VER 11, CNS 8, DCL 13, DST 8, CHG 13, RVK 16, TRF 10; all use repository-unique `FAMILY-73-NN` identifiers |
| CBD-73 acceptance-criterion rows | AC01–AC17 exactly once |
| Direct local identifier references | No dangling full identifiers |
| Local package paths | All resolve |
| Mermaid | Both repository Mermaid documents parse/render through `npm run check:docs`; the CBD-73 diagram uses full `TR-73-*` IDs |
| Live Jira | Current issue fields and linked issue directions match the snapshot above; planning-note due date still says August 21 while the live field says August 24 |
| Confluence | No current page with `CBD-73` in its title was discoverable; no CBD-73 targets exist in `scripts/sync-confluence.py` |
| Existing CBD-95 audit | 4,125 checks, 3 failures: all three frozen CBD-72 blobs differ from the now-approved CBD-72 package consumed by CBD-73 |

Run the repeatable package check with:

```sh
python3 scripts/audit-cbd-73.py
```

CI runs that command before Node installation, and the normal Node check now
renders every Mermaid block under `docs/`. The audit fixes exact v0.2 IDs,
counts, source blobs, open issues, finding rows, local paths, table structure,
and CI wiring. Its reviewed manifests freeze every transition row's direct
message/audit references, require all emitting IDs in actual scenario rows,
and require transition-specific scenario coverage. It remains structural
documentation-integrity evidence, not product approval, semantic proof,
implementation evidence, runtime delivery evidence, or specialist sign-off.

## 3. Finding summary

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| RV-73-001 | **P1** | Blocked/rate-limited creation has two incompatible visible lifecycles and can leak the private cause through status, audit, or export. | **Fixed in v0.2 draft; implementation/evidence gated by `OI-73-010`/`OI-73-011`** |
| RV-73-002 | **P1** | Ceremony authentication order conflicts across documents; decline-and-block cannot create its required account-level record for an unauthenticated/no-account recipient. | **Fixed by safe v0.2 rule; optional alternative/mechanics remain `OI-73-002`/`OI-73-012`** |
| RV-73-003 | **P1** | An older pending invitation can restore a removed member's access without the required post-removal fresh invitation. | **Fixed in v0.2 draft** |
| RV-73-004 | **P1** | Acceptance can race a delayed expiry-state transition because commit does not explicitly compare the authoritative expiry timestamp. | **Fixed in v0.2 draft** |
| RV-73-005 | **P1** | Revocation queue suppression can suppress the required removal notice, and the approved safety-channel/no-fallback routing is claimed but not carried. | **Fixed rule; source/mechanism gates remain `OI-73-003`/`OI-73-009`** |
| RV-73-006 | **P1** | Wrong-recipient coverage ends after disclosure even though the mistyped-channel controller can apparently accept and gain membership. | **Closed August 18, 2026.** The Product Owner required inviter confirmation of the specific accepting account (TR-73-38, TR-73-39, `DR-73-13`), so a mistyped channel cannot yield membership. Security/privacy review and `VT-94-009`–`VT-94-017` remain implementation gates |
| RV-73-007 | **P1** | Post-acceptance change and transfer flows do not support the package's AC12 completeness claim. | **Fixed in v0.2 draft** |
| RV-73-008 | **P1** | Approved CBD-94 invitation requirements are missing from governing inheritance and partly weakened. | **Fixed at requirement level; implementation gated** |
| RV-73-009 | **P1** | Notification-only destination data is not bound to a membership, budget space, invitation, or ceremony. | **Fixed rule/shape; source alignment remains `OI-73-003`** |
| RV-73-010 | **P1** | Decline audit events can bypass the safe non-attributing inviter presentation through administrative history/export. | **Fixed safe projection; exact copy remains `OI-73-004`** |
| RV-73-011 | **P1** | Immediate Viewer profile activation conflicts with the approved CBD-72 no-profile starting state. | **Fixed in favor of governing CBD-72** |
| RV-73-012 | **P2** | Invalid-code presentation is double-defined under AE-73-08 and AE-73-14, and unknown codes cannot populate the universal space-scoped audit schema. | **Fixed rule/cardinality; storage remains `OI-73-011`** |
| RV-73-013 | **P2** | `Failed` is called terminal but can transition again, and failed-code invalidity/recovery is omitted from the holder-facing rules and tests. | **Closed August 18, 2026.** The Product Owner settled `Failed` as active restricted delivery metadata that never invalidates a code or reaches a customer surface, with cause-neutral `MSG-73-053` prompting for typo recovery. CBD-73-AC01 and AC05 were corrected in Jira to match |
| RV-73-014 | **P2** | Ceremony-bound verification and destination proofs are not representable by DR-73-03/DR-73-07. | **Fixed shape; concrete design remains `OI-73-008`/`OI-73-012`** |
| RV-73-015 | **P2** | “Same intended recipient,” sibling invitations, and block/limiter composition are undefined across channels and aliases. | **Fixed rule; block-matching and limiter design remain `OI-73-010`** |
| RV-73-016 | **P2** | Creating-authority loss is checked as a coarse owner state rather than the exact permission and role version required by the invitation. | **Fixed by resolved v0.2 rule** |
| RV-73-017 | **P2** | Mixed change handling may delay the reduction component despite AC07's unqualified immediacy requirement. | **Fixed by resolved no-op/separate-pure-reduction rule** |
| RV-73-018 | **P2** | Two consent disclosures misstate Co-owner removal and the supported sole-Primary exits. | **Fixed semantics; exact copy remains `OI-73-004`** |
| RV-73-019 | **P2** | Several audit events are orphaned from exact transitions/scenarios, including acceptance denial. | **Fixed exact edges/cardinality; storage remains `OI-73-011`** |
| RV-73-020 | **P2** | Scenario identifiers collide repository-wide and the diagram uses non-stable transition labels. | **Fixed in v0.2 draft and enforced by audit** |
| RV-73-021 | **P2** | CBD-91 class mappings do not fit the new block, limiter, and destination records. | **Open source alignment — `OI-73-003`** |
| RV-73-022 | **P2** | “Revoked consent” is claimed as covered without defining historical consent versus current authority or testing stale-consent replay. | **Fixed in v0.2 draft** |
| RV-73-023 | **P3** | Late and duplicate delivery-provider callbacks have no deterministic no-op/recovery rule. | **Fixed in v0.2 draft** |
| RV-73-024 | **P2** | The merged package had no retained mechanical audit or CI enforcement despite claiming parser-based validation. | **Fixed — manifest-based audit plus Mermaid validation in CI** |
| RV-73-025 | **P2** | The current CBD-95 audit evidence is stale against the approved CBD-72 package consumed here. | **Open external integrity gate — `OI-73-005`** |
| RV-73-026 | **P3** | CBD-73 has no Confluence synchronization targets or discoverable published pages. | **Closed August 18, 2026.** Five pages created in the CBD space, registered in `scripts/sync-confluence.py`, and published from merged `main`; read-back confirms all five carry the approved content |
| RV-73-027 | **P3** | Governing-source provenance is incomplete, and CBD-72's own header contains conflicting approval metadata. | **Fixed provenance; external cleanup remains `OI-73-006`** |
| RV-73-028 | **P2** | The §4.4 rule 6 recipient-side checks — already-active-member suppression and terminalization of an invitation predating the account's latest membership end — had no scenario, and the `RV-73-003` disposition cited a scenario proving a different rule. | **Fixed in v0.2.1 draft** |
| RV-73-029 | **P3** | Test inventory §5 dropped the literal `CBD-73-AC14` required-case names for revoked consent and queued alerts, so the criterion could not be verified against its own wording. | **Fixed in v0.2.1 draft** |

## 4. v0.2 remediation verification and remaining gates

The v0.2 disposition ledger in the traceability document is authoritative for
current status. It records 22 findings as fixed in the draft rule/scenario
package and five as open. “Fixed” does not mean approved, implemented, tested
at runtime, or released.

The remediation added one deterministic real-or-synthetic invitation model,
authoritative timestamp and prior-membership checks, disjoint valid/invalid
code auditing, a canonical verification/authentication/choice ceremony,
membership-independent lifecycle notices, full change/removal/transfer
transition contracts, no-profile Viewer acceptance, immutable non-authorizing
consent history, scoped destination/proof records, exact audit cardinality,
late-callback idempotency, globally namespaced scenarios, and frozen governing
source blobs. The 44 message contracts and 95 scenarios include explicit atomicity, denial, replay,
cross-space, privacy-projection, and failure-recovery cases.

A second adversarial pass then reopened the provider-failure and private-cause
projection rules because a holder or inviter could still infer internal state.
The final draft keeps provider failure as active restricted metadata, preserves
the code and ceremony, and holds every private terminal cause behind one fixed
customer projection boundary. It also adds exact per-invitation cancellation,
prospective-destination retirement, denial/no-op audit edges, cross-space block
rechecks, and transition-specific scenario evidence. These closures remain
draft rules subject to the open gates below; they are not runtime findings.

The remaining findings are intentionally narrow and visible:

- `RV-73-006` / `OI-73-001` — the wrong-recipient acceptance rule needs a
  Product Owner decision and blocks package approval.
- `RV-73-013` / `OI-73-008` — Product Owner/Jira must confirm whether the
  literal Failed-link wording permits the safer active-restricted provider
  metadata rule; the semantic decision blocks AC01/AC05 and package approval.
- `RV-73-021` / `OI-73-003` — focused CBD-72/CBD-91 source alignment and
  approved new/split data classes block affected persistence and routing.
- `RV-73-025` / `OI-73-005` — the stale CBD-95 audit needs an intentional
  impact/rebaseline decision before an integrated clean-evidence claim.
- `RV-73-026` / `OI-73-007` — Confluence target registration and read-back
  parity remain a post-approval, post-merge publication step.

Eight additional open issues retain narrower safe gates without reopening the
v0.2 semantics: `OI-73-002` preserves invitation-scoped plain decline but
withholds a pre-authentication persistent block; `OI-73-004` blocks unapproved
customer copy; `OI-73-006` tracks non-blocking CBD-72 metadata cleanup; and
`OI-73-008`–`OI-73-012` block the applicable code, invalidation, limiter,
audit-storage, and identity implementations until their designs and evidence
exist. The canonical register names an owner, safe interim behavior, closure
evidence, and release effect for every issue.

## 5. Original P1 findings against v0.1 (historical evidence)

The sections below preserve the evidence that produced the original findings
against commit `8f1636d`. Their line references and imperative remediation text
are historical. Use §3–§4 above and the v0.2 traceability ledger for current
status.

### RV-73-001 — suppressed invitation lifecycle is non-deterministic and observable

`IC-73-010` forbids any response, timing, status, count, or error from
distinguishing a block or pair limit (`specification:56`). `TR-73-01` nevertheless
permits either a synthetic created/non-delivering path **or** a uniform limit
message (`specification:130`). Those choices create different records, later
statuses, resend/cancel behavior, and audit evidence. AE-73-01 also records
blocked/rate-limited denials (`specification:320`) while audit placement makes
invitation transitions customer-visible (`specification:349`), conflicting
with the non-disclosure rule at `specification:352` and DCL-08
(`test-inventory:86`).

Choose one canonical suppressed-attempt state machine. Define its record,
status, resend, cancel, expiry, audit, export, and timing behavior so every
observable surface stays equivalent. Add end-to-end block and limit fixtures.

### RV-73-002 — ceremony order and account binding conflict

The message inventory exposes protected disclosure and the unselected choice
only to a verified, authenticated recipient (`message-inventory:48-49`), while
the specification says full disclosure follows channel verification
(`specification:178`) and TR-73-11/TR-73-12 require only verification
(`specification:140-141`). The chosen block is account-level
(`specification:211`), and DR-73-05 requires a blocking recipient account
(`specification:308`), so an unauthenticated or no-account recipient cannot
commit decline-and-block as specified.

Define one canonical sequence: channel verification, account
authentication/attachment, disclosure, then choice. If an unauthenticated
decline-only path is required, define it separately and state the safe
no-account behavior for the block option.

### RV-73-003 — pre-removal invitation can restore access

TR-73-01 does not prohibit inviting an already-active member
(`specification:130`). If that person attempts acceptance, item 5 merely denies
the commit and leaves the invitation active (`specification:151`). RC-73-08
says removal invalidates codes associated with the membership
(`specification:271`), but DR-73-01/DR-73-02 contain no recipient-account or
membership association (`specification:304-305`). An unopened invitation to an
alternate channel is therefore not enumerable at removal. After removal, the
person can attach that old invitation to the same account and apparently pass
TR-73-13, violating AC10's fresh-invitation rule (`traceability:45`) and the
claim tested by RVK-03 (`test-inventory:117`).

At acceptance, reject and terminalize any invitation issued before the end of
the account's prior membership. Persist candidate-account bindings as defense
in depth, define active-member invitation behavior, and test both opened and
never-opened alternate-channel invitations across removal.

### RV-73-004 — expiry depends on worker materialization

TR-73-13 rechecks that the invitation/code are active but does not explicitly
require `now < expiry_time` (`specification:142`). If the timestamp has passed
before TR-73-07 materializes the Expired state (`specification:136`), acceptance
can succeed despite INV-04's required denial (`test-inventory:47`).

Make the authoritative timestamp check mandatory at code resolution and
acceptance commit, independent of any expiry worker, and add a delayed-worker
race fixture.

### RV-73-005 — required removal notice can be cut off or misrouted

RC-73-02 ends alert eligibility and RC-73-03 suppresses every queued unsent
attempt addressed to the former member (`specification:265-266`), while
RC-73-12 requires a post-commit affected-person notice
(`specification:275`). No membership-independent lifecycle-notice class or
cutoff exemption is defined. In addition, traceability claims `RI-93-012`
routing context (`traceability:107`), but the package only applies generic
channel ceilings. The approved rule is mandatory authenticated in-app plus
only the subject's verified private safety channel, with no external fallback
(`cbd-95-architecture-roadmap-follow-up-register.md:196-201`).

Define the account-level mandatory notice record and worker authorization
contract, carry or explicitly gate the safety-channel rule, and test removed,
missing, failed, stale, and compromised destination outcomes.

### RV-73-006 — wrong-recipient residual is not dispositioned through acceptance

VER-02 correctly observes that a stranger controlling a mistyped channel can
verify and see the bounded disclosure (`test-inventory:59`). Because AC17
deliberately permits attachment to an account with a different primary contact
(`specification:160`), that person also appears able to accept and gain the
role under TR-73-13 (`specification:142`). The scenario stops at cancel/replace,
which is no longer a recovery after acceptance.

Record whether this residual is accepted. Then test acceptance, two-way member
notice, owner detection, removal, cutoff, and retained attribution, or add a
further binding rule that prevents the unintended membership.

### RV-73-007 — post-acceptance state machines are incomplete

Traceability claims every state has actor, preconditions, result, message,
notification, audit, and recovery and points to §§10–12
(`traceability:17,47`). DR-73-08 defines proposal states including pending,
consented, withdrawn, expired, and committed (`specification:311`), but §10
does not define complete transitions for withdrawal, decline, expiry,
authorization loss, or concurrent change. CHG-07 promises a safe proposer
outcome with no matching message row (`test-inventory:109`). Ownership transfer
has the same prose-only gaps.

Add explicit transition tables for change and transfer ceremonies, including
every failure and recovery path, or narrow the AC12 completion claim.

### RV-73-008 — approved CBD-94 invitation requirements are missing

The governing inheritance table omits CBD-94 (`traceability:101-110`). Yet the
approved register requires a high-entropy, purpose-specific, recipient-bound,
versioned, expiring, one-way verifier (`cbd-94-risk-mitigation-requirement-register.md:397`),
commit-time rate/resource recheck (`:398`), and one atomic or recoverably
idempotent transition covering membership, invitation invalidation, consent,
audit, and notices (`:399`). CBD-73 leaves entropy undecided
(`specification:360`), omits rate/resource state from TR-73-13, and does not
define audit/notice recovery atomicity.

Add CBD-94 as a governing source, carry SR-94-007–011 without weakening, and
add partial-failure/idempotency and rate/resource acceptance cases.

### RV-73-009 — notification destination is not space/membership scoped

DR-73-07 stores account, destination, verification, and activation, but no
invitation, membership, budget space, or ceremony correlation
(`specification:310`). That cannot deterministically support space-scoped
delivery and cutoff and risks one acceptance changing another space, contrary
to IC-73-012 (`specification:58`). DST-03 checks privacy but not scope isolation
(`test-inventory:95`).

Decide whether the destination is membership-scoped or account-global, add the
corresponding keys/correlation, and test cross-space activation, delivery,
revocation, and removal.

### RV-73-010 — decline state can leak through audit/export

The inviter presentation intentionally defaults to making Declined
indistinguishable from expiry pending a Product Owner decision
(`specification:366`; `message-inventory:41`). AE-73-11/AE-73-12 nevertheless record
distinct decline events (`specification:330-331`), and audit rule 1 sends
invitation status transitions into customer administrative history/export
(`specification:349`). Rule 2 hides ceremony mechanics but does not clearly
hide the distinct state (`specification:350`).

Keep decline security-only or define a non-attributing customer projection
until the presentation decision is approved. Add owner-view and export leakage
tests.

### RV-73-011 — Viewer initial profile conflicts with CBD-72

CBD-72 states that every new Viewer starts with no profile and no visibility
(`cbd-72-collaboration-permission-model.md:155-156`). CBD-73 permits an
invitation to carry and atomically activate an initial profile
(`specification:186,194`) and CNS-05 requires it (`test-inventory:73`). The
traceability record correctly flags Product Owner confirmation
(`traceability:98,126`) but simultaneously claims no CBD-72 outcome is restated
with different meaning (`traceability:105`).

Keep approval blocked until change control either amends CBD-72 or removes the
initial-profile behavior, then correct the overclaim.

## 6. Original P2 findings against v0.1 (historical evidence)

### RV-73-012 — invalid-code auditing is double-defined

Invalid resolution is AE-73-14 under §4.3/TR-73-14
(`specification:122,143`) and AE-73-08 under TR-73-08
(`specification:137`). Both inventories repeat that overlap
(`specification:327,333`), while tests expect AE-73-14. An unknown opaque code
also cannot populate the universal budget-space/target schema at
`specification:316` without retaining the raw secret.

Partition valid resolution from invalid presentation, define event cardinality
and correlation, and allow a global/nullable safe fingerprint for unknown
codes.

### RV-73-013 — Failed state and code semantics disagree

Failed is inactive and labeled terminal-recoverable (`specification:78`), yet
the diagram and TR-73-05/TR-73-06 allow it to move to Superseded or Cancelled. The
permanent invalidation list, TR-73-14, and MSG-73-020 omit Failed even though
AC05 requires safe failed-code recovery (`traceability:40`). INV-05 tests only
the inviter view.

Define whether the failed record remains terminal while a successor is
created, include failed-code holder behavior consistently, and add the missing
scenario.

### RV-73-014 — ceremony-bound proofs lack binding fields

VER-05 and DST-05 require proof to be ceremony-bound
(`test-inventory:62,97`), but DR-73-03 has no ceremony/session identifier,
binding nonce, expiry, or candidate-account binding and DR-73-07 likewise lacks
ceremony correlation (`specification:306,310`).

Add explicit bindings and test account switching, concurrent ceremonies,
expiry, and replay.

### RV-73-015 — recipient identity and invitation composition are undefined

The package supersedes a second invitation to the “same intended recipient”
(`specification:150`) without defining whether sameness means normalized
destination, account, privacy token, or person. Email and phone siblings can
therefore stay active and attach to one or different accounts. Decline-and-block
also leaves other active invitations from the inviter unspecified, and blocked
attempts may continue consuming limiter counts, undermining DCL-05 after block
removal (`test-inventory:83`).

Define canonical matching, sibling disposition on acceptance/block/removal,
and blocked-attempt counting; test cross-channel duplicates and aliases.

### RV-73-016 — creating authority is checked too coarsely

Item 6 cancels when the creator loses “owner authority”
(`specification:152`). A Primary who issued a Co-owner invitation can transfer
Primary and remain a Co-owner: still an owner, but no longer holding permission
26. TR-73-13's “creating authority not revoked” test is therefore insufficient
(`specification:142`).

Bind the invitation to the exact required permission and role/authorization
version, and extend INV-08 to cover downgrade, transfer, and restored authority.

### RV-73-017 — mixed changes leave AC07 ambiguous

§10 classifies any mixed change as an expansion and delays all effects until
consent (`specification:237-238`). AC07 says a reduction takes effect
immediately without limiting that statement to pure reductions
(`traceability:42`). The package's interpretation is internally consistent but
can let a member retain broader access by refusing a bundled expansion.

Product Owner must approve one rule: amend AC07 to pure reductions, split the
immediate reduction from a later expansion, or explicitly approve the atomic
whole-change interpretation and its residual.

### RV-73-018 — consent disclosures contain two material inaccuracies

General disclosure says owners may remove non-owner members
(`specification:189`), omitting Primary-authorized Co-owner removal
(`specification:252`). MSG-73-040 says Primary acceptance is revocable only by
a later transfer (`message-inventory:61`), while archival is the other
always-supported sole-Primary exit (`specification:60,284`).

Make removal disclosure role-specific and present both transfer and archival
accurately.

### RV-73-019 — audit events lack exact transition edges

TR-73-13 names only AE-73-13 even for commit-time denial
(`specification:142`), leaving AE-73-15 definition-only. AE-73-16/AE-73-17/AE-73-19/AE-73-20/AE-73-22
also lack exact transition/scenario edges (`specification:334-341`). That
weakens the audit assertion for every denied/committed scenario claimed at
`traceability:27`.

Map every event to a transition and scenario, including denial and partial
failure, and require event cardinality/correlation assertions.

### RV-73-020 — stable identifiers are not repository-stable

The test inventory says family IDs are stable and do not collide
(`test-inventory:21`), but CBD-73 `CHG-01–07` collide with CBD-70 and
`INV-01–09` collide with CBD-67. The diagram also uses undefined
`TR-01–TR-13` labels (`specification:88-106`).

Namespace scenarios (for example `CHG-73-01`) or explicitly scope every parser
and link, and use full transition IDs in the diagram.

### RV-73-021 — CBD-91 mappings do not fit the records

CBD-91 requires a class split when audience, lifecycle, or storage boundary
differs (`cbd-91-private-mvp-data-inventory.md:94-98`). DR-73-05 maps hidden
cross-space block state to general account identity; DR-73-06 maps hidden
limiter/security state to inviter-visible invitation status; DR-73-07 omits the
directly applicable personal-notification destination class
(`specification:308-310`; CBD-91 `DI-91-001`, `DI-91-054`, `DI-91-029`).

Create/split approved data classes or record an explicit CBD-91 follow-up
before claiming its boundaries govern this state.

### RV-73-022 — revoked consent is not modeled as historical evidence

DR-73-04 retains consent evidence but does not state that it can never be an
authorization source or link it to the ending/superseding event; DR-73-09 does
not reference the affected grant (`specification:307,312`). The AC14 coverage
table maps “revoked consent” partly to CHG-07, where consent never existed
(`test-inventory:109,146`).

Define immutable historical evidence versus current authorization, link every
end/reduction to the superseded consent grant, and test stale-consent replay.

## 7. Original P3, tooling, and publication findings against v0.1 (historical evidence)

### RV-73-023 — provider callbacks lack deterministic late-event rules

TR-73-03/TR-73-04 define only Pending-state delivery callbacks
(`specification:132-133`). State the idempotent no-op/audit behavior for
duplicate or late confirmation/failure after acceptance, cancellation,
supersession, expiry, or decline, and add out-of-order callback tests.

### RV-73-024 — repeatable audit was missing (closed on this branch)

The merged commit says a parser-based audit confirmed identifiers and tallies,
but no script or output was retained and CI checked only CBD-102 vocabulary.
This branch adds `scripts/audit-cbd-73.py` and invokes it from
`.github/workflows/ci.yml`. It checks package structure, exact definition sets,
AC rows, scenario families/totals, direct references, and declared counts.

### RV-73-025 — CBD-95 audit evidence is no longer current

`scripts/audit-cbd-95.py` now reports 4,125 checks and three failures because
its frozen CBD-72 model/scenario/traceability blobs predate the approved
versions consumed by CBD-73. The failure is the intended change detector.

Perform an explicit CBD-95 impact/rebaseline decision; do not silently replace
the hashes or cite the earlier clean run as current evidence.

### RV-73-026 — publication tooling is not registered

No CBD-73 Confluence page was discoverable and `scripts/sync-confluence.py`
contains no target for the four documents. This is consistent with the package
remaining draft, but traceability requires registration and parity verification
after approval/merge (`traceability:129`). Follow the repository-first rule;
do not publish from this audit branch.

### RV-73-027 — source provenance and CBD-72 metadata need focused follow-up

CBD-73 pins CBD-71 and CBD-72 versions but not exact CBD-91, CBD-94, or CBD-95
versions/blobs. The governing CBD-72 model also says both “Approved v0.1.53”
and “Final package approval remains pending,” with a stale Last updated field
(`cbd-72-collaboration-permission-model.md:5,14,16`). Record the exact consumed
sources. Correcting CBD-72 is outside CBD-73 audit scope and requires separate
user consent and a focused branch.

## 8. Jira/package discrepancies after v0.2 reconciliation

The v0.2 traceability record preserves these discrepancies without treating
this branch as authorization to edit Jira:

1. CBD-73-AC08 in Jira omits the sole-Primary exception carried by current
   CBD-12-AC17 and CBD-72.
2. AC01 omits the required Declined state.
3. Creating-authority cancellation is resolved inside the draft rule: the
   exact required permission and versions control, and lost authority never
   reactivates an invitation. Any Jira alignment still needs authorization.
4. Customer/admin decline presentation uses a safe non-attributing interim;
   exact copy and final presentation remain `OI-73-004`.
5. Viewer acceptance is resolved in favor of CBD-72: every new Viewer starts
   with no profile and no visibility; later assignment is a separate expansion.
6. Jira Notes say due August 21 while the live Due date is August 24.

No Jira update is authorized by this record. Immediately before any later Jira
change, refetch the issue, links, status, fields, dates, and comments as required
by repository policy.

## 9. Required disposition sequence

1. Obtain and record the Product decision for `OI-73-001`, then reconcile the
   affected rule, messages, scenarios, audit projection, and traceability as
   one change.
2. Route `OI-73-003`, `OI-73-005`, and `OI-73-006` through their owning source
   artifacts under separately authorized change control.
3. Produce the applicable implementation and specialist evidence for
   `OI-73-004` and `OI-73-008`–`OI-73-012`; retain every safe interim rule until
   its replacement is explicitly approved.
4. Re-run `scripts/audit-cbd-73.py`, the vocabulary check, Mermaid rendering,
   the relevant CBD-95 impact audit, and eventual executable fixtures at the
   exact candidate commit.
5. Record Product Owner approval of the exact document versions and frozen
   source baseline only after the applicable review gates close.
6. With explicit authorization and a fresh Jira read, reconcile the Jira
   description, acceptance criteria, notes, links, and due-date discrepancy.
7. Merge the approved repository change to `main`; only then register and
   synchronize the four Confluence pages and verify read-back parity.

## 10. Revision history

| Version | Date | Author | Change | Approval |
| --- | --- | --- | --- | --- |
| 1.0.4 | September 15, 2026 | Claude specification specialist, dispatched by Manager (`PROTO-CONSENT-APPROVALS-APPLY-001`) | Package version moved with the specification's §13.1 `DR-73-04` physical mapping to `budget_space_consent`, the `self_disclosure` source value, the append-only digest-pinned disclosure registry as the version source and the `SEC-F02` forward rule, approved at v1.0.4. No row in this document changed. | **Approved — Product Owner, September 15, 2026 (`PO-CONTRACT-APPROVALS-003`)** |
| 1.0.3 | September 3, 2026 | Claude with Alexander Wohlford as Product Owner | Brand amendment. The ceremony-entry disclosure in the specification's §7 said the surface discloses "that this is a CoBudget invitation requiring verification"; it now says MoneyPact, matching `EM-92-002` as amended at CBD-92 v1.0.1 and the `MSG-73-002`/`MSG-73-010` rows already corrected at v1.0.2. The naming standard is `RT-75-01`. No lifecycle transition, invariant, message row, scenario, or gate changed. | Consequential amendment to an approved document under change control; the v1.0 approval otherwise stands |
| 1.0.1 | August 18, 2026 | Claude with Alexander Wohlford as Product Owner | Corrected the status line and the §1 verdict, and closed `RV-73-006`, `RV-73-013`, and `RV-73-026`, which still read as open after the August 18 decisions and the publication. Twenty-seven of 29 findings are closed. No rule, decision, or gate changed. | Correction to approved v1.0 |
| 1.0 | August 18, 2026 | Alexander Wohlford — Product Owner, with Claude | Recorded the August 18, 2026 Product Owner decisions closing `RV-73-006`/`OI-73-001` and the `RV-73-013`/`OI-73-008` Failed-state question. 26 of 29 findings are now fixed; `RV-73-021`, `RV-73-025`, and `RV-73-026` retain source, integrity, and publication gates. | **Approved v1.0** |
| 0.2.1 | August 18, 2026 | Claude with Alexander Wohlford as Product Owner | Independent completeness review of the merged v0.2 package: added `RV-73-028` (missing §4.4 rule 6 recipient-side scenario coverage plus an overclaiming `RV-73-003` disposition) and `RV-73-029` (dropped literal `CBD-73-AC14` case names), both remediated in the same pass. No open issue closed and no product rule changed. | Draft; Product Owner review required |
| 0.2 | August 18, 2026 | Codex with Alexander Wohlford as Product Owner | Verified the coordinated v0.2 remediation through repeated adversarial passes: 22 findings fixed in the draft package, five left under exact open gates, 12 canonical open issues, frozen governing blobs, 44 messages, 95 namespaced scenarios, a direct-reference/expected-outcome audit, and repository-wide Mermaid validation. No Product decision, Jira field, Confluence page, or upstream source was changed. | Review record only; `OI-73-001` and the `OI-73-008` Failed-semantics decision block package approval; narrower gates remain |
| 0.1 | August 18, 2026 | Codex with Alexander Wohlford as Product Owner | Independent full review of the merged CBD-73 v0.1 package; 27 findings recorded, one tooling finding closed on the audit branch; no product decision, Jira field, or Confluence page changed. | Review record only; Product Owner disposition required |
