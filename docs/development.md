# CoBudget development

## Requirements

- Node.js 24
- npm 11
- Python 3.10 or later on PATH (`python3`, `python`, or Windows `py -3`) for
  the environment contract and repository-tool tests.

On Windows PowerShell systems that block script shims, use `npm.cmd` anywhere
this guide shows `npm` (for example, `npm.cmd run dev`).

## Install

From the repository root:

```sh
npm install
```

## Run the web application

```sh
npm run dev
```

Then open `http://localhost:3000`.

## Run the local database

Docker Desktop (or another Docker engine with Compose) is the only database
prerequisite. PostgreSQL and `psql` run inside the pinned container; do not
install either on the host.

From the repository root, start and migrate the database, then run the current
seed hook:

```sh
npm run db:up --workspace=@cobudget/migrations
npm run db:migrate --workspace=@cobudget/migrations
npm run db:seed --workspace=@cobudget/migrations
```

`db:seed` currently loads zero rows because no customer schema exists. Check
migration state and verify the pinned major and role separation with:

```sh
npm run db:status --workspace=@cobudget/migrations
npm run db:verify --workspace=@cobudget/migrations
```

To recover a broken schema, reset it and reapply every forward migration:

```sh
npm run db:reset --workspace=@cobudget/migrations
```

Stop while keeping data, or remove the disposable container and volume:

```sh
npm run db:stop --workspace=@cobudget/migrations
npm run db:destroy --workspace=@cobudget/migrations
```

The defaults in `.env.example` are obvious local-only values and the port is
bound to `127.0.0.1`. Copy the template to the untracked `.env.local` only when
you need an override, such as `COBUDGET_DB_PORT=5433`. The local commands load
and validate these values through the shared environment contract. See
[`packages/migrations/README.md`](../packages/migrations/README.md) for the
pin decision, role grants, failure behavior, and full operational detail.

## Run the API application

Copy the safe local configuration template once, then adjust it if needed:

```sh
cp .env.example .env.local
```

On Windows PowerShell, use `Copy-Item .env.example .env.local` instead.

Start the API from the repository root:

```sh
npm run dev:api
```

The API binds on port 3001 by default and by default binds to `127.0.0.1` in
development/test, and `0.0.0.0` in production. Override the bind address with
`API_LISTEN_ADDRESS` in `.env.local` if you need a different interface. Its
process-only readiness response is at `/health`, and its OpenAPI document is at
`/openapi.json`. Neither endpoint requires a database or another service.

The API rejects bodies over 1 MiB, bounds headers and request time, does not
trust caller-supplied request IDs or forwarding headers, sends hardened response
headers, and makes responses non-cacheable by default. Cross-origin access is
disabled unless a later feature adds a reviewed allowlist. Production responses
also send HSTS; local HTTP responses deliberately do not. TLS termination and
the required per-surface rate limits are deployment-edge controls, not replaced
by these application defaults.

## Run the worker application

The worker uses the same `.env.local` shared configuration as the API. Start it
as a separate process from the repository root:

```sh
npm run dev:worker
```

For a production-equivalent start, build the workspace and run the compiled
artifact (the start command does not depend on the TypeScript development
loader):

```sh
npm run build --workspace=@cobudget/worker
npm run start:worker
```

It writes structured startup and readiness records, then remains idle until
`SIGINT` or `SIGTERM`. Either signal produces one structured shutdown record and
a clean exit. Shutdown work is idempotent and has a ten-second safety deadline,
so a future resource drain cannot leave a deployment stuck indefinitely. The
worker has no queue, database, scheduler, provider client, or jobs yet; those
dependencies belong to their own implementation stories.

## Run the prototype end to end

The prototype milestone (`PROTOTYPE-SLICE-001`) is: sign in on the local
identity adapter, create one monthly budget through preview and confirm, set
category targets, reload, and see the same plan. It runs on the API, the web
application, and the local database together. Provider accounts are not
involved: identity is the local Cognito-shaped adapter and every key is a
local synthetic value.

### The self-driving proof

The quickest way to see the whole journey is the browser walkthrough. It starts
the API and the web application with a generated environment, drives headless
Chrome through the journey, and prints a twenty-one-step transcript. Among
those steps: a 12.50 expense split 8.00 Groceries and 4.50 Rent, whose share in
the category detail offers no in-place edit and states why, and a
single-category expense that is edited in place and removed while the split
share stays at 8.00. It needs Docker Desktop running and Chrome installed.

```sh
node scripts/prototype-browser-walkthrough.mjs --db cobudget_demo
```

