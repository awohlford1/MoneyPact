# CBD-236 — Policy version 2 release step

| Field | Value |
| --- | --- |
| Status | **Ready to apply after approvals** — not applied; `p2` is registered and not released |
| Document version | 0.1 |
| Governing contract | [`docs/cbd-236-authorization-policy-contract.md`](./cbd-236-authorization-policy-contract.md) v0.5 §6 `PC-236-011`, `PC-236-013`, §8.5 |
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

### 4.4 Tests that need no edit

The contracts tests default fixtures to `CURRENT_POLICY_VERSION`, evaluate each versioned catalog under its
own version, and derive "registered but not current" from the registry, so they pass on either side of the
flip. `boundary.test.ts` and `jobs.test.ts` read `SUPPORTED_POLICY_TUPLES[0]` and `testHistory`.

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
| 0.1 | September 13, 2026 | Architecture under `PROTO-POLICY-V2-001` | Initial ready-to-apply release step with the reproducible `p2` digest, the exact history row, the registry flip, and every application literal that pins `p1`. Not applied. |
