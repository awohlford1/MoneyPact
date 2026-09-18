/**
 * Manual evidence harness for CBD-246 and CBD-237, run once against the real
 * CBD-117 local database with `npm run verify:live --workspace=@cobudget/data-access`.
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
import {
  InvalidPageBoundError,
  MissingBudgetSpaceError,
  ReservedColumnError,
  UnknownPlatformTableError,
  UnknownTenantTableError,
  platformSelect,
  tenantCount,
  tenantDelete,
  tenantInsert,
  tenantSelect,
  tenantUpdate,
} from "../src/tenant.ts";
import { createLocalKeyProvider } from "../src/encryption/local-provider.ts";
import { encryptField, decryptField } from "../src/encryption/cipher.ts";
import type { EncryptionContext } from "../src/encryption/cipher.ts";
import { LocalProviderNotAllowedError, resolveFieldEncryptionProvider } from "../src/encryption/config.ts";
import { StatementFailedError, statementLogLine, wrapDriverError } from "../src/logging.ts";

const SCRATCH_TABLE = "cobudget_cbd246_live_verify";
const SCRATCH_CATALOG: TableCatalog = { [SCRATCH_TABLE]: "budget-space" };
const CANARY = "cbd246-canary-3f7c1e";
const CBD237_PARENT = "cobudget_cbd237_live_category";
const CBD237_CHILD = "cobudget_cbd237_live_line";
const CBD237_CATALOG: TableCatalog = { [CBD237_PARENT]: "budget-space", [CBD237_CHILD]: "budget-space" };

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

    // 9. CBD-237: tenant-scoped data-access paths, proven against the real
    //    database rather than a fixture. Two budget-space scratch tables
    //    (a category parent and a line child), two tenants, and one child
    //    row whose foreign key has been substituted to the other tenant's
    //    parent. Every read below goes through the api role, which holds
    //    SELECT/INSERT/UPDATE/DELETE on both tables, so nothing but the
    //    seam's own predicate stands between tenant A and tenant B.
    await connections.migration.query(`DROP TABLE IF EXISTS ${CBD237_CHILD}`);
    await connections.migration.query(`DROP TABLE IF EXISTS ${CBD237_PARENT}`);
    await connections.migration.query(
      `CREATE TABLE ${CBD237_PARENT} (budget_space_id text not null, category_id text not null, label text not null, primary key (budget_space_id, category_id))`,
    );
    await connections.migration.query(
      `CREATE TABLE ${CBD237_CHILD} (budget_space_id text not null, line_id text primary key, category_id text not null, amount integer not null)`,
    );
    await connections.migration.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${CBD237_PARENT}, ${CBD237_CHILD} TO cobudget_api`);

    const api = connections.api;
    const seed = async (table: string, budgetSpaceId: string, values: Record<string, unknown>) => {
      await tenantInsert(api, { table, budgetSpaceId, values }, CBD237_CATALOG);
    };
    await seed(CBD237_PARENT, "space-a", { category_id: "cat-a", label: "groceries" });
    await seed(CBD237_PARENT, "space-b", { category_id: "cat-b", label: "rent" });
    await seed(CBD237_CHILD, "space-a", { line_id: "line-1", category_id: "cat-a", amount: 500 });
    await seed(CBD237_CHILD, "space-a", { line_id: "line-2", category_id: "cat-a", amount: 700 });
    await seed(CBD237_CHILD, "space-b", { line_id: "line-3", category_id: "cat-b", amount: 900 });
    // The substituted foreign key: tenant A's line pointing at tenant B's category.
    await seed(CBD237_CHILD, "space-a", { line_id: "line-4", category_id: "cat-b", amount: 100 });
    results.push("CBD-237 seed: two tenants, four lines, one cross-space foreign key, all inserted through tenantInsert as the api role");

    // Control (CBD-246-AC05 / CBD-237-AC09 "direct repository use"): the
    // database itself isolates nothing. A raw statement as the api role sees
    // every tenant's rows, so whatever the seam withholds below, it withholds.
    const unscoped = await api.query<{ count: string }>(`select count(*) as count from ${CBD237_CHILD}`);
    if (unscoped.rows[0]?.count !== "4") fail(`control: expected the raw api-role count to be 4, got ${unscoped.rows[0]?.count}`);
    results.push("CBD-237 control: a raw api-role statement counts all 4 lines across both tenants -- the database applies no tenant isolation of its own");

    // AC04: horizontal IDOR and a guessed identifier are indistinguishable.
    const shape = (result: { rows: unknown[]; rowCount: number | null }) => JSON.stringify({ rows: result.rows, rowCount: result.rowCount });
    const substituted = await tenantSelect(api, { table: CBD237_CHILD, budgetSpaceId: "space-b", conditions: [{ column: "line_id", value: "line-1" }] }, CBD237_CATALOG);
    const guessed = await tenantSelect(api, { table: CBD237_CHILD, budgetSpaceId: "space-b", conditions: [{ column: "line_id", value: `line-${randomBytes(6).toString("hex")}` }] }, CBD237_CATALOG);
    if (substituted.rowCount !== 0) fail(`AC04: tenant B read tenant A's line-1: ${shape(substituted)}`);
    if (shape(substituted) !== shape(guessed)) fail(`AC04: a substituted identifier (${shape(substituted)}) differs from a guessed one (${shape(guessed)})`);
    results.push(`CBD-237-AC04: tenant A's line-1 under tenant B's scope -> ${shape(substituted)}; a guessed identifier -> ${shape(guessed)} (identical)`);

    const updated = await tenantUpdate(api, { table: CBD237_CHILD, budgetSpaceId: "space-b", set: { amount: 1 }, conditions: [{ column: "line_id", value: "line-1" }] }, CBD237_CATALOG);
    const deleted = await tenantDelete(api, { table: CBD237_CHILD, budgetSpaceId: "space-b", conditions: [{ column: "line_id", value: "line-1" }] }, CBD237_CATALOG);
    const intact = await tenantSelect(api, { table: CBD237_CHILD, budgetSpaceId: "space-a", columns: ["amount"], conditions: [{ column: "line_id", value: "line-1" }] }, CBD237_CATALOG);
    if (updated.rowCount !== 0 || deleted.rowCount !== 0) fail(`AC04: tenant B mutated tenant A's line-1 (update ${updated.rowCount}, delete ${deleted.rowCount})`);
    if (intact.rows[0]?.amount !== 500) fail(`AC04: tenant A's line-1 changed: ${JSON.stringify(intact.rows)}`);
    results.push(`CBD-237-AC04: tenant B's update and delete of line-1 -> rowCount ${updated.rowCount}/${deleted.rowCount}; line-1 still amount=${intact.rows[0]?.amount} under tenant A`);

    // AC05: paging, ordering, and totals under one tenant never include the other's rows.
    const pageB = await tenantSelect(api, { table: CBD237_CHILD, budgetSpaceId: "space-b", columns: ["line_id"], orderBy: [{ column: "amount", direction: "desc" }], limit: 10, offset: 0 }, CBD237_CATALOG);
    const pageA = await tenantSelect(api, { table: CBD237_CHILD, budgetSpaceId: "space-a", columns: ["line_id"], orderBy: [{ column: "line_id" }], limit: 1, offset: 1 }, CBD237_CATALOG);
    const totalA = await tenantCount(api, { table: CBD237_CHILD, budgetSpaceId: "space-a" }, CBD237_CATALOG);
    const totalB = await tenantCount(api, { table: CBD237_CHILD, budgetSpaceId: "space-b" }, CBD237_CATALOG);
    const nobodyPage = await tenantSelect(api, { table: CBD237_CHILD, budgetSpaceId: "space-nobody", limit: 10 }, CBD237_CATALOG);
    const nobodyTotal = await tenantCount(api, { table: CBD237_CHILD, budgetSpaceId: "space-nobody" }, CBD237_CATALOG);
    const ids = (result: { rows: unknown[] }) => (result.rows as { line_id: string }[]).map((row) => row.line_id).join(",");
    if (ids(pageB) !== "line-3") fail(`AC05: tenant B's page contained ${ids(pageB)}`);
    if (ids(pageA) !== "line-2") fail(`AC05: tenant A's second page-of-one contained ${ids(pageA)}`);
    if (totalA.rows[0]?.count !== "3" || totalB.rows[0]?.count !== "1") fail(`AC05: totals A=${totalA.rows[0]?.count} B=${totalB.rows[0]?.count}`);
    if (nobodyPage.rowCount !== 0 || nobodyTotal.rows[0]?.count !== "0") fail(`AC05: a tenant with no rows saw ${shape(nobodyPage)} / count ${nobodyTotal.rows[0]?.count}`);
    results.push(`CBD-237-AC05: tenant B page -> [${ids(pageB)}]; tenant A limit 1 offset 1 -> [${ids(pageA)}]; totals A=${totalA.rows[0]?.count} B=${totalB.rows[0]?.count}; unknown tenant -> ${shape(nobodyPage)}, count ${nobodyTotal.rows[0]?.count}`);

    // AC06: the substituted foreign key joins to nothing under either tenant.
    const join = { table: CBD237_PARENT, on: { column: "category_id", references: "category_id" } };
    const joinedA = await tenantSelect(api, {
      table: CBD237_CHILD, budgetSpaceId: "space-a", columns: [`${CBD237_CHILD}.line_id`, `${CBD237_PARENT}.label`], joins: [join], orderBy: [{ column: `${CBD237_CHILD}.line_id` }],
    }, CBD237_CATALOG);
    const line4UnderA = await tenantSelect(api, { table: CBD237_CHILD, budgetSpaceId: "space-a", columns: [`${CBD237_PARENT}.label`], joins: [join], conditions: [{ column: `${CBD237_CHILD}.line_id`, value: "line-4" }] }, CBD237_CATALOG);
    const line4UnderB = await tenantSelect(api, { table: CBD237_CHILD, budgetSpaceId: "space-b", columns: [`${CBD237_PARENT}.label`], joins: [join], conditions: [{ column: `${CBD237_CHILD}.line_id`, value: "line-4" }] }, CBD237_CATALOG);
    const joinedCountA = await tenantCount(api, { table: CBD237_CHILD, budgetSpaceId: "space-a", joins: [join] }, CBD237_CATALOG);
    if (ids(joinedA) !== "line-1,line-2") fail(`AC06: tenant A's join returned ${ids(joinedA)}`);
    if (line4UnderA.rowCount !== 0 || line4UnderB.rowCount !== 0) fail(`AC06: the substituted foreign key joined under A (${shape(line4UnderA)}) or B (${shape(line4UnderB)})`);
    if (joinedCountA.rows[0]?.count !== "2") fail(`AC06: joined count under A was ${joinedCountA.rows[0]?.count}`);
    results.push(`CBD-237-AC06: tenant A join -> [${ids(joinedA)}] (line-4's tenant-B category excluded); line-4 joined under A -> ${shape(line4UnderA)}, under B -> ${shape(line4UnderB)}; joined count A=${joinedCountA.rows[0]?.count}`);

    // AC09 "direct repository use": the escape hatches a caller might reach
    // for are refused before the driver, even though the api role could
    // physically read the table.
    const refusals: string[] = [];
    try { await platformSelect(api, { table: CBD237_CHILD }, CBD237_CATALOG); fail("platformSelect reached a budget-space table"); } catch (error) { if (!(error instanceof UnknownPlatformTableError)) throw error; refusals.push("platformSelect on a budget-space table"); }
    try { await tenantSelect(api, { table: CBD237_CHILD, budgetSpaceId: "space-b", conditions: [{ column: "budget_space_id", value: "space-a" }] }, CBD237_CATALOG); fail("budget_space_id was accepted as a condition"); } catch (error) { if (!(error instanceof ReservedColumnError)) throw error; refusals.push("budget_space_id as a condition"); }
    try { await tenantSelect(api, { table: CBD237_CHILD, budgetSpaceId: "space-a", joins: [{ table: SCRATCH_TABLE, on: { column: "value", references: "line_id" } }] }, CBD237_CATALOG); fail("a join reached a table outside the catalog"); } catch (error) { if (!(error instanceof UnknownTenantTableError)) throw error; refusals.push("join to a table outside the catalog"); }
    try { await tenantSelect(api, { table: CBD237_CHILD, budgetSpaceId: "space-a", limit: -1 }, CBD237_CATALOG); fail("a negative limit was accepted"); } catch (error) { if (!(error instanceof InvalidPageBoundError)) throw error; refusals.push("negative limit"); }
    results.push(`CBD-237-AC09 direct repository use refused before the driver: ${refusals.join("; ")}`);

    await connections.migration.query(`DROP TABLE ${CBD237_CHILD}`);
    await connections.migration.query(`DROP TABLE ${CBD237_PARENT}`);

    console.log(results.map((line) => `PASS: ${line}`).join("\n"));
  } finally {
    await Promise.all(Object.values(connections).map((pool) => pool.end()));
  }
}

await main();
