import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ConfigError, undocumentedVariables } from "@cobudget/contracts/config";

import { loadWorkerConfigFrom, workerConfigSchema } from "./config.js";

// Generated at test time (never a literal) so no fixture value in this file
// shapes like a key/token for scripts/secret_scanner.py's generic-api-key rule.
const TEST_LOCAL_KEY = randomBytes(32).toString("base64");

const validEnvironment = {
  LOG_LEVEL: "info",
  NODE_ENV: "test",
  SERVICE_VERSION: "test-sha",
  // COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY and _KEY_VERSION are required by
  // loadWorkerConfigFrom whenever the provider is "local" (CBD246-SECURITY-002
  // finding 1: fieldEncryptionConfigFailures runs immediately after the
  // schema load), so both are present in every happy-path fixture below.
  COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
  COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: TEST_LOCAL_KEY,
  COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
} as const;

describe("worker configuration", () => {
  it("loads the shared base configuration without a worker-only copy", () => {
    assert.deepEqual(loadWorkerConfigFrom(validEnvironment), { ...validEnvironment });
  });

  it("fails startup naming a missing variable without echoing values", () => {
    const { LOG_LEVEL: _removed, ...withoutLogLevel } = validEnvironment;

    assert.throws(
      () => loadWorkerConfigFrom(withoutLogLevel),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /LOG_LEVEL/);
        assert.doesNotMatch(error.message, /test-sha/);
        return true;
      },
    );
  });

  it("fails startup naming the missing local key when the provider is local (CBD246-SECURITY-002 finding 1)", () => {
    const { COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: _removed, ...withoutKey } = validEnvironment;

    assert.throws(
      () => loadWorkerConfigFrom(withoutKey),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY/);
        assert.doesNotMatch(error.message, new RegExp(TEST_LOCAL_KEY));
        return true;
      },
    );
  });

  it("fails startup naming the missing key version when the provider is local (CBD246-SECURITY-002 finding 1)", () => {
    const { COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: _removed, ...withoutVersion } = validEnvironment;

    assert.throws(
      () => loadWorkerConfigFrom(withoutVersion),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /COBUDGET_FIELD_ENCRYPTION_KEY_VERSION/);
        return true;
      },
    );
  });

  it("does not require a local key or key version for the kms provider", () => {
    const { COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: _removedKey, COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: _removedVersion, ...withoutLocalMaterial } = validEnvironment;

    const config = loadWorkerConfigFrom({ ...withoutLocalMaterial, COBUDGET_FIELD_ENCRYPTION_PROVIDER: "kms" });
    assert.equal(config.COBUDGET_FIELD_ENCRYPTION_PROVIDER, "kms");
  });

  it("documents every variable the worker reads", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const envExample = readFileSync(resolve(here, "../../../.env.example"), "utf8");

    assert.deepEqual(undocumentedVariables(workerConfigSchema, envExample), []);
  });
});
