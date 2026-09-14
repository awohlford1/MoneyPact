# CBD-236 — Policy version 2 release step

| Field | Value |
| --- | --- |
| Status | **Applied** — `releaseCommit` `c4aac07b133e50ece1c0de327c8e1c634c19617f`; `p2` is released |
| Document version | 0.2 |
| Governing contract | [`docs/cbd-236-authorization-policy-contract.md`](./cbd-236-authorization-policy-contract.md) v0.5.1 §6 `PC-236-011`, `PC-236-013`, §8.5 |
| Governing decisions | `CBD236-POLICY-APPROVAL-001` (Product Owner and Security sign-off cited in every released row); `PROTO-POLICY-V2-DECISION-001` (add `p2` through an Architecture packet and a following Security review; release requires both approvals as separate records) |
| Jira subtask | [CBD-236](https://cobudget.atlassian.net/browse/CBD-236) |
| Written by | Architecture, assignment `PROTO-POLICY-V2-001`, September 13, 2026 |
| Applied by | Manager, in one commit, after both approval records exist |

## 1. What this step does and does not do

It releases policy version `p2` as the current deployed policy. It does not add or change a cell: `p2` is
already registered next to `p1` in `packages/contracts/src/authorization/policy/registry.ts` with its own
digest, every `p1` cell is byte-identical in `p2`, and the contracts tests already prove the `p2` cells and
their negative families (`npm test --workspace=@cobudget/contracts`).

Until this step lands, `decide` denies any `p2` input `policy_version_unsupported`, `policyCompatibility`
is false for `p2`, and both applications start against `p1`. Nothing below may be applied piecemeal: the
history row without the flip leaves `p2` released but undeployed, and the flip without the row makes the
API and worker refuse to start (`policy_version_unsupported`), which is the fail-closed behaviour the
contract requires.

## 2. Preconditions (both must be resolvable record identifiers)

| Precondition | Record | Value to cite |
| --- | --- | --- |
| Product Owner approval of the `p2` cells in contract §8.5.1 at exact v0.5 | an `approval` record under `.agent-state/approvals/` | its `id` → `productApprovalRef` |
| Security clearance of the v0.5 amendment and the `p2` fixtures | the `PROTO-POLICY-V2-SEC-001` result with disposition `clear` (or `remediate` with every condition closed) | its `id` → `securityApprovalRef` |

`releaseCommit` is the full SHA of the `main` commit that carries the `p2` registry and fixtures, that is,
the merge commit of the `PROTO-POLICY-V2-001` pull request. Record it after that merge.

## 3. The digest

Reproduce the digest from the branch before applying; the value below was computed at the revision this
document was written at and the history guard fails if the registry no longer hashes to it:

```bash
node -e "import('./packages/contracts/src/authorization/policy/registry.ts').then((m) => console.log(m.P2_DIGEST))"
```

Expected output:

```text
374e0b4d2ae86d53afe3fdf02a9d91e52d7b95b2e67df75b975bb54b4163d322
```

`P1_DIGEST` must still print `488d46739bee379870f6649a6b51aaccc97b4bfdec9519fae5ed93b581ce1f22`.

## 4. The change, file by file

### 4.1 `config/authorization-policy-release-history.json` — append exactly this row

The `p1` row is not touched. Replace the three placeholders in angle brackets; every field must be a
non-empty string or integer, and the row must contain exactly these six keys.

```json
  {
    "version": "p2",
    "digest": "374e0b4d2ae86d53afe3fdf02a9d91e52d7b95b2e67df75b975bb54b4163d322",
    "schemaVersion": 1,
    "releaseCommit": "<full SHA of the main merge commit carrying the p2 registry>",
    "productApprovalRef": "<approval record id>",
    "securityApprovalRef": "<PROTO-POLICY-V2-SEC-001 result id>"
  }
```

### 4.2 `packages/contracts/src/authorization/policy/registry.ts` — the flip

```ts
export const CURRENT_POLICY_VERSION = "p1" as const;
```

becomes

```ts
export const CURRENT_POLICY_VERSION = "p2" as const;
```

Nothing else in the registry changes. `POLICY_SERIALIZATION`, `CURRENT_POLICY`, and `policyCompatibility`
follow the constant.

### 4.3 Application pins that name `p1` by literal (byte-identical between `apps/api` and `apps/worker`)

`PC-236-013` requires each application to pin its tuple independently of the registry, so the flip is not
one line. The `inventory.test.ts` parity test requires the api and worker copies of `compatibility.ts`,
`facts.ts`, and `test-support.ts` to stay byte-identical; apply each edit to both.

| File (api and worker) | Line today | Change |
| --- | --- | --- |
| `src/authorization/compatibility.ts` | `Object.freeze({ version: "p1", expectedDigest: "488d4673…1f22", schemaVersion: 1 })` in `SUPPORTED_POLICY_TUPLES` | replace with `Object.freeze({ version: "p2", expectedDigest: "374e0b4d2ae86d53afe3fdf02a9d91e52d7b95b2e67df75b975bb54b4163d322", schemaVersion: 1 })` — one tuple, `supported.length` stays 1 |
| `src/authorization/compatibility.ts` | `const tuple = supported.find((item) => item.version === "p1");` | `=== "p2"` |
| `src/authorization/facts.ts` | `versions: { policyVersion: "p1", ...` | `policyVersion: "p2"` |
| `src/authorization/test-support.ts` | `testHistory = [{ version: "p1", digest: SUPPORTED_POLICY_TUPLES[0]!.expectedDigest, ...` | `version: "p2"` |
| `apps/worker/src/authorization/jobs.ts` only | `key === "policyVersion" ? item !== "p1" :` in the claimed-versions check | `item !== "p2"` |

A cleaner follow-up is to derive these literals from `CURRENT_POLICY_VERSION` where the contract allows
it (`facts.ts`, `test-support.ts`, `jobs.ts`); `compatibility.ts` must keep its literal pin by `PC-236-013`.
That refactor is outside this step.

### 4.4 Tests the flip changes, and the historical `p1` literals that stay

The contracts suite is version-derived and needs **no edit**: with `CURRENT_POLICY_VERSION` flipped to `p2` on the
branch (history row absent, contracts only) `npm test --workspace=@cobudget/contracts` passed 46/46. Its
`POLICY-V2-03` test branches on the current version: before the flip it proves every `p2` input denies
`policy_version_unsupported` through `decide`; after the flip it proves the subject-scoped cells allow through
`decide`, every `P2_NEGATIVE_FIXTURES` entry denies inertly through `decide`, and a `p1`-versioned input denies.
Historical `p1` coverage (the `p1` catalog under `decideUnderRegisteredVersion("p1")`, the `P1_DIGEST` literal
`488d4673…1f22`, `profile.read` reserved in `p1`, the p2-only codes absent from `p1`) never depends on the current
version and stays as written.

The application suites are not version-derived where they pin the release history, so the flip must edit them
(api and worker copies of `test-support.ts` stay byte-identical; `boundary.test.ts` and `jobs.test.ts` are
app-specific):

| File | Today | Required change at the flip |
| --- | --- | --- |
| `apps/api/src/authorization/boundary.test.ts` (test "rejects mismatched registry digest/schema and missing independent release history") | `assert.equal(released.length, 1, "exactly one released policy row")`; `released[0]` asserted as `p1` with `PO-CONTRACT-APPROVALS-001` / `CBD236-SECURITY-001`; `assert.doesNotThrow(() => assertPolicyCompatibility(released))` | assert `released.length === 2`; keep every `released[0]` (`p1`) assertion unchanged as historical coverage; add `released[1]` assertions: `version` `p2`, `digest` `374e0b4d2ae86d53afe3fdf02a9d91e52d7b95b2e67df75b975bb54b4163d322`, `schemaVersion` 1, `productApprovalRef` and `securityApprovalRef` equal to the two approved record ids, non-empty `releaseCommit`; keep `assertPolicyCompatibility(released)` — it now proves the `p2` tuple against both immutable rows |
| same test, mismatch cases | `[{ version: "p1", expectedDigest, schemaVersion: 99 }]` and `SUPPORTED_POLICY_TUPLES[0]` | the `SUPPORTED_POLICY_TUPLES[0]` cases follow the new tuple with no edit; the literal `version: "p1"` case stays unchanged as a historical literal (after the flip it fails on the version, which is still `policy_version_unsupported`); add one `{ version: "p2", expectedDigest: P2 digest, schemaVersion: 99 }` case so schema mismatch is still exercised against the current version |
| `apps/api/src/authorization/test-support.ts` and the worker copy | `testHistory = [{ version: "p1", digest: SUPPORTED_POLICY_TUPLES[0]!.expectedDigest, ... }]` | `version: "p2"` (listed in §4.3); the digest already follows the tuple |
| `apps/worker/src/authorization/jobs.test.ts` (test "rejects startup mismatches ...") | derives its tuple from `SUPPORTED_POLICY_TUPLES[0]` and `testHistory` | no edit |
| `apps/api/src/authorization/inventory.test.ts` ("real API and worker processes start on the released policy p1 ...") | reads the checked-in history through the real processes | no edit to the assertion; the test name may be renamed to say `p2`; the checked-in history now carries two rows and both processes must start on `p2` |

Historical `p1` literals that must **stay unchanged** after the flip: the `p1` row in the release history (append-only guard), the `p1` assertions on `released[0]`, the `P1_DIGEST` literal in the contracts tests, `CBD236-P1-RELEASE-001` and `CBD236-SECURITY-001` references, and the `version: "p1"` mismatch literal above.

## 5. Verification after applying, before pushing

```bash
npm run check:authorization-policy-history
npm test --workspace=@cobudget/contracts
npm test --workspace=@cobudget/api
npm test --workspace=@cobudget/worker
npm run check
```

Expected: the history check reports the two released rows append-only, approved, and digest-pinned; every
suite passes; `npm run check` prints its own final verdict line. Then the `python scripts/secret_scanner.py
range` step and the pull request as for any change.

## 6. After the merge

Sweep for what the release falsifies: the CBD-236 contract §8.5.3 status sentence ("registered and not
released") and §12 row for CBD-232/CBD-233 become historical and need a v0.6 note; the
`PROTO-PROPOSALS-API-001` and `PROTO-IDENTITY-API-001` streams may then rely on the `p2` cells; the
unpublished manifest entry for this document may be reopened only in a focused change.

## 7. Revision history

| Version | Date | Author | Change |
| --- | --- | --- | --- |
| 0.2 | September 14, 2026 | Architecture under `PROTO-POLICY-V2-001`, remediation of `SEC-P2-F6` | §4.4 rewritten: the contracts suite is version-derived and proven to pass under a simulated flip; every application test change the flip requires is listed with the historical `p1` literals that stay. |
| 0.1 | September 13, 2026 | Architecture under `PROTO-POLICY-V2-001` | Initial ready-to-apply release step with the reproducible `p2` digest, the exact history row, the registry flip, and every application literal that pins `p1`. Not applied. |
