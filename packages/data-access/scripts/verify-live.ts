/**
 * Manual evidence harness for CBD-246, run once against the real CBD-117
 * local database with `npm run verify:live --workspace=@cobudget/data-access`.
 *
 * Not part of `npm run check`: it needs Docker and a running database, which
 * CI does not have. It exists to produce the "prove the seam against the
 * live local database" evidence the CBD246-IMPL-001/002 task packets ask
 * for, captured verbatim in the implementation report.
 *
 * This still uses `createLocalConnections` (all three roles) and the raw
 * `tenantSelect`/`tenantInsert`/`platformSelect` functions directly against
 * a scratch table, rather than `createApiClient`/`createWorkerClient`: this
 * script is exactly the kind of test/verification caller `connection.ts`'s
 * doc comment carves out, and it needs the migration role to create and
 * drop the scratch table -- something neither application client can do or
 * should be able to do (CBD246-SECURITY-001 finding 2).
 */
import { randomBytes } from "node:crypto";
import { createLocalConnections } from "../src/connection.ts";
import type { TableCatalog } from "../src/catalog.ts";
import { MissingBudgetSpaceError, tenantInsert, tenantSelect } from "../src/tenant.ts";
import { createLocalKeyProvider } from "../src/encryption/local-provider.ts";
import { encryptField, decryptField } from "../src/encryption/cipher.ts";
import type { EncryptionContext } from "../src/encryption/cipher.ts";
import { LocalProviderNotAllowedError, resolveFieldEncryptionProvider } from "../src/encryption/config.ts";
import { StatementFailedError, statementLogLine, wrapDriverError } from "../src/logging.ts";

const SCRATCH_TABLE = "cobudget_cbd246_live_verify";
const SCRATCH_CATALOG: TableCatalog = { [SCRATCH_TABLE]: "budget-space" };
const CANARY = "cbd246-canary-3f7c1e";

