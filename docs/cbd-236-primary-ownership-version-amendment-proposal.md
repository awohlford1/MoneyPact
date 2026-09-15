# CBD-236 — `space.primaryOwnershipVersion` input leaf: contracts amendment proposal

| Field | Value |
| --- | --- |
| Status | **Applied (0.2).** The Executive decided `POV-D01`–`POV-D06` as recommended (`EXEC-POV-C200F01-001`: `POV-OPT-C`), and the implementation packet `PROTO-CONTRACTS-POV-IMPL-001` applied `POV-E01`–`POV-E05` (`POV-E06` and `POV-E07` do not apply under `POV-OPT-C`), the nine negatives `POV-N01`–`POV-N09`, and the CBD-236 revisions `POV-R01`–`POV-R08` as v0.13 in one PR, with `POV-N01` proven to fail against the unchanged capture line before it passed and the `p1`–`p5` digests and release history unchanged. The v0.13 amendment awaits Product Owner and Security records before merge (§8). No policy cell, release-history row, or Jira change exists because of this document |
| Document version | 0.2 |
| Proposal identifiers | edits `POV-E01` through `POV-E07`; options `POV-OPT-A`, `POV-OPT-B`, `POV-OPT-C`; negative fixtures `POV-N01` through `POV-N09`; contract revisions `POV-R01` through `POV-R08`; decisions `POV-D01` through `POV-D06`; findings `POV-F01` through `POV-F04` |
| Owner | Alexander Wohlford |
| Jira subtask | [CBD-236](https://cobudget.atlassian.net/browse/CBD-236); the increment that raised the question is CBD-41 (CBD-274, CBD-275, CBD-276), CBD-280 and CBD-287 |
| Governing contract | `docs/cbd-236-authorization-policy-contract.md` \| Document version **0.14** (v0.13 is this proposal's `POV-R01`–`POV-R08` applied; §1–§10 were written against v0.12.2; v0.14 is the later, unrelated `p6` amendment, re-pinned here only mechanically by `PROTO-CONTRACTS-P6-IMPL-001` to keep `check-jira-freshness.py --offline` green) — §4.1, §4.2, §6 `PC-236-011`, `PC-236-013`, `PC-236-014`, `PC-236-015`, §6.1, §8.5.3, §9.3, §9.7, §12, §14 |
| Governing findings | `PK6-F01` (`PROTO-INVITATIONS-PK6-API-001-RESULT` r1), `SEC-PK6-R1` (`PROTO-INVITATIONS-PK6-SEC-001-RESULT` r1), `PK7B-F05` (`PROTO-INVITATIONS-PK7B-TRANSFER-API-001-RESULT` r3), `SEC-PK7B-R5` (`PROTO-INVITATIONS-PK7B-SEC-001-RESULT` r1); design question `OQ-IV-004` in `docs/cbd-234-invitations-consent-design-proposal.md` | Document version **0.1.2**\| Document version **0.1.1** §14 |
| Release-step precedent | `docs/cbd-236-p5-release-step.md` \| Document version **0.2.1** — the shape a policy-version release follows if `POV-OPT-A` is chosen |
| Merged behaviour read | `packages/contracts/src/authorization/input.ts`, `evaluate.ts`, `fixtures/index.ts`, `authorization.test.ts`, `policy/registry.ts`; `apps/api/src/authorization/facts.ts`, `boundary.ts`, `audit.ts`, `compatibility.ts`, `test-support.ts`; `apps/worker/src/authorization/facts.ts`, `jobs.ts`; `apps/api/src/sessions/budget-facts.ts`; `packages/budget-application/src/primary-transfer/commit.ts`; `packages/data-access/src/budget-space-primary-transfer.ts`; `packages/migrations/migrations/20260915T100000Z__widen_membership_and_consent_for_invitations.sql`; `config/authorization-policy-release-history.json` — all at `fcd9f10` on `main` |
| Milestone | `PROTOTYPE-SLICE-001` and `PROVIDERS-LOCAL-001` (Executive, September 12, 2026) |
| Repository baseline | `fcd9f10` on `main` |
| Written by | Architecture, assignment `PROTO-CONTRACTS-PRIMARY-OWNERSHIP-VERSION-001`, September 15, 2026 |
| Last updated | September 15, 2026 |

> **Authority.** CBD-236 v0.12.2 is the approved contract and this document changes nothing in it. It proposes an amendment (`POV-R01`–`POV-R08`) for the Product Owner and Security to approve under the same rule every earlier amendment followed, answers the schema-version question the PK-7B author could not answer, and puts the residual choices to the Executive. Where this document and the approved contract disagree, the contract wins and this document is wrong.

## 1. The defect as merged

CBD-236 §6.1 says `ApiUserCapturedVersions` is exactly `{ sessionVersion, subjectVersion, profileVersion, authorizationVersion, consentDisclosureVersion, spaceLifecycleVersion, primaryOwnershipVersion, targetVersion, policyVersion, policyDigest, inputSchemaVersion }`, and the M1 migration's column comment says `budget_space.primary_ownership_version` "is the datastore source of `ApiUserCapturedVersions.primaryOwnershipVersion`" (`packages/migrations/migrations/20260915T100000Z__widen_membership_and_consent_for_invitations.sql:106`). Neither is what the code does:

* `packages/contracts/src/authorization/evaluate.ts:143-148` builds the user captured set as `authorizationVersion: input.membership.authorizationVersion, … primaryOwnershipVersion: input.membership.authorizationVersion`. The two keys always hold the same number. `primaryOwnershipVersion` is an alias, not a dimension.
* `packages/contracts/src/authorization/input.ts:58` declares `interface Space { spaceId; lifecycle; lifecycleVersion; primaryOwnerMembershipId }` — no leaf for the column exists, so no assembler can supply it, and `expectedProvenance` (`evaluate.ts:79`) and `shapeValid` (`evaluate.ts:221`) know nothing of it.
* `apps/api/src/authorization/facts.ts:48-57` (mirrored byte-for-byte by `apps/worker/src/authorization/facts.ts`, enforced by `inventory.test.ts`) admits `space.spaceId space.lifecycle space.lifecycleVersion space.primaryOwnerMembershipId` from the datastore and nothing else under `space.`.
* `apps/api/src/sessions/budget-facts.ts:214-225` (`spaceFacts`) selects `budget_space_id, lifecycle, lifecycle_version, primary_owner_membership_id` and never reads `primary_ownership_version`, although the same row carries it (`NOT NULL DEFAULT 1`, `CHECK (>= 1)`).
* The `stale_primary_ownership_version` negative family (`fixtures/index.ts:248`, required by `authorization.test.ts:871`) mutates `capturedAtPrecheck.primaryOwnershipVersion` to 99 and observes `stale_version`. It proves the key is compared; it cannot prove the key carries the column, because no fixture can set the column.

PK-6 reported this as `PK6-F01` (`OQ-IV-004` not closable from PK-6), Security agreed in `SEC-PK6-R1` and made the both-memberships advance a PK-7B condition, PK-7B honoured the condition and reported the exact edits as `PK7B-F05`, and `SEC-PK7B-R5` ruled the alias security-neutral for that candidate and asked for a PK-1-class packet "with the `INPUT_SCHEMA_VERSION` question answered by the contract owner". This document is that answer.

## 2. Why the alias is safe today, and what it does not give

### 2.1 The PK-7B proof

The transfer commit (`packages/budget-application/src/primary-transfer/commit.ts`) advances every version the alias depends on inside one transaction, in a fixed order:

1. step 4a, `commit.ts:214-218`: `repository.updateMembershipRole(spaceId, proposer.membershipId, proposer.authorizationVersion, "co_owner")` — the former Primary's row moves to `authorization_version = expected + 1` conditioned on the expected value (`packages/data-access/src/budget-space-primary-transfer.ts:252-262`: `set: { role, authorization_version: nextVersion }` with `status = 'active'` and the expected version in the conditions);
2. step 4b, `commit.ts:220-224`: the same statement for the recipient, to `primary_owner`;
3. step 4c, `commit.ts:226-230`: `repository.movePrimaryOwnership(spaceId, recipient.membershipId, space.primaryOwnershipVersion)` — `budget_space.primary_owner_membership_id` moves and `primary_ownership_version = expected + 1`, conditioned on the expected value (`budget-space-primary-transfer.ts:305-315`).

A failure at any of the three throws `stale_version` and the transaction rolls back, so the three versions advance together or not at all. `SEC-PK7B-R5` observed the invariant live (harness C on real PostgreSQL: both memberships at `authorization_version` 2 and the space at `primary_ownership_version` 2 after one committed transfer), `transfer.live.test.ts:258-259` asserts the space row, and `SEC-PK6-R1` verified the PK-7A half (`commit.ts:206-214` at that revision).

Because both parties' `authorization_version` advances at every transfer commit, an in-flight non-read decision of either party captured before the commit denies `stale_version` at its own commit-time recheck: `evaluate.ts:242` compares the precheck capture set against a fresh capture (`sha256(capturedAtPrecheck) !== sha256(capturedVersions(input))`), and the aliased `primaryOwnershipVersion` differs because `authorizationVersion` differs.

### 2.2 The second, independent guard the alias does not rely on

The boundary compares more than the captured set. `apps/api/src/authorization/boundary.ts:116-124` re-assembles the input under the transaction, calls `decide`, and denies `stale_version` if `decision.inputDigest` differs from the precheck digest. `inputDigest` is `sha256(comparable(input))` (`evaluate.ts:21-29, 36`), where `comparable` strips only `provenance`, `evaluation.evaluatedAt` and `versions.capturedAtPrecheck`; every fact leaf stays in, including `space.primaryOwnerMembershipId` and `membership.authorizationVersion`. A transfer between precheck and commit therefore changes the digest for **every** member of the space — the two parties and every bystander Co-owner or Collaborator alike — because `space.primaryOwnerMembershipId` moved. The alias never had to cover the bystander case; the digest does.

### 2.3 What the alias does not give

The alias is a duplicate, so three things the contract promises are not true today:

* **§6.1 exactness.** The captured set names eleven keys but carries ten independent values. The record written into the audit event (`apps/api/src/authorization/audit.ts:49`, `capturedVersions` on every allow), the worker's `claimedVersions` (`apps/worker/src/authorization/jobs.ts:65-68`, which requires the key `primaryOwnershipVersion`), and any transported decision all carry a number that is not the column.
* **Independence from the transfer implementation.** Safety rests on `commit.ts` advancing both memberships. That is a condition Security imposed on one packet (`SEC-PK6-R1`), not a property the contracts package can prove, and a future path that moved `primary_owner_membership_id` without touching the memberships (a support tool, a migration, a different workflow) would leave the captured set blind while only the digest guard remained.
* **A testable negative.** No contracts fixture can express "the Primary changed; nothing else did". `POV-N01` in §5 is that fixture; it is impossible to write against the merged code.

So the amendment is a truth-and-defence-in-depth change, not a live exploit fix. `SEC-PK7B-R5`'s "security-neutral" ruling stands and nothing here asks PK-8 to wait (`POV-D05`).

## 3. The amendment, stated exactly

Every edit below is against `fcd9f10`. Line numbers are the merged lines; an implementation packet re-derives them after rebase. `POV-E01`–`POV-E06` are the six edits `PK7B-F05` listed, with the sites it did not name added where the code has them. `POV-E07` applies only under `POV-OPT-A` (§4).

### `POV-E01` — `input.ts`: the `Space` shape

`packages/contracts/src/authorization/input.ts:58` becomes:

```ts
interface Space {
  spaceId: OpaqueId; lifecycle: "live" | "archived" | "deletion_pending" | "purged"; lifecycleVersion: number;
  primaryOwnerMembershipId: OpaqueId;
  /** budget_space.primary_ownership_version (CBD-73 TR-73-43, M1): advanced only by the transfer commit; captured as
   * primaryOwnershipVersion for every non-read user decision (contract section 6.1). */
  primaryOwnershipVersion: number;
}
```

The leaf is **required**, not optional (`POV-OPT-B` is rejected in §4). `Space` is shared by `ApiOrdinaryUserPolicyInput`, `WorkerUserDelegatedPolicyInput` and `WorkerServicePolicyInput` (`input.ts:77, 101, 107`), so the service variant carries the leaf too; the recommendation is to keep one shape (`POV-D02`) and leave `ServiceCapturedVersions` (`input.ts:37-41`) untouched, exactly as `space.primaryOwnerMembershipId` is carried by the service input today and captured by nothing. The alternative — splitting `Space` into a user shape with the leaf and a service shape without — saves one fixture line and costs a variant-conditional provenance rule; it is not recommended.

`ApiUserCapturedVersions` (`input.ts:24-29`) does not change: the key already exists.

### `POV-E02` — `evaluate.ts`: capture, provenance, shape

Three lines:

1. `evaluate.ts:146`: `primaryOwnershipVersion: input.membership.authorizationVersion` becomes `primaryOwnershipVersion: input.space.primaryOwnershipVersion`. This is the whole behavioural change.
2. `evaluate.ts:79`: `add(result, "datastore", "space.spaceId", "space.lifecycle", "space.lifecycleVersion", "space.primaryOwnerMembershipId")` gains `"space.primaryOwnershipVersion"`. This line sits in the branch shared by the ordinary-user, worker-user and service variants, so one edit covers all three; the bootstrap and subject-scoped branches (`evaluate.ts:68-77`) carry no `space` section and need nothing. Because `provenanceValid` (`evaluate.ts:113-126`) requires the expected key set, the actual provenance key set and the present-leaf set to be equal, this one line makes the leaf required at `decide`: an input without it, or with it stamped from any source but `datastore`, denies `input_invalid`.
3. `evaluate.ts:221`: the ordinary-input integer list `[input.membership.authorizationVersion, input.consent.disclosureVersion, input.space.lifecycleVersion, input.resource.version].every(isPositiveInteger)` gains `input.space.primaryOwnershipVersion`; `evaluate.ts:193` (the service list, which already checks `input.space.lifecycleVersion`) gains the same element under `POV-D02`. `isPositiveInteger` admits 0 (`evaluate.ts:13`); the column's `CHECK (>= 1)` is the stricter bound and stays in the datastore.

Nothing else in `evaluate.ts` changes: the `stale_version` compare at `:242`, the `Primary` notation predicate at `:290` (which reads `space.primaryOwnerMembershipId`, not the version), `capturedVersions` for the service, bootstrap and subject-scoped variants, and every obligation are untouched. `bind_cache_key` (`evaluate.ts:160`) keeps `["spaceId", "authorizationVersion", "policyVersion"]`; adding `primaryOwnershipVersion` to it is a separate, larger decision (`POV-F04`) and is not proposed here.

### `POV-E03` — fixtures

`packages/contracts/src/authorization/fixtures/index.ts` has three `space` literals, not the one `PK7B-F05` named:

* `:22` (`ordinaryFixture`): `space: { spaceId: "space-1", lifecycle: "live", lifecycleVersion: 1, primaryOwnerMembershipId: "membership-1", primaryOwnershipVersion: 1 }`;
* `:49` (`serviceFixture`): the same addition under `POV-D02`;
* `:176` (`FORBIDDEN_SUBJECT_SECTIONS.space`, the populated forbidden section injected into subject-scoped negatives): the same addition, so the "populated" injection stays a complete row.

The value 1 is deliberate: `authorization.test.ts:373, 524, 751` assert the exact captured record with `primaryOwnershipVersion: 1`, and with the fixture at 1 those assertions stay byte-identical while now proving the column rather than the alias. Every fixture that spreads `...positive.space` or `...base.space` (`authorization.test.ts:406, 567, 888`; `apps/api/src/invitations/http.test.ts:71`; `apps/api/src/primary-transfer/http.test.ts:70`) inherits the leaf without an edit. The version-derived catalogs (`userCatalog`, `spaceBoundNegatives`, `subjectNegatives`, `assuranceNegativeFixtures`) regenerate from the fixture and need no change beyond §5.

### `POV-E04` — `facts.ts` allowlist, api and worker

`apps/api/src/authorization/facts.ts:50` becomes `space.spaceId space.lifecycle space.lifecycleVersion space.primaryOwnerMembershipId space.primaryOwnershipVersion`, and `apps/worker/src/authorization/facts.ts:50` receives the identical byte change (the inventory parity test requires it). Nothing else in the assembler changes:

* `validLeaf` (`facts.ts:82-86`) already validates any path ending in `Version` as a safe non-negative integer, so the new leaf is checked on arrival;
* the bootstrap skip (`facts.ts:155`, `/^(space|membership|consent|resource)\./`) and the subject-scoped filter (`facts.ts:59, 157`, `SUBJECT_SCOPED_DATASTORE` admits only `subject.`, `profile.` and five `resource.` leaves) already exclude it from the variants that must not carry it;
* the post-assembly check (`facts.ts:198-202`) already fails `input_invalid` when an expected `datastore` leaf was not produced, so an api build carrying `POV-E02` without `POV-E05` denies every ordinary decision rather than allowing one.

The worker's production fact source is `absentFactSource` (`apps/worker/src/authorization/jobs.ts:136`), so the worker denies every job today and keeps doing so; its cost from this amendment is the mirrored line. `jobs.ts:65-68` already requires `primaryOwnershipVersion` in `claimedVersions` and does not change. `test-support.ts` in both applications derives its datastore facts from `expectedProvenance(this.input)` (`apps/api/src/authorization/test-support.ts:54`) and emits the leaf automatically once the fixtures carry it.

### `POV-E05` — `budget-facts.ts`: `spaceFacts`

`apps/api/src/sessions/budget-facts.ts:219` adds `"primary_ownership_version"` to the `budget_space` column list, and after `:225` adds:

```ts
facts["space.primaryOwnershipVersion"] = integer(space.primary_ownership_version);
```

`integer` (`budget-facts.ts:140-144`) returns `undefined` for anything that is not a safe integer or a decimal string, and an `undefined` leaf is dropped by `Object.hasOwn`/`validLeaf` in the assembler and denies `input_invalid` at `decide`. The read is the same `tenantSelect` that returns `primary_owner_membership_id`, on the same row, under the same transaction at commit (`boundary.ts:118` passes the transaction through `assemble`), so the membership identifier and its version are never read at two different moments. No other production fact source emits `space.` leaves (`apps/api/src/sessions/fact-source.ts` reads subject, profile and assurance and delegates the rest to `budget.facts`), so this is the only datastore edit. `budget-facts.test.ts` gains the assertion in `POV-N08`.

### `POV-E06` — `INPUT_SCHEMA_VERSION`

`packages/contracts/src/authorization/input.ts:1` (`export const INPUT_SCHEMA_VERSION = 1 as const;`) changes only under `POV-OPT-A`. Section 4 decides; the recommendation (`POV-OPT-C`) leaves it at 1.

### `POV-E07` — the literal sites a schema-version bump also touches (`POV-OPT-A` only)

`PK7B-F05` listed `input.ts:1` as the one schema-version site. The repository has more, every one a literal `1` rather than an import of `INPUT_SCHEMA_VERSION`:

| Site | Literal | Consequence if left at 1 after a bump |
| --- | --- | --- |
| `apps/api/src/authorization/facts.ts:147` and the worker mirror | `evaluation: { adapter, inputSchemaVersion: 1, evaluatedAt }` | `safeInput` (`evaluate.ts:180`) denies every decision `input_invalid`; both applications are fail-closed and unusable |
| `apps/api/src/authorization/audit.ts:47` and the worker mirror | `inputSchemaVersion: 1` on every `PolicyAuditEvent` | audit rows misreport the schema |
| `apps/api/src/budget-creation/http.ts:71` | `inputSchemaVersion: 1` in the confirmation outcome (`packages/budget-application/src/creation-confirmation/index.ts:36`; `apps/web/src/api/proposals.ts:39`) | a persisted creation record misreports the schema |
| `apps/api/src/authorization/compatibility.ts:10` and the worker mirror | `SUPPORTED_POLICY_TUPLES` `schemaVersion: 1` | startup refuses (`policy_version_unsupported`) until the tuple names the released row that carries 2 |
| `packages/contracts/src/authorization/policy/registry.ts:17` | `serialization()` hard-codes `schemaVersion: 1` for **every** registered version | see `POV-F01`: a bump needs a per-version schema value, and because the digest covers `schemaVersion`, the bumped version is necessarily a new registered version |
| `packages/contracts/src/authorization/fixtures/index.ts:31, 42, 54, 84` | `inputSchemaVersion: 1` in the four fixture builders | every fixture denies `input_invalid` |
| `packages/contracts/src/authorization/authorization.test.ts:71, 196, 222, 344, 373, 488, 524, 714, 751, 811` and `apps/api/src/authorization/boundary.test.ts:155-191`, `apps/worker/src/authorization/jobs.test.ts:130` | exact-record and mismatch assertions | test edits, one per literal |

None of these sites changes under `POV-OPT-C`.

## 4. The `INPUT_SCHEMA_VERSION` question

### 4.1 What the version actually guards

§4.1 says `evaluation.inputSchemaVersion` "rejects an assembler built against another schema", and §12 says "changing the `PolicyInput` schema is a `schemaVersion` bump that both applications must pin in an exact supported tuple before deployment". Two mechanisms carry that: `decide` compares `input.evaluation.inputSchemaVersion` with the package constant (`evaluate.ts:180, 239`), and the startup guard compares the application tuple's `schemaVersion` with the registered policy's `schemaVersion` and with the release-history row (`compatibility.ts:29, 35`; `policyCompatibility`, `registry.ts:44-47`).

Two facts the earlier findings did not have:

* **The registry digest covers `schemaVersion`.** `registry.ts:16-18` serialises `{ version, schemaVersion: 1, actionDefinitions, userCells, serviceCells }` and `scripts/check-authorization-policy-history.mjs:34-36` recomputes that digest and separately requires `policy.schemaVersion === row.schemaVersion`. The `p5` row pins digest `68eef40b…2fec8` with `schemaVersion` 1 and released rows are immutable (`PC-236-011`). Therefore `p5` can never carry `schemaVersion` 2: a schema bump is a **new registered policy version** (`p6`, cells identical to `p5`) with its own digest, its own append-only row, its own two approvals and its own release step. `PK7B-F05`'s "schema version 2 and a release-history row" is that, in full (`POV-F01`).
* **The contract already draws an additive line.** §8.5.3 kept `schemaVersion` 1 when `p2` added a whole input variant and two `ResourceType` members, reasoning that "a bump would fail the closed `apps/api` and `apps/worker` adapters at startup for no protective gain, and a `p1` assembler cannot produce the new variant"; `p5` repeated it for `invitation` and `invitation_ceremony` (`policy/v5.ts:27-28`). The line is: does an assembler built against the old schema produce an input that the new evaluator would wrongly **allow**? For a new required datastore leaf the answer is no — an old assembler's input lacks the leaf, `provenanceValid` sees an expected key with no present leaf, and the decision is `input_invalid` (§3, `POV-E02` item 2; `POV-N02`). The assembler and the evaluator are also the same commit of one repository (`@cobudget/contracts` is a workspace package, not a published one), so the "assembler built against another schema" the version exists to reject cannot be deployed at all.

### 4.2 The options, costed

| | `POV-OPT-A` — required leaf, `INPUT_SCHEMA_VERSION` 2, new policy version | `POV-OPT-B` — optional leaf, alias fallback for one version | `POV-OPT-C` — required leaf, `INPUT_SCHEMA_VERSION` stays 1, additive-in-lockstep rule written into the contract |
| --- | --- | --- | --- |
| Contracts edits | `POV-E01`–`POV-E03`, `POV-E06`; `registry.ts` gains a per-version `schemaVersion` (`p1`–`p5` stay 1, `p6` is 2); `policy/v6.ts` re-exporting the `p5` tables under `schemaVersion` 2; `P6_DIGEST`; `P6_FIXTURES` and `P6_NEGATIVE_FIXTURES` (version-derived, one catalog block each) | `POV-E01` with `primaryOwnershipVersion?: number`; `evaluate.ts:146` becomes `input.space.primaryOwnershipVersion ?? input.membership.authorizationVersion`; `evaluate.ts:79` adds the leaf only when present (the `viewerProfile` pattern at `:87`); `:221` conditional | `POV-E01`–`POV-E05` exactly as §3 |
| Application edits | `POV-E04`, `POV-E05`, every `POV-E07` site in both applications, `SUPPORTED_POLICY_TUPLES` to `p6`/`2`, `facts.ts:146` and `jobs.ts:71` policy literals to `p6` | `POV-E04`, `POV-E05` | `POV-E04`, `POV-E05` |
| Released versions affected | `p1`–`p5` digests unchanged and still pinned; `p6` released and deployed; `p5` released and no longer current | none | none: `p5` stays current; its row stays true (the row pins cells and a schema label, not the leaf list) |
| Release records | a `p6` release-history row with `productApprovalRef` and `securityApprovalRef`, a `docs/cbd-236-p6-release-step.md`, a Manager-applied release commit with the flip (`CBD236-POLICY-APPROVAL-001`) | none | none |
| Contract revisions | `POV-R01`–`POV-R08` plus a new §8.9 (`p6`), §8.9.4 release step, §9.8, and §12 rows for `p6` | `POV-R01`, `POV-R02`, `POV-R06`, `POV-R08` with the leaf marked optional; a second amendment later to make it required | `POV-R01`–`POV-R08` |
| Tests | every §5 negative; every `POV-E07` literal; the `boundary.test.ts` released-row assertions gain `released[5]`; the `p6` catalog runs under `decideUnderRegisteredVersion` before the flip and under `decide` after | `POV-N01`, `POV-N03`–`POV-N05`, `POV-N08`, `POV-N09` only — `POV-N02` (missing leaf denies) **cannot be written**, and `POV-N01` must be duplicated in an "absent leaf" form that proves the fallback | every §5 negative |
| Worker parity | `facts.ts`, `audit.ts`, `compatibility.ts` mirrors plus `jobs.ts:71` | `facts.ts` mirror | `facts.ts` mirror |
| What it buys | the letter of §12; a startup refusal if an application were ever built against a contracts package with a different input schema | the smallest diff; a live path that keeps working if `POV-E05` were missing | the column in every captured set, audit event, claimed-versions record and transported decision from the day it merges; a testable "required" property; no release ceremony |
| What it costs beyond the diff | two approval records, a release step and a Manager release commit for a version with no cell change; `p5` becomes a released-never-current row like `p4`; every future version bump also has to carry the `schemaVersion` it was registered under | a silent fallback (the property the provenance design exists to forbid: a missing authority fact that does not deny); the deferred bump still has to happen, so the total cost is `POV-OPT-C` plus this diff plus a second review | the Product Owner and Security must accept the additive-in-lockstep reading in `POV-R06`, which narrows what `inputSchemaVersion` is for |

### 4.3 Recommendation

**`POV-OPT-C`.** The leaf is required; `INPUT_SCHEMA_VERSION` stays 1; the contract gains the rule that a datastore leaf added to an existing variant, whose only producers are the in-repository assemblers deployed in the same commit, is additive under §8.5.3 because an assembler that does not produce it denies `input_invalid` rather than allowing (`POV-R06`). This is the same reasoning the contract already recorded at v0.5 and v0.11, it keeps `p5` current and truthful, and it delivers the whole protective content of the amendment with the six edits and their tests.

`POV-OPT-B` is rejected: an optional authority leaf with a silent fallback cannot be proven required, which is the one property this amendment exists to add, and it defers rather than avoids the schema question.

`POV-OPT-A` is the right shape **if** the Executive holds that any change to a required leaf set must move the label regardless of protective gain. It is not wrong; it is a `p6` release for a version with no cell change. If chosen, the packet follows `docs/cbd-236-p5-release-step.md` §4.3–§4.4 for the literal inventory and adds the `POV-E07` rows above, and the `registry.ts` refactor in `POV-F01` is a prerequisite.

## 5. Negative fixtures the packet must add

All in `packages/contracts/src/authorization/fixtures/index.ts` unless stated; every entry evaluates under the current version, must deny inertly with the stated class (`PC-236-018`: no `cellRef`, no `capturedVersions`, no obligation other than `audit`), and the `required` family list at `authorization.test.ts:871` grows by the new family names so a cell cannot omit them.

| ID | Family | Construction | Expected | What it proves |
| --- | --- | --- | --- | --- |
| `POV-N01` | `stale_primary_ownership_column` (space-bound, every cell in `spaceBoundNegatives`) | positive input with `versions.capturedAtPrecheck` = the precheck capture and `space.primaryOwnershipVersion: 2` in the input, `membership.authorizationVersion` unchanged at 1 | `stale_version` | the column moved and nothing else did; **allows** against the merged alias, so it is the discriminating fixture for `POV-E02` item 1 |
| `POV-N02` | `missing_primary_ownership_version` (space-bound, every cell) | positive with `space.primaryOwnershipVersion` deleted and provenance restamped from the remaining leaves | `input_invalid` | the leaf is required; impossible under `POV-OPT-B` |
| `POV-N03` | `client_asserted_primary_ownership_version` (space-bound, every cell) | positive with `provenance["space.primaryOwnershipVersion"] = "request_locator"` | `input_invalid` | already generated by the every-leaf provenance loops (`authorization.test.ts:131-133, 842-844`); named so the family is visible cell by cell |
| `POV-N04` | `malformed_primary_ownership_version` | `space.primaryOwnershipVersion` as `"2"`, `-1` and `1.5`, provenance intact | `input_invalid` | `POV-E02` item 3 |
| `POV-N05` | `independent_capture` (positive, not a negative) | `membership.authorizationVersion: 1`, `space.primaryOwnershipVersion: 7`, no `capturedAtPrecheck` | `allow` with `capturedVersions.authorizationVersion === 1` and `capturedVersions.primaryOwnershipVersion === 7` | the two keys are independent dimensions; false against the alias |
| `POV-N06` | service variant (under `POV-D02`) | `serviceFixture` with the leaf deleted; and the positive service decision's `capturedVersions` key set | `input_invalid`; the service key set is exactly §6.1's ten keys and does **not** gain `primaryOwnershipVersion` | the leaf is carried but not captured by the service variant |
| `POV-N07` | subject-scoped and bootstrap shapes | `FORBIDDEN_SUBJECT_SECTIONS.space` now includes the leaf (`POV-E03`); `bootstrapFixture` plus a `space: { primaryOwnershipVersion: 1 }` section | `input_invalid` both | the leaf gives no variant a new way in |
| `POV-N08` | `apps/api/src/sessions/budget-facts.test.ts` | `spaceFacts` over a seeded `budget_space` row with `primary_ownership_version` 3 | `facts["space.primaryOwnershipVersion"] === 3`; a non-integer column value yields no leaf | `POV-E05` |
| `POV-N09` | `apps/api/src/primary-transfer/transfer.live.test.ts` (or `boundary` live suite) | a bystander Collaborator's non-read decision prechecked before a committed transfer and rechecked after it | `stale_version`, with the restricted audit event's `capturedVersions.primaryOwnershipVersion` equal to the pre-transfer column value | end to end: the captured set, not only the digest, observes a transfer for a member whose own `authorization_version` did not move |

`POV-N09` denies today as well (§2.2, through the digest); its assertion on the audit record's captured value is what distinguishes the column from the alias live.

## 6. Security review scope

Security reviews the implementation candidate, not this document. The scope, so the review can be bounded:

1. **Provenance closure.** `space.primaryOwnershipVersion` is `datastore`-only on every variant that carries `space` (`POV-E02` item 2); no request, envelope, cookie, header or runtime-configuration path can supply it (`facts.ts` `producers` map, `:61-68`, lists it under `datastore` only). Confirm `POV-N03` runs for every space-bound cell and that the subject-scoped and bootstrap variants still reject a `space` section (`POV-N07`, `SEC-P2-F5` precedent).
2. **Same-row, same-transaction read.** `POV-E05` reads the version from the statement that returns `primary_owner_membership_id`; there is no second read the `Primary` notation predicate (`evaluate.ts:290`) could disagree with. Confirm the commit-time re-assembly (`boundary.ts:118`) passes the transaction handle so the read is inside the protected transaction.
3. **The invariant Security already imposed.** `SEC-PK6-R1`'s condition — every transfer commit advances both parties' `authorization_version` — stays a standing requirement (`POV-D06`). The new leaf adds a dimension; it does not license removing one. Confirm no test relaxes `transfer.live.test.ts` or `primary-transfer.live.test.ts` on the membership versions.
4. **Inert denial.** Every §5 negative asserts no `capturedVersions`, no `cellRef`, `audit` only; the api and worker restricted-audit paths write the deny with the §11 allowlist unchanged (the allowlist already carries `capturedVersions` for an allow; no new field).
5. **Parity.** `inventory.test.ts` still proves `apps/worker/src/authorization/facts.ts` byte-identical; the worker's `absentFactSource` still denies every job.
6. **No new external behaviour.** The external denial class is unchanged; no response, log or telemetry field gains the version. The audit event already carried the key.
7. **Under `POV-OPT-A` only:** the `p6` digest reproduces from the branch, `p1`–`p5` digests are byte-identical to their rows, the per-version `schemaVersion` refactor (`POV-F01`) leaves the five pinned serialisations unchanged, and both startup guards refuse a tuple naming `p5` after the flip.

Nothing in this amendment touches Plaid, PII, secrets, retention or a hosted environment.

## 7. CBD-236 revisions proposed (the contract owner applies; nothing here edits the contract)

| ID | Section | Revision |
| --- | --- | --- |
| `POV-R01` | §4.1 | New row after `space.primaryOwnerMembershipId`: `space` \| `primaryOwnershipVersion` \| integer \| datastore \| CBD-73 `TR-73-43`; `budget_space.primary_ownership_version` (M1); advanced only by the transfer commit; captured as `primaryOwnershipVersion` for every non-read user decision (§6.1); present on every variant that carries `space` |
| `POV-R02` | §4.2 table | The `space.*` row gains `space.primaryOwnershipVersion` with `datastore` in the API ordinary-user, worker user-delegated and worker service columns (`POV-D02`) |
| `POV-R03` | §6.1 | After the `ApiUserCapturedVersions` sentence: "`primaryOwnershipVersion` is captured from `space.primaryOwnershipVersion`. Through v0.12.2 the merged evaluator captured `membership.authorizationVersion` under both keys (`PK6-F01`, `PK7B-F05`); the alias was safe because every transfer commit advances both parties' `authorization_version` in the same transaction as `primary_ownership_version` (`SEC-PK6-R1`, `SEC-PK7B-R5`) and because the §6 step-3 digest comparison covers `space.primaryOwnerMembershipId` for every member, and it is retired by this amendment." `ServiceCapturedVersions` sentence gains: "The service input carries `space.primaryOwnershipVersion` and does not capture it." |
| `POV-R04` | §6 `PC-236-015` | Add: "`space.primaryOwnershipVersion` increments only in the transfer commit, in the same transaction as both parties' `authorizationVersion`; a path that moves `space.primaryOwnerMembershipId` without advancing it is a defect." |
| `POV-R05` | §9.3 and §9.7 | The stale-version family row in §9.3 already lists `primaryOwnershipVersion`; §9.7's table gains the `POV-N01`–`POV-N04` families with their reason classes, and a sentence that the space-bound generator emits them for every space-bound cell in every version from the amendment on |
| `POV-R06` | §8.5.3 precedent, restated once in §6 under `PC-236-011` (`POV-OPT-C` only) | "A datastore leaf added to an existing variant is additive and does not move `schemaVersion` or `INPUT_SCHEMA_VERSION` when (a) its only producers are the assemblers in this repository deployed in the same commit as the contracts package and (b) an assembler that does not produce it denies `input_invalid` under §4.2 rather than allowing. A change that lets an older assembler's input allow, or that removes or retypes a leaf, is a bump and is a new registered version because the registry digest covers `schemaVersion`." Under `POV-OPT-A` the sentence instead records the `p6` bump and its reason |
| `POV-R07` | §12 | New row: "`PK-7B` contracts amendment (`space.primaryOwnershipVersion`)" — what changes: the leaf on every space-bearing variant, the capture at §6.1, the api datastore allowlist and `spaceFacts`, the worker `facts.ts` mirror; compatibility rule: additive under `POV-R06` (`POV-OPT-C`) or `p6` under §8.9 (`POV-OPT-A`); no route, handler, cell or obligation changes; PK-8 does not depend on it |
| `POV-R08` | §14 and §18 | `OQ-236-014`: "Does a required datastore leaf added to an existing input variant move `INPUT_SCHEMA_VERSION`?" — closed by the Executive decision on `POV-D01`, citing this document; a §18 row for the amendment (v0.13) naming the Product Owner and Security approvals it requires before the implementation packet merges |

## 8. Packet shape

One PK-1-class implementation packet, one worktree, one PR, because the six edits cannot be split: `POV-E02` without `POV-E05` makes every api decision deny, `POV-E04` without its worker mirror fails `inventory.test.ts`, and `POV-E03` without `POV-E01` fails `tsc`. Order inside the packet: `POV-E01`–`POV-E03` and the §5 contracts negatives first (`npm test --workspace=@cobudget/contracts`; `POV-N01` must fail against the unchanged `evaluate.ts:146` before it passes — a guard is not finished until a deliberate violation has failed it); then `POV-E04`, `POV-E05`, `POV-N08`; then `POV-N09` live. The packet's write scope is exactly `packages/contracts/src/authorization/{input,evaluate}.ts`, `fixtures/index.ts`, `authorization.test.ts`, `apps/api/src/authorization/facts.ts`, `apps/worker/src/authorization/facts.ts`, `apps/api/src/sessions/budget-facts.ts` and its test, one live test, and the CBD-236 revisions `POV-R01`–`POV-R08` in the same PR (the contract and the code it describes should not diverge across a merge). Under `POV-OPT-A` the packet additionally carries `policy/v6.ts`, the `registry.ts` refactor, the `POV-E07` sites, `docs/cbd-236-p6-release-step.md` and the §8.9 text, and the release itself is a second, Manager-applied commit after the two approval records exist.

Approvals before merge under `POV-OPT-C`: Product Owner approval of the v0.13 contract amendment (`POV-R01`–`POV-R08`) and a Security result on the candidate with the §6 scope, both as records; no release-history row. Under `POV-OPT-A`: the same two, plus the `p6` row's two references, which may be the same two records if they name the `p6` digest.

PK-8 (the ceremony walkthrough over the merged PK-6 and PK-7B routes) does not depend on any of this and should not wait (`SEC-PK7B-R5`, `PK7B-F05`; `POV-D05`).

## 9. Decisions for the Executive

| ID | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| `POV-D01` | Schema-version handling: `POV-OPT-A`, `POV-OPT-B` or `POV-OPT-C` | **`POV-OPT-C`** | §4.3; `POV-OPT-B` is unprovable; `POV-OPT-A` is a `p6` release with no cell change, correct only if the label must move on principle |
| `POV-D02` | Does the service variant carry the leaf (one shared `Space` shape) or not (split shapes)? | **Shared shape; carried, not captured** | one provenance line, one §4.2 row, no variant-conditional rule; `ServiceCapturedVersions` stays exact |
| `POV-D03` | Is the leaf required or optional? | **Required** | the only testable form (`POV-N02`); already implied by `POV-D01` |
| `POV-D04` | Do the CBD-236 revisions `POV-R01`–`POV-R08` travel in the implementation PR or in a separate documentation PR? | **Same PR**, applied by the implementation packet under the contract owner's text, with the Product Owner approval recorded against that exact diff | the contract must not describe an alias the code no longer has, or a column the code does not read |
| `POV-D05` | Does PK-8 wait for this amendment? | **No** | security-neutral today (`SEC-PK7B-R5`); PK-8 exercises routes, not the captured set |
| `POV-D06` | Does the both-memberships advance at every transfer commit remain a standing condition after the leaf exists? | **Yes, and write it into `PC-236-015` (`POV-R04`)** | the leaf adds a dimension; the membership versions are what invalidate the parties' own caches and derived surfaces (`bind_cache_key` keys on `authorizationVersion`, `evaluate.ts:160`) |

## 10. Findings

| ID | Level | Finding |
| --- | --- | --- |
| `POV-F01` | 2 | `registry.ts:17` hard-codes `schemaVersion: 1` into every registered version's serialisation and the digest covers it, so `INPUT_SCHEMA_VERSION` 2 cannot be released under `p5`: it is a new registered version with a new digest, row and release step. `PK7B-F05` and the packet costed "schema version 2 and a release-history row" as one row on the existing version; it is a `p6`. Reported so `POV-OPT-A` is costed truthfully; no action under `POV-OPT-C` |
| `POV-F02` | 2 | Seven production and fixture sites carry the literal `1` instead of importing `INPUT_SCHEMA_VERSION` (`POV-E07`). Under `POV-OPT-C` nothing changes; a follow-up that derives `facts.ts:147`, `audit.ts:47`, the four fixture builders and `budget-creation/http.ts:71` from the constant would make any future bump a one-line change and is the same cleanup the p2–p5 release steps named for the policy-version literals (`docs/cbd-236-p5-release-step.md` §4.3) |
| `POV-F03` | 1 | The merged `stale_primary_ownership_version` negative (`fixtures/index.ts:248`) is a captured-set mutation and passes against the alias; it stays, but it must not be read as evidence that the column is captured. `POV-N01` and `POV-N05` are that evidence |
| `POV-F04` | 1 | `bind_cache_key` (`evaluate.ts:160`) keys derived surfaces on `spaceId`, `authorizationVersion` and `policyVersion` only. For the two transfer parties `authorizationVersion` moves, so their derived surfaces invalidate; a bystander's surface that displayed who the Primary is would not. The prototype keeps no such cache; recorded for the packet that introduces one, not proposed here |

## 11. Revision history

| Version | Date | Author | Change | Status |
| --- | --- | --- | --- | --- |
| 0.2 | September 15, 2026 | Implementation, `PROTO-CONTRACTS-POV-IMPL-001` | Status set to applied: `EXEC-POV-C200F01-001` chose `POV-OPT-C` and accepted `POV-D02`–`POV-D06` as recommended; `POV-E01`–`POV-E05`, `POV-N01`–`POV-N09` and `POV-R01`–`POV-R08` (CBD-236 v0.13) applied in one PR. `POV-N09` is written as `apps/api/src/primary-transfer/ownership-version.live.test.ts` (a second composed application on another local issuer supplies the third, bystander subject; its precheck is held across the transfer committed over HTTP); because a denial is inert (`PC-236-018`), the pre-transfer column value is asserted on the held precheck's captured record and on the restricted allow events before and after the transfer, and the denial event is asserted to carry no captured set. No text of §1–§10 changed | Applied; the contract amendment's approvals are tracked in CBD-236 §18 |
| 0.1 | September 15, 2026 | Architecture, `PROTO-CONTRACTS-PRIMARY-OWNERSHIP-VERSION-001` | Initial proposal: the defect as merged with line citations (§1); the alias's safety argument from the PK-7B proof and the independent digest guard, and what the alias does not give (§2); the six `PK7B-F05` edits stated exactly with the sites it did not name (`POV-E01`–`POV-E06`) and the schema-bump literal inventory (`POV-E07`) (§3); the `INPUT_SCHEMA_VERSION` question with three costed options and the `POV-OPT-C` recommendation (§4); nine negative fixtures (§5); the Security review scope (§6); eight CBD-236 revisions (§7); packet shape (§8); six Executive decisions with recommendations (§9); four findings (§10). No code; no contract edit; no Jira or Confluence change. | Proposed; Executive decision on `POV-D01`–`POV-D06` required before the implementation packet is cut |
