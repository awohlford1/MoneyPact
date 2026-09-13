/**
 * CBD246-SECURITY-001 findings 2, 5, and 6 at the point the API actually
 * constructs its data access. `buildApiDataAccess` is pure (config in,
 * `ApiDataAccess` out), so these tests build a config through
 * `loadApiConfigFrom` -- no `process.env` access, which
 * `apps/api/eslint.config.mjs` refuses in every `src/**` file including
 * this one.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { loadApiConfigFrom } from "../config.ts";
import { buildApiDataAccess } from "./index.ts";

// A real 32-byte key, generated at test time rather than a literal in
// source: createLocalKeyProvider requires exactly 32 raw bytes, and a
// generated value carries nothing for a secret scanner to flag.
const BASE_ENV: Record<string, string> = {
  API_PORT: "3001",
  LOG_LEVEL: "info",
  NODE_ENV: "test",
  SERVICE_VERSION: "test-sha",
  COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
  COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: randomBytes(32).toString("base64"),
  COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
};

void test("CBD246-SECURITY-001 finding 2: the api data-access client exposes no raw pool, and no worker or migration access", () => {
  const dataAccess = buildApiDataAccess(loadApiConfigFrom(BASE_ENV));
  const client = dataAccess.client as unknown as Record<string, unknown>;
  assert.equal("query" in client, false, "the client must not expose a raw pool's .query");
  assert.equal("pool" in client, false, "the client must not expose the underlying Pool at all");
  assert.equal("migration" in client, false, "the api client must have no path to the migration role");
  assert.equal("worker" in client, false, "the api client must have no path to the worker role");
  assert.deepEqual(
    Object.keys(client).sort(),
    [
      "platformDelete",
      "platformInsert",
      "platformSelect",
      "platformUpdate",
      "tenantDelete",
      "tenantInsert",
      "tenantSelect",
      "tenantUpdate",
      "transaction",
    ].sort(),
  );
});

void test("CBD246-SECURITY-001 finding 5: missing field-encryption configuration fails at data-access construction, not only in a unit test", () => {
  const { COBUDGET_FIELD_ENCRYPTION_PROVIDER: _removed, ...withoutProvider } = BASE_ENV;
  assert.throws(
    () => loadApiConfigFrom(withoutProvider),
    /COBUDGET_FIELD_ENCRYPTION_PROVIDER/,
  );
});

void test("CBD246-SECURITY-001 finding 6: NODE_ENV=production refuses the local provider at data-access construction", () => {
  const config = loadApiConfigFrom({ ...BASE_ENV, NODE_ENV: "production" });
  assert.throws(
    () => buildApiDataAccess(config),
    /refused outside NODE_ENV=development or NODE_ENV=test/,
  );
});

void test("CBD246-SECURITY-001: a fully configured, development NODE_ENV builds a usable data-access client", () => {
  const config = loadApiConfigFrom({ ...BASE_ENV, NODE_ENV: "development" });
  const dataAccess = buildApiDataAccess(config);
  assert.equal(dataAccess.encryptionProvider.name, "local");
});