The HTTP-only counterpart exercises the same journey through the real API
process without a browser and prints a longer transcript that includes the
denial cases:

```sh
node scripts/prototype-e2e.mjs --db cobudget_demo
```

Both scripts expect the named scratch database to exist and to be migrated
already; create and migrate it as **Database** below describes. Never point
them at `cobudget_dev`.

### Running it yourself

1. **Environment.** Copy `.env.example` to `.env.local` and fill the three
   blank secrets (`COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY`,
   `COBUDGET_SESSION_PEPPER`, `COBUDGET_SESSION_ENVELOPE_KEY`) with 32 random
   bytes each, base64 encoded. On PowerShell:

   ```powershell
   [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
   ```

   Set `COBUDGET_DB_NAME` to a scratch name such as `cobudget_demo`. Every
   other value in the template is already the local prototype value. Keep one
   variable per line; the API's env-file loader does not split values that
   share a line.

2. **Database.** With the container up (`npm run db:up`), create and migrate
   the scratch database once:

   ```sh
   docker exec cobudget-db-1 psql -U postgres -c "CREATE DATABASE cobudget_demo;" -c "ALTER DATABASE cobudget_demo OWNER TO cobudget_migration;"
   npm run db:migrate --workspace=@cobudget/migrations
   npm run db:verify --workspace=@cobudget/migrations
   ```

3. **API.** `npm run dev:api`. It listens on `http://127.0.0.1:3001`;
   `GET /health` answers 200 and `GET /v1/identity/me` answers 403 until you
   sign in.

4. **Web in live mode.** The development server serves an in-process mock of
   the API unless the marker file `apps/web/.api-mode` contains the single word
   `live`. Create it, then start the web application:

   ```sh
   echo live > apps/web/.api-mode
   npm run dev
   ```

   The marker is ignored by git. Delete it to return to the mock.

5. **Journey.** Open `http://localhost:3000`, choose **Sign in**, pick a
   subject on the local chooser page, and you land on **Budgets**. Create a
   budget with a monthly schedule, review the preview of the current period
   and the next three, confirm, open the plan, set base targets for two
   categories, reload the page, and sign out.

### The demo database

`cobudget_demo` is the one persistent scratch database on the local
container: the walkthrough, the end-to-end script and a hand-driven journey
all run against it, so it keeps a signed-in subject, a budget and its expenses
between sessions. `cobudget_dev` stays what `db:up` creates for the migration
tooling itself and is never the demo target.

- **Create it once**, with the container up, as step 2 above shows: the
  database is owned by `cobudget_migration`, the role the migrations run as.
  PostgreSQL 17 grants no `CREATE` on `public` to ordinary roles, and
  `db:verify` proves that `cobudget_api` and `cobudget_worker` cannot create
  or alter tables in it.
- **Migrate and verify it** with `COBUDGET_DB_NAME=cobudget_demo` in
  `.env.local` (step 1) or on the command line for a single run. Every
  `db:*` command reads the name from that variable, so the same three lines
  bring it forward after a pull that adds a migration:

  ```sh
  COBUDGET_DB_NAME=cobudget_demo npm run db:migrate --workspace=@cobudget/migrations
  COBUDGET_DB_NAME=cobudget_demo npm run db:verify --workspace=@cobudget/migrations
  COBUDGET_DB_NAME=cobudget_demo npm run db:status --workspace=@cobudget/migrations
  ```

- **Seed it** with `COBUDGET_DB_NAME=cobudget_demo npm run db:seed
  --workspace=@cobudget/migrations`. The hook verifies the running server and
  loads zero rows (`CBD117-SEED-001`); the demo's data is whatever the journey
  and the scripts create through the API.
- **Reset it by dropping and recreating it.** `db:reset` refuses any database
  whose name does not match `^cobudget_(dev|local|test)(_[a-z0-9_]+)?$`
  (`config/migrations.json`, `reset.localDatabaseNamePattern`), and
  `cobudget_demo` deliberately does not, so a reset of the demo is explicit:

  ```sh
  docker exec cobudget-db-1 psql -U postgres -c "DROP DATABASE cobudget_demo;"
  docker exec cobudget-db-1 psql -U postgres -c "CREATE DATABASE cobudget_demo OWNER cobudget_migration;"
  COBUDGET_DB_NAME=cobudget_demo npm run db:migrate --workspace=@cobudget/migrations
  COBUDGET_DB_NAME=cobudget_demo npm run db:verify --workspace=@cobudget/migrations
  ```

  Stop the API first (`DROP DATABASE` fails while a session holds a
  connection), then sign in and create the budget again; nothing outside the
  container is affected under `PROVIDERS-LOCAL-001`. Do this after a migration
  that changes the meaning of existing rows, such as the consent record
  described below.
