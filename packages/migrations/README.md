# @cobudget/migrations

Forward-only PostgreSQL migrations for MoneyPact (CBD-116) and the local
development database they run against (CBD-117).

PostgreSQL is the decision recorded in CBD-105 (`DP-105-001`). Forward-only is
the decision recorded in CBD-103 (`TD-103-028`). Neither is re-opened here.

## Commands

Two ways to reach a database. Locally, the `db:*` commands below run `psql`
inside the CBD-117 container, so nothing but Docker is installed on the host.
Hosted, the `migrate*` commands run `psql` on the runner, and the connection is
never read by this tool: `psql` resolves it from the standard libpq environment
— `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSERVICE`,
`PGSSLMODE`, `~/.pgpass` — so no password passes through our process, reaches a
log line, appears in `ps` output, or has to be registered as a variable this
repository reads. Both routes run the same code; `--local` only swaps the
executor.

| What | Local (container) | Hosted (libpq environment) |
| --- | --- | --- |
| Start the database, confirm the pinned major | `npm run db:up --workspace=@cobudget/migrations` | — |
| Apply every migration, from empty or from anywhere | `npm run db:migrate --workspace=@cobudget/migrations` | `npm run migrate --workspace=@cobudget/migrations` |
| Show what is applied and what is pending | `npm run db:status --workspace=@cobudget/migrations` | `npm run migrate:status --workspace=@cobudget/migrations` |
| Recovery: drop everything and re-apply | `npm run db:reset --workspace=@cobudget/migrations` | `npm run migrate:reset --workspace=@cobudget/migrations -- --confirm-destroys-all-data` |
| Load seed data (currently zero rows) | `npm run db:seed --workspace=@cobudget/migrations` | — |
| Prove version, roles, and grants | `npm run db:verify --workspace=@cobudget/migrations` | — |
| Stop, keeping the data | `npm run db:stop --workspace=@cobudget/migrations` | — |
| Remove the container and its data | `npm run db:destroy --workspace=@cobudget/migrations` | — |
| Stamp a new migration | `npm run migrate:create --workspace=@cobudget/migrations -- "add budget space"` | same |
| Check the migrations without a database | `npm run migrate:check --workspace=@cobudget/migrations` | same |

There is no revert, down, rollback, or undo command, and there is no way to ask
for one. Rollback is a code and configuration operation; a reversible "down"
migration executed under incident pressure can destroy committed customer data
to recover an application fault, and it is the least-rehearsed path in the
system at the moment it is most needed (`TD-103-028`). Local recovery is reset
and re-migrate. `commandNames` is asserted against the forbidden list in
`config/migrations.json`, so adding a reversion command fails the build.

`reset` is fenced twice: it needs the confirmation flag, and it asks the server
`SELECT current_database()` and refuses any name that is not recognisably
local. The server is asked rather than the environment inspected, because the
environment is exactly what is wrong when someone resets the wrong database.
`db:reset` passes the flag for you, because the database it reaches is the
container's by construction; the name check still runs.

Before any of `apply`, `status`, or `reset` reads or changes anything, the
tool asks the server its version and refuses to continue if the major differs
from the one pinned in `compose.yaml`, naming both (CBD-117-AC03, below).

## How a migration is applied

1. The check runs. A migration that fails it is never sent to the database.
2. One `psql` session reads the ledger, tolerating a database where it does not
   exist yet.
3. The pending set is planned: everything on disk that the ledger does not
   record, in ordinal order.
4. One generated script runs the whole pending set inside **one transaction**
   holding **one advisory lock**, inserting the ledger row for each migration in
   the same transaction as the migration itself.

Applying twice **in sequence** is therefore a no-op that exits 0 and says so,
and a run that fails part way leaves neither schema nor ledger changed.

**Two runners at once is a different case, and weaker than it should be.** The
ledger is read in step 2, in an earlier session, before the lock of step 4 is
taken. Two runners starting together both read the same ledger and build the
same script. The lock serialises them, so the second cannot interleave with the
first — but it replays work already done and fails on `already exists` or on
the ledger's `ordinal text PRIMARY KEY`, inside its own transaction, which
rolls back.

So concurrency is **safe but not live**: no corruption, no half-applied schema,
no duplicate ledger row, but the second runner exits non-zero rather than
finding nothing to do. In a retried pipeline that is a failed retry. Fixing it
means reading the ledger inside the locked transaction, which means building
the plan after the lock instead of before — a restructure into a single
session. It is a follow-up, and it should be resolved before anything deploys
with two concurrent runners.

