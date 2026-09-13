# CBD-231 — Budget-space lifecycle and creation constraints

| Field | Value |
| --- | --- |
| Status | **Proposed — implementation, independent review, and database evidence pending** |
| Document version | 0.1 |
| Jira subtask | [CBD-231](https://cobudget.atlassian.net/browse/CBD-231) |
| Parent | [CBD-23](https://cobudget.atlassian.net/browse/CBD-23) |
| Database baseline | PostgreSQL 17 (`CBD117-PG-MAJOR-001`) |
| Last updated | September 12, 2026 |

## 1. Purpose and authority

This contract defines the durable identity, lifecycle, ownership, schedule
references, creation outcome, constraints, and persistence port for a budget
space. It is a specification, not a migration or implementation claim.

The controlling product rules are CBD-72 `PM-72-008` (one active Primary
Owner), `PM-72-010` (cross-space isolation), and the approved CBD-76 boundary.
The initial schedule follows approved CBD-71 `SD-071-020` through
`SD-071-025`, `SD-071-029`, `SD-071-030`, `SD-071-047` through
`SD-071-049`, and the CBD-68 cadence rules. CBD-236 supplies the bootstrap
authorization input and commit-recheck protocol. `PROTOTYPE-SLICE-001` is an
evidence milestone and does not remove archival or non-monthly cadence support.

## 2. Scope and invariants

### 2.1 In scope

This contract fixes the logical and physical constraint model for budget-space
creation, rename, and archive; the creator's initial membership; references to
the first schedule version and current period; creation idempotency outcomes;
and the persistence seam assigned to CBD-246.

### 2.2 Out of scope

Schedule-generation algorithms and schedule-version internals belong to
CBD-26, CBD-27, and CBD-29. Categories, targets, bills, goals, transactions,
additional memberships, account-to-budget links, deletion execution, and
restoration are not creation-transaction participants. This document does not
change their approved Private-MVP status.

### 2.3 Binding invariants

| ID | Invariant |
| --- | --- |
| `BSL-231-001` | A budget space has an opaque immutable identifier. Names are not identifiers and duplicates are allowed. |
| `BSL-231-002` | The persisted name is NFC-normalized, has Unicode whitespace trimmed and collapsed to one ASCII space, and contains 1–100 extended grapheme clusters. |
| `BSL-231-003` | One canonical named IANA time zone and one ISO 4217 currency code are copied into the budget as authoritative context, with the catalog versions used to validate them. Later personal-default changes do not change either value. |
| `BSL-231-004` | A persistent budget space has exactly one active Primary Owner membership at every committed state. Creation makes the creator that owner in the same transaction. |
| `BSL-231-005` | Creation success requires exactly one initial authoritative schedule version and exactly one active current period belonging to that version and budget. |
| `BSL-231-006` | `live` and `archived` are durable lifecycle states. “Active” in CBD-231 maps to `live`; archival preserves identity, membership, schedule, period, history, and references and is never deletion. |
| `BSL-231-007` | Rename and lifecycle changes use independent monotonic versions. A stale expected version writes nothing. |
| `BSL-231-008` | A proposal can be consumed by at most one creation operation, and a confirmation idempotency identity can own at most one terminal success outcome. |
| `BSL-231-009` | Every creation write, including audit and outcome, commits or rolls back as one unit. No recoverable budget is exposed before that commit. |
| `BSL-231-010` | Tenant/coherence constraints use composite keys containing `budget_space_id`; an identifier from another budget or subject context cannot satisfy a reference. |

## 3. Logical records

All identifiers are opaque server-generated values. Timestamps are RFC 3339
UTC instants; budget dates are ISO date-only values interpreted in the stored
time zone. Integer versions begin at 1 and only increase.

### 3.1 Budget space

| Field | Constraint and meaning |
| --- | --- |
| `budget_space_id` | Immutable primary key; never derived from name, subject, or proposal. |
| `name` | Persisted normalized value satisfying `BSL-231-002`; no uniqueness constraint. |
| `name_version` | Starts at 1; increments only after a successful rename. |
| `time_zone` | Canonical named IANA zone, not an offset or abbreviation. |
| `time_zone_data_version` | Exact deployed time-zone dataset used at confirmation. |
| `currency_code` | Uppercase supported ISO 4217 code. |
| `currency_catalog_version` | Exact catalog identity used at confirmation. |
| `lifecycle` | Closed set `live`, `archived`. |
| `lifecycle_version` | Starts at 1; increments exactly once per successful lifecycle transition. |
| `primary_owner_membership_id` | Required composite reference to one active `primary_owner` membership in this budget. |
| `initial_schedule_version_id` | Immutable required composite reference to sequence 1, status `authoritative`, in this budget. |
| `current_period_id` | Required composite reference to the one `active` period under the current authoritative schedule version and this budget. |
| `current_schedule_version_id` | Required composite reference; equals `initial_schedule_version_id` at creation. |
| `created_by_subject_id`, `created_at`, `updated_at` | Creator provenance and audit hooks; creator identity is not itself membership authority. |

Time zone and currency are independently authoritative from profile defaults.
This version does not define post-creation mutation of either. A future approved
change must add its own version, history, recomputation, and compatibility rule
rather than editing the original validation-version fields.

### 3.2 Membership

The creation transaction inserts exactly one membership:

| Field | Creation value / constraint |
| --- | --- |
| `membership_id` | Server-generated opaque key. |
| `budget_space_id` | Composite parent key; cannot reference another budget. |
| `profile_id`, `account_subject_id` | Current creator profile and subject loaded by CBD-236 bootstrap authorization. |
| `role` | Literal `primary_owner`. |
| `status` | Literal `active`. |
| `authorization_version` | 1. |
| `created_by_subject_id` | Same current subject. |

A partial unique index on `budget_space_id WHERE role = 'primary_owner' AND
status = 'active'` rejects a second active Primary Owner. A deferred constraint
trigger validates at commit that every persistent budget points to one such row
and that the row points back to the same budget. Foreign keys reject orphaned
memberships. Additional membership creation is outside this transaction.

### 3.3 Schedule and period references

CBD-26 owns schedule payloads and generation. This contract requires the
schedule store to expose composite uniqueness on
`(budget_space_id, schedule_version_id)` and periods on
`(budget_space_id, schedule_version_id, period_id)` so the budget references
cannot be satisfied cross-budget.

The creation transaction persists one schedule version with sequence `1`,
status `authoritative`, exact cadence definition, proposal preview digest, and
all governing version identities. It persists the immutable periods from the
reviewed proposal preview. Exactly one period contains the confirmed
budget-local date and has status `active`; later preview periods have status
`planned`. A partial unique index permits at most one `active` period per
budget. A deferred constraint trigger proves at commit that the budget's
`current_period_id` belongs to its `current_schedule_version_id` and that its
initial schedule has sequence 1. A unique creation-origin key permits no second
initial schedule.

### 3.4 Creation operation and success outcome

| Record | Required identity and rule |
| --- | --- |
| `budget_creation_operation` | One row per proposal, keyed by `proposal_id`; binds environment, subject, profile, proposal version/digest, binding version, and candidate identifiers. It becomes `succeeded` only in the authoritative commit. Failed pre-commit attempts leave no operation row. |
| `budget_creation_idempotency` | Unique `(environment, account_subject_id, confirmation_idempotency_key)`; stores request digest and the immutable committed response. Same key plus same digest replays it; same key plus another digest conflicts. |
| `budget_creation_audit` | Exactly one `budget.created` success record per operation, inserted in the transaction. Denial-attempt audit required by CBD-236 is a separate restricted record after rollback and is not a creation-success record. |
| `budget_creation_success` | Exactly one terminal success per operation and budget; owns the authoritative identifiers and response payload. It is inserted last before deferred checks and commit. |

Unique constraints on `proposal_id`, operation-to-budget, audit-to-operation,
success-to-operation, and success-to-budget make duplicate outcomes impossible.
No failed operation is represented by a visible, incomplete budget. An
unobservable response after a successful commit is not a failed operation; the
stored idempotency result resolves it.

## 4. Lifecycle and version transitions

| Command | Preconditions | Commit effect | Rejected/stale effect |
| --- | --- | --- | --- |
| Create | CBD-236 bootstrap allow at commit; proposal current; all creation constraints satisfied | Insert complete `live` budget graph, audit, operation success, and replay result | Roll back every creation write |
| Rename | Current authorized actor; `live`; exact `name_version`; normalized valid new name | Update `name`, increment `name_version`, update audit hook | No change; duplicate names remain valid |
| Archive | Current Primary Owner; exact `lifecycle_version`; current state `live` | Set `archived`, increment `lifecycle_version`, preserve all references; access behavior follows CBD-72/CBD-76 | No change |
| Archive replay | Same command identity and already-applied target version | Return the original archived result | No second version or audit |

There is no delete transition in this state machine. CBD-76 deletion routing
remains future work and cannot be implemented by removing an archived row.

## 5. Physical constraint catalog

| ID | Guard | Failure behavior |
| --- | --- | --- |
| `DB-231-001` | Primary keys and immutable-ID update trigger | Reject mutation; transaction aborts. |
| `DB-231-002` | Application grapheme validation plus database normalized-name/non-empty check | Reject invalid name before write; database remains a final normalized-shape guard. |
| `DB-231-003` | Catalog validation before write; non-empty canonical zone/version and currency/version checks | Reject unsupported/stale context; no budget row. |
| `DB-231-004` | Partial unique active-Primary index plus deferred bidirectional owner trigger | Reject second or missing active Primary Owner at commit. |
| `DB-231-005` | Unique creation-origin schedule plus composite deferred budget/schedule/period references | Reject missing, second initial, inactive current, or cross-budget schedule/period. |
| `DB-231-006` | Partial unique active-current-period index | Reject a second active current period. |
| `DB-231-007` | Membership-to-budget foreign key and composite subject/profile validation | Reject orphan or cross-profile membership. |
| `DB-231-008` | Unique proposal consumption, idempotency scope, success, and audit keys | Reject duplicate operation/outcome/audit. |
| `DB-231-009` | Lifecycle check and prohibition on hard delete through application role | Reject unknown lifecycle or application deletion. |
| `DB-231-010` | Optimistic expected-version predicates | Zero affected rows becomes stale conflict; no overwrite. |

PostgreSQL deferred foreign keys and constraint triggers are checked before
commit, allowing mutually referring budget and initial-membership rows to be
assembled inside one transaction without admitting an invalid committed state.
The application database role has no path that disables triggers or constraints.

## 6. CBD-246 persistence port

CBD-246 must provide one tenant-scoped transaction abstraction, not independent
repositories whose calls can commit separately:

```ts
interface BudgetSpaceCreationPersistence {
  confirm(
    command: ConfirmPersistenceCommand,
    build: (tx: BudgetSpaceCreationTransaction) => Promise<CommittedCreation>
  ): Promise<ConfirmPersistenceResult>;
  rename(command: RenameBudgetSpaceCommand): Promise<RenameResult>;
  archive(command: ArchiveBudgetSpaceCommand): Promise<ArchiveResult>;
}
```

`confirm` begins a serializable PostgreSQL transaction, resolves or reserves
the full confirmation-idempotency scope, locks the proposal/operation identity,
and exposes transaction-bound methods for proposal claim, CBD-236 commit
authorization, budget insertion, membership insertion, schedule/period
insertion, audit insertion, proposal confirmation, and success/result insertion.
It commits only after all deferred constraints pass. The transaction object
cannot escape the callback, and none of its methods accepts a tenant identifier
from an HTTP body.

The port returns a discriminated result: `committed`, `replayed`,
`key_conflict`, `proposal_consumed`, `denied`, or `retryable_serialization`.
Only `committed` and `replayed` contain the success payload. CBD-246 must map
PostgreSQL constraint names to these stable outcomes without exposing schema,
existence, or other-tenant details.

## 7. Migration and compatibility

The first migration runs a read-only preflight and aborts with counts and
non-sensitive internal row identifiers when it finds an orphan membership,
zero or multiple active Primary Owners, multiple initial schedules, multiple
active periods, cross-budget references, invalid lifecycle, missing context
versions, or duplicate creation identities. It must not synthesize an owner,
schedule, period, outcome, identifier, or historical version.

Constraint installation follows preflight, supporting unique/composite indexes,
foreign keys, then deferred invariant triggers, all in a transaction where
PostgreSQL permits. Rollback removes only structures introduced by this
migration; it does not delete or rewrite customer rows. A future schedule schema
must preserve the composite reference contract or provide an approved migration.

## 8. Required verification

Database-backed tests must cover duplicate names; grapheme boundaries including
combining sequences and emoji; invalid time-zone/currency contexts; simultaneous
creation for one proposal and idempotency key; second/missing Primary Owner;
second initial schedule; second active period; every permutation of constraint
ordering; cross-budget and cross-subject/profile substitution; every injected
write boundary; stale rename/archive; exact replay; and migration preflight on
each inconsistent legacy shape. Each failure test queries by operation,
proposal, candidate budget, membership, schedule, period, audit, and success IDs
and proves no attributable row remains.

## 9. CBD-232 proposal disposition

| CBD-232 proposal identifier | Disposition | Reconciliation |
| --- | --- | --- |
| `BudgetCreationConstraintReader` (§9, §10.1) | **Accepted with definition** | Returns `{ constraintContractVersion, allowedLifecycle: "live", nameRuleVersion, timeZoneDataVersion, currencyCatalogVersion, primaryOwnerRuleVersion, initialScheduleRuleVersion }`. Every field is result-affecting and enters the proposal dependency fingerprint. |
| `BCP-10` / confirmation-time constraint recheck | **Accepted** | CBD-233 must reload the exact reader version in the authoritative transaction. |
| CBD-232 `name.too-long` code-point rule (§5.2) | **Amended** | CBD-231 AC01 controls: after CBD-232 normalization, length is measured as extended grapheme clusters, not Unicode code points. The error code and 100-character message remain stable. CBD-232 requires a correction before implementation. |
| Proposal state as non-authoritative (`BCP-01`, §10.1) | **Accepted** | No proposal or operation identifier is a budget identifier or authority grant. |
| CBD-246 durable proposal-store assignment (§9) | **Accepted** | It composes with, but remains logically separate from, the transaction port in §6. |

## 10. Acceptance-criteria traceability

| Criterion | Contract evidence | Required implementation evidence |
| --- | --- | --- |
| `CBD-231-AC01` | `BSL-231-001/002`; §3.1; §9 amendment | Grapheme/normalization and duplicate-name database tests. |
| `CBD-231-AC02` | `BSL-231-003`; §3.1 | Catalog/version persistence and personal-default independence tests. |
| `CBD-231-AC03` | `BSL-231-004/005`; §§3.2–3.3 | Transaction commit fixtures proving one owner, initial schedule, and current period. |
| `CBD-231-AC04` | `BSL-231-010`; §5 constraint catalog | Negative constraint and cross-budget/profile substitution tests. |
| `CBD-231-AC05` | `BSL-231-006`; §4 | Archive preservation and application-delete denial tests. |
| `CBD-231-AC06` | `BSL-231-009`; §§3.4, 6, 8 | Failure injection before/after every write and residue queries. |
| `CBD-231-AC07` | §7 | Legacy inconsistency preflight fixtures proving abort without synthesis. |
| `CBD-231-AC08` | `BSL-231-007`; §§4, 8 | Duplicate, concurrency, ordering, rollback, version, and substitution suite. |

## 11. Alternatives and findings

Independent repositories were rejected because they cannot make proposal,
budget, membership, schedule, period, audit, and outcome atomic. A durable
`creating` budget visible to recovery was rejected for this path because the
packet requires every failed confirmation to leave no budget; stored success
plus idempotent replay handles uncertain responses without an openable partial
space. Deferrable triggers were selected over application-only checks because
mutually referring initial rows require transaction-final validation and the
database must remain the final concurrency guard.

Architectural finding `AF-231-001`: CBD-232 v0.2.1's code-point count conflicts
with CBD-231 AC01's user-perceived-character count. This contract amends that
proposal as stated in §9. No approved schedule, authorization, or boundary
decision is changed.

## 12. Revision history

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | September 12, 2026 | Initial architecture proposal: record model, lifecycle, constraint catalog, CBD-246 port, migration/compatibility behavior, verification obligations, CBD-232 reconciliation, and AC traceability. |
