# CBD-212 — Financial Profile Persistence Contract

| Field | Value |
| --- | --- |
| Status | **Proposed — architecture contract for implementation and independent review; Security review of the concurrency and migration behavior is required before implementation is accepted as Done** |
| Document version | 0.2 |
| Owner | Alexander Wohlford |
| Jira | [CBD-212](https://cobudget.atlassian.net/browse/CBD-212), consuming sibling [CBD-214](https://cobudget.atlassian.net/browse/CBD-214) |
| Parent | [CBD-22](https://cobudget.atlassian.net/browse/CBD-22) |
| Governing logical model | CBD-82 v0.2.1 (Approved, `CBD82-APPROVAL-CONDITION-001`) — `EN-82-02`, `CD-82-01`, `FD-82-003`–`FD-82-005`, `HO-82-01` |
| Governing atomicity decision | Executive decision `CBD190-PROFILE-ATOMIC-001` — a subject never exists without exactly one active profile |
| Consumed identity contract | `docs/cbd-190-identity-ceremony-and-mapping-contract.md` v0.3 §5 (the mapping transaction that inserts this document's table) |
| Consumed session contract | `docs/cbd-191-session-and-revocation-contract.md` v0.2.1 (account-subject identity behind every call this document's port accepts) |
| Consumed authorization contract | `docs/cbd-236-authorization-policy-contract.md` v0.4 §4.2, §8.1, §8.3 (`profile.profileId`/`profileState`/`profileVersion` cells, the bootstrap `space.create` predicate, and `OQ-236-006`) |
| Persistence seam | `packages/data-access` (CBD-246) — **open PR, unmerged as of this document.** §10 names the port this document needs rather than assuming CBD-246's shape |
| Milestone | `PROTOTYPE-SLICE-001` |
| Repository baseline | `main` at the commit this branch forked from |
| Last updated | September 13, 2026 |

> **Authority.** CBD-82 decides the logical model and the Executive decides profile atomicity. This document supplies the physical schema, the database constraint, the concurrency and lifecycle behavior, the migration/backfill contract, and the CBD-214 read/update seam that CBD-82 §11 explicitly assigns to CBD-212 (`HO-82-01`). Where it appears to change `CD-82-01`, `CBD190-PROFILE-ATOMIC-001`, or CBD-190 §5, the governing source wins and this document is wrong.

## 1. Purpose, the CD-82-01 correction, and status

CBD-82 §11 (`HO-82-01`) names CBD-212 as the consumer that "persist[s] one financial
profile per account subject" and states what it may rely on: `CD-82-01`, `EN-82-02`
identifier discipline, and `FD-82-003` to `FD-82-005`. It also states what CBD-212
must not decide — whether a second profile may exist, or whether a profile may be
selected, transferred, merged, or shared. All are prohibited by CBD-82 already.

CBD-82 v0.2.1 §3 and §4 still state `CD-82-01` as "Zero is the state before first
use; two is prohibited" and list `EN-82-02`'s lifecycle as `absent -> active ->
deleted`. Executive decision `CBD190-PROFILE-ATOMIC-001` supersedes the zero-profile
branch: **an account subject never exists without exactly one active financial
profile.** CBD-190 §5.2 step 3 and §5.3 already implement this — a new subject,
its one active profile, and its identity binding commit in the same `SERIALIZABLE`
transaction; there is no window, committed or observable, in which a subject exists
with zero profiles.

This document is the correction CBD190-PROFILE-ATOMIC-001 directs at the CBD-82
package: `CD-82-01`'s zero-before-first-use clause and `EN-82-02`'s `absent` state
are dropped from CBD-212's own model (§5 below defines the corrected `active ->
deleted` machine), and a focused CBD-82 change is the correct place to make the same
edit in that document's own text — this document does not edit CBD-82 directly,
because CBD-82 is another package's approved artifact and single-writer discipline
(`AGENTS.md`, `CLAUDE.md`) applies. **Finding `AF-212-01`** records this as an
outstanding editorial correction owed to the CBD-82 package.

This document itself is a design contract, not executed acceptance evidence. It
does not create a migration file, run a database, or mark any CBD-212 or CBD-214
acceptance criterion passed.

## 2. Scope

**In scope:** the `financial_profile` schema and its database-enforced cardinality
constraint; the get-or-create and repeat-activation contract; the corrected
lifecycle; the migration/backfill contract; the field- and version-sharing seam
CBD-214 consumes to read and update the same row; the persistence port this
document needs from the CBD-246 data-access seam; concurrency and test evidence
requirements.

**Out of scope**, per the ticket and per `HO-82-02`: provider connection and account
ingestion (CBD-107, CBD-84); account-to-budget links (CBD-82 §6); the physical
modeling of budget-space records; CBD-214's field validation rules, canonical error
catalog, and API/OpenAPI surface — this document states only the storage-layer seam
CBD-214 builds on, not CBD-214's own contract; and any CBD-246 implementation
decision beyond the port this document names as a requirement.

## 3. The `financial_profile` table

CBD-190 §5.1 already commits to this row's field set as part of its own logical
schema; this section is the physical realization CBD-190 §5.1 defers to
"the CBD-82/CBD-212 boundary."

| Column | Type | Rule |
| --- | --- | --- |
| `profile_id` | opaque server-generated identifier (UUID) | Primary key. Immutable for the life of the row (`CBD-212-AC02`). Never derived from `account_subject_id`, email, phone, display name, provider account number, budget membership, or asserted legal identity (`CBD-212-AC04`; `EN-82-02` identifier discipline: "none encodes a provider identifier, an account number, a subject, or a space") |
| `account_subject_id` | opaque reference | Not null. References the `account_subject` row CBD-190 §5.1 owns. Foreign key, no cascade delete (see §5) |
| `profile_state` | closed value | Not null. One of `active`, `deleted` (§5). No `absent`/pending value — `CBD190-PROFILE-ATOMIC-001` means every row this table holds is created already `active` |
| `created_at` | `timestamptz` | Not null. Set once, at insert |
| `updated_at` | `timestamptz` | Not null. Set on every state or version change |
| `version` | integer | Not null, default `1`. Bumped by exactly one on every committed mutation, including the ones CBD-214 makes to the preference columns in §9. Optimistic-concurrency token for CBD-214's atomic update (`CBD-214-AC04`) |

CBD-214-owned preference columns (locale, time zone, notification defaults) are
added to this same table by a focused CBD-214 migration under §9's contract; this
document reserves the row and the version column for them and decides none of
their validation.

`config/migrations.json`'s `scopeAnnotation.allowedValues` already reserves a
`financial-profile` scope distinct from `identity`, `platform`, and `budget-space`.
The migration that creates this table declares `-- scope: financial-profile`,
which is itself evidence that this table was anticipated as a distinct persistence
domain rather than folded into `identity` or `platform`.

## 4. The database constraint (CBD-212-AC01)

```sql
ALTER TABLE financial_profile
  ADD CONSTRAINT financial_profile_account_subject_id_key
  UNIQUE (account_subject_id);
```

**`FP-212-01`.** The unconditional unique constraint is the database backstop for
the **at-most-one** half of `CD-82-01`. It does not need a partial predicate,
because this table never holds a second row for one subject in any lifecycle
state. It is not, by itself, evidence for the zero-profile prohibition in
`CBD190-PROFILE-ATOMIC-001`.

**`FP-212-02` — deferred pair invariant.** The migration also installs paired
PostgreSQL constraint triggers, each `DEFERRABLE INITIALLY DEFERRED`: one fires
after an `account_subject` insert or lifecycle update, and one fires after a
`financial_profile` insert, `account_subject_id`/`profile_state` update, or
delete. At commit, both call the same invariant function for every affected
subject identifier. The function requires:

* every non-terminal subject row (`active`, `disabled`, `deletion_pending`, or
  `security_blocked`) has exactly one profile row and that row is `active`;
* an `active` profile belongs to a non-terminal subject; and
* a `deleted` profile belongs only to a subject whose terminal transition is
  committed in that same transaction or was committed earlier.

The implementation uses an `AFTER ROW CONSTRAINT TRIGGER`, not an ordinary
immediate trigger, so CBD-190 §5.2 may insert the subject and profile in either
statement order and the pair is evaluated only against the transaction's final
state. The trigger raises a named integrity exception and aborts the whole
transaction if the count or state pairing is wrong. It never creates or repairs
a row. All subject/profile creation and lifecycle writers use `SERIALIZABLE` and
lock the `account_subject` row before changing an existing pair; the unique
constraint serializes competing inserts. This is the concrete commit-time
mechanism CBD-190 §5.3 requires.

Physical purge is the one deliberate post-terminal exception: after §5's durable
terminal-disposition predicate is true, the profile-side trigger accepts zero
profile rows for that terminal subject. The terminal subject/tombstone and
deletion ledger remain the non-resurrection authority; a non-terminal subject
can never use this exception.

**`FP-212-03`.** The unique constraint is immediate and produces SQLSTATE
`23505` for a competing second row. The deferred pair trigger is checked at
commit and covers zero rows, a non-active sole row, and inconsistent lifecycle
pairing regardless of which writer issued the statements. Together — not the
unique constraint alone — they enforce the cardinality and atomicity boundary.

## 5. Lifecycle (the CD-82-01/EN-82-02 correction, and CBD-212-AC05)

| State | Entered | Exited | Notes |
| --- | --- | --- | --- |
| `active` | Row insertion, always inside the transaction that also creates the subject (CBD-190 §5.2) or, for a pre-existing subject discovered without one by a backfill (§8), a reconciled insert | Subject deletion reaches its terminal state | The only state a caller ever observes for a usable subject. There is no `absent`/pre-first-use state to observe — `CBD190-PROFILE-ATOMIC-001` |
| `deleted` | In the same transaction in which account-subject deletion (`OC-82-07`) reaches its terminal, irreversible point | Never | Terminal. Physical purge is ordered by `LC-212-06`; the retention period remains governed outside this document |

`LC-212-01` through `LC-212-06` state what each `CBD-212-AC05` path does to this
table, and each converges on "the existing `active` row, untouched, or the
terminal `deleted` row, never a second row":

| ID | Path | Effect on `financial_profile` |
| --- | --- | --- |
| `LC-212-01` | Disabled, deletion-pending, or security-blocked subject (CBD-190 §5.3 `account_unavailable`) | No effect. The row already exists and stays `active`; access denial is enforced by the session and authorization boundary (CBD-191, CBD-236 `subject_not_active`/`profile.profileState`), never by mutating this table. There is no "disabled" profile state to invent |
| `LC-212-02` | Restore (deletion request cancelled before the terminal point) | No effect. The row was never touched by a non-terminal deletion request; "restore" is a subject-lifecycle event this table does not participate in |
| `LC-212-03` | Reconnect / repeat sign-in through an existing identity binding | Resolves to the same existing `active` row through `account_subject_id`; see §6's repeated-activation path. No new row |
| `LC-212-04` | Stale identity callback (a duplicate or delayed CBD-190 callback for an already-mapped challenge) | CBD-190 §5.2 step 1 and §7 already return the previously committed result without repeating any mapping effect; if a defect elsewhere ever presented this table with the same `account_subject_id` again, `FP-212-01`'s constraint is the backstop that makes the second insert fail rather than succeed |
| `LC-212-05` | Provider-subject reuse (a new provider `sub`, or a reused contact attribute, presented after the former subject reached `deleted`) | CBD-190 §5.1 and §12: reuse of a contact attribute or a different provider subject never resurrects the former subject (`PA-92-007`). A reused contact attribute maps to a *new* `account_subject_id`, which gets its own new profile through the ordinary first-use path — it is a new subject with a new profile, never a second profile on the deleted subject, and never a revived row (`PB-82-10`) |
| `LC-212-06` | Terminal disposition and physical purge | The lifecycle transaction locks the subject, atomically changes subject and profile to `deleted`, writes the durable terminal disposition/deletion-ledger record, and commits before any profile purge is eligible. A later purge may remove the deleted profile only after re-locking the terminal subject and proving that durable record. Purge before terminal disposition, purge while the subject is non-terminal, and recreation after purge are rejected (`PA-92-006`, `PA-92-007`) |

Once a subject reaches `deleted`, no code path in this document, CBD-190, or
CBD-191 may reactivate or recreate its profile row. Exact reuse of the same
`(environment_id, issuer, provider_subject)` resolves the retained binding and
deleted subject and returns `account_unavailable`; the binding is never remapped.
After physical profile purge, the durable terminal subject/tombstone and deletion
ledger still make that result authoritative. Reuse of only a contact attribute,
or use of a different provider subject, follows `LC-212-05` and cannot inherit
the former authority.

## 6. Idempotent activation and concurrency (CBD-212-AC02, AC08)

Two call shapes exist. Both must satisfy the combined unique and deferred-pair
mechanism in `FP-212-01`–`FP-212-03`; neither may treat a deleted row, terminal
subject, or purged former profile as an activation opportunity.

**`CC-212-01` — participate in a caller's transaction (CBD-190's use).** CBD-190
§5.2 step 3 performs a plain `INSERT` of this row inside its own `SERIALIZABLE`
transaction alongside the new subject and binding. This document's contribution
is the row shape and the constraint; CBD-212 adds no additional statement here.
A unique violation aborts CBD-190's whole attempt and CBD-190's own bounded
whole-transaction retry (§5.2) resolves it by re-reading the committed winner.
CBD-212 does not duplicate that retry loop.

**`CC-212-02` — standalone `getOrCreateActiveProfile(accountSubjectId)`.** Used by
an authorized caller outside the CBD-190 mapping transaction. It executes one
short `SERIALIZABLE` transaction through §10's subject-scoped port:

```sql
SELECT lifecycle_state
FROM account_subject
WHERE account_subject_id = $2
FOR UPDATE;

INSERT INTO financial_profile (profile_id, account_subject_id, profile_state, created_at, updated_at, version)
SELECT $1, account_subject_id, 'active', now(), now(), 1
FROM account_subject
WHERE account_subject_id = $2
  AND lifecycle_state = 'active'
ON CONFLICT (account_subject_id) DO NOTHING
RETURNING *;
```

The first statement must return exactly one subject in `active` state. Missing,
disabled, deletion-pending, deleted, or security-blocked subjects return the same
safe `account_unavailable` result and commit no profile effect. When the insert
returns zero rows, the port selects by the same server-bound
`account_subject_id`, requires exactly one existing row with
`profile_state = 'active'`, and returns it. A missing existing row is an integrity
failure outside an explicitly ordered pre-constraint backfill; a `deleted` row
is `account_unavailable`, never a row to return or reactivate. The deferred pair
trigger rechecks the active subject/active profile result at commit.

The subject lock makes a terminal lifecycle transition mutually exclusive with
this transaction. Concurrent activation calls converge on one active row through
the unique constraint; a terminal transition that wins the lock causes every
later call to fail unavailable. After an authorized purge, the retained terminal
subject/tombstone fails the first check, so `INSERT` cannot recreate authority.

**`CC-212-03` — retried requests.** A client-level retry of "activate my profile"
(e.g., a repeated first-use API call after a timeout) calls `CC-212-02` again with
the same `account_subject_id` and observes the same `profile_id`, whether or not
the first attempt's response was lost. No request-level idempotency key is needed
on top of the subject-keyed constraint, because `account_subject_id` is already
the caller's stable idempotency key for this operation.

**Isolation and locking, documented for CBD-212-AC08:**

| Path | Isolation | Locking behavior |
| --- | --- | --- |
| `CC-212-01` (inside CBD-190) | `SERIALIZABLE`, CBD-190's transaction | Governed entirely by CBD-190 §5.2; CBD-212 adds only the constraint the transaction relies on |
| `CC-212-02` (standalone) | `SERIALIZABLE` | Locks the subject row `FOR UPDATE`, validates active subject and active existing profile state, then relies on the unique constraint for competing inserts and the deferred pair trigger for the final commit-time invariant |

## 7. Prohibited operations (CBD-212-AC06)

No operation named below exists in this document's contract, and none is
implemented by adding a flag, a nullable second reference, or an "admin override"
to the schema in §3:

| Operation | Status |
| --- | --- |
| Profile selection (choosing among more than one) | Absent — there is never more than one row to select |
| Profile transfer (moving a profile to a different subject) | Absent — `account_subject_id` has no update path; the column is write-once at insert |
| Profile merge or split | Absent — no operation reads two profile rows and writes one, or the reverse |
| Profile nesting | Absent — no parent/child reference exists on this table |
| Profile sharing | Absent — no second-subject reference or grant table exists here; account-to-space linking (`EN-82-07`) is a different, CBD-82-owned bridge that never reaches this table |
| Legal-person inference | Absent — this table carries no legal-name, entity-type, or verification-status column |

Any future request for one of these operations is a change to CBD-82 `CA-92-*`
and `CD-82-*`, not a local extension of this document, per CBD-82 §4's closing
statement.

## 8. Migration and backfill (CBD-212-AC07)

The prototype milestone has no pre-existing subject population, so the first
applied migration creates the table, unique constraint, and deferred triggers in
§3–§4; there is no day-one backfill to run. If a later deployment has legacy
subjects, its migration order is fixed: create an unconstrained staging relation,
load the legacy fixture, reconcile, backfill, then install the foreign key,
unique constraint, and deferred triggers before exposure to application traffic.
This is the only context in which `CC-212-02` may create a row for a previously
committed subject that has none.

**`MB-212-01`.** A pre-constraint backfill is idempotent and re-runnable: for
every active `account_subject` row lacking a staged `financial_profile` row, it
uses `CC-212-02` with explicit migration authority. Subjects that already have
an active row are untouched; unavailable or terminal subjects are reported and
never activated.

**`MB-212-02`.** Before writing anything or installing constraints, the backfill
runs a read-only reconciliation pass over the unconstrained staging relation and
refuses to proceed if it finds:

* more than one `financial_profile` row referencing the same `account_subject_id`
  (impossible after `FP-212-01`, but reproducible in the pre-constraint fixture); or
* a `financial_profile` row whose `account_subject_id` matches no
  `account_subject` row (orphaned).

**`MB-212-03`.** Either finding aborts the run before any write, in a single
transaction that is rolled back, and produces a reconciliation report rather
than silently keeping one row and discarding the rest. The report is a
structured record (JSON or an equivalent reviewable artifact) naming, for the
run: `run_id`, `run_at`, `duplicate_subject_ids` (each with its conflicting
`profile_id`s and their `created_at`), `orphaned_profile_ids`, and the exact
counts of subjects considered, rows that would have been inserted, and rows
skipped as already present. No automatic disposition — deleting a duplicate,
picking the earliest row, or deleting an orphan — is performed by the backfill
itself; that requires a human reviewer reading the report and a separate,
authorized follow-up change.

**`MB-212-04`.** A clean run (no duplicates, no orphans) commits its inserts in
one transaction and still emits the same report shape with empty duplicate and
orphan lists, so "the backfill found nothing wrong" is a recorded, reviewable
claim rather than an inferred one.

The negative fixture contains, before any constraint is installed, two rows for
one known subject and one row referring to an absent subject. Each anomaly is
also tested alone. Every variant proves reconciliation aborts before profile
inserts or constraint installation, rolls back, and emits the exact report fields
from `MB-212-03`. This fixture does not disable a production constraint.

## 9. The CBD-214 read/update seam (HO-82-02, CBD-214-AC01/04/05/06)

CBD-214 owns field validation, the API/OpenAPI contract, canonical error codes,
and default/fallback resolution. CBD-212 owns and this section states exactly
what CBD-214 may rely on from the storage layer, per `HO-82-02`'s instruction
that the field inventory and authority set are complete only where CBD-82/CBD-212
state them.

**`SP-212-01` — one row, one version, shared.** CBD-214's preference columns
(locale, time zone, notification defaults, and any future personal default) are
added to the same `financial_profile` row by CBD-214's own focused migration,
not a second table. They share this row's `version` column. This is what makes
CBD-214-AC04's "commits every valid field and one new version together, or
commits none" a single-statement guarantee rather than a cross-table transaction
CBD-214 has to coordinate: one `UPDATE ... SET <preference columns>, updated_at =
now(), version = version + 1 WHERE profile_id = $1 AND version = $expected`
either updates the one row with every field or updates zero rows, and CBD-214
treats zero rows as a version conflict.

**`SP-212-02` — read port.** `getCurrentProfile(accountSubjectId)` returns the
row for the calling session's own `account_subject_id`, taken from the CBD-191
session, never from a client-supplied identifier. This is the storage-layer
half of CBD-214-AC01 ("only their current profile"); CBD-214 owns the route,
authentication check, and cross-subject denial around this call. The query runs
only through `SM-212-01`, which binds that subject identifier to every statement
and rejects a missing subject predicate.

**`SP-212-03` — write port.** `updateProfilePreferences(accountSubjectId,
expectedVersion, patch)` performs the single `UPDATE` in `SP-212-01` and returns
either the new row (success) or a version-conflict signal (zero rows matched).
It runs only through `SM-212-01`; the update predicate contains both the bound
`account_subject_id` and `profile_id`, so a caller cannot substitute another
subject's row even when it knows an opaque identifier.
It never accepts or writes `profile_id`, `account_subject_id`, `profile_state`,
`created_at`, or `version` itself as patchable fields — those five columns are
read-only from CBD-214's perspective, which is the storage-layer half of
CBD-214-AC05's "unknown/read-only fields are rejected."

**`SP-212-04` — omitted vs. cleared vs. set.** Every CBD-214-owned column is
independently nullable at the storage layer. `patch` therefore can represent
three states per field — key absent (omitted, column unchanged), key present
with an explicit clearing value (column set to `NULL`, if CBD-214's field
contract permits clearing that field), and key present with a value (column
set) — because the storage layer never collapses "not sent" and "sent as
empty" into one representation. CBD-214 decides which of its fields permit
clearing and what wire shape represents each state; this document decides only
that the column-level distinction exists for it to use.

**`SP-212-05` — deterministic defaults.** A `NULL` preference column is always
distinguishable from a subject's affirmative field choice, because CBD-212 never
writes a non-`NULL` default into a preference column on profile creation (§6's
insert statement in §3 sets only the six CBD-212-owned columns). CBD-214-AC06's
"distinguish a user choice from an unset value" is therefore satisfiable at the
storage layer without CBD-212 asserting what the resolved default value is —
that resolution is CBD-214's own documented behavior, applied at read time over
a `NULL` it can always tell apart from a set value.

**Not provided here:** locale/time-zone format validation, the notification
channel/category vocabulary, canonical error codes, and the OpenAPI schema are
entirely CBD-214's contract. This document names no default value, no supported
locale, and no notification channel.

## 10. The persistence port this document needs from CBD-246

`packages/data-access` (CBD-246) is an open, unmerged PR at the time of this
document, so this section names a requirement rather than describing CBD-246's
shape as fact.

As merged in the branch reviewed for this document, CBD-246 exposes exactly two
statement paths: `runTenantStatement`, which requires a `budgetSpaceId` and is
the only path for tables `config/migrations.json` classifies `budget-space`; and
`runPlatformStatement`, an explicit unscoped escape hatch for tables classified
`identity` or `platform`. Neither is scoped by `account_subject_id`, and
`config/migrations.json` already reserves a third scope value, `financial-profile`
(§3), distinct from both — which this document reads as the schema-policy layer
anticipating exactly this table's persistence domain before CBD-246 supplied a
matching statement path.

**`SM-212-01` (prerequisite on CBD-246).** Before CBD-212 or CBD-214 implements
any financial-profile access, CBD-246 must provide a subject-scoped statement
path (for example, `runProfileStatement`) that takes a server-obtained
`accountSubjectId`, admits only tables classified `financial-profile`, and
requires every statement to bind that identifier in its subject predicate. It
provides the same compile-time and runtime scoping discipline that
`runTenantStatement` provides for `budget-space`, including negative tests for a
missing predicate, a mismatched bound value, and an attempted cross-subject read
or update. `CC-212-02`, `SP-212-02`, and `SP-212-03` consume only this path.

`runPlatformStatement` is not an interim or fallback path: CBD-246 limits it to
`identity` or `platform` tables, and neither the uniqueness constraint nor the
deferred pair trigger enforces subject isolation. CBD-212 implementation is
blocked until the CBD-246 owner lands the scoped port. This requirement does not
amend CBD-246 here; it records the technical dependency its owner must satisfy.

## 11. Test and evidence requirements (CBD-212-AC08)

| Test ID | Scenario | Required invariant |
| --- | --- | --- |
| `CT-212-001` | First activation | From zero rows for a fresh subject, exactly one `financial_profile` row is committed, in `active` state, sharing CBD-190's mapping transaction commit |
| `CT-212-002` | Repeated activation | A second `CC-212-02` call for the same `account_subject_id` returns the identical `profile_id`; row count does not increase |
| `CT-212-003` | Concurrent activation | A barrier releases N concurrent `CC-212-02` (or, for CBD-190's own path, N concurrent CBD-190 attempts) callers for one `account_subject_id`; exactly one row commits, every caller observes the same `profile_id`, and the delta for unrelated subjects is zero |
| `CT-212-004` | Retried request | A caller repeats the same activation call after a simulated timeout; no duplicate row, same `profile_id` returned |
| `CT-212-005` | No collateral creation | After `CT-212-001`, isolated before/after counts for budget, schedule, period, membership, category, target, bill, goal, transaction assignment, provider connection, and account-to-space link tables are all zero delta (`CBD-212-AC03`) |
| `CT-212-006` | Identity independence | Two subjects with identical email, phone, display name, and provider account number (distinct `account_subject_id`s) receive two distinct `profile_id`s neither derived from nor equal to any of those shared values (`CBD-212-AC04`) |
| `CT-212-007` | Disabled/security-blocked subject | No new or reactivated row; existing `active` row unchanged (`LC-212-01`) |
| `CT-212-008` | Restore before terminal deletion | No effect on the row (`LC-212-02`) |
| `CT-212-009` | Terminal deletion and provider-subject reuse | Row transitions to `deleted` and never reactivates; a reused contact attribute or new provider `sub` produces a new subject and a new, independent row (`LC-212-05`) |
| `CT-212-010` | Migration/backfill positive control | A clean population backfills every missing row exactly once and emits an empty-list reconciliation report (`MB-212-04`) |
| `CT-212-011` | Migration/backfill fail-closed | A seeded duplicate or orphaned row aborts the backfill before any write and produces a reconciliation report naming the exact offending identifiers (`MB-212-02`, `MB-212-03`) |
| `CT-212-012` | CBD-214 atomic update | A multi-column `SP-212-03` update with a correct `expectedVersion` commits every column and bumps `version` by exactly one, together; a stale `expectedVersion` updates zero rows and leaves the prior representation intact (`CBD-214-AC04`) |
| `CT-212-013` | Omitted/cleared/set distinction | Three separate `SP-212-03` calls — one omitting a field, one explicitly clearing it, one setting it — leave three distinguishable storage outcomes (`SP-212-04`) |
| `CT-212-014` | Subject-only commit | Insert a new active subject without a profile and force deferred constraints; commit fails, the subject is rolled back, and no binding or hand-off can commit (`FP-212-02`) |
| `CT-212-015` | Zero-active-profile commit | Delete the sole profile of a non-terminal subject and force deferred constraints; commit fails and the active row remains (`FP-212-02`) |
| `CT-212-016` | Active-subject/deleted-profile commit | Change the sole profile to `deleted` while its subject remains active and force deferred constraints; commit fails and both rows retain their prior states (`FP-212-02`) |
| `CT-212-017` | Terminal lifecycle and purge ordering | Disabled, deletion-pending, security-blocked, deleted, and missing subjects all make `CC-212-02` return `account_unavailable` with no row effect; terminal transition commits subject, profile, and deletion ledger atomically; purge is rejected before that commit and accepted afterward without permitting recreation (`LC-212-06`) |
| `CT-212-018` | Exact provider-subject reuse | Reuse the same `(environment_id, issuer, provider_subject)` after terminal deletion and after authorized profile purge; the retained binding resolves the old deleted subject, no subject/profile is created or reactivated, and the result is `account_unavailable` |

Every concurrency case (`CT-212-003`) uses a barrier so all workers begin the
conflicting insert before any is released, and asserts the exact winner count
rather than an upper bound, matching the discipline CBD-190 `CT-190-003` and
`CT-190-012` already require of the transaction this table participates in.

## 12. Alternatives and tradeoffs

| Alternative | Disposition | Tradeoff |
| --- | --- | --- |
| Partial unique index on `(account_subject_id) WHERE profile_state = 'active'` | Rejected | Enforces only at-most-one active row and permits a second deleted row; the unconditional unique constraint plus deferred pair trigger enforces the intended physical cardinality and zero-profile rule |
| Separate `financial_profile` and `financial_profile_preferences` tables, joined by `profile_id` | Rejected | Splits CBD-214's atomic multi-field commit across two tables and two version counters, turning `CBD-214-AC04`'s single-statement guarantee into a cross-table transaction CBD-214 would have to re-derive; §9's single-row design gives CBD-214 atomicity for free |
| `profile_id = account_subject_id` (reuse the subject identifier) | Rejected | Violates `EN-82-02`'s identifier discipline: an identifier that encodes another entity's identity becomes a correlation channel, and CBD-82 explicitly requires each entity's identifier to stand alone |
| Soft-delete via a nullable `deleted_at` column instead of a `profile_state` enum | Rejected | `profile_state` matches CBD-190 §5.1's own field name ("active lifecycle state") and reserves room for a future state without a second migration touching column type; a timestamp-only design would need one anyway if a third state is ever needed |
| Have CBD-212 itself add a `financial-profile`-scoped statement runner to `packages/data-access` | Deferred to implementation, not decided here | CBD-246 is another package's open PR; naming the requirement (§10) and leaving the addition to whichever implementer lands second respects single-writer discipline over that shared surface |

## 13. Migration, compatibility, and dependencies

Creating this table has no compatibility surface to preserve — it does not exist
before this change. Implementation dependencies are:

1. `packages/migrations` (CBD-117/CBD-19 infrastructure) for the forward-only
   migration that creates the table, its constraint, and its `-- scope:
   financial-profile` annotation;
2. the CBD-190 mapping transaction (§5.2) as the sole first-use writer for the
   ordinary sign-in path;
3. the CBD-246 subject-scoped persistence port from §10 as a prerequisite; there
   is no unscoped fallback;
4. CBD-191's session boundary, as the sole source of `accountSubjectId` for
   `SP-212-02`/`SP-212-03`; and
5. the CBD-214 implementation itself, which adds its own preference-column
   migration on top of §3's table and consumes §9's seam.

## 14. Acceptance-criteria traceability

### CBD-212

| Criterion | Contract sections | Evidence this document specifies |
| --- | --- | --- |
| `CBD-212-AC01` | §3, §4 | `FP-212-01`–`FP-212-03`; `CT-212-003`, `014`, `015`, `016` |
| `CBD-212-AC02` | §6 | `CC-212-01`–`CC-212-03`; `CT-212-001`, `002`, `003`, `004` |
| `CBD-212-AC03` | §2, §6 | `CT-212-005` |
| `CBD-212-AC04` | §3 (`profile_id` rule) | `CT-212-006` |
| `CBD-212-AC05` | §5 (`LC-212-01`–`06`), §6 | `CT-212-007`, `008`, `009`, `017`, `018` |
| `CBD-212-AC06` | §7 | Table in §7; no test proves an absence beyond the schema and contract themselves, per CBD-82's own treatment of `PB-82-*` |
| `CBD-212-AC07` | §8 (`MB-212-01`–`04`) | `CT-212-010`, `011` |
| `CBD-212-AC08` | §6 (isolation/locking table), §11 | Full §11 table |

### CBD-214 (the subset this document enables)

| Criterion | Contract sections | What CBD-212 supplies | What remains CBD-214's own contract |
| --- | --- | --- | --- |
| `CBD-214-AC01` | `SP-212-02`, `SM-212-01` | Session-keyed, subject-scoped read with no client-supplied subject id or unscoped fallback | The route and authentication enforcement |
| `CBD-214-AC04` | `SP-212-01`, `SP-212-03`; `CT-212-012` | Single-row, single-version-column atomic update primitive | Field-level validation before the update is attempted |
| `CBD-214-AC05` | `SP-212-03`, `SP-212-04`; `CT-212-013` | Read-only column enforcement; omitted/cleared/set distinguishability | Which fields permit clearing, and the wire representation of each state |
| `CBD-214-AC06` | `SP-212-05` | `NULL` never written as a default, so unset is always distinguishable from chosen | The actual default/fallback values and their documentation |

CBD-214-AC02, AC03, AC07, and AC08 are entirely CBD-214's own contract (locale/
time-zone validation, notification vocabulary, response redaction, and contract
test coverage) and are not addressed here.

## 15. Open questions and findings

| ID | Item | Disposition |
| --- | --- | --- |
| `AF-212-01` | CBD-82 §3/§4 text (`CD-82-01`, `EN-82-02`) still names the zero-profile branch `CBD190-PROFILE-ATOMIC-001` dropped | Not this document's package to edit (single-writer rule). Reported to the Manager for a focused CBD-82 change |
| `OI-212-01` | CBD-246 does not yet expose the required subject-scoped path for `financial-profile` tables | Blocking implementation dependency. The CBD-246 owner must land `SM-212-01`; `runPlatformStatement` is prohibited for these rows |
| `OQ-236-006` (cross-reference, not owned here) | CBD-236 asks what approved CBD-22 source authorizes profile create/read/preferences | This document is that source for profile *creation* (§6) and the read/update *seam* (§9); CBD-236's own `p1` deny for profile actions should be revisited against this document once it is reviewed, which is a CBD-236-package decision, not one this document makes |

No criterion in §14 is waived. AC06 is closed by absence of implementation
surface rather than by a positive test, consistent with CBD-82's own treatment
of its `PB-82-*` prohibitions.

## 16. Revision history

| Version | Date | Author | Change | Disposition |
| --- | --- | --- | --- | --- |
| 0.1 | September 13, 2026 | Architecture specialist, dispatched under `CBD212-ARCH-001 v1` | Initial financial-profile persistence contract: schema, database constraint, corrected lifecycle, concurrency contract, migration/backfill contract, CBD-214 read/update seam, and the CBD-246 persistence-port requirement. | Proposed; independent review and Security review required. |
| 0.2 | September 13, 2026 | Architecture specialist, dispatched under `CBD212-ARCH-002 v1` | Review F1 → unique constraint narrowed to at-most-one and paired deferred commit-time triggers plus subject-only/zero-active/deleted-profile negative tests added (lines 94–141, 414–416); F2 → subject-scoped CBD-246 port made a prerequisite, unscoped fallback removed, and CBD-214 seam bound to it (lines 322–335, 350–395, 471); F3 → standalone port locks and requires an active subject/active existing profile, terminal disposition precedes purge, and unavailable/exact-reuse cases cannot recreate authority (lines 145–169, 186–219, 417–418). Cross-reference pass aligned migration fixtures, `CT-212-*`, traceability, alternatives, dependencies, and `OI-212-01`. | Proposed; repeat independent review and Security review required. |
