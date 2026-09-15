# CBD-236 — Policy version 6: subject-self notice and display-name amendment proposal

| Field | Value |
| --- | --- |
| Status | **Proposed.** Not applied: no contract edit, no policy cell, no release-history row, no code, and no Jira or Confluence change exists because of this document. The residual choices are Executive decisions (§9) |
| Document version | 0.1 |
| Proposal identifiers | edits `P6-E01`–`P6-E06`; options `P6-OPT-A`, `P6-OPT-B` (action naming); negative fixtures `P6-N01`–`P6-N08`; contract revisions `P6-R01`–`P6-R09`; decisions `P6-D01`–`P6-D05`; findings `P6-F01`–`P6-F04` |
| Owner | Alexander Wohlford |
| Jira subtask | [CBD-236](https://cobudget.atlassian.net/browse/CBD-236); the increment that raised the question is the PK-8 gap-closure pass (CBD-41 family) |
| Governing contract | `docs/cbd-236-authorization-policy-contract.md` \| Document version **0.13** — §4.1, §4.2, §4.4, §5.3, §6, §6.1, §8.5, §8.8, §9.3, §9.4, §9.7, §12, §14 |
| Governing findings | `GAPS-F01` (`PROTO-INVITATIONS-API-GAPS-001-RESULT` r1); `SEC-GAPS-R1` (`PROTO-INVITATIONS-API-GAPS-SEC-001-RESULT` r1, disposition `clear`); `PK8-F06` (`PROTO-INVITATIONS-PK8-WEB-001-RESULT` r2); Executive ruling `EXEC-PK8-RULINGS-001` item b (display-name route precedes the disclosure-text promise) |
| Release-step precedent | `docs/cbd-236-p5-release-step.md` \| Document version **0.2.1** — the shape a policy-version release follows; §8 of this document states the `p6` step in that shape without applying it |
| Amendment-proposal precedent | `docs/cbd-236-primary-ownership-version-amendment-proposal.md` \| Document version **0.2** — the shape this document follows |
| Merged behaviour read | `packages/contracts/src/authorization/{input,evaluate}.ts`, `policy/{registry,v2,v5}.ts`, `fixtures/index.ts`, `authorization.test.ts`; `apps/api/src/authorization/{facts,boundary,http}.ts`; `apps/api/src/identity/http.ts` (the `me` route); `apps/api/src/budget-spaces/http.ts` (the members display-name read); `packages/budget-application/src/invitations/{ports,data-access-adapter,in-memory}.ts`; `packages/data-access/src/financial-profile.ts`; `packages/migrations/migrations/20260915T100000Z__widen_membership_and_consent_for_invitations.sql` (the `financial_profile.display_name` column) and `20260915T100002Z__create_budget_space_primary_transfer.sql` (the `account_lifecycle_notice` table and its `forbid_account_lifecycle_notice_mutation` trigger); `docs/cbd-212-financial-profile-persistence-contract.md`; `docs/cbd-73-invitation-consent-lifecycle-specification.md` §13; `docs/cbd-234-invitations-consent-design-proposal.md` §9 (`IV-010`) — all at `b1cdde0` on `main`. The two notices routes (`apps/api/src/notices/http.ts`) and the mutation obligation they need are read from `PROTO-INVITATIONS-API-GAPS-001-RESULT` (PR #376, not yet merged to `main` as of `b1cdde0`), not from a file in this worktree; §1.1 states that explicitly |
| Milestone | `PROTOTYPE-SLICE-001` and `PROVIDERS-LOCAL-001` (Executive, September 12, 2026) |
| Repository baseline | `b1cdde0` on `main` |
| Written by | Architecture, assignment `PROTO-CONTRACTS-P6-SUBJECT-SELF-PROPOSAL-001`, September 15, 2026 |
| Last updated | September 15, 2026 |

> **Authority.** CBD-236 v0.13 is the approved-and-proposed contract and this document changes nothing in it. It proposes an amendment (`P6-R01`–`P6-R09`) for the Product Owner and Security to approve under the same rule every earlier policy-version amendment followed (`CBD236-POLICY-APPROVAL-001`), and puts the residual choices to the Executive. Where this document and the approved contract disagree, the contract wins and this document is wrong.

## 1. The gap as reported, and what is and is not merged at this baseline

### 1.1 What this worktree can and cannot read directly

This packet's base revision, `b1cdde0` on `main`, predates PR #376 (`feat/invitations-api-gaps`), which is the candidate that actually contains `apps/api/src/notices/http.ts`, `packages/data-access/src/account-lifecycle-notice.ts`, and the `account_lifecycle_notice` table's `forbid_account_lifecycle_notice_mutation` trigger. Those three are read from `PROTO-INVITATIONS-API-GAPS-001-RESULT` r1 (implementation, `clear`-dispositioned by `PROTO-INVITATIONS-API-GAPS-SEC-001-RESULT` r1) rather than from this worktree. The `budget_space_primary_transfer` migration file that carries the notice table and trigger (`20260915T100002Z__create_budget_space_primary_transfer.sql`) **is** present at `b1cdde0` — the table, columns and trigger already exist in the schema this worktree sees; only the two `apps/api` routes and the data-access statements that read/write them are unmerged. This is stated once here and does not repeat below: every citation to `apps/api/src/notices/http.ts` or `account-lifecycle-notice.ts` is a citation to the GAPS result record, not to a file this worktree contains, and an implementation packet rebasing onto a later `main` should re-verify the line numbers against whatever has merged by then.

`financial_profile.display_name` and its `MAX_DISPLAY_NAME_LENGTH` (1–80) check, `packages/data-access/src/financial-profile.ts`'s `readDisplayIdentity`/`writeDisplayName` pair, and their ports in `packages/budget-application/src/invitations/ports.ts` **are** present at `b1cdde0` and read directly.

### 1.2 GAPS-F01 / SEC-GAPS-R1: the mark-read mutation on a read cell

`GET /v1/notices` and `POST /v1/notices/{noticeId}/read` both run on the released `p2` subject-self cell `profile.read` (§8.5.1), because the `p2` matrix has no subject-self notice cell and the GAPS packet's own scope forbade inventing one (`GAPS-F01`). The read half is unremarkable — `profile.read`'s effect class is `read`, and listing the caller's own `account_lifecycle_notice` rows discloses nothing profile.read does not already reach at the subject-scoped boundary. The mark-read half is the finding: it is a mutation (`account_lifecycle_notice.read_at`, from `NULL` to a timestamp) authorized by a cell whose `effectClass` is `read`, so `decide` never emits `recheck_at_commit` for it (§5.3: the obligation is carried by "every allow whose `effectClass` is not `read`"; `profile.read`'s `effectClass` is fixed by its `ACTION_DEFINITIONS` entry, not by what the handler then does).

Security's ruling (`SEC-GAPS-R1`, disposition `clear`, Level 2) accepted this for the merge that carries it, for a stated reason that is not "the policy is right": the write is bounded to exactly one column, exactly once, on the caller's own row, by a database trigger (`forbid_account_lifecycle_notice_mutation`) that runs independently of and beneath the authorization layer — `NEW.read_at` may move from `NULL` to non-`NULL` and nothing else may ever change, enforced by `RAISE EXCEPTION` with SQLSTATE `23514` on any other attempt. `SEC-GAPS-R1` explicitly kept the follow-up open: "a dedicated `notice.read` / `notice.mark_read` policy pair … remains the right long-term shape but is not a merge blocker." This document is that follow-up, and the packet that dispatched it names the same two action codes and the same requirement — a mutate cell carrying `recheck_at_commit` — that `SEC-GAPS-R1` recommended.

The correctness gap the amendment closes is not "an exploit exists" (none was found); it is the same shape as the primary-ownership-version amendment's gap (`docs/cbd-236-primary-ownership-version-amendment-proposal.md` §2.3): a mutation is authorized by a cell whose `effectClass` and obligation set describe a different, weaker operation, and the trigger — not the policy — is what a reviewer must currently find to know the write is safe. `PC-236-010`'s obligation table exists so that safety is legible from the cell, not from a migration file three packages away.

### 1.3 PK8-F06 / `EXEC-PK8-RULINGS-001` item b: the display name the disclosure text promises

The approved disclosure texts (`invitation_collaborator.v1`, `invitation_co_owner.v1`, and by the same pattern the two primary-transfer texts) say the invitation "names the budget space … and the display name of the member who invited you" (`PK8-F06`). `GET /v1/invitations/{ceremonyId}` deliberately omits both today — design §9 (`IV-010`) reserved `financial_profile.display_name` for "a later profile route" and PK-6 shipped the ceremony view without one. `EXEC-PK8-RULINGS-001` item b ruled that the surface must honor the approved text rather than soften it, "which requires the display-name profile route first."

Reading the merged code against that ruling surfaces a second, unreported gap: **no production code path calls `writeDisplayName` at all.** `packages/data-access/src/financial-profile.ts` exports the compare-and-set write with its `SEC-PK2-F08` version-bump discipline; `packages/budget-application/src/invitations/ports.ts` exposes it on the invitations port (`readDisplayIdentity`/`writeDisplayName`, lines 260–263) and `data-access-adapter.ts`/`in-memory.ts` implement it; but a repository-wide search of `apps/api/src` and `apps/web/src` for `writeDisplayName` finds only the type declarations — no handler, ceremony step, or `identity/http.ts` route invokes it. Design §9's sentence "set at first sign-in from the provider's name claim where present … editable only by the subject through a later profile route" describes an intended ceremony write that was never wired; `financial_profile.display_name` is `NULL` for every subject today, and every "neutral label" fallback (`apps/api/src/budget-spaces/http.ts`'s `displayLabel`) is therefore always taken. This is reported as `P6-F01` (§10); it does not change the amendment's shape, because the port this amendment's cell calls is the same `writeDisplayName` statement regardless of whether a ceremony ever also calls it, but it does mean "the ceremony sets it once today" in the dispatching packet's framing is not what the merged code does — the subject-self mutate cell proposed here would be the *first* caller of `writeDisplayName` in the running system, not a second, narrower one.

## 2. The amendment, stated exactly

Every edit below is against `b1cdde0`. Line numbers for `apps/api/src/notices/http.ts` are the GAPS candidate's (§1.1); every other file's line numbers are this worktree's. An implementation packet re-derives all of them after rebase, and re-derives the notices-route lines from whatever revision of PR #376 (or its merge) it starts from.

### `P6-E01` — `policy/v6.ts`: two new action definitions and their subject-self cells

A new file, built from `v5.ts` exactly as `v5.ts` was built from `v4.ts` (§8.8's own statement of that pattern): every `p5` action definition, user cell and service cell is carried byte-identical and in position, and the following are appended.

```ts
// ACTION_DEFINITIONS additions
{ action: "notice.read",              effectClass: "read",   resourceType: undefined, authorityModes: ["user_delegated"] }
{ action: "notice.mark_read",         effectClass: "mutate", resourceType: undefined, authorityModes: ["user_delegated"] }
{ action: "profile.set_display_name", effectClass: "mutate", resourceType: undefined, authorityModes: ["user_delegated"] }
```

```ts
// SUBJECT_CELLS additions (kind: subject-self, no resource section; §4.4)
{ action: "notice.read",              obligations: [] }
{ action: "notice.mark_read",         obligations: [] }
{ action: "profile.set_display_name", obligations: [] }
```

`obligations: []` here means "no cell-specific obligation beyond the two §5.3 universal ones" — `audit` on every decision, and `recheck_at_commit` on `notice.mark_read` and `profile.set_display_name` because their `effectClass` is `mutate`, exactly the notation `p5`'s own tables use (§8.8.1: "`audit` … and `recheck_at_commit` … are the §5.3 universal obligations and are not repeated in the table"). `notice.read`'s `effectClass` is `read`, so it carries `audit` alone, same as `profile.read` and `membership.list_own` today.

No `resourceType` is set on any of the three definitions: all three are subject-self, not subject-target (§2.1 below states why). `resourceType: undefined` matches the existing subject-self definitions (`proposal.create`, `membership.list_own`, `profile.read`, `invitation.attach`); `decide`'s §4.4 kind rule ("a present `resource` section denies `input_invalid`" for a subject-self cell) requires no `resourceType` to switch on.

### `P6-E02` — `registry.ts`: register `p6`

```ts
export const P6_DIGEST = /* computed from the branch, §5 */;
```

`POLICY_VERSIONS` gains a `p6` entry `{ version: "p6", digest: P6_DIGEST, actionDefinitions: P6_ACTIONS, userCells: P6_USER_CELLS, serviceCells: P5_SERVICE_CELLS, schemaVersion: 1 }` (service cells are unchanged — `p6` adds no service purpose, exactly as `p2`, `p3` and `p4` did). `CURRENT_POLICY_VERSION` is **not** flipped by this edit; it stays `"p5"` until the release step (§8) applies, following the same "registered above the current version" state `p2` through `p5` each passed through (§6, `PC-236-011`: "A registered version is not thereby deployed").

### `P6-E03` — fixtures

`packages/contracts/src/authorization/fixtures/index.ts` gains three subject-scoped fixture builders (`noticeReadFixture`, `noticeMarkReadFixture`, `setDisplayNameFixture`), following the existing `subjectFixture(action, version)` shape (used for `profile.read` and `invitation.attach` today) rather than new hand-built literals: `subjectFixture("notice.read", "p6")`, `subjectFixture("notice.mark_read", "p6")`, `subjectFixture("profile.set_display_name", "p6")` should already produce a correct positive fixture for each with no change to `subjectFixture` itself, because all three are ordinary subject-self cells with no target row and no new provenance leaf. `P6_NEGATIVE_FIXTURES` is `subjectNegativeFixtures("p6")`, the same version-parameterized generator §9.4 already uses for `p2`'s five cells — no new generator code, because §9.4's family list (below, §4) already covers every negative this amendment needs; only the version argument and the three new action names are additions.

### `P6-E04` — `apps/api`: the three routes move onto the new cells

`apps/api/src/notices/http.ts`'s `@Authorize({ action: "profile.read", … })` decorators on the list and mark-read handlers become `@Authorize({ action: "notice.read", … })` and `@Authorize({ action: "notice.mark_read", … })` respectively (both keep `resourceLocator: () => ({ fieldSet: "default", scope: "subject" })`, matching every other subject-self route). The header comment recording the `GAPS-F01`/`SEC-GAPS-R1` ruling is replaced with a note that the routes now carry their own cells. No change to `packages/data-access/src/account-lifecycle-notice.ts`'s subject- and id-predicated statements, and no change to the `forbid_account_lifecycle_notice_mutation` trigger — the trigger stays as defense in depth exactly as the transfer commit's both-memberships invariant stays defense in depth under the primary-ownership-version amendment (`docs/cbd-236-primary-ownership-version-amendment-proposal.md` §2.2).

A new route, `PATCH /v1/identity/display-name` (or the implementation packet's chosen path; the action code is what this contract fixes, not the route path), calls `writeDisplayName` under `@Authorize({ action: "profile.set_display_name", purpose: "user_delegated", resourceLocator: () => ({ fieldSet: "default", scope: "subject" }) })`, reads the current `profileVersion` from the decided input's `profile` section as the compare-and-set's `expectedVersion` (the same value already captured in `SubjectScopedCapturedVersions.profileVersion` and re-equality-checked at commit by `PC-236-014`), and answers `409` (mapped from `writeDisplayName` returning `null`, i.e. a concurrent write moved the version) or the new `{ displayName, version }` pair. The 1–80-code-point bound is `writeDisplayName`'s own `RangeError` (`packages/data-access/src/financial-profile.ts`, `MAX_DISPLAY_NAME_LENGTH`), not a `PolicyInput` field — exactly as a proposal's content is not a `PolicyInput` field for `proposal.create` (§4.4 note: the assembler binds the actor and the target, never the payload).

### `P6-E05` — `apps/worker`: no change beyond the mirror

`p6` adds no service cell and no worker-adapter action. `apps/worker/src/authorization/facts.ts` needs no edit under this amendment (contrast the primary-ownership-version amendment, which touched the datastore allowlist both apps share — this amendment adds no datastore leaf at all). `inventory.test.ts`'s parity check has nothing new to compare because nothing in the worker-shared files changes.

### `P6-E06` — `apps/api/src/identity/http.ts`: `me` gains `displayName` (`P6-D03`, recommended)

If `P6-D03` is decided `yes` (§9), the `me` handler's return object (line 183) gains `displayName: view.displayName` (or equivalent, reading the same `financial_profile` row the ceremony view already loads); `IdentityCeremony.viewResolved`'s return shape gains the field, sourced from the same `financial_profile.display_name` column `readDisplayIdentity` already reads elsewhere. This is additive to the `me` response shape, not to `PolicyInput`: `profile.read`'s cell, provenance and captured-version set are unchanged, because `display_name` was already inside the `profile` section's underlying row — only the *view* projection grows a field. If `P6-D03` is decided `no`, this edit is dropped and the members-list route (`apps/api/src/budget-spaces/http.ts`) remains the only place `display_name` is read for display today.

## 3. Why subject-self, not subject-target (`P6-D01`)

§4.4's table gives two kinds. Subject-target binds a loaded row's `owningSubjectId`/`environmentId` against the caller and denies `scope_mismatch` on inequality (`proposal.regenerate`, `proposal.read`, `invitation.read_ceremony`, `invitation.accept`); subject-self carries no target row at all, and isolation rests entirely on provenance (`subject.accountSubjectId` from `session_store`, never a locator).

For all three new cells, a subject-target design is possible — `notice.mark_read` could add `ResourceType: "notice"`, load the `account_lifecycle_notice` row by `(account_subject_id, notice_id)` exactly as `invitation_ceremony` is loaded by `(environment, attached_subject_id, ceremony_id)`, and bind `resource.owningSubjectId` — and `profile.set_display_name` could do the same against `financial_profile`'s own row (it already has one, `profile.profileId`). This is rejected here for a reason the dispatching packet's own negative-fixture list states as a requirement rather than an option: **"a resource section present on a subject-self cell" is listed as a required negative**, i.e. the packet already decided these are subject-self cells and wants the forbidden-resource-section fixture proven against them, matching §4.4's kind-two table exactly ("Subject-self … none; a present `resource` section denies `input_invalid`"). Subject-self also matches every existing precedent for a caller's-own-row mutation with no cross-subject risk to prove (`invitation.attach`, itself subject-self and `mutate`) and costs nothing a subject-target design would have bought: there is no second subject whose row could be confused with the caller's, because both `account_lifecycle_notice` and `financial_profile` statements are already predicated on `account_subject_id` at the data-access layer (`readAccountLifecycleNotice`/`markAccountLifecycleNoticeRead`, `readDisplayIdentity`/`writeDisplayName`), so the policy-level target-row proof subject-target would add is redundant with the statement predicate rather than a second independent fence (contrast `resource.owningSpaceId` for an ordinary space-bound cell, where the predicate the datastore statement applies and the predicate `decide` re-proves are two different rows read at two different layers). `P6-D01` records this as a decision rather than folding it silently into §2 because it is a real design fork with a real, if smaller, alternative; §9 states it with the recommendation **subject-self**.

## 4. Negative fixtures the packet must add

All in `packages/contracts/src/authorization/fixtures/index.ts`, generated by `subjectNegativeFixtures("p6")` (§9.4's existing version-parameterized generator; no new generator code) unless stated; every entry evaluates under `p6` (through `decideUnderRegisteredVersion` before release, through `decide` after) and must deny inertly per `PC-236-018`: no `cellRef`, no `capturedVersions`, no obligation other than `audit`.

| ID | Family | Cell(s) | Construction | Expected | What it proves |
| --- | --- | --- | --- | --- | --- |
| `P6-N01` | Another subject | all three | `subject.accountSubjectId` stamped from `request_locator` instead of `session_store` | `input_invalid` | isolation rests on provenance, not a target row (§3), exactly the §9.4 subject-self "another subject" row |
| `P6-N02` | Wrong environment | all three | `environment.environmentId` stamped from `request_locator` | `input_invalid` | §9.4 subject-self "wrong environment" row |
| `P6-N03` | Stale session version | all three | `capturedAtPrecheck.sessionVersion` unequal | `stale_version` | §9.4 "stale session version" row; the discriminating negative for the two mutate cells' `recheck_at_commit` — this is the exact obligation `GAPS-F01` found missing on the `profile.read` binding, and `P6-N03` is the fixture that proves it now exists |
| `P6-N04` | Service authority | all three | a service-mode input naming the cell | `authority_mode_unsupported` | none of the three admits `service` (§2 `P6-E01`, `authorityModes: ["user_delegated"]`) |
| `P6-N05` | Inactive subject; inactive profile | all three | `subject_not_active`; `profile.profileState` not `active` | `subject_not_active` | §9.4 row; `notice.read`/`notice.mark_read` and `profile.set_display_name` alike deny for a subject who cannot act at all |
| `P6-N06` | Forbidden resource section (`P6-D01`, `SEC-P2-F5` pattern) | all three | a `resource` section present, both as `{}` and populated | `input_invalid` | the negative the dispatching packet's objective names by name: subject-self admits no target row |
| `P6-N07` | Space-bound / worker / not-current shape | all three | the ordinary API variant naming the cell; `evaluation.adapter` `worker`; a `p6` input evaluated while `p5` is current | `input_invalid`; `input_invalid`; `policy_version_unsupported` | §9.4's remaining rows, restated for `p6` |
| `P6-N08` | Second mark-read after the first (application-level, not a `decide` fixture) | `notice.mark_read` only | a repeat `POST /v1/notices/{noticeId}/read` on an already-`read_at` row | `decide` allows (the cell's predicates are unaffected by the row's own state); the PK-2 trigger stamps nothing on the second write and the handler answers the already-stamped row unchanged, as `PROTO-INVITATIONS-API-GAPS-001-RESULT`'s `NOTICES-01`/`02` already prove for the `profile.read` binding | the policy layer does not, and must not, duplicate the trigger's set-once rule (§8.5.2's "`decide` does not evaluate the target row's own lifecycle" pattern, applied to a subject-self row this time); listed because the dispatching packet's objective names "a mark-read on a notice already read" as a required negative, and the correct answer is that this is *not* a `decide`-level denial — it is proven at the route/trigger layer exactly as it already is today, and `P6-N08`'s purpose is to document that boundary rather than to add a new `decide` fixture that would wrongly imply the policy tracks per-notice state |

`P6-N08` is the one row on this list that is not a `subjectNegativeFixtures` output; it belongs beside `NOTICES-01`/`02` in `apps/api/src/notices/http.test.ts` (or its successor once PR #376 merges), not in `packages/contracts`. It is included here because the dispatching packet named it explicitly and an implementation packet should not go looking for it in the wrong package.

The dispatching packet's fourth named negative, "a display name outside 1..80," is `writeDisplayName`'s existing `RangeError` (`packages/data-access/src/financial-profile.ts`, `MAX_DISPLAY_NAME_LENGTH`) surfaced by the new route as a `400`, not a `decide` fixture at all — `PolicyInput` carries no display-name value (§2 `P6-E04`). It belongs in `apps/api/src/identity/http.test.ts` (or the new route's own test file) beside the length-boundary tests `writeDisplayName`'s own module tests should already carry, not in the contracts fixture catalog.

## 5. Digest and `INPUT_SCHEMA_VERSION` impact

`p6` is a new registered policy version under `PC-236-011` — adding a cell is one of the three changes ("action definition, cell, predicate, or obligation") the rule names outright, so this is not the discretionary question the primary-ownership-version amendment had to resolve (`POV-D01`, `POV-OPT-A/B/C`). There is no option here: `p6` is registered, `p1`–`p5` are carried byte-identical and their digests are unchanged, and `P6_DIGEST` is a new value computed from the branch once `P6-E01`–`P6-E03` land, by the same command the `p5` step used:

```bash
node --import=tsx -e "import('./packages/contracts/src/authorization/policy/registry.ts').then((m) => console.log(m.P6_DIGEST))"
```

This document does not state the expected output, unlike the `p5` release step, because the value does not exist until the implementation packet writes `v6.ts` and `registry.ts` — there is no way to compute a SHA-256 of code this proposal does not contain, and printing a placeholder digest would misstate what has and has not been reproduced.

`INPUT_SCHEMA_VERSION` and every registered version's `schemaVersion` stay **1**. This amendment adds zero `PolicyInput` fields, zero provenance sources, zero `ResourceType` members, zero input variants, and zero `capturedVersions` shapes — `SubjectScopedCapturedVersions` already has a mutate-carrying member (`invitation.attach`), so no new captured-version shape is needed either. This is a smaller-footprint change than `p2` (added a whole input variant and `ResourceType` `proposal`) and `p5` (added `ResourceType` `invitation`/`invitation_ceremony`), both of which kept `schemaVersion` 1 under the same §8.5.3/§6 additive precedent the primary-ownership-version amendment restated as `POV-R06`; `p6` adds strictly less than either and inherits the same conclusion without needing a fresh Executive ruling on the schema question (`OQ-236-014` already closed it for the datastore-leaf case; this case does not even reach that rule, because no leaf is added at all — only new `ACTION_DEFINITIONS`/`USER_CELLS` rows, which §6's first paragraph already treats as an ordinary new-version event with no schema question attached, exactly as every action-code addition from `p2` through `p5` was).

## 6. Section 8 rows: cells, action-code definitions, and predicates

### 6.1 Cells (the exact §8.9 table an implementation packet's contract revision states)

| Action code | Kind | Effect | Cell obligations | Governing source |
| --- | --- | --- | --- | --- |
| `notice.read` | Subject-self | `read` | `bind_cache_key` (dimensions `environmentId`, `accountSubjectId`, `subjectVersion`, `profileVersion`, `policyVersion`, per §5.3's subject-scoped-read row) | `CBD-73` `DR-73-11`; `PROTO-INVITATIONS-API-GAPS-001-RESULT` `GAPS-F01` |
| `notice.mark_read` | Subject-self | `mutate` | none beyond the universal `audit`, `recheck_at_commit` | `CBD-73` `DR-73-11`; the `account_lifecycle_notice` PK-2 trigger is the discharge mechanism for the write itself, not a policy obligation; `GAPS-F01`, `SEC-GAPS-R1` |
| `profile.set_display_name` | Subject-self | `mutate` | none beyond the universal `audit`, `recheck_at_commit` | `CBD-91` `DI-91-065`; design §9 `IV-010`; `PK8-F06`; `EXEC-PK8-RULINGS-001` item b |

`bind_cache_key` on `notice.read` follows the same rule §5.3 already states for every subject-scoped read; it is listed explicitly here (unlike the terser p5 space-bound table) because `notice.read`'s dimension set is the subject-self one, not the subject-target one, and a reviewer should not have to re-derive that from §5.3's prose.

### 6.2 Action-code definitions

Restated from `P6-E01` for the §4.1/§8 cross-reference an implementation packet's contract revision needs: `notice.read` — `effectClass: read`, no `resourceType`, `authorityModes: [user_delegated]`; `notice.mark_read` — `effectClass: mutate`, no `resourceType`, `authorityModes: [user_delegated]`; `profile.set_display_name` — `effectClass: mutate`, no `resourceType`, `authorityModes: [user_delegated]`. No `ResourceType` union member is added (§5); §4.1's `resource.type` row is unchanged.

### 6.3 Predicates, in the order `decide` applies them

Identical to §8.5.2 (the `p2` subject-self predicate order), because all three cells are subject-self with no target row: universal input validation and provenance (§4.2); requested version equals current; action defined and admits `user_delegated`; captured versions, when present, equal; subject and profile `active`; input is the subject-scoped API variant; no `space`, `membership`, `consent`, `bootstrap`, `serviceSource` section present, and no `resource` section present (`P6-N06`); a cell exists for the action. Then the cell allows with `cellRef { kind: "subject", action }` and `SubjectScopedCapturedVersions` (§6.1 of the contract — the subject-self member of the union, `{ sessionVersion, subjectVersion, profileVersion, environmentId, policyVersion, policyDigest, inputSchemaVersion }`, unchanged shape). No evaluator change: unlike `p5`'s assurance-predicate refactor (§8.8.2), nothing about how `decide` reads an obligation or a predicate changes for `p6` — every one of the three cells reuses code paths that already exist and are already exercised by `profile.read` and `invitation.attach`.

## 7. Route registrations (`rlp-266-mutation-v1` and its read counterpart)

`config/rate-limit/registrations.json` needs three new entries, one per route, none a new record (`CBD266-PROTOTYPE-DEFAULTS-001`'s existing surfaces cover all three): `GET`/`HEAD /v1/notices` and `POST /v1/notices/{noticeId}/read` already have registrations from `PROTO-INVITATIONS-API-GAPS-001-RESULT` (`surf-266-budget-read`/`rlp-266-authenticated-read-v1` for the read, `surf-266-budget-mutation`/`rlp-266-mutation-v1` for the mark-read) — those entries do not change shape, only the `@Authorize` action name their route now carries changes, and `check:rate-limit-registry` keys on route path and method, not on the policy action, so no registry edit is implied by `P6-E04`'s decorator swap alone. The new display-name route needs its own registration: `PATCH /v1/identity/display-name` (or the packet's chosen path) on `surf-266-budget-mutation`/`rlp-266-mutation-v1`, the same surface every other subject-self or space-bound mutation already uses (`POST /v1/notices/{noticeId}/read` itself, `POST /v1/invitations/{id}/accept`, `POST /v1/budget-spaces/{id}/primary-transfers/{transferId}/confirm`). This is a new record (a new route), not a new surface or approved-record class, and belongs in the implementation packet's registrations file, not in this document.

## 8. Release step (stated in the shape of `docs/cbd-236-p5-release-step.md`, not applied)

`p6` releases more simply than `p5` did: `p5` is already released and current, so there is no "`p4`-first-or-combined" complication — `p6` is registered directly above the released `p5` and its release is a single append.

**Preconditions.** Product Owner approval of the `p6` cells at exact contract version (this document's §6, once the Product Owner approves `P6-R01`–`P6-R09`); a Security result on the implementation candidate with disposition `clear` or `remediate` with every condition closed.

**The row.** `config/authorization-policy-release-history.json` gains, after the `p5` row:

```json
  {
    "version": "p6",
    "digest": "<P6_DIGEST, reproduced from the branch, §5>",
    "schemaVersion": 1,
    "releaseCommit": "<full SHA of the main merge commit carrying the p6 registry>",
    "productApprovalRef": "<approval record id for the p6 cells>",
    "securityApprovalRef": "<Security result id for the p6 candidate>"
  }
```

**The flip.** `registry.ts`'s `export const CURRENT_POLICY_VERSION = "p5" as const;` becomes `"p6"`. Nothing else in the registry changes.

**Application literals.** `apps/api/src/authorization/{compatibility,facts,test-support}.ts` and `apps/worker`'s mirrors gain the `p6` version/digest in `SUPPORTED_POLICY_TUPLES`, `versions.policyVersion`, and `testHistory`, exactly as the §4.3 table of the `p5` step lists for its own flip; `apps/worker/src/authorization/jobs.ts`'s claimed-versions literal (`item !== "p5"` becomes `item !== "p6"`) is the one worker-side line, present only because it is a version-current check, not because this amendment touches the worker's cells.

**Tests the flip changes.** `boundary.test.ts`'s released-row count and the new `released[5]` assertion (digest, `schemaVersion` 1, the two `p6` approval references, non-empty `releaseCommit`); the contracts suite is version-derived (`CATALOGS[currentVersion]`, `subjectNegativeFixtures(currentVersion)`) and is expected to need no edit under a simulated flip, following the `p5` step's own precedent and the reasoning in §6 above (no evaluator or shape change); `apps/api/src/notices/http.test.ts` and the new display-name route's test gain no assertions from the flip itself — their `@Authorize` decorators already name `p6`'s action codes from `P6-E04`, so their negatives (`P6-N01`–`P6-N08`) already run through `decideUnderRegisteredVersion("p6", …)` before the flip and through `decide` after, exactly as `p5`'s ceremony cells did (§8.8.3).

**No migration.** The columns this amendment authorizes access to — `account_lifecycle_notice.read_at`, `financial_profile.display_name` — both already exist in the schema at `b1cdde0` (§1.1). No `packages/migrations` change is part of this amendment.

## 9. Decisions for the Executive

| ID | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| `P6-D01` | Subject-self (no target row) or subject-target (a loaded `notice`/profile row) for all three cells? | **Subject-self** | §3; the dispatching packet's own required negative ("a resource section present on a subject-self cell") already presupposes this answer, every statement is already subject-predicated at the data-access layer, and a target row would duplicate rather than add a fence |
| `P6-D02` | Action name for the display-name mutation: `profile.set_display_name` (narrow, one field) or `profile.update` (general, room for future fields)? | **`profile.set_display_name`** | `writeDisplayName` is the only mutable-field port `financial_profile` exposes today (§1.3); `profile.update` would authorize a field set `PolicyInput` cannot see and CBD-72/CBD-82 have not approved (`OQ-236-006` is still open for `profile.create`/`preference.update`), so a general name would promise more than this amendment delivers. `notice.read`/`notice.mark_read` already establish the narrow-verb convention this follows |
| `P6-D03` | Should `profile.read`'s `me` route also serve `displayName`? | **Yes** | The `me` view already loads the subject's own rows; adding one field it can already see is additive to the response shape and costs nothing in `PolicyInput`, and it is the natural place a client reads its own display name back after `profile.set_display_name` writes it (§2 `P6-E06`) |
| `P6-D04` | Do the CBD-236 revisions `P6-R01`–`P6-R09` (§10) and the CBD-212/CBD-73 sentences (§11) travel in the same implementation PR as the `p6` cells, or a separate documentation PR? | **Same PR for CBD-236** (as `POV-D04` ruled for the primary-ownership-version amendment); **CBD-212 and CBD-73 in a follow-up PR routed to their own owners** | CBD-236 must not describe cells the code does not have; CBD-212 and CBD-73 are owned by other packages under this repository's single-writer rule and this packet may not edit them |
| `P6-D05` | Does `p6` release immediately after Product Owner and Security approval, or stay registered-and-not-current for a time (as `p4` did)? | **Release immediately** | Unlike `p4` (which waited on the Co-owner/Collaborator rulings), nothing blocks `p6`: the notices routes are already deployed on the weaker `profile.read` binding and the display-name route is new, so leaving `p6` registered-not-current only prolongs the exact gap `GAPS-F01` reported |

## 10. CBD-236 revisions proposed (the contract owner applies; nothing here edits the contract)

| ID | Section | Revision |
| --- | --- | --- |
| `P6-R01` | New §8.9 (after §8.8) | States §6 of this document (cells, action definitions, predicates) as the contract's own `p6` section, in the §8.8 house style |
| `P6-R02` | §8.9.3 (new, digest and status) | States the reproducible `P6_DIGEST` command and, once known, the value; records `p6` as registered-and-not-current until the release step applies |
| `P6-R03` | §8.9.4 (new, release step) | Points at a `docs/cbd-236-p6-release-step.md` the implementation/release packet writes (this document's §8 is the shape, not the applied step — matching the relationship between `docs/cbd-236-primary-ownership-version-amendment-proposal.md` §8 and `docs/cbd-236-p5-release-step.md`) |
| `P6-R04` | §9.7 (or a new §9.8) | Adds the `p6` row to the negative-family table: the §9.4 subject-self families, restated for `p6`'s three cells, citing `P6-N01`–`P6-N07` |
| `P6-R05` | §12 (affected interfaces table) | New row: "`p6` (PK-8 gap closure): `notice.read`, `notice.mark_read`, `profile.set_display_name` subject-self cells; `apps/api/src/notices/http.ts` moves off `profile.read`; no `ResourceType`, provenance, obligation-kind or input-variant change" — additive, no migration, `apps/worker` unaffected |
| `P6-R06` | §14 | A new closed question recording that a cell addition with no schema-shape change needs no fresh `INPUT_SCHEMA_VERSION` ruling beyond `OQ-236-014`'s existing reasoning (§5 of this document) |
| `P6-R07` | §16 (handoff table) | A new `HO-236-12` row: which route binds which cell (`GET /v1/notices` → `notice.read`; `POST /v1/notices/{noticeId}/read` → `notice.mark_read`; the new display-name route → `profile.set_display_name`); must-not-decide: any field-level validation beyond what `writeDisplayName` already enforces, which stays application code, not policy |
| `P6-R08` | §17 (traceability) | `notice.read`/`notice.mark_read` close the residual half of `CBD-236-AC05`'s "server-obtained, never trusted from payloads" claim for the notices surface that `profile.read`'s reuse left open |
| `P6-R09` | Header status line | Records this amendment as proposed, pending Product Owner approval of `P6-R01`–`P6-R09` and a Security result, exactly as the header's v0.13 sentence already does for the primary-ownership-version amendment |

## 11. CBD-212 and CBD-73 sentences that change (routed to their owners, not applied here)

**CBD-212** (`docs/cbd-212-financial-profile-persistence-contract.md`) §3's `financial_profile` column table does not list `display_name` at all — the `M1` migration comment (§1.1; `packages/migrations/migrations/20260915T100000Z__…sql:205`) names CBD-212 as the amendment's target ("This is the CBD-212 amendment that section 14 routes to that document's owner"), but no CBD-212 revision realizing that routing has landed. The gap is independent of this proposal's cells — it exists whether or not `p6` is ever registered — and is reported here as `P6-F02` (§13) rather than silently left for a reader to notice. The sentence this proposal recommends CBD-212's owner add is a new row in §3's table: `display_name` \| `text NULL` \| `CBD-91 DI-91-065`; subject-owned; set by the subject through `profile.set_display_name` once this amendment releases; 1–80 code points or `NULL`; version bumped by the same compare-and-set §3's existing `version` row already documents for every other committed mutation.

**CBD-73** (`docs/cbd-73-invitation-consent-lifecycle-specification.md`) §13's `DR-73-11` row (mandatory lifecycle notice) documents the *data* `account_lifecycle_notice` carries but not the *API surface* that reads and marks it — that surface postdates §13's last revision. The sentence this proposal recommends CBD-73's owner add, as a footnote to the `DR-73-11` row or a new sentence in §13's lead-in, is: "The in-app instance is read and marked read through the `notice.read`/`notice.mark_read` CBD-236 `p6` subject-self cells (superseding the interim `profile.read` binding `PROTO-INVITATIONS-API-GAPS-001-RESULT` used); the mutation is bounded to `read_at` alone by the write-once trigger this table's own comment already states." Neither sentence is applied by this document; both are routed to their respective owners under `P6-D04`.

## 12. Security review scope

Security reviews the implementation candidate, not this document. The scope, so the review can be bounded:

1. **Provenance closure.** `subject.accountSubjectId` and `environment.environmentId` are `session_store`/`runtime_configuration`-only on all three new cells, exactly as the existing subject-self cells require (§4.2, subject-scoped column); confirm `P6-N01`/`P6-N02` run for all three and that `P6-N06` (forbidden resource section) denies for all three.
2. **The trigger stays defense in depth, not the only fence.** Confirm `notice.mark_read`'s `recheck_at_commit` obligation is actually discharged at commit (re-equality of the subject-scoped captured set) and that removing it would be caught by `P6-N03`; confirm the `forbid_account_lifecycle_notice_mutation` trigger is untouched by this amendment (§2 `P6-E04` makes no migration change).
3. **`profile.set_display_name` writes nothing PolicyInput does not already capture.** Confirm the route's `expectedVersion` for the compare-and-set is read from the same `profile.profileVersion` the decided input already carries (§2 `P6-E04`), not from a second, independently-read value that could race it.
4. **No new external surface for the length bound.** Confirm the `400` for a 0-length or >80-code-point display name carries no internal detail beyond the uniform denial vocabulary (`PR-94-003`), and that `writeDisplayName`'s `RangeError` message (which does name the bound, "1 to 80 code points") never reaches a response body verbatim if that would conflict with the closed external vocabulary — this is a route-mapping question for the implementation packet, flagged here rather than answered, because this document does not design HTTP error bodies.
5. **Inert denial.** Every §4 negative asserts no `cellRef`, no `capturedVersions`, `audit` only.
6. **No new external behaviour.** The display name itself is never part of `PolicyDecision`, the audit event, or any policy-log field (§11 of the contract) — it is ordinary application data read and written by the route, not an authorization fact beyond the version CBD-236 already captures.

Nothing in this amendment touches Plaid, PII beyond the display name itself (which is not a financial fact and already exists in the schema), secrets, retention, or a hosted environment.

## 13. Findings

| ID | Level | Finding |
| --- | --- | --- |
| `P6-F01` | 2 | No production code path calls `writeDisplayName` today; `financial_profile.display_name` is `NULL` for every subject and every "neutral label" fallback is always taken (§1.3). Design §9 (`IV-010`)'s "set at first sign-in from the provider's name claim" ceremony write does not exist in the merged code at `b1cdde0`. This amendment's `profile.set_display_name` cell would be the first caller, not a second; if a first-sign-in ceremony write is still wanted in addition to the subject-editable route, that is separate work this document does not propose |
| `P6-F02` | 2 | CBD-212 §3's column table does not list `financial_profile.display_name`, although the `M1` migration comment names CBD-212 as the amendment's owner-document. Reported so the gap is not first noticed by a reader of the migration file; §11 states the recommended sentence, routed to CBD-212's owner under `P6-D04` |
| `P6-F03` | 1 | CBD-73 §13's `DR-73-11` row documents the notice data shape but not the API surface (`notice.read`/`notice.mark_read`) that reads and marks it, because that surface postdates the row's last revision. §11 states the recommended sentence, routed to CBD-73's owner |
| `P6-F04` | 1 | This worktree's base revision (`b1cdde0`) predates the merge of `PROTO-INVITATIONS-API-GAPS-001-RESULT`'s PR #376, so `apps/api/src/notices/http.ts` and `packages/data-access/src/account-lifecycle-notice.ts` are read from that result record rather than verified directly in this worktree (§1.1). An implementation packet should re-verify every cited line number against the revision it actually starts from, particularly if PR #376 has been rebased or its review round changed line positions |

## 14. Revision history

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 0.1 | September 15, 2026 | Architecture, `PROTO-CONTRACTS-P6-SUBJECT-SELF-PROPOSAL-001` | Initial proposal: the two gaps as reported and what this worktree can and cannot verify directly (§1); the exact amendment (§2); the subject-self-versus-subject-target design fork (§3); the required negative fixtures with the two that do not belong in the contracts package explained (§4); the digest and `INPUT_SCHEMA_VERSION` impact, with no digest value fabricated (§5); the §8.9 cell/action/predicate tables (§6); route registrations on `rlp-266-mutation-v1` (§7); the release step in the `p5`-step shape, not applied (§8); five Executive decisions with recommendations (§9); nine CBD-236 revisions (§10); the CBD-212 and CBD-73 sentences that change, routed to their owners (§11); Security review scope (§12); four findings (§13). No code; no contract edit; no Jira or Confluence change | Proposed; Product Owner approval of `P6-R01`–`P6-R09` and a Security result required before an implementation packet is cut |
