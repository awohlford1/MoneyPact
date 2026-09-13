# `@cobudget/budget-application`

Application layer for CBD-232 versioned budget-creation proposals and
schedule previews. Implements
[`docs/cbd-232-budget-creation-proposal-contract.md`](../../docs/cbd-232-budget-creation-proposal-contract.md)
(v0.2.1, Proposed) against the approved consumption boundary in
[`docs/cbd-168-budget-domain-consumption-contract.md`](../../docs/cbd-168-budget-domain-consumption-contract.md).

## Scope

- `src/creation-proposals/` — the package's only public module
  (`@cobudget/budget-application/creation-proposals`). Owns normalization,
  validation composition, preview assembly, proposal state transitions,
  canonical serialization, digests, binding verification, and the
  persistence-independent ports the contract's §9 defines.
- No NestJS decorator, database client, provider SDK, or direct
  clock/randomness access appears anywhere in this package (enforced by
  `eslint.config.mjs`). `apps/api` is expected to bind these functions and
  types to the contract's §4 HTTP shape; that binding is not part of this
  package.
- The only persistence adapter shipped here is `InMemoryProposalStore`, for
  tests. The durable, tenant-scoped adapter belongs to CBD-246.

## Consumption of `@cobudget/budget-domain`

Only the subpath and exports the contract's §3.1 lists are imported, from
`@cobudget/budget-domain/schedule` and `@cobudget/budget-domain/shared`, per
the CBD-168 Approved consumption contract (workspace-internal TypeScript
source, no deep or relative import into `packages/budget-domain`).

## Notable assumptions (contract gaps; see the implementation task report for
the complete list)

- A "named IANA time zone" is treated as valid only when it resolves through
  `Intl` and its canonical form contains an `Area/Location` separator, which
  accepts every real place-based zone and rejects bare abbreviations (`EST`),
  `UTC`, and fixed offsets.
- `PreviewWarning`'s item shape, the exact `ProposalRecord`/`IdempotencyRecord`
  persistence shapes, and the bare (non-idempotency) `replaceCurrent`
  eligibility conflict (`predecessor_conflict`) are this implementation's
  choices; the contract text fixes the wire responses and the port method
  signatures, not these persistence-internal shapes.
- `BudgetCreationConstraintReader` (CBD-231) and
  `BudgetCreationConfirmationUnitOfWork` (CBD-233) are declared and, for the
  unit-of-work, given an in-memory implementation, so tests can exercise
  predecessor-eligibility rules against a genuinely confirmed proposal — but
  this package does not implement CBD-231's constraints or CBD-233's
  confirmation transaction, which are out of scope.

## Testing

```sh
npm run test --workspace=@cobudget/budget-application
```

Tests use `node:test` with injected `Clock`, `OpaqueIdGenerator`, and
`BindingKeyring` fakes (`test-support.ts`); no live provider or wall clock is
required, per the contract's §11.