**Limitation.** One transaction for the whole set means a statement that cannot
run inside a transaction — `CREATE INDEX CONCURRENTLY`, `ALTER TYPE ... ADD
VALUE` on older servers — cannot be used as written. That is a real constraint
on every later migration, recorded here rather than discovered later. Changing it
means giving up all-or-nothing application, which is what makes "applied state
lives in the database" true after a failure and not only after a success.

## File names and parallel authoring

    20260912T163355Z__create_schema_migrations.sql
    └── UTC ordinal ──┘  └────── slug ──────────┘

A UTC instant sorts deterministically as text and needs no agreement between
two branches, which a sequential counter does — every branch picks `0007`. Two
authors can still land on the same second; that is rejected outright by the
duplicate-ordinal rule rather than resolved by whichever slug sorts first.

A migration that arrives behind an ordinal already applied **is applied**, and
the ledger's `apply_seq` records the order things really ran in. Refusing it
would mean re-stamping a reviewed file after every merge, which is the conflict
the ordinals exist to remove. The rule this buys is that a migration may not
assume the ordinal before it has already run.

## What the check enforces

Every rule is data in [`config/migrations.json`](../../config/migrations.json),
carries the approved decision it comes from, and has a fixture that breaks it.

| Rule | Criterion | What fails |
| --- | --- | --- |
| `file-name` | AC07 | A name that is not `<UTC ordinal>__<slug>.sql` |
| `duplicate-ordinal` | AC07 | Two migrations stamped the same second |
| `forward-only` | AC03 | A `.down.sql` file, or another tool's reversion directive |
| `transaction-control`, `psql-meta-command` | AC01 | `COMMIT`, `ROLLBACK`, or a `\` command inside a migration, anywhere on the line |
| `contract-step` | AC04 | A removal or rename with no header naming its expand migration and the deployed version that removed the last reader |
| `forbidden-type` | AC05 | `money`, binary floating point, `timestamp`/`time` without time zone |
| `monetary-type` | AC05 | A monetary column that is not integer minor units |
| `monetary-currency` | AC05 | Monetary columns with no currency code column on the table |
| `table-scope` | AC05 | A `CREATE TABLE` with no `-- scope:` annotation, or an unknown scope |
| `budget-space-column` | AC05 | A budget-space-scoped table with no `budget_space_id` |
| `schema-owner` | AC06 | An ORM that owns the schema, or a migration that is not `.sql` |
| `encoding` | AC02 | A byte order mark, invalid UTF-8, mixed line endings, no trailing newline |

Scope is declared rather than inferred, because it cannot be inferred from a
table name:

```sql
-- scope: budget-space
CREATE TABLE budget_space_plan_line (
    id               uuid NOT NULL,
    budget_space_id  uuid NOT NULL,
    planned_amount   bigint NOT NULL,
    currency_code    text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
);
```

A removal carries its evidence in the file:

```sql
-- contract-step: yes
-- completes-expand: 20260101T000000Z__create_plan_line
-- last-reader-removed-in: v0.4.2
ALTER TABLE budget_space_plan_line DROP COLUMN superseded_at;
```

`completes-expand` must name a migration that actually exists in the directory
and precedes this one, so the header cannot say just anything.

Both spellings of each removal are caught, because PostgreSQL accepts both:
`DROP COLUMN c` and `DROP c`, `DROP COLUMN IF EXISTS c` and `DROP IF EXISTS c`,
`RENAME COLUMN a TO b` and `RENAME a TO b`. Matching only the verbose form
would have let a migration destroy a committed column while the check printed
`passed`. Inside `ALTER TABLE` the words that may follow `DROP` are a closed
list — `COLUMN`, `CONSTRAINT`, `DEFAULT`, `NOT NULL`, `IDENTITY`, `EXPRESSION`,
or a bare column name — so the rule excludes the five that destroy no column by
name and treats everything else as a removal.

### A typed SQL layer, not an ORM (AC06)

The architecture chose "managed PostgreSQL with a typed SQL layer". The schema
is owned by the `.sql` files in `migrations/` and by nothing else; a query layer
reads that schema, it does not define it. This is enforced two ways: the check
rejects a schema-owning ORM in this package's manifest or a migration that is
not `.sql`, and `eslint.config.mjs` rejects importing one. The data-access seam
that consumes the schema is CBD-246; this package deliberately exports no query
interface for it to grow inside.

No extension is created. `gen_random_uuid()` has been in core PostgreSQL since
13, and an extension the schema does not use is a privilege requirement bought
for nothing.

## Where the check runs

It runs inside `npm run check` twice over: as the named `check:migrations`
stage (`node scripts/check-migrations.mjs`, asserted by `REQUIRED_CHECK_STAGES`
in `scripts/check-ci-contract.mjs`), and again as the tests in this package
that `npm run test --workspaces --if-present` executes, so every fixture below
runs on every check and on every CI run. It can also be run alone:

```
node scripts/check-migrations.mjs
npm run migrate:check --workspace=@cobudget/migrations
```

Neither touches a database. The `db:*` commands and the live run recorded
under *The local development database* are the explicitly-run tier; the gate
stays hermetic (CBD-19-AC06).

## Fixtures

Each directory under `fixtures/negative/` is one rule's negative case and
asserts the exact set of rules it must fail — a fixture that fails for the wrong
reason proves nothing. `fixtures/positive/` must produce no findings at all.

| Fixture | Breaks |
| --- | --- |
| `cbd-116-fx-01-contract-step-missing-header` | AC04 — removal with no header |
| `cbd-116-fx-02-contract-step-unknown-expand` | AC04 — header names a migration that does not exist |
| `cbd-116-fx-03-contract-step-unversioned-reader` | AC04 — last reader recorded as prose, not a version |
| `cbd-116-fx-04-monetary-floating-point` | AC05 — `double precision` money |
| `cbd-116-fx-05-monetary-money-type` | AC05 — `money` type |
| `cbd-116-fx-06-monetary-no-currency-code` | AC05 — minor units with no currency code |
| `cbd-116-fx-07-timestamp-without-time-zone` | AC05 — `timestamp` |
| `cbd-116-fx-08-budget-space-without-column` | AC05 — budget-space table, no `budget_space_id` |
| `cbd-116-fx-09-missing-scope-annotation` | AC05 — unannotated table |
| `cbd-116-fx-10-duplicate-ordinal` | AC07 — two migrations, one second |
| `cbd-116-fx-11-unparsable-file-name` | AC07 — sequential counter name |
| `cbd-116-fx-12-down-migration-file` | AC03 — `.down.sql` |
| `cbd-116-fx-13-reversion-directive` | AC03 — `migrate:down` directive |
| `cbd-116-fx-14-transaction-control` | AC01 — `COMMIT` at the start of a line |
| `cbd-116-fx-15-non-sql-migration` | AC06 — migration written as code |
| `cbd-116-fx-23-abbreviated-drop-column` | AC04 — `DROP c` with `COLUMN` omitted |
| `cbd-116-fx-24-abbreviated-drop-if-exists` | AC04 — `DROP IF EXISTS c` with `COLUMN` omitted |
| `cbd-116-fx-25-abbreviated-rename-column` | AC04 — `RENAME a TO b` with `COLUMN` omitted |
| `cbd-116-fx-26-inline-transaction-control` | AC01 — `COMMIT` mid-line |
| `cbd-116-fx-28-inline-psql-meta-command` | AC01 — `\c` mid-line, reconnecting away from the open transaction |
| `cbd-116-fx-16`, `17`, `27` | positive: compliant expand and contract, and every non-destructive `ALTER TABLE` action that must not be swept in |
| `cbd-116-fx-18` … `cbd-116-fx-21` | AC02 — byte order mark, no trailing newline, invalid UTF-8, mixed line endings (built in the test, not committed) |
| `cbd-116-fx-22` | AC06 — a schema-owning ORM in the manifest (built in the test) |

## The local development database (CBD-117)

One PostgreSQL container, defined in [`compose.yaml`](../../compose.yaml) at
the repository root, started and driven by the `db:*` commands above. Local
only: no hosted resource is created, referenced, or paid for
(PROVIDERS-LOCAL-001).

### A fresh clone (AC01)

```
npm ci
npm run db:up --workspace=@cobudget/migrations
npm run db:migrate --workspace=@cobudget/migrations
npm run db:seed --workspace=@cobudget/migrations
```

That is the whole path from clone to a running, migrated database. Nothing is
installed by hand: `db:up` pulls the pinned image on first use, waits for the
healthcheck, and confirms the server's major; `db:migrate` runs the migration
check, then `psql` *inside* the container as the migration role, over the
container's Unix socket. The PostgreSQL client is not needed on the host and
no password crosses it.

`db:seed` is the stable seed hook required by `CBD117-SEED-001`. The schema
today contains no customer tables, so it verifies the running server and loads
zero rows. Later schema tickets populate the hook without changing the command.

`db:stop` stops the container and keeps every row. `db:up` starts it again.
`db:destroy` removes the container and the volume; the next `db:up` runs
`initdb` again, which is the only time the roles are created.

The container listens on `127.0.0.1:5432` and nowhere else. If that port is
taken, set `COBUDGET_DB_PORT=5433` in the untracked `.env.local`; the shared
configuration loader validates it before Compose inherits it.

`compose.yaml` fixes the compose project name to `cobudget`, so every checkout
and worktree of this repository shares one database, one volume, and one port,
rather than each directory name creating its own.

### Recovery (AC02)

```
npm run db:reset --workspace=@cobudget/migrations
```

Drops the `public` schema with everything in it, recreates it, and re-applies
every migration from the ledger up. There is no down path to reason about, so
there is no guesswork: a broken local state becomes a fresh one in one command.
`db:destroy` followed by `db:up` is the heavier version, for when the roles or
the server itself are what is broken.

One cosmetic difference between a reset database and a fresh one: `initdb`
leaves `public` owned by `pg_database_owner`, and reset leaves it owned by
`cobudget_migration`. Both give the migration role, and only the migration
role, `CREATE` on it; `db:verify` passes in both states.

### The pinned major (AC03)

The PostgreSQL major version is written in exactly one place: the
`image: postgres:<major>` line of `compose.yaml`. That is the line the server
starts from, so it cannot drift from what runs. `src/version.ts` reads that
same line, and every command that reaches a database asks the server for
`server_version_num` and refuses if the major differs, naming both. `db:up`
first probes an already-running container before Compose can recreate it; an
absent or stopped container proceeds through `compose up --wait`, then is
probed before migration is suggested:

```
refusing to continue: the server is PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2) (major 17)
but compose.yaml pins major 16. Either this is not the local database (run
npm run db:up --workspace=@cobudget/migrations) or the host moved and the pin
must move with it.
```

**Why 17.** CBD-108 selected Cloud SQL for PostgreSQL (C1) on 2026-09-02, and
Executive decision `CBD117-PG-MAJOR-001` records 17 as the intended managed
PostgreSQL major and closes `OQ-105-003` by decision. CBD-117-AC03 is assessed
against that record; this is no longer an implementation assumption. If later
Cloud SQL activation forces a different major, the decision's revisit condition
moves the pin in one line.
Moving it to 18 or later also moves the volume target in `compose.yaml`; the
comment on the pin says how.

The hosted runner reads the same line. A hosted instance upgraded to a major
the repository does not pin stops every migration until someone moves the pin
deliberately, which is the point.

### Credentials (AC04)

The local database connection is declared in the CBD-113 environment inventory:
`COBUDGET_DB_PORT`, `COBUDGET_DB_NAME`, `COBUDGET_DB_SUPERUSER`, and the four
role passwords. `src/local-config.ts` declares their typed schema and reads them
only through the shared loader in `@cobudget/contracts`; the environment guard
registers that consumer and rejects a direct environment read. Every `db:*`
script loads the optional untracked `.env.local` before the schema is validated.

The committed `.env.example` values are intentionally not secrets. The
bootstrap default is `postgres` / `local-only-superuser`; each application-role
password is `local-only-<role>`. Compose consumes the same names, passes the role
passwords to the quoted `psql` variables in the first-volume init hook, and
binds the server to loopback. Omission uses those same safe defaults. These
values are only for the disposable local container and must never be reused in
a hosted environment. API and worker runtime connection schemas remain owned
by the tickets that introduce their database clients; this deliverable supplies
the local Compose and migration-psql contract they will target.

### The three roles (AC05)

`DP-105-003` names them; `local/initdb/010-roles.sh` creates them the first
time the volume is initialised, as the bootstrap superuser, and makes the
migration role the owner of `cobudget_dev`:

| Role | Holds | Used by |
| --- | --- | --- |
| `cobudget_migration` | owns the database and everything it creates; `CREATE` on `public` | this tool |
| `cobudget_api` | `USAGE` on `public`; `SELECT, INSERT, UPDATE, DELETE` on every table a migration creates | the API (CBD-246) |
| `cobudget_worker` | the same as `cobudget_api` | the worker (CBD-246) |

The grants are **not** in the initdb script. They are in
`migrations/20260912T170000Z__grant_application_roles.sql`, which is applied by
the same command locally and hosted, so "the same grants as hosted" is true by
construction rather than by someone transcribing them twice. The initdb script
creates roles and ownership only, which is the part that cannot be a migration
(passwords, and a migration cannot run before the role that runs it exists).

That makes two things a contract with hosted provisioning (CBD-119): the roles
are called `cobudget_migration`, `cobudget_api`, and `cobudget_worker`, and the
migration role owns the database. `src/local.ts` and `src/local.test.ts` hold
the names and assert that the initdb script, the grants migration, and the
code agree.

`db:verify` proves the state rather than describing it. It confirms the major,
that each role holds exactly the schema privileges above, that the ledger
exists, and then issues `CREATE TABLE` and `ALTER TABLE` as `cobudget_api` and
as `cobudget_worker`, each of which would have changed the schema had it been
allowed, and passes only on a permission denial — a failure for any other
reason is reported as what it is. It also confirms the migration role's default
privileges for future tables exist, which is what gives the application access
to every table a later migration creates. The role-separation test tier that
runs against this database is CBD-246's; this is the database it runs against.

Nothing is granted on the ledger table. The application has no reason to read
or write its own migration history.

### The live run this was proved with

Recorded on 2026-09-12 against Docker Desktop 29.4.2 (Linux engine), image
`postgres:17` at PostgreSQL 17.11, on this branch, with the commands above:

- **First-run ledger read.** CBD-116 left open whether `readAppliedScript`
  survives a truly empty database, since `parseAppliedRows` throws on any
  stdout line without a pipe and the read sends `CREATE TEMP TABLE` and a `DO`
  block before its `SELECT`. It does: with `--quiet`, psql prints no command
  tag for either, stdout is zero bytes, exit 0, and the parser returns no rows.
  `db:status` on the empty database listed both migrations as pending.
- **AC01.** `db:up` created the network, volume, and container and reported
  healthy; `db:migrate` applied both migrations; a second `db:migrate` reported
  `nothing to apply: 2 migration(s) already applied`; the ledger held two rows
  with `applied_by = cobudget_migration`.
- **AC02.** A stray table with a row was created by hand; `db:reset` dropped
  and re-applied; `pg_tables` for `public` then listed the ledger only;
  `db:verify` passed; `pg_default_acl` held the two grant rows again.
- **AC03.** With the server running at 17 and the pin edited to 16, `status`,
  `apply`, and `reset` each exited 1 with the message quoted above and the
  ledger unchanged. The pin was restored.
- **AC05.** `db:verify` passed; issued directly, `CREATE TABLE` as either
  application role returned `permission denied for schema public` and
  `ALTER TABLE cobudget_schema_migrations` returned `must be owner of table`;
  `\ddp` showed `cobudget_api=arwd` and `cobudget_worker=arwd` on tables and
  `rU` on sequences, owner `cobudget_migration`.
- **Stop and start.** `db:stop`, then `status` reported
  `service "db" is not running` with the hint to run `db:up`; `db:up` again;
  `status` listed both migrations as applied.
- **Seed.** `db:seed` verified PostgreSQL 17 and reported `0 rows loaded`, as
  required while no customer schema exists (`CBD117-SEED-001`).

### Fixtures

| Fixture | Breaks |
| --- | --- |
| `cbd-117-fx-01` | AC03 — a server one major below the pin stops `apply`, `status`, and `reset` before the ledger is read, naming both versions (built in `commands.test.ts`) |
| `cbd-117-fx-02` | AC03 — a compose file pinning no major, two majors, or an implausible one is refused |
| `cbd-117-fx-03` | AC03 — `db up` probes an already-running mismatched server before Compose and names both versions |
| `cbd-117-fx-04` | AC05 — a missing role fails `db verify` |
| `cbd-117-fx-05` | AC05 — an application role holding `CREATE` on `public` fails `db verify` |
| `cbd-117-fx-06` | AC05 — an application role allowed DDL fails `db verify` |
| `cbd-117-fx-07` | AC05 — a DDL failure for any reason but permission is not a pass |
| `cbd-117-fx-08` | AC05 — a database without the ledger, or without default privileges, fails `db verify` |

### Limitations

- The one-transaction limitation recorded under *How a migration is applied*
  stands: `CREATE INDEX CONCURRENTLY` cannot be used as written.
- Two runners at once remain safe but not live, as recorded above.