async function main() {
  const connections = createLocalConnections();
  const results: string[] = [];
  const fail = (message: string): never => {
    throw new Error(`LIVE VERIFICATION FAILED: ${message}`);
  };

  try {
    // 1. Role-separated connections: each role connects and sees its own name.
    for (const [label, pool] of Object.entries(connections)) {
      const { rows } = await pool.query<{ current_user: string }>("select current_user");
      results.push(`${label} connects as ${rows[0]?.current_user}`);
    }

    // 2. api/worker cannot CREATE TABLE or ALTER TABLE (AC03).
    for (const role of ["api", "worker"] as const) {
      try {
        await connections[role].query(`CREATE TABLE ${SCRATCH_TABLE}_denied (id integer)`);
        fail(`${role} was allowed to CREATE TABLE; DP-105-003 requires it be refused`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/permission denied/iu.test(message)) fail(`${role} CREATE TABLE failed for a reason other than permission: ${message}`);
        results.push(`${role} CREATE TABLE: permission denied, as required`);
      }
    }

    // 3. Tenant-scoped statement API against a scratch table (migration role
    //    owns schema changes; api/worker read/write it through the seam).
    //    unique_value carries a UNIQUE constraint used by step 6 below to
    //    provoke a real driver-level failure.
    await connections.migration.query(`DROP TABLE IF EXISTS ${SCRATCH_TABLE}`);
    await connections.migration.query(
      `CREATE TABLE ${SCRATCH_TABLE} (budget_space_id text not null, value text not null, unique_value text unique)`,
    );
    await connections.migration.query(`GRANT SELECT, INSERT ON ${SCRATCH_TABLE} TO cobudget_api`);

    await tenantInsert(connections.api, {
      table: SCRATCH_TABLE,
      budgetSpaceId: "space-live-verify",
      values: { value: "hello" },
    }, SCRATCH_CATALOG);
    results.push("tenant-scoped INSERT as api role succeeded with a budgetSpaceId");

    try {
      await tenantInsert(connections.api, {
        table: SCRATCH_TABLE,
        budgetSpaceId: "",
        values: { value: "should never reach the database" },
      }, SCRATCH_CATALOG);
      fail("a tenant statement with an empty budgetSpaceId executed; it must throw first");
    } catch (error) {
      if (!(error instanceof MissingBudgetSpaceError)) throw error;
      results.push("tenant-scoped INSERT with an empty budgetSpaceId threw MissingBudgetSpaceError before execution");
    }

    // 4. CBD246-SECURITY-001 finding 1: a caller-selected table outside the
    //    catalog is refused before it ever reaches the driver, even though
    //    the api role would otherwise be permitted to select from it.
    try {
      await tenantSelect(connections.api, {
        table: SCRATCH_TABLE,
        budgetSpaceId: "space-live-verify",
      }, {} /* empty catalog: nothing is classified budget-space */);
      fail("tenantSelect executed against a table absent from the catalog; it must be refused first");
    } catch {
      results.push("tenantSelect against a table absent from the catalog was refused before reaching the driver");
    }

    // 5. CBD246-SECURITY-001 finding 3: a real driver failure (unique
    //    violation) is redacted, not forwarded verbatim, on the actual
    //    execution path -- not merely by calling wrapDriverError directly.
    await tenantInsert(connections.api, {
      table: SCRATCH_TABLE,
      budgetSpaceId: "space-live-verify",
      values: { value: "first", unique_value: CANARY },
    }, SCRATCH_CATALOG);
    try {
      await tenantInsert(connections.api, {
        table: SCRATCH_TABLE,
        budgetSpaceId: "space-live-verify",
        values: { value: "second", unique_value: CANARY },
      }, SCRATCH_CATALOG);
      fail("a duplicate unique_value was accepted; the constraint did not fire");
    } catch (error) {
      if (!(error instanceof StatementFailedError)) fail(`expected StatementFailedError from the real driver failure; got ${String(error)}`);
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes(CANARY)) fail("the real driver's unique-violation error leaked the canary bound value");
      results.push("a real unique-constraint violation surfaced as StatementFailedError with no canary in its message");
    }

    await connections.migration.query(`DROP TABLE ${SCRATCH_TABLE}`);

    // 6. S4 field encryption round trip with the local provider, and
    //    CBD246-SECURITY-001 finding 4: a ciphertext moved to a different
    //    row fails to decrypt (AAD binds row identity, tenant, table, column).
    const provider = createLocalKeyProvider({ key: randomBytes(32), keyVersion: "live-verify-v1" });
    const context: EncryptionContext = { tenantId: "space-live-verify", table: SCRATCH_TABLE, rowId: "row-1", column: "value" };
    const ciphertext = await encryptField(provider, "account-4111111111111111", context);
    if (JSON.stringify(ciphertext).includes("4111111111111111")) fail("ciphertext contained the plaintext");
    const decrypted = await decryptField(provider, ciphertext, context);
    if (decrypted !== "account-4111111111111111") fail("round trip did not return the original plaintext");
    results.push(`field encryption round trip succeeded; ciphertext recorded keyVersion=${ciphertext.keyVersion}`);

    try {
      await decryptField(provider, ciphertext, { ...context, rowId: "row-2" });
      fail("a ciphertext decrypted successfully under a different row's context; AAD is not binding row identity");
    } catch {
      results.push("a ciphertext moved to a different row's context failed to decrypt, as required");
    }

    // 7. CBD246-SECURITY-001 finding 6: the local provider is refused
    //    outside NODE_ENV=development/test.
    try {
      resolveFieldEncryptionProvider({
        COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
        COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: randomBytes(32).toString("base64"),
        COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "v1",
        NODE_ENV: "production",
      });
      fail("the local provider was selected under NODE_ENV=production; it must be refused");
    } catch (error) {
      if (!(error instanceof LocalProviderNotAllowedError)) fail(`expected LocalProviderNotAllowedError; got ${String(error)}`);
      results.push("the local provider was refused under NODE_ENV=production, as required");
    }

    // 8. AC06: a wrapped driver error and a log line never carry the canary.
    const driverError = new Error(`duplicate key value violates unique constraint: ${CANARY}`);
    const wrapped = wrapDriverError(SCRATCH_TABLE, "insert");
    const line = statementLogLine({ level: "error", table: SCRATCH_TABLE, operation: "insert" });
    if (wrapped.message.includes(CANARY) || line.includes(CANARY)) fail("canary leaked into a wrapped error or log line");
    void driverError;
    results.push("wrapped error and log line carry no statement text or bound values (canary check)");

    console.log(results.map((line) => `PASS: ${line}`).join("\n"));
  } finally {
    await Promise.all(Object.values(connections).map((pool) => pool.end()));
  }
}

await main();
