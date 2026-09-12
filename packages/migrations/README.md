# @cobudget/migrations

Forward-only PostgreSQL migrations for MoneyPact. CBD-116.

PostgreSQL is the decision recorded in CBD-105 (`DP-105-001`). Forward-only is
the decision recorded in CBD-103 (`TD-103-028`). Neither is re-opened here.

## Commands

The connection is never read by this tool. `psql` resolves it from the standard
libpq environment — `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`,
`PGSERVICE`, `PGSSLMODE`, `~/.pgpass` — so no password passes through our
process, reaches a log line, appears in `ps` output, or has to be registered as
a variable this repository reads.

| What | Command |
| --- | --- |
| Apply every migration, from empty or from anywhere | `npm run migrate --workspace=@cobudget/migrations` |
| Show what is applied and what is pending | `npm run migrate:status --workspace=@cobudget/migrations` |
| Stamp a new migration | `npm run migrate:create --workspace=@cobudget/migrations -- "add budget space"` |
| Check the migrations without a database | `npm run migrate:check --workspace=@cobudget/migrations` |
| Local recovery: drop everything and re-apply | `npm run migrate:reset --workspace=@cobudget/migrations -- --confirm-destroys-all-data` |

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
on CBD-117 and later, recorded here rather than discovered later. Changing it
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

It runs inside `npm run check` today: the rules are tests in this package, and
`npm run check` runs `npm run test --workspaces --if-present`, so every fixture
below executes on every check and on every CI run. It can also be run alone:

```
node scripts/check-migrations.mjs
npm run migrate:check --workspace=@cobudget/migrations
```

Promoting it to a named `check:migrations` stage would mean editing the `check`
script in the root `package.json` and `REQUIRED_CHECK_STAGES` in
`scripts/check-ci-contract.mjs`, which asserts the two agree. Both are
single-writer shared surfaces and CBD-116 was not scoped to touch them; the
one-line change is left to whoever owns that lane.

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

## What a live database still has to confirm

Everything that decides *what* runs is pure and tested. What no test here can
confirm is that the generated SQL is valid PostgreSQL, because that needs a
server. On a machine with one:

```
createdb cobudget_dev
PGDATABASE=cobudget_dev npm run migrate --workspace=@cobudget/migrations
PGDATABASE=cobudget_dev npm run migrate --workspace=@cobudget/migrations   # no-op
PGDATABASE=cobudget_dev psql -c 'TABLE cobudget_schema_migrations'
```
