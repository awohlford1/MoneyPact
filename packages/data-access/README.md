# @cobudget/data-access

The one typed SQL access path for the API and worker (CBD-246). It does not
own the schema -- `@cobudget/migrations` does that -- and it is not an ORM:
it is a thin, typed seam over `pg` that enforces four things every caller
would otherwise have to reimplement:

1. **Tenant scoping.** Every budget-space-scoped table is read or written
   through `tenantSelect`/`tenantInsert`/`tenantUpdate`/`tenantDelete`, which
   take a required `budgetSpaceId` and build the SQL themselves --
   `budget_space_id = $1` is always the predicate; there is no field through
   which a caller supplies raw SQL text and could omit it. `table` is
   checked against `catalog.ts`'s closed table catalog before anything is
   built, so a caller cannot reach a table the catalog does not classify
   `budget-space`. The `platformSelect`/`platformInsert`/`platformUpdate`/
   `platformDelete` escape hatch is equally closed: it refuses any table not
   classified `identity` or `platform`, including every budget-space table.
2. **Role separation.** `createApiClient`/`createWorkerClient` return a
   `DataAccessClient` -- the closed set of operations above -- bound to only
   that role's `pg.Pool`. Neither client, nor anything reachable from it,
   ever holds the migration role's pool or credential; that role exists only
   inside this package's own tests and `scripts/verify-live.ts`
   (`createLocalConnections`), which is what actually needs it to set up and
   tear down scratch data.
3. **Redacted failures.** Every statement builder executes through one
   internal seam that catches a driver rejection and replaces it with
   `logging.ts`'s `StatementFailedError` before it can reach a caller; the
   raw error, which can echo statement text or a bound value, is discarded,
   not merely left unattached.
4. **S4 field encryption.** `encryptField`/`decryptField` take a
   `KeyProvider` and an `EncryptionContext` (tenant, table, row, column),
   bind that context as authenticated data on the AES-256-GCM ciphertext,
   and record the key version on every ciphertext; there is one documented
   local provider (refused outside `NODE_ENV=development`/`test`) and one
   documented KMS provider shape.

## Layout

| File | Owns |
| --- | --- |
| `src/driver.ts` | The only import of `pg` in the repository (CBD-246-AC01), including a dynamic `import("pg")`. |
| `src/connection.ts` | Role-separated `PoolConfig`/`Pool` construction: `createApiConnection`/`createWorkerConnection` (single role each) and `createLocalConnections` (all three, test/verification only). |
| `src/catalog.ts` | The closed table catalog every statement builder checks a table against before building SQL (CBD-246-AC02). |
| `src/tenant.ts` | The tenant-scoped and platform statement builders (CBD-246-AC02), each executing through the redacted-failure seam. |
| `src/client.ts` | `DataAccessClient` and `createApiClient`/`createWorkerClient`: the only thing either application imports from this package for querying. No member of a `DataAccessClient` reaches the underlying `Pool`. |
| `src/logging.ts` | Error wrapping and log-line shaping that never carries statement text or bound values (CBD-246-AC06). |
| `src/encryption/` | The key-provider interface, local and KMS providers, the AES-256-GCM cipher with AAD context binding, and provider selection (CBD-246-AC04). |
| `src/no-per-customer-isolation.test.ts` | The `npm run check` assertion that no per-customer credential or row-level-security policy exists (CBD-246-AC05). |
| `src/lint.test.ts` | Proves the AC01 lint rule fires -- static and dynamic imports -- without writing an offending file to disk. |
| `scripts/verify-live.ts` | Manual evidence harness against the real CBD-117 local database; not part of `npm run check`. |

## Using it

```ts
import { createApiClient } from "@cobudget/data-access";

const dataAccess = createApiClient();
await dataAccess.tenantSelect({
  table: "budget_line_items",
  budgetSpaceId: currentBudgetSpaceId,
  conditions: [{ column: "id", value: lineItemId }],
});
```

## Environment wiring

`createApiClient`/`createWorkerClient` read database configuration through
`@cobudget/migrations`'s `loadLocalDatabaseConfig`, which already validates
`COBUDGET_DB_PORT`, `COBUDGET_DB_NAME`, and each role's password through
`@cobudget/contracts`'s loader. No new environment variable or new
`scripts/check-environment.mjs` registration was needed for the database
connection.

Field encryption needs its own variables
(`COBUDGET_FIELD_ENCRYPTION_PROVIDER`, `COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY`,
`COBUDGET_FIELD_ENCRYPTION_KEY_VERSION`; see `fieldEncryptionConfigSchema` in
`src/encryption/config.ts`). `apps/api/src/config.ts` and
`apps/worker/src/config.ts` spread `fieldEncryptionConfigSchema` into
`apiConfigSchema`/`workerConfigSchema`, so `loadApiConfig`/`loadWorkerConfig`
-- already called before either application's listener opens -- fail startup
naming the missing variable exactly like every other required configuration
value. `apps/*/src/data-access/index.ts` additionally calls
`resolveFieldEncryptionProvider(config)` when constructing the application's
data-access client, which is what enforces the local-provider
`NODE_ENV=development`/`test` restriction (`scripts/check-environment.mjs`'s
`schemaConsumers` list needed no change: it already registers
`apiConfigSchema`/`workerConfigSchema` by reference, so the spread-in
variables were picked up automatically; `config/environment-inventory.json`
and `.env.example` gained the three new variables so `npm run check:env`
still passes).

## Local field-encryption key

Consistent with `PROVIDERS-LOCAL-001` and `CBD236-SIGNING-KEY-001`: the local
provider takes a generated, local-only 256-bit key and a version string. It
is never a real secret, never shared, and never trusted outside a local
environment; `resolveFieldEncryptionProvider` now enforces that last part
rather than only documenting it (CBD246-SECURITY-001 finding 6): selecting
`local` outside `NODE_ENV=development`/`test` throws
`LocalProviderNotAllowedError`. Custody of a real key for a hosted
environment (the `kms` provider) is a hosting-time decision out of this
subtask's scope.
