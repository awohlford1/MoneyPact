# CBD-236 — Policy version 5 release step

| Field | Value |
| --- | --- |
| Status | **Applied** — `releaseCommit` `c4add46cb6103e9a2c2b7ee8d14a9afb8afa0acc`; `p5` is released and current, in the combined form of §1 form 2 |
| Document version | 0.2 |
| Governing contract | [`docs/cbd-236-authorization-policy-contract.md`](./cbd-236-authorization-policy-contract.md) v0.11 §6 `PC-236-011`, `PC-236-013`, §8.7, §8.8 |
| Governing decisions | `CBD236-POLICY-APPROVAL-001` (Product Owner and Security sign-off cited in every released row); `PROTO-POLICY-V2-DECISION-001` precedent (add a version through an Architecture packet and a following Security review; release requires both approvals as separate records); `INVITATIONS-DESIGN-001` items 10 and 11 (the approved design whose §11 cells `p5` carries, its `p4` read as `p5`); `PO-CBD72-ROW36-001` (the `p4` cells `p5` composes) |
| Jira subtask | [CBD-236](https://cobudget.atlassian.net/browse/CBD-236); the increment is CBD-41 (CBD-274, CBD-275, CBD-276), CBD-280 and CBD-287 |
| Written by | Architecture, assignment `PROTO-POLICY-V5-001`, September 15, 2026 |
| Applied by | Manager, in one commit, after the approval records exist and the `p4` rule below is satisfied |

## 1. What this step does and does not do

It releases policy version `p5` as the current deployed policy. It does not add or change a cell: `p5` is
already registered next to `p1`, `p2`, `p3` and `p4` in `packages/contracts/src/authorization/policy/registry.ts`
with its own digest, every `p4` cell (and therefore every `p3`, `p2` and `p1` cell) is byte-identical in `p5`,
the five superseded row-24 and row-26 definitions bind an `invitation` target (§8.8.1), and the contracts tests
already prove the 54 `p5` cells and their negative families (`npm test --workspace=@cobudget/contracts`). The
§8.8.2 evaluator change (the assurance predicate read from the cell's `fresh_assurance` obligation) is on the
`p5` branch in its own commit and is exercised by every registered version's tests; this step does not touch
`evaluate.ts`.

**The `p4` rule.** `p5` is registered above `p4`, which is itself registered and not released
(`docs/cbd-236-p4-release-step.md`). The release history is append-only, `p5` carries every `p4` cell, and
`CBD236-POLICY-APPROVAL-001` requires each released version's own two approvals in its own row. Therefore
`p5` is released in exactly one of two forms:

1. **`p4` first.** The `p4` step is applied and merged (its row appended, `CURRENT_POLICY_VERSION` `p4`,
   the application literals renamed to `p4`); then this step appends the `p5` row and flips `p4` to `p5`.
2. **Combined.** One commit appends the `p4` row and then the `p5` row, in that order, each citing its own
   `productApprovalRef` and `securityApprovalRef` (four approval records in total), and flips
   `CURRENT_POLICY_VERSION` straight from `p3` to `p5`. `p4` is then released and never deployed, which the
   contract permits (a released row is a digest pin and an approval citation, not a deployment).

Appending a `p5` row without a `p4` row is not a form: the history guard would pass (it checks each row against
the registry), but the row would make `p5` deployable while the `p4` cells it carries had never been approved
as a released version, which is what `CBD236-POLICY-APPROVAL-001` forbids. Skipping `p4`'s approvals by citing
them "inside" the `p5` approvals is likewise not a form; the `p4` Product Owner approval of §8.7.1 and the
Security clearance `PROTO-POLICY-V4-SEC-001-RESULT-001` exist as their own records and are cited in the `p4` row.

Until this step lands, `decide` denies any `p5` input `policy_version_unsupported`, `policyCompatibility`
is false for `p4` and `p5`, both applications start against `p3` (or `p4` after form 1's first half), a
Co-owner or Collaborator request on a baseline route denies `role_not_permitted`, a `p5`-only code in a
current input denies `input_unsupported`, and the invitee subject cells deny `input_invalid` until `PK-6` adds
the ceremony fact reader (`HO-236-11`). Nothing below may be applied piecemeal: a history row without the flip
leaves a version released but undeployed, and the flip without the row makes the API and worker refuse to
start (`policy_version_unsupported`), which is the fail-closed behaviour the contract requires.

No route changes are part of this step. The `PK-6` invitation and members routes and the `PK-7` transfer
routes (unmerged when this step was written) bind the `p5` action names (`HO-236-11`); after the flip they allow
through the policy with `cellRef.role` naming the acting role, and no handler may add a role branch of its own.

## 2. Preconditions (every value must be a resolvable record identifier)

| Precondition | Record | Value to cite |
| --- | --- | --- |
| Product Owner approval of the `p5` cells in contract §8.8.1 at exact v0.11 (the design's §11 cells under `INVITATIONS-DESIGN-001` items 10 and 11, including the row-1 sourcing of `1.view_members` (`OQ-236-012`) and the Primary-only `26.confirm_acceptance` (`OQ-236-013`)) | an `approval` record under `.agent-state/approvals/` | its `id` → `productApprovalRef` of the `p5` row |
| Security clearance of the v0.11 amendment, the `p5` fixtures, and the §8.8.2 evaluator change | the Security result for the `p5` candidate with disposition `clear` (or `remediate` with every condition closed) | its `id` → `securityApprovalRef` of the `p5` row |
| The `p4` row (form 1: already on `main`; form 2: appended in the same commit from the `p4` step's §4.1 with its own two references) | `docs/cbd-236-p4-release-step.md` §2 | the `p4` row's `productApprovalRef` and `securityApprovalRef` |

`releaseCommit` is the full SHA of the `main` commit that carries the `p5` registry and fixtures, that is,
the merge commit of the `PROTO-POLICY-V5-001` pull request. Record it after that merge. The `p4` row's
`releaseCommit` is the merge commit of the `PROTO-POLICY-V4-001` pull request (PR #344), as its own step states.

## 3. The digest

Reproduce the digest from the branch before applying; the value below was computed at the revision this
document was written at and the history guard fails if the registry no longer hashes to it:

```bash
node -e "import('./packages/contracts/src/authorization/policy/registry.ts').then((m) => console.log(m.P5_DIGEST))"
```

Expected output:

```text
68eef40b40f0f04fb8c31cba6f08292bc39a4c98c0f1ccc248f548e561e2fec8
```

`P1_DIGEST` must still print `488d46739bee379870f6649a6b51aaccc97b4bfdec9519fae5ed93b581ce1f22`,
`P2_DIGEST` must still print `374e0b4d2ae86d53afe3fdf02a9d91e52d7b95b2e67df75b975bb54b4163d322`,
`P3_DIGEST` must still print `b4fbdb8e32a6155705877d7c91846ee855dc717dfce9d57a6f04e07301923e4d`, and
`P4_DIGEST` must still print `25b2f9e917c19bdb9c26699bb4840a6e9d9544e16ac2f212de9120e6eacd15a9`; all four
are pinned as literals in the contracts tests (`POLICY-V5-01`).

## 4. The change, file by file

### 4.1 `config/authorization-policy-release-history.json` — append exactly this row (after the `p4` row)

The `p1`, `p2` and `p3` rows are not touched, and neither is the `p4` row once it exists. Under form 2 the `p4`
row from `docs/cbd-236-p4-release-step.md` §4.1 is appended immediately before this one, in the same commit.
Replace the three placeholders in angle brackets; every field must be a non-empty string or integer, and the
row must contain exactly these six keys.

```json
  {
    "version": "p5",
    "digest": "68eef40b40f0f04fb8c31cba6f08292bc39a4c98c0f1ccc248f548e561e2fec8",
    "schemaVersion": 1,
    "releaseCommit": "<full SHA of the main merge commit carrying the p5 registry>",
    "productApprovalRef": "<approval record id for section 8.8.1 at v0.11>",
    "securityApprovalRef": "<Security result id for the p5 candidate>"
  }
```

### 4.2 `packages/contracts/src/authorization/policy/registry.ts` — the flip

```ts
export const CURRENT_POLICY_VERSION = "p3" as const;
```

(or `"p4"` after form 1's first half) becomes

```ts
export const CURRENT_POLICY_VERSION = "p5" as const;
```

Nothing else in the registry changes. `POLICY_SERIALIZATION`, `CURRENT_POLICY`, and `policyCompatibility`
follow the constant. Update the comment above the constant to say `p5` was released by this document (and `p4`
by its own step or by this combined release), and remove the "registered and not released" comments on the
`p4` and `p5` serialization lines.

### 4.3 Application literals that name the current version (byte-identical between `apps/api` and `apps/worker`)

`PC-236-013` requires each application to pin its tuple independently of the registry, so the flip is not
one line. The `inventory.test.ts` parity test requires the api and worker copies of `compatibility.ts`,
`facts.ts`, and `test-support.ts` to stay byte-identical; apply each edit to both. These are every
production and test-support literal that names the current version in the two applications at the revision
this document was written at (`grep -rn '"p3"' apps/api/src apps/worker/src`, with `p4` unreleased; the only
other hits are the two `boundary.test.ts` lines in §4.4). After form 1's first half the same lines name `p4`
instead; the edit is the same.

| File (api and worker) | Line today | Change |
| --- | --- | --- |
| `src/authorization/compatibility.ts` line 10 | `Object.freeze({ version: "p3", expectedDigest: "b4fbdb8e…923e4d", schemaVersion: 1 })` in `SUPPORTED_POLICY_TUPLES` | replace with `Object.freeze({ version: "p5", expectedDigest: "68eef40b40f0f04fb8c31cba6f08292bc39a4c98c0f1ccc248f548e561e2fec8", schemaVersion: 1 })` — one tuple, `supported.length` stays 1 |
| `src/authorization/compatibility.ts` line 26 | `const tuple = supported.find((item) => item.version === "p3");` | `=== "p5"` |
| `src/authorization/facts.ts` line 146 | `versions: { policyVersion: "p3", ...` | `policyVersion: "p5"` |
| `src/authorization/test-support.ts` line 12 | `testHistory = [{ version: "p3", digest: SUPPORTED_POLICY_TUPLES[0]!.expectedDigest, ...` | `version: "p5"` |
| `apps/worker/src/authorization/jobs.ts` line 71 only | `key === "policyVersion" ? item !== "p3" :` in the claimed-versions check | `item !== "p5"` |

`compatibility.ts` must keep its literal pin by `PC-236-013`. Deriving `facts.ts`, `test-support.ts`, and
`jobs.ts` from `CURRENT_POLICY_VERSION` remains the cleaner follow-up the p2, p3 and p4 steps named; it is
outside this step. The stub `policyVersion: "p1"` values with an all-`a` digest in
`packages/budget-application/src/persistence/*.test.ts` are fake authorizer results that never reach the
registry or the release history; they are not pins and are not edited.

### 4.4 Tests the flip changes, and the historical `p1`–`p4` literals that stay

**Contracts suite: no edit.** With `CURRENT_POLICY_VERSION` flipped to `p5` on the branch (history rows absent,
contracts only) `node --test src/authorization/authorization.test.ts` passed 36/36 and `tsc --noEmit` passed;
the constant was then restored to `p3`. The suite is version-derived at every point that touches a version:
`AC07` selects the positive catalog through `CATALOGS[currentVersion]` (`p1`–`p5`); `AC02` and `NC-236-05` use
`UNMAPPED_ROLE`, a role the current version maps to no `1.view_space` cell (`co_owner` before `p5`, `viewer`
under it); `AC04` denies through `decide` only the roles the current version maps no cell for and keeps the
four-role denial as a `p1` assertion; `POLICY-V2-03`, `POLICY-V3-03` and `POLICY-V4-03` branch on
`currentCarries`; `POLICY-V5-03` branches on whether the current version carries `1.view_members` — before the
flip every `p5` input denies `policy_version_unsupported` through `decide`, a `p5`-only code in a current input
denies `input_unsupported`, and a Co-owner or Collaborator on a baseline or row-24 cell denies
`role_not_permitted`; after it the 54 cells allow through `decide` with their role in the `cellRef`,
`invitationNegativeFixtures(currentVersion)` and `subjectNegativeFixtures(currentVersion)` deny inertly, and a
`p4`-versioned input denies. Historical coverage that never depends on the current version stays as written:
the `p1`–`p4` catalogs under `decideUnderRegisteredVersion`, the four digest literals, the `p5`-only codes
absent from earlier versions, `role_not_permitted` for the `p5` roles under `p4`, and `profile.read` reserved
in `p1`.

**Application suites: edits required.** These were derived by reading the suites against the flip; they
could not be executed on this branch because `apps/**` and the release history are outside the
`PROTO-POLICY-V5-001` write scope. The Manager runs them at the flip. Api and worker copies of `test-support.ts`
stay byte-identical; `boundary.test.ts`, `subject-scoped.test.ts`, and `jobs.test.ts` are app-specific.

| File | Today | Required change at the flip |
| --- | --- | --- |
| `apps/api/src/authorization/boundary.test.ts` (test "rejects mismatched registry digest/schema and missing independent release history"), line 165 | `assert.equal(released.length, 3, "exactly three released policy rows")` | `released.length === 5`, "exactly five released policy rows" (form 1 passes through 4 at the `p4` step) |
| same test, lines 166–180 | `released[0]` asserted as `p1`, `released[1]` as `p2`, `released[2]` as `p3` | keep every `released[0]`–`released[2]` assertion unchanged as historical coverage; add `released[3]` assertions for `p4` exactly as `docs/cbd-236-p4-release-step.md` §4.4 lists them (digest `25b2f9e9…15a9`, `schemaVersion` 1, its two approval ids, non-empty `releaseCommit`); add `released[4]` assertions: `version` `p5`, `digest` `68eef40b40f0f04fb8c31cba6f08292bc39a4c98c0f1ccc248f548e561e2fec8`, `schemaVersion` 1, `productApprovalRef` and `securityApprovalRef` equal to the two approved `p5` record ids, non-empty `releaseCommit`; keep `assert.doesNotThrow(() => assertPolicyCompatibility(released))` — it now proves the `p5` tuple against five immutable rows |
| same test, mismatch cases, lines 155–159 | `[{ version: "p1", expectedDigest, schemaVersion: 99 }]` for two digests; `[{ version: "p2", … }]`; `[{ version: "p3", expectedDigest: "b4fbdb8e…923e4d", schemaVersion: 99 }]`; `{ ...SUPPORTED_POLICY_TUPLES[0]!, expectedDigest: "0".repeat(64) }` | the `SUPPORTED_POLICY_TUPLES[0]` cases follow the new tuple with no edit; the literal `version: "p1"`, `"p2"` and `"p3"` cases stay unchanged as historical literals (after the flip each fails on the version, which is still `policy_version_unsupported`); add one `{ version: "p5", expectedDigest: <p5 digest>, schemaVersion: 99 }` case so schema mismatch is still exercised against the current version (and the `p4` case from the `p4` step under form 1) |
| `apps/api/src/authorization/test-support.ts` and the worker copy, line 12 | `testHistory = [{ version: "p3", digest: SUPPORTED_POLICY_TUPLES[0]!.expectedDigest, ... }]` | `version: "p5"` (listed in §4.3); the digest already follows the tuple |
| `apps/api/src/authorization/subject-scoped.test.ts` | version-derived since the p3 flip: the positives iterate `SUBJECT_CELLS` (the five `p2` cells) through `subjectFixture(action, CURRENT_POLICY_VERSION)` and the real assembler; the negatives iterate `subjectNegativeFixtures(CURRENT_POLICY_VERSION)` | the negatives now include the three `invitation.*` cells; the `BOUNDARY_FAMILIES` entries drive them through the `Harness`, whose fact source is built from the fixture input, so no edit is expected, but run it: if the `Harness` cannot express an `invitation_ceremony` subject target, widen its fixture mapping. The positives stay on the five `p2` cells until `PK-6` lands the ceremony fact reader (`apps/api/src/sessions/budget-facts.ts` returns no facts for a non-`proposal` subject lookup, so an `invitation.read_ceremony` positive through the real assembler denies `input_invalid` today); once it lands, iterate `subjectCells(CURRENT_POLICY_VERSION)` instead of `SUBJECT_CELLS` so the invitee cells are proven through the assembler too |
| `apps/api/src/accounts/http.test.ts`, `apps/api/src/targets/http.test.ts`, `apps/api/src/transactions/http.test.ts`, `apps/api/src/budget-spaces/http.test.ts`, `apps/api/src/sessions/budget-facts.test.ts` | drive the baseline routes with a Primary Owner membership; `budget-facts.test.ts` line 124 uses a `co_owner` membership only to prove no membership property yields a consent fact (`input_invalid`, before any cell) | no edit; no application test asserts `role_not_permitted` for a Co-owner or Collaborator on a baseline route. The Manager should add, at the flip or in the increment that lands the members list, one positive route test per role on each row-1, 2a, 4, 9, 14 and 15 route (a `co_owner` and a `collaborator` membership through the real Fastify instance) and keep a Viewer denial, so the released behaviour is proven at the route and not only at `decide` (the `p4` step's §4.4 recommendation, widened) |
| `apps/worker/src/authorization/jobs.test.ts` (test "rejects startup mismatches ..."), lines 130–132 | derives its tuple from `SUPPORTED_POLICY_TUPLES[0]` and `testHistory` | no edit |
| `apps/api/src/authorization/inventory.test.ts` ("real API and worker processes start on the released policy p3 ..."), line 70 | reads the checked-in history through the real processes | no edit to the assertion; rename the test to say `p5`; the checked-in history now carries five rows and both processes must start on `p5` |
| `apps/api/src/authorization/inventory.test.ts` parity test ("prevents drift in the common enforcement code across deployment units") | compares api and worker copies byte for byte | no edit; it is the reason every §4.3 edit is applied to both apps |

Historical literals that must **stay unchanged** after the flip: the `p1`, `p2` and `p3` rows in the release
history and the `p4` row once appended (append-only guard), the `p1`–`p3` assertions on
`released[0]`–`released[2]`, the `P1_DIGEST`, `P2_DIGEST`, `P3_DIGEST` and `P4_DIGEST` literals in the
contracts tests, the `CBD236-P1-RELEASE-001`, `CBD236-SECURITY-001`, `PO-P2-APPROVAL-001`,
`PROTO-POLICY-V2-SEC-001`, `PO-P3-APPROVAL-001`, `PROTO-POLICY-V3-SEC-001-RESULT-001` and
`PROTO-POLICY-V4-SEC-001-RESULT-001` references, and the `version: "p1"`, `"p2"` and `"p3"` mismatch literals
above.

## 5. Verification after applying, before pushing

```bash
npm run check:authorization-policy-history
npm test --workspace=@cobudget/contracts
npm test --workspace=@cobudget/api
npm test --workspace=@cobudget/worker
npm run check
```

Expected: the history check reports the five released rows append-only, approved, and digest-pinned; every
suite passes; `npm run check` prints its own final verdict line (run its stages sequentially on this machine;
a single background `npm run check` has been killed for low memory during the api tests). Then the
`python scripts/secret_scanner.py range` step and the pull request as for any change.

## 6. After the merge

Sweep for what the release falsifies: the CBD-236 contract header status, the §8.7.3 and §8.8.3 status
sentences ("registered and not released"), §8.7.4 and §8.8.4, the §12 CBD-196/200 non-owner row and the §12
invitations row, `HO-236-10`'s "until §8.7.4 is applied" clause and `HO-236-11`'s "until §8.8.4 is applied"
clause, all of which become historical and need a v0.12 note; the `PK-6` and `PK-7` routes may then rely on the
`p5` cells; the unpublished manifest entries for this document and the `p4` step may be reopened only in a
focused change. `OQ-236-012` and `OQ-236-013` are answered by the Product Owner approval that precedes this
step and are closed by reference to it.

## 7. Revision history

| Version | Date | Author | Change |
| --- | --- | --- | --- |
| 0.2 | September 15, 2026 | Manager, applying this step | Applied in the combined form of §1 form 2 under `PO-P4P5-APPROVAL-001`: one commit appends the `p4` row (`PO-P4P5-APPROVAL-001`, `PROTO-POLICY-V4-SEC-001-RESULT-001`, `releaseCommit` `696d831ab25a226cc178c27e7111ef75c2ffd579`) and then the `p5` row (`PO-P4P5-APPROVAL-001`, `PROTO-POLICY-V5-SEC-001-RESULT-001`, `releaseCommit` `c4add46cb6103e9a2c2b7ee8d14a9afb8afa0acc`), flips `CURRENT_POLICY_VERSION` from `p3` straight to `p5`, and applies the §4.3 literals and the §4.4 test changes. `p4` is released and never deployed. All five digests reproduced before the edit and `P1_DIGEST`–`P4_DIGEST` are unchanged. Two §4.4 predictions held: `subject-scoped.test.ts` needed no edit (165/165 with the `Harness` expressing the `invitation_ceremony` subject target unaided), and the contracts suite needed no edit. Two §3/§4.4 statements were imprecise: the §3 digest one-liner needs `node --import=tsx` to import a `.ts` module, and the §4.4 count of 36 is the `authorization.test.ts` file alone, not the workspace suite. Contracts 65/65, api 475/477 (2 skipped, live PostgreSQL), worker 52/52. |
| 0.1 | September 15, 2026 | Architecture under `PROTO-POLICY-V5-001` | Initial ready-to-apply release step with the `p4`-first-or-combined rule, the reproducible `p5` digest, the exact history row, the registry flip, every application literal that pins the current version, the contracts suite proven version-derived under a simulated flip, and every application test change the flip requires with the historical `p1`–`p4` literals that stay. Not applied. |
