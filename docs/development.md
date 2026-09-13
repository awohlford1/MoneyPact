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
It checks eleven operator settings plus the three platform/test settings
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