- **Agents never point a scratch run at it.** A test, a probe or a gate that
  needs a database creates its own (`CREATE DATABASE cobudget_<name> OWNER
  cobudget_migration`, then `COBUDGET_DB_NAME=cobudget_<name> npm run
  db:migrate --workspace=@cobudget/migrations`), uses it and drops it. The
  live suites already refuse `cobudget_dev` by name; `cobudget_demo` is
  protected by this rule, because a suite that ran against it would leave its
  fixtures in the demo or drop the journey's data.

### What is and is not real

- Sign-in is the CBD-190 ceremony against the local adapter: state, nonce and
  PKCE checks, a bounded token exchange with issuer-side revocation, and an
  atomic subject and profile mapping. No real provider is configured.
- Sessions are opaque cookies per CBD-191; the CSRF value is delivered once in
  the sign-in bootstrap response and sent back as `X-CoBudget-CSRF` on every
  mutation.
- Authorization is policy version p5, deny by default, evaluated on every
  protected route. Consent is now a record, not a derivation
  (`CBD236-CONSENT-SEMANTICS-001`): the creation review presents the approved
  Primary Owner self-disclosure and requires an explicit acknowledgement, the
  confirmation writes one `budget_space_consent` row inside the same
  transaction, and the fact assembler reads `consent.{consentId,
  disclosureVersion, state}` from that row and derives nothing. A budget space
  whose membership has no current consent row denies every ordinary cell.
- **A database created before that migration needs a reset.** The migration
  writes no rows and never synthesizes consent evidence, so a budget space
  created earlier keeps its membership and has no consent row, and every
  ordinary cell in it denies from that commit on. Recreate the database and
  the space as **The demo database** above describes (drop, create, migrate,
  verify; `db:reset` refuses the demo by name), then sign in and create the
  budget again through the confirmation, which now records consent. No hosted
  database exists under `PROVIDERS-LOCAL-001`, so nothing else is affected.
- The approved disclosure texts live in `config/consent-disclosure-registry.json`,
  append-only and digest-pinned, with their content under
  `docs/consent-disclosures/`. `scripts/check-consent-disclosure-registry.mjs`
  fails the build on an edited or removed entry, and the API refuses to start
  on a registry whose digests do not reproduce.
- Rate limits are the approved local prototype record sets. The sign-in
  ceremony counts on its own ceremony record; the bootstrap record keeps the
  two reserved units per ceremony (first sign-in, initial budget creation).
  A confirm attempt refused before its effect (missing CSRF value, replay,
  unknown proposal) consumes nothing reserved. A confirm admitted past those
  gates but denied inside its effect (expired or superseded proposal, altered
  binding, an acknowledged disclosure that is no longer current:
  `409 proposal_not_current`, `confirmation_stale`, `stale_disclosure`) is
  refunded its reserved unit exactly once, so the corrected confirm on the same
  session is admitted; only the committed confirm keeps the unit, and a second creation
  on the same ceremony is denied. Counters are process-local: a restart or a
  second API process starts from empty.
- Manual accounts and manual expenses are present. A Primary Owner can add,
  rename, archive and restore a manual account, record an expense against it
  split across one or more categories, edit it and remove it, and see spent and
  remaining per category for the active period with an itemized drill-down
  behind each figure. Amounts are signed end to end -- an expense is negative --
  and the browser shows spent as a magnitude and labels a negative remaining as
  over rather than clamping it to zero. An edit writes a new version and retains
  the old one; a removal writes a tombstone; nothing is ever deleted.
  Account-state admissibility is the route handler's, not the policy's
  (`SEC-P3-F1`): restore refuses a live account, archive refuses an archived
  one, and neither an edit nor an expense is accepted against an archived
  account.
- An expense edit or removal may state the version it was read from
  (`expectedTransactionVersionId` in the body, or `If-Match` carrying the
  version id) and is refused `409 stale_version`, naming the current version,
  when that basis has moved (CBD-200-AC04); without a basis it behaves as
  before. The web client sends the version it was last shown. A writer the
  API's surface gate cannot see -- a second process -- that wins the same
  version answers the loser `409 conflict`; note that the CBD-266 mutation
  surface admits one in-flight mutation per actor, so two simultaneous edits
  from one session are decided at the gate, not in the database.
  `Idempotency-Key` on an expense create, edit or removal is an operation
  identity scoped to the budget, the acting membership and the action
  (CBD-200-AC05): the same key with the same request answers the stored
  response and writes nothing; the same key with a different request is
  refused `409 idempotency_mismatch`. The rows live in
  `manual_transaction_idempotency` and are append-only. An `Idempotency-Key`
  value is an opaque client-chosen identifier, not a credential -- the API
  never logs it, but PostgreSQL's own server log records it verbatim in the
  `DETAIL` line of a unique-violation error (`Key
  (budget_space_id, membership_id, action, idempotency_key)=(...)`), so treat
  server logs, not just application logs, as in scope when handling one.
