# CBD-236 — Policy version 6 release step

| Field | Value |
| --- | --- |
| Status | **Applied** — `releaseCommit` `2b16c870b7a757c4ee50668b60fba4a2e4e34f0b` (the merge commit of PR #382, `feat/contracts-p6-tables`); `p6` is released and current under `PO-P6-APPROVAL-001` and `PROTO-CONTRACTS-P6-SEC-001-RESULT`, applied by the Manager from branch `chore/release-policy-p6` (`PROTO-CONTRACTS-P6-SPLIT-001`) |
| Document version | 0.1 |
| Governing contract | [`docs/cbd-236-authorization-policy-contract.md`](./cbd-236-authorization-policy-contract.md) v0.14 §6 `PC-236-011`, `PC-236-013`, §8.9 |
| Governing decisions | `EXEC-P6-RULINGS-001` (`P6-D01`–`P6-D05`; `P6-D05` releases `p6` immediately once its two approvals exist, no extended "registered and not current" interval); `CBD236-POLICY-APPROVAL-001` (Product Owner and Security sign-off cited in every released row); `PROTO-POLICY-V2-DECISION-001` precedent (add a version through an implementation packet and a following Security review; release requires both approvals as separate records) |
| Jira subtask | [CBD-236](https://cobudget.atlassian.net/browse/CBD-236); the increment is the PK-8 gap-closure pass (CBD-41 family) |
| Written by | Implementation, assignment `PROTO-CONTRACTS-P6-SPLIT-001`, September 15, 2026 |
| Applied by | Implementation on branch `chore/release-policy-p6`, then rebased onto `main` and its `releaseCommit` filled in by the Manager after `feat/contracts-p6-tables`'s PR merges |

## 1. What this step does and does not do

It releases policy version `p6` as the current deployed policy. It does not add or change a cell: `p6` is
already registered next to `p1`–`p5` in `packages/contracts/src/authorization/policy/registry.ts` with its own
digest (`docs/cbd-236-authorization-policy-contract.md` §8.9, applied by `feat/contracts-p6-tables`), and the
contracts tests already prove the three `p6` cells and their negative families
(`npm test --workspace=@cobudget/contracts`). No evaluator change (contrast `p5`'s §8.8.2 assurance-predicate
refactor); this step does not touch `evaluate.ts`.

`p6` releases more simply than `p5` did: `p5` is already released and current, so there is no
"prior-version-first-or-combined" complication `docs/cbd-236-p5-release-step.md` §1 describes for `p4`/`p5` —
`p6` registers directly above the already-released `p5` and its release is a single append.

Until this step lands, `decide` denies any `p6` input `policy_version_unsupported`, `policyCompatibility` is
false for `p6`, both applications start against `p5`, and a `p6`-only code in a `p5` input denies
`input_unsupported` (proved on `feat/contracts-p6-tables` by `authorization.test.ts`'s `POLICY-V6-03`). Nothing
below may be applied piecemeal: a history row without the flip leaves a version released but undeployed, and
the flip without the row makes the API and worker refuse to start (`policy_version_unsupported`), which is the
fail-closed behaviour the contract requires.

**Route changes are part of this step** (unlike `p5`'s): `apps/api/src/notices/http.ts` moves `GET`/`HEAD
/v1/notices` and `POST /v1/notices/{noticeId}/read` off the interim `profile.read` binding onto `notice.read`
and `notice.mark_read`, and `apps/api/src/identity/http.ts` gains `PUT /v1/identity/me/display-name` bound to
`profile.set_display_name`. Before this step, both notices routes still run on the released `p5` `profile.read`
cell and the display-name route does not exist (`docs/cbd-236-authorization-policy-contract.md` §8.9.1's "after
release" note).

## 2. Preconditions (every value must be a resolvable record identifier)

| Precondition | Record | Value to cite |
| --- | --- | --- |
| Product Owner approval of the `p6` cells in contract §8.9 at exact v0.14 | an `approval` record under `.agent-state/approvals/` | `PO-P6-APPROVAL-001` → `productApprovalRef` of the `p6` row |
| Security clearance of the `p6` amendment, cells and fixtures | the Security result for the `p6` candidate with disposition `clear` (or `remediate` with every condition closed) | `PROTO-CONTRACTS-P6-SEC-001-RESULT` → `securityApprovalRef` of the `p6` row |

`releaseCommit` is the full SHA of the `main` merge commit that carries the `p6` registry and fixtures — the
merge commit of `feat/contracts-p6-tables`'s pull request PR #382 (replacing PR #381), `2b16c870b7a757c4ee50668b60fba4a2e4e34f0b`, not
this branch's own SHA. The branch carried a placeholder until that merge and the Manager filled it in afterwards,
following the p2..p5 convention this split exists to restore.

## 3. The digest

Reproduce the digest from the branch before applying; the value below was computed at the revision
`feat/contracts-p6-tables` registered `p6` at, and the history guard fails if the registry no longer hashes to
it:

```bash
node --import=tsx -e "import('./packages/contracts/src/authorization/policy/registry.ts').then((m) => console.log(m.P6_DIGEST))"
```

Expected output:

```text
7ed466ae58ab3ac7903aeebaea4603aba6bdec81cb336d07d9a230f9456998ea
```

`P1_DIGEST` through `P5_DIGEST` must still print their pinned literals (`docs/cbd-236-p5-release-step.md` §3;
`P5_DIGEST` `68eef40b40f0f04fb8c31cba6f08292bc39a4c98c0f1ccc248f548e561e2fec8`), all pinned as literals in the
contracts tests (`POLICY-V6-00`).

## 4. The change, file by file

### 4.1 `config/authorization-policy-release-history.json` — append exactly this row (after the `p5` row)

The `p1`–`p5` rows are not touched. Replace the placeholder once the Manager rebases and fills in the merge
commit; every field must be a non-empty string or integer, and the row must contain exactly these six keys.

```json
  {
    "version": "p6",
    "digest": "7ed466ae58ab3ac7903aeebaea4603aba6bdec81cb336d07d9a230f9456998ea",
    "schemaVersion": 1,
    "releaseCommit": "2b16c870b7a757c4ee50668b60fba4a2e4e34f0b",
    "productApprovalRef": "PO-P6-APPROVAL-001",
    "securityApprovalRef": "PROTO-CONTRACTS-P6-SEC-001-RESULT"
  }
```

### 4.2 `packages/contracts/src/authorization/policy/registry.ts` — the flip

```ts
export const CURRENT_POLICY_VERSION = "p5" as const;
```

becomes

```ts
export const CURRENT_POLICY_VERSION = "p6" as const;
```

Nothing else in the registry changes. `POLICY_SERIALIZATION`, `CURRENT_POLICY`, and `policyCompatibility`
follow the constant. Update the comment above the constant to say `p6` was released by this document, and
remove the "registered and not current" wording on the `p6` line.

### 4.3 Application literals that name the current version (byte-identical between `apps/api` and `apps/worker`)

`PC-236-013` requires each application to pin its tuple independently of the registry. The `inventory.test.ts`
parity test requires the api and worker copies of `compatibility.ts`, `facts.ts`, and `test-support.ts` to stay
byte-identical; each edit applies to both.

| File (api and worker) | Line before | Change |
| --- | --- | --- |
| `src/authorization/compatibility.ts`, `SUPPORTED_POLICY_TUPLES` | `Object.freeze({ version: "p5", expectedDigest: "68eef40b…1e2fec8", schemaVersion: 1 })` | replace with `Object.freeze({ version: "p6", expectedDigest: "7ed466ae58ab3ac7903aeebaea4603aba6bdec81cb336d07d9a230f9456998ea", schemaVersion: 1 })` — one tuple, `supported.length` stays 1 |
| `src/authorization/compatibility.ts` | `const tuple = supported.find((item) => item.version === "p5");` | `=== "p6"` |
| `src/authorization/facts.ts` | `versions: { policyVersion: "p5", ...` | `policyVersion: "p6"` |
| `src/authorization/test-support.ts` | `testHistory = [{ version: "p5", digest: SUPPORTED_POLICY_TUPLES[0]!.expectedDigest, ...` | `version: "p6"` |
| `apps/worker/src/authorization/jobs.ts` claimed-versions check | `key === "policyVersion" ? item !== "p5" :` | `item !== "p6"` |

### 4.4 Route rebinding

`apps/api/src/notices/http.ts`: `NOTICES_ACTION = "profile.read"` becomes two exports, `NOTICES_READ_ACTION =
"notice.read"` and `NOTICES_MARK_READ_ACTION = "notice.mark_read"`, bound respectively to the list route and the
mark-read route. `apps/api/src/identity/http.ts`: a new `setDisplayName` handler binds `PUT
me/display-name` to `profile.set_display_name`, calling `writeDisplayName` from
`packages/data-access/src/financial-profile.ts` with `expectedVersion` read from the decided input's own
`profile.profileVersion`.

### 4.5 Rate-limit registrations

`config/rate-limit/registrations.json`: the three existing `/v1/notices` registrations' `authorization_metadata_id`
moves from `profile.read` to `notice.read` (the two `GET`/`HEAD` rows) and `notice.mark_read` (the `POST` row);
a new registration is added for `api:PUT:/v1/identity/me/display-name` under `rlp-266-mutation-v1`, bound to
`profile.set_display_name`.

### 4.6 Tests the flip changes, and the historical `p1`–`p5` literals that stay

**Contracts suite: no edit.** Version-derived at every point that touches a version, exactly as
`docs/cbd-236-p5-release-step.md` §4.4 describes for its own flip; `POLICY-V6-03` branches on `currentCarries`
and needs no edit either side of the flip.

**Application suites: edits required**, all already applied on this branch:

| File | Before | Change at the flip |
| --- | --- | --- |
| `apps/api/src/authorization/boundary.test.ts` | `released.length === 5`, `released[0]`–`released[4]` assertions | `released.length === 6`; add `released[5]` assertions for `p6` (digest `7ed466ae…56998ea`, `schemaVersion` 1, the two `p6` approval ids, non-empty `releaseCommit`) |
| `apps/api/src/notices/http.test.ts` and the route itself | both routes on `profile.read` | rebound to `notice.read` / `notice.mark_read`; the store's `verify` stub accepts `recheck_at_commit` alongside `audit`/`bind_cache_key` |
| `apps/api/src/identity/http.test.ts` | `IDENTITY_ROUTES` without the display-name route; no PUT test | route added to the inventory list; new test proves the 200/400/403 paths (the `409 version_conflict` branch is proven directly in `display-name-write.test.ts`, not raced through HTTP) |
| `apps/api/src/identity/display-name.live.test.ts` | did not exist | new opt-in live-PostgreSQL proof of the route end to end |

## 5. Verification after applying, before pushing

```bash
npm run check:authorization-policy-history
npm test --workspace=@cobudget/contracts
npm test --workspace=@cobudget/api
npm test --workspace=@cobudget/worker
npm run check:rate-limit-registry
npm run check
```

Expected: the history check reports the six released rows append-only, approved, and digest-pinned once the
`releaseCommit` placeholder is filled; every suite passes; `npm run check` prints its own final verdict line
(run its stages sequentially — a single background `npm run check` has been killed for low memory during the
api tests). Then the `python scripts/secret_scanner.py range` step and, for the rebased branch, the pull
request as for any change (this branch itself carries no PR; the Manager rebases it after `feat/contracts-p6-tables`
merges).

## 6. After the merge

Sweep for what the release falsifies: the CBD-236 contract header status, the §8.9.3 "registered and not
current" wording and §8.9.4, the §16 `p6` row and `HO-236-12`'s "once released" clauses, the proposal's own
status field — all of which become historical and need a v0.14.1 note (this branch's own `docs/cbd-236-*`
edits already state the released wording; the Manager's sweep after the rebase is limited to filling in the
`releaseCommit` literal here and in the release-history row and re-verifying the digest and gate).

## 7. Revision history

| Version | Date | Author | Change |
| --- | --- | --- | --- |
| 0.1 | September 15, 2026 | Implementation under `PROTO-CONTRACTS-P6-SPLIT-001` | Initial release step, split out of the single-shot release `PROTO-CONTRACTS-P6-IMPL-001` applied on branch `feat/contracts-p6-tables` (registration) and `chore/release-policy-p6` (this step), so `releaseCommit` names the registering PR's merge commit rather than a branch SHA, following the `p2`..`p5` convention. `releaseCommit` recorded as the literal `2b16c870b7a757c4ee50668b60fba4a2e4e34f0b` pending the Manager's rebase onto `main` after `feat/contracts-p6-tables` merges. |
