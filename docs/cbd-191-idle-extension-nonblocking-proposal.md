# CBD-191 — Non-blocking idle-expiry extension for a same-session concurrent request (proposal)

| Field | Value |
| --- | --- |
| Status | **Proposed.** Nothing in this document is applied. It proposes one CBD-191 amendment (`IDLE-R01`–`IDLE-R04`) for the Product Owner and Security to approve, states the implementation packet that would follow, and puts the residual choices to the Executive (`IDLE-D01`–`IDLE-D04`) |
| Document version | 0.1.1 |
| Proposal identifiers | options `IDLE-OPT-A`–`IDLE-OPT-D`; contract revisions `IDLE-R01`–`IDLE-R04`; implementation edits `IDLE-E01`–`IDLE-E06`; tests `IDLE-T01`–`IDLE-T07`; decisions `IDLE-D01`–`IDLE-D04`; findings `IDLE-F01`–`IDLE-F04` |
| Owner | Alexander Wohlford |
| Jira subtask | [CBD-191](https://cobudget.atlassian.net/browse/CBD-191) (sessions); the Manager assigns the delivery ticket afterwards |
| Governing contract | `docs/cbd-191-session-and-revocation-contract.md` \| Document version **0.3.1** — §3.3 (resolution, case 5), §4 (`SC-191-002`, the authority row lock), §5.1 (the idle slide sentence), §8 (`CT-191-009`, `CT-191-010`, `CT-191-013`), §12, §13 |
| Adjoining contracts | `docs/cbd-236-authorization-policy-contract.md` \| Document version **0.14.1** — §5.3 (`recheck_at_commit`), §6 (`PC-236-014`); `docs/cbd-266-rate-limit-parameter-registry-contract.md` \| Document version **0.6 (proposed)** — §7 (`deny_in_flight`) |
| Governing findings | `SEC-G429-F2` (`PROTO-CBD266-429-SEC-001-RESULT` r1; handover queue item 2): a same-session second request blocks on the session row inside the first mutation's effect transaction and is refused after the 5 s deadline with the uniform 403 rather than the 429; `SEC-G429-R02`: fold the same-session class into the CBD-268 harness; `SEC-C200-F4`: the multi-process shape of the in-flight counter |
| Amendment-proposal precedent | `docs/cbd-190-identity-amendments-proposal.md` \| Document version **0.1** and `docs/cbd-236-p6-subject-self-amendment-proposal.md` \| Document version **0.1** — the shape this document follows: problem as reported, options, exact amendment, tests, decisions to the Executive, findings, nothing applied |
| Merged behaviour read | `apps/api/src/authorization/http.ts` (the preHandler session gate, the 429 answer, the precheck and the effect call); `apps/api/src/authorization/facts.ts` (`FactAssembler`, the 5 s read deadline); `apps/api/src/authorization/boundary.ts` (`execute`, the commit-time recheck); `apps/api/src/sessions/runtime.ts`, `index.ts`, `fact-source.ts`, `transaction-store.ts`; `packages/sessions/src/{store,fact-source,resolve,config}.ts`; `packages/data-access/src/{client,binding,tenant,logging}.ts`; `packages/rate-limit/src/counter.ts`; `apps/api/src/rate-limit/http.ts`; `apps/web/src/api/client.ts`; `packages/migrations/migrations/20260913T110001Z__create_account_session.sql`; `apps/api/src/sessions/revocation-fence.live.test.ts`; `apps/api/src/primary-transfer/concurrent-double-confirm.live.test.ts`; `apps/api/src/authorization/gate-429.test.ts`; `docs/qa/pk9-criterion-evidence.md` — all at `8697762` on `main`. Every line number in this document is a line of that revision |
| Milestone | `PROTOTYPE-SLICE-001` and `PROVIDERS-LOCAL-001` (Executive, September 12, 2026) |
| Repository baseline | `8697762` on `main` |
| Written by | Architecture, assignment `ARCH-CBD191-IDLE-EXTENSION-001`, September 17, 2026 |
| Last updated | September 17, 2026 (v0.1.1, Security wording findings applied) |

> **Authority.** CBD-191 v0.3.1 is the approved contract and this document
> changes nothing in it. It proposes one amendment for the Product Owner and
> Security to approve before an implementation packet is cut, and puts the
> residual choices to the Executive. Where this document and the approved
> contract disagree, the contract wins and this document is wrong.

> **Evidence classes.** A claim about current behaviour is cited to a file and
> line at `8697762` and is *verified*. A claim about PostgreSQL locking
> semantics is *assumed* from the PostgreSQL documentation and is marked
> "(PostgreSQL semantics)"; the implementation packet's live probe (`IDLE-T03`)
> is what turns each such assumption into evidence. A recommendation is marked
> as one.

## 1. The problem as reported

### 1.1 The path a mutation takes today

A cookie-authenticated mutation on a post-authentication surface resolves its
session three times and writes its session row three times before its handler
runs. The table names each step and where it is.

| Step | What happens | Where (at `8697762`) |
| --- | --- | --- |
| 1. Session gate | The Fastify `preHandler` resolves the session *before* the rate-limit counter is consulted: `resolveSession` at line 253 precedes `enforce` at line 261. A resolution failure is the uniform denial with `earliest_decisive_gate: "session"` (lines 254–256). | `apps/api/src/authorization/http.ts` 247–261 |
| 2. In-flight answer | Only after the actor resolved, a `deny_in_flight` outcome on a `concurrency=1` record is answered `429` `{outcome: retry, reason: in_flight}` with `Retry-After: 1` (line 274–277). Every other refusal keeps the uniform 403. | `apps/api/src/authorization/http.ts` 274–277; `docs/cbd-266-rate-limit-parameter-registry-contract.md` 671–690 |
| 3. Resolution mechanics | `FactAssembler.resolveSession` reads `session_store` through `#read`, which races the adapter read against a timer of `#timeoutMs` (construction rejects anything above 5 000 ms, line 97) and, on expiry, aborts a controller and rejects with `not_authenticated` (line 117). The adapter is handed `lookup.signal`, but the sessions adapter never reads it (`packages/sessions/src/fact-source.ts` 37–54 does not reference `signal`), so the timer abandons a statement it cannot cancel. | `apps/api/src/authorization/facts.ts` 96–97, 110–121, 124–129; `apps/api/src/sessions/runtime.ts` 269 (`5_000`) |
| 4. The slide | Every successful resolution computes `min(now + idle_timeout, absolute_expires_at)` (line 140) and writes it with `extendIdleExpiry` (line 142); a failed write is `not_authenticated` after the timeout bucket (lines 143–146). The write is `update account_session set idle_expires_at = $1 where session_ref = $2 and state = 'active'`. | `packages/sessions/src/resolve.ts` 140–146; `packages/sessions/src/store.ts` 403–414 |
| 5. Precheck | `canActivate` calls `boundary.authorize` with the cookie; `assemble` reads `session_store` first, with no transaction, so this second resolution slides the row again through the root client. | `apps/api/src/authorization/http.ts` 355; `apps/api/src/authorization/facts.ts` 131–144 |
| 6. Effect transaction | `boundary.execute` opens `store.transaction`; for a non-`read` effect it calls `assemble(lookup, transaction, capturedVersions)` (line 118) and requires the second decision to reproduce the precheck digest and captured versions (lines 121–125), then runs the handler (line 138), `verify` (line 139) and the audit append (line 140), and only then commits. The transaction is `BEGIN ISOLATION LEVEL SERIALIZABLE`, retried on SQLSTATE 40001/40P01 up to `SERIALIZATION_ATTEMPTS`. | `apps/api/src/authorization/boundary.ts` 115–143; `apps/api/src/sessions/transaction-store.ts` 141–164; `packages/data-access/src/binding.ts` 66–68, 83; `packages/data-access/src/logging.ts` 52 |
| 7. The scoped session read, slide and fence | Inside that transaction the session adapter is given the transaction client, builds a store bound to it (`storeFor`), resolves the session *through the transaction* (line 46, which performs step 4's slide on the transaction's connection) and then calls `fenceRevocationEpoch` (line 48), which re-reads the authority row and rewrites `revocation_epoch` with the value just read as the predicate (`store.ts` 293–306). Both writes are row-level locks that the transaction holds until COMMIT. `fence` defaults to true in composition (`runtime.ts` 236; `index.ts` 28–30). | `packages/sessions/src/fact-source.ts` 40–48; `packages/sessions/src/store.ts` 293–306; `apps/api/src/sessions/index.ts` 28–30 |

The mutation's handler therefore runs while its transaction holds an exclusive
row lock on the session's own `account_session` row and on the subject's
`account_subject_authority` row (PostgreSQL semantics: an `UPDATE` takes a
`FOR NO KEY UPDATE` row lock that is released at COMMIT or ROLLBACK).

### 1.2 What the same session's second request sees

A second request from the same session that arrives while step 7's lock is
held runs step 1. Its `extendIdleExpiry` is an autocommit `UPDATE` of the same
row, so it waits for the lock (PostgreSQL semantics). Step 3's timer fires at
5 s, the assembler rejects with `not_authenticated`, and the preHandler answers
the uniform 403 at `http.ts` 254–256. The `enforce` call at line 261 is never
reached, so the `deny_in_flight` outcome and the 429 of line 274–277 are
unreachable for that request. This is `SEC-G429-F2`, observed live: the
`concurrent-double-confirm` case records that the loser is either the 429 or the
403 "depending on whether the winner's serializable effect transaction has
already extended the session's idle expiry and fenced the revocation epoch by
the time the loser's request reaches the gate"
(`apps/api/src/primary-transfer/concurrent-double-confirm.live.test.ts` 7–13;
`docs/qa/pk9-criterion-evidence.md` 81, both observations landing on 429 only
because the winner's handler was fast).

The window in which the 429 is reachable is therefore *before* step 7 of the
first request, which is a few milliseconds of session and policy work; every
later same-session request during the handler is a 5 s wait and a 403.

### 1.3 Consequences

1. **Web client.** The client retries a 429 once after `Retry-After` and
   surfaces a second 429 as `in_flight`; any other non-OK answer becomes
   `request_failed` (`apps/web/src/api/client.ts` 484–495). A slow first
   mutation therefore turns a second click into a 5 s hang followed by
   `request_failed`, not the retryable `in_flight` the 429 was added for.
2. **Every other request of the session** — `GET /v1/identity/me`, reads,
   navigation bootstraps — runs step 1 and is refused the same way for the
   duration of the handler, because step 1 slides on every resolution
   regardless of method.
3. **A held connection past the deadline.** The abandoned `UPDATE` (step 3)
   keeps its pool connection until the first transaction commits, because the
   abort signal is never forwarded to the statement. Under a burst of
   same-session requests this consumes pool capacity for the whole handler
   duration (`IDLE-F01`).
4. **Not weakened.** No denial is weakened and nothing leaks: the refused
   request receives the uniform denial with the same bytes as any other
   session-gate failure, and the CBD-268 unauthenticated timing class is
   unchanged (`gate-429.test.ts` 105–136). The problem is availability and
   the reachability of an answer the client can act on, not confidentiality.

### 1.4 Why the slide is inside the transaction at all

`PROTO-ACTIVATION-001` A2 (review R02) put the session read, its slide and the
authority fence inside the serializable transaction so that "no revoke or
subject-wide bump can land between the commit-time session read and the
mutation's COMMIT" (`store.ts` 284–292; `fact-source.ts` 40–44). The live
proof is `apps/api/src/sessions/revocation-fence.live.test.ts` 1–19: a
single-row `markRevoked` or a subject-wide `bumpSubjectEpoch` started through a
root store during the transaction is serialized behind the transaction's own
session-row and authority-row writes, and the negative control (`fence: false`)
shows the revoke completing mid-transaction with the mutation committing
afterwards. Any option below is measured against that proof: the option must
keep both halves (single-row revoke and subject-wide bump) or say which half it
gives up.

## 2. What every option must keep

| Constraint | Source | What it means for a design |
| --- | --- | --- |
| The idle slide happens on every successfully resolved request, never past `absolute_expires_at`, and both expiries are re-checked at resolution. | CBD-191 §5.1 lines 311–313; §3.3 case 5 lines 152–157 | A design may make a *particular* slide best-effort, but must say so in §5.1 and must never let a skipped slide extend or shorten `absolute_expires_at`. |
| A request landing exactly on either expiry is expired (`>=`), deterministically. | CBD-191 `CT-191-010` line 707; `resolve.ts` 118 | The compare is on the row as read; no option changes it. A design that changes *which* value the row holds at a given instant must show the compare still resolves deterministically. |
| Store outage fails closed to `not_authenticated`, never to allow. | CBD-191 `CT-191-009` line 706; `resolve.ts` 143–146 | A "skipped" slide must be distinguishable from a failed one; a skip is not an outage. |
| Commit-time recheck: every authority source is re-read inside the transaction and every captured value must equal the reloaded value; the recheck obligation is discharged "with rows read under lock". | CBD-236 `PC-236-014` lines 319–327; §5.3 line 281 | The in-transaction session read stays. Whether the *session row* is "read under lock" is today true only through the slide write that follows the read; see `IDLE-D03`. |
| Allocation and epoch reads occur under the subject-authority row lock; the fence rewrites `revocation_epoch` with the value read. | CBD-191 §4 lines 253–258; `store.ts` 293–306 | The authority fence is not this proposal's subject and no option moves it; `IDLE-F03` records the cross-device consequence it has. |
| `SC-191-001A` uniform rejection timing. | CBD-191 §3.3 lines 170–182; `resolve.ts` 125–133 | A design may change the *resolved* path's timing only; every rejection branch keeps the fixed-shape work and the release bucket. |
| The data-access client offers single-statement `platformSelect`/`platformUpdate` with literal `set` values and no lock clause; the sessions package has no raw SQL and no multi-statement primitive of its own. | `packages/sessions/src/store.ts` 5–12; `packages/data-access/src/tenant.ts` 233–237, 270–289; `lint.test.ts` 24–39 (direct `pg` imports are rejected outside the core) | Any lock-aware slide is a data-access core change, a cross-package interface. |

## 3. Options

Each option is described by its transaction and locking shape and then
measured against the same six questions: the revocation fence (both halves),
`CT-191-010`, `recheck_at_commit`, the multi-process shape (`SEC-C200-F4`: the
in-flight counter is `InProcessCounterStore` by default, `apps/api/src/rate-limit/http.ts`
34, `packages/rate-limit/src/counter.ts` 38, so a second API process does not
see the first process's in-flight unit and the same-session case then meets the
row lock instead of the counter), the 5 s deadline, and cost.

### 3.1 `IDLE-OPT-A` — slide only outside the effect transaction

**Shape.** The scoped (transaction-bound) resolution at `fact-source.ts` 46
becomes read-only: `resolveSession` gains a `slide: boolean` argument (or the
scoped store's `extendIdleExpiry` is a no-op) and the in-transaction slide is
dropped. The gate (step 1) and precheck (step 5) slides, both autocommit
through the root client, stay. The authority fence at line 48 stays.

| Question | Assessment |
| --- | --- |
| Fence, subject-wide bump | Kept: the authority-row write still serializes a bump behind COMMIT. |
| Fence, single-row revoke | **Given up.** With no session-row write inside the transaction, a `markRevoked` (`store.ts` 376–387) started during the handler commits mid-transaction and the mutation still commits — exactly the negative control of `revocation-fence.live.test.ts`. The `revoke` scenario of that test would have to invert its expectation. |
| `CT-191-010` | Unchanged; the compare at `resolve.ts` 118 runs on the row as read. |
| `recheck_at_commit` | The session row is still re-read inside the transaction; the captured `sessionVersion` equality holds. The row is no longer "read under lock" in any sense (`IDLE-D03`). |
| Multi-process | The second process's mutation no longer blocks on the session row; it still blocks on the authority fence inside its own effect transaction (`IDLE-F03`). |
| 5 s deadline | Same-session gate slides never block; the 429 is reachable for the whole handler duration in one process. |
| Cost | Smallest code change (`packages/sessions` only). |

**Verdict.** Rejected on its own: it trades the availability defect for a
documented, live-proven fence property. Its mechanism survives inside
`IDLE-OPT-B` for the non-transactional slides.

### 3.2 `IDLE-OPT-B` — best-effort slide that skips a locked row (`SKIP LOCKED`)

**Shape.** The *non-transactional* slides (gate and precheck, root client)
become one atomic statement that updates the row only if it can lock it
without waiting:

```sql
update account_session
   set idle_expires_at = $1
 where session_ref = $2 and state = 'active'
   and ctid in (select ctid from account_session
                 where session_ref = $2 and state = 'active'
                   for no key update skip locked)
```

Row count 1 means slid; row count 0 means either "locked by this session's own
in-flight effect transaction" or "no longer active", and both are treated as a
skip, not a failure. The *in-transaction* slide (step 7) and the authority
fence are unchanged: the mutation's own transaction still takes the session-row
lock at its recheck and holds it to COMMIT, so the A2 proof is untouched.

(PostgreSQL semantics: `SKIP LOCKED` returns no row when another transaction
holds a conflicting row lock; `FOR NO KEY UPDATE` is the lock an `UPDATE` of a
non-key column takes, so it conflicts with the in-transaction slide and with
nothing weaker; a single statement in autocommit mode locks and updates in one
snapshot, so there is no window between "saw it free" and "wrote it".)

A `NOWAIT` variant is the same statement raising SQLSTATE `55P03` instead of
returning zero rows. It is worse here: `withStoreFailure` (`store.ts` 114–121)
wraps every error as `SessionStoreUnavailableError`, which `resolve.ts`
143–146 turns into the outage path with the timeout bucket, so `NOWAIT` needs an
error-code special case in the wrapper, and inside any future transactional use
an error aborts the transaction. `SKIP LOCKED` is data, not an error.

| Question | Assessment |
| --- | --- |
| Fence, subject-wide bump | Kept, unchanged. |
| Fence, single-row revoke | Kept, unchanged: the in-transaction slide still locks the row; a `markRevoked` still queues behind COMMIT. The `revocation-fence.live.test.ts` scenarios keep their expectations. |
| `CT-191-010` | Unchanged compare. One new statement about *values*: a skipped slide leaves `idle_expires_at` at the value the in-flight mutation wrote at its own resolution instant, so the idle window is measured from that instant rather than from the skipped request. The difference is bounded by the handler's duration; `absolute_expires_at` never moves. `IDLE-R01` states this. |
| `recheck_at_commit` | Unchanged: the in-transaction read, slide and fence are as today. |
| Multi-process | The second process's gate and precheck slides skip instead of blocking, so the second process reaches its own counter (which admits it, `SEC-C200-F4`) and its effect transaction, where it blocks on the session-row lock and the authority fence exactly as today, inside the same 5 s assemble deadline (`facts.ts` 141–142 applies the timer to the transactional read too). The cross-process same-session outcome is therefore unchanged (403 after 5 s when the first is slow) and out of this proposal's scope; `IDLE-F03`. |
| 5 s deadline | In one process the same-session second request slides-or-skips in one statement, resolves, reaches `enforce`, and is answered 429 in milliseconds; `GET /v1/identity/me` and reads resolve in milliseconds. |
| Cost | One data-access core change (`PlatformUpdateQuery` gains `skipLocked?: true`, rendered as the `ctid in (... for no key update skip locked)` predicate by `platformUpdate`, `tenant.ts` 270–289), one sessions-store change (`extendIdleExpiry` gains a `bestEffort` flag used by the root store), one adapter change (the root path passes it, the scoped path does not), tests. |

**Verdict.** Recommended (§4).

### 3.3 `IDLE-OPT-C` — transaction-scoped advisory lock keyed by `session_ref`

**Shape.** The mutation's transaction takes
`pg_advisory_xact_lock(hashtext(session_ref))` before its slide; every other
slide is `update ... where session_ref = $1 and state = 'active' and
pg_try_advisory_xact_lock(hashtext($1))`, skipping when the try fails.

| Question | Assessment |
| --- | --- |
| Fence, both halves | Kept as today (the in-transaction slide and fence are unchanged). |
| `CT-191-010` | As `IDLE-OPT-B`. |
| `recheck_at_commit` | Unchanged. |
| Multi-process | As `IDLE-OPT-B`. |
| 5 s deadline | As `IDLE-OPT-B` for the coordinated slides. But the advisory lock only coordinates sliders that *take* it: any path that updates the row without the advisory lock (`markRevoked`, `markRotated`, the fresh-assurance grant reader's session join) still meets the row lock. It adds a second lock namespace that must be taken in the same order everywhere, with a 64-bit hash collision space shared by every future advisory user. |
| Cost | Raw function calls in the `where` clause, which the data-access condition builder cannot express (`tenant.ts` `Condition` is column/operator/value); a bespoke statement in the core is needed anyway — the same cost as `IDLE-OPT-B` with a weaker guarantee. |

**Verdict.** Rejected: it re-implements with a second mechanism what the row
lock plus `SKIP LOCKED` already expresses with one.

### 3.4 `IDLE-OPT-D` — move the session write and fence to the commit tail

**Shape.** The in-transaction resolution is read-only (as `IDLE-OPT-A`), and the
slide and the authority fence are performed in the commit tail — in
`ApiTransactionStore.verify` (`transaction-store.ts` 206–210) or the
`beforeCommit` hook (line 150) — as conditional writes: `update account_session
set idle_expires_at = $1 where session_ref = $2 and state = 'active'` with row
count 1 required, and the fence as today. The lock is held for the tail only
(verify, audit append, COMMIT), not for the handler.

| Question | Assessment |
| --- | --- |
| Fence, single-row revoke | *Strengthened in one direction*: a revoke that committed during the handler makes the tail `UPDATE` see zero rows (or SQLSTATE 40001, PostgreSQL semantics for an update of a row a concurrent transaction changed under SERIALIZABLE), so the mutation aborts. |
| Fence, subject-wide bump | Kept, and the authority lock is held for the tail only. |
| **The defect that rejects it** | Under SERIALIZABLE, an `UPDATE` of a row that a concurrent transaction has changed since this transaction's snapshot raises 40001 (PostgreSQL semantics). With the slide at the tail, *any* same-session request during the handler — a `GET /v1/identity/me` poll, a navigation bootstrap — slides the row first through the root client and thereby aborts the mutation at its tail. `ApiTransactionStore` retries up to `SERIALIZATION_ATTEMPTS` (line 160), re-running the handler each time, and a session that polls faster than the handler completes never commits. Today's ordering (mutation locks first, everyone else waits) is what prevents this; `IDLE-OPT-D` inverts it. |
| `CT-191-010` | Unchanged compare. |
| `recheck_at_commit` | The re-read at the start is a plain snapshot read; the "under lock" reading is satisfied only at the tail. |
| Multi-process | Same-session cross-process mutations serialize at the tail rather than at the recheck; the 40001 retry loop applies to them too. |
| 5 s deadline | Gate slides block only for the tail: milliseconds. |
| Cost | Cross-component refactor (`boundary.ts` verify path, `transaction-store.ts`, `packages/sessions`), a changed proof in `revocation-fence.live.test.ts`, and the retry-storm behaviour above. |

**Verdict.** Rejected: it converts a same-session read into a reason to abort
the same session's mutation. Its one-directional strengthening (a revoke during
the handler aborts the mutation) is recorded as `IDLE-D02` for a possible later
design that avoids the abort by other means.

### 3.5 Comparison

| | Fence (row revoke) | Fence (bump) | Same-process second request | Cross-process (`SEC-C200-F4`) | Data-access change | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `IDLE-OPT-A` | given up | kept | 429 in ms | unchanged (fence wait) | none | rejected alone |
| `IDLE-OPT-B` | kept | kept | 429 in ms | unchanged (fence wait) | `skipLocked` on `platformUpdate` | **recommended** |
| `IDLE-OPT-C` | kept | kept | 429 in ms for coordinated sliders only | unchanged | bespoke statement | rejected |
| `IDLE-OPT-D` | strengthened | kept | 429 in ms, but the mutation aborts on any same-session read | retry loop | none, but a boundary refactor | rejected |

## 4. Recommendation

**Adopt `IDLE-OPT-B`.** Make the two non-transactional slides (gate and
precheck) best-effort with one atomic `SKIP LOCKED` statement, and leave the
in-transaction slide and the authority fence exactly as `PROTO-ACTIVATION-001`
A2 proved them. This is the recommendation because it is the only option that
removes the 5 s block *and* keeps both halves of the live-proven fence *and*
does not create a new abort path; its price is one small, generic addition to
the data-access core rather than a change to the boundary.

Three things the recommendation does **not** claim:

1. It does not make the 429 reachable across API processes. That is the
   in-process counter (`SEC-C200-F4`), not the slide, and after this change the
   cross-process same-session second mutation blocks on the session-row lock
   and the authority fence inside its own effect transaction, within the same
   5 s deadline. `IDLE-F03` records it for the CBD-266 owner.
2. It does not touch the assembler's deadline or forward the abort signal
   (`IDLE-F01`); after this change the gate no longer waits, so the held
   connection no longer arises from the gate, but the mechanism remains for any
   other slow adapter read.
3. It does not decide whether the *precheck* slide (step 5) should exist at
   all. Three slides per mutation are two more than the contract requires
   (`IDLE-F02`); dropping the precheck slide is a separate, smaller change.

## 5. The CBD-191 amendment, stated exactly

The implementation packet applies these to
`docs/cbd-191-session-and-revocation-contract.md` v0.3.1 in the same change
as the code, under the same approval rule every earlier amendment followed. The
sentence quoted as "current" is the exact text at `8697762`.

### `IDLE-R01` — §5.1, the idle-slide paragraph (lines 311–313)

Current:

> A session's `idle_expires_at` slides forward on every successfully resolved
> request (bounded by `absolute_expires_at`, which never moves). Both are
> re-checked at resolution (§3.3 case 5); neither is extended past
> `absolute_expires_at`.

Proposed replacement (the first two sentences unchanged; one paragraph added):

> A session's `idle_expires_at` slides forward on every successfully resolved
> request (bounded by `absolute_expires_at`, which never moves). Both are
> re-checked at resolution (§3.3 case 5); neither is extended past
> `absolute_expires_at`.
>
> **`SC-191-006` (Binding). The slide never waits on the session's own
> in-flight mutation.** A slide performed outside a mutation's effect
> transaction is best-effort: it is one atomic statement that updates the row
> only if the row can be locked without waiting. The general rule is that a
> row held by any conflicting lock holder is skipped, not failed: the same
> session's in-flight effect transaction in any process, an in-flight
> single-row revocation or rotation of that row, or any future holder of a
> `FOR UPDATE` or `FOR NO KEY UPDATE` lock on it. The same session's own effect
> transaction is the expected case. A skipped slide is not a store outage and
> does not reject the request; the idle window is then measured from the
> lock-holding transaction's own resolution instant, which is never earlier
> than the request that preceded it, so the under-extension is at most the
> duration of the lock-holding transaction. A skipped slide is still evaluated
> for expiry against the committed row (§3.3 case 5): a request whose slide is
> skipped and whose committed `idle_expires_at` or `absolute_expires_at` has
> passed is expired, never extended (fail-closed). The slide performed
> *inside* a mutation's effect transaction is not best-effort: it takes the
> session-row lock at the commit-time re-read and holds it to COMMIT, so a
> single-row revocation cannot land between that re-read and the commit (§4;
> CBD-236 `PC-236-014`). Resolution outside an effect transaction never waits
> on this lock, so a second request of the same session — including one that
> will be answered `deny_in_flight` by the rate-limit gate (CBD-266 §7) — is
> answered within the ordinary resolution time, not after the fact-assembly
> deadline.

### `IDLE-R02` — §8, one new test row after `CT-191-017` (line 715)

> | `CT-191-018` | Same-session request during an in-flight mutation | When the in-flight mutation is visible to the rate-limit counter (one process today): while a mutation's effect transaction holds the session row (a handler held open past the fact-assembly deadline), a second request of the same session resolves within the ordinary resolution bound, is answered `429` `in_flight` on a `concurrency=1` surface or its ordinary outcome on any other surface, and is never the uniform denial for reason of the lock; its skipped slide leaves `idle_expires_at` at the in-flight mutation's value and `absolute_expires_at` untouched. The `CT-191-013` and A2 fence scenarios (single-row revoke and subject-wide bump during the transaction) keep their outcomes (CBD-191-AC07, AC08) |

### `IDLE-R03` — §11, `CBD-191-AC08` row (line 775)

Append `CT-191-018` to the AC08 evidence list. If the traceability table has
no AC08 row at application time, add `CT-191-018` to the AC07 row instead and
say so in the revision entry.

### `IDLE-R04` — §13, revision row

> | 0.4 | *date* | *specialist, packet* | Applied amendment `SC-191-006` from `docs/cbd-191-idle-extension-nonblocking-proposal.md` (`IDLE-R01`–`IDLE-R03`): the idle slide outside an effect transaction is best-effort and never waits on the session's own in-flight mutation; the in-transaction slide and the authority fence are unchanged. Closes the single-process shape of `SEC-G429-F2`; the cross-process shape remains `SEC-C200-F4` / `IDLE-F03`. | *disposition* |

### No CBD-236 or CBD-266 text changes

CBD-236 `PC-236-014` is satisfied as today: the in-transaction session read,
slide and fence are unchanged. CBD-266 §7's `deny_in_flight` row already
describes the answer this proposal makes reachable; its wording re-seal is a
separate open item (`SEC-G429-R03`, not this packet).

## 6. Implementation packet outline

Level 2, one worktree, one implementation specialist, then Security reading
(the change touches the sessions fence path) and a live QA probe.

### 6.1 Files

| Edit | File | Change |
| --- | --- | --- |
| `IDLE-E01` | `packages/data-access/src/tenant.ts` | `PlatformUpdateQuery` gains `readonly skipLocked?: true`. `platformUpdate` renders, when set, the additional predicate `and ctid in (select ctid from <table> where <same conditions> for no key update skip locked)`, reusing `buildConditions` for both occurrences so the tenant/platform table assertion and identifier checks apply unchanged. No other statement changes. |
| `IDLE-E02` | `packages/data-access/src/tenant.test.ts` | Renders the exact SQL for a `skipLocked` platform update; rejects `skipLocked` on a tenant statement (not needed by this packet; refuse rather than half-support). |
| `IDLE-E03` | `packages/sessions/src/store.ts` | Two distinct methods, not a mode flag: `extendIdleExpiry(sessionRef, at)` stays as today (waits), and a new `extendIdleExpiryBestEffort(sessionRef, at)` passes `skipLocked: true` and returns the row count. The best-effort method exists only on the root store: `createSessionStore` for a transaction-bound client (the `storeFor` factory, `apps/api/src/sessions/index.ts` 30) returns a store whose best-effort method is structurally absent (a `TransactionSessionStore` type without it, and a runtime refusal that throws if reached), so the scoped path cannot skip. |
| `IDLE-E04` | `packages/sessions/src/resolve.ts` | `resolveSession` takes the slide mode from the caller; a zero row count in `"skip_locked"` mode is a resolved outcome, not `store_unavailable`; a thrown error is still `store_unavailable` with the timeout bucket. |
| `IDLE-E05` | `packages/sessions/src/fact-source.ts` | The root path (no transaction) resolves through `extendIdleExpiryBestEffort`; the scoped path (line 45–48) resolves through the waiting `extendIdleExpiry` and fences as today. The choice is made by which store type the path holds, not by a runtime argument. Comment updated to cite `SC-191-006`. |
| `IDLE-E06` | `docs/cbd-191-session-and-revocation-contract.md`; `config/confluence-publication.json` | Apply `IDLE-R01`–`IDLE-R04`; re-pin the contract's `approved_sha256` per the publication manifest rule. |

Not touched: `apps/api/src/authorization/*`, `transaction-store.ts`, the
authority fence, the assembler deadline, the counter store, the web client.

### 6.2 Tests

| Test | Kind | Proves |
| --- | --- | --- |
| `IDLE-T01` | unit, `packages/sessions/src/resolve.test.ts` | Zero rows in `"skip_locked"` mode resolves; a throw still fails closed with the timeout bucket; `"wait"` mode is byte-identical to today's behaviour. |
| `IDLE-T02` | unit guard, `apps/api/src/sessions/fact-source.test.ts` and `packages/sessions/src/store.test.ts` | The transactional read uses the waiting slide and fences; the root read uses the best-effort slide and never fences; a transaction-bound store has no best-effort method and its runtime refusal throws. Deliberate-violation-tested per CLAUDE.md: the specialist inverts the wiring (scoped path calling the best-effort slide), watches the guard fail by name, restores it and watches it pass, and records both runs in the packet result. |
| `IDLE-T03` | live two-request probe, new `apps/api/src/sessions/idle-extension-nonblocking.live.test.ts`, same opt-in as `revocation-fence.live.test.ts` (scratch database, never `cobudget_dev`/`cobudget_demo`) | A mutation whose handler is held open for longer than the assemble deadline; a second request of the same session on the same `concurrency=1` surface is answered 429 `in_flight` within a bound well under 5 s (assert elapsed < 1 000 ms), `GET /v1/identity/me` is 200 within the same bound, `idle_expires_at` equals the in-flight mutation's value while held and `absolute_expires_at` is unchanged; after release the retry is admitted. This is `CT-191-018` and turns every "(PostgreSQL semantics)" claim in §3.2 into evidence. |
| `IDLE-T04` | live, existing `apps/api/src/sessions/revocation-fence.live.test.ts` | Unchanged expectations for `revoke`, `bump` and `none`, with and without the fence — the proof that `IDLE-OPT-B` keeps both halves. |
| `IDLE-T05` | live, existing `apps/api/src/primary-transfer/concurrent-double-confirm.live.test.ts` | Tighten the accepted loser outcome from "429 or 403" to 429 only, with the winner's handler held past the deadline in one process. |
| `IDLE-T06` | CBD-268 harness class, `apps/api/src/authorization/gate-429.test.ts` (`SEC-G429-R02`) | Add the same-session class beside the unauthenticated class: an authenticated same-session second request while the first is held is the 429 with `Retry-After`, the counter is consulted exactly once for it, and the unauthenticated class's bytes and median are unchanged by the new slide statement. The CSRF-failure class `SEC-G429-R02` also names stays as `SEC-G429-F1`'s test at lines 179–197. |
| `IDLE-T07` | guard | `npm run check:migrations` and the data-access lint (`lint.test.ts`) unchanged; a deliberate `skipLocked` on a tenant statement fails `IDLE-E02`. |

### 6.3 Gate and evidence

`npm run check` stages in the foreground; the two live suites on a scratch
database; the docs gate; `check:publication` with the contract re-pinned;
secret scan; Security reading of `IDLE-E01`, `IDLE-E03`–`IDLE-E05`.

## 7. Decisions and open questions for the Executive

| ID | Question | Recommendation |
| --- | --- | --- |
| `IDLE-D01` | Approve `IDLE-OPT-B` and the `SC-191-006` amendment (`IDLE-R01`–`IDLE-R04`) for an implementation packet, with `packages/data-access/src/tenant.ts` in that packet's writable scope (a cross-package interface: the CBD-246 seam owner should read `IDLE-E01`). | Approve; one packet, Security reading before merge. |
| `IDLE-D02` | Should a later design make a single-row revoke that lands *during* the handler abort the mutation (the one strengthening `IDLE-OPT-D` offered), by a mechanism that does not abort on same-session reads? Today a logout during a slow mutation cannot reach `markRevoked` at all (it is refused at the gate); after `IDLE-OPT-B` it resolves and then waits on the row lock until the mutation commits, which is the A2 ordering. | Not now. Record as a CBD-191 §12 question only if Security wants the stronger property. |
| `IDLE-D03` | CBD-236 §5.3 (line 281) says the recheck reads "rows read under lock". For the session row this is true today only because the slide write follows the read; `IDLE-OPT-B` keeps exactly that. Should CBD-236's wording say "re-read inside the transaction and locked before COMMIT" to match the mechanism? | Wording only; route to the CBD-236 owner, no change required for this packet. |
| `IDLE-D04` | Should the precheck slide (step 5, `http.ts` 355) be removed, leaving the gate slide and the in-transaction slide? It is redundant with the gate slide milliseconds earlier and, after this change, is one more best-effort statement per mutation. | Yes, as a follow-on inside the same implementation packet if the specialist finds no test depending on it; otherwise separately (`IDLE-F02`). |

**Security input** (PR #399 reading, disposition `clear`, four Low wording
findings applied in v0.1.1): `IDLE-D01` approve `IDLE-OPT-B` with three
conditions — the `SC-191-006` wording as stated in §5 after that reading (the
scope of the skip, the under-extension bound and the fail-closed expiry
evaluation, and the single-process scope of `CT-191-018`), the structural
guard `IDLE-E03`/`IDLE-E05`/`IDLE-T02` that makes the transaction-bound store
unable to skip, and a Security reading of `IDLE-E01` and `IDLE-E03`–`IDLE-E05`
before merge; `IDLE-D02` not now; `IDLE-D03` wording only, route to the CBD-236
owner; `IDLE-D04` yes, remove the precheck slide in the packet.

## 8. Findings

| ID | Severity (Security) | Finding | Routed to |
| --- | --- | --- | --- |
| `IDLE-F01` | Medium (availability, pre-existing) | `FactAssembler.#read` aborts a controller on timeout (`facts.ts` 117–120) but the sessions adapter never reads `lookup.signal` (`packages/sessions/src/fact-source.ts` 37–54) and the data-access client has no cancellation, so a timed-out statement keeps its pool connection until it completes. After `IDLE-OPT-B` the gate no longer produces such statements, but the mechanism remains for any slow adapter read. | Sessions owner; reliability. |
| `IDLE-F02` | Low | A mutation slides its session row three times (gate `http.ts` 253, precheck `http.ts` 355, effect `boundary.ts` 118) where the contract asks for one slide per resolved request; the second is redundant with the first. | `IDLE-D04`. |
| `IDLE-F03` | Low (same-subject only) | Two mutations of the *same subject* from different sessions (two devices) or the same session across two API processes serialize on the authority fence (`store.ts` 293–306) inside the effect transaction's assemble read, which carries the 5 s deadline (`facts.ts` 141–142). A slow first mutation therefore turns the second into a 403 after 5 s in that class today and after this proposal. A shared lock on the authority row (`select ... for share`) would serialize a bump behind COMMIT without serializing sibling mutations, but the data-access client has no locking read and this proposal does not add one. `SEC-C200-F4` already records the multi-process shape. | CBD-266 owner and sessions owner; a later proposal. |
| `IDLE-F04` | Low | `docs/qa/pk9-criterion-evidence.md` 81 and `concurrent-double-confirm.live.test.ts` 7–13 accept "429 or 403" for the loser. After this change the 403 branch is a regression, not a legitimate outcome, in the single-process case; `IDLE-T05` tightens it. | QA, in the implementation packet. |

## 9. Revision history

| Version | Date | Author | Change | Disposition |
| --- | --- | --- | --- | --- |
| 0.1.1 | September 17, 2026 | Architecture, `ARCH-CBD191-IDLE-EXTENSION-001`, in the lane | Security reading of PR #399 (`clear`, four Low): `SC-191-006` now names the general skip rule for any conflicting lock holder with the same-session transaction as the expected case, the under-extension bound and fail-closed expiry evaluation of a skipped slide, and "resolution outside an effect transaction never waits"; `CT-191-018` scoped to the counter-visible (single-process) case and `IDLE-R04` to the single-process shape of `SEC-G429-F2`; `IDLE-E03`/`IDLE-E05`/`IDLE-T02` make the transaction-bound store structurally unable to skip with a deliberate-violation-tested guard; Security severity grading in §8 and its decision inputs in §7. | Proposed. |
| 0.1 | September 17, 2026 | Architecture, `ARCH-CBD191-IDLE-EXTENSION-001` | Initial proposal: problem statement from `SEC-G429-F2`, four options, `IDLE-OPT-B` recommended, `SC-191-006` amendment text, implementation packet outline, decisions and findings. | Proposed. |
