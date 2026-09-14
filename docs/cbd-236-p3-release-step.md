# CBD-236 — Policy version 3 release step

| Field | Value |
| --- | --- |
| Status | **Not applied** — `p3` is registered and not released; `p2` is current |
| Document version | 0.1 |
| Governing contract | [`docs/cbd-236-authorization-policy-contract.md`](./cbd-236-authorization-policy-contract.md) v0.8 §6 `PC-236-011`, `PC-236-013`, §8.6 |
| Governing decisions | `CBD236-POLICY-APPROVAL-001` (Product Owner and Security sign-off cited in every released row); `PROTO-POLICY-V2-DECISION-001` precedent (add a version through an Architecture packet and a following Security review; release requires both approvals as separate records) |
| Jira subtask | [CBD-236](https://cobudget.atlassian.net/browse/CBD-236) |
| Written by | Architecture, assignment `PROTO-POLICY-V3-001`, September 14, 2026 |
| Applied by | Manager, in one commit, after both approval records exist |

## 1. What this step does and does not do

It releases policy version `p3` as the current deployed policy. It does not add or change a cell: `p3` is
already registered next to `p1` and `p2` in `packages/contracts/src/authorization/policy/registry.ts` with
its own digest, every `p2` cell (and therefore every `p1` cell) is byte-identical in `p3`, and the contracts
tests already prove the five `p3` cells and their negative families (`npm test --workspace=@cobudget/contracts`).

Until this step lands, `decide` denies any `p3` input `policy_version_unsupported`, `policyCompatibility`
is false for `p3`, and both applications start against `p2`. Nothing below may be applied piecemeal: the
history row without the flip leaves `p3` released but undeployed, and the flip without the row makes the
API and worker refuse to start (`policy_version_unsupported`), which is the fail-closed behaviour the
contract requires.

## 2. Preconditions (both must be resolvable record identifiers)

| Precondition | Record | Value to cite |
| --- | --- | --- |
| Product Owner approval of the `p3` cells in contract §8.6.1 at exact v0.8, including the interim `manual_account` governing source (`OQ-236-011`) | an `approval` record under `.agent-state/approvals/` | its `id` → `productApprovalRef` |
| Security clearance of the v0.8 amendment and the `p3` fixtures | the Security result for the `p3` candidate with disposition `clear` (or `remediate` with every condition closed) | its `id` → `securityApprovalRef` |

`releaseCommit` is the full SHA of the `main` commit that carries the `p3` registry and fixtures, that is,
the merge commit of the `PROTO-POLICY-V3-001` pull request. Record it after that merge.

## 3. The digest

Reproduce the digest from the branch before applying; the value below was computed at the revision this
document was written at and the history guard fails if the registry no longer hashes to it:

```bash
node -e "import('./packages/contracts/src/authorization/policy/registry.ts').then((m) => console.log(m.P3_DIGEST))"
```

Expected output:

```text
b4fbdb8e32a6155705877d7c91846ee855dc717dfce9d57a6f04e07301923e4d
```

`P1_DIGEST` must still print `488d46739bee379870f6649a6b51aaccc97b4bfdec9519fae5ed93b581ce1f22` and
`P2_DIGEST` must still print `374e0b4d2ae86d53afe3fdf02a9d91e52d7b95b2e67df75b975bb54b4163d322`; both are
now pinned as literals in the contracts tests (`POLICY-V3-01`).

## 4. The change, file by file

### 4.1 `config/authorization-policy-release-history.json` — append exactly this row

The `p1` and `p2` rows are not touched. Replace the three placeholders in angle brackets; every field must
be a non-empty string or integer, and the row must contain exactly these six keys.

```json
  {
    "version": "p3",
    "digest": "b4fbdb8e32a6155705877d7c91846ee855dc717dfce9d57a6f04e07301923e4d",
    "schemaVersion": 1,
    "releaseCommit": "<full SHA of the main merge commit carrying the p3 registry>",
    "productApprovalRef": "<approval record id>",
    "securityApprovalRef": "<Security result id for the p3 candidate>"
  }
```

### 4.2 `packages/contracts/src/authorization/policy/registry.ts` — the flip

```ts
export const CURRENT_POLICY_VERSION = "p2" as const;
```

becomes

```ts
export const CURRENT_POLICY_VERSION = "p3" as const;
```

Nothing else in the registry changes. `POLICY_SERIALIZATION`, `CURRENT_POLICY`, and `policyCompatibility`
follow the constant. Update the comment above the constant to say `p3` was released by this document.

### 4.3 Application literals that name `p2` (byte-identical between `apps/api` and `apps/worker`)

`PC-236-013` requires each application to pin its tuple independently of the registry, so the flip is not
one line. The `inventory.test.ts` parity test requires the api and worker copies of `compatibility.ts`,
`facts.ts`, and `test-support.ts` to stay byte-identical; apply each edit to both. These are every
production and test-support literal that names `p2` in the two applications at the revision this document
was written at (`grep -rn '"p2"' apps/api/src apps/worker/src`).

| File (api and worker) | Line today | Change |
| --- | --- | --- |
| `src/authorization/compatibility.ts` line 10 | `Object.freeze({ version: "p2", expectedDigest: "374e0b4d…4163d322", schemaVersion: 1 })` in `SUPPORTED_POLICY_TUPLES` | replace with `Object.freeze({ version: "p3", expectedDigest: "b4fbdb8e32a6155705877d7c91846ee855dc717dfce9d57a6f04e07301923e4d", schemaVersion: 1 })` — one tuple, `supported.length` stays 1 |
| `src/authorization/compatibility.ts` line 26 | `const tuple = supported.find((item) => item.version === "p2");` | `=== "p3"` |
| `src/authorization/facts.ts` line 146 | `versions: { policyVersion: "p2", ...` | `policyVersion: "p3"` |
| `src/authorization/test-support.ts` line 12 | `testHistory = [{ version: "p2", digest: SUPPORTED_POLICY_TUPLES[0]!.expectedDigest, ...` | `version: "p3"` |
| `apps/worker/src/authorization/jobs.ts` line 71 only | `key === "policyVersion" ? item !== "p2" :` in the claimed-versions check | `item !== "p3"` |

`compatibility.ts` must keep its literal pin by `PC-236-013`. Deriving `facts.ts`, `test-support.ts`, and
`jobs.ts` from `CURRENT_POLICY_VERSION` remains the cleaner follow-up the p2 step named; it is outside this
step. The stub `policyVersion: "p1"` values with an all-`a` digest in
`packages/budget-application/src/persistence/*.test.ts` are fake authorizer results that never reach the
registry or the release history; they are not pins and are not edited.

### 4.4 Tests the flip changes, and the historical `p1` and `p2` literals that stay

**Contracts suite: no edit.** With `CURRENT_POLICY_VERSION` flipped to `p3` on the branch (history row absent,
contracts only) `npm test --workspace=@cobudget/contracts` passed 52/52 and `tsc --noEmit` passed; the
constant was then restored to `p2`. The suite is version-derived at every point that touched a version in the
p2 step's remediation (`SEC-P2-F6`): `AC07` selects the positive catalog through `CATALOGS[currentVersion]`
(`p1`, `p2`, `p3`); `POLICY-V2-03` proves the subject cells and `subjectNegativeFixtures(currentVersion)`
through `decide` for any current version at or after `p2`; `POLICY-V3-03` branches on whether `p3` is current
— before the flip every `p3` input denies `policy_version_unsupported` through `decide` and a `p3`-only code is
`input_unsupported`; after it the five cells allow through `decide` with their `user` cellRef,
`accountNegativeFixtures(currentVersion)` denies inertly through `decide`, and a `p2`-versioned bootstrap input
denies. Historical coverage that never depends on the current version stays as written: the `p1` and `p2`
catalogs under `decideUnderRegisteredVersion`, both digest literals, the `p2`-only and `p3`-only codes absent
from earlier versions, and `profile.read` reserved in `p1`.

**Application suites: edits required.** These were derived by reading the suites against the flip; they
could not be executed on this branch because `apps/**` and the release history are outside the
`PROTO-POLICY-V3-001` write scope. The Manager runs them at the flip. Api and worker copies of `test-support.ts`
stay byte-identical; `boundary.test.ts`, `subject-scoped.test.ts`, and `jobs.test.ts` are app-specific.

| File | Today | Required change at the flip |
| --- | --- | --- |
| `apps/api/src/authorization/boundary.test.ts` (test "rejects mismatched registry digest/schema and missing independent release history"), line 163 | `assert.equal(released.length, 2, "exactly two released policy rows")` | `released.length === 3`, "exactly three released policy rows" |
| same test, lines 164–171 | `released[0]` asserted as `p1` (`PO-CONTRACT-APPROVALS-001`, `CBD236-SECURITY-001`); `released[1]` asserted as `p2` with digest `374e0b4d…4163d322`, `schemaVersion` 1, `PO-P2-APPROVAL-001`, `PROTO-POLICY-V2-SEC-001`, non-empty `releaseCommit` | keep every `released[0]` and `released[1]` assertion unchanged as historical coverage; add `released[2]` assertions: `version` `p3`, `digest` `b4fbdb8e32a6155705877d7c91846ee855dc717dfce9d57a6f04e07301923e4d`, `schemaVersion` 1, `productApprovalRef` and `securityApprovalRef` equal to the two approved record ids, non-empty `releaseCommit`; keep `assert.doesNotThrow(() => assertPolicyCompatibility(released))` — it now proves the `p3` tuple against three immutable rows |
| same test, mismatch cases, lines 155–158 | `[{ version: "p1", expectedDigest, schemaVersion: 99 }]` for two digests; `[{ version: "p2", expectedDigest: SUPPORTED_POLICY_TUPLES[0]!.expectedDigest, schemaVersion: 99 }]`; `{ ...SUPPORTED_POLICY_TUPLES[0]!, expectedDigest: "0".repeat(64) }` | the `SUPPORTED_POLICY_TUPLES[0]` cases follow the new tuple with no edit; the literal `version: "p1"` and `version: "p2"` cases stay unchanged as historical literals (after the flip each fails on the version, which is still `policy_version_unsupported`); add one `{ version: "p3", expectedDigest: <p3 digest>, schemaVersion: 99 }` case so schema mismatch is still exercised against the current version |
| `apps/api/src/authorization/test-support.ts` and the worker copy, line 12 | `testHistory = [{ version: "p2", digest: SUPPORTED_POLICY_TUPLES[0]!.expectedDigest, ... }]` | `version: "p3"` (listed in §4.3); the digest already follows the tuple |
| `apps/api/src/authorization/subject-scoped.test.ts` | builds `Harness(subjectFixture(action))` and iterates `P2_NEGATIVE_FIXTURES`, both pinned to `p2` by the contracts fixture default; the real `FactAssembler` restamps `versions.policyVersion` from the `facts.ts` literal, so the pinned value never reaches `decide` | no edit expected once `facts.ts` says `p3`; the reason assertions are version-independent. If the Manager prefers the fixtures to say what they prove, pass `"p3"` (or `CURRENT_POLICY_VERSION`) to `subjectFixture` and switch to `subjectNegativeFixtures("p3")`, both exported from `packages/contracts/src/authorization/fixtures/index.ts` |
| `apps/worker/src/authorization/jobs.test.ts` (test "rejects startup mismatches ..."), lines 129–132 | derives its tuple from `SUPPORTED_POLICY_TUPLES[0]` and `testHistory` | no edit |
| `apps/api/src/authorization/inventory.test.ts` ("real API and worker processes start on the released policy p2 ..."), line 70 | reads the checked-in history through the real processes | no edit to the assertion; rename the test to say `p3`; the checked-in history now carries three rows and both processes must start on `p3` |
| `apps/api/src/authorization/inventory.test.ts` parity test ("prevents drift in the common enforcement code across deployment units") | compares api and worker copies byte for byte | no edit; it is the reason every §4.3 edit is applied to both apps |

Historical literals that must **stay unchanged** after the flip: the `p1` and `p2` rows in the release
history (append-only guard), the `p1` and `p2` assertions on `released[0]` and `released[1]`, the `P1_DIGEST`
and `P2_DIGEST` literals in the contracts tests, the `CBD236-P1-RELEASE-001`, `CBD236-SECURITY-001`,
`PO-P2-APPROVAL-001`, and `PROTO-POLICY-V2-SEC-001` references, and the `version: "p1"` and `version: "p2"`
mismatch literals above.

## 5. Verification after applying, before pushing

```bash
npm run check:authorization-policy-history
npm test --workspace=@cobudget/contracts
npm test --workspace=@cobudget/api
npm test --workspace=@cobudget/worker
npm run check
```

Expected: the history check reports the three released rows append-only, approved, and digest-pinned; every
suite passes; `npm run check` prints its own final verdict line. Then the `python scripts/secret_scanner.py
range` step and the pull request as for any change.

## 6. After the merge

Sweep for what the release falsifies: the CBD-236 contract header status, §8.6.3 status sentence ("registered
and not released"), §8.6.4, and the §12 row for CBD-196/200/209/211 become historical and need a v0.9 note;
`HO-236-09` may then be relied on for an allow; the `PROTO-INCREMENT-B-001` routes may rely on the `p3` cells;
the unpublished manifest entry for this document may be reopened only in a focused change. `OQ-236-011` stays
open until CBD-72 carries the manual-account row.

## 7. Revision history

| Version | Date | Author | Change |
| --- | --- | --- | --- |
| 0.1 | September 14, 2026 | Architecture under `PROTO-POLICY-V3-001` | Initial ready-to-apply release step with the reproducible `p3` digest, the exact history row, the registry flip, every application literal that pins `p2`, the contracts suite proven version-derived under a simulated flip, and every application test change the flip requires with the historical `p1` and `p2` literals that stay. Not applied. |
