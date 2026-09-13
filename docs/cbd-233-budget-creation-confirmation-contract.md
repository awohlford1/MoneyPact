# CBD-233 — Atomic and idempotent budget-creation confirmation

| Field | Value |
| --- | --- |
| Status | **Approved — Product Owner, September 13, 2026 (PO-CONTRACT-APPROVALS-001); open questions and residuals stay recorded and open** |
| Document version | 0.1.1 |
| Jira subtask | [CBD-233](https://cobudget.atlassian.net/browse/CBD-233) |
| Parent | [CBD-23](https://cobudget.atlassian.net/browse/CBD-23) |
| Consumes | CBD-231 v0.1 proposal; CBD-232 v0.2.1; CBD-236 v0.4 proposal |
| Last updated | September 12, 2026 |

## 1. Purpose and outcome

This contract turns one current reviewed CBD-232 proposal into at most one
authoritative budget. One durable commit creates the budget, creator Primary
Owner membership, first authoritative schedule version, current/future preview
periods, creation audit, proposal-consumption marker, success outcome, and
idempotency result. Nothing in that set confers access before commit.

This is architecture, not evidence that the transaction exists. CBD-231 owns
the durable constraints, CBD-232 owns proposal generation and immutable preview
semantics, CBD-236 owns authorization decisions, CBD-26 owns schedule rules,
and CBD-246 implements the transaction port.

## 2. Binding confirmation invariants

| ID | Invariant |
| --- | --- |
| `BCC-233-001` | Confirmation accepts only a proposal currently `previewed`, unexpired, not superseded, bound to the current environment, subject, session generation, profile/account context, normalized inputs, reviewed preview, local date, and exact governing versions. |
| `BCC-233-002` | Identifier possession and a valid binding are integrity evidence, never authority. CBD-236 `space.create` bootstrap authorization must allow again inside the commit. |
| `BCC-233-003` | One successful transaction creates exactly one budget, one active creator `primary_owner` membership, one sequence-1 authoritative schedule version, exactly one active current period, one success audit, and one success outcome. |
| `BCC-233-004` | The proposal claim, all authoritative writes, CBD-236 allow audit, proposal `confirmed` transition, and idempotency result share one PostgreSQL transaction. |
| `BCC-233-005` | One proposal is consumed at most once. One confirmation key in its full scope produces at most one result. Database uniqueness is the final guard under concurrency. |
| `BCC-233-006` | Exact replay returns the byte-equivalent logical response and creates no row or launch effect. Key reuse for another proposal conflicts. A different key cannot reconfirm a consumed proposal. |
| `BCC-233-007` | Every pre-commit failure rolls back all creation and access-conferring state. A failure to serialize or deliver the response after commit leaves the completed budget and is recovered by exact replay. |
| `BCC-233-008` | Categories, targets, bills, goals, transactions, additional memberships, and account-to-budget links are forbidden transaction participants. |
| `BCC-233-009` | A success response is constructed from the stored committed outcome only after commit and carries the identifiers and versions required for later authorization and onboarding. |

## 3. External and application contract

### 3.1 HTTP request

`POST /v1/budget-creation-proposals/{proposalId}/confirm` requires an
authenticated session, an `Idempotency-Key` header satisfying CBD-232's visible
ASCII 16–128 rule, and this body:

```ts
interface ConfirmBudgetCreationBody {
  readonly confirmationBinding: string;
}
```

Unknown fields are rejected. The adapter maps the route, header, and body to
CBD-232's proposed application request:

```ts
interface ConfirmBudgetCreationRequest {
  readonly proposalId: string;
  readonly confirmationBinding: string;
  readonly confirmationIdempotencyKey: string;
}
```

It never accepts echoed normalized inputs, preview, digest, governing versions,
subject/profile identifiers, candidate budget identifiers, schedule rows, or
membership fields. Authentication and current context resolution precede an
idempotency or proposal lookup, preventing cross-context existence disclosure.

### 3.2 Stored success and response

```ts
interface ConfirmBudgetCreationResponse {
  readonly confirmationOutcomeId: string;
  readonly budgetSpaceId: string;
  readonly primaryOwnerMembershipId: string;
  readonly initialScheduleVersionId: string;
  readonly currentScheduleVersionId: string;
  readonly currentPeriodId: string;
  readonly nameVersion: 1;
  readonly lifecycle: "live";
  readonly lifecycleVersion: 1;
  readonly scheduleVersion: 1;
  readonly authorization: {
    readonly policyVersion: string;
    readonly policyDigest: string;
    readonly inputSchemaVersion: number;
    readonly authorizationVersion: 1;
  };
  readonly committedAt: string;
  readonly onboardingContinuationId: string;
}
```

The success outcome stores the canonical logical payload. JSON serialization
occurs after commit. `onboardingContinuationId` is stable across replay and is
the sole client deduplication identity for navigation; confirmation does not
emit a separate “launch” side effect. A response-delivery failure is retried
with the same key and returns the stored payload.

### 3.3 Stable failure outcomes

| Outcome | HTTP intent | State effect |
| --- | --- | --- |
| `unauthenticated` | 401 | No protected lookup or creation write. |
| `proposal_not_found` | 404 | Uniform for absent, foreign-context, stale-session, or inaccessible proposal. |
| `proposal_not_current` | 409 | Expired, invalidated, superseded, dependency-changed, or already consumed by another identity; no write. |
| `idempotency_key_reused` | 409 | Same scoped key with different request digest; no write. |
| `authorization_denied` | 403 or the CBD-236 uniform external mapping | Transaction rolled back; restricted denial audit occurs after rollback. |
| `confirmation_stale` | 409 | Commit recheck found changed proposal, subject/session/profile, policy, catalog, rule, or candidate absence; rollback. |
| `retryable_conflict` | 409/503 with retry guidance | Serialization/deadlock loser rolled back; retry same key. |

Internal reason classes follow CBD-236 and do not reveal which hidden fact
failed. No response calls an uncommitted identifier authoritative.

## 4. Transaction protocol

The API may perform a non-authoritative precheck for prompt feedback. Only the
following serializable transaction can authorize creation:

1. Resolve the full idempotency scope
   `(environment, account_subject_id, confirmationIdempotencyKey)`. If a row
   exists, constant-time compare its request digest. Return its stored committed
   response on an exact match, otherwise conflict. This replay branch performs
   no proposal or creation write.
2. Lock the proposal by its context key and `proposal_id`. Require lifecycle
   `previewed`, exact proposal version, `now < expiresAt`, no successor, and no
   consumption row. Recompute and constant-time verify the CBD-232 binding.
3. Rebuild CBD-232's complete dependency fingerprint inside the transaction:
   environment, subject, session generation/version, account/profile identity
   and version, normalized input digest, preview digest, budget-local date,
   expiry, proposal lifecycle revision, period/calendar/time-zone/currency
   versions, binding version, and the CBD-231 constraint-contract version.
4. Allocate candidate budget, Primary membership, schedule-version,
   current-period, outcome, and onboarding-continuation identifiers server-side.
   Assemble CBD-236's
   `PolicyInput` in its API bootstrap-user variant for `space.create` from
   verified session, subject, profile, registry, and transactional absence
   reads. Call `decide`.
5. Through CBD-236's runtime mutation seam, re-read and exactly compare the
   bootstrap captured versions, candidate IDs, policy tuple, input digest, and
   absence predicates. Discharge `create_primary_owner_membership`. A denial
   aborts before any authoritative insert.
6. Determine the sole reviewed preview period containing the proposal's
   budget-local date. Insert the budget with its candidate owner,
   initial/current schedule, and current-period references already populated;
   then insert the creator membership, sequence-1 authoritative schedule
   version, and immutable reviewed preview periods. Deferred composite foreign
   keys validate the forward references before commit, so no nullable or
   temporarily unbound budget shape is required.
7. Insert the CBD-231 §3.4 `budget_creation_operation` row keyed by
   `proposal_id` in state `succeeded`, referencing the candidate budget; its
   unique constraints on `proposal_id` and operation-to-budget are what make a
   second outcome for the same proposal impossible. Insert the CBD-236 allow
   audit and the single `budget.created` creation audit, each referencing that
   operation. Insert the success outcome (success-to-operation and
   success-to-budget unique) and the idempotency row. Mark the proposal
   `confirmed`, recording the authoritative budget identifier and outcome.
8. Force deferred constraint evaluation, then commit. Only after commit load
   the stored outcome and serialize the response.

Every write uses the transaction handle. No exception handler may commit an
operation, proposal transition, audit, or idempotency record by itself. A
serialization failure retries the entire transaction within a bounded server
budget or returns `retryable_conflict`; it never reuses in-memory authority
facts across attempts.

## 5. Concurrency and replay proof

The proposal row lock chooses an execution order for the same proposal; unique
`proposal_id` consumption remains the final guard. The scoped idempotency unique
key chooses one meaning for a retry key. CBD-231 composite and partial unique
constraints guard the budget graph. Serializable isolation detects predicate
races affecting candidate absence or proposal currency.

| Race | Winner | Loser / replay result |
| --- | --- | --- |
| Same proposal, same key and digest | One commit | Waits, then returns same stored response. |
| Same proposal, different keys | One commit | `proposal_not_current`; no second budget. |
| Same key, different proposal/digest | Existing key meaning | `idempotency_key_reused`; no proposal consumed. |
| Session/logout/revocation/profile switch during confirmation | Commit only if exact commit snapshot still satisfies CBD-236/CBD-232 | Deny/stale and rollback. |
| Policy/catalog/rule/time-zone data change | Commit only under exact recorded tuple | Stale, regenerate proposal, rollback. |
| Response lost after commit | Existing committed outcome | Same response on exact replay. |

No “check then insert” application sequence is relied on without the matching
unique/foreign-key/constraint guard.

## 6. Failure boundaries

Tests inject a failure before and after each step below. For steps 1–7, the
postcondition is no row attributable to the candidate operation except a
separate restricted denial-attempt audit where CBD-236 requires it:

| Boundary | Required observation |
| --- | --- |
| Proposal lock, binding check, dependency reload | No operation or authoritative row. |
| Bootstrap precheck and commit authorization | No authoritative row; denial audit cannot confer access. |
| Budget insert | No budget after rollback. |
| Primary membership insert / budget owner backfill | Neither row remains. |
| Schedule-version insert | No budget, membership, or schedule remains. |
| Each period insert / current-period backfill | No period or prior creation row remains. |
| Allow audit / creation audit insert | Audit failure rolls back the effect; no success audit remains. |
| Proposal confirmed / success / idempotency insert, in every ordering permutation | No proposal consumption or creation row remains if commit fails. |
| Deferred constraints and commit acknowledgement | Constraint failure leaves nothing; ambiguous commit is reconciled by scoped idempotency lookup before retry. |
| Response load/serialization/delivery after durable commit | Complete budget remains; same-key retry returns the stored response; no duplicate or second launch identity. |

“After commit failure” is deliberately classified: an HTTP serialization or
delivery failure is not transaction failure and must not roll back or compensate
the authoritative budget.

## 7. Audit and data boundary

The atomic allow audit carries the CBD-236 allowlisted fields, exact policy
tuple, action `space.create`, effect class, outcome, subject/target opaque
identifiers, and transaction correlation. The creation audit additionally
records proposal ID, outcome ID, authoritative budget/schedule/period IDs,
governing version identities, and `committedAt`; it excludes names, cadence
content, financial preview values, binding material, session material, and
credentials.

The transaction rejects any attempt to insert categories, targets, bills,
goals, transactions, extra memberships, or account-to-budget links. The
persistence module exposes no such methods on its confirmation transaction
interface. Later onboarding actions begin only from the committed response and
require their own current authorization.

## 8. CBD-232 seam disposition

| CBD-232 identifier / proposal | Disposition | Reconciliation |
| --- | --- | --- |
| `ConfirmBudgetCreationRequest` (§4.4) | **Accepted** | Exact application shape retained. HTTP maps route/body/header into it as §3.1 states. |
| Rejection of echoed inputs, preview, versions, subject, and budget fields (§4.4) | **Accepted** | Server loads every value; caller values are locators/integrity input only. |
| `BudgetCreationConfirmationUnitOfWork.claimCurrentProposal` (§9) | **Amended** | A separately callable claim is too weak to prove all writes share one transaction. It becomes the transaction-scoped claim operation inside CBD-231 §6's `confirm` callback. |
| `BudgetCreationConfirmationUnitOfWork.recordConfirmed` (§9) | **Amended** | It is transaction-bound and must record proposal ID, budget ID, outcome ID, expected lifecycle revision, and binding digest atomically with success. |
| `BudgetCreationConstraintReader` (§9, §10.1) | **Accepted** | CBD-231 §9 defines its exact versioned result; its complete result enters proposal and commit fingerprints. |
| `BCP-10` and §7.3 transaction freshness | **Accepted** | §4 step 3 reloads the complete set; §4 steps 4–5 add CBD-236 commit authorization. |
| Confirmation idempotency ownership and scope (§10.2) | **Accepted** | `(environment, subject, key)` owns the request digest and committed result; authentication/context resolution occurs before lookup. |
| One proposal, at most one budget (§10.2) | **Accepted** | Proposal lock plus unique consumption constraint enforce it. |
| No partial budget/membership/schedule/period/target/audit (§10.2) | **Accepted with clarification** | Targets are forbidden entirely; pre-commit failures leave no creation rows. A post-commit response failure leaves the complete committed graph and replays it. |
| CBD-232 name code-point validation (§5.2) | **Amended by CBD-231** | Confirmation accepts only proposals created under the grapheme-count correction in CBD-231 §9; an older incompatible proposal version is stale. |

CBD-232 therefore needs a patch revision before implementation to adopt the
grapheme rule and the strengthened transaction-port signatures. This contract
does not edit that sibling document.

## 9. Compatibility and migration implications

Only proposal contract versions declaring compatibility with this confirmation
version may be confirmed. A result-affecting proposal or constraint version
change invalidates unconfirmed proposals and requires regeneration; committed
budgets retain their recorded versions. Confirmation response fields are
additive only within `cbd-233/0.1`; removing or changing meaning requires a new
contract version and replay serializer capable of returning historical results.

CBD-246 must implement CBD-231's port and durable CBD-232 proposal store on the
same PostgreSQL connection/transaction boundary. If separate databases are
later selected, this contract must be revisited; a distributed saga cannot
claim the all-or-nothing semantics specified here without new authority and a
different customer-visible recovery model.

## 10. Required verification catalog

| ID | Scenario |
| --- | --- |
| `CONF-233-T01` | Exact success creates the cardinalities in `BCC-233-003` and response IDs resolve to them. |
| `CONF-233-T02` | Same key and digest replay before/after response loss returns the same logical bytes and creates nothing. |
| `CONF-233-T03` | Concurrent same-key and different-key submissions yield one commit and deterministic loser outcomes. |
| `CONF-233-T04` | Expiry, local-midnight, successor, lifecycle revision, preview digest, and every governing-version mismatch deny. |
| `CONF-233-T05` | Logout, session rotation/revocation, account switch, subject/profile lifecycle change, policy change, and candidate collision between precheck and commit deny and roll back. |
| `CONF-233-T06` | Failure before/after every §6 write produces the required residue query. |
| `CONF-233-T07` | Audit insert and deferred-constraint failures roll back the whole effect. |
| `CONF-233-T08` | Cross-budget, cross-subject/profile, guessed proposal, and altered binding inputs disclose no protected existence and write nothing. |
| `CONF-233-T09` | Attempted forbidden entity insertion is unavailable through the port and rejected by an integration guard. |
| `CONF-233-T10` | Success serialization failure and post-commit retry preserve one outcome and one onboarding continuation identity. |

## 11. Acceptance-criteria traceability

| Criterion | Contract evidence | Required implementation evidence |
| --- | --- | --- |
| `CBD-233-AC01` | `BCC-233-001/002`; §§3–4 | `CONF-233-T04/T05/T08`. |
| `CBD-233-AC02` | `BCC-233-003/004`; §4 steps 6–8 | `CONF-233-T01/T07`. |
| `CBD-233-AC03` | `BCC-233-007`; §6 | `CONF-233-T06/T07/T10`. No recoverable partial budget is selected. |
| `CBD-233-AC04` | `BCC-233-005/006`; §§3.2, 5 | `CONF-233-T02/T10`. |
| `CBD-233-AC05` | §5 race matrix | `CONF-233-T03` with database-backed concurrency. |
| `CBD-233-AC06` | §4 steps 3–5; CBD-236 commit protocol | `CONF-233-T04/T05`. |
| `CBD-233-AC07` | `BCC-233-008`; §7 | `CONF-233-T09` plus residue assertions. |
| `CBD-233-AC08` | `BCC-233-009`; §§3.2, 4 step 8 | `CONF-233-T01/T10`. |
| `CBD-233-AC09` | §§5–6 and §10 complete catalog | `CONF-233-T02` through `T10`. |

## 12. Alternatives and architectural findings

A saga with a visible `creating` budget was rejected because it admits
access-conferring partial state and is unnecessary inside one PostgreSQL
boundary. Request-derived budget fields were rejected because they bypass the
reviewed proposal. An idempotency cache outside the database was rejected
because it cannot be atomic with proposal consumption and creation. Re-running
onboarding as a server side effect was rejected in favor of one stable
continuation identity returned from the outcome.

`AF-233-001`: CBD-232's two-method confirmation unit-of-work proposal does not
express atomic participation by all creation writes. This contract accepts its
intent and strengthens it to CBD-231 §6's transaction callback. `AF-233-002`:
CBD-232's name-length mismatch is inherited; proposals under the uncorrected
rule are not compatible. Neither finding changes an approved source.

## 13. Revision history

| Version | Date | Change |
| --- | --- | --- |
| 0.1.1 (approval) | September 13, 2026 | Product Owner approval recorded (PO-CONTRACT-APPROVALS-001). Status Proposed → Approved at the same version; no decision, identifier or contract text changed. |
| 0.1.1 | September 13, 2026 | Manager, in the merge lane. Review closures (CBD231-REVIEW-001): §4 step 7 now writes the CBD-231 §3.4 `budget_creation_operation` row that the uniqueness guards reference (finding 1); the CBD-236 input named as `PolicyInput` in its API bootstrap-user variant instead of a type CBD-236 does not define (finding 2). No other text changed. |
| 0.1 | September 12, 2026 | Initial architecture proposal: request/response, transaction and replay protocol, failure and race matrices, audit/data boundary, CBD-232 identifier-level disposition, compatibility implications, test catalog, and AC traceability. |