- Still missing from that half: bank connections and imports (CBD-9), so every
  account and every transaction is manual and settled -- no pending or
  provisional state is representable at all; non-owner roles on the account
  cells (`OQ-236-011`), so only the Primary Owner of a space can use them; and
  transfers between accounts, income beyond a positive manual amount, and
  attachments.

## Validate changes

```sh
npm run check
```

This checks documentation and tokens, then runs linting, type checking, tests,
and production builds across all workspaces.

It also runs `npm run check:secrets`: synthetic scanner regression tests and a
scan of HEAD, staged files, and tracked working files. Stage new files before
running the guard; ignored/untracked local credentials are not read. The first
run downloads a checksum-verified Gitleaks release from GitHub. See
[secret scanning](secret-scanning.md) for history coverage, exceptions, and
incident handling.

## Environment contract

`config/environment-inventory.json` is the inventory for every first-party
environment consumer. `npm run check:env` runs in the root gate and compares
application schemas, Python tool groups, source reads, and `.env.example`.
It checks nineteen application and tooling settings plus the three platform/test settings
`CI`, `SCARF_ANALYTICS`, and `TZ`. It never reads `.env.local` or real
credentials; fixtures provide synthetic dictionaries and mocked HTTP clients.

To add a variable:

1. Add its name, classification (`application`, `tooling`, `platform`, or
   `test`), consumer paths, owner, required flag, sensitivity, source,
   validation rule, description, and template disposition to the inventory.
2. For application configuration, add the typed schema declaration and use
   the shared loader. The guard compares its validation and required flag
   with the inventory. `API_LISTEN_ADDRESS` accepts IPv4/IPv6 literals only;
   omission retains the documented environment-specific defaults.
3. For Python tooling, add the variable to its inventory group and consume it
   through `load_tool_config`. Environment values take precedence over
   `.env.local`, including explicit empty values. Required empty values fail;
   optional values use only the declared default. URLs must be HTTPS origins;
   validation happens before authenticated sessions, requests, or preview writes.
4. For every operator setting, add a safe placeholder and preceding comment
   to `.env.example`. Secret placeholders must be empty. Platform and test
   settings carry their rationale in the inventory and stay out of the template.
5. Add positive and isolated negative tests, then run `npm run check`.

The AST guards enforce a restricted source convention: environment access must
use the shared loaders. Wrapped/aliased `process` references, dynamic process
imports, reflective `os` access, and dynamic environment imports are rejected.
Node diagnostic-report access and Python `nt`/`posix` environment reads are also
rejected, including aliases; they must not bypass the configuration boundary.
Python's existing optional-dependency import in the publisher's `require`
helper (restricted to Markdown and HTTP dependencies), the inventory checker's
compiler loader, and the two package barrel tests' file-URL imports are reviewed
exceptions. Arbitrary runtime code generation, malicious
reflection, and dependency behavior are outside this static-analysis guarantee
and require code review; this is not a security sandbox.
Tooling rules and their defaults are validated at build time and runtime.
HTTPS origins require valid DNS labels and no query/fragment delimiter, even
an empty one; accepted origins are canonicalized before API paths are appended.
Two domain test files may pass the ambient environment
unchanged to subprocesses with a test-only `TZ` override. Generated output,
dependencies, declarations, caches, and agent metadata are excluded. New
source files are discovered recursively; undocumented reads fail the build.
These structural guards are not a secret scanner; committed-value detection
belongs to CBD-114. The Confluence and Jira settings are tooling-only and
are not required to start the API or worker or to run the normal build.

## Workspace conventions

- Deployable applications belong in `apps/`.
- Shared libraries belong in `packages/` only after at least two applications
  need them.
- Pages are Server Components unless browser APIs or interactive state require a
  Client Component.
- Secrets belong in untracked `.env.local` files. When a variable is introduced,
  add a safe placeholder and description to `.env.example`.
- Financial information, authentication data, and provider tokens must never be
  included in logs, fixtures, screenshots, or analytics events.
