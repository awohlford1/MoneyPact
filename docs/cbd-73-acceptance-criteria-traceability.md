# CBD-73 — Acceptance Criteria Traceability and Review Record

| Field | Value |
| --- | --- |
| Status | **Approved v1.0.4 — Product Owner approved the exact package on August 18, 2026 after closing `OI-73-001` and the `OI-73-008` Failed-state semantics, and it is published to Confluence. Approval covers the specification only; the remaining §7 gates stay open. The package moves to v1.0.4 with the specification's §13.1 amendment approved September 15, 2026 (`PO-CONTRACT-APPROVALS-003`), which changes no criterion mapping** |
| Document version | 1.0.4 |
| Owner | Alexander Wohlford |
| Jira | [CBD-73](https://cobudget.atlassian.net/browse/CBD-73) |
| Parent | [CBD-12](https://cobudget.atlassian.net/browse/CBD-12) |
| Lifecycle specification | `docs/cbd-73-invitation-consent-lifecycle-specification.md` |
| Message inventory | `docs/cbd-73-customer-message-inventory.md` |
| Test inventory | `docs/cbd-73-negative-recovery-test-inventory.md` |
| Independent review | `docs/cbd-73-exhaustive-review-findings.md` (`RV-73-001`–`RV-73-029`) |
| Reviewed repository baseline | `c096928a903dd5446b26ba21eaf7eaa2d84ce936` on `main` (PR #64 merge) |
| v0.1 finding-baseline package commit | `8f1636d957534b09549f7c5e44d1b4147174f30c` |
| v0.1 finding-baseline package blobs | Traceability `b70cf485ade59bd08a40feb0e91cb2801f33ec4d`; messages `a467064e3ad4b61927fdbb0db67fcbace8ae7726`; lifecycle `9a1ff4cd2081e2ce1fb1ee851277c1746bd0be3c`; tests `86282881463f6e1f98135b44b3bd08cbcd80e9c4` |
| Remediation parent / audit-introduction commit | `9a7a3fe1f8202d0aa8a25aaa6738c7015044af91`; introduced the retained audit/findings evidence and CI invocation, but is not the v0.2 candidate identity |
| v0.2 candidate identity | **Pending external capture.** Because a Git object cannot self-pin its own identity, the PR and approval evidence must record the exact resulting remediation commit/tree and four document blobs immediately after commit. A branch name or mutable worktree is not candidate identity evidence |
| Confluence pages | Specification 11370497; messages 11403265; tests 11436033; findings 11468801; traceability 11403286 — all in space CBD, published from `ada4a26` |
| Mechanical audit command | `python scripts/audit-cbd-73.py`; structural evidence only and never open-issue closure |
| Last updated | August 18, 2026 |

## 1. Completion and evidence boundary

This record is an evidence map, not an approval assertion. A row marked
**Mapped** means that draft requirement and scenario locations exist. It does
not mean that the rule is Product Owner-approved, implemented, executable,
accessible, independently reviewed, published, or safe for release.

CBD-73 package approval requires all of the following:

1. every CBD-73 criterion and supported CBD-12 criterion maps in both
   directions to the exact lifecycle, message, audit, data, and namespaced
   scenario evidence that claims to satisfy it;
2. every `RV-73-001`–`RV-73-029` finding has the evidence-backed disposition in
   §10, with each open issue governed by the stable §7 register;
3. `OI-73-001` is closed — the Product Owner decided the §5.1 inviter
   confirmation on August 18, 2026 — and the `OI-73-008` Failed-state semantics
   are settled in the same decision. The safe exclusion rule for `OI-73-002`
   remains binding unless that issue is closed, and every other open issue
   remains an explicit gate at the impact stated in §7;
4. after commit, the Product Owner approves the exact v0.2 commit/tree and
   document versions against the frozen §2 source baseline; and
5. only after that approval, a fresh Jira read precedes any authorized Jira
   synchronization, and only an approved repository version merged to `main`
   is registered and synchronized to Confluence.

Implementation handoff additionally requires the focused source alignment in
`OI-73-003`, the applicable implementation designs/evidence in
`OI-73-008`–`OI-73-012`, and deterministic fixtures. Customer-facing release
additionally requires `OI-73-004`. Repository integrity and publication remain
separately gated by `OI-73-005` and `OI-73-007`. `OI-73-006` is a focused
source-metadata correction and does not override the substantively clear
CBD-72 v0.1.53 rules.

### 1.1 What the v1.0 approval covers

Approval is of the exact specification, message semantics, data requirements,
audit inventory, and scenario set at this version. Following the CBD-91 and
CBD-102 convention, it records its own limits:

- It **does** settle the product rules, including the §5.1 intended-recipient
  confirmation and the active-restricted Failed-state model.
- It **does not** mean the rules are implemented, that fixtures exist, or that
  any control has been shown to work. `VT-94-009`–`VT-94-017` remain unbuilt.
- It **does not** substitute for the security/privacy, accessibility,
  localization, or safety review legs routed under `FU-95-017`, `FU-95-027`,
  and `OI-73-004`, and it is not an independent security review.
- It **does not** close any remaining `OI-73-*` row, authorize implementation
  of a gated path, or constitute a release decision.
- It **does not** by itself update Jira or Confluence. The CBD-73-AC01/AC05
  correction required by the Failed-state decision is authorized and pending,
  and publication follows the merge-first rule.

## 2. Reproducible governing-source baseline

The following values are the exact sources observed at the reviewed
`c096928a903dd5446b26ba21eaf7eaa2d84ce936` baseline. They are recorded rather
than normalized. A later source change requires an impact review; it must not
be silently treated as evidence for this draft. Where a row has since been
re-pinned to a newer approved version, the impact review that permitted it is
recorded beside that source's hash in `scripts/audit-cbd-73.py`.

| Source | Exact observed version/status | Git blob at reviewed baseline | CBD-73 use |
| --- | --- | --- | --- |
| `docs/cbd-71-mvp-schedule-decision-register.md` | Document version **1.1.3**; decision-set target **MVP Schedule Decisions v1.1**, approved August 15, 2026 | `fb70a7a0754a876b88c66a97469f0a57f67dd9c9` | Alert semantics, mandatory in-app instances, personal delivery preferences, server-side enforcement, accessibility |
| `docs/cbd-72-collaboration-permission-model.md` | Document version **0.1.55**; approved August 18, 2026 at v0.1.53, §5.4 amended September 2, 2026, row 36 approved September 15, 2026 | `6678f529c1c7f8cc1274ffc39a9855bf7e67bc41` | Roles, permissions 24–29, one-role/one-Primary invariants, protected actions, transfer, revocation, ownership exits, attribution and audit schema. Re-pinned September 15, 2026 for the approved v0.1.55 row 36 (manual-account management, PO-CBD72-ROW36-001), which adds a permission row CBD-73 does not cite; previously re-pinned for the v0.1.54 §5.4 amendment removing the recipient-configurable "privacy" item; CBD-73 cites §5.4 only for the personal-settings boundary, which neither amendment changes, so no CBD-73 rule is affected |
| `docs/cbd-91-private-mvp-data-inventory.md` | Document version **1.0.5**, approved | `5e3b1255fa6f6c020a54869cf22828a27792e04d` | Existing data-class, audience, lifecycle, and prohibited-disclosure boundaries; source alignment and new/split classes remain `OI-73-003` |
| `docs/cbd-94-risk-mitigation-requirement-register.md` | Document version **1.0.4**, approved provider-independent baseline | `ce6b3e105aff7f120eb670d3685c787082911516` | Normative `SR-94-007`–`SR-94-011` invitation security/privacy requirements and dependent release gates |
| `docs/cbd-95-architecture-roadmap-follow-up-register.md` | Front-matter status says **Approved v1.0.1** while the observed Document version is **1.0.11** | `6d1f61f6aa49d920035acde5e97700c26c650181` | Product Owner dispositions for `RI-93-001`–`RI-93-019`, follow-up ownership, safety-channel routing, and copy/implementation gates |

Reproduce the governing blob values without reading the working tree:

```sh
git rev-parse c096928a903dd5446b26ba21eaf7eaa2d84ce936:docs/cbd-71-mvp-schedule-decision-register.md
git rev-parse c096928a903dd5446b26ba21eaf7eaa2d84ce936:docs/cbd-72-collaboration-permission-model.md
git rev-parse c096928a903dd5446b26ba21eaf7eaa2d84ce936:docs/cbd-91-private-mvp-data-inventory.md
git rev-parse c096928a903dd5446b26ba21eaf7eaa2d84ce936:docs/cbd-94-risk-mitigation-requirement-register.md
git rev-parse c096928a903dd5446b26ba21eaf7eaa2d84ce936:docs/cbd-95-architecture-roadmap-follow-up-register.md
```

Use the same `git show <commit>:<path>` form to inspect the observed version
and status fields. The **v0.1 finding-baseline** blobs in the front matter are
likewise the result of
`git rev-parse 8f1636d957534b09549f7c5e44d1b4147174f30c:<path>`. They identify the
package against which `RV-73-001` through `RV-73-027` were raised; they do not
identify v0.2. Record the exact resulting v0.2 remediation commit and tree in
the PR and exact-version approval evidence immediately after commit.

The CBD-72 source has contradictory secondary metadata: its status and revision
history approve v0.1.53, while its authority note still says final approval is
pending and its Last updated field predates the August 18 revision. The body,
approved status, exact version, approval row, and blob make the substantive
source unambiguous for CBD-73. Correcting that external metadata is
`OI-73-006`; this record does not edit or reinterpret CBD-72.

## 3. Jira deliverable traceability

| Jira deliverable | Draft evidence | Namespaced scenario evidence | Audit result |
| --- | --- | --- | --- |
| State diagram and transition table | Specification §4.1–§4.4 and post-acceptance transition contracts; 47 exact transitions in `TR-73-01`–`TR-73-39` and `TR-73-40`–`TR-73-47` | `INV-73-01`–`INV-73-18`; `VER-73-01`–`VER-73-11`; applicable change/revocation/transfer ranges below | **Mapped, not approved.** The v0.2 rule set addresses `RV-73-001`–`RV-73-004`, `RV-73-012`–`RV-73-016`, and `RV-73-023`; `OI-73-001` blocks approval while `OI-73-002` keeps only the optional pre-authentication block composition unavailable |
| Invitation and consent data requirements | Specification §13 (`DR-73-01`–`DR-73-13`), §§5–10 | All eight exact scenario ranges recorded below | **Mapped, source/persistence gated.** `OI-73-003` blocks affected implementation |
| Customer-facing message inventory | Message inventory §4 and §2 semantic rules | 48 exact semantic contracts: `MSG-73-001`–`MSG-73-006`, `MSG-73-010`–`MSG-73-027`, `MSG-73-029`–`MSG-73-047`, `MSG-73-049`, and `MSG-73-050`–`MSG-73-053` | **Semantic draft only.** Exact copy and evidence remain `OI-73-004` |
| Revocation/removal checklist | Specification §11.3 (`RC-73-01`–`RC-73-14`) | `RVK-73-01`–`RVK-73-16` | **Mapped, not implemented.** Mandatory notice routing follows the settled `RI-93-012` rule; mechanics/evidence remain `OI-73-009` |
| Audit-event inventory | Specification §14 (`AE-73-01`–`AE-73-32`) and placement/cardinality rules | Every scenario's exact audit assertion; test inventory §5 hardening matrix; the audit script's transition direct-reference manifests | **Mapped at draft-rule level.** Storage/integrity/retention remain `OI-73-011` |
| Negative and recovery test inventory | Test inventory §§4–6 | 101 globally namespaced scenarios: `INV-73-01`–`INV-73-19`, `VER-73-01`–`VER-73-11`, `CNS-73-01`–`CNS-73-11`, `DCL-73-01`–`DCL-73-13`, `DST-73-01`–`DST-73-08`, `CHG-73-01`–`CHG-73-13`, `RVK-73-01`–`RVK-73-16`, and `TRF-73-01`–`TRF-73-10` | **Draft scenarios, not executable fixtures.** The `VT-94` family selector is not a stable identifier; applicable implementation fixtures and open-issue evidence remain |

## 4. CBD-73 acceptance-criteria mapping

The requirement wording and coverage below are preserved from the reviewed
CBD-73 Jira mapping. Scenario identifiers add the `-73-` namespace so they do
not collide with CBD-67/CBD-70 identifiers. A mapping states where draft
evidence is intended to live; the Gate column prevents that location from
being mistaken for sufficiency.

| AC | Requirement | Specification evidence | Scenario evidence | Gate |
| --- | --- | --- | --- | --- |
| CBD-73-AC01 | State model for creation, pending, delivered, accepted, expired, superseded, cancelled, failed, and consumed outcomes. | §4.1–§4.3; Consumed on the code object | `INV-73-01`–`INV-73-17`; `INV-73-18`; Declined/abandonment `DCL-73-01`/`DCL-73-04` | Mapped as a safe draft. Product Owner/Jira confirmation that `Failed` means active restricted provider metadata rather than an unusable link remains `OI-73-008` and blocks AC01/AC05 semantic approval |
| CBD-73-AC02 | Creation records space, inviter, channel, destination, role, visibility scope, issue time, expiry, and version. | §4.4 `TR-73-01`; §13 `DR-73-01` | `INV-73-01`, `INV-73-06`, `INV-73-13`, `INV-73-17`, `CNS-73-04`–`CNS-73-05` | Mapped; source/persistence impact includes `OI-73-003`; `CNS-73-05` proves a Viewer initial-profile create is denied with `AE-73-31` |
| CBD-73-AC03 | Pre-acceptance disclosure of space, inviter, role, resources, actions, restrictions, alert behavior, and revocation method. | §7.2; `MSG-73-016` | `CNS-73-04`–`CNS-73-05`, `VER-73-02`, `VER-73-07`–`VER-73-08` | Approval blocked by `OI-73-001`; release also by `OI-73-004` |
| CBD-73-AC04 | Explicit affirmative acceptance separate from link opening and channel verification; consent evidence fields. | §6; §4.4 `TR-73-13`; §13 `DR-73-04` | `CNS-73-01`–`CNS-73-04`, `CNS-73-06`–`CNS-73-08`, `VER-73-04`, `VER-73-07`, `VER-73-09` | `OI-73-002` gates the decline/block composition; `OI-73-012` gates account mechanics |
| CBD-73-AC05 | Resend/replacement invalidates superseded codes; duplicate, expired, cancelled, failed, and consumed codes have safe recovery. | §4.3–§4.4 `TR-73-04`, `TR-73-05`, `TR-73-07`, and `TR-73-14`; additional transition rules | `INV-73-02`–`INV-73-06`, `INV-73-08`–`INV-73-17` | Safe draft: provider-delivery failure is restricted metadata and leaves the invitation/code usable; only an independent terminal verifier state uses `TR-73-14`/`MSG-73-003`. Product Owner/Jira approval of that interpretation remains `OI-73-008` |
| CBD-73-AC06 | Expansion requires explicit disclosure and new consent before expanded access begins. | §10; `IC-73-007` | `CHG-73-01`, `CHG-73-03`–`CHG-73-13` | Mapped; exact copy `OI-73-004` |
| CBD-73-AC07 | Reduction takes effect immediately and notifies without requiring consent. | §10 `TR-73-26`/`TR-73-27`; `MSG-73-032` | `CHG-73-02`, `CHG-73-03`, `CHG-73-12` | Valid separately submitted pure reductions commit immediately. Mixed requests are invalid and change nothing; exact copy remains `OI-73-004` |
| CBD-73-AC08 | Self-revocation without another party's approval; authorized owner removal through prominent confirmation flows. | §11.1; `RC-73-14`; `MSG-73-026`, `MSG-73-047`, and `MSG-73-049`; CBD-12 sole-Primary exception | `RVK-73-01`, `RVK-73-06`–`RVK-73-07`, `RVK-73-12`, `RVK-73-15`–`RVK-73-16`; transfer completion `TRF-73-03` | Mapped; Jira exception amendment remains §8; exact copy remains `OI-73-004` |
| CBD-73-AC09 | Immediate authorization/alert cutoff, queued-notification suppression, scoped session invalidation without global sign-out, cache/job/active-request execution requirements. | §10 `TR-73-26`; §11.2 `TR-73-30`–`TR-73-35`; §11.3 `RC-73-01`–`RC-73-13`; §9 `TR-73-36`–`TR-73-37`; `AE-73-16`; `IC-73-008` | `CHG-73-02`, `CHG-73-12`, `DST-73-05`–`DST-73-06`, `DST-73-08`, `RVK-73-01`–`RVK-73-02`, `RVK-73-04`, `RVK-73-08`–`RVK-73-09`, `RVK-73-13`–`RVK-73-15` | Mapped; reduction, prospective/active destination-retirement, and membership-end implementation evidence remains `OI-73-009` |
| CBD-73-AC10 | No effect on sign-in, other memberships, or roles elsewhere; prior codes cannot restore; restoration needs a new invitation. | `RC-73-08`/`RC-73-10`; `IC-73-006`/`IC-73-008` | `DCL-73-03`, `DCL-73-09`, `RVK-73-03`–`RVK-73-04`, `RVK-73-10`–`RVK-73-11`, `INV-73-08`, `INV-73-18`, `VER-73-11`, `INV-73-11`–`INV-73-12` | Mapped, not executed; cross-space block enforcement suppresses future invitations and closes a stale matching path without changing any existing membership |
| CBD-73-AC11 | Lifecycle events notify affected users where appropriate and are budget-space scoped and auditable; contributed work remains attributed. | §7.3; §14; `RC-73-09`/`RC-73-12`; `IC-73-009` | `INV-73-16`, `DCL-73-08`, `DCL-73-12`, `DST-73-03`, `DST-73-08`, `RVK-73-05`, `RVK-73-08`–`RVK-73-09`, `RVK-73-13`–`RVK-73-15`, `TRF-73-03`, `TRF-73-09` | Mapped; `OI-73-001`, `OI-73-004`, and `OI-73-011` apply where stated |
| CBD-73-AC12 | Each lifecycle state defines actor, preconditions, resulting state, message, notifications, audit event, and failure/recovery. | Invitation, change, revocation/removal, and transfer transition contracts in §§4, 10–12 | All 101 scenarios: `INV-73-01`–`INV-73-19`, `VER-73-01`–`VER-73-10`, `CNS-73-01`–`CNS-73-11`, `DCL-73-01`–`DCL-73-13`, `DST-73-01`–`DST-73-08`, `CHG-73-01`–`CHG-73-13`, `RVK-73-01`–`RVK-73-16`, `TRF-73-01`–`TRF-73-10` | Mapped at draft-rule level; `OI-73-008`–`OI-73-012` retain implementation gates |
| CBD-73-AC13 | Consent and revocation copy is voluntary, accessible, nonjudgmental, with a safe path to decline or leave. | §6; message inventory §2; `MSG-73-013`, `MSG-73-017`, `MSG-73-033`, `MSG-73-036`, `MSG-73-047`, `MSG-73-049` | `DCL-73-01`–`DCL-73-05`, `DCL-73-12`–`DCL-73-13`, `RVK-73-06`–`RVK-73-08`, `RVK-73-13`–`RVK-73-14`, `RVK-73-16` | Semantic mapping only; `OI-73-004` blocks release |
| CBD-73-AC14 | Test inventory covers wrong recipient/channel, wrong space, invalid/expired/reused code, revoked consent, stale session, queued alert, unauthorized role change, cross-space isolation. | Test inventory §5 | Exact §5 required-case/hardening matrix, including the literal revoked-consent, queued-alert, and already-member/stale-invitation rows restored in v0.2.1; notably `VER-73-01`–`VER-73-02`, `VER-73-08`, `DCL-73-09`, `RVK-73-11`, `INV-73-02`, `INV-73-04`, `INV-73-09`–`INV-73-10`, `INV-73-15`–`INV-73-16`, `CNS-73-08`, `CHG-73-13`, `TRF-73-10`, `RVK-73-01`–`RVK-73-02`, `RVK-73-15`, `CHG-73-05`–`CHG-73-06`, `DST-73-07`–`DST-73-08` | Mapped; `OI-73-001` blocks wrong-recipient policy approval |
| CBD-73-AC15 | Recipient must verify control of the exact invited channel; a forwarded link is insufficient. | §5; `IC-73-003` | `VER-73-01`, `VER-73-03`, `VER-73-05`–`VER-73-06`, `VER-73-09`–`VER-73-10` | Mapped; concrete design/evidence `OI-73-008`/`OI-73-012` |
| CBD-73-AC16 | Link exposes only an opaque single-use code; server-side record is authoritative for role, scope, recipient, consent, and state. | §3 CBD-94 inheritance; §4.3; `IC-73-002` | `INV-73-02`–`INV-73-05`, `INV-73-09`–`INV-73-10`, `INV-73-13`, `INV-73-15`–`INV-73-16`, `VER-73-01`, `VER-73-05`, `CNS-73-06`–`CNS-73-07`, `RVK-73-03` | Mapped to `SR-94-007`–`SR-94-011`; `OI-73-008`/`OI-73-010` remain |
| CBD-73-AC17 | After invited-channel verification the invitation may attach to an existing account with a different primary contact. | §5; §4.4 `TR-73-10`/`TR-73-13` | `VER-73-04`, `VER-73-11`, `VER-73-08`–`VER-73-10` | Attachment alone is allowed and grants nothing. No acceptance commits until `OI-73-001` approves an exact intended-recipient binding; primary-contact equality alone is insufficient because a mistyped channel may be the stranger's primary contact. Mechanics remain `OI-73-012` |

Reverse coverage is family-scoped and explicit:

- `INV-73-01`–`INV-73-19` map to `CBD-73-AC01`, `CBD-73-AC02`,
  `CBD-73-AC05`, `CBD-73-AC10`, `CBD-73-AC12`, `CBD-73-AC14`, and
  `CBD-73-AC16`.
- `VER-73-01`–`VER-73-11` map to `CBD-73-AC03`, `CBD-73-AC04`,
  `CBD-73-AC12`, and `CBD-73-AC14`–`CBD-73-AC17`.
- `CNS-73-01`–`CNS-73-11` map to `CBD-73-AC03`, `CBD-73-AC04`,
  `CBD-73-AC12`, `CBD-73-AC14`, and `CBD-73-AC16`.
- `DCL-73-01`–`DCL-73-13` map to `CBD-73-AC01`, `CBD-73-AC05`,
  `CBD-73-AC10`–`CBD-73-AC14`, and `RI-93-010`.
- `DST-73-01`–`DST-73-08` map to `CBD-73-AC04`, `CBD-73-AC09`,
  `CBD-73-AC11`, `CBD-73-AC12`, `CBD-73-AC14`, and `RI-93-011`.
- `CHG-73-01`–`CHG-73-13` map to `CBD-73-AC06`, `CBD-73-AC07`, and
  `CBD-73-AC11`–`CBD-73-AC14`.
- `RVK-73-01`–`RVK-73-16` map to `CBD-73-AC08`–`CBD-73-AC14`.
- `TRF-73-01`–`TRF-73-10` map to `CBD-73-AC08` and
  `CBD-73-AC11`–`CBD-73-AC14`.

This reverse map does not assert that every row is approved or that executable
fixtures exist. `scripts/audit-cbd-73.py` freezes the exact direct message and
audit stable-ID reference set in every transition row, requires every emitting
ID in actual scenario rows, and requires the scenarios naming each transition
to cover its referenced message/audit set. Those structural checks do not prove
runtime behavior, delivery, or semantic correctness; §10 records the reviewed
semantic dispositions. An audit pass cannot close an open issue.

## 5. Supported CBD-12 criteria

CBD-73 maps the same supported CBD-12 coverage as the reviewed Jira package:
`CBD-12-AC12`–`CBD-12-AC18`, `CBD-12-AC22`, `CBD-12-AC27`, and
`CBD-12-AC34`–`CBD-12-AC36`.

| CBD-12 AC | Package evidence | Qualification |
| --- | --- | --- |
| `CBD-12-AC12` — invitation behavior for creation/delivery, acceptance, expiration, resend, replacement, cancellation, failure | Specification §4; `INV-73-01`–`INV-73-17` | Draft rule and scenarios; provider failure is restricted delivery metadata and does not itself invalidate the invitation/code; no runtime claim |
| `CBD-12-AC13` — pre-acceptance identification of space, inviter, role, resources, actions, restrictions, alert behavior, revocation method | Specification §7.2; `MSG-73-016`; `CNS-73-01`–`CNS-73-11` | `OI-73-001`/`OI-73-004` |
| `CBD-12-AC14` — explicit affirmative consent with recorded person, space, role, scope, timestamp, copy version, source | Specification §6; `DR-73-04`; `CNS-73-03` | Historical evidence is never current authority |
| `CBD-12-AC15` — duplicate, superseded, expired, failed, and used links have defined safe recovery | Specification §4.3–§4.4; `MSG-73-003`; `INV-73-01`–`INV-73-17`; `VER-73-01`–`VER-73-10` | Draft recovery rules. A failed/unusable link means a terminal or invalid verifier outcome, not provider-delivery failure alone; deprecated `MSG-73-020` is compatibility history and never emitting evidence only |
| `CBD-12-AC16` — expansion re-consent; immediate notified reductions; explicit revocation/removal authorization, messaging, resulting state | Specification §§10–11; `MSG-73-026`, `MSG-73-030`–`MSG-73-035`, `MSG-73-047`, `MSG-73-049`; `CHG-73-01`–`CHG-73-13`; `RVK-73-01`–`RVK-73-16` | Exact copy `OI-73-004` |
| `CBD-12-AC17` — unilateral revocation with bounded sole-Primary exception; cutoff; code invalidation; fresh re-invitation; isolation; attribution | Specification §11; `IC-73-006`, `IC-73-008`, `IC-73-009`, `IC-73-014`; `RVK-73-01`–`RVK-73-16` | Runtime invalidation evidence `OI-73-009` |
| `CBD-12-AC18` — lifecycle notices and budget-space-scoped audit events | Specification §7.3 and §14; all 44 exact message rows; exact audit scenarios and direct-reference manifests | `RI-93-012` normative routing applies; `OI-73-003` source alignment and `OI-73-004` exact copy remain |
| `CBD-12-AC22` — coercion-aware copy, revocation, recovery, support resources, supported exit | Message inventory §2; `MSG-73-034`, `MSG-73-036`, `MSG-73-047`, `MSG-73-049`; `IC-73-014`; §11.3 | Exact evidence `OI-73-004` |
| `CBD-12-AC27` — requirements separated from execution decisions and test classes | Specification §15; test families; this record | `OI-73-003`/`OI-73-005` and `OI-73-008`–`OI-73-012` remain explicit |
| `CBD-12-AC34` — one invited channel; verified control before acceptance | Specification §5; `VER-73-01`–`VER-73-11` | `OI-73-008`/`OI-73-012` |
| `CBD-12-AC35` — opaque single-use locator and complete invalidation | Specification §4.3; `INV-73-02`/`INV-73-09`; CBD-94 inheritance | `OI-73-008`/`OI-73-010` |
| `CBD-12-AC36` — attachment to an account with a different primary contact after verification | Specification §5; `VER-73-04` | Attachment alone is permitted; every acceptance remains denied under `OI-73-001` until an approved intended-recipient binding rule passes. Primary-contact equality alone is insufficient. Provider mechanics remain `OI-73-012` |

## 6. Routed decisions and follow-up coverage

Nothing in this table closes a CBD-95 follow-up; closure requires the evidence
named by that register.

| Route | Requirement-level incorporation | Evidence or gate that remains |
| --- | --- | --- |
| `FU-95-005` | CBD-71 decision set v1.1 and CBD-72 v0.1.53 are pinned in §2 | Closed source-version row; no regression permitted |
| `FU-95-017` | Semantic inventory carries two-way disclosure, invitation-proof/destination separation, and `RI-93-016` | Exact strings, template hashes, locale/accessibility/comprehension and specialist evidence: `OI-73-004` |
| `FU-95-018` | CBD-73-scope `RI-93-003`, `RI-93-007`, and `RI-93-017` boundaries are mapped | Other agency implementations and `SR-94-146`/`SR-94-147` evidence remain outside this package |
| `FU-95-019` | `RI-93-009`, `RI-93-010A`–`RI-93-010C`, and `RI-93-011` are represented at draft requirement/scenario level | `OI-73-001`/`OI-73-002`/`OI-73-003`/`OI-73-010`; implementation and fixture evidence |
| `FU-95-020` / `RI-93-012` | **Normative and not open:** every subject lifecycle notice creates a mandatory authenticated in-app record independent of ended membership authority; an external copy may use only the subject's verified private safety channel; there is never external fallback; absent, unavailable, stale, compromised, or failed safety-channel delivery leaves the mandatory in-app notice as the sole customer copy | Focused CBD-72/CBD-91 source alignment is part of `OI-73-003`; routing/persistence implementation and failure fixtures remain required. The product rule itself is settled |

## 7. Stable open-issue and release-gate register

This is the canonical CBD-73 open-issue namespace. Other CBD-73 documents may
refer to these identifiers; they must not create a second meaning for an
identifier or imply closure without the evidence in the Closure evidence
column. A safe interim behavior is a binding constraint, not permission to
ship an otherwise gated path.

| ID | Issue and controlling conflict/unknown | Safe interim behavior | Owner / decision authority | Closure evidence | Release impact |
| --- | --- | --- | --- | --- | --- |
| `OI-73-001` | **Closed August 18, 2026 by Product Owner decision.** Intended-recipient binding is the §5.1 inviter confirmation of the specific accepting account; a mistyped channel that is a stranger's verified primary contact can no longer yield membership. | Normative and in force: TR-73-38 opens the confirmation, TR-73-39 decides it, TR-73-13 commits only against a current versioned binding (`DR-73-13`), and primary-contact equality never substitutes. | Product Owner — **decided August 18, 2026**; security/privacy review still named | Recorded decision plus, before implementation, security/privacy review and `VT-94-009`–`VT-94-017` fixtures | Product decision closed; package approval unblocked. Acceptance implementation and release remain blocked on the verification evidence, not on the decision. |
| `OI-73-002` | **Unauthenticated/no-account decline-and-block and account attachment.** The account-level block cannot be created before an authenticated account exists, and the optional no-account/block composition is not approved. | Plain decline remains invitation-scoped and may be offered after invited-channel verification. Hide and server-deny decline-and-block until an authenticated account is deliberately attached; never synthesize a block, and no ambiguity, interruption, timeout, or abandonment may create one. | Product Owner, with Identity, Privacy, and Security review | Approved alternative, if any, to the safe rule; finalized `VER-73-07`/`DCL-73-13`; authenticated block persistence/privacy evidence; account-provider mechanics under `OI-73-012` | **Blocks offering, implementing, or releasing decline-and-block before authenticated account attachment, not package review under this safe exclusion rule.** Plain invitation-scoped decline may proceed subject to other gates. |
| `OI-73-003` | **Dependent-source alignment.** The settled `RI-93-012` lifecycle-notice routing contradicts older every-channel wording in CBD-72/CBD-91, and CBD-91 lacks approved classes/splits for block, limiter, ceremony-bound destination, and membership-independent notice data. | Apply the normative `RI-93-012` rule in CBD-73: mandatory authenticated in-app notice, optional verified private safety-channel copy only, and no fallback. Do not implement affected routing or persistence by forcing the new records into ill-fitting classes. | CBD-72/CBD-91 document owners and Privacy/Data Governance; Product Owner confirms the focused amendments | Approved focused CBD-72/CBD-91 source amendments; CBD-91 class identifiers, fields, audience/lifecycle/storage boundaries, retention/deletion and trace links; CBD-73 mappings updated to the approved source versions | **Blocks affected persistence and lifecycle-notice routing implementation, not review of the settled CBD-73 lifecycle rule.** |
| `OI-73-004` | **Customer copy, accessibility, localization, and comprehension evidence.** Semantic intents exist, but exact strings/template versions and approval evidence do not. Declined-versus-expired presentation is also not approved. | Use no customer-facing draft templates. Any pre-approval administrative projection must be non-attributing and make decline indistinguishable from expiry/other non-acceptance; security-only records may preserve the exact reason under least privilege. | Product Owner and Content Design, with Accessibility, Localization, Privacy, and safety-specialist approval as applicable | Approved exact strings and template/version hashes for all 44 message rows; locale matrix; accessibility/comprehension evidence; specialist/privacy review; `DCL-73-12` and `RVK-73-16` projection/copy evidence, including `MSG-73-024`–`MSG-73-027`, `MSG-73-047`, and `MSG-73-049` | **Blocks customer-facing release, not lifecycle-rule review.** |
| `OI-73-005` | **CBD-95 audit impact/rebaseline.** The current CBD-95 change detector reports three stale CBD-72 blobs against the approved package consumed here. | Do not silently replace hashes or cite the earlier clean CBD-95 run as current. Keep the intended failures visible until an impact decision is recorded. | CBD-95 owner / repository maintainer, with affected requirement owners | Recorded impact disposition; reviewed rebaseline if authorized; clean or explicitly accepted CBD-95 audit result tied to an exact commit | **External repository-integrity gate; blocks a clean integrated release claim, not the CBD-73 rule review by itself.** |
| `OI-73-006` | **CBD-72 contradictory header metadata.** Its header observes both `Approved v0.1.53` and text saying final approval remains pending, with stale update metadata. | Consume the exact v0.1.53 blob pinned in §2 and record the contradiction; do not edit CBD-72 in this branch or reinterpret its substantive permission rules. | CBD-72 document owner / Product Owner under separate change control | Focused CBD-72 correction merged and, after merge, synchronized to its authoritative publication target | **External cleanup; non-blocking to substantive CBD-73 review and rules.** |
| `OI-73-007` | **Closed August 18, 2026.** Five pages were created in the CBD space, registered in `scripts/sync-confluence.py`, and published from merged `main`. | Confluence now mirrors the approved package; the repository stays the working source, and any later revision publishes only after its own merge. | Documentation owner / repository maintainer | Page IDs 11370497 (specification), 11403265 (messages), 11436033 (tests), 11468801 (findings), 11403286 (traceability), each at version 2 from repository commit `ada4a26`; read-back confirmed all five carry the approved content | Closed. Later revisions repeat the merge-then-publish cycle. |
| `OI-73-008` | **Failed-state semantics plus reconciliation-code, dispatch-custody, verification-proof, and approved-rate design.** Jira AC01/AC05 can be read as requiring provider `Failed` to be an unusable-link outcome, while the privacy-safe draft treats it as active restricted metadata. Concrete entropy/format, encrypted outbox custody, verifier, ceremony binding, expiry, deletion/recovery, and rate values are also unapproved. | Until Product Owner/Jira confirmation, retain the safer non-oracular rule: provider failure does not invalidate a current code. Codes remain high-entropy, purpose-specific, one-time, bound, expiring one-way verifiers; raw bearer custody follows the bounded encrypted TR-73-02 outbox rule; invalid/terminal verifiers use uniform recovery; unsafe rate/resource rechecks deny. | Product Owner for AC01/AC05 meaning; Security Architecture, Identity, and Reliability for design | Recorded Jira/Product interpretation of `Failed`; threat-reviewed verifier/encrypted-custody/deletion design; approved values/key/rotation scheme; provider-metadata/code-usability and terminal-recovery evidence in `INV-73-05`, `INV-73-10`, `INV-73-13`, `INV-73-15`–`INV-73-16`, `VER-73-05`, `VER-73-09`–`VER-73-10`, `CNS-73-06`–`CNS-73-07`, and `DST-73-05`–`DST-73-06` | **The Failed-semantics decision blocks AC01/AC05 and package approval; design evidence blocks code/dispatch/verification implementation and release.** |
| `OI-73-009` | **Authorization-cutoff invalidation and lifecycle-orchestration mechanics.** Required outcomes cover pure reductions, prospective and active membership-scoped destination retirement, revocation/removal, sessions, caches, jobs, queues, packages, ordinary notifications, in-flight requests, retry, and reconciliation; implementation ownership, bounded completion, and evidence remain absent. | Authorization removed by a valid pure reduction or ended membership stops authorizing at commit. `TR-73-37` atomically retires a prospective destination whenever its ceremony ends without activation. `TR-73-30`–`TR-73-32` atomically retire the ended membership's active destination while leaving every other-space association untouched; each applicable group carries exactly one `AE-73-16` child. Delayed work reauthorizes and fails closed. The mandatory membership-independent lifecycle notice is exempt from ordinary-alert suppression and follows `RI-93-012`. | Authorization/platform owners, destination/notification owners, and Security/Reliability | Component design, owner matrix, propagation SLO/failure behavior, and passing `CHG-73-02`, `CHG-73-03`, `CHG-73-12`, `DST-73-01`, `DST-73-02`, `DST-73-05`, `DST-73-06`, `DST-73-08`, `RVK-73-01`, `RVK-73-02`, `RVK-73-04`, `RVK-73-08`, and `RVK-73-13`–`RVK-73-15` execution evidence for `TR-73-26`, `TR-73-30`–`TR-73-32`, `TR-73-36`–`TR-73-37`, `AE-73-16`, `RC-73-03`, `RC-73-10`, and `RC-73-13` | **Blocks pure-reduction invalidation, prospective/active destination retirement/cutoff, and revocation/removal implementation and release.** |
| `OI-73-010` | **Account-block alias/privacy-token matching and invitation-pair limiter design.** Approved derivation and composition are absent for account blocks against unlinked destinations, account/destination aliases and cross-channel siblings, cross-space match enumeration/rechecks, and pair-limiter keys, values, storage, blocked-attempt counting, recovery, and non-weaponization. | A persistent block remains unavailable until an authenticated account is attached. An approved match suppresses future requests across spaces without changing existing memberships; `TR-73-12` must cancel every enumerable cross-space matching invitation through one `TR-73-06`/`AE-73-06` child per record, while `TR-73-10` and `TR-73-13` recheck matches that could not be pre-enumerated. Block and limiter causes stay non-observable across response, timing, status, audit, count, and export. | Security/Abuse Prevention and Privacy, with Product Owner approval of recovery behavior | Approved purpose-separated privacy-token/alias/account equivalence, cross-space enumeration/recheck rules, versioning, rotation, storage, and recovery; approved pair-key model, values/windows, storage/recovery/operations; passing `INV-73-17`, `DCL-73-02`, `DCL-73-03`, `DCL-73-05`, and `DCL-73-06`–`DCL-73-11` evidence for the exact `TR-73-06`, `TR-73-10`, `TR-73-12`, `TR-73-13`, `AE-73-06`, and synthetic edges | **Blocks persistent account-block matching and limiter implementation/release; never permits a no-account persistent block.** |
| `OI-73-011` | **Audit storage, integrity, access, export projection, and retention design.** Event semantics/cardinality are normative and reviewed, and direct-reference manifests mechanically constrain their stable IDs, but the durable control design and evidence are not. | Emit no raw secret or unnecessary destination data. Preserve exact provider/private denial cause only in least-privileged records; customer/admin projections use the normalized `AE-73-07` chronology and non-attribution. Every previously unseen denial/no-op on a transition assigned `AE-73-31` emits exactly that edge; exact retries add no event. Do not claim that the reference audit proves polarity/cardinality, tamper resistance, retention compliance, or evidentiary completeness. | Security/Audit platform owner, Privacy/Data Governance, and Compliance as applicable | Approved schema/storage boundary; integrity/access/export/retention/deletion controls; `INV-73-16` cardinality, `CNS-73-05` and other `AE-73-31` denial evidence, `DCL-73-08`/`DCL-73-12` projection, unknown-code fingerprint, direct-reference-manifest conformance, scenario cardinality review, and atomic-group operational evidence | **Blocks audit implementation and any audit-completeness or compliance release claim.** |
| `OI-73-012` | **Account creation, sign-in, authentication, and invitation attachment mechanics.** The lifecycle requires an authenticated candidate account for acceptance, but UX/session assurance, account switching, recovery, and existing-account composition are not designed here. | No local shortcut or implicit account creation. Acceptance and account-level blocking remain unavailable until an authenticated account is deliberately attached after exact invited-channel verification; plain decline remains invitation-scoped. After attachment, the separate `OI-73-001` primary-contact/binding acceptance gate still applies. | Identity/Account owner and Product Owner, with Security and Privacy review | Approved ceremony/UX and assurance level; account-switch/recovery rules; passing `VER-73-04`, `VER-73-05`, `VER-73-07`, `VER-73-09`, `VER-73-10`, and `DCL-73-13` provider-backed evidence | **Blocks no-account/sign-up/attachment acceptance implementation and release.** |

## 8. Jira/package discrepancy register

These are repository observations, not authorized Jira edits. Before any Jira
change, refetch the live issue, subtasks, links, status, assignments, dates,
description, acceptance criteria, and comments as repository policy requires.

| Discrepancy | v0.2 disposition | Jira follow-up |
| --- | --- | --- |
| `CBD-73-AC08` omits the sole-Primary exception carried by `CBD-12-AC17` and CBD-72 | The package keeps the controlling sole-Primary rule: the last Primary cannot self-revoke without a successful transfer or space archival | Amend `CBD-73-AC08` only with explicit authorization after a fresh Jira read |
| `CBD-73-AC01` omits `Declined` | The v0.2 invitation model includes Declined and its safe projection | Add Declined to `CBD-73-AC01` if Product Owner authorizes the Jira change |
| Jira uses “failed” for both a lifecycle outcome and recovery-sensitive code language, which can be misread as provider-delivery failure making a code unusable | **Resolved v0.2 semantic distinction:** `TR-73-04` records provider failure only as restricted metadata; the invitation/code remains active and usable until an independent terminal transition. A genuinely invalid, terminal, or expired verifier follows the uniform `TR-73-14`/`MSG-73-003` recovery path, while customer chronology normalizes through `TR-73-07`/`AE-73-07` without exposing the private cause | Clarify the Jira wording only if explicitly authorized after a fresh read; do not describe provider failure alone as a “failed code” |
| Creating-authority cancellation was a proposal and the old check was too coarse | **Resolved v0.2 rule:** bind the invitation to the exact creating permission, role/authorization version, and relevant policy version; loss or change that no longer authorizes the invitation cancels it. Later restoration does not reactivate it | Align Jira notes/AC only if explicitly authorized |
| Inviter-visible declined-versus-expired presentation is undecided | Folded into `OI-73-004`; safe interim is a non-attributing customer/admin projection that does not distinguish decline from expiry/other non-acceptance | Exact copy/projection decision remains required |
| Viewer initial-profile activation conflicts with CBD-72's no-profile initial state | **Resolved in favor of the governing source:** every newly accepted Viewer starts with no profile and no visibility. Later assignment follows CBD-72; an invitation cannot pre-activate a profile | Remove any stale Jira/package note that implies initial-profile activation, if authorized |
| Jira planning notes said August 21 while the live due-date field read August 24 in the August 18 review snapshot | Preserve as a dated observation only | Refetch; never overwrite the live due date from this record |

## 9. Governing inheritance and dependency direction

| Source | Inherited rule in CBD-73 | Evidence boundary |
| --- | --- | --- |
| CBD-71 decision register v1.1.1 / decision-set target v1.1 | All decisions marked accepted for the v1.1 target, including exit/sole-Primary and collaboration-model constraints | Exact blob pinned in §2; CBD-73 does not reopen those decisions |
| CBD-72 v0.1.53 | Role/permission definitions, no-profile Viewer starting state, scope isolation, last-Primary exception, removal/transfer constraints, and authorization evaluation | Exact blob pinned; metadata cleanup remains `OI-73-006` |
| CBD-91 v1.0.1 | Existing approved data-class boundaries and split rule govern all compatible records | New/split classes and `RI-93-012` alignment remain `OI-73-003`; CBD-73 does not invent an approval |
| CBD-94 `SR-94-007` | Invitation flow uses the approved privacy/security boundary and carries no broader disclosure or authority than the server-side record | Requirement inheritance; implementation evidence remains gated |
| CBD-94 `SR-94-008` | Codes/verifiers are high-entropy, purpose-specific, one-time, recipient-bound, versioned, expiring, and one-way verified | Normative now; concrete design/values remain `OI-73-008` |
| CBD-94 `SR-94-009` | Acceptance rechecks current invitation, rate, resource, authorization, recipient, and relevant version state at commit time | Normative now; implementation and rate evidence remain `OI-73-008`/`OI-73-010` |
| CBD-94 `SR-94-010` | Membership creation, invitation/code invalidation, consent evidence, audit, and required notices form one atomic or recoverably idempotent outcome | Normative now; storage/queue/audit evidence remains `OI-73-009`/`OI-73-011` |
| CBD-94 `SR-94-011` | Partial failure, retry, replay, and reconciliation preserve one membership, one terminal invitation/code result, correct consent/audit cardinality, and required notice outcomes | Normative now; executable recovery evidence remains required |
| CBD-95 v1.0.9 document body (front matter observes Approved v1.0.1) | Follow-up routes `FU-95-005`, `017`–`020` constrain CBD-73 scope and evidence | Exact observed mismatch is preserved; impact/rebaseline remains `OI-73-005` |

Dependency direction is one-way: CBD-73 consumes approved upstream rules and
records proposed focused amendments separately. A CBD-73 draft cannot silently
amend CBD-72, CBD-91, CBD-94, or CBD-95, and passing the CBD-73 mechanical
audit cannot close their source-level work.

## 10. RV-73 finding disposition ledger

`Fixed in v0.2 draft` means the four-document rule/scenario package was
corrected; it does **not** mean Product approval, executable implementation,
customer-copy approval, or runtime evidence exists. `Open` identifies the
stable controlling gate. `External` work is intentionally not edited here.

| Finding | Disposition | Exact v0.2 evidence or controlling gate |
| --- | --- | --- |
| `RV-73-001` | **Fixed in v0.2 draft; implementation gated** | `TR-73-04` records conclusive provider failure only as restricted `AE-73-04` metadata: the real invitation, code, ceremony, and acceptance eligibility remain active. `TR-73-05` handles every active real/synthetic predecessor and selects exactly one `TR-73-01` or `TR-73-15` successor; `TR-73-18` routes resend back through it. Provider `AE-73-03`/`AE-73-04` never alter customer chronology. Replacement is one `AE-73-05`; each real cancellation is one `TR-73-06`/`AE-73-06`, while synthetic `TR-73-18` owns its single `AE-73-06`; fixed-time normalization is one `TR-73-07`/`AE-73-07`, independent of private cause. Evidence is `INV-73-05`, `INV-73-14`, `DCL-73-02`, `DCL-73-06`, and `DCL-73-10`–`DCL-73-12`; code, matching, and audit proof remains `OI-73-008`/`OI-73-010`/`OI-73-011` |
| `RV-73-002` | **Fixed by safe v0.2 rule; optional alternative/mechanics open — `OI-73-002` and `OI-73-012`** | Exact-channel verification permits invitation-scoped plain decline; protected disclosure/acceptance and persistent block require an authenticated attached account; ambiguity/interruption creates neither. `VER-73-07` and `DCL-73-13` cover the rule; alternative UX and provider mechanics remain gated |
| `RV-73-003` | **Fixed in v0.2 draft; scenario coverage completed in v0.2.1** | `IC-73-017` and §4.4 additional rule 6 terminalize any invitation issued at or before the end of the candidate account's prior membership. `INV-73-11` proves the neighbouring creating-permission-loss path for opened and unopened alternate-channel cases; `VER-73-11`, added under `RV-73-028`, proves the recipient-side attachment check this finding actually raised |
| `RV-73-004` | **Fixed in v0.2 draft** | Code resolution and acceptance commit compare the authoritative expiry timestamp independent of expiry materialization; delayed-worker race scenario added |
| `RV-73-005` | **Fixed in v0.2 draft; implementation gated** | `RI-93-012` is normative in §6; membership-independent mandatory in-app notice is exempt from ordinary-alert cutoff; missing/failed/stale/compromised safety-channel cases remain in the inventory; source alignment is `OI-73-003`, mechanics `OI-73-009` |
| `RV-73-006` | **Closed August 18, 2026** | Attachment remains non-authorizing. Because even a matching primary contact may be a mistyped stranger's address, the safe interim denies every acceptance until Product approves an exact intended-recipient binding or explicitly accepts the residual plus complete correction/cutoff evidence |
| `RV-73-007` | **Fixed in v0.2 draft** | Specification adds complete role/scope-change and transfer transition contracts; test inventory covers decline, withdrawal, expiry, authorization loss, concurrency, failure, and recovery |
| `RV-73-008` | **Fixed at requirement level; implementation gated** | §§2 and 9 inherit CBD-94 `SR-94-007`–`SR-94-011` without weakening; code/rate/atomicity/recovery evidence remains `OI-73-008`–`OI-73-011` |
| `RV-73-009` | **Fixed in v0.2 draft; source gated** | Destination data is bound to the account, budget space, membership/invitation or ceremony, purpose, verification, and version; cross-space cases added; CBD-91 class approval is `OI-73-003` |
| `RV-73-010` | **Fixed safe projection; exact copy open** | Decline and other private terminal causes remain security/personal-only while the inviter projection stays `sent/pending` until the same fixed `TR-73-07`/`AE-73-07` normalized boundary. Provider-failure metadata never terminalizes the code or advances that boundary. `DCL-73-12` and `INV-73-05` cover audit/customer projection; exact strings and final presentation remain `OI-73-004`, durable projection evidence `OI-73-011` |
| `RV-73-011` | **Fixed in favor of governing CBD-72** | §8 records no-profile/no-visibility as the only newly accepted Viewer state; `CNS-73-05` explicitly denies an initial-profile create with no record/code/outbox and one `AE-73-31`, then proves that only a no-profile invitation can accept |
| `RV-73-012` | **Fixed in v0.2 draft; implementation gated** | Valid resolution and invalid presentation use disjoint audit events; unknown codes permit only a safe non-secret fingerprint with nullable/global placement; exact cardinality scenarios added; durable audit design is `OI-73-011` |
| `RV-73-013` | **Open semantic interpretation — `OI-73-008`; safe draft rule defined** | The non-oracular draft treats provider failure as restricted active metadata: `TR-73-04` leaves the code usable and `TR-73-08` may resolve it; replacement/cancel/expiry independently terminalize it. Product Owner/Jira must confirm that this satisfies AC01/AC05's literal failed-link wording before package approval |
| `RV-73-014` | **Fixed in v0.2 draft; design gated** | Verification/destination proof data binds ceremony/session, purpose, nonce, candidate account, expiry, version, and consumption; replay/account-switch scenarios added; concrete proof design is `OI-73-008`/`OI-73-012` |
| `RV-73-015` | **Fixed rule; account-block matching and limiter design gated — `OI-73-010`** | Normative composition covers privacy-token matching for unlinked destinations, aliases/cross-channel siblings, and cross-space pre-block enforcement: `TR-73-12` cancels every enumerable matching invitation with one `TR-73-06`/`AE-73-06` child, while `TR-73-10`/`TR-73-13` recheck any match not safely enumerable. Existing memberships stay unchanged; `MSG-73-024` confirms recipient-only block removal without recreating requests. Derivation/equivalence, versioning, rotation, values, storage, recovery, and proof remain open; no-account persistent block remains unavailable |
| `RV-73-016` | **Fixed by resolved v0.2 rule** | §8 records binding to the exact creating permission and authorization version; downgrade, transfer, loss, later restoration, and cancellation cases are required |
| `RV-73-017` | **Fixed by resolved v0.2 rule** | A mixed reduction-plus-expansion request is invalid under `TR-73-27` and produces no state change. `CBD-73-AC07` applies to a valid, separately submitted pure reduction under `TR-73-26`; any later expansion is a separate proposal and consent ceremony. The service does not automatically split a mixed request |
| `RV-73-018` | **Fixed in v0.2 draft; exact copy gated** | Role-specific removal disclosure includes safe denial/no-op `MSG-73-026`, ordinary-member precommit `MSG-73-047`, Primary-authorized Co-owner precommit `MSG-73-049`, and postcommit `MSG-73-034`/`MSG-73-035`; sole-Primary disclosure names transfer and archival. `RVK-73-07`/`RVK-73-16` carry the distinct confirmation evidence; final copy is `OI-73-004` |
| `RV-73-019` | **Fixed in v0.2 draft; storage gated** | Exact edges/cardinality cover `AE-73-01`–`AE-73-07`, with provider `AE-73-04` restricted and fixed-time private-cause normalization owned by `AE-73-07`; acceptance/destination `AE-73-13`–`AE-73-16`, including `TR-73-36` proof, `TR-73-13` activation, and `TR-73-37` prospective retirement; and exactly one `AE-73-06` per actual cancellation at `TR-73-06`, synthetic `TR-73-18`, each `TR-73-10`/`TR-73-13` private cancellation, and each cross-space `TR-73-12` matched invitation. Invitation/change/transfer expiry is `TR-73-07`, `TR-73-24`, and `TR-73-46`; `AE-73-25` covers every `TR-73-40`–`TR-73-47` edge; removal uses `AE-73-22` plus `TR-73-31`–`TR-73-35` denial/effect/notice edges. `AE-73-31` now owns the exact mutation-denial/no-op edges assigned by `TR-73-01`, `TR-73-05`, `TR-73-06`, `TR-73-11`, `TR-73-12`, `TR-73-18`, and `TR-73-29`. Direct-reference manifests detect ID-set drift, while scenario and adversarial review assess the stated polarity/cardinality; storage controls remain `OI-73-011` |
| `RV-73-020` | **Fixed in v0.2 draft** | `FAMILY-73-NN` is the non-stable format label; every actual scenario reference uses its complete namespaced identifier. Diagrams and references use all 45 complete transitions in `TR-73-01`–`TR-73-37` and `TR-73-40`–`TR-73-47`; the repository audit checks namespacing |
| `RV-73-021` | **Open source alignment — `OI-73-003`** | CBD-73 records the required field/boundary shapes but does not approve new/split CBD-91 classes or override older routing text |
| `RV-73-022` | **Fixed in v0.2 draft** | Consent/confirmation evidence is immutable history only and never authorization. Membership changes link the ended/superseded grant. `TR-73-41` creates pending non-authorizing recipient evidence and `MSG-73-025`; `TR-73-42` creates pending Primary confirmation. Terminal `TR-73-43`–`TR-73-46` close and link every extant record to the terminal event. `TR-73-47` never mutates an existing workflow or its evidence; a version-invalidating workflow routes through `TR-73-46`. Replay cases are `CNS-73-08`, `CHG-73-13`, and `TRF-73-10` |
| `RV-73-023` | **Fixed in v0.2 draft** | Callback-versus-expiry precedence is deterministic: authoritative expiry wins regardless of worker materialization; a callback at or after expiry cannot confirm/fail/reopen delivery, expiry follows `TR-73-07`, and the callback is an idempotent no-op under `TR-73-19`. `INV-73-10`/`INV-73-14` cover delayed expiry, duplicate, late, and reordered callbacks |
| `RV-73-024` | **Fixed — tooling** | `scripts/audit-cbd-73.py` and its CI invocation were introduced at remediation parent `9a7a3fe1f8202d0aa8a25aaa6738c7015044af91`. The upgraded audit validates exact 44-message/45-transition/31-audit-event sets, freezes every transition row's direct message/audit reference set, and requires transition-specific expected-outcome coverage rather than relying on package-wide identifier co-occurrence. It does not validate runtime delivery or prove semantic correctness. That parent is not the v0.2 candidate identity, and an audit pass remains structural evidence only |
| `RV-73-025` | **Open external integrity gate — `OI-73-005`** | §7 forbids silent rebaseline; CBD-95 owner must record impact/rebaseline evidence |
| `RV-73-026` | **Closed August 18, 2026** | Targets registered in dependency order after CBD-95, the package published from merged `main`, and read-back parity confirmed across all five pages |
| `RV-73-027` | **Fixed finding-baseline provenance; candidate capture pending; external cleanup — `OI-73-006`** | §2 pins the governing-source commit/blobs and the exact v0.1 finding-baseline package. Remediation parent `9a7a3fe1f8202d0aa8a25aaa6738c7015044af91` is separately labeled. The v0.2 Git object cannot self-pin, so PR/approval evidence must externally capture the exact resulting remediation commit/tree; contradictory CBD-72 metadata remains external cleanup |
| `RV-73-028` | **Fixed in v0.2.1 draft** | §4.4 additional rule 6 and `IC-73-017` were normative in v0.2 but no scenario exercised either recipient-side branch, and the `RV-73-003` disposition cited `INV-73-11`, which proves the creating-permission-loss path instead. `INV-73-18` now proves private suppression when the target is already an active member, and `VER-73-11` proves attachment-time terminalization of an invitation predating the account's latest membership end, including a sibling channel that was never enumerable at removal. The `RV-73-003` disposition is corrected rather than left overclaiming |
| `RV-73-029` | **Fixed in v0.2.1 draft** | The v0.2 test inventory §5 matrix renamed two of `CBD-73-AC14`'s literal required cases, so revoked consent and queued alerts could no longer be verified against the criterion's own wording by lookup. Both literal rows are restored and mapped to existing scenarios; no new behaviour was claimed |

## 11. Approval, implementation, release, and publication gates

| Stage | Required closure/evidence |
| --- | --- |
| CBD-73 lifecycle-rule review | v0.2 four-document semantic consistency; `RV-73-001`–`RV-73-027` ledger reviewed; `OI-73-001` denies every acceptance until an approved intended-recipient binding passes, while attachment remains non-authorizing. `OI-73-008` preserves active restricted provider-failure metadata pending the Product/Jira meaning. The `OI-73-002` safe exclusion rule is sufficient for review; `OI-73-003` does not reopen settled `RI-93-012` |
| Product Owner package approval | **Complete August 18, 2026** for the exact v1.0 documents; `OI-73-002` is either closed or retained under its safe exclusion rule; the committed v0.2 commit/tree and four document versions/blobs are captured in PR/approval evidence; no unresolved contradiction among the four artifacts; approved Jira reconciliation plan based on a fresh read |
| Affected implementation handoff | Product approval plus `OI-73-003` for affected persistence/routing and the applicable concrete designs/evidence in `OI-73-008`–`OI-73-012`, including provider-metadata/code-validity separation, `OI-73-009` pure-reduction/prospective-and-active-destination/membership-end invalidation, `OI-73-010` cross-space account-block matching/pair limiting, and exact audit-edge cardinality; test inventory converted into owned executable fixtures |
| Customer-facing release | Applicable implementation gates closed; `OI-73-004` exact copy/accessibility/localization evidence closed for all 44 message rows including `MSG-73-024`–`MSG-73-027`, `MSG-73-047`, and `MSG-73-049`; security/privacy review and all negative/recovery tests pass; `OI-73-005` explicitly dispositioned for integrated repository evidence |
| Repository integrity sign-off | After commit, capture the exact v0.2 commit/tree and four document blobs, then run `scripts/audit-cbd-73.py` with its transition direct-reference manifests, Mermaid rendering, vocabulary checks, link/anchor checks, relevant implementation tests, and the dispositioned CBD-95 impact audit against that same identity. A branch name or mutable worktree is never pinned candidate evidence |
| Confluence publication | **Complete August 18, 2026.** Targets registered and all five documents published from merged `main` with read-back parity confirmed. Any later revision republishes only after its own merge |

No stage may infer closure from a draft table, a mechanical audit pass, or an
earlier clean run against different blobs.

## 12. Remaining authorized work

1. Keep the reconciled v0.2 identifier sets and exact counts synchronized
   across all four artifacts. After commit, capture the exact resulting
   commit/tree and four blobs in PR/approval evidence, then keep the retained
   audit green at that and every later candidate identity.
2. Obtain and record the Product decisions in `OI-73-001` and the AC01/AC05
   semantic portion of `OI-73-008`. Until then, attachment grants nothing and
   every acceptance denies without an approved intended-recipient binding;
   provider failure remains restricted active metadata. Retain the safe
   exclusion for `OI-73-002` unless its optional composition is approved.
3. Route `OI-73-003`, `OI-73-005`, and `OI-73-006` through their owning
   source documents or audit artifacts under separate, explicitly authorized
   change control.
4. Produce the applicable implementation designs/evidence in `OI-73-008`
   through `OI-73-012`, including provider-metadata/code-validity separation,
   pure-reduction and prospective/active destination retirement under
   `OI-73-009`, account-block alias/privacy-token matching plus cross-space
   enforcement and pair limiting under `OI-73-010`, and exact audit-edge
   cardinality under `OI-73-011`, without weakening normative requirements.
5. Obtain exact-copy/accessibility/localization approval under `OI-73-004`
   for all 44 message rows, including block-removal, transfer-pending,
   membership-end denial, and both removal-confirmation contracts.
6. Immediately before any authorized Jira synchronization, refetch live state
   and reconcile rather than replace it from this record.
7. Merge an approved repository change to `main`; only then close
   `OI-73-007` through Confluence registration, synchronization, and read-back
   parity verification.

## 13. Revision history

| Version | Date | Author | Change | Approval |
| --- | --- | --- | --- | --- |
| 1.0.4 | September 15, 2026 | Claude specification specialist, dispatched by Manager (`PROTO-CONSENT-APPROVALS-APPLY-001`) | Package version moved with the specification's §13.1 `DR-73-04` physical mapping to `budget_space_consent`, the `self_disclosure` source value, the append-only digest-pinned disclosure registry as the version source and the `SEC-F02` forward rule, approved at v1.0.4. No row in this document changed. | **Approved — Product Owner, September 15, 2026 (`PO-CONTRACT-APPROVALS-003`)** |
| 1.0.3 | September 3, 2026 | Claude with Alexander Wohlford as Product Owner | Brand amendment. The ceremony-entry disclosure in the specification's §7 said the surface discloses "that this is a CoBudget invitation requiring verification"; it now says MoneyPact, matching `EM-92-002` as amended at CBD-92 v1.0.1 and the `MSG-73-002`/`MSG-73-010` rows already corrected at v1.0.2. The naming standard is `RT-75-01`. No lifecycle transition, invariant, message row, scenario, or gate changed. | Consequential amendment to an approved document under change control; the v1.0 approval otherwise stands |
| 1.0.2 | September 2, 2026 | Claude with Alexander Wohlford as Product Owner | Brand amendment. The two customer-facing strings that named the product, in `MSG-73-002` and `MSG-73-010`, said "a CoBudget invitation". The September 2, 2026 brand decision recorded in `docs/brand-foundation.md` makes MoneyPact the customer-facing name and keeps CoBudget as the internal codename, so a customer-readable invitation must say MoneyPact. Both now do. No semantic rule changes; the naming standard is `RT-75-*` in the CBD-75 package. | Product Owner authorized September 2, 2026 |
| 1.0.1 | August 18, 2026 | Claude with Alexander Wohlford as Product Owner | Corrected the status line, closed `OI-73-007` with the page IDs, versions, and source commit, closed `RV-73-026`, marked the Confluence publication gate complete, and recorded the five page IDs in the front matter. No rule, decision, or gate changed. | Correction to approved v1.0 |
| 1.0 | August 18, 2026 | Alexander Wohlford — Product Owner, with Claude | Recorded the Product Owner decisions closing `OI-73-001` and the `OI-73-008` Failed-state semantics, added §1.1 stating exactly what the approval does and does not cover, closed `RV-73-006`, and updated every range and total for 47 transitions, 48 messages, 32 audit events, 13 data records, and 101 scenarios. | **Approved v1.0** |
| 0.2.1 | August 18, 2026 | Claude with Alexander Wohlford as Product Owner | Independent completeness review of merged v0.2. Recorded `RV-73-028` and `RV-73-029`, corrected the overclaiming `RV-73-003` disposition, added `INV-73-18`/`VER-73-11` coverage for the §4.4 rule 6 recipient-side checks, restored the literal `CBD-73-AC14` case names, and updated every scenario range and total to 97. No product rule, open issue, or gate changed. | Draft; Product Owner review required |
| 0.2 | August 18, 2026 | Codex with Alexander Wohlford as Product Owner | Audit hardening against `RV-73-001`–`RV-73-027`: reproducible governing and v0.1 finding baselines; 44 messages, 45 transitions, 31 audit events, and 95 globally namespaced scenarios; safe provider-metadata/code-validity separation; bounded encrypted dispatch custody; prospective-destination and cross-space block enforcement; direct-reference-manifest plus expected-outcome checking; canonical `OI-73-001`–`OI-73-012` register; complete finding dispositions; and explicit stage gates. No Jira or Confluence write. | Draft; exact v0.2 commit/tree and document blobs require external post-commit capture because this document cannot self-pin. `OI-73-001` and the `OI-73-008` Failed-semantics decision block package approval; narrower implementation/release gates remain |
| 0.1 | August 18, 2026 | Claude with Alexander Wohlford as Product Owner | Initial complete draft: completion rule, deliverable and per-criterion traceability in both directions, supported CBD-12 criteria mapping, routed `FU-95` follow-up-family coverage, discrepancy register (six items), governing inheritance, review gates, and remaining work. | Draft; Product Owner review required |
