# CBD-236 — Policy version 4 release step

| Field | Value |
| --- | --- |
| Status | **Applied** — `releaseCommit` `696d831ab25a226cc178c27e7111ef75c2ffd579`; `p4` is released, in the combined form of `docs/cbd-236-p5-release-step.md` §1 form 2, and never deployed (`CURRENT_POLICY_VERSION` went from `p3` straight to `p5`, which carries every `p4` cell) |
| Document version | 0.2.1 |
| Governing contract | [`docs/cbd-236-authorization-policy-contract.md`](./cbd-236-authorization-policy-contract.md) v0.10 §6 `PC-236-011`, `PC-236-013`, §8.7 |
| Governing decisions | `CBD236-POLICY-APPROVAL-001` (Product Owner and Security sign-off cited in every released row); `PROTO-POLICY-V2-DECISION-001` precedent (add a version through an Architecture packet and a following Security review; release requires both approvals as separate records); `PO-CBD72-ROW36-001` (the approved CBD-72 row 36 the `p4` cells carry) |
| Jira subtask | [CBD-236](https://cobudget.atlassian.net/browse/CBD-236) |
| Written by | Architecture, assignment `PROTO-POLICY-V4-001`, September 15, 2026 |
| Applied by | Manager, in one commit, after both approval records exist |

## 1. What this step does and does not do

It releases policy version `p4` as the current deployed policy. It does not add or change a cell: `p4` is
already registered next to `p1`, `p2` and `p3` in `packages/contracts/src/authorization/policy/registry.ts`
with its own digest, every `p3` cell (and therefore every `p2` and `p1` cell) is byte-identical in `p4`, and the
contracts tests already prove the eight `p4` cells (Co-owner and Collaborator for
`manual_account.create/edit/archive/restore_manual_account`) and their negative families
(`npm test --workspace=@cobudget/contracts`). The §8.7.2 evaluator change (cell lookup by action and role)
is already on `main` with the registration and is exercised by every released version's tests; this step does
not touch `evaluate.ts`.

Until this step lands, `decide` denies any `p4` input `policy_version_unsupported`, `policyCompatibility`
is false for `p4`, both applications start against `p3`, and a Co-owner or Collaborator request on a
manual-account route denies `role_not_permitted` with the uniform external class. Nothing below may be
applied piecemeal: the history row without the flip leaves `p4` released but undeployed, and the flip without
the row makes the API and worker refuse to start (`policy_version_unsupported`), which is the fail-closed
behaviour the contract requires.

No route changes. `apps/api/src/accounts/http.ts` (PROTO-INCREMENT-B-001, PR #340, unmerged when this step was written) binds the four action names (`HO-236-09`); after the
flip a Co-owner or Collaborator request allows through the same routes with `cellRef.role` naming the acting
role (`HO-236-10`). No handler may add a role branch of its own.

## 2. Preconditions (both must be resolvable record identifiers)

The §4.4 route-test recommendation applies once the PROTO-INCREMENT-B-001 routes (PR #340) are on `main`; if the flip is applied before that merge, the recommendation carries into the merge of those routes instead (`SEC-P4-F1`).

| Precondition | Record | Value to cite |
| --- | --- | --- |
| Product Owner approval of the `p4` cells in contract §8.7.1 at exact v0.10 (the Co-owner and Collaborator cells that CBD-72 row 36 grants under `PO-CBD72-ROW36-001`) | an `approval` record under `.agent-state/approvals/` | its `id` → `productApprovalRef` |
| Security clearance of the v0.10 amendment, the `p4` fixtures, and the §8.7.2 evaluator change | the Security result for the `p4` candidate with disposition `clear` (or `remediate` with every condition closed) | its `id` → `securityApprovalRef` |

`releaseCommit` is the full SHA of the `main` commit that carries the `p4` registry and fixtures, that is,
the merge commit of the `PROTO-POLICY-V4-001` pull request. Record it after that merge. PR #341 (CBD-72 row
36) must also be on `main` before this step is applied, since §8.7.1 cites the row as the governing source.

## 3. The digest

Reproduce the digest from the branch before applying; the value below was computed at the revision this
document was written at and the history guard fails if the registry no longer hashes to it:

```bash
node --import=tsx -e "import('./packages/contracts/src/authorization/policy/registry.ts').then((m) => console.log(m.P4_DIGEST))"
```

Expected output:

```text
25b2f9e917c19bdb9c26699bb4840a6e9d9544e16ac2f212de9120e6eacd15a9
```

`P1_DIGEST` must still print `488d46739bee379870f6649a6b51aaccc97b4bfdec9519fae5ed93b581ce1f22`,
`P2_DIGEST` must still print `374e0b4d2ae86d53afe3fdf02a9d91e52d7b95b2e67df75b975bb54b4163d322`, and
`P3_DIGEST` must still print `b4fbdb8e32a6155705877d7c91846ee855dc717dfce9d57a6f04e07301923e4d`; all three
are pinned as literals in the contracts tests (`POLICY-V4-01`).

## 4. The change, file by file

### 4.1 `config/authorization-policy-release-history.json` — append exactly this row

The `p1`, `p2` and `p3` rows are not touched. Replace the three placeholders in angle brackets; every field
must be a non-empty string or integer, and the row must contain exactly these six keys.

```json
  {
    "version": "p4",
    "digest": "25b2f9e917c19bdb9c26699bb4840a6e9d9544e16ac2f212de9120e6eacd15a9",
    "schemaVersion": 1,
    "releaseCommit": "<full SHA of the main merge commit carrying the p4 registry>",
    "productApprovalRef": "<approval record id>",
    "securityApprovalRef": "<Security result id for the p4 candidate>"
  }
```

### 4.2 `packages/contracts/src/authorization/policy/registry.ts` — the flip

```ts
export const CURRENT_POLICY_VERSION = "p3" as const;
```

becomes

```ts
export const CURRENT_POLICY_VERSION = "p4" as const;
```

Nothing else in the registry changes. `POLICY_SERIALIZATION`, `CURRENT_POLICY`, and `policyCompatibility`
follow the constant. Update the comment above the constant to say `p4` was released by this document, and
remove the "registered and not released" comment on the `p4` serialization line.

### 4.3 Application literals that name `p3` (byte-identical between `apps/api` and `apps/worker`)

`PC-236-013` requires each application to pin its tuple independently of the registry, so the flip is not
one line. The `inventory.test.ts` parity test requires the api and worker copies of `compatibility.ts`,
`facts.ts`, and `test-support.ts` to stay byte-identical; apply each edit to both. These are every
production and test-support literal that names `p3` in the two applications at the revision this document
was written at (`grep -rn '"p3"' apps/api/src apps/worker/src`; the only other hits are the two
`boundary.test.ts` lines in §4.4).

| File (api and worker) | Line today | Change |
| --- | --- | --- |
| `src/authorization/compatibility.ts` line 10 | `Object.freeze({ version: "p3", expectedDigest: "b4fbdb8e…923e4d", schemaVersion: 1 })` in `SUPPORTED_POLICY_TUPLES` | replace with `Object.freeze({ version: "p4", expectedDigest: "25b2f9e917c19bdb9c26699bb4840a6e9d9544e16ac2f212de9120e6eacd15a9", schemaVersion: 1 })` — one tuple, `supported.length` stays 1 |
| `src/authorization/compatibility.ts` line 26 | `const tuple = supported.find((item) => item.version === "p3");` | `=== "p4"` |
| `src/authorization/facts.ts` line 146 | `versions: { policyVersion: "p3", ...` | `policyVersion: "p4"` |
| `src/authorization/test-support.ts` line 12 | `testHistory = [{ version: "p3", digest: SUPPORTED_POLICY_TUPLES[0]!.expectedDigest, ...` | `version: "p4"` |
| `apps/worker/src/authorization/jobs.ts` line 71 only | `key === "policyVersion" ? item !== "p3" :` in the claimed-versions check | `item !== "p4"` |

`compatibility.ts` must keep its literal pin by `PC-236-013`. Deriving `facts.ts`, `test-support.ts`, and
`jobs.ts` from `CURRENT_POLICY_VERSION` remains the cleaner follow-up the p2 and p3 steps named; it is
outside this step. The stub `policyVersion: "p1"` values with an all-`a` digest in
`packages/budget-application/src/persistence/*.test.ts` are fake authorizer results that never reach the
registry or the release history; they are not pins and are not edited.

### 4.4 Tests the flip changes, and the historical `p1`, `p2` and `p3` literals that stay

**Contracts suite: no edit.** With `CURRENT_POLICY_VERSION` flipped to `p4` on the branch (history row absent,
contracts only) `node --test src/authorization/authorization.test.ts` passed 29/29 and `tsc --noEmit` passed;
the constant was then restored to `p3`. The suite is version-derived at every point that touches a version:
`AC07` selects the positive catalog through `CATALOGS[currentVersion]` (`p1`–`p4`); `POLICY-V2-03` proves the
subject cells and `subjectNegativeFixtures(currentVersion)` through `decide` for any current version at or
after `p2`; `POLICY-V3-03` now branches on whether the current version carries the `p3` cells
(`currentCarries`, replacing the `currentVersion !== "p3"` literal that would have failed under `p4`) and
proves the Primary Owner cells and `accountNegativeFixtures(currentVersion)` through `decide`; `POLICY-V4-03`
branches on whether the current version carries a `co_owner` cell — before the flip every `p4` input denies
`policy_version_unsupported` through `decide` and a Co-owner or Collaborator naming a management cell denies
`role_not_permitted`; after it the eight cells allow through `decide` with their role in the `cellRef`,
`accountNegativeFixtures(currentVersion)` denies inertly (its wrong-role family is derived from the cells the
version carries), and a `p3`-versioned bootstrap input denies. Historical coverage that never depends on the
current version stays as written: the `p1`, `p2` and `p3` catalogs under `decideUnderRegisteredVersion`, the
three digest literals, the `p3`-only codes absent from earlier versions, `role_not_permitted` for the `p4`
roles under `p3`, and `profile.read` reserved in `p1`.

**Application suites: edits required.** These were derived by reading the suites against the flip; they
could not be executed on this branch because `apps/**` and the release history are outside the
`PROTO-POLICY-V4-001` write scope. The Manager runs them at the flip. Api and worker copies of `test-support.ts`
stay byte-identical; `boundary.test.ts`, `subject-scoped.test.ts`, and `jobs.test.ts` are app-specific.

| File | Today | Required change at the flip |
| --- | --- | --- |
| `apps/api/src/authorization/boundary.test.ts` (test "rejects mismatched registry digest/schema and missing independent release history"), line 165 | `assert.equal(released.length, 3, "exactly three released policy rows")` | `released.length === 4`, "exactly four released policy rows" |
| same test, lines 166–180 | `released[0]` asserted as `p1`, `released[1]` as `p2`, `released[2]` as `p3` (digest `b4fbdb8e…923e4d`, `schemaVersion` 1, `PO-P3-APPROVAL-001`, `PROTO-POLICY-V3-SEC-001-RESULT-001`, non-empty `releaseCommit`) | keep every `released[0]`, `released[1]` and `released[2]` assertion unchanged as historical coverage; add `released[3]` assertions: `version` `p4`, `digest` `25b2f9e917c19bdb9c26699bb4840a6e9d9544e16ac2f212de9120e6eacd15a9`, `schemaVersion` 1, `productApprovalRef` and `securityApprovalRef` equal to the two approved record ids, non-empty `releaseCommit`; keep `assert.doesNotThrow(() => assertPolicyCompatibility(released))` — it now proves the `p4` tuple against four immutable rows |
| same test, mismatch cases, lines 155–159 | `[{ version: "p1", expectedDigest, schemaVersion: 99 }]` for two digests; `[{ version: "p2", expectedDigest: SUPPORTED_POLICY_TUPLES[0]!.expectedDigest, schemaVersion: 99 }]`; `[{ version: "p3", expectedDigest: "b4fbdb8e…923e4d", schemaVersion: 99 }]`; `{ ...SUPPORTED_POLICY_TUPLES[0]!, expectedDigest: "0".repeat(64) }` | the `SUPPORTED_POLICY_TUPLES[0]` cases follow the new tuple with no edit; the literal `version: "p1"`, `"p2"` and `"p3"` cases stay unchanged as historical literals (after the flip each fails on the version, which is still `policy_version_unsupported`); add one `{ version: "p4", expectedDigest: <p4 digest>, schemaVersion: 99 }` case so schema mismatch is still exercised against the current version |
| `apps/api/src/authorization/test-support.ts` and the worker copy, line 12 | `testHistory = [{ version: "p3", digest: SUPPORTED_POLICY_TUPLES[0]!.expectedDigest, ... }]` | `version: "p4"` (listed in §4.3); the digest already follows the tuple |
| `apps/api/src/authorization/subject-scoped.test.ts` | already version-derived since the p3 flip: `subjectFixture(action, CURRENT_POLICY_VERSION)` and `subjectNegativeFixtures(CURRENT_POLICY_VERSION)` | no edit; the `p4` catalog carries the subject cells and the fixtures follow the constant |
| `apps/api/src/accounts/http.test.ts`, `apps/api/src/transactions/http.test.ts`, `apps/api/src/sessions/budget-facts.test.ts` | drive the manual-account routes with a Primary Owner membership; `budget-facts.test.ts` line 124 uses a `co_owner` membership only to prove no membership property yields a consent fact (`input_invalid`, before any cell) | no edit; no application test asserts `role_not_permitted` for a Co-owner or Collaborator on an account route (`grep -rn "co_owner\|collaborator\|role_not_permitted" apps/api/src apps/worker/src apps/web/src` at this revision). The Manager should add, at the flip or in the next increment, one positive route test per role (a `co_owner` and a `collaborator` membership creating, editing, archiving and restoring an account through the real Fastify instance) and keep a Viewer denial, so the released behaviour is proven at the route and not only at `decide` |
| `apps/worker/src/authorization/jobs.test.ts` (test "rejects startup mismatches ..."), lines 130–132 | derives its tuple from `SUPPORTED_POLICY_TUPLES[0]` and `testHistory` | no edit |
| `apps/api/src/authorization/inventory.test.ts` ("real API and worker processes start on the released policy p3 ..."), line 70 | reads the checked-in history through the real processes | no edit to the assertion; rename the test to say `p4`; the checked-in history now carries four rows and both processes must start on `p4` |
| `apps/api/src/authorization/inventory.test.ts` parity test ("prevents drift in the common enforcement code across deployment units") | compares api and worker copies byte for byte | no edit; it is the reason every §4.3 edit is applied to both apps |

Historical literals that must **stay unchanged** after the flip: the `p1`, `p2` and `p3` rows in the release
history (append-only guard), the `p1`, `p2` and `p3` assertions on `released[0]`–`released[2]`, the
`P1_DIGEST`, `P2_DIGEST` and `P3_DIGEST` literals in the contracts tests, the `CBD236-P1-RELEASE-001`,
`CBD236-SECURITY-001`, `PO-P2-APPROVAL-001`, `PROTO-POLICY-V2-SEC-001`, `PO-P3-APPROVAL-001` and
`PROTO-POLICY-V3-SEC-001-RESULT-001` references, and the `version: "p1"`, `"p2"` and `"p3"` mismatch literals
above.

## 5. Verification after applying, before pushing

```bash
npm run check:authorization-policy-history
npm test --workspace=@cobudget/contracts
npm test --workspace=@cobudget/api
npm test --workspace=@cobudget/worker
npm run check
```

Expected: the history check reports the four released rows append-only, approved, and digest-pinned; every
suite passes; `npm run check` prints its own final verdict line (run its stages sequentially on this machine;
a single background `npm run check` has been killed for low memory during the api tests). Then the
`python scripts/secret_scanner.py range` step and the pull request as for any change.

## 6. After the merge

Sweep for what the release falsifies: the CBD-236 contract header status, §8.7.3 status sentence ("registered
and not released"), §8.7.4, the §12 CBD-196/200 non-owner row and `HO-236-10`'s "until §8.7.4 is applied"
clause become historical and need a v0.11 note; the `PROTO-INCREMENT-B-001` routes may then rely on the `p4`
cells for Co-owners and Collaborators; the unpublished manifest entry for this document may be reopened only
in a focused change. `OQ-236-011` is already closed by CBD-72 row 36 and needs no further action.

## 7. Revision history

| Version | Date | Author | Change |
| --- | --- | --- | --- |
| 0.2.1 | September 15, 2026 | Documentation, applying `PROTO-CBD236-DIGEST-COMMAND-FIX-001` finding `P4P5-F01` | Section 3 digest-reproduction command corrected from plain `node -e` (which cannot load a `.ts` module without a loader) to `node --import=tsx -e`; executed from the worktree and confirmed to print the pinned `P4_DIGEST` `25b2f9e917c19bdb9c26699bb4840a6e9d9544e16ac2f212de9120e6eacd15a9`. No digest, cell, decision identifier, or status changed. |
| 0.2 | September 15, 2026 | Manager, applying this step | Applied in the combined form of `docs/cbd-236-p5-release-step.md` §1 form 2: one commit appends the `p4` row (`PO-P4P5-APPROVAL-001`, `PROTO-POLICY-V4-SEC-001-RESULT-001`, `releaseCommit` `696d831ab25a226cc178c27e7111ef75c2ffd579`) and then the `p5` row, and flips `CURRENT_POLICY_VERSION` from `p3` straight to `p5`. The §4.2 flip to `p4` and the §4.3 literals naming `p4` were therefore not applied as written: every literal names `p5`, and `p4` is released and never deployed, which the contract permits. The §4.4 `released.length === 4` row-count change was superseded by the `p5` step's `=== 5`; the `released[3]` `p4` assertions and the `p4` `schemaVersion` 99 mismatch case were applied exactly as listed. Contracts 65/65, api 475/477 (2 skipped, live PostgreSQL), worker 52/52. |
| 0.1.1 | September 15, 2026 | Manager, applying `SEC-P4-F1` | §1 and §2 attribute the route binding to the unmerged PROTO-INCREMENT-B-001 routes (PR #340) and note when the §4.4 route-test recommendation applies. Not applied. |
| 0.1 | September 15, 2026 | Architecture under `PROTO-POLICY-V4-001` | Initial ready-to-apply release step with the reproducible `p4` digest, the exact history row, the registry flip, every application literal that pins `p3`, the contracts suite proven version-derived under a simulated flip, and every application test change the flip requires with the historical `p1`, `p2` and `p3` literals that stay. Not applied. |
