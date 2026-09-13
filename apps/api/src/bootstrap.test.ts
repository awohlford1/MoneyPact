import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { ConfigError } from "@cobudget/contracts/config";
import {
  KmsProviderNotConfiguredError,
  LocalProviderNotAllowedError,
} from "@cobudget/data-access/encryption";
import { runApiBootstrap, type StartupDependencies } from "./bootstrap.js";
import { resolveApiFieldEncryptionProvider, loadApiConfigFrom } from "./config.js";

// Generated at test time (never a literal) so no fixture value in this file
// shapes like a key/token for scripts/secret_scanner.py's generic-api-key rule.
const TEST_LOCAL_KEY = randomBytes(32).toString("base64");

const valid = {
  NODE_ENV: "test",
  LOG_LEVEL: "info",
  SERVICE_VERSION: "local",
  API_PORT: "3001",
  COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
  COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: TEST_LOCAL_KEY,
  COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
};

function effects(environment: Record<string, string>) {
  const calls: string[] = [];
  const dependencies: StartupDependencies = {
    loadConfig: () => { calls.push("validate"); return loadApiConfigFrom(environment); },
    resolveEncryptionProvider: (config) => {
      calls.push("resolve-encryption");
      return resolveApiFieldEncryptionProvider(config);
    },
    createApplication: async () => {
      calls.push("create");
      return {
        enableShutdownHooks: () => { calls.push("hooks"); },
        listen: async (port, address) => { calls.push(`listen:${address}:${port}`); },
      };
    },
    sink: () => { calls.push("ready"); },
  };
  return { calls, dependencies };
}

describe("API pre-effect validation", () => {
  for (const name of ["NODE_ENV", "LOG_LEVEL", "SERVICE_VERSION", "API_PORT"]) {
    it(`never constructs the application or opens a listener without ${name}`, async () => {
      const environment: Record<string, string> = { ...valid };
      delete environment[name];
      const { calls, dependencies } = effects(environment);
      await assert.rejects(runApiBootstrap(dependencies), ConfigError);
      assert.deepEqual(calls, ["validate"]);
    });
  }
  for (const name of ["NODE_ENV", "LOG_LEVEL", "API_PORT", "API_LISTEN_ADDRESS"]) {
    it(`never invokes effects for malformed ${name}`, async () => {
      const { calls, dependencies } = effects({ ...valid, [name]: "CBD113_VALUE_MUST_NOT_APPEAR" });
      await assert.rejects(runApiBootstrap(dependencies), ConfigError);
      assert.deepEqual(calls, ["validate"]);
    });
  }
  it("observes every effect in order on successful startup", async () => {
    const { calls, dependencies } = effects(valid);
    await runApiBootstrap(dependencies);
    assert.deepEqual(calls, ["validate", "resolve-encryption", "create", "hooks", "listen:127.0.0.1:3001", "ready"]);
  });
});

describe("API field-encryption startup enforcement (CBD246-SECURITY-002 finding 1)", () => {
  it("never constructs the application or opens a listener with a missing key version", async () => {
    const { COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: _removed, ...withoutVersion } = valid;
    const { calls, dependencies } = effects(withoutVersion);
    await assert.rejects(runApiBootstrap(dependencies), ConfigError);
    assert.deepEqual(calls, ["validate"]);
  });

  it("stops after configuration validation for a missing local key, before resolving the provider", async () => {
    const { COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: _removed, ...withoutKey } = valid;
    const { calls, dependencies } = effects(withoutKey);
    await assert.rejects(runApiBootstrap(dependencies), ConfigError);
    assert.deepEqual(calls, ["validate"]);
  });

  it("resolves the provider before creating the application or opening a listener, and fails closed in NODE_ENV=production with provider=local", async () => {
    const { calls, dependencies } = effects({ ...valid, NODE_ENV: "production" });
    await assert.rejects(runApiBootstrap(dependencies), LocalProviderNotAllowedError);
    assert.deepEqual(calls, ["validate", "resolve-encryption"]);
  });

  it("fails closed for an unconfigured kms provider before creating the application or opening a listener", async () => {
    const {
      COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: _removedKey,
      COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: _removedVersion,
      ...withoutLocalMaterial
    } = valid;
    const { calls, dependencies } = effects({
      ...withoutLocalMaterial,
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "kms",
    });
    await assert.rejects(runApiBootstrap(dependencies), KmsProviderNotConfiguredError);
    assert.deepEqual(calls, ["validate", "resolve-encryption"]);
  });

  it("fails closed for a missing provider before creating the application or opening a listener", async () => {
    const { COBUDGET_FIELD_ENCRYPTION_PROVIDER: _removed, ...withoutProvider } = valid;
    const { calls, dependencies } = effects(withoutProvider);
    await assert.rejects(runApiBootstrap(dependencies), ConfigError);
    assert.deepEqual(calls, ["validate"]);
  });
});
