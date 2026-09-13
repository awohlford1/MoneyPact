import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import { bindClient } from "./binding.ts";
import { StatementFailedError } from "./logging.ts";

// The shared loader supplies defaults when configuration is absent. Require a
// distinct scratch database to opt in; never starts Docker or resets a database.
const database = loadLocalDatabaseConfig();
const configured = database.database !== "cobudget_dev";
void test("live transaction rollback and deferred 23503 at COMMIT", { skip: !configured }, async () => {
  const { createMigrationConnection } = await import("./connection.ts");
  const pool = createMigrationConnection();
  const connection = await pool.connect();
  const prefix = "cbd233_" + randomUUID().replaceAll("-", "");
  const parent = prefix + "_parent";
  const child = prefix + "_child";
  try {
    await connection.query(`CREATE TEMP TABLE ${parent} (id uuid PRIMARY KEY)`);
    await connection.query(`CREATE TEMP TABLE ${child} (id uuid PRIMARY KEY, parent_id uuid REFERENCES ${parent}(id) DEFERRABLE INITIALLY DEFERRED)`);
    // One held connection preserves temporary tables; bindClient still checks out
    // exactly once per transaction and controls its BEGIN/COMMIT/ROLLBACK.
    const lease = { query: connection.query.bind(connection), release: () => undefined };
    const fixturePool = { query: connection.query.bind(connection), connect: async () => lease };
    const client = bindClient(fixturePool as unknown as Parameters<typeof bindClient>[0], false, { [parent]: "identity", [child]: "identity" });
    await assert.rejects(client.transaction({}, async (scoped) => {
      await scoped.platformInsert({ table: parent, values: { id: randomUUID() } });
      throw new Error("injected rollback");
    }), /injected rollback/);
    assert.equal((await client.platformSelect({ table: parent })).rowCount, 0);
    let callbackFinished = false;
    await assert.rejects(client.transaction({}, async (scoped) => {
      await scoped.platformInsert({ table: child, values: { id: randomUUID(), parent_id: randomUUID() } });
      callbackFinished = true;
    }), (error: unknown) => error instanceof StatementFailedError && error.operation === "commit" && error.sqlState === "23503");
    assert.equal(callbackFinished, true);
    assert.equal((await client.platformSelect({ table: child })).rowCount, 0);
  } finally {
    connection.release(true);
    await pool.end();
  }
});
